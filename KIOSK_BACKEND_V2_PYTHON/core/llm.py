"""
core/llm.py

LLM configuration with automatic fallback via LiteLLM.

Priority:
  1. Groq (Llama 3.3 70B) — blazing fast, primary
  2. Groq (Llama 3 8B)    — faster fallback if main model hits rate limits
  3. OpenAI GPT-4o-mini   — final fallback

All nodes in the LangGraph agent call get_llm() and never hard-code a model.
"""

import os
import litellm
from litellm import completion
from dotenv import load_dotenv

load_dotenv()

# Configure LiteLLM fallback routing
litellm.set_verbose = False  # Set True to debug LLM calls

# Model priority list
LLM_MODELS = [
    "groq/llama-3.3-70b-versatile",    # Primary — ultra low latency
    "groq/llama3-8b-8192",             # Groq fallback — faster, less capable
    "openai/gpt-4o-mini",              # Final safety net
]


def get_llm_response(messages: list[dict], temperature: float = 0.4) -> str:
    """
    Calls the LLM with automatic fallback.
    
    Args:
        messages: OpenAI-style message list [{"role": "user", "content": "..."}]
        temperature: 0.0 is deterministic, 1.0 is creative

    Returns:
        The raw text response from the LLM.
    """
    last_error = None
    for model in LLM_MODELS:
        try:
            response = completion(
                model=model,
                messages=messages,
                temperature=temperature,
                max_tokens=1024,
            )
            content = response.choices[0].message.content
            print(f"[LLM] ✅ Model: {model} responded.")
            return content
        except Exception as e:
            print(f"[LLM] ⚠️ {model} failed: {e}. Trying next...")
            last_error = e

    raise RuntimeError(f"[LLM] All models failed. Last error: {last_error}")
