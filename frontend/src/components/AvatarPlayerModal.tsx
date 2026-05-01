import { useEffect, useRef, useState } from "react";

/**
 * Full-screen modal for the moderator's "Активировать ИИ жюри" action.
 *
 * Layout: split-screen "presentation mode".
 *   - Left ~65%: avatar video (or fallback speech text)
 *   - Right ~35%: scoreboard panel — project name, award badge, total score,
 *     per-criterion bars
 *
 * Sequence:
 *   1. Dark overlay fades in
 *   2. Staged popup messages cycle for ~7 seconds (theatre — masks the fact
 *      that the video was pre-rendered)
 *   3. Video plays + scoreboard appears together (the audience sees the
 *      breakdown alongside the avatar's spoken verdict)
 *   4. On video end (or close), the overlay fades out and onClose() fires
 */

const STAGED_MESSAGES_RU = [
  "Анализирую кейс…",
  "Изучаю стратегию и результаты…",
  "Готовлю выступление…",
];

const STAGE_DURATION_MS = 2300; // each message visible ~2.3s; total ~7s

type AwardLevel = "gold" | "silver" | "bronze" | "shortlist" | "longlist";

const AWARD_RU: Record<AwardLevel, string> = {
  gold: "Золото",
  silver: "Серебро",
  bronze: "Бронза",
  shortlist: "Шорт-лист",
  longlist: "Лонг-лист",
};

const AWARD_COLOR: Record<AwardLevel, string> = {
  gold: "#c89b1a",
  silver: "#9aa3ad",
  bronze: "#b8763f",
  shortlist: "#5a6675",
  longlist: "#7c8794",
};

const CRITERION_RU: Record<string, string> = {
  strategy: "Стратегия",
  idea: "Идея",
  execution: "Исполнение",
  results: "Результаты",
  challenge: "Вызов",
  social_outcomes: "Социальный результат",
};

interface CriterionScore {
  criterion: string;
  score: number;
}

interface ScoreboardData {
  award_level: AwardLevel;
  total_score: number;
  block_score?: number;
  criteria_scores: CriterionScore[];
  nomination_code?: string;
}

interface Props {
  open: boolean;
  videoUrl: string | null;
  speechFallback?: string;
  projectName?: string;
  /** When provided, shows the scoreboard panel alongside the video. */
  scoreboard?: ScoreboardData | null;
  onClose: () => void;
}

export default function AvatarPlayerModal({
  open,
  videoUrl,
  speechFallback,
  projectName,
  scoreboard,
  onClose,
}: Props) {
  const [stage, setStage] = useState<"messages" | "video" | "fallback">("messages");
  const [messageIdx, setMessageIdx] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // When opening, reset to first stage and cycle messages, then transition.
  useEffect(() => {
    if (!open) return;
    setStage("messages");
    setMessageIdx(0);

    const cycle = setInterval(() => {
      setMessageIdx((prev) => {
        const next = prev + 1;
        if (next >= STAGED_MESSAGES_RU.length) {
          clearInterval(cycle);
          if (videoUrl) setStage("video");
          else setStage("fallback");
          return prev;
        }
        return next;
      });
    }, STAGE_DURATION_MS);

    return () => clearInterval(cycle);
  }, [open, videoUrl]);

  // Try to autoplay video once stage flips to "video"
  useEffect(() => {
    if (stage !== "video") return;
    const v = videoRef.current;
    if (!v) return;
    v.play().catch(() => {
      v.muted = true;
      v.play().catch(() => {/* user must click play control */});
    });
  }, [stage]);

  // Keyboard: Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  // Show the scoreboard alongside the video / fallback (NOT during messages
  // stage — the staged "Анализирую…" theatre should be uncluttered, the
  // reveal happens when stage flips to video).
  const showScoreboard = scoreboard && stage !== "messages";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Выступление ИИ-жюри"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.96)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        animation: "avatar-fade 220ms ease-out",
      }}
    >
      <style>{`
        @keyframes avatar-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes pulse-dot {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
        @keyframes scoreboard-in {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes bar-grow {
          from { transform: scaleX(0); }
          to { transform: scaleX(1); }
        }
      `}</style>

      <button
        onClick={onClose}
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          background: "transparent",
          color: "#888",
          border: "1px solid #444",
          borderRadius: 4,
          padding: "4px 10px",
          fontSize: "0.85rem",
          cursor: "pointer",
          zIndex: 10,
        }}
      >
        Закрыть · Esc
      </button>

      {projectName && stage === "messages" && (
        <div
          style={{
            position: "absolute",
            top: 36,
            color: "#777",
            fontSize: "0.95rem",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
          }}
        >
          {projectName}
        </div>
      )}

      {/* Stage: staged messages (theatre) */}
      {stage === "messages" && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 32,
          }}
        >
          <div style={{ display: "flex", gap: 12 }}>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  background: "#fff",
                  display: "inline-block",
                  animation: "pulse-dot 1.4s ease-in-out infinite",
                  animationDelay: `${i * 0.16}s`,
                }}
              />
            ))}
          </div>
          <div
            key={messageIdx}
            style={{
              color: "#fff",
              fontSize: "2rem",
              fontWeight: 300,
              letterSpacing: "0.01em",
              animation: "avatar-fade 600ms ease-out",
              textAlign: "center",
              maxWidth: "70vw",
            }}
          >
            {STAGED_MESSAGES_RU[messageIdx]}
          </div>
        </div>
      )}

      {/* Stage: video + scoreboard split-screen */}
      {(stage === "video" || stage === "fallback") && (
        <div
          style={{
            display: "flex",
            gap: "2.5vw",
            alignItems: "center",
            justifyContent: "center",
            width: "92vw",
            maxWidth: 1700,
            height: "85vh",
          }}
        >
          {/* Left: video or speech-text fallback */}
          <div
            style={{
              flex: showScoreboard ? "0 1 65%" : "1 1 100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              maxHeight: "85vh",
            }}
          >
            {stage === "video" && videoUrl ? (
              <video
                ref={videoRef}
                src={videoUrl}
                onEnded={onClose}
                onContextMenu={(e) => e.preventDefault()}
                playsInline
                disablePictureInPicture
                controlsList="nodownload nofullscreen noremoteplayback noplaybackrate"
                style={{
                  width: "100%",
                  maxHeight: "85vh",
                  background: "#000",
                  borderRadius: 8,
                  boxShadow: "0 30px 100px rgba(0,0,0,0.7)",
                  pointerEvents: "none", // no scrubbing / pause — keep the live illusion
                }}
              />
            ) : (
              <div
                style={{
                  background: "#1a1a1a",
                  color: "#eee",
                  border: "1px solid #333",
                  borderRadius: 8,
                  padding: "2rem",
                  maxWidth: "100%",
                  maxHeight: "85vh",
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                }}
              >
                <div style={{ color: "#888", fontSize: "0.85rem", letterSpacing: "0.04em" }}>
                  ВИДЕО НЕДОСТУПНО — ТЕКСТ ВЫСТУПЛЕНИЯ
                </div>
                {projectName && (
                  <h2 style={{ margin: 0, fontSize: "1.3rem", color: "#fff", fontWeight: 500 }}>
                    {projectName}
                  </h2>
                )}
                <p style={{ margin: 0, lineHeight: 1.6, fontSize: "1.05rem", whiteSpace: "pre-wrap" }}>
                  {speechFallback?.trim() || "(текст выступления отсутствует)"}
                </p>
              </div>
            )}
          </div>

          {/* Right: scoreboard panel */}
          {showScoreboard && scoreboard && (
            <Scoreboard
              projectName={projectName}
              data={scoreboard}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** The presentation-style scoreboard. Renders the project, award, total score
 *  and per-criterion bars in a clean, screen-share-friendly card. */
function Scoreboard({ projectName, data }: { projectName?: string; data: ScoreboardData }) {
  const awardColor = AWARD_COLOR[data.award_level];
  const awardName = AWARD_RU[data.award_level];

  return (
    <aside
      style={{
        flex: "0 1 35%",
        maxWidth: 520,
        background: "#15171a",
        border: "1px solid #2a2d33",
        borderRadius: 12,
        padding: "28px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 22,
        animation: "scoreboard-in 600ms ease-out",
        boxShadow: "0 20px 80px rgba(0,0,0,0.5)",
        maxHeight: "85vh",
        overflow: "hidden",
      }}
    >
      {/* Project name + nomination */}
      <header style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {data.nomination_code && (
          <div style={{ color: "#888", fontSize: "0.78rem", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Номинация {data.nomination_code}
          </div>
        )}
        {projectName && (
          <h2
            style={{
              margin: 0,
              fontSize: "1.05rem",
              fontWeight: 500,
              color: "#eee",
              lineHeight: 1.35,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {projectName}
          </h2>
        )}
      </header>

      {/* Award + score */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          padding: "20px 18px",
          background: "#0d0e10",
          borderRadius: 10,
          border: `1px solid ${awardColor}33`,
        }}
      >
        <div
          style={{
            display: "inline-block",
            padding: "4px 14px",
            borderRadius: 999,
            background: awardColor,
            color: "#0d0e10",
            fontSize: "0.85rem",
            fontWeight: 700,
            letterSpacing: "0.05em",
            alignSelf: "flex-start",
          }}
        >
          {awardName}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ color: "#fff", fontSize: "3rem", fontWeight: 300, lineHeight: 1 }}>
            {data.total_score?.toFixed(1)}
          </span>
          <span style={{ color: "#777", fontSize: "1.1rem" }}>/ 10</span>
        </div>
      </div>

      {/* Per-criterion bars */}
      <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ color: "#888", fontSize: "0.78rem", letterSpacing: "0.1em", textTransform: "uppercase" }}>
          По критериям
        </div>
        {data.criteria_scores.map((c, i) => {
          const pct = Math.max(4, (c.score / 10) * 100);
          const ru = CRITERION_RU[c.criterion] ?? c.criterion;
          return (
            <div key={c.criterion} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ color: "#ccc", fontSize: "0.92rem" }}>{ru}</span>
                <span style={{ color: "#fff", fontWeight: 600, fontSize: "1rem" }}>
                  {c.score?.toFixed(1)}
                </span>
              </div>
              <div
                style={{
                  height: 6,
                  background: "#23262b",
                  borderRadius: 999,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${pct}%`,
                    height: "100%",
                    background: awardColor,
                    transformOrigin: "left",
                    animation: `bar-grow 700ms cubic-bezier(0.2, 0.8, 0.3, 1) ${i * 80}ms both`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </section>
    </aside>
  );
}
