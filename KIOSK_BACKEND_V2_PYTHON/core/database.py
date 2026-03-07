"""
core/database.py

Async database connection manager using SQLModel and asyncpg.
Connects to the preexisting Neon PostgreSQL database.
"""

import os
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlmodel.ext.asyncio.session import AsyncSession
from dotenv import load_dotenv

load_dotenv()

# We need the asyncpg driver, so we replace postgresql:// with postgresql+asyncpg://
DATABASE_URL = os.getenv("DATABASE_URL", "")
if DATABASE_URL and DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)

# asyncpg does NOT support ANY psycopg2-style URL query params (sslmode, channel_binding, etc.)
# Strip the entire query string and pass ssl=True via connect_args instead.
if DATABASE_URL and "?" in DATABASE_URL:
    DATABASE_URL = DATABASE_URL.split("?")[0]

engine = None
AsyncSessionLocal = None

if DATABASE_URL:
    engine = create_async_engine(
        DATABASE_URL,
        echo=False,
        pool_size=5,
        max_overflow=10,
        connect_args={"ssl": True},  # Neon requires SSL; asyncpg uses this instead of sslmode
    )
    AsyncSessionLocal = async_sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

async def get_session() -> AsyncSession:
    """FastAPI dependency for getting an async DB session."""
    if not AsyncSessionLocal:
        raise RuntimeError("DATABASE_URL is not set or engine not initialized.")
    async with AsyncSessionLocal() as session:
        yield session
