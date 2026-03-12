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


def get_embedding(text: str) -> list[float]:
    """
    Generates an embedding for the given text using OpenAI's text-embedding-3-small.
    """
    try:
        response = litellm.embedding(
            model="text-embedding-3-small",
            input=[text]
        )
        embedding = response.data[0]["embedding"]
        return embedding
    except Exception as e:
        print(f"[LLM][Embedding] Error generating embedding: {e}")
        raise


def translate_to_english(text: str) -> str:
    """
    Translates or normalizes multilingual/Hinglish text to clear English.
    If the text is already English, it returns it as is (or slightly cleaned).
    """
    if not text or not text.strip():
        return ""

    messages = [
        {
            "role": "system",
            "content": (
                "You are a translation and normalization assistant. "
                "Convert the following user input into clear, concise English. "
                "If it's already in English, just return it as is. "
                "If it's in Hindi, Hinglish, or mixed languages, translate it to English. "
                "Return ONLY the translated/normalized text."
            )
        },
        {"role": "user", "content": text}
    ]
    
    try:
        # Use a fast model for translation
        translated = get_llm_response(messages, temperature=0.0)
        return translated.strip()
    except Exception as e:
        print(f"[LLM][Translate] Error translating text: {e}")
        return text  # Fallback to raw text if translation fails


def rephrase_faq_answer(user_query: str, faq_answer: str) -> str:
    """
    Rephrases a stored FAQ answer to naturally address the guest's specific phrasing.
    """
    if not user_query or not faq_answer:
        return faq_answer

    messages = [
        {
            "role": "system",
            "content": (
                "The guest asked the following question in their own words. "
                "Use the provided FAQ answer as the source of truth and rephrase it naturally "
                "to directly address how the guest phrased their question. "
                "Keep the answer accurate, concise, and conversational."
            )
        },
        {
            "role": "user", 
            "content": f"Guest Question: {user_query}\n\nStored FAQ Answer: {faq_answer}"
        }
    ]

    try:
        rephrased = get_llm_response(messages, temperature=0.3)
        return rephrased.strip()
    except Exception as e:
        print(f"[LLM][Rephrase] Error rephrasing answer: {e}")
        return faq_answer  # Fallback to raw answer if rephrasing fails


def generate_polite_rejection(user_query: str) -> str:
    """
    Generates a polite refusal for questions not covered by the FAQ.
    """
    if not user_query:
        return "I'm sorry, I didn't quite catch that. Could you please repeat?"

    messages = [
        {
            "role": "system",
            "content": (
                "The guest asked a question that is not covered in the available FAQs for this tenant. "
                "Respond politely that you can only help with topics relevant to the hotel stay, "
                "facilities, and bookings. Suggest they contact the front desk or support if they "
                "need further assistance with this specific query. Do not fabricate an answer."
            )
        },
        {"role": "user", "content": user_query}
    ]

    try:
        rejection = get_llm_response(messages, temperature=0.3)
        return rejection.strip()
    except Exception as e:
        print(f"[LLM][Rejection] Error generating rejection: {e}")
        return (
            "I apologize, but I don't have information about that topic. "
            "Please contact our support team or the front desk for assistance."
        )
