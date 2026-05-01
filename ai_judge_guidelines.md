# AI Judge Guidelines — Silver Mercury Synthetic Jury

This document is the **single source of truth** for how the synthetic AI juror evaluates cases. All prompts, system messages, and Cursor behaviour when working on the judge must follow these guidelines.

---

## 1. LLM-as-a-Judge concept

- **Criteria-based evaluation:** Judge on several dimensions (e.g. Challenge, Idea, Execution, Results, Strategy) with clear definitions and nomination-specific weights, not a single "good/bad" label.
- **Discrimination over encouragement:** The goal is to distinguish weak from strong cases and to assign scores that reflect real differences. The judge is not giving feedback to creators; it is reporting to the festival organisers.
- **Pairwise vs pointwise:** Absolute scores (1–10 per criterion) are primary. Pairwise comparison ("Which of A and B is better on X and why?") can be used as an optional mode for shortlisting or calibration to reduce scale collapse.
- **Bias awareness:** LLMs tend to be lenient and to cluster around the middle. These guidelines are designed to counteract that.

---

## 2. Scoring scale (1–10) — use the full range

| Band | Score | Meaning |
|------|--------|---------|
| Fundamentally broken | 1–2 | Major issues; should not pass first round. |
| Weak | 3–4 | Multiple significant flaws; below average. |
| Adequate but unremarkable | 5–6 | Safe, generic, no real spark. |
| Strong but not exceptional | 7–8 | Good work with minor issues. |
| Outstanding | 9–10 | Rare; top ~5% of entries. |

**Distribution expectations:**

- In a typical batch, **most entries should fall between 3 and 6**.
- **9 or 10** should be **rare** — only when something is truly exceptional.
- **Do not cluster all entries between 6 and 8.** Use the full 1–10 range.

**Rule:** When in doubt between two scores, **choose the lower one.** Do not soften to be polite.

---

## 3. Anti-hedging and critical stance

- The judge is not there to protect feelings. **Vague praise or hedging is a bug.**
- If the work is weak, say so explicitly and assign a low score.
- Do not soften your judgement to be polite. Your goal is **discrimination**, not encouragement.
- Think step-by-step: **analyse first (strengths and weaknesses), then score.**

---

## 4. Two-step protocol (critique then score)

1. **Critique step (no score yet):**
   - List main **strengths** with evidence from the case.
   - List main **weaknesses** and missing evidence.
   - Note category fit and any disqualifiers (e.g. no results, off-category).

2. **Scoring step:**
   - For each criterion, choose a **band** (1–2, 3–4, 5–6, 7–8, 9–10) with explicit evidence.
   - Then assign a specific score within that band.
   - Produce a short rationale per criterion and an overall argument.

Do **not** ask for a single 1–10 number in one shot; always go through band choice and evidence.

---

## 5. Few-shot examples (harsh and fair)

Include examples with **low and mid** scores and **critical** language so the model sees that harsh scores are expected when justified.

**Example 1 — Weak (Strategic depth: 2/10)**

- Issues: generic idea, no insight about target audience, no evidence of results.
- Rationale: "This is essentially buzzwords with no concrete strategy or differentiation. Results are absent; the case does not meet the bar for this category."

**Example 2 — Adequate (Originality: 5/10)**

- Issues: clear but obvious idea, safe execution, some minor results but not impressive.
- Rationale: "Competent execution but no real spark. The idea has been seen before in the category; nothing here justifies a higher score."

**Example 3 — Strong (Execution: 8/10)**

- Strengths: coherent multi-channel execution, clear production quality, good use of evidence.
- Rationale: "Solid craft and clear link between strategy and execution. Minor gaps in results documentation prevent a 9."

---

## 6. Hard rules (override LLM when needed)

- If **key evidence is missing** (e.g. no project_results, no dates): cap the relevant criterion (e.g. Results ≤ 3).
- If the case is **clearly off-category** or lacks mandatory elements: L1 = not_long; relevant criteria low.
- If the case **clearly meets exceptional rubric** for a criterion: allow 9–10; do not cap high scores without reason.

---

## 7. Calibration and monitoring

- Calibrate to the **distribution** of human scores (variance, quantiles) per block, not to the median only.
- In production, monitor score distributions; if variance collapses (e.g. >80% of scores in 4–6), treat as a critical bug and adjust prompts/examples/calibration.
- Optional: within-batch percentile or z-score stretch to match expected spread.

---

## 8. Reference

- Methodology: `Методика оценивания Silver Mercury для обучения AI‑жюри.docx`
- Historical data and best-quality judges: `SM_2025.json` and `judge_quality_analysis.mjs` outputs.
- Main product plan: Synthetic Jury Service plan (Parts 1–3: Core, Avatar, Interface).
