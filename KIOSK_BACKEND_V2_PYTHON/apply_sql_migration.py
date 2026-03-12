"""
Apply a SQL migration file against the configured async database.

Usage:
    python apply_sql_migration.py migrations/2026_03_12_add_room_capacity_columns.sql
"""

import asyncio
import sys
from pathlib import Path

from sqlalchemy import text

from core.database import AsyncSessionLocal


async def main() -> None:
    if not AsyncSessionLocal:
        raise RuntimeError("DATABASE_URL is not set.")

    if len(sys.argv) < 2:
        raise RuntimeError("Pass the migration file path.")

    migration_path = Path(sys.argv[1])
    if not migration_path.exists():
        raise FileNotFoundError(f"Migration file not found: {migration_path}")

    sql = migration_path.read_text(encoding="utf-8").strip()
    if not sql:
        raise RuntimeError(f"Migration file is empty: {migration_path}")

    async with AsyncSessionLocal() as session:
        await session.exec(text(sql))
        await session.commit()

    print(f"Applied migration: {migration_path}")


if __name__ == "__main__":
    asyncio.run(main())
