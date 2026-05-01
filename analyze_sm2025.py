#!/usr/bin/env python3
"""Analyze SM_2025.json - Silver Mercury 2025 competition results."""

import json
from collections import defaultdict

def main():
    with open("SM_2025.json", "r", encoding="utf-8") as f:
        data = f.read()

    # File might be wrapped in double array
    raw = json.loads(data)
    if isinstance(raw, list) and len(raw) > 0 and isinstance(raw[0], list):
        blocks = raw[0]  # list of nomination blocks
    else:
        blocks = raw if isinstance(raw, list) else [raw]

    total_cases = 0
    score_counts = defaultdict(int)  # rounded score -> count
    shortlisted_count = 0
    shortlist_by_type = defaultdict(int)  # SHORTLIST, SILVER, GOLD

    for block in blocks:
        if not isinstance(block, dict):
            continue
        projects = block.get("projects", [])
        for p in projects:
            if not isinstance(p, dict):
                continue
            total_cases += 1

            # Shortlist: diplom_text present
            dt = p.get("diplom_text")
            if dt:
                shortlisted_count += 1
                shortlist_by_type[dt] = shortlist_by_type.get(dt, 0) + 1

            # Score: from level2 judge totals (average per project)
            level2 = p.get("level2") or {}
            marks = level2.get("marks_and_comments") or level2.get("marks_comments") or level2.get("marks_scores") or {}
            scores = []
            for judge_id, judge_data in marks.items():
                if not isinstance(judge_data, dict):
                    continue
                t = judge_data.get("total")
                if t is None:
                    continue
                if isinstance(t, str) and t.strip().lower() == "is_my":
                    continue
                try:
                    scores.append(float(t))
                except (TypeError, ValueError):
                    pass
            if scores:
                avg = sum(scores) / len(scores)
                # Round to 1 decimal for distribution
                rounded = round(avg, 1)
                score_counts[rounded] += 1

    # Build sorted score distribution
    if not score_counts:
        # Fallback: maybe scores are elsewhere
        print("No level2 marks_comments/marks_scores found. Checking structure...")
    else:
        print("=" * 60)
        print("SILVER MERCURY 2025 — Competition results summary")
        print("=" * 60)
        print()
        print(f"Total cases considered:     {total_cases}")
        print(f"Cases with score (level 2): {sum(score_counts.values())}")
        print(f"Shortlisted (any diploma):  {shortlisted_count}")
        print()
        print("Shortlist by diploma type:")
        for k in ["SHORTLIST", "SILVER", "GOLD"]:
            if k in shortlist_by_type:
                print(f"  {k}: {shortlist_by_type[k]}")
        print()
        print("Score distribution (average score per case, 1 decimal):")
        print("-" * 40)
        for score in sorted(score_counts.keys()):
            print(f"  Score {score:4.1f}: {score_counts[score]:4d} cases")
        print("-" * 40)
        print(f"  Total with score: {sum(score_counts.values())}")

if __name__ == "__main__":
    import sys
    try:
        main()
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)
