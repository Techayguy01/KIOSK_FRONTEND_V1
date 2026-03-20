from __future__ import annotations

import json
import os
import socket
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any


BASE_URL = "http://localhost:8000"
TIMEOUT_SECONDS = 60
REPORT_PATH = Path(__file__).with_name("english_prompt_behavior_report.md")
DEFAULT_TENANT_SLUG = os.getenv("KIOSK_LIVE_TENANT_SLUG", "nagpur-premium-hotel-3b832f1b")
RUN_BASE_DATE = date.today() + timedelta(days=365 * 5 + int(time.time() * 1000) % 997)


FALLBACK_ROOM_CATALOG = [
    {
        "id": "room-deluxe-king",
        "name": "Deluxe King",
        "code": "DLX-K",
        "price": 6499,
        "currency": "INR",
        "maxAdults": 2,
        "maxChildren": 1,
        "maxTotalGuests": 3,
    },
    {
        "id": "room-family-suite",
        "name": "Family Suite",
        "code": "FAM-S",
        "price": 8999,
        "currency": "INR",
        "maxAdults": 4,
        "maxChildren": 2,
        "maxTotalGuests": 6,
    },
    {
        "id": "room-premium-twin",
        "name": "Premium Twin",
        "code": "PRM-T",
        "price": 7299,
        "currency": "INR",
        "maxAdults": 2,
        "maxChildren": 2,
        "maxTotalGuests": 4,
    },
]
ROOM_CATALOG = list(FALLBACK_ROOM_CATALOG)
TENANT_ID = "default"
TENANT_SLUG = DEFAULT_TENANT_SLUG
TENANT_NAME = "Unknown Tenant"
REQUEST_HEADERS: dict[str, str] = {}


@dataclass
class ProbeCase:
    name: str
    category: str
    transcript: str
    current_state: str
    expected_screens: list[str]
    expected_intents: list[str] = field(default_factory=list)
    include_room_catalog: bool = False
    filled_slots: dict[str, Any] | None = None
    notes: str = ""


@dataclass
class ProbeResult:
    name: str
    category: str
    mode: str
    verdict: str
    current_state: str
    transcript: str
    route: str
    intent: str
    confidence: Any
    speech: str
    note: str


def health_check() -> dict[str, Any]:
    payload = fetch_json("/health")
    print(f"Health: OK {json.dumps(payload)}")
    return payload


def fetch_json(
    path: str,
    payload: dict[str, Any] | None = None,
    *,
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    body: bytes | None = None
    if payload is None:
        request = urllib.request.Request(f"{BASE_URL}{path}", headers=headers or {})
    else:
        body = json.dumps(payload).encode("utf-8")
        request_headers = {"Content-Type": "application/json", **(headers or {})}
        request = urllib.request.Request(
            f"{BASE_URL}{path}",
            data=body,
            headers=request_headers,
            method="POST",
        )

    last_error: Exception | None = None
    for attempt in range(1, 3):
        try:
            if payload is None:
                active_request = urllib.request.Request(f"{BASE_URL}{path}", headers=headers or {})
            else:
                request_headers = {"Content-Type": "application/json", **(headers or {})}
                active_request = urllib.request.Request(
                    f"{BASE_URL}{path}",
                    data=body,
                    headers=request_headers,
                    method="POST",
                )
            with urllib.request.urlopen(active_request, timeout=TIMEOUT_SECONDS) as response:
                raw = response.read().decode("utf-8")
                return json.loads(raw)
        except (TimeoutError, socket.timeout) as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(2)
                continue
            raise
        except urllib.error.URLError as exc:
            last_error = exc
            if "timed out" in str(exc).lower() and attempt < 2:
                time.sleep(2)
                continue
            raise

    if last_error:
        raise last_error
    raise RuntimeError("Unknown fetch_json failure")


def _as_int(value: Any, default: int = 0) -> int:
    try:
        if value is None:
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


def _as_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _room_name(room: dict[str, Any]) -> str:
    return str(room.get("name") or "Selected Room")


def _room_price(room: dict[str, Any]) -> float:
    return _as_float(room.get("price"))


def _room_max_adults(room: dict[str, Any]) -> int:
    return _as_int(room.get("maxAdults") or room.get("maxTotalGuests"), 2)


def _room_max_children(room: dict[str, Any]) -> int:
    return _as_int(room.get("maxChildren"), 0)


def _room_total_capacity(room: dict[str, Any]) -> int:
    total = _as_int(room.get("maxTotalGuests"), 0)
    if total > 0:
        return total
    return _room_max_adults(room) + _room_max_children(room)


def _pick_budget_room() -> dict[str, Any]:
    return min(ROOM_CATALOG, key=_room_price)


def _pick_family_room() -> dict[str, Any]:
    return max(
        ROOM_CATALOG,
        key=lambda room: (
            _room_max_adults(room) >= 4 or _room_total_capacity(room) >= 4,
            _room_total_capacity(room),
            _room_max_adults(room),
            _room_price(room),
        ),
    )


def _pick_comparison_room(primary_room: dict[str, Any]) -> dict[str, Any]:
    alternatives = [
        room for room in ROOM_CATALOG if str(room.get("id") or room.get("name")) != str(primary_room.get("id") or primary_room.get("name"))
    ]
    if not alternatives:
        return primary_room
    return max(alternatives, key=_room_price)


def _room_guest_mix(
    room: dict[str, Any],
    preferred_adults: int,
    preferred_children: int = 0,
) -> tuple[int, int]:
    adults_cap = max(1, _room_max_adults(room))
    children_cap = max(0, _room_max_children(room))
    total_cap = max(1, _room_total_capacity(room))

    adults = min(max(1, preferred_adults), adults_cap)
    children = min(max(0, preferred_children), children_cap)

    while adults + children > total_cap and children > 0:
        children -= 1
    while adults + children > total_cap and adults > 1:
        adults -= 1

    return adults, children


def _future_booking_window(offset_days: int, nights: int) -> dict[str, Any]:
    check_in = RUN_BASE_DATE + timedelta(days=offset_days)
    check_out = check_in + timedelta(days=max(1, nights))
    return {
        "check_in": check_in.isoformat(),
        "check_out": check_out.isoformat(),
        "spoken_check_in": f"{check_in.strftime('%B')} {check_in.day} {check_in.year}",
        "nights": max(1, nights),
    }


def _build_filled_slots(
    room: dict[str, Any],
    *,
    adults: int,
    children: int,
    guest_name: str,
    window: dict[str, Any],
) -> dict[str, Any]:
    return {
        "roomType": _room_name(room),
        "adults": adults,
        "children": children,
        "checkInDate": window["check_in"],
        "checkOutDate": window["check_out"],
        "guestName": guest_name,
    }


def _load_probe_context() -> None:
    global ROOM_CATALOG, TENANT_ID, TENANT_SLUG, TENANT_NAME, REQUEST_HEADERS

    tenant_payload = fetch_json(f"/api/tenant?slug={DEFAULT_TENANT_SLUG}")
    tenant = tenant_payload.get("tenant") or {}
    room_payload = fetch_json(f"/api/rooms?slug={DEFAULT_TENANT_SLUG}")
    live_rooms = room_payload.get("rooms") or []

    if live_rooms:
        ROOM_CATALOG = live_rooms
    TENANT_ID = str(tenant.get("id") or TENANT_ID)
    TENANT_SLUG = str(tenant.get("slug") or DEFAULT_TENANT_SLUG)
    TENANT_NAME = str(tenant.get("name") or TENANT_NAME)
    REQUEST_HEADERS = {"x-tenant-slug": TENANT_SLUG} if TENANT_SLUG else {}

    print(
        "Tenant: OK "
        f"{json.dumps({'id': TENANT_ID, 'slug': TENANT_SLUG, 'name': TENANT_NAME, 'rooms': len(ROOM_CATALOG)})}"
    )


def truncate(text: str, max_chars: int = 180) -> str:
    clean = (text or "").replace("\n", " ").strip()
    return clean[:max_chars] + ("..." if len(clean) > max_chars else "")


def has_backend_issue(response: dict[str, Any]) -> bool:
    error_value = response.get("error")
    speech = str(response.get("speech") or "").lower()
    return bool(error_value) or "system issue" in speech


def evaluate_case(case: ProbeCase, response: dict[str, Any]) -> tuple[str, str]:
    next_screen = str(response.get("nextUiScreen") or "")
    intent = str(response.get("intent") or "")
    screen_ok = next_screen in case.expected_screens if case.expected_screens else True
    intent_ok = intent in case.expected_intents if case.expected_intents else True

    if has_backend_issue(response):
        return "WARN", f"backend_issue error={response.get('error')} speech={truncate(str(response.get('speech') or ''))}"

    if screen_ok and intent_ok:
        return "PASS", f"screen={next_screen} intent={intent}"

    return (
        "WARN",
        f"expected_screens={case.expected_screens} expected_intents={case.expected_intents} "
        f"actual_screen={next_screen} actual_intent={intent}",
    )


def make_payload(case: ProbeCase, session_id: str, filled_slots: dict[str, Any] | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "transcript": case.transcript,
        "sessionId": session_id,
        "currentState": case.current_state,
        "tenantId": TENANT_ID,
        "tenantSlug": TENANT_SLUG,
        "language": "en",
    }
    if case.include_room_catalog:
        payload["roomCatalog"] = ROOM_CATALOG
    effective_filled_slots: dict[str, Any] = dict(case.filled_slots or {})
    if filled_slots:
        effective_filled_slots.update(filled_slots)
    if effective_filled_slots:
        payload["filledSlots"] = effective_filled_slots
    return payload


def print_result(result: ProbeResult) -> None:
    print(
        f"[{result.verdict}] {result.name}\n"
        f"  category={result.category}\n"
        f"  mode={result.mode}\n"
        f"  state={result.current_state}\n"
        f"  prompt={result.transcript}\n"
        f"  route={result.route} intent={result.intent} confidence={result.confidence}\n"
        f"  speech={truncate(result.speech)}\n"
        f"  note={result.note}\n"
    )


def run_case(case: ProbeCase, index: int) -> ProbeResult:
    session_id = f"english-probe-{int(time.time())}-{index}"
    response = fetch_json("/api/chat", make_payload(case, session_id), headers=REQUEST_HEADERS)
    verdict, note = evaluate_case(case, response)
    return ProbeResult(
        name=case.name,
        category=case.category,
        mode="single_turn",
        verdict=verdict,
        current_state=case.current_state,
        transcript=case.transcript,
        route=str(response.get("nextUiScreen") or ""),
        intent=str(response.get("intent") or ""),
        confidence=response.get("confidence"),
        speech=str(response.get("speech") or ""),
        note=note,
    )


def build_single_turn_cases() -> list[ProbeCase]:
    budget_room = _pick_budget_room()
    comparison_room = _pick_comparison_room(budget_room)
    family_room = _pick_family_room()

    preview_room = family_room
    detail_adults, detail_children = _room_guest_mix(preview_room, preferred_adults=2, preferred_children=1)
    summary_adults, summary_children = _room_guest_mix(budget_room, preferred_adults=2, preferred_children=1)

    detail_window = _future_booking_window(30, 2)
    change_window = _future_booking_window(45, 3)
    summary_window = _future_booking_window(60, 2)

    return [
        ProbeCase(
            name="welcome_checkin_existing_reservation",
            category="Check-in",
            current_state="WELCOME",
            transcript="Hi, I already have a reservation and I want to check in.",
            expected_screens=["SCAN_ID"],
            expected_intents=["CHECK_IN", "CHECK_IN_SELECTED"],
            notes="Direct check-in intent from welcome screen.",
        ),
        ProbeCase(
            name="welcome_rooms_budget",
            category="Room discovery",
            current_state="WELCOME",
            transcript="Can you show me your available rooms? I need something affordable for two adults.",
            expected_screens=["ROOM_SELECT"],
            expected_intents=["BOOK_ROOM", "BOOK_ROOM_SELECTED", "ASK_PRICE"],
            include_room_catalog=True,
            notes="Customer starts browsing rooms with budget context.",
        ),
        ProbeCase(
            name="welcome_hotel_faq",
            category="Hotel FAQ",
            current_state="WELCOME",
            transcript="What time is breakfast and do you offer free Wi-Fi?",
            expected_screens=["WELCOME"],
            expected_intents=["GENERAL_QUERY", "HELP"],
            notes="General hotel info without a booking action.",
        ),
        ProbeCase(
            name="welcome_family_room_request",
            category="Room discovery",
            current_state="WELCOME",
            transcript="We are a family of four. Which room should we look at?",
            expected_screens=["ROOM_SELECT"],
            expected_intents=["BOOK_ROOM", "BOOK_ROOM_SELECTED"],
            include_room_catalog=True,
            notes="Family-fit room recommendation request.",
        ),
        ProbeCase(
            name="room_select_cheapest_room",
            category="Pricing",
            current_state="ROOM_SELECT",
            transcript="What is your cheapest room tonight?",
            expected_screens=["ROOM_SELECT", "ROOM_PREVIEW"],
            expected_intents=["ASK_PRICE", "BOOK_ROOM", "GENERAL_QUERY"],
            include_room_catalog=True,
            notes="Price-sensitive question during room selection.",
        ),
        ProbeCase(
            name="room_select_compare_rooms",
            category="Comparison",
            current_state="ROOM_SELECT",
            transcript=f"Can you compare the {_room_name(budget_room)} and the {_room_name(comparison_room)} for me?",
            expected_screens=["ROOM_SELECT", "ROOM_PREVIEW"],
            expected_intents=["COMPARE_ROOMS", "GENERAL_QUERY", "BOOK_ROOM"],
            include_room_catalog=True,
            notes="Side-by-side comparison request.",
        ),
        ProbeCase(
            name="room_preview_amenity_question",
            category="Room preview",
            current_state="ROOM_PREVIEW",
            transcript="Does this room have a balcony or a city view?",
            expected_screens=["ROOM_PREVIEW"],
            expected_intents=["GENERAL_QUERY"],
            include_room_catalog=True,
            filled_slots={"roomType": _room_name(preview_room)},
            notes="Preview-specific amenity question should stay anchored to the selected room.",
        ),
        ProbeCase(
            name="room_preview_change_room",
            category="Room preview",
            current_state="ROOM_PREVIEW",
            transcript="Show me a different room option instead.",
            expected_screens=["ROOM_SELECT", "ROOM_PREVIEW"],
            expected_intents=["SELECT_ROOM", "MODIFY_BOOKING", "ROOM_SELECTED"],
            include_room_catalog=True,
            filled_slots={"roomType": _room_name(preview_room)},
            notes="Customer asks to switch away from the current room.",
        ),
        ProbeCase(
            name="booking_collect_full_details",
            category="Booking collection",
            current_state="BOOKING_COLLECT",
            transcript=(
                f"My name is John Carter. There will be {detail_adults} adults"
                + (f" and {detail_children} child{'ren' if detail_children != 1 else ''}" if detail_children > 0 else "")
                + f". We want to check in on {detail_window['spoken_check_in']} for {detail_window['nights']} nights."
            ),
            expected_screens=["BOOKING_SUMMARY"],
            expected_intents=["GENERAL_QUERY", "PROVIDE_NAME", "PROVIDE_DATES", "PROVIDE_GUESTS", "CONFIRM_BOOKING"],
            include_room_catalog=True,
            filled_slots={"roomType": _room_name(preview_room)},
            notes="Combined slot filling in one turn.",
        ),
        ProbeCase(
            name="booking_collect_change_dates",
            category="Booking collection",
            current_state="BOOKING_COLLECT",
            transcript=f"Actually change the stay to {change_window['spoken_check_in']} for {change_window['nights']} nights.",
            expected_screens=["BOOKING_COLLECT", "BOOKING_SUMMARY"],
            expected_intents=["MODIFY_BOOKING", "PROVIDE_DATES", "GENERAL_QUERY"],
            include_room_catalog=True,
            filled_slots={
                "roomType": _room_name(preview_room),
                "adults": detail_adults,
                "guestName": "John Carter",
            },
            notes="Edit request during collection should preserve flow context.",
        ),
        ProbeCase(
            name="booking_summary_confirm_payment",
            category="Booking summary",
            current_state="BOOKING_SUMMARY",
            transcript="Yes, those details are correct. Please proceed to payment.",
            expected_screens=["PAYMENT"],
            expected_intents=["CONFIRM_BOOKING"],
            include_room_catalog=True,
            filled_slots=_build_filled_slots(
                budget_room,
                adults=summary_adults,
                children=summary_children,
                guest_name="John Carter",
                window=summary_window,
            ),
            notes="Confirmation should ideally advance to payment.",
        ),
        ProbeCase(
            name="booking_summary_modify_request",
            category="Booking summary",
            current_state="BOOKING_SUMMARY",
            transcript="I need to change the guest name before paying.",
            expected_screens=["BOOKING_COLLECT"],
            expected_intents=["MODIFY_BOOKING"],
            include_room_catalog=True,
            filled_slots=_build_filled_slots(
                budget_room,
                adults=summary_adults,
                children=summary_children,
                guest_name="John Carter",
                window=summary_window,
            ),
            notes="Modify request from summary should return to booking collection.",
        ),
    ]


def build_flow_cases() -> list[ProbeCase]:
    family_room = _pick_family_room()
    family_adults, family_children = _room_guest_mix(family_room, preferred_adults=4, preferred_children=0)
    flow_window = _future_booking_window(90, 2)

    return [
        ProbeCase(
            name="flow_step_1_browse_rooms",
            category="Flow booking journey",
            current_state="WELCOME",
            transcript=(
                f"We are {family_adults} adults"
                + (f" and {family_children} child{'ren' if family_children != 1 else ''}" if family_children > 0 else "")
                + ". Which room should we look at?"
            ),
            expected_screens=["ROOM_SELECT"],
            expected_intents=["BOOK_ROOM", "BOOK_ROOM_SELECTED"],
            include_room_catalog=True,
        ),
        ProbeCase(
            name="flow_step_2_select_family_suite",
            category="Flow booking journey",
            current_state="ROOM_SELECT",
            transcript=f"Please show me the {_room_name(family_room)}.",
            expected_screens=["ROOM_PREVIEW"],
            expected_intents=["ROOM_SELECTED", "BOOK_ROOM", "SELECT_ROOM"],
            include_room_catalog=True,
        ),
        ProbeCase(
            name="flow_step_3_start_booking",
            category="Flow booking journey",
            current_state="ROOM_PREVIEW",
            transcript="This looks good. I want to book this room.",
            expected_screens=["BOOKING_COLLECT"],
            expected_intents=["CONFIRM_BOOKING", "BOOK_ROOM", "ROOM_SELECTED"],
            include_room_catalog=True,
        ),
        ProbeCase(
            name="flow_step_4_fill_details",
            category="Flow booking journey",
            current_state="BOOKING_COLLECT",
            transcript=(
                f"My name is John Carter. There will be {family_adults} adults"
                + (f" and {family_children} child{'ren' if family_children != 1 else ''}" if family_children > 0 else "")
                + f". We want to check in on {flow_window['spoken_check_in']} for {flow_window['nights']} nights."
            ),
            expected_screens=["BOOKING_SUMMARY"],
            expected_intents=["GENERAL_QUERY", "PROVIDE_NAME", "PROVIDE_GUESTS", "PROVIDE_DATES", "CONFIRM_BOOKING"],
            include_room_catalog=True,
        ),
        ProbeCase(
            name="flow_step_5_confirm_summary",
            category="Flow booking journey",
            current_state="BOOKING_SUMMARY",
            transcript="Yes, everything is correct. Proceed to payment.",
            expected_screens=["PAYMENT"],
            expected_intents=["CONFIRM_BOOKING"],
            include_room_catalog=True,
        ),
    ]


def run_booking_flow() -> list[ProbeResult]:
    print("Booking Flow:")
    session_id = f"english-booking-flow-{int(time.time())}"
    current_state = "WELCOME"
    filled_slots: dict[str, Any] | None = None
    results: list[ProbeResult] = []

    for step in build_flow_cases():
        live_case = ProbeCase(
            name=step.name,
            category=step.category,
            transcript=step.transcript,
            current_state=current_state,
            expected_screens=step.expected_screens,
            expected_intents=step.expected_intents,
            include_room_catalog=step.include_room_catalog,
            notes=step.notes,
        )

        try:
            response = fetch_json("/api/chat", make_payload(live_case, session_id, filled_slots), headers=REQUEST_HEADERS)
            verdict, note = evaluate_case(live_case, response)
            result = ProbeResult(
                name=live_case.name,
                category=live_case.category,
                mode="multi_turn_flow",
                verdict=verdict,
                current_state=current_state,
                transcript=live_case.transcript,
                route=str(response.get("nextUiScreen") or ""),
                intent=str(response.get("intent") or ""),
                confidence=response.get("confidence"),
                speech=str(response.get("speech") or ""),
                note=note,
            )
            print_result(result)
            results.append(result)
            current_state = result.route or current_state
            filled_slots = response.get("accumulatedSlots") or filled_slots
        except urllib.error.HTTPError as exc:
            error_body = exc.read().decode("utf-8", errors="replace")
            result = ProbeResult(
                name=live_case.name,
                category=live_case.category,
                mode="multi_turn_flow",
                verdict="FAIL",
                current_state=current_state,
                transcript=live_case.transcript,
                route="",
                intent="",
                confidence="",
                speech=error_body,
                note=f"http={exc.code}",
            )
            print_result(result)
            results.append(result)
            break
        except Exception as exc:  # pragma: no cover - live script
            result = ProbeResult(
                name=live_case.name,
                category=live_case.category,
                mode="multi_turn_flow",
                verdict="FAIL",
                current_state=current_state,
                transcript=live_case.transcript,
                route="",
                intent="",
                confidence="",
                speech=str(exc),
                note="runtime_error",
            )
            print_result(result)
            results.append(result)
            break

    return results


def build_summary(results: list[ProbeResult]) -> dict[str, int]:
    summary = {"total": 0, "pass": 0, "warn": 0, "fail": 0}
    for result in results:
        summary["total"] += 1
        key = result.verdict.lower()
        if key in summary:
            summary[key] += 1
    return summary


def build_findings(results: list[ProbeResult]) -> list[str]:
    findings: list[str] = []

    if any(r.name == "room_preview_amenity_question" and r.verdict != "PASS" for r in results):
        findings.append("Room-preview detail questions are not consistently staying in ROOM_PREVIEW, which can break the sense of a focused room tour.")
    if any(r.name == "booking_collect_full_details" and r.verdict != "PASS" for r in results):
        findings.append("Combined booking-detail turns are not reliably reaching BOOKING_SUMMARY, which means the kiosk still loses booking continuity on multi-slot answers.")
    if any(r.name == "flow_step_2_select_family_suite" and r.verdict != "PASS" for r in results):
        findings.append("Named room selection is not staying preview-first, so the kiosk may still skip the intended room preview experience.")
    if any(r.name == "flow_step_3_start_booking" and r.verdict != "PASS" for r in results):
        findings.append("Explicit room-confirmation phrases from ROOM_PREVIEW are not consistently starting BOOKING_COLLECT.")
    if any(r.name == "booking_summary_confirm_payment" and r.verdict != "PASS" for r in results):
        findings.append("Summary confirmation is not reliably advancing to PAYMENT, so the final conversion step is still unstable.")
    if any(r.name == "booking_summary_modify_request" and r.verdict != "PASS" for r in results):
        findings.append("Summary edit requests are not reliably staying inside BOOKING_COLLECT, so guests may still be pushed out of the edit path.")
    if any("system issue" in r.speech.lower() for r in results):
        findings.append("The backend sometimes returns a user-facing 'system issue' message instead of completing the flow, which needs a stronger recovery path.")
    if not findings:
        findings.append("No major behavior regressions were observed in this run.")

    return findings


def write_report(health: dict[str, Any], results: list[ProbeResult], summary: dict[str, int]) -> None:
    findings = build_findings(results)
    lines = [
        "# English Prompt Behavior Report",
        "",
        f"- Generated at: {datetime.now().isoformat(timespec='seconds')}",
        f"- Base URL: `{BASE_URL}`",
        f"- Health payload: `{json.dumps(health)}`",
        f"- Tenant tested: `{TENANT_NAME}` (`{TENANT_SLUG}`)",
        f"- Tenant ID: `{TENANT_ID}`",
        f"- Live room inventory: `{', '.join(room.get('name', 'Unknown Room') for room in ROOM_CATALOG[:6])}`",
        "",
        "## Summary",
        "",
        f"- Total scenarios: {summary['total']}",
        f"- Pass: {summary['pass']}",
        f"- Warn: {summary['warn']}",
        f"- Fail: {summary['fail']}",
        "",
        "## Key Findings",
        "",
    ]

    for finding in findings:
        lines.append(f"- {finding}")

    lines.extend(
        [
            "",
            "## Scenario Results",
            "",
            "| Verdict | Mode | Category | State | Prompt | Route | Intent | Note |",
            "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
    )

    for result in results:
        prompt = truncate(result.transcript, 90).replace("|", "/")
        note = truncate(result.note, 90).replace("|", "/")
        route = (result.route or "-").replace("|", "/")
        intent = (result.intent or "-").replace("|", "/")
        lines.append(
            f"| {result.verdict} | {result.mode} | {result.category} | {result.current_state} | "
            f"{prompt} | {route} | {intent} | {note} |"
        )

    lines.extend(["", "## Detailed Responses", ""])

    for result in results:
        lines.extend(
            [
                f"### {result.name}",
                "",
                f"- Verdict: {result.verdict}",
                f"- Mode: {result.mode}",
                f"- Category: {result.category}",
                f"- Input state: `{result.current_state}`",
                f"- Prompt: \"{result.transcript}\"",
                f"- Route: `{result.route or '-'}`",
                f"- Intent: `{result.intent or '-'}`",
                f"- Confidence: `{result.confidence}`",
                f"- Speech: \"{truncate(result.speech, 300)}\"",
                f"- Note: {result.note}",
                "",
            ]
        )

    REPORT_PATH.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    try:
        health = health_check()
    except Exception as exc:  # pragma: no cover - live script
        print(f"Health: FAIL {exc}")
        return 1

    try:
        _load_probe_context()
    except Exception as exc:  # pragma: no cover - live script
        print(f"Tenant: FAIL {exc}")
        return 1

    results: list[ProbeResult] = []

    print("Single Turn Routing:\n")
    for idx, case in enumerate(build_single_turn_cases(), start=1):
        try:
            result = run_case(case, idx)
        except urllib.error.HTTPError as exc:
            error_body = exc.read().decode("utf-8", errors="replace")
            result = ProbeResult(
                name=case.name,
                category=case.category,
                mode="single_turn",
                verdict="FAIL",
                current_state=case.current_state,
                transcript=case.transcript,
                route="",
                intent="",
                confidence="",
                speech=error_body,
                note=f"http={exc.code}",
            )
        except Exception as exc:  # pragma: no cover - live script
            result = ProbeResult(
                name=case.name,
                category=case.category,
                mode="single_turn",
                verdict="FAIL",
                current_state=case.current_state,
                transcript=case.transcript,
                route="",
                intent="",
                confidence="",
                speech=str(exc),
                note="runtime_error",
            )
        print_result(result)
        results.append(result)

    results.extend(run_booking_flow())

    summary = build_summary(results)
    print("Summary:")
    print(f"  total={summary['total']}")
    print(f"  pass={summary['pass']}")
    print(f"  warn={summary['warn']}")
    print(f"  fail={summary['fail']}")

    write_report(health, results, summary)
    print(f"Report written to: {REPORT_PATH}")
    return 0 if summary["fail"] == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
