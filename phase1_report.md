# Phase 1 — Empirical analysis of SM_2025 human L2 scoring

Source: SM_2025.json — 8777 L2 evaluations across 781 projects from 937 judges.

**Purpose:** before redesigning the AI persona, look at what real human judges actually did. Three things matter: do humans use the full 1–10 scale (yes/no), how does score-by-criterion vary by final award, and what do top-calibrated judges actually write at each score band.

## A. Distribution of human total_score by final award

How wide is the human range per award class? If real judges stick to 4–6 across all awards, the AI clustering is matching reality. If real judges spread their scores, the clustering is an LLM-only artifact.

| award | n | mean | median | p10 | p90 | min | max |
|-------|---|------|--------|-----|-----|-----|-----|
| GOLD | 558 | 8.8 | 9.1 | 7 | 10 | 2 | 10 |
| SILVER | 1693 | 7.36 | 7.7 | 4.8 | 9.4 | 1 | 10 |
| BRONZE | 2378 | 5.69 | 5.7 | 3.3 | 8 | 1 | 10 |
| SHORTLIST | 2840 | 4.08 | 4 | 2 | 6.5 | 1 | 10 |
| LONGLIST | 1308 | 2.59 | 2 | 1 | 4.6 | 1 | 9.8 |

### Total-score histogram (all evaluations, all awards)

`1–2`   646 ████████████████████
`2–3`  1268 ████████████████████████████████████████
`3–4`  1065 █████████████████████████████████
`4–5`  1279 ████████████████████████████████████████
`5–6`  1015 ████████████████████████████████
`6–7`   983 ███████████████████████████████
`7–8`   922 █████████████████████████████
`8–9`   800 █████████████████████████
`9–10`   613 ███████████████████
`10–11`   186 ██████

## B. Per-criterion score distributions

Same view, but per criterion. Tells us if any criterion is intrinsically narrower than others (e.g. 'Strategy' might cluster while 'Idea' uses the full range).

| criterion | n | mean | median | p10 | p90 | min | max |
|-----------|---|------|--------|-----|-----|-----|-----|
| Strategy | 7039 | 5.19 | 5 | 2 | 9 | 1 | 10 |
| Results | 5627 | 4.97 | 5 | 2 | 9 | 1 | 10 |
| Execution & Craft | 3738 | 5.4 | 5 | 2 | 9 | 1 | 10 |
| Execution | 3626 | 5.66 | 6 | 2 | 9 | 1 | 10 |
| Idea | 3083 | 5.16 | 5 | 2 | 9 | 1 | 10 |
| Effectiveness & Results | 3000 | 5.21 | 5 | 2 | 9 | 1 | 10 |
| Creativity | 2537 | 5.35 | 5 | 2 | 9 | 1 | 10 |
| Innovation & Creativity | 1863 | 5.18 | 5 | 2 | 9 | 1 | 10 |
| Challenge | 1383 | 5.4 | 5 | 2 | 9 | 1 | 10 |
| Idea freshness | 1119 | 4.53 | 4 | 1 | 9 | 1 | 10 |
| Social outcomes | 818 | 5.61 | 5 | 2 | 10 | 1 | 10 |
| Solution | 294 | 5.29 | 5 | 2 | 9 | 1 | 10 |
| Big Idea | 175 | 5.35 | 6 | 1 | 9 | 1 | 10 |
| Campaign | 175 | 5.17 | 6 | 1 | 9 | 1 | 10 |
| Social Outcomes | 108 | 5.33 | 5 | 2 | 9 | 1 | 10 |

### Per-criterion mean score by final award

| award | Challenge | Idea | Execution | Results | Strategy | Social Outcomes | Creativity | Social outcomes |
|-------|---|---|---|---|---|---|---|---|
| GOLD | 8.47 | 8.74 | 8.96 | 8.38 | 8.71 | — | 8.60 | 9.36 |
| SILVER | 6.90 | 7.05 | 7.60 | 7.11 | 7.22 | 7.32 | 7.37 | 7.58 |
| BRONZE | 5.67 | 5.50 | 5.90 | 5.44 | 5.52 | 6.00 | 5.51 | 5.88 |
| SHORTLIST | 4.23 | 4.14 | 4.34 | 3.94 | 4.03 | 3.91 | 4.06 | 4.14 |
| LONGLIST | 3.06 | 2.67 | 2.87 | 2.61 | 2.56 | 2.60 | 2.62 | 2.60 |
| NONE | — | — | — | — | — | — | — | — |

## C. Top calibrated judges (correlation of their L2 score → final award)

This is empirical — judges whose individual scores best predict the eventual award are the closest thing we have to a 'good juror' to imitate.

| judge_id | n_evals | corr(score, award) | score_std | score_range |
|----------|---------|--------------------|-----------|-------------|
| 8837 | 12 | 0.987 | 3.14 | 1.15–10 |
| 9774 | 11 | 0.977 | 2.53 | 1–8.8 |
| 8918 | 15 | 0.977 | 2.41 | 1.4–9.9 |
| 9600 | 10 | 0.976 | 2.45 | 2–9.1 |
| 10369 | 15 | 0.976 | 2.29 | 2.1–10 |
| 10367 | 12 | 0.972 | 2.2 | 2.3–9.1 |
| 10368 | 12 | 0.971 | 2.24 | 2.4–9.1 |
| 9731 | 10 | 0.968 | 2.64 | 2–10 |
| 9874 | 10 | 0.967 | 1.82 | 2.3–7 |
| 9009 | 13 | 0.964 | 3.38 | 1–10 |
| 9450 | 11 | 0.964 | 2.36 | 3–10 |
| 8923 | 12 | 0.96 | 1.68 | 3.6–9.15 |
| 9900 | 11 | 0.96 | 2.48 | 1–9.7 |
| 9691 | 12 | 0.958 | 2.17 | 2.2–9.6 |
| 9110 | 12 | 0.956 | 2.6 | 1.9–9.5 |
| 9861 | 13 | 0.955 | 2.88 | 1–10 |
| 9173 | 13 | 0.951 | 2.61 | 1.3–9 |
| 8904 | 12 | 0.95 | 2.57 | 1.1–9 |
| 9679 | 13 | 0.949 | 2.8 | 1.6–9 |
| 9892 | 13 | 0.948 | 2.26 | 1–9.18 |
| 9811 | 13 | 0.948 | 2.39 | 1–8.3 |
| 8947 | 10 | 0.948 | 2.6 | 1.15–10 |
| 9092 | 11 | 0.947 | 2.07 | 2.5–10 |
| 9595 | 13 | 0.946 | 2.43 | 2–9.3 |
| 9406 | 10 | 0.945 | 1.33 | 5–9 |

## D. Sample comments from top-25 judges, by score band

These are the canonical human voices at each score band. The AI persona should sound like THIS, not like generic LLM rationale.

### 9–10 GOLD  (n=24)

- **judge 9900, F05, total=9.7, award=GOLD:**
  > Высокий уровень. Интересный креатив, кейс, ориентированный на свою аудиторию, учтены все каналы и метрики по ним. Привязка к бизнес-показателям. Более того, на высоком уровне составлена заявка! Молодцы!
- **judge 9679, K05, total=9, award=GOLD:**
  > Много онлайн-части проекта, если смотреть проект как комплекс мероприятий - соответствует номинации. Хороший дизайн проекта, эстетика соответствует ЦА. В этом мероприятии больше всего ивента, чем в остальных проектах.
- **judge 8837, A24, total=10, award=GOLD:**
  > Шикарный кейс по работе с big  data, гипотезами, сегментацией, поиску инсайтов, болей потребителя и поиску решений преломления барьеров. Результаты отцифрованы, Рост конверсий и рост продаж соответствуют бизнес задачам компании.

### 7–8 SILVER  (n=43)

- **judge 9774, E01, total=8.8, award=SILVER:**
  > Крепкий хороший проект с использованием в целом стандартного уже инструментария с инфлюенсерами для продвижения премиального сервиса. Из вау можно отметить креативную идея в неделей моды в Париже. Крепкое серебро. Не хватило нестандартного инструментария для золота.
- **judge 9600, A23, total=7, award=BRONZE:**
  > Хороший кейс, классно вывернутый хук, что если не победа в шоу, то победа по жизни тебя как современной девушки.  Многие косметические бренды интегрируются в ТВ шоу, но не многие выходят за рамки интеграции с коммуникацией в ОЛВ, которая служит продолжением общей кампании.
- **judge 9092, C15, total=7.2, award=SILVER:**
  > Отличный кейс. Инсайт удивляет, идея отвечает на сайт. Идея новая, крафт на высшем уровне. Очень деликатный язык, осторожный. При этом проблематика доносится четко и бьет в сердечко. Есть вопросы к результатам, однако я считаю, что многое зависит от времени и места Спасибо за проект

### 5–6 BRONZE  (n=39)

- **judge 8947, C14, total=5.5, award=BRONZE:**
  > Кажется, что первостепенная задача была - это продвижение платформы. Проект сам по себе классный - выверенная подача темы, большой список используемых инструментов. Но если смотреть именно на креатив, то сложно сказать, что эта идея свежая и новая.
- **judge 9774, E03, total=5.8, award=BRONZE:**
  > Проект интересен своей стратегической историей по объединению аукционных домов и продвижению русского искусства. Качественно проработанный проект с хорошими результатами в СМИ, но без креативных идей. Вопрос, считаем ли PR абонент как малобюджетный проект
- **judge 9892, A26, total=6.15, award=BRONZE:**
  > Понравился омниканальный подход, все реализовано как по учебнику. 172 000 попали в красную зону, но непонятно сколько из них не знали о своих проблемах сердца. Бизнес результат не отслеживается, но в кейсе упоминаются цели. Мне понравилась сама идея и реализация ее, но непонятны результаты

### 3–4 SHORTLIST  (n=60)

- **judge 9874, F03, total=3.5, award=SHORTLIST:**
  > Кейс крепкий, но нет в нем уникальности, т.е. не отвечает уровню фестиваля, в т.ч. по тому, как проект подан (в рамках обсуждений пришлось домысливать какие-то моменты). Видно, что была проведена качественная аналитика, и результаты для категории не плохи, но проект не является бенчмарком.
- **judge 9900, F05, total=3.1, award=SHORTLIST:**
  > Хороший кейс, понравилось, что детально оцифровали, но не хватило убедительности в цифрах при сравнении с предыдущими периодами и аналитики. Идея и механики акции не новы и подведены к стандартному розыгрышу призов. Понравилась сплоченная защита, которая очень отличалась от выступлений других номинантов.
- **judge 9861, F13, total=4, award=SHORTLIST:**
  > &gt; &quot;Кубокроссы МТС и Street Beat: синергия технологии и моды! Креативный дизайн Canyaon привлёк продвинутую молодёжь, повысив узнаваемость &quot;Кубиков&quot; МТС и укрепив имидж Street Beat как законодателя трендов.  Но работа не является фестивальной низкие показатели и плохо прописаны результаты.

### 1–2 LONGLIST  (n=55)

- **judge 8904, K01, total=2, award=SHORTLIST:**
  > Интересное решение. Реализация сложная с точки зрения формата - в полете, согласования. При этом само мероприятие реализовано в лучших традициях базовых решений в данной категории.  Интересная идея. хорошие результаты.
- **judge 9092, C14, total=2.5, award=LONGLIST:**
  > Слабая идея. Не очевидная связь динозаврика с заболеванием.  Аудитория родители и врачи, но форма коммуникации выбрана как на детей. Место для инсталляции выбрано не ради эффективности. Обоснование при защите подтверждает это
- **judge 9874, F04, total=2.5, award=SHORTLIST:**
  > Результативность проекта вызывает сомнения, особенно на фоне большого бюджета. Кажется, что при довольно четкой и не очень широкой ЦА, выбор каналов не релевантен. Креатив не цепляющий. Уникальности и ценности проекта не видно.

## E. Project median across judges — vs final award

This is what the regulation actually computes (median across ≥7 judges per project). Tells us what the **emergent jury verdict** distribution looks like for each award class.

| award | n | mean of medians | median of medians | p10 | p90 |
|-------|---|-----------------|-------------------|-----|-----|
| GOLD | 54 | 9.27 | 9.2 | 8.8 | 9.9 |
| SILVER | 163 | 7.78 | 7.75 | 7 | 8.5 |
| BRONZE | 210 | 5.82 | 5.9 | 5 | 6.7 |
| SHORTLIST | 243 | 3.93 | 4 | 3.1 | 4.8 |
| LONGLIST | 111 | 2.19 | 2.1 | 1.6 | 2.8 |

## F. Key takeaways for persona design

(Auto-derived; verify against the tables above.)

- Best-calibrated judge: 8837 (corr=0.987 across 12 evals). Use this judge as the anchor voice for the persona.
- Overall human total score range: 1–10, p10–p90 = 2–8.8. This is the empirical distribution the AI should match.

**Implication for v6 persona design:**
- Do not invent rules. Encode the empirical per-band trigger language from Section D verbatim.
- Match the empirical distribution shape from Section A, not a uniform expectation.
- Use the top-judge IDs as the persona's voice anchors (their comments become the few-shot retrieval pool).
