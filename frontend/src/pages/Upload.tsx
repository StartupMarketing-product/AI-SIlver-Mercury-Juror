import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/auth";

const API_URL = import.meta.env.VITE_API_URL ?? "";

export default function Upload() {
  const navigate = useNavigate();
  const [caseId, setCaseId] = useState<string | null>(null);
  const [evaluationId, setEvaluationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = API_URL ? API_URL.replace(/\/$/, "") : "";

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setCaseId(null);
    setEvaluationId(null);
    const form = e.currentTarget;
    const formData = new FormData(form);

    setLoading(true);
    try {
      const r1 = await apiFetch(`${base}/api/cases/upload`, {
        method: "POST",
        body: formData,
      });
      if (!r1.ok) {
        const err = await r1.json().catch(() => ({}));
        throw new Error(err.error || r1.statusText);
      }
      const { case_id } = await r1.json();
      setCaseId(case_id);

      const r2 = await apiFetch(`${base}/api/analyze-case`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ case_id }),
      });
      if (!r2.ok) {
        const err = await r2.json().catch(() => ({}));
        throw new Error(err.error || r2.statusText);
      }
      const { evaluation_id } = await r2.json();
      setEvaluationId(evaluation_id);
      // Always open the exact fresh result to avoid selecting stale evaluations.
      navigate(`/results?evaluation=${evaluation_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1>Загрузка кейса</h1>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 560 }}>
        <label>
          Название проекта *
          <input name="project_name" required style={{ display: "block", width: "100%", marginTop: 4 }} />
        </label>
        <label>
          ID проекта
          <input name="project_id" placeholder="например 5784" style={{ display: "block", width: "100%", marginTop: 4 }} />
        </label>
        <label>
          Номинация (ID)
          <input
            name="nomination_id"
            placeholder="например 994; можно оставить пустым — попробуем определить по проекту"
            style={{ display: "block", width: "100%", marginTop: 4 }}
          />
        </label>
        <label>
          Блок (ID)
          <input name="block_id" defaultValue="50" style={{ display: "block", width: "100%", marginTop: 4 }} />
        </label>
        <label>
          Год
          <input name="year" defaultValue="2025" style={{ display: "block", width: "100%", marginTop: 4 }} />
        </label>
        <label>
          Описание / контекст
          <textarea name="project_info" rows={3} style={{ display: "block", width: "100%", marginTop: 4 }} />
        </label>
        <label>
          Результаты (текст)
          <textarea name="project_results" rows={3} style={{ display: "block", width: "100%", marginTop: 4 }} placeholder="Опишите результаты, цифры, метрики" />
        </label>
        <label>
          Стратегия
          <textarea name="project_strategy" rows={2} style={{ display: "block", width: "100%", marginTop: 4 }} />
        </label>
        <label>
          Файлы (PDF/PPTX) — опционально
          <input type="file" name="files" multiple accept=".pdf,.pptx" style={{ display: "block", marginTop: 4 }} />
        </label>
        {error && <p style={{ color: "crimson" }}>{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? "Загрузка и анализ…" : "Загрузить и запустить анализ"}
        </button>
      </form>
      {caseId && (
        <p style={{ marginTop: "1rem" }}>
          Кейс: <code>{caseId}</code>
          {evaluationId && (
            <>
              {" "}
              · Оценка: <code>{evaluationId}</code> — <Link to={`/results?evaluation=${evaluationId}`}>перейти к результату</Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}
