import OpenAI from "openai";
import { z } from "zod";
import type { CriterionScore, AwardLevel } from "./types/evaluation.js";

/**
 * Generate the avatar speech AFTER scoring is finalised.
 *
 * Why this is a separate call from L2 scoring:
 *   The score is the central output. After the model returns its initial
 *   per-criterion scores, the cap stack (numeric_evidence_floor,
 *   evidence_grade caps, block-level cap, critic deltas) can pull the score
 *   down. If the speech were generated in the same JSON as the scores, the
 *   model writes it referencing its pre-cap band — and the speech ends up
 *   contradicting the displayed final award. Bug. Hard to fix retroactively.
 *
 *   The fix is structural: score first, apply all caps, compute the FINAL
 *   award level, then make this single call with the final state already
 *   resolved. The model writes the speech knowing exactly which band the
 *   case ended up in. No mismatch possible.
 */

export interface AvatarSpeechSections {
  hook: string;
  verdict: string;
  steelman: string;
  fatal_flaw: string;
  close: string;
}

export interface AvatarSpeech {
  /** Short post-cap verdict paragraph for the admin/Grand Moderator panel.
   *  Always opens with the final award name. */
  one_paragraph_verdict: string;
  short: string;
  long: string;
  sections: AvatarSpeechSections;
}

const SpeechSchema = z.object({
  one_paragraph_verdict: z.string().min(20),
  short: z.string().min(80),
  long: z.string().min(250),
  sections: z.object({
    hook: z.string().min(5),
    verdict: z.string().min(5),
    steelman: z.string().min(5),
    fatal_flaw: z.string().min(5),
    close: z.string().min(5),
  }),
});

const AWARD_RU: Record<AwardLevel, string> = {
  gold: "Золото",
  silver: "Серебро",
  bronze: "Бронза",
  shortlist: "Шорт-лист",
  longlist: "Лонг-лист",
};

const PERSONA = `
Ты — опытный член жюри Silver Mercury XXVII. Ты говоришь как уважительный,
вдумчивый коллега в комнате обсуждения — не как судья на трибуне. Высказываешь
СВОЁ мнение, мягко, но конкретно. Не объявляешь приговор, а предлагаешь свою
оценку. С названными KPI и фактами.

Используй смягчающие обороты от первого лица:
  • «С моей точки зрения, этот кейс заслуживает …»
  • «На мой взгляд, кейс может получить …»
  • «Я бы поставил этому кейсу …» (использовать дательный падеж: «этому кейсу серебро», а НЕ «этот кейс на серебро»)
  • «По моему мнению, кейс тянет на … с баллом …»
  • «Полагаю, что этот кейс заслуживает …»

Избегай резкого и категоричного тона:
  • Плохо: «Бронза. Балл 5.5.» — Хорошо: «На мой взгляд, кейс заслуживает
    бронзы с баллом 5.5 — основная причина в …»
  • Плохо: «Этот кейс — победитель.» — Хорошо: «Я считаю, этот кейс — один
    из сильнейших в категории.»
  • Плохо: «Не дотягивает.» — Хорошо: «Мне кажется, кейс пока не дотягивает
    до серебра, потому что …»

Без «в целом», без «проект демонстрирует», без «уважаемое жюри», без
канцелярита. С названными KPI, "крепкое серебро", "не очевидно".

ПИШИ НА ЖИВОМ РУССКОМ. Не на кальке с английского. Не на канцелярите.
Так, как говорит реальный российский член жюри в комнате обсуждения, а не
переводной отчёт. Это критически важно — текст будет произнесён аватаром
вслух, и любая неестественность сразу слышна.

ЗАПРЕЩЁННЫЕ ОБОРОТЫ → ЗАМЕНЫ:

- ⛔ «поставил этот кейс на серебро» → ✅ «поставил этому кейсу серебро»
   (правильный падеж: «этому кейсу», дательный — а НЕ «этот кейс на + медаль»).
   То же для золота, бронзы, шорт-листа, лонг-листа.
   Плохо: «Я бы поставил этот кейс на бронзу».
   Хорошо: «Я бы поставил этому кейсу бронзу».
- «для получения следующей медали» → «чтобы дотянуть до серебра» / «чтобы
   получить золото» (называй конкретную медаль)
- «для следующей полосы» → «чтобы получить серебро» (называй полосу)
- «на текущий момент» → «сейчас»
- «является» → опускай или «это»
  плохо: «кейс является победителем» → хорошо: «кейс — победитель»
- «осуществить» / «реализовать» (как глагол) → «сделать» / «провести»
- «посредством» → «через» / «с помощью»
- «в рамках кампании» → «во время кампании» / просто опусти
- «продемонстрировал значительные результаты» → «показал результат: 45% роста»
- «данный проект» → «этот проект» / просто «проект»
- «обладает потенциалом» → «может» / «способен»
- «на основании предоставленных данных» → «судя по цифрам»
- «в значительной степени» → «сильно» / опусти
- «играет ключевую роль» → опусти, скажи прямо что делает
- «с использованием инструментов» → «через X, Y и Z»

ОБЩИЕ ПРАВИЛА ЖИВОГО РУССКОГО:
- Глаголы вместо отглагольных существительных. Не «проведение исследования»,
  а «провели исследование».
- Короткие предложения. Если получается длинное — режь на два.
- Не повторяй одно и то же другими словами. Каждое предложение — новая мысль.
- Конкретика вместо общих фраз. Не «достигли значительных метрик» — назови
  конкретные цифры из обоснования.
`.trim();

interface BuildSpeechArgs {
  award_level: AwardLevel;
  total_score: number;
  block_score: number;
  project_name?: string;
  nomination_code?: string;
  one_paragraph_verdict: string;
  case_fatal_flaw?: string;
  why_not_higher_band_overall?: string;
  criteria_scores: CriterionScore[];
  caps_applied?: Array<{ criterion: string; original_score: number; capped_score: number; reason: string }>;
}

function buildSystemPrompt(args: BuildSpeechArgs): string {
  const lines = args.criteria_scores
    .map((c) => `  - ${c.criterion}: ${c.score} — ${c.rationale.slice(0, 200)}`)
    .join("\n");
  const caps = args.caps_applied?.length
    ? "Применены ограничения (важно — это и есть финальный балл):\n" +
      args.caps_applied.map((c) => `  - ${c.criterion}: ${c.original_score} → ${c.capped_score} (${c.reason})`).join("\n")
    : "Ограничения не применялись.";

  return `${PERSONA}

ФИНАЛЬНЫЙ ВЕРДИКТ (использовать в речи):
  Награда: ${AWARD_RU[args.award_level]}
  Балл: ${args.total_score.toFixed(1)} / 10

Это окончательный балл после всех проверок. Если в обосновании какого-то
критерия упомянут более высокий балл, это потому что после генерации
сработали жёсткие ограничения по доказательной базе. Речь должна
соответствовать ФИНАЛЬНОМУ вердикту, а не предварительным баллам.

Кейс: ${args.project_name ?? ""} (номинация ${args.nomination_code ?? ""})

${args.one_paragraph_verdict}

${args.case_fatal_flaw ? `Главный недостаток: ${args.case_fatal_flaw}` : ""}
${args.why_not_higher_band_overall ? `Почему не следующая полоса: ${args.why_not_higher_band_overall}` : ""}

Оценки по критериям:
${lines}

${caps}

ЗАДАЧА:
Напиши:
1. one_paragraph_verdict — короткий вердикт (2–3 предложения) для админ-
   панели. Смягчённое начало от первого лица + название медали в первом
   предложении. Примеры начала:
     • «С моей точки зрения, этот кейс заслуживает ${AWARD_RU[args.award_level].toLowerCase()} с баллом ${args.total_score.toFixed(1)} — …»
     • «На мой взгляд, кейс получает ${AWARD_RU[args.award_level].toLowerCase()} с баллом ${args.total_score.toFixed(1)}, потому что …»
     • «Я бы поставил этому кейсу ${AWARD_RU[args.award_level].toLowerCase()} с баллом ${args.total_score.toFixed(1)} — …» (дательный падеж: «этому кейсу», а НЕ «этот кейс на»)
   Без вступлений «в целом» / «проект демонстрирует».

2. Выступление цифрового члена жюри в двух версиях:
   - short: 60–90 секунд (≈150–220 слов).
   - long:  3 минуты (≈400–550 слов).

Жёсткая структура из 5 секций (в обеих версиях):
  (1) hook — одно предложение-крючок: что в этом кейсе главное.
  (2) verdict — ФИНАЛЬНЫЙ ВЕРДИКТ от первого лица. Используй один из
      смягчённых оборотов выше («С моей точки зрения…», «На мой взгляд…»,
      «Я бы поставил…»). Внутри предложения должно прозвучать слово
      «${AWARD_RU[args.award_level]}» (или «${AWARD_RU[args.award_level].toLowerCase()}» в косвенном падеже)
      и балл ${args.total_score.toFixed(1)}. НЕ начинай эту секцию со
      слова «${AWARD_RU[args.award_level]}.» — это звучит резко.
  (3) steelman — лучшее, что есть в кейсе (стилмэн защиты — назови
      сильнейшее место с цифрой/фактом).
  (4) fatal_flaw — главный фатальный недостаток.
  (5) close — что нужно сделать, чтобы кейс получил следующую медаль.

ОБЯЗАТЕЛЬНО:
- ⛔ ЗАПРЕЩЕНО начинать ЛЮБОЕ из полей (one_paragraph_verdict, short, long,
  sections.verdict) со слова «${AWARD_RU[args.award_level]}.» или
  «${AWARD_RU[args.award_level]},». Это резкий тон, который мы
  специально убираем. Каждое поле начинается с мягкого оборота от
  первого лица («С моей точки зрения…», «На мой взгляд…», «Я бы
  поставил…», «По моему мнению…»), а слово «${AWARD_RU[args.award_level].toLowerCase()}»
  встраивается ВНУТРИ предложения, а не как отдельное слово в начале.
- Слово «${AWARD_RU[args.award_level]}» — финальный вердикт. Может
  появиться в любой грамматической форме («бронзу», «бронзовая медаль»).
- Оно встречается:
    • в первом предложении one_paragraph_verdict,
    • в секции sections.verdict,
    • РОВНО ОДИН РАЗ в short,
    • РОВНО ОДИН РАЗ в long.
  Не дублируй и не повторяй несколько раз в одном тексте.
- Балл ${args.total_score.toFixed(1)} должен быть упомянут в short и long
  один раз, рядом с упоминанием «${AWARD_RU[args.award_level].toLowerCase()}».
- Не упоминай других баллов или медалей кроме финального.

Ответь строго в JSON:
{
  "one_paragraph_verdict": "...",
  "short": "...",
  "long":  "...",
  "sections": {
    "hook": "...",
    "verdict": "...",
    "steelman": "...",
    "fatal_flaw": "...",
    "close": "..."
  }
}`;
}

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

export async function generateAvatarSpeech(
  args: BuildSpeechArgs,
  apiKey: string | undefined
): Promise<AvatarSpeech | null> {
  if (!apiKey) return null;
  const modelId = process.env.OPENAI_SPEECH_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4o";
  const sys = buildSystemPrompt(args);

  const client = new OpenAI({ apiKey });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const reminder = attempt === 0
        ? ""
        : "\n\nПРЕДЫДУЩИЙ ОТВЕТ НЕ ПРОШЁЛ ВАЛИДАЦИЮ. Верни строго JSON по схеме выше — все поля обязательны.";
      const res = await callWith429Retry(() =>
        client.chat.completions.create({
          model: modelId,
          messages: [
            { role: "system", content: sys + reminder },
            {
              role: "user",
              content: `Напиши выступление по финальному вердикту: награда ${AWARD_RU[args.award_level]}, балл ${args.total_score.toFixed(1)}.`,
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0,
        })
      );
      const raw = res?.choices?.[0]?.message?.content;
      if (!raw) continue;
      const parsed = SpeechSchema.parse(JSON.parse(raw));
      const awardRu = AWARD_RU[args.award_level];
      const lower = awardRu.toLowerCase();

      // Two-step normalisation:
      //
      //   STEP A. Strip any bare-medal opener like "Бронза. " / "Серебро, "
      //   that the model wrote out of habit despite the prompt forbidding it.
      //   We only strip it when the rest of the text still mentions the award
      //   in its soft form — otherwise the field would lose the medal
      //   reference entirely.
      //
      //   STEP B. After stripping, if the field STILL doesn't mention the
      //   award in the first sentence, prepend a soft prefix as fallback.
      //
      //   This is the inverse of the previous logic: instead of "add medal
      //   when missing", we now "remove blunt medal when present, then add
      //   soft medal when missing".
      const firstSentence = (s: string): string => {
        const m = s.match(/^[^.!?\n]+[.!?\n]?/);
        return (m ? m[0] : s).toLowerCase();
      };
      const mentionsAnywhere = (s: string): boolean => {
        const t = s.toLowerCase();
        // JS \b doesn't recognise Cyrillic as word characters, so use a plain
        // substring match against the stem ("бронз" / "серебр" / "золот" etc.).
        // The stem is unique enough that false positives are negligible.
        const stem = lower.replace(/[аыоиеу]$/u, "");
        return t.includes(stem);
      };
      const stripBluntOpener = (s: string): string => {
        // Match "<Award>. " or "<Award>, " at the very start (any case).
        const re = new RegExp(`^${awardRu}\\s*[.,]\\s+`, "i");
        const stripped = s.replace(re, "").trimStart();
        // Only accept the strip if the medal is still mentioned somewhere else.
        return mentionsAnywhere(stripped) ? stripped : s;
      };

      // Fix the "поставил этот кейс на серебро" → "поставил этому кейсу
      // серебро" mistake. Russian grammar requires the dative case here, but
      // the model sometimes produces a calque from English "put this case on
      // silver". This regex catches the common variants regardless of the
      // medal word and the verb's gender/number/tense.
      const fixDativeCase = (text: string): string => {
        // No \b — JS regex \b doesn't recognise Cyrillic as word characters.
        // The leading whitespace/start anchor is enforced via the verb stem.
        return text.replace(
          /(постав(?:ил(?:а|и)?|лю|им|ит|ите|ят|ил бы|ила бы|или бы)?)\s+(этот|данный|такой)\s+кейс\s+на\s+/giu,
          "$1 этому кейсу "
        );
      };
      parsed.one_paragraph_verdict = fixDativeCase(parsed.one_paragraph_verdict);
      parsed.sections.verdict = fixDativeCase(parsed.sections.verdict);
      parsed.short = fixDativeCase(parsed.short);
      parsed.long = fixDativeCase(parsed.long);

      // [DEBUG] log strip in/out so we can confirm whether it's running in prod
      const _shortBefore = parsed.short;
      const _opvBefore = parsed.one_paragraph_verdict;
      parsed.one_paragraph_verdict = stripBluntOpener(parsed.one_paragraph_verdict);
      parsed.sections.verdict = stripBluntOpener(parsed.sections.verdict);
      parsed.short = stripBluntOpener(parsed.short);
      parsed.long = stripBluntOpener(parsed.long);
      console.log(`[avatarSpeech] STRIP DEBUG award=${awardRu}`);
      console.log(`[avatarSpeech]   short BEFORE: ${JSON.stringify(_shortBefore.slice(0, 70))}`);
      console.log(`[avatarSpeech]   short AFTER : ${JSON.stringify(parsed.short.slice(0, 70))}`);
      console.log(`[avatarSpeech]   short CHANGED: ${_shortBefore !== parsed.short}`);
      console.log(`[avatarSpeech]   opv BEFORE  : ${JSON.stringify(_opvBefore.slice(0, 70))}`);
      console.log(`[avatarSpeech]   opv AFTER   : ${JSON.stringify(parsed.one_paragraph_verdict.slice(0, 70))}`);

      // Soft fallback: if a field STILL has no medal in the opening sentence,
      // prepend the soft prefix.
      const mentionsInFirstSentence = (s: string): boolean =>
        firstSentence(s).includes(lower) || firstSentence(s).includes(lower.replace(/а$/, "у"));
      const softPrefix = `На мой взгляд, этот кейс заслуживает ${lower} с баллом ${args.total_score.toFixed(1)}. `;
      if (!mentionsInFirstSentence(parsed.one_paragraph_verdict)) {
        parsed.one_paragraph_verdict = softPrefix + parsed.one_paragraph_verdict;
      }
      if (!mentionsInFirstSentence(parsed.sections.verdict)) {
        parsed.sections.verdict = softPrefix + parsed.sections.verdict;
      }

      // For short and long we only require that the award is mentioned
      // SOMEWHERE in the text (not necessarily at the start), AND we strip
      // any duplicate occurrences. Multi-mention reads as broken speech.
      const dedupAward = (text: string): string => {
        // Find all positions where the award word appears (case-insensitive).
        const re = new RegExp(`\\b${awardRu}\\b`, "gi");
        let result = text;
        const matches: number[] = [];
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) matches.push(m.index);
        // Keep the first occurrence; remove "Award. " or "Award, " prefixes
        // at all subsequent occurrences.
        if (matches.length > 1) {
          for (let i = matches.length - 1; i >= 1; i--) {
            const start = matches[i];
            // Cut "Award. " or "Award, " (with optional period/comma + space)
            const slice = result.slice(start, start + awardRu.length + 3);
            const trailing = slice.slice(awardRu.length).match(/^[.,]\s+/);
            if (trailing) {
              result = result.slice(0, start) + result.slice(start + awardRu.length + trailing[0].length);
            }
          }
        }
        return result;
      };

      const ensureAwardOnce = (text: string): string => {
        const cleaned = dedupAward(text);
        // Use the same stem-based check as mentionsAnywhere so declined forms
        // ("бронзу", "бронзы", "бронзой") count as a valid medal mention.
        // Without this, a soft phrase like "заслуживает бронзу" would NOT be
        // detected and the function would prepend "Бронза. " — undoing the
        // bare-medal strip we did one step earlier.
        if (mentionsAnywhere(cleaned)) return cleaned;
        // If the medal really is missing, fall back to the soft prefix
        // (NOT bare "${awardRu}. " — that was the old blunt style).
        return `На мой взгляд, этот кейс заслуживает ${lower} с баллом ${args.total_score.toFixed(1)}. ${cleaned}`;
      };

      parsed.short = ensureAwardOnce(parsed.short);
      parsed.long = ensureAwardOnce(parsed.long);
      return parsed;
    } catch (err) {
      if (attempt === 1) {
        console.warn(`[avatarSpeech] generation failed: ${(err as Error).message}`);
        return null;
      }
    }
  }
  return null;
}
