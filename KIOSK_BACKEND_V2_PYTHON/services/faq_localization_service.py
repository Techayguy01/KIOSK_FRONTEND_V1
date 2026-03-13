from __future__ import annotations

import re
import uuid

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from core.llm import get_llm_response, translate_to_english
from core.voice import normalize_language_code, normalize_language_list
from models.faq import FAQ
from models.faq_localization import FAQLocalization


SUPPORTED_LANGUAGES = {"en", "hi", "mr"}
_WHITESPACE_RE = re.compile(r"\s+")
_NON_ALNUM_RE = re.compile(r"[^\w\s]", flags=re.UNICODE)


def normalize_localized_question(text: str) -> str:
    if not text:
        return ""
    cleaned = _NON_ALNUM_RE.sub(" ", text)
    return _WHITESPACE_RE.sub(" ", cleaned).strip().lower()


def translate_to_language(text: str, target_language: str) -> str:
    normalized_target = normalize_language_code(target_language)
    if not text or not text.strip():
        return ""

    if normalized_target == "en":
        return translate_to_english(text)

    language_name = {
        "hi": "Hindi",
        "mr": "Marathi",
    }.get(normalized_target, normalized_target)

    messages = [
        {
            "role": "system",
            "content": (
                f"Translate the user-provided hospitality FAQ text into natural {language_name}. "
                "Keep the meaning exact, keep hotel-specific details unchanged, and return only the translated text."
            ),
        },
        {"role": "user", "content": text},
    ]
    translated = get_llm_response(messages, temperature=0.0)
    return translated.strip()


def resolve_target_languages(
    available_languages: list[str] | None,
    source_language: str,
    requested_language: str | None = None,
) -> list[str]:
    target_languages = [
        language
        for language in normalize_language_list(available_languages or [])
        if language in SUPPORTED_LANGUAGES
    ]
    if not target_languages:
        target_languages = [source_language]
    if source_language not in target_languages:
        target_languages.append(source_language)
    normalized_requested = normalize_language_code(requested_language or "")
    if normalized_requested in SUPPORTED_LANGUAGES and normalized_requested not in target_languages:
        target_languages.append(normalized_requested)
    return target_languages


async def ensure_faq_localizations(
    session: AsyncSession,
    faq: FAQ,
    available_languages: list[str] | None = None,
    requested_language: str | None = None,
) -> bool:
    changed = False
    source_language = normalize_language_code(faq.source_lang or "en")
    canonical_question_en = str(faq.canonical_question_en or "").strip()

    if not canonical_question_en or source_language != "en":
        translated_question = translate_to_english(faq.question)
        translated_question = translated_question.strip()
        if translated_question and translated_question != canonical_question_en:
            faq.canonical_question_en = translated_question
            changed = True

    normalized_source = str(faq.source_lang or "").strip()
    if not normalized_source or normalize_language_code(normalized_source) != source_language:
        faq.source_lang = source_language
        changed = True

    target_languages = resolve_target_languages(
        available_languages,
        source_language,
        requested_language=requested_language,
    )

    result = await session.exec(
        select(FAQLocalization).where(FAQLocalization.faq_id == faq.id)
    )
    existing_localizations = {
        normalize_language_code(localization.lang_code): localization
        for localization in result.all()
    }

    for lang_code in target_languages:
        if lang_code in existing_localizations:
            continue

        if lang_code == source_language:
            localized_question = faq.question.strip()
            localized_answer = faq.answer.strip()
        else:
            localized_question = translate_to_language(faq.question, lang_code)
            localized_answer = translate_to_language(faq.answer, lang_code)

        session.add(
            FAQLocalization(
                id=uuid.uuid4(),
                faq_id=faq.id,
                lang_code=lang_code,
                localized_question=localized_question,
                localized_answer=localized_answer,
                normalized_question=normalize_localized_question(localized_question),
                created_at=faq.created_at,
                updated_at=faq.updated_at,
            )
        )
        changed = True

    if changed:
        session.add(faq)
        await session.flush()

    return changed
