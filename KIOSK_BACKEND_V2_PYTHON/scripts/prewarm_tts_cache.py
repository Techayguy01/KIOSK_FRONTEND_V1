"""
Prewarm premium TTS cache entries for deterministic kiosk prompts.

This script is intentionally one-way: it only generates and stores audio ahead
of time. It does not alter booking logic, screen flow, or runtime routing.
"""

from __future__ import annotations

import argparse
import asyncio
import itertools
import sys
from collections import Counter
from pathlib import Path
from typing import Iterable

from sqlalchemy import text
from sqlmodel import select

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

for stream_name in ("stdout", "stderr"):
    stream = getattr(sys, stream_name, None)
    if stream and hasattr(stream, "reconfigure"):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

from agent.nodes import (  # noqa: E402
    _build_room_comparison_prompt,
    _build_room_confirmation,
    _build_room_intro_speech_single,
    _build_room_preview_intro,
    _build_room_recommendation_prompt,
    _fallback_booking_prompt,
    _pick_language_text,
)
from agent.state import RoomInventoryItem  # noqa: E402
from core.database import AsyncSessionLocal  # noqa: E402
from core.voice import VoiceProvider, normalize_language_code, normalize_language_list  # noqa: E402
from models.tenant import Tenant  # noqa: E402
from models.tenant_config import TenantConfig  # noqa: E402


def _build_welcome_prompt(hotel_name: str, language: str) -> str:
    name = hotel_name or "our hotel"
    return _pick_language_text(
        language,
        en=f"Welcome to {name}. I'm Siya, your hotel assistant. I can help you check in, explore rooms, or guide you through a booking. How may I help you today?",
        hi=f"{name} में आपका स्वागत है. मैं सिया हूँ. मैं check in, rooms explore करने, और booking में आपकी मदद कर सकती हूँ. आज मैं आपकी कैसे सहायता कर सकती हूँ?",
        mr=f"{name} मध्ये तुमचे स्वागत आहे. मी सिया आहे. मी check in, rooms explore करणे, आणि booking मध्ये मदत करू शकते. आज मी तुमची कशी मदत करू शकते?",
    )


def _build_summary_prompt(language: str) -> str:
    return _pick_language_text(
        language,
        en="Review the summary and say confirm booking when ready.",
        hi="Summary देख लीजिए और तैयार होने पर confirm booking कहिए.",
        mr="Summary पाहा आणि तयार झाल्यावर confirm booking म्हणा.",
    )


def _build_payment_prompt(language: str) -> str:
    return _pick_language_text(
        language,
        en="Please complete your payment.",
        hi="कृपया अपना payment complete कीजिए.",
        mr="कृपया payment complete करा.",
    )


def _dedupe_prompts(prompts: Iterable[tuple[str, str]]) -> list[tuple[str, str]]:
    seen: set[str] = set()
    unique: list[tuple[str, str]] = []
    for label, prompt in prompts:
        normalized = str(prompt or "").strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        unique.append((label, normalized))
    return unique


async def _load_tenant_config(session, tenant_id) -> TenantConfig | None:
    result = await session.exec(select(TenantConfig).where(TenantConfig.tenant_id == tenant_id))
    return result.first()


async def _load_room_inventory(session, tenant_id) -> list[RoomInventoryItem]:
    cols_result = await session.exec(
        text("SELECT column_name FROM information_schema.columns WHERE table_name = 'room_types'")
    )
    available_columns = {row[0] for row in cols_result.all()}

    select_fields = ["id", "name", "code", "price"]
    if "amenities" in available_columns:
        select_fields.append("amenities")
    for optional_col in ("max_adults", "max_children", "max_total_guests"):
        if optional_col in available_columns:
            select_fields.append(optional_col)

    rooms_result = await session.exec(
        text(f"SELECT {', '.join(select_fields)} FROM room_types WHERE tenant_id = CAST(:tenant_id AS uuid)"),
        params={"tenant_id": str(tenant_id)},
    )
    return [
        RoomInventoryItem(
            id=str(row._mapping.get("id")),
            name=row._mapping.get("name"),
            code=row._mapping.get("code"),
            price=float(row._mapping.get("price")) if row._mapping.get("price") is not None else None,
            currency="INR",
            features=list(row._mapping.get("amenities") or []),
            maxAdults=row._mapping.get("max_adults"),
            maxChildren=row._mapping.get("max_children"),
            maxTotalGuests=row._mapping.get("max_total_guests"),
        )
        for row in rooms_result.all()
    ]


def _resolve_languages(
    requested_languages: list[str],
    tenant_config: TenantConfig | None,
) -> list[str]:
    if requested_languages:
        return normalize_language_list(requested_languages)
    if tenant_config and tenant_config.available_lang:
        return normalize_language_list(tenant_config.available_lang)
    if tenant_config and tenant_config.default_lang:
        return [normalize_language_code(tenant_config.default_lang)]
    return ["en"]


def _build_prompt_catalog(
    hotel_name: str,
    room_inventory: list[RoomInventoryItem],
    language: str,
    include_comparisons: bool,
) -> list[tuple[str, str]]:
    prompts: list[tuple[str, str]] = []
    prompts.append(("welcome", _build_welcome_prompt(hotel_name, language)))
    prompts.append(("room_recommendation", _build_room_recommendation_prompt(room_inventory, language)))

    for room in room_inventory:
        prompts.append((f"room_intro:{room.name}", _build_room_intro_speech_single(room, language)))
        prompts.append((f"room_confirmation:{room.name}", _build_room_confirmation(room, language)))
        prompts.append((f"room_preview:{room.name}", _build_room_preview_intro(room, language)))
        prompts.append(
            (
                f"booking_adults:{room.name}",
                _fallback_booking_prompt("adults", room.name, room_inventory, language),
            )
        )

    for slot in ("adults", "children", "check_in_date", "check_out_date", "guest_name"):
        prompts.append((f"booking_slot:{slot}", _fallback_booking_prompt(slot, None, room_inventory, language)))

    prompts.append(("booking_summary", _build_summary_prompt(language)))
    prompts.append(("payment", _build_payment_prompt(language)))

    if include_comparisons:
        for room_a, room_b in itertools.combinations(room_inventory, 2):
            prompts.append(
                (
                    f"room_compare:{room_a.name}:{room_b.name}",
                    _build_room_comparison_prompt([room_a, room_b], language),
                )
            )

    return _dedupe_prompts(prompts)


async def _load_target_tenants(session, tenant_slug: str | None) -> list[Tenant]:
    if tenant_slug:
        result = await session.exec(select(Tenant).where(Tenant.slug == tenant_slug))
        tenant = result.first()
        return [tenant] if tenant else []
    result = await session.exec(select(Tenant).where(Tenant.status == True))  # noqa: E712
    return result.all()


async def _run(args: argparse.Namespace) -> int:
    if AsyncSessionLocal is None:
        print("[PrewarmTTS] DATABASE_URL is not configured; cannot load tenants.")
        return 1

    async with AsyncSessionLocal() as session:
        tenants = await _load_target_tenants(session, args.tenant_slug)
        if not tenants:
            print(f"[PrewarmTTS] No tenant found for slug={args.tenant_slug!r}.")
            return 1

        total_prompts = 0
        total_counter: Counter[str] = Counter()

        for tenant in tenants:
            tenant_config = await _load_tenant_config(session, tenant.id)
            room_inventory = await _load_room_inventory(session, tenant.id)
            languages = _resolve_languages(args.languages, tenant_config)

            print(
                f"[PrewarmTTS] tenant={tenant.slug} hotel={tenant.hotel_name!r} "
                f"rooms={len(room_inventory)} languages={languages}"
            )

            for language in languages:
                prompts = _build_prompt_catalog(
                    hotel_name=tenant.hotel_name,
                    room_inventory=room_inventory,
                    language=language,
                    include_comparisons=not args.skip_comparisons,
                )
                print(f"[PrewarmTTS] language={language} prompts={len(prompts)}")
                total_prompts += len(prompts)

                for index, (label, prompt) in enumerate(prompts, start=1):
                    if args.dry_run:
                        print(f"  [DRY] {index:03d} {label} :: {prompt[:120]}")
                        continue
                    result = VoiceProvider.generate_speech(
                        text=prompt,
                        language=language,
                        tenant_scope=tenant.slug,
                        request_id=f"warm-{tenant.slug[:8]}-{language}-{index}",
                    )
                    total_counter[result.cache_status] += 1
                    print(
                        f"  [WARM] {index:03d} {label} "
                        f"cache={result.cache_status} bytes={len(result.audio_bytes)}"
                    )

        if args.dry_run:
            print(f"[PrewarmTTS] Dry run complete. prompts={total_prompts}")
        else:
            print(f"[PrewarmTTS] Complete. prompts={total_prompts} stats={dict(total_counter)}")
        return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Prewarm persistent premium TTS cache entries.")
    parser.add_argument("--tenant-slug", help="Warm only one tenant slug. Defaults to all active tenants.")
    parser.add_argument(
        "--languages",
        nargs="*",
        default=[],
        help="Optional language list such as: en hi mr. Defaults to tenant config languages.",
    )
    parser.add_argument(
        "--skip-comparisons",
        action="store_true",
        help="Skip room-pair comparison prompts to keep warmup smaller.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the prompts that would be warmed without calling Sarvam.",
    )
    args = parser.parse_args()
    return asyncio.run(_run(args))


if __name__ == "__main__":
    raise SystemExit(main())
