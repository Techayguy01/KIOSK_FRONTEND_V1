"""
core/database.py

Async database connection manager using SQLModel and asyncpg.
Connects to the preexisting Neon PostgreSQL database.
"""

import os
import socket
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlmodel.ext.asyncio.session import AsyncSession
from dotenv import load_dotenv

load_dotenv()

def _normalize_database_url(raw_url: str) -> str:
    database_url = (raw_url or "").strip().strip('"').strip("'")
    if database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if database_url and "?" in database_url:
        database_url = database_url.split("?", 1)[0]
    return database_url


DATABASE_URL = _normalize_database_url(os.getenv("DATABASE_URL", ""))
DIRECT_URL = _normalize_database_url(os.getenv("DIRECT_URL", ""))


def _build_sessionmaker(database_url: str | None):
    if not database_url:
        return None
    engine = create_async_engine(
        database_url,
        echo=False,
        pool_size=5,
        max_overflow=10,
        pool_pre_ping=True,
        pool_recycle=900,
        connect_args={"ssl": True},
    )
    return async_sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )


AsyncSessionLocal = _build_sessionmaker(DATABASE_URL)
FallbackAsyncSessionLocal = _build_sessionmaker(DIRECT_URL if DIRECT_URL != DATABASE_URL else "")
_preferred_sessionmaker = "primary"


def _is_host_resolution_error(exc: Exception) -> bool:
    text_value = str(exc or "").lower()
    return isinstance(exc, socket.gaierror) or "getaddrinfo failed" in text_value or "name or service not known" in text_value


async def _sessionmaker_works(session_factory) -> bool:
    if not session_factory:
        return False
    try:
        async with session_factory() as session:
            await session.execute(text("SELECT 1"))
        return True
    except Exception as exc:
        if _is_host_resolution_error(exc):
            return False
        raise

async def get_session() -> AsyncSession:
    """FastAPI dependency for getting an async DB session."""
    global _preferred_sessionmaker

    if not AsyncSessionLocal and not FallbackAsyncSessionLocal:
        raise RuntimeError("DATABASE_URL is not set or engine not initialized.")

    session_factory = AsyncSessionLocal if _preferred_sessionmaker == "primary" else FallbackAsyncSessionLocal
    if session_factory is None:
        session_factory = AsyncSessionLocal or FallbackAsyncSessionLocal

    try:
        if session_factory and await _sessionmaker_works(session_factory):
            async with session_factory() as session:
                yield session
            return
    except Exception:
        raise

    alternate_factory = FallbackAsyncSessionLocal if session_factory is AsyncSessionLocal else AsyncSessionLocal
    if alternate_factory and await _sessionmaker_works(alternate_factory):
        _preferred_sessionmaker = "fallback" if alternate_factory is FallbackAsyncSessionLocal else "primary"
        async with alternate_factory() as session:
            yield session
        return

    async with (session_factory or alternate_factory)() as session:
        yield session
