"""
api/faq.py

Expose FAQs for a given tenant slug.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlmodel import select

from core.database import get_session
from models.faq import FAQ
from models.tenant import Tenant

router = APIRouter()


@router.get("/{tenant_slug}/faqs")
async def get_faqs(
    tenant_slug: str,
    session: AsyncSession = Depends(get_session)
):
    """
    Fetch active FAQs for a specific tenant (resolved by slug).
    """
    try:
        tenant_result = await session.exec(select(Tenant).where(Tenant.slug == tenant_slug))
        tenant = tenant_result.first()
        if not tenant:
            raise HTTPException(status_code=404, detail=f"Tenant '{tenant_slug}' not found")

        statement = select(FAQ).where(
            FAQ.tenant_id == tenant.id,
            FAQ.is_active == True
        )
        result = await session.exec(statement)
        faqs = result.all()

        return {
            "success": True,
            "data": [
                {
                    "id": str(faq.id),
                    "tenant_id": str(faq.tenant_id),
                    "question": faq.question,
                    "answer": faq.answer,
                }
                for faq in faqs
            ]
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"[FAQAPI] ❌ Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Failed to fetch FAQs")
