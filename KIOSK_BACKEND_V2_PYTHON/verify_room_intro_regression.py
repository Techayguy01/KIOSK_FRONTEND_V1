"""
Live regression harness for Room Select intro sequencing and TTS latency.

Usage:
    python verify_room_intro_regression.py --tenant-slug nagpur-premium-hotel-3b832f1b
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass


DEFAULT_BASE_URL = "http://localhost:8002"
DEFAULT_TRANSCRIPT = "i want to book a room"
DEFAULT_LANGUAGE = "en"


@dataclass
class TTSMeasurement:
    index: int
    room_name: str
    latency_ms: float
    byte_size: int


def _request_json(
    url: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    payload: dict[str, object] | None = None,
    timeout: float = 40.0,
) -> dict[str, object]:
    encoded_body = None
    merged_headers = dict(headers or {})
    if payload is not None:
        encoded_body = json.dumps(payload).encode("utf-8")
        merged_headers.setdefault("Content-Type", "application/json")

    request = urllib.request.Request(
        url,
        data=encoded_body,
        headers=merged_headers,
        method=method,
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _request_bytes(
    url: str,
    *,
    headers: dict[str, str],
    payload: dict[str, object],
    timeout: float = 40.0,
) -> tuple[bytes, float]:
    encoded_body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=encoded_body,
        headers={**headers, "Content-Type": "application/json"},
        method="POST",
    )
    started_at = time.perf_counter()
    with urllib.request.urlopen(request, timeout=timeout) as response:
        content = response.read()
    elapsed_ms = round((time.perf_counter() - started_at) * 1000, 1)
    return content, elapsed_ms


def _room_name_by_id(rooms: list[dict[str, object]]) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for room in rooms:
        room_id = str(room.get("id") or "").strip()
        room_name = str(room.get("name") or "").strip()
        if room_id:
            mapping[room_id] = room_name
    return mapping


def _measure_intro_queue(
    base_url: str,
    tenant_slug: str,
    language: str,
    room_names: list[str],
    speech_queue: list[str],
) -> list[TTSMeasurement]:
    measurements: list[TTSMeasurement] = []
    headers = {"x-tenant-slug": tenant_slug}
    for index, (room_name, text) in enumerate(zip(room_names, speech_queue, strict=True), start=1):
        audio_bytes, elapsed_ms = _request_bytes(
            f"{base_url}/api/voice/tts",
            headers=headers,
            payload={"text": text, "language": language},
        )
        measurements.append(
            TTSMeasurement(
                index=index,
                room_name=room_name,
                latency_ms=elapsed_ms,
                byte_size=len(audio_bytes),
            )
        )
    return measurements


def _format_measurements(label: str, measurements: list[TTSMeasurement]) -> str:
    lines = [label]
    for measurement in measurements:
        lines.append(
            f"  {measurement.index}. {measurement.room_name}: "
            f"{measurement.latency_ms} ms, bytes={measurement.byte_size}"
        )
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify room intro sequencing and TTS latency against a live backend.")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL, help="Backend base URL, e.g. http://localhost:8002")
    parser.add_argument("--tenant-slug", required=True, help="Tenant slug to test")
    parser.add_argument("--transcript", default=DEFAULT_TRANSCRIPT, help="Transcript that should enter ROOM_SELECT intro")
    parser.add_argument("--language", default=DEFAULT_LANGUAGE, help="Language code to use for chat and TTS")
    parser.add_argument("--session-id", default="room-intro-regression", help="Session id for /api/chat")
    parser.add_argument("--warm-threshold-ms", type=float, default=1500.0, help="Warn when warm-cache latency exceeds this")
    args = parser.parse_args()

    try:
        rooms_payload = _request_json(f"{args.base_url}/api/rooms?slug={args.tenant_slug}")
        rooms = list(rooms_payload.get("rooms") or [])
        if not rooms:
            raise AssertionError("No rooms returned from /api/rooms.")

        chat_payload = _request_json(
            f"{args.base_url}/api/chat",
            method="POST",
            headers={"x-tenant-slug": args.tenant_slug},
            payload={
                "transcript": args.transcript,
                "currentState": "WELCOME",
                "sessionId": args.session_id,
                "language": args.language,
            },
        )

        room_intro_sequence = list(chat_payload.get("roomIntroSequence") or [])
        room_intro_speech_queue = list(chat_payload.get("roomIntroSpeechQueue") or [])

        assert chat_payload.get("nextUiScreen") == "ROOM_SELECT", (
            f"Expected ROOM_SELECT, got {chat_payload.get('nextUiScreen')!r}"
        )
        assert chat_payload.get("roomDisplayMode") == "intro", (
            f"Expected intro display mode, got {chat_payload.get('roomDisplayMode')!r}"
        )
        assert room_intro_sequence, "Backend did not return roomIntroSequence."
        assert room_intro_speech_queue, "Backend did not return roomIntroSpeechQueue."
        assert len(room_intro_sequence) == len(room_intro_speech_queue), (
            "roomIntroSequence and roomIntroSpeechQueue length mismatch."
        )
        assert len(room_intro_sequence) == len(rooms), (
            f"Expected {len(rooms)} intro rooms, got {len(room_intro_sequence)}."
        )
        assert len(set(room_intro_sequence)) == len(room_intro_sequence), "Duplicate room ids detected in intro sequence."

        room_name_lookup = _room_name_by_id(rooms)
        missing_ids = [room_id for room_id in room_intro_sequence if room_id not in room_name_lookup]
        assert not missing_ids, f"Unknown room ids in intro sequence: {missing_ids}"

        ordered_room_names = [room_name_lookup[room_id] for room_id in room_intro_sequence]

        first_pass = _measure_intro_queue(
            args.base_url,
            args.tenant_slug,
            args.language,
            ordered_room_names,
            room_intro_speech_queue,
        )
        second_pass = _measure_intro_queue(
            args.base_url,
            args.tenant_slug,
            args.language,
            ordered_room_names,
            room_intro_speech_queue,
        )

        print("ROOM INTRO REGRESSION")
        print(f"Tenant: {args.tenant_slug}")
        print(f"Rooms returned: {len(rooms)}")
        print("Intro order:")
        for index, room_name in enumerate(ordered_room_names, start=1):
            print(f"  {index}. {room_name}")
        print(_format_measurements("Cold pass:", first_pass))
        print(_format_measurements("Warm pass:", second_pass))

        warm_over_threshold = [m for m in second_pass if m.latency_ms > args.warm_threshold_ms]
        if warm_over_threshold:
            print(
                "WARN: Warm-cache latency exceeded threshold for "
                + ", ".join(f"{m.room_name} ({m.latency_ms} ms)" for m in warm_over_threshold)
            )
            return 2

        print("PASS: Sequence structure is valid and warm-cache latency is within threshold.")
        return 0

    except (AssertionError, urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError) as exc:
        print(f"FAIL: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
