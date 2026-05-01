# План реализации — Синтетический член жюри Silver Mercury

Документ фиксирует финальную архитектуру и поэтапный план разработки.
Все решения приняты по итогам обсуждения и зафиксированы в TK_UPDATE_ADDENDUM.md.

---

## 1. Финальная архитектура

### 1.1. Роли и доступ
- **Главный Администратор** (роль `admin`): загрузка кейсов, утверждение script'ов вердиктов, распределение кейсов по модераторам и сессиям. Может быть несколько человек.
- **Модератор** (роль `moderator`): управление своей сессией, проигрывание утверждённых вердиктов в Zoom через screen-share.
- **Observer** (роль `observer`): просмотр без действий (для аудиторов).
- **Регистрация по приглашению.** Self-service закрыт. Админ создаёт аккаунты, отправляет приглашение по email.
- Auth: Supabase Auth (email + password + 2FA).

### 1.2. Поток данных (end-to-end)
```
Админ загружает кейсы (JSON или PDF/DOCX)
        ↓
Парсинг полей кейса + скачивание ссылок (PDF-презентации, видео)
        ↓
Ingestion: PDF native text + Vision-LLM для слайдов + Whisper для видео
        ↓
Сборка Evidence Index (цитата → источник: страница / таймкод / поле)
        ↓
L2 scoring: critique-then-score по критериям блока, anchored rubric, no retrieval
        ↓
Расчёт итогового балла + медальной категории по регламенту XXVII
        ↓
Генерация script вердикта (60±30 сек, минимум 45 сек)
        ↓
Генерация 3–5 pre-rendered Q&A анкоров (на ожидаемые вопросы)
        ↓
HITL: админ одобряет каждый script, при необходимости редактирует
        ↓
HeyGen Video API: рендер MP4 (аватар + русский TTS)
        ↓
ffmpeg post-process: накладывает scorecard overlay (название кейса + балл + медаль)
        ↓
Кэш MP4 в Supabase Object Storage с SHA-256 хэшем
        ↓
Админ распределяет кейсы 1:1 по сессиям и модераторам
        ↓
Модератор в день фестиваля:
  - открывает консоль в браузере
  - шерит вкладку в Zoom (с «Share computer audio»)
  - проигрывает текущий вердикт + при необходимости Q&A анкоры
        ↓
Аудит: все действия (load, score, approve, render, play) логируются
        ↓
Через 30 дней после фестиваля: автоматический export пакета организаторам + удаление
```

### 1.3. Технический стек

| Слой | Технология | Обоснование |
|---|---|---|
| Backend API | Node.js + Express + TypeScript | Существует в текущем коде |
| Frontend | Vite + React + TypeScript | Существует в текущем коде |
| Storage | Supabase (Postgres + Object Storage + Auth) | Один сервис, минимум интеграции, готовый RBAC |
| Scoring LLM | Claude Sonnet 4.6 (через Anthropic API) | Лучший русский + рассуждения |
| Vision LLM | Claude Sonnet 4.6 with vision | Image-heavy слайды, GPT-4o как fallback |
| Speech-to-text | OpenAI Whisper API | Русский лучшего качества, $0.006/мин |
| Avatar render | HeyGen Video API (non-interactive) | Стабильный персонаж, native Russian TTS |
| Video post-process | ffmpeg | Overlay со scorecard |
| Zoom integration | Screen-share вкладки браузера | Без Recall.ai в MVP |

---

## 2. Поэтапный план разработки

### Фаза 0. Подготовка и чистка

**Цель**: убрать всё лишнее из текущего кода, подготовить инфраструктуру.

- Удалить `l1.ts` и все вызовы L1 из `runAnalysis.ts`.
- Удалить L1-каскадные кэпы и `not_long` из `l2.ts`.
- Удалить `historicalKnowledge.ts` (retrieval).
- Удалить calibration логику в `runAnalysis.ts` (quantile mapping).
- Удалить `judgePriors.ts` или переключить на статические anchor-теги.
- Удалить anonymity scanner — нет в плане.
- Удалить conflict-of-interest механизм — нет в плане.
- Удалить `replayBenchmark.ts` для L1-метрик; заменить на L2-бенчмарк (фаза 7).
- Поднять Supabase проект, создать схему БД (см. ниже), Auth-роли, Storage bucket.
- Подключить Anthropic API + OpenAI API + HeyGen API + ffmpeg.

**Deliverable**: чистая кодовая база, развёрнутая инфраструктура Supabase, рабочие API ключи.

### Фаза 1. Методология (точно по регламенту XXVII)

**Цель**: полная и точная конфигурация всех 12 блоков.

- Извлечь из регламента XXVII веса критериев для каждого из 12 блоков (включая Impact для блока A с весом 5%).
- Извлечь медальные пороги: longlist 0–2.99 / shortlist 3–4.99 / bronze 5–6.99 / silver 7–8.99 / gold ≥9.
- Извлечь формулу социальных критериев из методички для 19 социально-ориентированных номинаций.
- Сформировать `methodology.json` со всеми 12 блоками. Каждое значение — с комментарием-ссылкой на параграф регламента/методички.
- Реализовать `methodologyLoader.ts` — загрузка и валидация конфигурации.
- Curate anchor-примеры: 3 на критерий × ~6 критериев × 12 блоков ≈ 200 эталонов (берём из SM_2025 или вместе с организаторами фестиваля). Хранятся в `anchors.json`.

**Deliverable**: `methodology.json`, `anchors.json`, валидатор конфигурации.

### Фаза 2. Ingestion pipeline (мульти-источниковый)

**Цель**: вытащить из кейса всё содержимое, привязать к источникам.

- **Парсер кейса**: принимает JSON или загруженный документ (PDF/DOCX), извлекает структурированные поля (project_name, project_info, project_results, project_strategy, project_realisation, channels, ссылки на presentation_pdf, results_file, video_link).
- **PDF-обработка**:
  - Слой 1: native text через `pdf-parse`.
  - Слой 2: если текст разрежен (<1000 символов) или PDF image-heavy → рендер страниц в PNG → Claude Sonnet 4.6 vision API → структурированное описание содержимого слайда + извлечение всех видимых цифр и текста.
- **Видео-обработка**:
  - Скачивание по ссылке (Rutube/Vimeo/YouTube — через yt-dlp).
  - Транскрибация через OpenAI Whisper API (русский) с таймкодами.
- **Evidence Index**: каждая извлечённая цитата хранится с `{source_type, source_id, page_or_timestamp, text, hash}`. Все последующие выводы scoring engine ссылаются на `evidence_id`.

**Deliverable**: `ingestion.ts` v2, `evidenceIndex.ts`, тесты на 5 разнообразных кейсах из SM_2025.

### Фаза 3. Scoring engine v2

**Цель**: оценка по критериям блока строго по регламенту, без подражания истории.

- **Системный промпт** для Claude: регламент блока + методичка + полная rubric с anchor-примерами 2/5/8 для каждого критерия.
- **Critique-then-score** по каждому критерию:
  1. Strengths (с обязательной цитатой `evidence_id`).
  2. Weaknesses (с обязательной цитатой `evidence_id`).
  3. Band (low/mid/high).
  4. Score 1–10 с обоснованием.
- **Strict JSON-схема** вывода (`zod` валидация). Hard-reject при невалидном.
- **Hard-rules** (детерминированно поверх LLM):
  - Если в Evidence Index нет ни одной цитаты с цифрами/датами → Results ≤ 3.
  - Если score без `evidence_ids[]` → invalid.
  - Если в выводе балл вне 1–10 → invalid.
- **Расчёт итогового балла**: взвешенная сумма по `methodology.json`.
- **Социальные критерии**: для социально-ориентированных номинаций — формула из методички (отдельный социальный sub-score, усреднение с блоковым).
- **Медальная категория**: пороги XXVII (3/5/7/9).
- **Reproducibility**: каждый verdict содержит `{input_hash, methodology_hash, anchors_hash, prompt_hash, model_id, created_at}`.

**Deliverable**: `l2.ts` v2, `runAnalysis.ts` v2, JSON-схема Verdict, юнит-тесты.

### Фаза 4. Генерация script вердикта и Q&A анкоров

**Цель**: подготовить тексты, которые будет озвучивать аватар.

- **Script вердикта**: шаблон + LLM-перефразировка для естественной речи.
  - Длина: 60±30 сек, минимум 45 сек, максимум 90 сек (~150–225 слов).
  - Структура: «Кейс [имя] в номинации [код]. Итоговый балл [N], [медаль]. Сильные стороны: [...]. Слабые стороны: [...]. Краткое обоснование по критериям: [...]. Итог: [...]».
  - Тон: логично, плавно, спокойно, уверенно. Без хеджирования.
  - Вшиваем словесную проверку «перечитайте, звучит ли разговорно за 1 минуту» в системный промпт.
- **Q&A анкоры**: 3–5 коротких script'ов на ожидаемые вопросы:
  - «Расскажите подробнее о результатах»
  - «Почему такая оценка за идею»
  - «В чём ключевая слабость работы»
  - «Как Вы оцениваете стратегию»
  - «Что нужно изменить, чтобы получить медаль выше»
  - Длина каждого: 15–25 сек.

**Deliverable**: `scriptGenerator.ts`, `qaAnchorGenerator.ts`, JSON-схема ScriptPackage.

### Фаза 5. HITL-одобрение (модуль ревью)

**Цель**: каждый script проходит через человеческое одобрение до рендера.

- В консоли админа: список кейсов со статусом script'ов (`pending_review`, `approved`, `rejected`).
- Карточка кейса показывает:
  - Verdict как JSON (балл, критерии, evidence).
  - Script вердикта в виде текста + Q&A анкоры.
  - Кнопки `Approve` / `Edit` / `Regenerate` / `Reject`.
  - При `Edit`: текстовый редактор; при сохранении — пересчёт `prompt_hash` и пометка «человеческая правка».
- Только `approved` script идёт в рендер.

**Deliverable**: страница `Admin / Review` во фронте, API `/api/scripts/:id/approve | edit | reject`.

### Фаза 6. Render pipeline (HeyGen + ffmpeg)

**Цель**: превратить одобренный script в готовый MP4 со scorecard.

- **HeyGen integration**:
  - Один раз: выбрать stock-аватар из каталога (нейтральный профессиональный образ), зафиксировать `avatar_id`.
  - Один раз: выбрать русский native TTS голос, зафиксировать `voice_id`.
  - Per-script: POST `/v2/video/generate` с `avatar_id` + `voice_id` + script. Async, ждём webhook.
  - При ошибке: retry × 2.
  - Если всё ещё ошибка → fallback: TTS only (OpenAI TTS или HeyGen voice-only) + статичная картинка аватара. Помечается в БД как `degraded_render`.
- **ffmpeg overlay**: после получения MP4 — пост-обработка:
  - Нижний угол: scorecard (название кейса + ID + номинация + итоговый балл + медальная категория).
  - Шрифт, фон, размер — единый для всех 100 клипов.
- **Сохранение**: MP4 в Supabase Storage с SHA-256 хэшем. Метадата в Postgres.

**Deliverable**: `renderService.ts`, scorecard-template, тестовые рендеры на 5 кейсах.

### Фаза 7. Консоль администратора (распределение)

**Цель**: админ распределяет утверждённые кейсы по сессиям и модераторам.

- Страница `Admin / Sessions`:
  - Создание сессии: `name`, `date`, `assigned_moderator_id`.
  - Drag-and-drop: список одобренных кейсов → колонка сессии.
  - Установка порядка кейсов в сессии (важно для UX модератора).
  - Кейс может быть в одной сессии (1:1).
- Страница `Admin / Users`:
  - Создание модератора: email + name → отправка приглашения.
  - Назначение ролей.

**Deliverable**: страницы `Admin / Sessions`, `Admin / Users`, API `/api/sessions`, `/api/users`.

### Фаза 8. Консоль модератора + screen-share

**Цель**: чтобы во время Zoom-сессии модератор играл правильный вердикт правильного кейса.

- Страница `Moderator / Session`:
  - Заголовок: имя сессии, текущая дата, число кейсов.
  - Большая зона **«Текущий кейс»**:
    - Название проекта, ID, номинация.
    - Кнопка `▶ Play verdict` (модалка подтверждения «Сейчас прозвучит вердикт по кейсу [имя]»).
    - Под ней — кнопки Q&A анкоров: `Если спросят о результатах`, `Если спросят об идее`, и т.д.
    - Кнопки: `Pause`, `Stop`, `Repeat`.
  - Слева — список кейсов сессии в заданном админом порядке. Подсветка текущего.
  - Кнопки `→ Next` / `← Previous`.
  - Поле `Jump to case` (поиск, минимум 3 символа).
  - Hotkeys: `Space` = play/pause, `→` = next, `←` = previous, `Esc` = stop.
  - Во время проигрывания: красная полоса, имя кейса крупно.
- Видео плеер:
  - Один большой `<video>` элемент, плеер с native controls.
  - При нажатии Play — запуск MP4 с `autoplay`, `controls`, `playsInline`.
  - Перед запуском — модалка подтверждения с именем кейса.
- Screen-share инструкция в UI:
  - Подсказка: «Шерьте эту вкладку в Zoom с галкой Share computer audio».
  - Скриншот-инструкция, как это делать в Zoom.

**Deliverable**: страница `Moderator / Session`, тест на 3 параллельных сессиях.

### Фаза 9. Аудит-журнал и export

**Цель**: соответствие требованиям прозрачности и retention.

- Аудит-лог в Postgres с записью: `case_id`, `session_id`, `user_id`, `action`, `timestamp`, `payload_hash`.
- События: case_uploaded, case_parsed, evidence_indexed, scored, script_generated, script_approved, script_edited, script_rejected, rendered, played, session_ended.
- Страница `Admin / Audit`: фильтры, экспорт CSV.
- **Через 30 дней после фестиваля**:
  - Автоматический cron-task: упаковка zip с MP4 + JSON-вердиктами + аудит-логом + методологией.
  - Уведомление админа со ссылкой на download.
  - После подтверждения админа — удаление из платформы.

**Deliverable**: `audit.ts`, страница `Admin / Audit`, retention-cron.

### Фаза 10. Регрессионный бенчмарк (квалитативный)

**Цель**: понять, насколько разумно работает система до боевого использования.

- Прогон системы на ~50 кейсах из SM_2025 (которые уже прошли первый раунд).
- Метрики:
  - **Medal accuracy**: совпадает ли медальная категория AI с фактической решением жюри.
  - **Score MAE**: средняя абсолютная разница между AI-баллом и медианой судей.
  - **Distribution variance**: AI должен использовать диапазон 1–10, не сжиматься к 6–7.
- Slice-анализ: image-heavy vs text-heavy кейсы, социально-ориентированные vs общие, по блокам.
- Если medal accuracy <70% в топ-3 блоках или score MAE >1.5 — итерация по anchor-примерам и системному промпту до выхода на цель.

**Deliverable**: `benchmark.ts`, отчёт с рекомендациями.

---

## 3. Схема БД (Supabase Postgres)

### Основные таблицы

```sql
-- Пользователи и роли
users (id, email, name, role, created_at, invited_by)
-- role: 'admin' | 'moderator' | 'observer'

-- Кейсы
cases (id, project_id, project_name, nomination_code, block_id, year,
       project_info, project_strategy, project_results, project_realisation,
       project_channels, project_insight, project_audience, project_targets,
       presentation_pdf_url, results_file_url, video_link_url,
       uploaded_by, uploaded_at, status)
-- status: 'uploaded' | 'parsing' | 'parsed' | 'scoring' | 'scored' |
--         'script_pending' | 'script_approved' | 'rendering' |
--         'ready' | 'failed'

-- Извлечённое содержимое (Evidence Index)
evidence (id, case_id, source_type, source_ref, text, page_or_timestamp,
          hash, created_at)
-- source_type: 'form_field' | 'pdf_text' | 'pdf_vision' | 'video_transcript'

-- Вердикты
verdicts (id, case_id, total_score, medal_band, criteria_scores_json,
          arguments_json, evidence_ids_json,
          input_hash, methodology_hash, anchors_hash, prompt_hash,
          model_id, created_at)

-- Скрипты вердикта и Q&A анкоров
scripts (id, verdict_id, kind, text, status, edited_by, edited_at,
         approved_by, approved_at, prompt_hash)
-- kind: 'verdict' | 'qa_results' | 'qa_idea' | 'qa_strategy' | ...
-- status: 'pending_review' | 'approved' | 'rejected'

-- Рендеры
renders (id, script_id, mp4_url, mp4_hash, heygen_job_id,
         status, render_attempt, fallback_used, created_at)
-- status: 'queued' | 'rendering' | 'ready' | 'failed' | 'degraded'
-- fallback_used: bool (TTS-only fallback применён)

-- Сессии Zoom
sessions (id, name, date, assigned_moderator_id, created_by, status)
-- status: 'draft' | 'ready' | 'live' | 'ended'

-- Распределение кейсов по сессиям
session_cases (id, session_id, case_id, order_index)

-- Аудит
audit_log (id, user_id, session_id, case_id, action, payload_hash, timestamp)
```

### Storage buckets
- `cases-source/` — оригинальные PDF/DOCX/JSON загрузки.
- `cases-derived/` — скачанные по ссылкам PDF и видео.
- `renders/` — финальные MP4 с overlay.
- `exports/` — zip-архивы для передачи организаторам.

---

## 4. Минимальный JSON-формат вердикта (контракт)

```json
{
  "case_id": "...",
  "block_id": 50,
  "nomination_code": "A01",
  "is_socially_oriented": false,
  "criteria_scores": [
    {
      "criterion": "challenge",
      "weight": 0.20,
      "score": 7,
      "band": "high",
      "strengths": [
        { "text": "...", "evidence_id": "..." }
      ],
      "weaknesses": [
        { "text": "...", "evidence_id": "..." }
      ],
      "rationale": "..."
    },
    /* остальные критерии блока */
  ],
  "social_score": null,
  "total_score": 6.45,
  "medal_band": "bronze",
  "summary_argument": "...",
  "reproducibility": {
    "input_hash": "...",
    "methodology_hash": "...",
    "anchors_hash": "...",
    "prompt_hash": "...",
    "model_id": "claude-sonnet-4-6",
    "created_at": "..."
  }
}
```

---

## 5. Порядок исполнения

Фазы 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10.

Параллелизация:
- Фаза 1 и Фаза 2 — независимы, можно вести параллельно.
- Фаза 7 (admin sessions) и Фаза 8 (moderator console) — независимы после Фазы 5.
- Фаза 10 (benchmark) — гонится в фоне начиная с конца Фазы 3.

---

## 6. Что НЕ делаем (зафиксированный negative scope)

- L1 (longlist gate).
- Калибровка под историческое распределение.
- Retrieval похожих кейсов.
- Anonymity scanner.
- Conflict-of-interest механизм.
- Live Q&A с аватаром.
- Recall.ai bot и отдельное Zoom-участие аватара.
- Self-service регистрация.
- Real-time LLM-вызовы во время Zoom-сессии.
- Поддержка английского языка.
- Поддержка дебатов / открытого диалога с аватаром.
