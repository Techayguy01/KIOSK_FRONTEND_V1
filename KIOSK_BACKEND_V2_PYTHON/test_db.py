import asyncio
from sqlmodel import select
from core.database import AsyncSessionLocal
from models.tenant import Tenant
from models.room import RoomType
import traceback

async def test_db():
    with open("db_test_out.txt", "w", encoding="utf-8") as f:
        try:
            f.write("Connecting to Neon DB...\n")
            async with AsyncSessionLocal() as session:
                # Get first tenant
                result = await session.exec(select(Tenant))
                tenant = result.first()
                
                if not tenant:
                    f.write("❌ No tenants found in database!\n")
                    return
                    
                f.write(f"✅ Found Tenant: {tenant.hotel_name} (ID: {tenant.id})\n")
                
                # Get rooms for this tenant
                room_result = await session.exec(select(RoomType).where(RoomType.tenant_id == tenant.id))
                rooms = room_result.all()
                
                f.write(f"✅ Found {len(rooms)} room types:\n")
                for r in rooms:
                    f.write(f"   - {r.name} (${r.price})\n")
        except Exception as e:
            f.write(f"❌ ERROR: {e}\n")
            f.write(traceback.format_exc())

if __name__ == "__main__":
    asyncio.run(test_db())
