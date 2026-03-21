"""
Lightweight JSONL logging for semantic intent classification review.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


def _resolve_log_file() -> Path:
    configured_dir = os.environ.get("INTENT_LOG_DIR")
    if configured_dir:
        base_dir = Path(configured_dir)
    else:
        base_dir = Path(tempfile.gettempdir()) / "kiosk_intent_logs"
    return base_dir / "classifications.jsonl"


FLUSH_EVERY = max(1, int(os.environ.get("INTENT_LOG_FLUSH_EVERY", "20")))
LOW_CONFIDENCE_THRESHOLD = float(os.environ.get("INTENT_LOG_LOW_CONF", "0.55"))


@dataclass
class ClassificationRecord:
    timestamp: str
    session_id: str
    screen: str
    raw_transcript: str
    normalized_transcript: str
    predicted_intent: str
    similarity_score: float
    matched_example: str
    was_overridden: bool
    override_intent: Optional[str]
    is_low_confidence: bool
    language: str


_buffer: list[ClassificationRecord] = []
_lock = threading.Lock()


def get_log_file_path() -> Path:
    """Expose the active log file path for offline review tooling."""
    return _resolve_log_file()


def record_classification(
    *,
    session_id: str,
    screen: str,
    raw_transcript: str,
    normalized_transcript: str,
    predicted_intent: str,
    similarity_score: float,
    matched_example: str,
    was_overridden: bool = False,
    override_intent: Optional[str] = None,
    language: str = "en",
) -> None:
    """Buffer a classification event for later flush."""
    rec = ClassificationRecord(
        timestamp=datetime.now(timezone.utc).isoformat(),
        session_id=session_id,
        screen=screen,
        raw_transcript=raw_transcript,
        normalized_transcript=normalized_transcript,
        predicted_intent=predicted_intent,
        similarity_score=round(float(similarity_score), 4),
        matched_example=matched_example,
        was_overridden=was_overridden,
        override_intent=override_intent,
        is_low_confidence=float(similarity_score) < LOW_CONFIDENCE_THRESHOLD,
        language=language,
    )
    with _lock:
        _buffer.append(rec)
        if len(_buffer) >= FLUSH_EVERY:
            _flush_locked()


def flush() -> None:
    """Force buffered records to disk."""
    with _lock:
        _flush_locked()


def _flush_locked() -> None:
    if not _buffer:
        return

    try:
        log_file = _resolve_log_file()
        log_file.parent.mkdir(parents=True, exist_ok=True)
        with log_file.open("a", encoding="utf-8") as handle:
            for rec in _buffer:
                handle.write(json.dumps(asdict(rec), ensure_ascii=False) + "\n")
        _buffer.clear()
    except OSError as exc:
        print(f"[MisclassificationLogger] flush failed: {exc}")
