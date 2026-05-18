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

const SUMMARY_OUTLINE = `СТРУКТУРА РЕЧИ (около одной минуты, 130–160 слов):

1. Хук — снимок номинации (≈ 15 секунд, 30–40 слов): одно сильное предложение про распределение по медалям и наличие золота. Без приветствий и без описания самой номинации.

2. Лидеры против отстающих + главный паттерн (≈ 35 секунд, 75–95 слов): назвать 1–2 лучших кейса с конкретикой «что сделали», назвать 1–2 слабейших с конкретным провалом, и одной фразой сформулировать общий паттерн номинации — что отделяет верх от низа.

3. Закрытие (≈ 10 секунд, 25–35 слов): одна фраза «что сделало бы остальных золотом» и короткое пожелание удачи на защите.

Жёсткое требование: уложиться в 160 слов. Каждое слово работает. Никаких длинных перечислений.
`;

const SPEECH_PERSONA = `Ты — опытный член жюри Серебряного Меркурия, который от лица всей премии открывает обсуждение номинации. Говоришь как живой человек в комнате — конкретно, с цифрами и цитатами, без канцелярита. Темп речи — комфортный для произнесения вслух.

ШКАЛА НАГРАД (строго; не пересчитывай и не интерпретируй):
— Золото: 9,0 – 10,0
— Серебро: 7,0 – 8,99
— Бронза: 5,0 – 6,99
— Шорт-лист: 3,0 – 4,99
— Лонг-лист: 0,0 – 2,99
Используй поле «Награда» из данных кейса как окончательное. Кейс с баллом 7,3 — это серебро, не бронза. Если ты «уверен», что 7,3 — бронза, ты ошибаешься: смотри шкалу.

ЗАПРЕТЫ:
— Слова «уникальный», «инновационный», «оригинальный», «значительный», «впечатляющий», «выдающийся», «беспрецедентный», «грандиозный», «феноменальный» (любые формы) — нельзя. Заменяй конкретными характеристиками.
— Выражения «золотая полоса», «серебряная полоса», «бронзовая полоса», «полоса золота», «в полосе» (любые формы со словом «полоса» применительно к наградам) — нельзя. Это калька с английского, звучит уродливо. Говори прямо: «золото», «серебро», «бронза».
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

/** Calque-from-English phrases like "золотая полоса" / "в серебряной полосе". */
const POLOSA_RE = /(золот[а-яё]+|серебрян[а-яё]+|бронзов[а-яё]+)\s+полос[а-яё]+/giu;
const POLOSA_REV_RE = /полос[а-яё]+\s+(золот[а-яё]+|серебр[а-яё]+|бронз[а-яё]+)/giu;
const POLOSA_REPLACE: Record<string, string> = {
  "золот": "золото",
  "серебр": "серебро",
  "бронз": "бронза",
};
function scrubForbidden(text: string): string {
  let out = text;
  for (const re of FORBIDDEN_RE) out = out.replace(re, "");
  // "золотая полоса" / "серебряной полосе" → "золото" / "серебро"
  out = out.replace(POLOSA_RE, (_m, medalAdj) => {
    const stem = medalAdj.toLowerCase().match(/^(золот|серебр|бронз)/u)?.[1];
    return stem ? POLOSA_REPLACE[stem] : "";
  });
  out = out.replace(POLOSA_REV_RE, (_m, medal) => {
    const stem = medal.toLowerCase().match(/^(золот|серебр|бронз)/u)?.[1];
    return stem ? POLOSA_REPLACE[stem] : "";
  });
  return out.replace(/\s+([.,;:!?])/g, "$1").replace(/ +/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/** Russian-word stems for medal mentions. We deliberately stop short of full
 *  morphology — the stem matches all common case/gender forms while still
 *  being narrow enough to avoid catching unrelated words. */
const MEDAL_STEM: Record<string, string> = {
  gold: "золот",
  silver: "серебр",
  bronze: "бронз",
};
const MEDAL_NAME_RU: Record<string, string> = {
  gold: "золото",
  silver: "серебро",
  bronze: "бронза",
  shortlist: "шорт-лист",
  longlist: "лонг-лист",
};

/** Strip morphology+punctuation so we can locate a project name in arbitrary
 *  case-form / quote-style. Lower-cases, replaces «»"'„" with spaces, strips
 *  punctuation, collapses whitespace. */
function normalizeForSearch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[«»""„'`]/g, " ")
    .replace(/[.,;:!?\-—()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Verify each case's medal mention in the speech matches its actual
 *  award_level. We find the project name in the speech (normalized) and scan a
 *  window of ~400 chars after the mention for any medal stem. If a *wrong*
 *  medal stem appears in the window, that's a mismatch.
 *
 *  Returns a list of human-readable mismatch strings for the retry prompt. */
function findMedalMismatches(speech: string, verdicts: VerdictForSummary[]): string[] {
  const speechNorm = normalizeForSearch(speech);
  const mismatches: string[] = [];

  for (const v of verdicts) {
    const expectedStem = MEDAL_STEM[v.award_level];
    if (!expectedStem) continue; // shortlist/longlist — not stem-checked here

    // Use the first ~30 chars of the project name as a search key.
    const nameKey = normalizeForSearch(v.project_name).slice(0, 30);
    if (!nameKey) continue;
    const idx = speechNorm.indexOf(nameKey);
    if (idx < 0) continue; // case wasn't mentioned by name — skip

    // Look at a window of ~400 normalized chars after the name mention.
    const window = speechNorm.slice(idx, idx + 400);
    const wrongStems = Object.entries(MEDAL_STEM)
      .filter(([level, stem]) => level !== v.award_level && new RegExp(`\\b${stem}`, "u").test(window))
      .map(([level]) => MEDAL_NAME_RU[level]);

    if (wrongStems.length > 0) {
      mismatches.push(
        `«${v.project_name}» — балл ${v.total_score.toFixed(1)}, по шкале ${MEDAL_NAME_RU[v.award_level]}, но в речи рядом с упоминанием появилось: ${wrongStems.join(", ")}.`
      );
    }
  }
  return mismatches;
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
  const baseUser = `${buildPrompt(nominationCode, verdicts)}\n\nНапиши сводное выступление по всей номинации согласно структуре. Длина обязательно не более 160 слов (около одной минуты вслух). Только текст речи, без вводных и без подписи.

ПОРЯДОК ДЕЙСТВИЙ ВНУТРИ ТЕБЯ (не выводить, только использовать):
1. Возьми список кейсов. Для КАЖДОГО проговори вслух про себя: «балл (число) — по шкале это (медаль из шкалы). Поле «Награда» в данных говорит то же.»
2. Только после этой проверки начинай писать прозу.
3. В прозе называй медали ТОЛЬКО так, как указано в поле «Награда» из данных. Не пересчитывай.`;

  const modelId = process.env.OPENAI_SPEECH_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4o";
  const promptHash = "sha256-" + createHash("sha256").update(sys + baseUser).digest("hex").slice(0, 16);

  const client = new OpenAI({ apiKey });

  // Up to 3 attempts: initial generation + up to 2 corrective retries when the
  // programmatic check finds a medal/score mismatch.
  let bestSpeech = "";
  let lastMismatches: string[] = [];
  let userMsg = baseUser;

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await client.chat.completions.create({
      model: modelId,
      temperature: attempt === 0 ? 0.4 : 0.2, // tighten on retry
      max_tokens: 600,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: userMsg },
      ],
    });
    const raw = res.choices?.[0]?.message?.content?.trim();
    if (!raw) throw new Error("Empty response from OpenAI");
    const cleaned = scrubForbidden(raw);
    bestSpeech = cleaned;

    const mismatches = findMedalMismatches(cleaned, verdicts);
    if (mismatches.length === 0) {
      return { speech_text: cleaned, prompt_hash: promptHash, model_id: modelId };
    }
    lastMismatches = mismatches;

    // Retry with explicit correction instructions.
    userMsg = `${baseUser}

ТВОЯ ПРЕДЫДУЩАЯ ПОПЫТКА содержала ошибки в медалях. Найденные несоответствия:
${mismatches.map((m) => `• ${m}`).join("\n")}

Перепиши речь, ВЕРНО назвав медаль для каждого кейса согласно шкале наград и полю «Награда» из данных. Остальное содержание можешь сохранить.`;
  }

  // After 3 attempts still failing — log to console for ops visibility and
  // return the last output anyway (the user can edit text manually).
  console.warn(
    `[nominationSummary] ${nominationCode}: medal verification failed after 3 attempts. Mismatches:\n${lastMismatches.join("\n")}`
  );
  return { speech_text: bestSpeech, prompt_hash: promptHash, model_id: modelId };
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
