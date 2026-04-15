from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import os
import asyncio

from api.chat import router as chat_router
from api.checkin import router as checkin_router
from api.voice import router as voice_router
from api.rooms import router as rooms_router
from api.tenant import router as tenant_router
from api.ocr import router as ocr_router
from api.faqs import router as faqs_router
from api.utility import router as utility_router
from agent.semantic_classifier import initialize_semantic_classifier

app = FastAPI(
    title="Kiosk AI Backend V2",
    description="Production-grade AI orchestration for hotel kiosks",
    version="2.0.0"
)

# CORS configuration to allow the React frontend to communicate with Python.
# Keep localhost defaults for dev and allow override via CORS_ORIGINS env (comma-separated).
default_origins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:4173",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://127.0.0.1:4173",
    "http://127.0.0.1:5173",
]
cors_origins_env = (os.getenv("CORS_ORIGINS") or "").strip()
allow_origins = [origin.strip() for origin in cors_origins_env.split(",") if origin.strip()] if cors_origins_env else default_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
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

@app.on_event("startup")
async def startup_event():
    """Optional semantic prewarm; disabled by default to avoid blocking API startup."""
    should_prewarm = os.getenv("ENABLE_SEMANTIC_PREWARM", "false").strip().lower() == "true"
    if not should_prewarm:
        print("[Startup] Semantic prewarm disabled (set ENABLE_SEMANTIC_PREWARM=true to enable).")
        return
    try:
        await asyncio.wait_for(initialize_semantic_classifier(), timeout=15)
    except asyncio.TimeoutError:
        print("[Startup] SemanticClassifier init timed out after 15s (non-fatal).")
    except Exception as exc:
        print(f"[Startup] SemanticClassifier init failed (non-fatal): {exc}")


@app.on_event("shutdown")
async def shutdown_event():
    """Flush buffered classifier review logs on shutdown."""
    try:
        from agent.misclassification_logger import flush as flush_classification_log

        flush_classification_log()
    except Exception as exc:
        print(f"[Shutdown] Classification log flush failed (non-fatal): {exc}")

@app.get("/health")
async def health_check():
    """Simple endpoint to verify the server is running."""
    return {"status": "ok", "version": "2.0.0", "model": "LangGraph + LiteLLM"}

if __name__ == "__main__":
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    reload_enabled = os.getenv("RELOAD", "false").strip().lower() == "true"
    print(f"Starting Kiosk AI Backend V2 on {host}:{port} (reload={reload_enabled})...")
    uvicorn.run("main:app", host=host, port=port, reload=reload_enabled)


