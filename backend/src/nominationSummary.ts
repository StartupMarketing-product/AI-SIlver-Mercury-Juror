/**
 * Nomination-level summary speech.
 *
 * Generates one ≥3 min speech that covers ALL cases in a nomination as a
 * single narrative — top scores, bottom scores, the pattern across the
 * cohort, and the gap to gold. Stored in public.nomination_summaries.
 *
 * Render pipeline reuses the same HeyGen adapter as per-case avatars
 * (heygenCreateVideo + the existing poller in index.ts). The poller
 * is updated to also look at this table so video URLs land here
 * automatically when HeyGen finishes.
 */
import { createHash } from "crypto";
import OpenAI from "openai";
import { getSupabase } from "./supabase.js";

export interface NominationSummaryRow {
  id: string;
  nomination_code: string;
  speech_text: string | null;
  prompt_hash: string | null;
  model_id: string | null;
  heygen_video_id: string | null;
  avatar_video_url: string | null;
  avatar_status: "pending" | "rendering" | "ready" | "failed";
  avatar_error: string | null;
  speech_generated_at: string | null;
  avatar_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

interface VerdictForSummary {
  external_case_id: string;
  project_name: string;
  total_score: number;
  award_level: string;
  criteria_scores: Array<{ criterion: string; score: number; rationale: string }>;
  case_fatal_flaw?: string;
  one_paragraph_verdict?: string;
}

const SUMMARY_OUTLINE = `СТРУКТУРА РЕЧИ (минимум 3 минуты, 550–650 слов):

1. Хук (≈ 25 секунд, 60–80 слов): открывающее предложение, которое запоминается. Не «здравствуйте, в этой номинации». Сразу — конкретная общая картина: сколько кейсов, какое распределение по медалям, есть ли золото. Если золота нет — назвать это сразу как факт и пообещать объяснить.

2. Серебро / лидеры (≈ 80 секунд, 160–200 слов): пройти по кейсам с самым высоким баллом в порядке убывания. Для КАЖДОГО одна фраза «что сделали хорошо» с конкретикой и одна — «чего не хватило до золота». Конкретные метрики или цитаты из кейсов, не общие слова.

3. Бронза / середина (≈ 55 секунд, 110–140 слов): пройти по кейсам с баллами в бронзовой полосе. Что у них общее, что отличает от лидеров. Конкретный единственный сдвиг, который мог бы каждый из них поднять.

4. Главный паттерн номинации (≈ 55 секунд, 110–140 слов): самая ценная для слушателя часть. Что объединяет тех, кто выше? Что объединяет тех, кто ниже? Сформулировать одну чёткую гипотезу. Привести 2 контрпримера: где паттерн «правильный», где «неправильный».

5. Почему ни один не золото — или почему именно эти стали золотом (≈ 35 секунд, 70–90 слов): отдельный смысловой блок про планку золота в этой номинации. Главное упущение всех или сильнейший приём победителей.

6. Закрытие (≈ 20 секунд, 40–60 слов): короткое пожелание удачи на защите, без длинных постскриптумов.
`;

const SPEECH_PERSONA = `Ты — опытный член жюри Серебряного Меркурия, который от лица всей премии открывает обсуждение номинации. Говоришь как живой человек в комнате — конкретно, с цифрами и цитатами, без канцелярита. Темп речи — комфортный для произнесения вслух.

ЗАПРЕТЫ:
— Слова «уникальный», «инновационный», «оригинальный», «значительный», «впечатляющий», «выдающийся», «беспрецедентный», «грандиозный», «феноменальный» (любые формы) — нельзя. Заменяй конкретными характеристиками.
— Сокращения «п.п.», «и т.д.», «р/с» — нельзя, пиши полностью.
— Не описывай саму номинацию (что такое D10 / D01 и так далее). Слушатель это уже знает.
— Не используй markdown.
— Цитаты в кавычках только дословные из материалов кейсов.

ОБЯЗАТЕЛЬНО:
— Называй проекты их полными названиями.
— Балл произноси как «семь и семь» (а не «7.7»).
— Не более одной шутки или ритмической вставки за весь монолог — лучше ни одной.`;

function fmtScore(n: number): string {
  // 7.7 -> "семь и семь"; 7 -> "семь"; 7.3 -> "семь и три"
  if (Number.isInteger(n)) return numberToRussianWord(n);
  const parts = n.toFixed(1).split(".");
  return `${numberToRussianWord(parseInt(parts[0]))} и ${numberToRussianWord(parseInt(parts[1]))}`;
}
function numberToRussianWord(n: number): string {
  const map: Record<number, string> = {
    0: "ноль", 1: "один", 2: "два", 3: "три", 4: "четыре",
    5: "пять", 6: "шесть", 7: "семь", 8: "восемь", 9: "девять",
    10: "десять",
  };
  return map[n] ?? String(n);
}

function buildPrompt(nomCode: string, verdicts: VerdictForSummary[]): string {
  const sorted = [...verdicts].sort((a, b) => b.total_score - a.total_score);
  const lines: string[] = [];
  lines.push(`Номинация: ${nomCode}`);
  lines.push(`Всего кейсов: ${verdicts.length}`);
  lines.push("");
  lines.push("КЕЙСЫ (по убыванию итогового балла):");
  for (let i = 0; i < sorted.length; i++) {
    const v = sorted[i];
    lines.push("");
    lines.push(`--- Кейс ${i + 1} ---`);
    lines.push(`Название: «${v.project_name}»`);
    lines.push(`Итоговый балл: ${v.total_score.toFixed(1)} (произносить «${fmtScore(v.total_score)}»)`);
    lines.push(`Награда: ${v.award_level}`);
    if (v.one_paragraph_verdict) {
      lines.push(`Краткий вердикт:\n${v.one_paragraph_verdict}`);
    }
    if (v.criteria_scores?.length) {
      lines.push("Оценки по критериям:");
      for (const c of v.criteria_scores) {
        lines.push(`  • ${c.criterion}: ${c.score} — ${c.rationale.slice(0, 300)}`);
      }
    }
    if (v.case_fatal_flaw) {
      lines.push(`Главный недостаток: ${v.case_fatal_flaw}`);
    }
  }
  return lines.join("\n");
}

const FORBIDDEN_RE: RegExp[] = [
  /(?<![а-яё])уникальн[а-яё]{0,6}\s*/giu,
  /(?<![а-яё])инновационн[а-яё]{0,6}\s*/giu,
  /(?<![а-яё])оригинальн[а-яё]{0,6}\s*/giu,
  /(?<![а-яё])значительн[а-яё]{0,6}\s*/giu,
  /(?<![а-яё])впечатляющ[а-яё]{0,6}\s*/giu,
  /(?<![а-яё])выдающ[а-яё]{0,6}\s*/giu,
  /(?<![а-яё])беспрецедентн[а-яё]{0,6}\s*/giu,
  /(?<![а-яё])грандиозн[а-яё]{0,6}\s*/giu,
  /(?<![а-яё])феноменальн[а-яё]{0,6}\s*/giu,
];
function scrubForbidden(text: string): string {
  let out = text;
  for (const re of FORBIDDEN_RE) out = out.replace(re, "");
  return out.replace(/\s+([.,;:!?])/g, "$1").replace(/ +/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export async function generateSummarySpeech(
  nominationCode: string,
  apiKey: string | undefined
): Promise<{ speech_text: string; prompt_hash: string; model_id: string }> {
  const sb = getSupabase();
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  // Pull all verdicts for the nomination
  const { data: rows, error } = await sb
    .from("verdicts")
    .select(`
      total_score, award_level, criteria_scores, one_paragraph_verdict,
      cases:case_id ( external_case_id, project_name, nomination_id )
    `)
    .eq("cases.nomination_id", nominationCode);
  if (error) throw new Error(`DB error fetching verdicts: ${error.message}`);

  const verdicts: VerdictForSummary[] = (rows ?? [])
    .filter((r: any) => r.cases && r.cases.nomination_id === nominationCode)
    .map((r: any) => ({
      external_case_id: r.cases.external_case_id ?? "",
      project_name: r.cases.project_name ?? "(без названия)",
      total_score: Number(r.total_score) || 0,
      award_level: r.award_level ?? "longlist",
      criteria_scores: Array.isArray(r.criteria_scores) ? r.criteria_scores : [],
      one_paragraph_verdict: r.one_paragraph_verdict ?? undefined,
    }));

  if (verdicts.length === 0) {
    throw new Error(`No scored verdicts found for nomination ${nominationCode}`);
  }

  const sys = `${SPEECH_PERSONA}\n\n${SUMMARY_OUTLINE}`;
  const user = `${buildPrompt(nominationCode, verdicts)}\n\nНапиши сводное выступление по всей номинации согласно структуре. Длина обязательно не менее 550 слов, не более 700. Только текст речи, без вводных и без подписи.`;

  const modelId = process.env.OPENAI_SPEECH_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4o";
  const promptHash = "sha256-" + createHash("sha256").update(sys + user).digest("hex").slice(0, 16);

  const client = new OpenAI({ apiKey });
  const res = await client.chat.completions.create({
    model: modelId,
    temperature: 0.4,
    max_tokens: 4000,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
  });
  const raw = res.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error("Empty response from OpenAI");
  const cleaned = scrubForbidden(raw);

  return { speech_text: cleaned, prompt_hash: promptHash, model_id: modelId };
}

export async function upsertSummary(
  nominationCode: string,
  fields: Partial<NominationSummaryRow>
): Promise<NominationSummaryRow> {
  const sb = getSupabase();
  const payload: any = { nomination_code: nominationCode, ...fields };
  const { data, error } = await sb
    .from("nomination_summaries")
    .upsert(payload, { onConflict: "nomination_code" })
    .select("*")
    .single();
  if (error) throw new Error(`upsert nomination_summary: ${error.message}`);
  return data as NominationSummaryRow;
}

export async function getSummary(nominationCode: string): Promise<NominationSummaryRow | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("nomination_summaries")
    .select("*")
    .eq("nomination_code", nominationCode)
    .maybeSingle();
  if (error) throw new Error(`select nomination_summary: ${error.message}`);
  return (data as NominationSummaryRow) ?? null;
}

/** Find all summary rows in 'rendering' state — used by the avatar poller. */
export async function listRenderingSummaries(): Promise<NominationSummaryRow[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("nomination_summaries")
    .select("*")
    .eq("avatar_status", "rendering");
  if (error) throw new Error(`list rendering summaries: ${error.message}`);
  return (data as NominationSummaryRow[]) ?? [];
}

export async function setSummaryAvatarVideo(
  nominationCode: string,
  fields: { status: string; video_id?: string | null; video_url?: string | null; error?: string | null }
): Promise<void> {
  const sb = getSupabase();
  const payload: any = {
    avatar_status: fields.status,
    avatar_updated_at: new Date().toISOString(),
  };
  if (fields.video_id !== undefined) payload.heygen_video_id = fields.video_id;
  if (fields.video_url !== undefined) payload.avatar_video_url = fields.video_url;
  if (fields.error !== undefined) payload.avatar_error = fields.error;
  const { error } = await sb
    .from("nomination_summaries")
    .update(payload)
    .eq("nomination_code", nominationCode);
  if (error) throw new Error(`update summary avatar: ${error.message}`);
}
