"""
api/voice.py

REST endpoints for the frontend to access Sarvam AI's STT and TTS.
These are only called by the frontend when in a non-English language mode.
"""

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel
from core.voice import VoiceProvider

router = APIRouter()

class STTRequest(BaseModel):
    audio: str      # Base64 encoded audio (WAV)
    language: str   # e.g., "hi"

class STTResponse(BaseModel):
    transcript: str

class TTSRequest(BaseModel):
    text: str
    language: str

@router.post("/stt", response_model=STTResponse)
async def speech_to_text(req: STTRequest):
    """
    Receives base64-encoded audio, calls Sarvam STT, returns the transcript text.
    """
    try:
        if not req.audio:
            raise ValueError("No audio data provided")
            
        transcript = await VoiceProvider.transcribe_audio(
            audio_base64=req.audio, 
            language=req.language
        )
        return STTResponse(transcript=transcript)
        
    except Exception as e:
        import traceback
        print(f"[VoiceAPI] ❌ STT Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/tts")
async def text_to_speech(req: TTSRequest):
    """
    Receives text, calls Sarvam TTS, returns raw WAV audio bytes.
    Content-Type is 'audio/wav'.
    """
    try:
        if not req.text:
            raise ValueError("No text provided")
            
        audio_bytes = VoiceProvider.generate_speech(
            text=req.text,
            language=req.language
        )
        
        # Return binary response
        return Response(content=audio_bytes, media_type="audio/wav")
        
    except Exception as e:
        import traceback
        print(f"[VoiceAPI] ❌ TTS Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
