from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from api.chat import router as chat_router
from api.checkin import router as checkin_router
from api.voice import router as voice_router
from api.rooms import router as rooms_router
from api.tenant import router as tenant_router
from api.ocr import router as ocr_router
from api.faqs import router as faqs_router
from api.utility import router as utility_router

app = FastAPI(
    title="Kiosk AI Backend V2",
    description="Production-grade AI orchestration for hotel kiosks",
    version="2.0.0"
)

# CORS configuration to allow the React frontend to communicate with Python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with the exact frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(chat_router, prefix="/api", tags=["Chat"])
app.include_router(checkin_router, prefix="/api", tags=["CheckIn"])
app.include_router(voice_router, prefix="/api/voice", tags=["Voice"])
app.include_router(rooms_router, prefix="/api", tags=["Rooms"])
app.include_router(tenant_router, prefix="/api", tags=["Tenant"])
app.include_router(ocr_router, prefix="/api", tags=["OCR"])
app.include_router(faqs_router, prefix="/api", tags=["FAQs"])
app.include_router(utility_router, prefix="/api/utility", tags=["Utility"])

@app.get("/health")
async def health_check():
    """Simple endpoint to verify the server is running."""
    return {"status": "ok", "version": "2.0.0", "model": "LangGraph + LiteLLM"}

if __name__ == "__main__":
    print("🚀 Starting Kiosk AI Backend V2 on port 8000...")
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

