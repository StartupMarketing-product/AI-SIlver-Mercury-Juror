# Синтетический ИИ‑жюри Silver Mercury

Веб‑приложение и API для синтетического члена жюри фестиваля Silver Mercury: анализ кейсов, оценка (L1/L2), аргументация и представление вердикта через аватар.

Полный план: [SYNTHETIC_JURY_IMPLEMENTATION_PLAN.md](SYNTHETIC_JURY_IMPLEMENTATION_PLAN.md).

## Структура репозитория

- **backend/** — Core API (Node.js, Express): методология, загрузка кейсов, анализ, оценки, аватар.
- **frontend/** — SPA (React, TypeScript, Vite): интерфейс модератора, загрузка, результаты, представление вердикта.
- Корень — данные (SM_2025.json), методология, правила жюри, скрипты анализа.

## Запуск локально

### Backend

```bash
cd backend
npm install
npm run dev
```

API: http://localhost:3002  
Эндпоинты: `GET /health`, `GET /api/config/methodology`, `POST /api/cases/upload`, `POST /api/analyze-case`, `GET /api/evaluations/:id` (часть пока заглушки).

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Интерфейс: http://localhost:5173  
В режиме dev запросы к `/api` и `/health` проксируются на backend (см. vite.config.ts).

### Переменные окружения

- **backend:** `PORT` (по умолчанию 3001), `CORS_ORIGIN` (для продакшена).
- **frontend:** `VITE_API_URL` — базовый URL API (для деплоя на Netlify/Vercel оставьте пустым или укажите URL бэкенда).

## Деплой (по плану)

- **Frontend:** Netlify или Vercel (сборка `npm run build`, публикация `dist/`).
- **Backend:** Render, Railway или Fly.io; БД и файловое хранилище — по плану в документе.

## Документы

- [SYNTHETIC_JURY_IMPLEMENTATION_PLAN.md](SYNTHETIC_JURY_IMPLEMENTATION_PLAN.md) — план и архитектура
- [ai_judge_guidelines.md](ai_judge_guidelines.md) — правила поведения жюри
