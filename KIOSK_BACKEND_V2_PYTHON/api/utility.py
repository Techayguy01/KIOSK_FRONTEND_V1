"""
api/utility.py

Utility endpoints for the frontend, such as query normalization.
"""

from fastapi import APIRouter
from pydantic import BaseModel
from core.llm import get_llm_response

router = APIRouter()

class NormalizeRequest(BaseModel):
    text: str

class NormalizeResponse(BaseModel):
    normalizedText: str

@router.post("/normalize", response_model=NormalizeResponse)
async def normalize_text(req: NormalizeRequest):
    """
    Normalizes a transcript to a canonical English intent for better cache hits.
    Handles Hinglish, slang, and varied phrasing.
    """
    if not req.text or len(req.text.strip()) < 2:
        return NormalizeResponse(normalizedText=req.text or "")
        
    messages = [
        {
            "role": "system",
            "content": (
                "You are a language normalizer. Convert the user input into a simple, "
                "canonical English CORE TOPIC NOUN PHRASE (2-4 words max). "
                "1. If the input is in Hinglish or Hindi, translate to English. "
                "2. STRIP all prepositions (at, for, in, on, around, about). "
                "3. STRIP all filler words (tell me, I want to know, please, what is). "
                "Example: 'mujhe checkin kab karna hai' -> 'checkin time'. "
                "Example: 'what is the wifi password' -> 'wifi password'. "
                "Respond with the normalized English noun phrase only. No prose."
            )
        },
        {"role": "user", "content": req.text}
    ]
    
    # Use a fast response for normalization
    normalized = get_llm_response(messages=messages, temperature=0.0)
    return NormalizeResponse(normalizedText=normalized.strip())
