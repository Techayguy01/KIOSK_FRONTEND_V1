ALTER TABLE faqs
ADD COLUMN IF NOT EXISTS source_lang VARCHAR(16) NULL,
ADD COLUMN IF NOT EXISTS canonical_question_en TEXT NULL;

CREATE TABLE IF NOT EXISTS faq_localizations (
    id UUID PRIMARY KEY,
    faq_id UUID NOT NULL REFERENCES faqs(id) ON DELETE CASCADE,
    lang_code VARCHAR(16) NOT NULL,
    localized_question TEXT NOT NULL,
    localized_answer TEXT NOT NULL,
    normalized_question TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_faq_localizations_faq_lang
    ON faq_localizations (faq_id, lang_code);

CREATE INDEX IF NOT EXISTS idx_faq_localizations_faq_lang
    ON faq_localizations (faq_id, lang_code);

CREATE INDEX IF NOT EXISTS idx_faq_localizations_lang_normalized_question
    ON faq_localizations (lang_code, normalized_question);

UPDATE faqs AS f
SET
    source_lang = COALESCE(
        NULLIF(BTRIM(f.source_lang), ''),
        NULLIF(BTRIM(tc.default_lang), ''),
        'en'
    ),
    canonical_question_en = COALESCE(
        NULLIF(BTRIM(f.canonical_question_en), ''),
        NULLIF(BTRIM(f.question), ''),
        f.canonical_question_en
    )
FROM tenant_configs AS tc
WHERE tc.tenant_id = f.tenant_id
  AND (
      f.source_lang IS NULL OR BTRIM(f.source_lang) = ''
      OR f.canonical_question_en IS NULL OR BTRIM(f.canonical_question_en) = ''
  );

UPDATE faqs
SET
    source_lang = COALESCE(NULLIF(BTRIM(source_lang), ''), 'en'),
    canonical_question_en = COALESCE(
        NULLIF(BTRIM(canonical_question_en), ''),
        NULLIF(BTRIM(question), ''),
        canonical_question_en
    )
WHERE source_lang IS NULL
   OR BTRIM(source_lang) = ''
   OR canonical_question_en IS NULL
   OR BTRIM(canonical_question_en) = '';

INSERT INTO faq_localizations (
    id,
    faq_id,
    lang_code,
    localized_question,
    localized_answer,
    normalized_question,
    created_at,
    updated_at
)
SELECT
    (
        SUBSTRING(md5(f.id::text || '|' || COALESCE(NULLIF(BTRIM(f.source_lang), ''), 'en')) FROM 1 FOR 8) || '-' ||
        SUBSTRING(md5(f.id::text || '|' || COALESCE(NULLIF(BTRIM(f.source_lang), ''), 'en')) FROM 9 FOR 4) || '-' ||
        SUBSTRING(md5(f.id::text || '|' || COALESCE(NULLIF(BTRIM(f.source_lang), ''), 'en')) FROM 13 FOR 4) || '-' ||
        SUBSTRING(md5(f.id::text || '|' || COALESCE(NULLIF(BTRIM(f.source_lang), ''), 'en')) FROM 17 FOR 4) || '-' ||
        SUBSTRING(md5(f.id::text || '|' || COALESCE(NULLIF(BTRIM(f.source_lang), ''), 'en')) FROM 21 FOR 12)
    )::uuid,
    f.id,
    COALESCE(NULLIF(BTRIM(f.source_lang), ''), 'en'),
    f.question,
    f.answer,
    LOWER(REGEXP_REPLACE(COALESCE(f.question, ''), '[^[:alnum:][:space:]]+', ' ', 'g')),
    COALESCE(f.created_at, NOW()),
    COALESCE(f.updated_at, NOW())
FROM faqs AS f
WHERE NOT EXISTS (
    SELECT 1
    FROM faq_localizations AS fl
    WHERE fl.faq_id = f.id
      AND fl.lang_code = COALESCE(NULLIF(BTRIM(f.source_lang), ''), 'en')
);
