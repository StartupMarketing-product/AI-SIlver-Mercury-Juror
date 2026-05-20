import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/auth";

const API_URL = import.meta.env.VITE_API_URL ?? "";
const base = API_URL.replace(/\/$/, "");

/**
 * Inline editor for one avatar summary speech — used in the Grand Moderator
 * console. Handles the GREETING row and each nomination summary (D10/D13/D15).
 *
 * Capabilities:
 *   - edit the speech text and save it
 *   - (nominations only) regenerate the speech from verdicts
 *   - render / re-render the HeyGen avatar video
 *   - auto-poll while a render is in flight
 *
 * Backend endpoints reused as-is:
 *   GET   /api/nominations/:code/summary
 *   PATCH /api/admin/nominations/:code/summary/speech
 *   POST  /api/admin/nominations/:code/summary/generate
 *   POST  /api/admin/nominations/:code/summary/render
 */
interface Props {
  /** Summary code — "GREETING", "D10", "D13", "D15". */
  code: string;
  /** Human-readable label shown as the panel heading. */
  label: string;
  /** Show the "Сгенерировать речь" button (nominations have verdicts to build
   *  from; the GREETING text is hand-written, so it has no generate step). */
  allowGenerate?: boolean;
}

type Busy = null | "save" | "generate" | "render";

export default function SummaryEditor({ code, label, allowGenerate = false }: Props) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const pollRef = useRef<number | null>(null);

  function refresh() {
    return fetch(`${base}/api/nominations/${code}/summary`)
      .then((r) => r.json())
      .then((j) => {
        const s = j?.summary;
        if (s) {
          setText(s.speech_text ?? "");
          setStatus(s.avatar_status ?? null);
          setVideoUrl(s.avatar_video_url ?? null);
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // Auto-poll while rendering.
  useEffect(() => {
    if (status !== "rendering") return;
    pollRef.current = window.setInterval(() => {
      fetch(`${base}/api/nominations/${code}/summary`)
        .then((r) => r.json())
        .then((j) => {
          const s = j?.summary;
          if (!s) return;
          setStatus(s.avatar_status);
          setVideoUrl(s.avatar_video_url ?? null);
          if (s.avatar_status === "ready") setMsg("Видео готово.");
          else if (s.avatar_status === "failed") setMsg(`Ошибка: ${s.avatar_error ?? "render failed"}`);
        })
        .catch(() => {});
    }, 8000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [code, status]);

  async function handleSave() {
    const t = text.trim();
    if (!t) {
      setMsg("Текст не может быть пустым.");
      return;
    }
    setBusy("save");
    setMsg(null);
    try {
      const r = await apiFetch(`${base}/api/admin/nominations/${code}/summary/speech`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speech_text: t }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.detail ?? body?.error ?? `HTTP ${r.status}`);
      setStatus(body.summary?.avatar_status ?? "pending");
      setVideoUrl(body.summary?.avatar_video_url ?? null);
      setMsg("Текст сохранён. Нажмите «Сгенерировать видео» для перерендера.");
    } catch (e) {
      setMsg(`Сохранение не удалось: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function handleGenerate() {
    if (text.trim() && !window.confirm("Сгенерировать речь заново? Текущий текст будет заменён.")) {
      return;
    }
    setBusy("generate");
    setMsg(null);
    try {
      const r = await apiFetch(`${base}/api/admin/nominations/${code}/summary/generate`, {
        method: "POST",
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.detail ?? body?.error ?? `HTTP ${r.status}`);
      setText(body.summary?.speech_text ?? "");
      setStatus(body.summary?.avatar_status ?? "pending");
      setMsg("Речь сгенерирована. Нажмите «Сгенерировать видео».");
    } catch (e) {
      setMsg(`Генерация не удалась: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function handleRender() {
    if (status === "ready" && !window.confirm(
      "Видео уже сгенерировано. Запустить рендер заново? Это потратит кредиты HeyGen и заменит текущее видео."
    )) return;
    setBusy("render");
    setMsg(null);
    try {
      const r = await apiFetch(`${base}/api/admin/nominations/${code}/summary/render`, {
        method: "POST",
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.detail ?? body?.error ?? `HTTP ${r.status}`);
      setStatus("rendering");
      setMsg("Видео рендерится в HeyGen. Опрос статуса каждые 8 секунд…");
    } catch (e) {
      setMsg(`Рендер не удалось запустить: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  const btnBase: React.CSSProperties = {
    flex: "1 1 auto",
    padding: "8px 10px",
    borderRadius: 6,
    fontSize: "0.8rem",
    cursor: busy ? "wait" : "pointer",
  };

  return (
    <section style={{ marginBottom: 18, padding: 12, border: "1px dashed var(--border-strong)", borderRadius: 6 }}>
      <div style={{ fontSize: "0.85rem", marginBottom: 8, color: "var(--fg-secondary)" }}>
        {label}
      </div>
      {!loaded ? (
        <div style={{ fontSize: "0.8rem", color: "var(--fg-tertiary)" }}>Загрузка…</div>
      ) : (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            disabled={busy !== null}
            style={{
              width: "100%",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid var(--border-subtle)",
              color: "var(--fg-primary)",
              padding: "8px 10px",
              borderRadius: 6,
              fontSize: "0.82rem",
              fontFamily: "inherit",
              lineHeight: 1.5,
              resize: "vertical",
              boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            <button
              onClick={handleSave}
              disabled={busy !== null}
              style={{
                ...btnBase,
                background: "rgba(255,255,255,0.06)",
                color: "var(--fg-primary)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              {busy === "save" ? "Сохраняем…" : "Сохранить текст"}
            </button>
            {allowGenerate && (
              <button
                onClick={handleGenerate}
                disabled={busy !== null}
                style={{
                  ...btnBase,
                  background: "rgba(255,255,255,0.06)",
                  color: "var(--fg-primary)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                {busy === "generate" ? "Генерируем…" : "Сгенерировать речь"}
              </button>
            )}
            <button
              onClick={handleRender}
              disabled={busy !== null || status === "rendering" || !text.trim()}
              style={{
                ...btnBase,
                background: "var(--accent-cyan)",
                color: "var(--fg-on-light)",
                border: "none",
                fontWeight: 500,
                opacity: busy || status === "rendering" || !text.trim() ? 0.55 : 1,
              }}
            >
              {busy === "render"
                ? "Отправляем…"
                : status === "rendering"
                ? "Рендерится…"
                : status === "ready"
                ? "Сгенерировать заново"
                : "Сгенерировать видео"}
            </button>
          </div>
          <div style={{ marginTop: 6, fontSize: "0.75rem", color: "var(--fg-tertiary)" }}>
            Статус: {status === "ready" ? "готово" : status === "rendering" ? "рендерится" : status === "failed" ? "ошибка" : "—"}
            {videoUrl && status === "ready" && (
              <>
                {" · "}
                <a href={videoUrl} target="_blank" rel="noreferrer" style={{ color: "var(--accent-cyan)" }}>
                  открыть видео
                </a>
              </>
            )}
          </div>
          {msg && (
            <div style={{ marginTop: 6, fontSize: "0.78rem", color: "var(--accent-mint)" }}>{msg}</div>
          )}
        </>
      )}
    </section>
  );
}
