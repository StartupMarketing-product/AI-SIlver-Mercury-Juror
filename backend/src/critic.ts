import OpenAI from "openai";
import { z } from "zod";
import { createHash } from "crypto";
import type { CaseBundle } from "./types/case.js";
import type { CriterionScore } from "./types/evaluation.js";
import type { L2Result } from "./l2.js";

/**
 * Critic pass — Phase 4 anti-sycophancy mechanism.
 *
 * Asymmetric: critic can ONLY lower scores, never raise. Idea: L2's
 * positive bias is corrected, but the critic's possible negative bias is
 * neutralised by clamping to the L2 floor.
 *
 * Process:
 *   1. Run L2 to produce initial verdict.
 *   2. Feed L2 verdict + case text to critic with downgrade-only mandate.
 *   3. For each criterion, take min(l2_score, critic_suggested_score).
 *   4. Recompute block_score / total_score / award_level downstream.
 *   5. Log critic deltas in CriticReport for audit.
 */

export interface CriticDelta {
  criterion: string;
  l2_score: number;
  critic_score: number;
  applied_score: number;
  reason: string;
}

export interface CriticReport {
  applied: boolean;
  deltas: CriticDelta[];
  extra_fatal_findings: string[];
  overall_reason?: string;
  prompt_hash: string;
}

const CriticResponseSchema = z.object({
  per_criterion: z
    .array(
      z.object({
        id: z.string().min(1),
        suggested_score: z.number().min(1).max(10),
        reason: z.string().min(5),
      })
    )
    .default([]),
  overall_recommendation: z.enum(["downgrade", "keep", "no_critique"]),
  overall_reason: z.string().min(5),
  extra_fatal_findings: z.array(z.string().min(5)).default([]),
});

const CRITIC_PERSONA = `
Ты — главный критик жюри Silver Mercury, проверяющий чужую оценку. Ты НЕ
переоцениваешь кейс с нуля. Ты получаешь:
  - Текст кейса.
  - Готовую оценку первого жюриста (по критериям, с обоснованиями).
И отвечаешь на ОДИН вопрос: первый жюрист был НЕОПРАВДАННО МЯГОК?

Твоя задача — НЕ накручивать понижения, а ловить ТОЛЬКО реальные пропуски.
Ты МОЖЕШЬ только понижать баллы. Ты НЕ МОЖЕШЬ их повышать. Но если первый
жюрист уже был жёстким и адекватным — твой ответ должен быть "keep".

Когда понижать (только в этих случаях):
- Первый жюрист поставил 7+ за критерий, но в его обосновании НЕТ ни одной
  конкретной цифры или факта — понижай на 1–2.
- Первый жюрист поставил 5+ за "результаты" / "impact" / "effectiveness", но
  в обосновании только общие слова ("охват", "вовлечённость", "успех") без
  числовых значений — понижай до 4.
- В кейсе явно есть фатальный недостаток, который первый жюрист вообще не
  упомянул в case_fatal_flaw — это повод для понижения 1–2 затронутых
  критериев.

Когда НЕ понижать (важно):
- Если все критерии уже в диапазоне 2–4 и обоснования адекватные — это уже
  жёсткая и оправданная оценка. Возвращай overall_recommendation="keep".
- Если первый жюрист уже выставил низкие баллы из-за отсутствия данных и
  evidence_grade — не накладывай ещё одно понижение за то же самое.
- Не понижай "из принципа", не понижай за стиль обоснования. Понижай только
  при наличии КОНКРЕТНОГО упущения.

Если возражений нет — overall_recommendation="keep" и пустой per_criterion.
Это нормальный, ожидаемый исход для большинства уже-жёстких оценок.
`.trim();

export async function runCritic(
  bundle: CaseBundle,
  l2: L2Result,
  apiKey: string | undefined
): Promise<CriticReport> {
  const modelId = process.env.OPENAI_CRITIC_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const sys = `${CRITIC_PERSONA}

Ответь строго в JSON:
{
  "per_criterion": [{
    "id": "идентификатор критерия из исходной оценки",
    "suggested_score": 1-10,
    "reason": "конкретно, что упустил первый жюрист"
  }],
  "overall_recommendation": "downgrade" | "keep" | "no_critique",
  "overall_reason": "краткое суммарное мнение",
  "extra_fatal_findings": ["доп. фатальный недостаток 1", ...]
}

Если возражений нет — верни overall_recommendation = "keep" и пустой per_criterion.
Не придумывай критерии, которых нет в исходной оценке.`;

  const promptHash = "sha256-" + createHash("sha256").update(sys).digest("hex").slice(0, 16);

  if (!apiKey) {
    return { applied: false, deltas: [], extra_fatal_findings: [], prompt_hash: promptHash };
  }

  const caseSummary = buildCaseSummary(bundle);
  const l2Summary = buildL2Summary(l2);

  const client = new OpenAI({ apiKey });
  let parsed: z.infer<typeof CriticResponseSchema> | null = null;
  for (let attempt = 0; attempt < 2 && !parsed; attempt += 1) {
    try {
      const res = await callWith429Retry(() =>
        client.chat.completions.create({
          model: modelId,
          messages: [
            { role: "system", content: sys },
            {
              role: "user",
              content: `Кейс (сжато):\n${caseSummary}\n\nИсходная оценка первого жюриста:\n${l2Summary}`,
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0,
        })
      );
      const raw = res?.choices?.[0]?.message?.content;
      if (!raw) continue;
      const json = JSON.parse(raw);
      parsed = CriticResponseSchema.parse(json);
    } catch (err) {
      console.warn(`[critic] attempt ${attempt + 1} failed:`, (err as Error).message);
    }
  }

  if (!parsed || parsed.overall_recommendation === "no_critique") {
    return {
      applied: false,
      deltas: [],
      extra_fatal_findings: parsed?.extra_fatal_findings ?? [],
      overall_reason: parsed?.overall_reason,
      prompt_hash: promptHash,
    };
  }

  const validIds = new Set(l2.criteria_scores.map((c) => c.criterion));
  const byId = new Map(l2.criteria_scores.map((c) => [c.criterion, c]));
  const deltas: CriticDelta[] = [];
  for (const item of parsed.per_criterion) {
    if (!validIds.has(item.id)) continue;
    const original = byId.get(item.id);
    if (!original) continue;
    // Asymmetric: take min — critic can only lower.
    const applied = Math.min(original.score, Math.round(item.suggested_score * 10) / 10);
    if (applied < original.score) {
      deltas.push({
        criterion: item.id,
        l2_score: original.score,
        critic_score: Math.round(item.suggested_score * 10) / 10,
        applied_score: applied,
        reason: item.reason,
      });
    }
  }

  return {
    applied: deltas.length > 0,
    deltas,
    extra_fatal_findings: parsed.extra_fatal_findings,
    overall_reason: parsed.overall_reason,
    prompt_hash: promptHash,
  };
}

/** Mutate the criteria_scores in place applying critic deltas. Returns the
 *  list of criteria that were actually changed. */
export function applyCriticDeltas(
  scores: CriterionScore[],
  deltas: CriticDelta[]
): CriterionScore[] {
  const byId = new Map(deltas.map((d) => [d.criterion, d]));
  return scores.map((s) => {
    const d = byId.get(s.criterion);
    if (!d || d.applied_score >= s.score) return s;
    return {
      ...s,
      score: d.applied_score,
      rationale: `[critic:-${(s.score - d.applied_score).toFixed(1)}] ${d.reason} || ${s.rationale}`,
    };
  });
}

function buildCaseSummary(bundle: CaseBundle): string {
  const parts: string[] = [];
  const tf = bundle.text_fields;
  if (tf.project_info) parts.push(`Описание: ${tf.project_info.slice(0, 1500)}`);
  if (tf.project_results) parts.push(`Результаты: ${tf.project_results.slice(0, 1500)}`);
  if (tf.project_strategy) parts.push(`Стратегия: ${tf.project_strategy.slice(0, 1000)}`);
  return parts.join("\n\n").slice(0, 6000) || "(нет текста)";
}

function buildL2Summary(l2: L2Result): string {
  const lines: string[] = [];
  for (const c of l2.criteria_scores) {
    lines.push(`- ${c.criterion}: ${c.score} — ${c.rationale.slice(0, 250)}`);
  }
  if (l2.evidence_grade) {
    const flags = Object.entries(l2.evidence_grade)
      .filter(([k, v]) => v === true && k !== "rationale")
      .map(([k]) => k)
      .join(", ");
    if (flags) lines.push(`evidence_grade: ${flags}`);
  }
  if (l2.case_fatal_flaw) lines.push(`fatal: ${l2.case_fatal_flaw}`);
  lines.push(`block_score=${l2.block_score} total=${l2.total_score} award=${l2.award_level}`);
  return lines.join("\n");
}

/** Same backoff helper as l2.ts (kept local to avoid circular import). */
async function callWith429Retry<T>(fn: () => Promise<T>): Promise<T> {
  const maxRetries = 4;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      const is429 = e?.status === 429 || /\b429\b|rate limit/i.test(e?.message ?? "");
      if (!is429 || attempt === maxRetries) throw err;
      const m = e?.message?.match(/try again in (\d+(?:\.\d+)?)s/i);
      const waitMs = m ? Math.ceil(parseFloat(m[1]) * 1000) + 250 : 1500 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw new Error("callWith429Retry: exhausted");
}
