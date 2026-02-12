import hashlib
import os
import sys
from typing import Optional

import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from gtts import gTTS

BASE_DIR = os.path.dirname(__file__)
VIBEVOICE_DIR = os.path.join(BASE_DIR, "VibeVoice")
sys.path.append(VIBEVOICE_DIR)

from vibevoice.modular.modeling_vibevoice_inference import (  # noqa: E402
    VibeVoiceForConditionalGenerationInference,
)
from vibevoice.processor.vibevoice_processor import VibeVoiceProcessor  # noqa: E402

app = FastAPI(title="AI Engine (VibeVoice)")

MODEL_PATH = os.getenv("VIBEVOICE_MODEL_PATH", "tarun7r/vibevoice-hindi-7b")
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
OUTPUT_DIR = os.path.abspath(
    os.getenv("VIBEVOICE_OUTPUT_DIR", os.path.join(BASE_DIR, "../backend/public/tts"))
)
VOICES_DIR = os.path.join(VIBEVOICE_DIR, "demo", "voices")
DEFAULT_SPEAKER = "hi-Priya_woman"
GTTS_LANG = os.getenv("GTTS_LANG", "en")

processor: Optional[VibeVoiceProcessor] = None
model: Optional[VibeVoiceForConditionalGenerationInference] = None
startup_error: Optional[str] = None


def _voice_path_for_speaker(speaker: str) -> str:
    requested = (speaker or DEFAULT_SPEAKER).strip()
    candidate = os.path.join(VOICES_DIR, f"{requested}.wav")
    if os.path.exists(candidate):
        return candidate
    fallback = os.path.join(VOICES_DIR, f"{DEFAULT_SPEAKER}.wav")
    if os.path.exists(fallback):
        return fallback
    raise FileNotFoundError(f"No usable voice sample found in {VOICES_DIR}")


def _load_model() -> None:
    global model, processor, startup_error
    print(f"[AI-ENGINE] Loading VibeVoice model: {MODEL_PATH}")
    print(f"[AI-ENGINE] Device: {DEVICE}")
    print(f"[AI-ENGINE] Output dir: {OUTPUT_DIR}")

    processor = VibeVoiceProcessor.from_pretrained(MODEL_PATH)
    if DEVICE == "cuda":
        torch_dtype = torch.bfloat16
        try:
            model = VibeVoiceForConditionalGenerationInference.from_pretrained(
                MODEL_PATH,
                torch_dtype=torch_dtype,
                device_map="cuda",
                attn_implementation="flash_attention_2",
            )
        except Exception:
            model = VibeVoiceForConditionalGenerationInference.from_pretrained(
                MODEL_PATH,
                torch_dtype=torch_dtype,
                device_map="cuda",
                attn_implementation="sdpa",
            )
    else:
        model = VibeVoiceForConditionalGenerationInference.from_pretrained(
            MODEL_PATH,
            torch_dtype=torch.float32,
            device_map="cpu",
            attn_implementation="sdpa",
        )

    model.eval()
    model.set_ddpm_inference_steps(num_steps=10)
    startup_error = None
    print("[AI-ENGINE] Model loaded and ready")


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1)
    speaker: str = DEFAULT_SPEAKER
    cfg_scale: float = 1.3


@app.on_event("startup")
def startup_event():
    global startup_error
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    try:
        _load_model()
    except Exception as exc:
        startup_error = f"{type(exc).__name__}: {exc}"
        print(f"[AI-ENGINE] Startup failed: {startup_error}")


@app.get("/health")
def health():
    if startup_error:
        raise HTTPException(status_code=503, detail=startup_error)
    return {"status": "ok", "model_path": MODEL_PATH, "device": DEVICE}


@app.post("/generate")
async def generate_speech(request: TTSRequest):
    speaker = request.speaker or DEFAULT_SPEAKER
    content_key = hashlib.sha256(f"{speaker}|{request.text}".encode("utf-8")).hexdigest()[:16]
    vibe_filename = f"tts_{content_key}.wav"
    vibe_output_path = os.path.join(OUTPUT_DIR, vibe_filename)
    gtts_filename = f"tts_{content_key}.mp3"
    gtts_output_path = os.path.join(OUTPUT_DIR, gtts_filename)

    try:
        if startup_error:
            raise RuntimeError(f"Model unavailable: {startup_error}")
        if model is None or processor is None:
            raise RuntimeError("Model not initialized")
        if os.path.exists(vibe_output_path):
            return {"status": "success", "cached": True, "provider": "vibevoice", "url": f"/audio/tts/{vibe_filename}"}

        voice_sample = _voice_path_for_speaker(speaker)
        script = f"Speaker 1: {request.text.strip()}"

        inputs = processor(
            text=[script],
            voice_samples=[[voice_sample]],
            padding=True,
            return_tensors="pt",
            return_attention_mask=True,
        )
        for key, value in inputs.items():
            if torch.is_tensor(value):
                inputs[key] = value.to(DEVICE)

        outputs = model.generate(
            **inputs,
            max_new_tokens=None,
            cfg_scale=request.cfg_scale,
            tokenizer=processor.tokenizer,
            generation_config={"do_sample": False},
            verbose=False,
            is_prefill=True,
        )

        processor.save_audio(outputs.speech_outputs[0], output_path=vibe_output_path)
        return {"status": "success", "cached": False, "provider": "vibevoice", "url": f"/audio/tts/{vibe_filename}"}
    except Exception as vibe_exc:
        try:
            if os.path.exists(gtts_output_path):
                return {"status": "success", "cached": True, "provider": "gtts", "url": f"/audio/tts/{gtts_filename}"}

            gTTS(text=request.text.strip(), lang=GTTS_LANG).save(gtts_output_path)
            return {"status": "success", "cached": False, "provider": "gtts", "url": f"/audio/tts/{gtts_filename}"}
        except Exception as gtts_exc:
            raise HTTPException(
                status_code=503,
                detail=f"VibeVoice failed: {type(vibe_exc).__name__}: {vibe_exc} | gTTS failed: {type(gtts_exc).__name__}: {gtts_exc}",
            )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=5000)
