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
  // Stage flow: cinematic intro (two text moments + audio sting) → messages
  // theatre → video. Intro can be skipped via the SHOW_INTRO flag below.
  type Stage = "intro-1" | "intro-2" | "messages" | "video" | "fallback";
  const SHOW_INTRO = true;
  const INTRO_BEAT_MS = 2500; // each title beat
  const SKIP_MESSAGES_AFTER_INTRO = true; // dissolve straight into the verdict
  // After the avatar finishes speaking, freeze the last frame for this many
  // ms before closing — gives a "polished ending" beat instead of a hard cut.
  // Set to 0 to revert to the old immediate-close behaviour.
  const POST_VIDEO_HOLD_MS = 2000;

  const [stage, setStage] = useState<Stage>(SHOW_INTRO ? "intro-1" : "messages");
  const [messageIdx, setMessageIdx] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // When opening, reset to first stage and run the timeline.
  useEffect(() => {
    if (!open) return;
    setStage(SHOW_INTRO ? "intro-1" : "messages");
    setMessageIdx(0);

    // Prime the video element with the click-gesture activation. Without this,
    // by the time the ~5s intro finishes Chrome decides the activation lapsed
    // and v.play() rejects unless we mute it. Calling play()+pause() now —
    // while the modal-opening click is still "fresh" — tells Chrome we have
    // permission to play this specific <video> with sound later.
    const vEl = videoRef.current;
    if (vEl && videoUrl) {
      vEl.muted = false;
      vEl.volume = 1;
      vEl.play().then(() => vEl.pause()).catch(() => {/* primed best-effort */});
    }

    const timeouts: ReturnType<typeof setTimeout>[] = [];

    if (SHOW_INTRO) {
      // Try to play the intro audio. autoplay-with-sound may be blocked, in
      // which case the intro plays silent — text animations carry the moment.
      const a = audioRef.current;
      if (a) {
        a.currentTime = 0;
        a.volume = 0.85;
        a.play().catch(() => {
          a.muted = true;
          a.play().catch(() => { /* fully blocked — silent intro */ });
        });
      }
      // Beat 1 → Beat 2 → next stage
      timeouts.push(setTimeout(() => setStage("intro-2"), INTRO_BEAT_MS));
      timeouts.push(setTimeout(() => {
        // Cross-fade the audio out as the avatar starts speaking.
        const a2 = audioRef.current;
        if (a2) {
          let v = a2.volume;
          const fade = setInterval(() => {
            v = Math.max(0, v - 0.08);
            a2.volume = v;
            if (v <= 0.01) { clearInterval(fade); a2.pause(); }
          }, 80);
        }
        if (SKIP_MESSAGES_AFTER_INTRO) {
          if (videoUrl) setStage("video");
          else setStage("fallback");
        } else {
          setStage("messages");
        }
      }, INTRO_BEAT_MS * 2));
    }

    if (!SHOW_INTRO || !SKIP_MESSAGES_AFTER_INTRO) {
      // Staged messages theatre cycles when active.
      const cycle = setInterval(() => {
        setStage((s) => {
          if (s !== "messages") return s;
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
          return s;
        });
      }, STAGE_DURATION_MS);
      timeouts.push(cycle as unknown as ReturnType<typeof setTimeout>);
      return () => timeouts.forEach(clearTimeout);
    }

    return () => timeouts.forEach(clearTimeout);
  }, [open, videoUrl]);

  // Autoplay video once stage flips to "video". Because the video element is
  // primed (play+pause) during the open effect, Chrome has remembered our
  // permission to play it with sound, so this play() succeeds unmuted.
  useEffect(() => {
    if (stage !== "video") return;
    const v = videoRef.current;
    if (!v) return;
    v.muted = false;
    v.currentTime = 0;
    v.play().catch(() => {/* extremely unlikely after priming */});
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
        /* Cinematic intro — title scales up + glow swells, holds, fades out.
           Timed to 2.5s. Tweak %s if your audio sting peaks at a different beat. */
        @keyframes intro-title {
          0%   { opacity: 0; transform: scale(1.18); letter-spacing: 0.30em; filter: blur(8px); }
          22%  { opacity: 1; transform: scale(1.00); letter-spacing: 0.18em; filter: blur(0); }
          74%  { opacity: 1; transform: scale(1.02); letter-spacing: 0.20em; filter: blur(0); }
          100% { opacity: 0; transform: scale(0.96); letter-spacing: 0.18em; filter: blur(6px); }
        }
        @keyframes intro-glow {
          0%   { transform: scale(0.4); opacity: 0; }
          30%  { transform: scale(1);   opacity: 0.55; }
          70%  { transform: scale(1.4); opacity: 0.4;  }
          100% { transform: scale(2);   opacity: 0;    }
        }
        @keyframes intro-orb {
          0%   { transform: scale(0.2) rotate(0deg);   opacity: 0; }
          25%  { transform: scale(1)   rotate(120deg); opacity: 1; }
          85%  { transform: scale(1.1) rotate(360deg); opacity: 0.85; }
          100% { transform: scale(1.4) rotate(440deg); opacity: 0; }
        }
      `}</style>

      {/* Cinematic intro audio — sits as a hidden element so the same single
          MP3 can be reused on every modal open without re-fetching. */}
      <audio ref={audioRef} src="/intro.mp3" preload="auto" />

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

      {/* Stage: cinematic intro — two title beats with audio sting. */}
      {(stage === "intro-1" || stage === "intro-2") && (
        <IntroStage stage={stage} />
      )}

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

      {/* Always-mounted video element: kept in the DOM from the moment the
          modal opens (just visually hidden until stage === "video") so that
          the open-effect can prime it with the user-gesture activation. Hiding
          via opacity+pointerEvents instead of display:none / unmount because
          some browsers refuse to honour play() on display:none media. */}
      {videoUrl && (
        <div
          aria-hidden={stage !== "video"}
          style={{
            position: stage === "video" ? "relative" : "absolute",
            opacity: stage === "video" ? 1 : 0,
            pointerEvents: stage === "video" ? "auto" : "none",
            zIndex: stage === "video" ? 1 : -1,
            display: "flex",
            gap: "2.5vw",
            alignItems: "center",
            justifyContent: "center",
            width: "92vw",
            maxWidth: 1700,
            height: "85vh",
          }}
        >
          <div
            style={{
              flex: showScoreboard ? "0 1 65%" : "1 1 100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              maxHeight: "85vh",
            }}
          >
            <div
              style={{
                width: "100%",
                maxHeight: "85vh",
                borderRadius: 8,
                overflow: "hidden",
                background: "#000",
                boxShadow: "0 30px 100px rgba(0,0,0,0.7)",
                lineHeight: 0,
                clipPath: "inset(16px 16px 16px 16px)",
              }}
            >
              <video
                ref={videoRef}
                src={videoUrl}
                onEnded={() => {
                  if (POST_VIDEO_HOLD_MS > 0) {
                    setTimeout(onClose, POST_VIDEO_HOLD_MS);
                  } else {
                    onClose();
                  }
                }}
                onContextMenu={(e) => e.preventDefault()}
                playsInline
                preload="auto"
                disablePictureInPicture
                controlsList="nodownload nofullscreen noremoteplayback noplaybackrate"
                style={{
                  width: "100%",
                  maxHeight: "85vh",
                  background: "#000",
                  display: "block",
                  border: "none",
                  outline: "none",
                  transform: "scale(1.08)",
                  transformOrigin: "center center",
                  pointerEvents: "none",
                }}
              />
            </div>
          </div>

          {showScoreboard && scoreboard && stage === "video" && (
            <Scoreboard projectName={projectName} data={scoreboard} />
          )}
        </div>
      )}

      {/* Fallback (no video) — only shown when stage actually reaches the
          fallback state and there is no videoUrl to play. */}
      {stage === "fallback" && !videoUrl && (
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
          <div
            style={{
              flex: showScoreboard ? "0 1 65%" : "1 1 100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              maxHeight: "85vh",
            }}
          >
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
          </div>

          {showScoreboard && scoreboard && (
            <Scoreboard projectName={projectName} data={scoreboard} />
          )}
        </div>
      )}
    </div>
  );
}

/** Cinematic intro: two title beats with a glowing orb behind the text and
 *  the audio sting playing from the parent <audio> element. The glow + orb +
 *  blur entrances give the dramatic "movie studio reveal" the user asked for. */
function IntroStage({ stage }: { stage: "intro-1" | "intro-2" }) {
  const isFirst = stage === "intro-1";
  const titleRu = isFirst ? "Сделано Сбермаркетингом" : "Оценка кейса ИИ";
  const accent = isFirst ? "#3FAEFF" : "#9F66FF";
  const accent2 = isFirst ? "#9F66FF" : "#E661D9";
  return (
    <div
      key={stage} // forcing remount so animations restart cleanly between beats
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 32,
        zIndex: 2,
      }}
    >
      {/* Conic-gradient orb behind the title — Sber-style spinning rainbow disc */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          width: 220,
          height: 220,
          borderRadius: "50%",
          background: `conic-gradient(from 0deg, ${accent}, ${accent2}, ${accent})`,
          filter: "blur(2px)",
          animation: "intro-orb 2500ms ease-in-out forwards",
          opacity: 0,
          zIndex: -1,
        }}
      />
      {/* Soft radial glow that breathes outwards */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          width: 600,
          height: 600,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${accent}55 0%, transparent 60%)`,
          animation: "intro-glow 2500ms ease-out forwards",
          opacity: 0,
          zIndex: -2,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          color: "#fff",
          fontSize: "clamp(2rem, 5.5vw, 4rem)",
          fontWeight: 800,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          textAlign: "center",
          maxWidth: "85vw",
          lineHeight: 1.05,
          textShadow: `0 0 28px ${accent}88, 0 0 60px ${accent2}44`,
          animation: "intro-title 2500ms cubic-bezier(0.2, 0.7, 0.2, 1) forwards",
        }}
      >
        {titleRu}
      </div>
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
