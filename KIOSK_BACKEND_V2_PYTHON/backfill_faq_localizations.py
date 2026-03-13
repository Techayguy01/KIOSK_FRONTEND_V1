"""
Backfill missing FAQ localization rows for each tenant's supported languages.

Usage:
    python backfill_faq_localizations.py
"""

import asyncio

from sqlmodel import select

from core.database import AsyncSessionLocal
from models.faq import FAQ
from models.tenant_config import TenantConfig
from services.faq_localization_service import ensure_faq_localizations


async def main() -> None:
    if not AsyncSessionLocal:
        raise RuntimeError("DATABASE_URL is not set.")

    async with AsyncSessionLocal() as session:
        faq_result = await session.exec(select(FAQ))
        faqs = faq_result.all()

        tenant_config_result = await session.exec(select(TenantConfig))
        tenant_configs = {
            str(config.tenant_id): config
            for config in tenant_config_result.all()
        }

        created_count = 0
        updated_count = 0

        for faq in faqs:
            tenant_config = tenant_configs.get(str(faq.tenant_id))
            changed = await ensure_faq_localizations(
                session,
                faq,
                available_languages=tenant_config.available_lang if tenant_config else None,
                requested_language=tenant_config.default_lang if tenant_config else None,
            )
            if changed:
                updated_count += 1
                created_count += 1

        await session.commit()
        print(
            f"FAQ localization backfill complete. "
            f"Created={created_count} Updated={updated_count} TotalFAQs={len(faqs)}"
        )


if __name__ == "__main__":
    asyncio.run(main())
