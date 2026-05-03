import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

const API_URL = import.meta.env.VITE_API_URL ?? "";

const CATEGORIES = [
  { code: "D01", name: "Лучшая цифровая кампания", accent: "var(--accent-cyan)" },
  { code: "D10", name: "Лучшее использование ИИ", accent: "var(--accent-purple)" },
  { code: "D13", name: "Лучшее использование данных", accent: "var(--accent-magenta)" },
  { code: "D15", name: "Лучшая цифровая платформа", accent: "var(--accent-mint)" },
];

/**
 * Landing page in the sbermarketing.ru visual language: dark canvas, big
 * confident headline split across rounded chips, then two ranks of cards —
 * Grand Moderator console and per-category Moderator entry points.
 */
export default function Home() {
  const [health, setHealth] = useState<{ ok?: boolean } | null>(null);

  useEffect(() => {
    const url = API_URL ? `${API_URL.replace(/\/$/, "")}/health` : "/health";
    fetch(url).then((r) => r.json()).then(setHealth).catch(() => setHealth({ ok: false }));
  }, []);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      {/* Hero — chip-style headline echoing the Sber "Больше / чем / маркетинг" composition */}
      <section style={{ padding: "60px 0 56px" }}>
        <ChipHeadline />
        <p
          style={{
            color: "var(--fg-secondary)",
            fontSize: "1.05rem",
            maxWidth: 560,
            margin: "20px 0 0",
            lineHeight: 1.55,
          }}
        >
          Синтетический член жюри Silver Mercury XXVII. Подготавливает оценки,
          речи и видео-выступления для четырёх цифровых номинаций.
        </p>
      </section>

      {/* Grand Moderator — single hero card */}
      <section style={{ marginBottom: 36 }}>
        <SectionLabel>Главный модератор</SectionLabel>
        <Link
          to="/grand"
          className="card"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            color: "var(--fg-primary)",
            padding: "28px 28px",
            background: "linear-gradient(135deg, rgba(159,102,255,0.18), rgba(63,174,255,0.10) 60%, transparent)",
            border: "1px solid var(--border-strong)",
          }}
        >
          <div>
            <div style={{ fontSize: "1.4rem", fontWeight: 700, marginBottom: 6 }}>
              Консоль главного модератора
            </div>
            <div style={{ color: "var(--fg-secondary)", maxWidth: 600, lineHeight: 1.5 }}>
              Загрузка JSON, проверка оценок, утверждение и отправка речей в продакшн видео.
            </div>
          </div>
          <ArrowCircle />
        </Link>
      </section>

      {/* Moderator categories — 4-up grid */}
      <section style={{ marginBottom: 36 }}>
        <SectionLabel>Модератор · сессионный режим</SectionLabel>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 14,
          }}
        >
          {CATEGORIES.map((c) => (
            <Link
              key={c.code}
              to={`/moderator/${c.code}`}
              className="card"
              style={{
                color: "var(--fg-primary)",
                display: "flex",
                flexDirection: "column",
                gap: 16,
                padding: "20px 22px",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  width: 120,
                  height: 120,
                  right: -30,
                  top: -30,
                  borderRadius: "50%",
                  background: `radial-gradient(circle, ${c.accent}33, transparent 70%)`,
                  filter: "blur(20px)",
                }}
              />
              <span
                className="chip"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  color: c.accent,
                  alignSelf: "flex-start",
                }}
              >
                {c.code}
              </span>
              <div style={{ fontSize: "1.05rem", fontWeight: 600, lineHeight: 1.3, position: "relative" }}>
                {c.name}
              </div>
              <div style={{ color: "var(--fg-secondary)", fontSize: "0.85rem", position: "relative" }}>
                Запуск ИИ-жюри во время обсуждения
              </div>
            </Link>
          ))}
        </div>
      </section>

      <p style={{ fontSize: "0.78rem", color: "var(--fg-tertiary)", marginTop: 32 }}>
        API: {health?.ok ? "подключён" : health === null ? "проверка…" : "не доступен"}
      </p>
    </div>
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

/** "Больше / чем / маркетинг"-style chip composition. Three chunks rendered
 *  as overlapping pill chips with mixed white / dark backgrounds. */
function ChipHeadline() {
  const baseChip: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    padding: "12px 28px",
    borderRadius: "var(--radius-pill)",
    fontSize: "clamp(2.4rem, 6vw, 4.2rem)",
    fontWeight: 800,
    lineHeight: 1,
    letterSpacing: "-0.02em",
  };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
      <span style={{ ...baseChip, background: "#fff", color: "var(--fg-on-light)" }}>
        ИИ
      </span>
      <span
        style={{
          ...baseChip,
          background: "rgba(255,255,255,0.06)",
          color: "#fff",
          border: "1px solid var(--border-subtle)",
        }}
      >
        Жюри
      </span>
      <span
        style={{
          ...baseChip,
          background: "linear-gradient(135deg, var(--accent-purple), var(--accent-cyan))",
          color: "#fff",
        }}
      >
        Silver Mercury
      </span>
    </div>
  );
}

/** Bright cyan circle with arrow — the Sber "Узнать больше" CTA visual. */
function ArrowCircle() {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 56,
        height: 56,
        borderRadius: "50%",
        background: "var(--accent-cyan)",
        color: "var(--fg-on-light)",
        flexShrink: 0,
      }}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="5" y1="12" x2="19" y2="12" />
        <polyline points="12 5 19 12 12 19" />
      </svg>
    </span>
  );
}
