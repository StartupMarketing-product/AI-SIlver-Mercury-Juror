/**
 * Few-shot examples for L2 prompt — drawn from real best-quality human judges
 * of Silver Mercury XXVI (judge IDs 8995, 9116, 9141, 9442, 9769; identified
 * via judge_quality_analysis.mjs in repo root). Each example pairs an actual
 * jury score with the judge's own rationale text. The model uses these to
 * anchor its tone, structure (strengths + weaknesses + missing KPIs), and
 * willingness to use the full 1–10 scale.
 *
 * Comments are quoted verbatim (PII removed if any). All four bands are
 * represented so the model sees what 9, 7, 5, and 3 actually look like in the
 * voice of an expert juror.
 */

export interface JudgeFewShot {
  band_label: string; // human-readable band ("9–10 gold", etc.)
  score: number;
  award: string;
  project_hint: string; // short generic project type, NOT the project name
  rationale_excerpt: string;
}

export const JUDGE_FEW_SHOTS: JudgeFewShot[] = [
  {
    band_label: "9–10 (золото)",
    score: 9.8,
    award: "GOLD",
    project_hint: "крупная социально-значимая кампания",
    rationale_excerpt:
      "Отличный большой проект, как продуктово, так и коммуникационно. Сама идея очень востребованная и социально значимая. Уровень проработки и медийного распространения достойный — национальный масштаб, релевантный запросу и поставленным задачам. За него гордо и в части маркетинговых задач, и в части социального эффекта.",
  },
  {
    band_label: "7–8 (серебро)",
    score: 7.4,
    award: "SILVER",
    project_hint: "креативная кампания на культурном коде",
    rationale_excerpt:
      "Яркий интересный креативный кейс. Теплый, ламповый, отражающий культурный код, социально значимый. Не хватило отражения финансовых KPI и результатов бюджетодержателя, которые особенно важны в массовых кампаниях. Без этих цифр кейс не дотягивает до золота.",
  },
  {
    band_label: "5–6 (бронза)",
    score: 5.4,
    award: "BRONZE",
    project_hint: "performance-кампания со средними KPI",
    rationale_excerpt:
      "Начну с того, что нравится: идея персонификации контента классная, реализация качественная, в целом хорошая крепкая работа. Креатив с точки зрения реализации хорош. Но big idea слабая, её нет — она считывается как стандартный performance. Бюджет vs результаты в норме, но нет ничего, что выделяло бы кейс среди десятков аналогичных.",
  },
  {
    band_label: "3–4 (шорт-лист)",
    score: 4.8,
    award: "SHORTLIST",
    project_hint: "фестивальная активация без медийной упаковки",
    rationale_excerpt:
      "Не достаточно полно раскрыта уникальность кейса. Не хватило медийности в упаковке и защиты: отсутствие видеоотчёта и фотоотчёта особенно критично в этой номинации. Больше промо, чем результата. Метрики номинации не закрыты.",
  },
  {
    band_label: "1–2 (лонг-лист)",
    score: 2.5,
    award: "LONGLIST",
    project_hint: "PR-проект без идеи и без атрибуции",
    rationale_excerpt:
      "Со стороны идеи — она почти отсутствует, не хватает ключевой мысли. Просто запустили активность и получили какие-то цифры, но непонятно, относятся ли эти цифры к проекту или к общему фону. Стратегия не описана, KPI не атрибутированы. Это не кейс уровня премии.",
  },
];

/** Render few-shots as a prompt section. */
export function renderFewShots(): string {
  const blocks = JUDGE_FEW_SHOTS.map(
    (s) =>
      `Балл ${s.score} (${s.band_label}) — ${s.project_hint}:\n  «${s.rationale_excerpt}»`
  );
  return `Примеры обоснований реальных лучших жюри XXVI на разных полосах шкалы.
Это твой ориентир по стилю, тону и структуре аргументации (плюсы → минусы →
чего не хватает для следующей полосы → конкретные KPI/доказательства):

${blocks.join("\n\n")}

Стиль: прямой, без вступлений; всегда называй и плюсы, и минусы; всегда указывай,
какого конкретного KPI/доказательства не хватает для перехода в следующую полосу.`;
}
