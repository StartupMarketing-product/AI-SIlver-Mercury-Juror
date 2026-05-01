import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

const API_URL = import.meta.env.VITE_API_URL ?? "";

const CATEGORIES = [
  { code: "D01", name: "Лучшая цифровая кампания" },
  { code: "D10", name: "Лучшее использование ИИ" },
  { code: "D13", name: "Лучшее использование данных" },
  { code: "D15", name: "Лучшая цифровая платформа" },
];

export default function Home() {
  const [health, setHealth] = useState<{ ok?: boolean } | null>(null);

  useEffect(() => {
    const url = API_URL ? `${API_URL.replace(/\/$/, "")}/health` : "/health";
    fetch(url)
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ ok: false }));
  }, []);

  const cardStyle = {
    display: "block",
    padding: "1.5rem",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    background: "#fff",
    textDecoration: "none",
    color: "#1a1a1a",
    transition: "border-color 0.15s, box-shadow 0.15s",
  } as const;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ marginTop: 0 }}>Синтетический член жюри Silver Mercury</h1>
      <p style={{ color: "#444", marginBottom: 24 }}>
        Выберите свою роль для входа.
      </p>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: "1rem", margin: "0 0 10px", color: "#666", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Главный модератор
        </h2>
        <Link to="/grand" style={{ ...cardStyle, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: "1.1rem" }}>Консоль главного модератора</div>
            <div style={{ color: "#666", fontSize: "0.9rem", marginTop: 4 }}>
              Загрузка JSON, проверка оценок, утверждение и отправка речей в продакшн видео.
            </div>
          </div>
          <span style={{ fontSize: "1.5rem", color: "#999" }}>→</span>
        </Link>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: "1rem", margin: "0 0 10px", color: "#666", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Модератор (на сессии)
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
          {CATEGORIES.map((c) => (
            <Link key={c.code} to={`/moderator/${c.code}`} style={cardStyle}>
              <div style={{ fontWeight: 600, fontSize: "1.05rem" }}>
                {c.code} · {c.name}
              </div>
              <div style={{ color: "#666", fontSize: "0.85rem", marginTop: 4 }}>
                Запуск ИИ жюри во время обсуждения.
              </div>
            </Link>
          ))}
        </div>
      </section>

      <p style={{ fontSize: "0.8rem", color: "#888" }}>
        API: {health?.ok ? "подключён" : health === null ? "проверка…" : "не доступен"}
      </p>
    </div>
  );
}
