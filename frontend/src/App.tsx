import { Routes, Route, Link, useLocation } from "react-router-dom";
import Home from "./pages/Home";
import Upload from "./pages/Upload";
import Results from "./pages/Results";
import GrandModerator from "./pages/GrandModerator";
import Moderator from "./pages/Moderator";

/**
 * Top-level layout. Header mirrors sbermarketing.ru: small text-link nav on
 * the left, centered wordmark, ghost-pill action on the right. Hidden on the
 * festival-day Moderator screen so the Zoom share is uncluttered.
 */
export default function App() {
  const location = useLocation();
  const isModeratorScreen = location.pathname.startsWith("/moderator/");

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {!isModeratorScreen && <SiteHeader />}
      <main style={{ flex: 1, padding: "1.5rem", maxWidth: 1280, width: "100%", margin: "0 auto" }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/results" element={<Results />} />
          <Route path="/grand" element={<GrandModerator />} />
          <Route path="/moderator/:category" element={<Moderator />} />
        </Routes>
      </main>
    </div>
  );
}

function SiteHeader() {
  const link: React.CSSProperties = {
    color: "var(--fg-secondary)",
    fontSize: "0.85rem",
    letterSpacing: "0.02em",
  };
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        backdropFilter: "blur(12px)",
        background: "rgba(6, 6, 26, 0.7)",
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      <nav
        style={{
          maxWidth: 1280,
          margin: "0 auto",
          padding: "14px 24px",
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          gap: 16,
        }}
      >
        {/* Left: section links */}
        <div style={{ display: "flex", gap: 22 }}>
          <Link to="/" style={link}>Главная</Link>
          <Link to="/grand" style={link}>Главный модератор</Link>
        </div>

        {/* Center: wordmark */}
        <Link
          to="/"
          aria-label="ИИ Жюри"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: "var(--fg-primary)",
            textTransform: "uppercase",
            letterSpacing: "0.18em",
            fontSize: "0.78rem",
            fontWeight: 700,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: "conic-gradient(from 220deg, var(--accent-cyan), var(--accent-purple), var(--accent-magenta), var(--accent-cyan))",
              display: "inline-block",
            }}
          />
          ИИ&nbsp;Жюри
        </Link>

        {/* Right: ghost pill */}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <a
            href="mailto:theoleglebedev@gmail.com"
            className="pill pill--ghost"
            style={{ padding: "8px 16px", fontSize: "0.82rem" }}
          >
            Контакты
          </a>
        </div>
      </nav>
    </header>
  );
}
