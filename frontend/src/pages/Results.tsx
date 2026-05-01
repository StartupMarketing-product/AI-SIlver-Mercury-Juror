import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

const API_URL = import.meta.env.VITE_API_URL ?? "";

// ---------- types ----------

type AwardLevel = "gold" | "silver" | "bronze" | "shortlist" | "longlist";
type ApprovalState = "pending" | "approved" | "rejected";

interface ListItem {
  evaluation_id: string;
  case_id: string;
  created_at: string;
  award_level: AwardLevel;
  total_score: number;
  approval_state: ApprovalState;
  project_name?: string;
}

interface CriterionScore {
  criterion: string;
  score: number;
  rationale: string;
  evidence_ids?: string[];
}

interface EvidenceGrade {
  no_baseline: boolean;
  no_causality: boolean;
  no_attribution: boolean;
  rationale?: string;
}

interface CapApplied {
  criterion: string;
  original_score: number;
  capped_score: number;
  reason: string;
}

interface EvidenceRow {
  id: string;
  case_id: string;
  kind: string;
  source: string;
  snippet: string | null;
  page_or_slide: number | null;
  storage_path: string | null;
}

interface RichVerdict {
  evaluation_id: string;
  case_id: string;
  created_at: string;
  approval_state: ApprovalState;
  output: {
    case_id: string;
    methodology_hash: string;
    anchors_hash: string;
    prompt_hash: string;
    input_hash: string;
    model_id: string;
    block_code: string;
    nomination_code: string;
    l2: {
      criteria_scores: CriterionScore[];
      block_score: number;
      social_outcomes_score?: number;
      total_score: number;
      award_level: AwardLevel;
      one_paragraph_verdict: string;
      evidence_grade?: EvidenceGrade;
      caps_applied?: CapApplied[];
    };
    missing_evidence: string[];
    avatar_script: string;
    consistency_check_passed: boolean;
  };
  evidence: EvidenceRow[];
}

interface MethodologyConfig {
  blocks: Array<{
    code: string;
    name_ru: string;
    criteria: Array<{ id: string; name_ru: string; description_ru: string }>;
    nominations: Array<{ code: string; name_ru: string }>;
  }>;
  social_formula: { social_criterion: { id: string; name_ru: string; description_ru: string } };
}

// ---------- ru labels ----------

const AWARD_RU: Record<AwardLevel, string> = {
  gold: "Золото",
  silver: "Серебро",
  bronze: "Бронза",
  shortlist: "Шорт-лист",
  longlist: "Лонг-лист",
};

const AWARD_COLOR: Record<AwardLevel, string> = {
  gold: "#c89b1a",
  silver: "#7d8590",
  bronze: "#a06237",
  shortlist: "#4a5568",
  longlist: "#718096",
};

const APPROVAL_RU: Record<ApprovalState, string> = {
  pending: "На проверке",
  approved: "Принято",
  rejected: "Отклонено",
};

const APPROVAL_COLOR: Record<ApprovalState, string> = {
  pending: "#b7791f",
  approved: "#2f855a",
  rejected: "#c53030",
};

const CAP_REASON_RU: Record<string, string> = {
  no_baseline: "Нет базы для сравнения",
  no_causality: "Нет причинно-следственной связи",
  no_attribution: "Невозможно атрибутировать результат",
};

// ---------- helpers ----------

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function Badge({ text, color, bg }: { text: string; color?: string; bg?: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: "0.75rem",
        fontWeight: 600,
        color: color ?? "#fff",
        background: bg ?? "#4a5568",
      }}
    >
      {text}
    </span>
  );
}

// ---------- page ----------

export default function Results() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("evaluation");
  const role = searchParams.get("role"); // "reviewer" enables approve/reject buttons

  const [items, setItems] = useState<ListItem[] | null>(null);
  const [detail, setDetail] = useState<RichVerdict | null>(null);
  const [methodology, setMethodology] = useState<MethodologyConfig | null>(null);
  const [actionLoading, setActionLoading] = useState<null | "approve" | "reject">(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const base = API_URL ? API_URL.replace(/\/$/, "") : "";

  // load list + methodology once
  useEffect(() => {
    fetch(`${base}/api/evaluations`)
      .then((r) => r.json())
      .then((arr: ListItem[]) => setItems(arr))
      .catch(() => setItems([]));
    fetch(`${base}/api/config/methodology`)
      .then((r) => r.json())
      .then(setMethodology)
      .catch(() => setMethodology(null));
  }, [base]);

  const effectiveId = selectedId ?? items?.[0]?.evaluation_id ?? null;

  // load rich detail when selection changes
  useEffect(() => {
    if (!effectiveId) {
      setDetail(null);
      return;
    }
    fetch(`${base}/api/verdicts/${effectiveId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setDetail(d);
        setActionError(null);
      })
      .catch(() => setDetail(null));
  }, [base, effectiveId]);

  // criterion id → Russian name lookup, scoped to the verdict's block
  const criterionNames = useMemo(() => {
    const map = new Map<string, string>();
    if (!methodology || !detail) return map;
    const block = methodology.blocks.find((b) => b.code === detail.output.block_code);
    if (block) for (const c of block.criteria) map.set(c.id, c.name_ru);
    const sc = methodology.social_formula?.social_criterion;
    if (sc) map.set(sc.id, sc.name_ru);
    return map;
  }, [methodology, detail]);

  const blockName = useMemo(() => {
    if (!methodology || !detail) return null;
    return methodology.blocks.find((b) => b.code === detail.output.block_code)?.name_ru ?? null;
  }, [methodology, detail]);

  const nominationName = useMemo(() => {
    if (!methodology || !detail) return null;
    const block = methodology.blocks.find((b) => b.code === detail.output.block_code);
    return block?.nominations.find((n) => n.code === detail.output.nomination_code)?.name_ru ?? null;
  }, [methodology, detail]);

  const evidenceById = useMemo(() => {
    const m = new Map<string, EvidenceRow>();
    for (const e of detail?.evidence ?? []) m.set(e.id, e);
    return m;
  }, [detail]);

  // ---------- reviewer actions ----------

  async function approveOrReject(action: "approve" | "reject") {
    if (!detail) return;
    setActionLoading(action);
    setActionError(null);
    try {
      const res = await fetch(`${base}/api/verdicts/${detail.evaluation_id}/${action}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Reviewer-Role": "reviewer",
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `${action} failed`);
      }
      // refresh detail + list
      const fresh = await fetch(`${base}/api/verdicts/${detail.evaluation_id}`).then((r) => r.json());
      setDetail(fresh);
      const list = await fetch(`${base}/api/evaluations`).then((r) => r.json());
      setItems(list);
    } catch (e) {
      setActionError(String((e as Error).message));
    } finally {
      setActionLoading(null);
    }
  }

  // ---------- render ----------

  return (
    <div style={{ display: "flex", gap: "1.5rem", alignItems: "flex-start" }}>
      <aside style={{ width: 280, flexShrink: 0 }}>
        <h2 style={{ fontSize: "1rem", marginTop: 0 }}>Оценки</h2>
        {!items ? (
          <p>Загрузка…</p>
        ) : items.length === 0 ? (
          <p style={{ color: "#666" }}>Пока нет оценок.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {items.map((it) => {
              const active = it.evaluation_id === effectiveId;
              return (
                <li key={it.evaluation_id}>
                  <button
                    onClick={() => setSearchParams({ evaluation: it.evaluation_id, ...(role ? { role } : {}) })}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "8px 10px",
                      border: "1px solid",
                      borderColor: active ? "#1a1a1a" : "#ddd",
                      background: active ? "#f5f5f5" : "#fff",
                      borderRadius: 6,
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                      {it.project_name ?? it.case_id.slice(0, 8)}
                    </span>
                    <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <Badge text={AWARD_RU[it.award_level]} bg={AWARD_COLOR[it.award_level]} />
                      <Badge text={it.total_score.toFixed(1)} bg="#2d3748" />
                      <Badge
                        text={APPROVAL_RU[it.approval_state]}
                        bg={APPROVAL_COLOR[it.approval_state]}
                      />
                    </span>
                    <span style={{ fontSize: "0.7rem", color: "#777" }}>{formatDate(it.created_at)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      <section style={{ flex: 1, minWidth: 0 }}>
        {!effectiveId ? (
          <p>Пока нет оценок. Загрузите кейс на странице «Загрузить кейс».</p>
        ) : !detail ? (
          <p>Загрузка результата…</p>
        ) : (
          <VerdictDetail
            detail={detail}
            blockName={blockName}
            nominationName={nominationName}
            criterionNames={criterionNames}
            evidenceById={evidenceById}
            role={role}
            onApprove={() => approveOrReject("approve")}
            onReject={() => approveOrReject("reject")}
            actionLoading={actionLoading}
            actionError={actionError}
          />
        )}
      </section>
    </div>
  );
}

// ---------- detail component ----------

function VerdictDetail(props: {
  detail: RichVerdict;
  blockName: string | null;
  nominationName: string | null;
  criterionNames: Map<string, string>;
  evidenceById: Map<string, EvidenceRow>;
  role: string | null;
  onApprove: () => void;
  onReject: () => void;
  actionLoading: null | "approve" | "reject";
  actionError: string | null;
}) {
  const { detail, blockName, nominationName, criterionNames, evidenceById, role } = props;
  const o = detail.output;
  const grade = o.l2.evidence_grade;
  const caps = o.l2.caps_applied ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h1 style={{ margin: 0, fontSize: "1.4rem" }}>Вердикт</h1>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Badge text={AWARD_RU[o.l2.award_level]} bg={AWARD_COLOR[o.l2.award_level]} />
          <Badge text={`Итог: ${o.l2.total_score.toFixed(1)} / 10`} bg="#2d3748" />
          <Badge
            text={APPROVAL_RU[detail.approval_state]}
            bg={APPROVAL_COLOR[detail.approval_state]}
          />
          {!o.consistency_check_passed && <Badge text="Проверка не пройдена" bg="#c53030" />}
        </div>
        <div style={{ color: "#444", fontSize: "0.9rem" }}>
          Блок <strong>{o.block_code}</strong>
          {blockName && <> · {blockName}</>} · Номинация <strong>{o.nomination_code}</strong>
          {nominationName && <> · {nominationName}</>}
        </div>
        <div style={{ color: "#777", fontSize: "0.8rem" }}>
          {formatDate(detail.created_at)} · кейс {o.case_id.slice(0, 8)} · оценка {detail.evaluation_id.slice(0, 8)}
        </div>
      </header>

      <p style={{ fontSize: "1rem", lineHeight: 1.5, margin: 0 }}>{o.l2.one_paragraph_verdict}</p>

      <section style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Badge text={`Балл блока: ${o.l2.block_score.toFixed(1)}`} bg="#4a5568" />
        {typeof o.l2.social_outcomes_score === "number" && (
          <Badge
            text={`Социальные результаты: ${o.l2.social_outcomes_score.toFixed(1)}`}
            bg="#2c5282"
          />
        )}
      </section>

      {/* Reviewer controls */}
      {role === "reviewer" && (
        <section
          style={{
            border: "1px solid #ddd",
            borderRadius: 8,
            padding: "0.75rem 1rem",
            background: "#fafafa",
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <strong style={{ fontSize: "0.95rem" }}>Решение модератора:</strong>
          <button
            onClick={props.onApprove}
            disabled={props.actionLoading !== null || detail.approval_state === "approved"}
            style={{
              padding: "6px 14px",
              background: detail.approval_state === "approved" ? "#9ae6b4" : "#2f855a",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              cursor: props.actionLoading || detail.approval_state === "approved" ? "default" : "pointer",
              fontWeight: 600,
            }}
          >
            {props.actionLoading === "approve" ? "Принимаю…" : "Принять"}
          </button>
          <button
            onClick={props.onReject}
            disabled={props.actionLoading !== null || detail.approval_state === "rejected"}
            style={{
              padding: "6px 14px",
              background: detail.approval_state === "rejected" ? "#feb2b2" : "#c53030",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              cursor: props.actionLoading || detail.approval_state === "rejected" ? "default" : "pointer",
              fontWeight: 600,
            }}
          >
            {props.actionLoading === "reject" ? "Отклоняю…" : "Отклонить"}
          </button>
          {props.actionError && <span style={{ color: "#c53030" }}>Ошибка: {props.actionError}</span>}
        </section>
      )}

      {/* Evidence grade */}
      {grade && (
        <section
          style={{
            border: "1px solid #f6ad55",
            background: "#fffaf0",
            borderRadius: 8,
            padding: "0.75rem 1rem",
          }}
        >
          <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>Качество доказательной базы</h3>
          <ul style={{ margin: 0, paddingLeft: "1.2rem", lineHeight: 1.5 }}>
            <li>Базовая линия / контроль: {grade.no_baseline ? "не предоставлено" : "присутствует"}</li>
            <li>Причинно-следственная связь: {grade.no_causality ? "не доказана" : "обоснована"}</li>
            <li>Атрибуция результата: {grade.no_attribution ? "недостаточная" : "корректная"}</li>
          </ul>
          {grade.rationale && (
            <p style={{ margin: "0.5rem 0 0", fontStyle: "italic", color: "#555" }}>{grade.rationale}</p>
          )}
        </section>
      )}

      {/* Caps applied */}
      {caps.length > 0 && (
        <section
          style={{
            border: "1px solid #c53030",
            background: "#fff5f5",
            borderRadius: 8,
            padding: "0.75rem 1rem",
          }}
        >
          <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>Применённые ограничения</h3>
          <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
            {caps.map((c, i) => (
              <li key={i}>
                <strong>{criterionNames.get(c.criterion) ?? c.criterion}</strong>:{" "}
                {c.original_score.toFixed(1)} → {c.capped_score.toFixed(1)} (
                {CAP_REASON_RU[c.reason] ?? c.reason})
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Criteria + evidence */}
      <section>
        <h3 style={{ marginBottom: "0.5rem", fontSize: "1rem" }}>Оценки по критериям</h3>
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {o.l2.criteria_scores.map((c) => {
            const name = criterionNames.get(c.criterion) ?? c.criterion;
            const cited = (c.evidence_ids ?? []).map((id) => evidenceById.get(id)).filter(Boolean) as EvidenceRow[];
            return (
              <li
                key={c.criterion}
                style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "0.75rem 1rem" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <strong>{name}</strong>
                  <Badge text={`${c.score.toFixed(1)} / 10`} bg="#2d3748" />
                </div>
                <p style={{ margin: "0.5rem 0", color: "#333", lineHeight: 1.4 }}>{c.rationale}</p>
                {cited.length > 0 ? (
                  <details>
                    <summary style={{ cursor: "pointer", color: "#2c5282", fontSize: "0.85rem" }}>
                      Цитируемые свидетельства ({cited.length})
                    </summary>
                    <ul style={{ marginTop: 8, paddingLeft: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                      {cited.map((e) => (
                        <li
                          key={e.id}
                          style={{ background: "#f7fafc", borderLeft: "3px solid #4299e1", padding: "6px 10px", borderRadius: 4 }}
                        >
                          <div style={{ fontSize: "0.75rem", color: "#666", marginBottom: 4 }}>
                            {e.source}
                            {e.page_or_slide != null && <> · стр. {e.page_or_slide}</>}
                          </div>
                          <div style={{ fontSize: "0.85rem", whiteSpace: "pre-wrap" }}>
                            {(e.snippet ?? "").slice(0, 600)}
                            {(e.snippet ?? "").length > 600 ? "…" : ""}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : (
                  <p style={{ margin: 0, color: "#a0522d", fontSize: "0.8rem" }}>
                    Свидетельства не процитированы.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {o.missing_evidence.length > 0 && (
        <section>
          <h3 style={{ marginBottom: "0.25rem", fontSize: "1rem" }}>Не хватает свидетельств</h3>
          <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
            {o.missing_evidence.map((m) => (
              <li key={m}>{criterionNames.get(m) ?? m}</li>
            ))}
          </ul>
        </section>
      )}

      {o.avatar_script && (
        <section>
          <h3 style={{ fontSize: "1rem", marginBottom: "0.25rem" }}>Скрипт для аватара</h3>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              background: "#f0f0f0",
              padding: "0.75rem",
              borderRadius: 6,
              fontFamily: "inherit",
              margin: 0,
            }}
          >
            {o.avatar_script}
          </pre>
        </section>
      )}

      {/* Reproducibility footer */}
      <footer
        style={{
          borderTop: "1px solid #e2e8f0",
          paddingTop: "0.75rem",
          color: "#666",
          fontSize: "0.75rem",
          fontFamily: "ui-monospace, monospace",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <div>
          <strong>Воспроизводимость</strong> · модель {o.model_id}
        </div>
        <div>methodology_hash: {o.methodology_hash}</div>
        <div>anchors_hash: {o.anchors_hash}</div>
        <div>prompt_hash: {o.prompt_hash}</div>
        <div>input_hash: {o.input_hash}</div>
      </footer>
    </div>
  );
}
