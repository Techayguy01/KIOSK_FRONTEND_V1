"""
Safely backfill room capacity columns without truncating data.

Usage:
    python backfill_room_capacities.py
    python backfill_room_capacities.py --apply

Default mode is dry-run. Edit ROOM_CAPACITY_MAP to match your actual room names.
"""

import asyncio
import sys
from typing import Optional

from sqlalchemy import text

from core.database import AsyncSessionLocal


ROOM_CAPACITY_MAP = {
    "superior room": {"max_adults": 2, "max_children": 1, "max_total_guests": 3},
    "itc one room": {"max_adults": 2, "max_children": 1, "max_total_guests": 3},
    "premier room with semi-private pool": {"max_adults": 2, "max_children": 1, "max_total_guests": 3},
    "ocean z": {"max_adults": 2, "max_children": 1, "max_total_guests": 3},
    "standard room": {"max_adults": 2, "max_children": 1, "max_total_guests": 3},
    "deluxe room": {"max_adults": 3, "max_children": 1, "max_total_guests": 4},
    "grand chola suite": {"max_adults": 3, "max_children": 1, "max_total_guests": 4},
    "kohinoor suite": {"max_adults": 3, "max_children": 1, "max_total_guests": 4},
    "luxury suite": {"max_adults": 3, "max_children": 1, "max_total_guests": 4},
    "luxury suite with private pool": {"max_adults": 3, "max_children": 1, "max_total_guests": 4},
    "royal suite": {"max_adults": 3, "max_children": 1, "max_total_guests": 4},
    "grand presidential suite": {"max_adults": 4, "max_children": 2, "max_total_guests": 6},
}


def normalize_room_name(value: Optional[str]) -> str:
    return " ".join(str(value or "").strip().lower().split())


async def main() -> None:
    if not AsyncSessionLocal:
        raise RuntimeError("DATABASE_URL is not set.")

    apply_changes = "--apply" in sys.argv

    async with AsyncSessionLocal() as session:
        result = await session.exec(
            text(
                """
                SELECT id, name
                FROM room_types
                ORDER BY name ASC
                """
            )
        )
        rooms = result.all()

        if not rooms:
            print("No room_types rows found.")
            return

        updated_count = 0
        skipped_count = 0

        for room in rooms:
            room_id = str(room._mapping.get("id"))
            room_name = str(room._mapping.get("name") or "").strip()
            normalized_name = normalize_room_name(room_name)
            capacity = ROOM_CAPACITY_MAP.get(normalized_name)

            if not capacity:
                skipped_count += 1
                print(f"[SKIP] {room_name}: no capacity mapping configured")
                continue

            print(
                f"[MATCH] {room_name}: "
                f"adults={capacity['max_adults']} "
                f"children={capacity['max_children']} "
                f"total={capacity['max_total_guests']}"
            )

            if apply_changes:
                await session.exec(
                    text(
                        """
                        UPDATE room_types
                        SET
                            max_adults = :max_adults,
                            max_children = :max_children,
                            max_total_guests = :max_total_guests
                        WHERE id = CAST(:room_id AS uuid)
                        """
                    ),
                    params={
                        "room_id": room_id,
                        "max_adults": capacity["max_adults"],
                        "max_children": capacity["max_children"],
                        "max_total_guests": capacity["max_total_guests"],
                    },
                )
                updated_count += 1

        if apply_changes:
            await session.commit()
            print(f"Applied capacity updates to {updated_count} rooms.")
        else:
            print("Dry run only. Re-run with --apply to persist changes.")

        print(f"Skipped {skipped_count} rooms without mappings.")


if __name__ == "__main__":
    asyncio.run(main())
