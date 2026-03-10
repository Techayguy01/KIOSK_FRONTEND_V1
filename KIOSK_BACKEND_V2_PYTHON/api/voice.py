"""
api/voice.py

REST endpoints for the frontend to access Sarvam AI's STT and TTS.
These are only called by the frontend when in a non-English language mode.
"""

from fastapi import APIRouter, HTTPException, Response, Depends, Header
from pydantic import BaseModel
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from core.database import get_session
from core.voice import VoiceProvider, normalize_language_code, normalize_language_list
from models.tenant import Tenant
from models.tenant_config import TenantConfig

router = APIRouter()

class STTRequest(BaseModel):
    audio: str      # Base64 encoded audio (WAV)
    language: str   # e.g., "hi"

class STTResponse(BaseModel):
    transcript: str

class TTSRequest(BaseModel):
    text: str
    language: str


async def _resolve_effective_tenant_language(
    session: AsyncSession,
    tenant_slug: str | None,
    requested_language: str,
) -> str:
    normalized_requested = normalize_language_code(requested_language)
    if not tenant_slug:
        return normalized_requested

    tenant_result = await session.exec(select(Tenant).where(Tenant.slug == tenant_slug))
    tenant = tenant_result.first()
    if not tenant:
        return normalized_requested

    config_result = await session.exec(select(TenantConfig).where(TenantConfig.tenant_id == tenant.id))
    tenant_config = config_result.first()
    if not tenant_config:
        return normalized_requested

    available_languages = normalize_language_list(tenant_config.available_lang or [])
    default_language = normalize_language_code(tenant_config.default_lang or "en")

    if available_languages:
        if normalized_requested in available_languages:
            return normalized_requested
        if default_language in available_languages:
            return default_language
        return available_languages[0]

    return default_language

@router.post("/stt", response_model=STTResponse)
async def speech_to_text(
    req: STTRequest,
    session: AsyncSession = Depends(get_session),
    x_tenant_slug: str | None = Header(default=None, alias="x-tenant-slug"),
):
    """
    Receives base64-encoded audio, calls Sarvam STT, returns the transcript text.
    """
    try:
        if not req.audio:
            raise ValueError("No audio data provided")
            
        effective_language = await _resolve_effective_tenant_language(session, x_tenant_slug, req.language)
        transcript = await VoiceProvider.transcribe_audio(
            audio_base64=req.audio, 
            language=effective_language
        )
        return STTResponse(transcript=transcript)
        
    except Exception as e:
        import traceback
        print(f"[VoiceAPI] ❌ STT Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/tts")
async def text_to_speech(
    req: TTSRequest,
    session: AsyncSession = Depends(get_session),
    x_tenant_slug: str | None = Header(default=None, alias="x-tenant-slug"),
):
    """
    Receives text, calls Sarvam TTS, returns raw WAV audio bytes.
    Content-Type is 'audio/wav'.
    """
    try:
        if not req.text:
            raise ValueError("No text provided")
            
        effective_language = await _resolve_effective_tenant_language(session, x_tenant_slug, req.language)
        audio_bytes = VoiceProvider.generate_speech(
            text=req.text,
            language=effective_language
        )
        
        # Return binary response
        return Response(content=audio_bytes, media_type="audio/wav")
        
    except Exception as e:
        import traceback
        print(f"[VoiceAPI] ❌ TTS Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
