import { Routes, Route, Link, useLocation } from "react-router-dom";
import Home from "./pages/Home";
import Upload from "./pages/Upload";
import Results from "./pages/Results";
import GrandModerator from "./pages/GrandModerator";
import Moderator from "./pages/Moderator";

export default function App() {
  const location = useLocation();
  // Hide nav during the moderator's festival-day view so the Zoom screen-share
  // is clean — the "Активировать ИИ жюри" button is the entire moderator UX.
  const isModeratorScreen = location.pathname.startsWith("/moderator/");

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {!isModeratorScreen && (
        <header style={{ padding: "1rem 1.5rem", background: "#1a1a1a", color: "#fff" }}>
          <nav style={{ display: "flex", gap: "1.5rem", alignItems: "center" }}>
            <Link to="/" style={{ color: "#fff", textDecoration: "none", fontWeight: 600 }}>
              ИИ Жюри
            </Link>
            <Link to="/grand" style={{ color: "#ccc", textDecoration: "none" }}>
              Главный модератор
            </Link>
            {/* /results route still exists for direct access by Grand Moderator,
                but is no longer linked from the nav. Showing verdict info before
                the avatar speaks would break the live-judging illusion. */}
          </nav>
        </header>
      )}
      <main style={{ flex: 1, padding: "1.5rem" }}>
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
