"""
Offline review tool for semantic intent classification logs.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

from agent.misclassification_logger import get_log_file_path


def load_records(log_path: Path) -> list[dict]:
    if not log_path.exists():
        print(f"[review] No log file found at {log_path}")
        sys.exit(0)

    records: list[dict] = []
    with log_path.open(encoding="utf-8") as handle:
        for line in handle:
            payload = line.strip()
            if not payload:
                continue
            try:
                records.append(json.loads(payload))
            except json.JSONDecodeError:
                continue
    return records


def filter_records(
    records: list[dict],
    intent_filter: str | None,
    low_confidence_only: bool,
    overridden_only: bool,
) -> list[dict]:
    filtered: list[dict] = []
    for rec in records:
        if intent_filter and rec.get("predicted_intent") != intent_filter:
            continue
        if low_confidence_only and not rec.get("is_low_confidence"):
            continue
        if overridden_only and not rec.get("was_overridden"):
            continue
        filtered.append(rec)
    return filtered


def summarize(records: list[dict], min_count: int) -> dict[str, dict[str, object]]:
    by_intent: dict[str, list[dict]] = defaultdict(list)
    for rec in records:
        by_intent[str(rec.get("predicted_intent", "UNKNOWN"))].append(rec)

    summary: dict[str, dict[str, object]] = {}
    for intent, recs in sorted(by_intent.items()):
        low_conf_counts: dict[str, list[float]] = defaultdict(list)
        override_counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))

        for rec in recs:
            transcript = str(rec.get("normalized_transcript", "")).strip()
            score = float(rec.get("similarity_score", 0.0))
            if rec.get("is_low_confidence") and transcript:
                low_conf_counts[transcript].append(score)
            if rec.get("was_overridden") and rec.get("override_intent") and transcript:
                override_counts[str(rec["override_intent"])][transcript] += 1

        low_conf_items = [
            (transcript, round(sum(scores) / len(scores), 3), len(scores))
            for transcript, scores in low_conf_counts.items()
            if len(scores) >= min_count
        ]
        low_conf_items.sort(key=lambda item: (-item[2], item[0]))

        override_items: dict[str, list[tuple[str, int]]] = {}
        for to_intent, transcript_counts in override_counts.items():
            items = [
                (transcript, count)
                for transcript, count in transcript_counts.items()
                if count >= min_count
            ]
            items.sort(key=lambda item: (-item[1], item[0]))
            if items:
                override_items[to_intent] = items

        if low_conf_items or override_items:
            summary[intent] = {
                "low_confidence": low_conf_items,
                "overridden_to": override_items,
            }

    return summary


def print_summary(summary: dict[str, dict[str, object]], export_path: Path | None = None) -> None:
    lines = ["=" * 70, "MISCLASSIFICATION REVIEW", "=" * 70]

    for intent, data in summary.items():
        lines.append(f"\n--- {intent} ---")
        low_confidence = data.get("low_confidence", [])
        if low_confidence:
            lines.append(
                f"\n  Low-confidence turns (consider adding to INTENT_EXAMPLES['{intent}']):"
            )
            for transcript, avg_score, count in low_confidence:
                lines.append(f'    [{count}x, avg={avg_score}] "{transcript}"')

        overridden_to = data.get("overridden_to", {})
        for to_intent, items in overridden_to.items():
            lines.append(
                f"\n  Predicted {intent} but final router chose {to_intent}:"
            )
            for transcript, count in items:
                lines.append(f'    [{count}x] "{transcript}"')

    lines.append("\n" + "=" * 70)
    output = "\n".join(lines)
    print(output)

    if export_path:
        export_path.write_text(output, encoding="utf-8")
        print(f"\n[review] Exported to {export_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Review semantic intent misclassifications.")
    parser.add_argument("--log", type=Path, default=get_log_file_path())
    parser.add_argument("--intent", type=str, default=None, help="Filter to one predicted intent")
    parser.add_argument("--min-count", type=int, default=2, help="Minimum repeat count to surface")
    parser.add_argument("--low-confidence-only", action="store_true")
    parser.add_argument("--overridden-only", action="store_true")
    parser.add_argument("--export", type=Path, default=None, help="Write output to a file")
    args = parser.parse_args()

    records = load_records(args.log)
    print(f"[review] Loaded {len(records)} records from {args.log}")
    filtered = filter_records(
        records,
        intent_filter=args.intent,
        low_confidence_only=args.low_confidence_only,
        overridden_only=args.overridden_only,
    )
    print(f"[review] {len(filtered)} records after filter\n")
    summary = summarize(filtered, min_count=args.min_count)
    print_summary(summary, export_path=args.export)


if __name__ == "__main__":
    main()
