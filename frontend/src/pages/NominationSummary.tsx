import { useEffect, useState, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { apiFetch } from "../lib/auth";

const API_URL = import.meta.env.VITE_API_URL ?? "";
const base = API_URL.replace(/\/$/, "");

interface Summary {
  id: string;
  nomination_code: string;
  speech_text: string | null;
  heygen_video_id: string | null;
  avatar_video_url: string | null;
  avatar_status: "pending" | "rendering" | "ready" | "failed";
  avatar_error: string | null;
  speech_generated_at: string | null;
}

const CATEGORY_NAMES: Record<string, string> = {
  D01: "Лучшая цифровая кампания",
  D10: "Лучшее использование ИИ",
  D13: "Лучшее использование данных",
  D15: "Лучшая цифровая платформа",
};

/**
 * Nomination-level summary page: shows the generated cohort speech text and,
 * once rendered, the avatar video. Auto-polls for video status while a render
 * is in flight.
 */
export default function NominationSummary() {
  const { code: rawCode } = useParams<{ code: string }>();
  const code = (rawCode ?? "").toUpperCase();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "generate" | "render">(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  function load() {
    fetch(`${base}/api/nominations/${code}/summary`)
      .then((r) => r.json())
      .then((j) => {
        setSummary(j?.summary ?? null);
        setLoading(false);
      })
      .catch((e) => {
        setError(`Не удалось получить данные: ${String((e as Error).message)}`);
        setLoading(false);
      });
  }

  useEffect(() => {
    load();
  }, [code]);

  // Auto-poll while rendering
  useEffect(() => {
    if (summary?.avatar_status === "rendering") {
      pollRef.current = window.setInterval(load, 8000);
      return () => {
        if (pollRef.current) window.clearInterval(pollRef.current);
        pollRef.current = null;
      };
    }
    return;
  }, [summary?.avatar_status]);

  async function handleGenerate() {
    if (
      summary?.speech_text &&
      !window.confirm("Сгенерировать речь заново? Текущий текст и видео будут заменены.")
    ) {
      return;
    }
    setBusy("generate");
    setError(null);
    try {
      const r = await apiFetch(`${base}/api/admin/nominations/${code}/summary/generate`, {
        method: "POST",
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.detail ?? body?.error ?? `HTTP ${r.status}`);
      setSummary(body.summary);
    } catch (e) {
      setError(`Генерация не удалась: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function handleRender() {
    if (
      summary?.avatar_status === "ready" &&
      !window.confirm(
        "Видео уже сгенерировано. Запустить рендер заново? Это потратит кредиты HeyGen и заменит текущее видео."
      )
    ) {
      return;
    }
    setBusy("render");
    setError(null);
    try {
      const r = await apiFetch(`${base}/api/admin/nominations/${code}/summary/render`, {
        method: "POST",
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.detail ?? body?.error ?? `HTTP ${r.status}`);
      load();
    } catch (e) {
      setError(`Рендер не удалось запустить: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  const wordCount = (summary?.speech_text ?? "").split(/\s+/).filter(Boolean).length;
  const estimatedMinutes = wordCount > 0 ? (wordCount / 150).toFixed(1) : null; // ~150 слов/мин

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 0" }}>
      <div style={{ marginBottom: 18 }}>
        <Link to="/" style={{ color: "var(--fg-tertiary)", fontSize: "0.9rem" }}>
          ← Главная
        </Link>
      </div>

      <h1 style={{ margin: "0 0 6px", fontSize: "2rem", fontWeight: 800 }}>
        Сводное выступление по номинации
      </h1>
      <div style={{ color: "var(--fg-secondary)", fontSize: "1.05rem", marginBottom: 24 }}>
        {code} · {CATEGORY_NAMES[code] ?? "(номинация)"}
      </div>

      {error && (
        <div
          style={{
            background: "rgba(255, 80, 80, 0.10)",
            border: "1px solid rgba(255,80,80,0.4)",
            color: "#ffb0b0",
            padding: "12px 16px",
            borderRadius: 8,
            marginBottom: 20,
          }}
        >
          {error}
        </div>
      )}

      {loading && <p>Загрузка…</p>}

      {!loading && (
        <>
          {/* Action buttons */}
          <section style={{ marginBottom: 24, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button
              onClick={handleGenerate}
              disabled={busy !== null}
              style={{
                padding: "12px 22px",
                background: summary?.speech_text ? "rgba(255,255,255,0.08)" : "var(--fg-primary)",
                color: summary?.speech_text ? "var(--fg-primary)" : "var(--fg-on-light)",
                border: "1px solid var(--border-strong)",
                borderRadius: 8,
                fontSize: "0.95rem",
                fontWeight: 500,
                cursor: busy ? "wait" : "pointer",
              }}
            >
              {busy === "generate"
                ? "Генерируем речь…"
                : summary?.speech_text
                ? "Сгенерировать речь заново"
                : "Сгенерировать речь"}
            </button>
            <button
              onClick={handleRender}
              disabled={
                busy !== null ||
                !summary?.speech_text ||
                summary?.avatar_status === "rendering"
              }
              style={{
                padding: "12px 22px",
                background: "var(--accent-cyan)",
                color: "var(--fg-on-light)",
                border: "none",
                borderRadius: 8,
                fontSize: "0.95rem",
                fontWeight: 500,
                cursor:
                  busy || !summary?.speech_text || summary?.avatar_status === "rendering"
                    ? "default"
                    : "pointer",
                opacity:
                  busy || !summary?.speech_text || summary?.avatar_status === "rendering"
                    ? 0.5
                    : 1,
              }}
            >
              {busy === "render"
                ? "Отправляем в HeyGen…"
                : summary?.avatar_status === "rendering"
                ? "Видео рендерится…"
                : summary?.avatar_status === "ready"
                ? "Запустить рендер заново"
                : "Сгенерировать видео"}
            </button>
            {summary?.avatar_status === "rendering" && (
              <span style={{ alignSelf: "center", color: "var(--fg-tertiary)", fontSize: "0.9rem" }}>
                Опрос статуса каждые 8 секунд…
              </span>
            )}
          </section>

          {/* Video, if available */}
          {summary?.avatar_video_url && (
            <section style={{ marginBottom: 28 }}>
              <SectionLabel>Видео</SectionLabel>
              <video
                src={summary.avatar_video_url}
                controls
                playsInline
                style={{
                  width: "100%",
                  maxWidth: 900,
                  background: "#000",
                  borderRadius: 10,
                  boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
                }}
              />
            </section>
          )}

          {/* Speech text */}
          <section style={{ marginBottom: 28 }}>
            <SectionLabel>Текст выступления</SectionLabel>
            {summary?.speech_text ? (
              <div
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid var(--border-subtle)",
                  padding: "22px 26px",
                  borderRadius: 10,
                  lineHeight: 1.65,
                  fontSize: "1.02rem",
                  color: "var(--fg-primary)",
                  whiteSpace: "pre-wrap",
                }}
              >
                {summary.speech_text}
              </div>
            ) : (
              <p style={{ color: "var(--fg-tertiary)" }}>
                Речь ещё не сгенерирована. Нажмите «Сгенерировать речь».
              </p>
            )}
            {estimatedMinutes && (
              <p style={{ color: "var(--fg-tertiary)", fontSize: "0.85rem", marginTop: 10 }}>
                {wordCount} слов · ориентировочно {estimatedMinutes} минут чтения вслух
              </p>
            )}
          </section>

          {/* Status metadata */}
          <section style={{ color: "var(--fg-tertiary)", fontSize: "0.85rem" }}>
            {summary?.speech_generated_at && (
              <div>Сгенерировано: {new Date(summary.speech_generated_at).toLocaleString("ru-RU")}</div>
            )}
            {summary?.avatar_status && summary.avatar_status !== "pending" && (
              <div>
                Статус видео: {humanStatus(summary.avatar_status)}
                {summary.avatar_error && ` · ${summary.avatar_error}`}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function humanStatus(s: Summary["avatar_status"]): string {
  return (
    { pending: "не запускался", rendering: "рендерится", ready: "готово", failed: "ошибка" }[s] ?? s
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: "0.72rem",
        textTransform: "uppercase",
        letterSpacing: "0.18em",
        color: "var(--fg-tertiary)",
        marginBottom: 12,
      }}
    >
      {children}
    </div>
  );
}
