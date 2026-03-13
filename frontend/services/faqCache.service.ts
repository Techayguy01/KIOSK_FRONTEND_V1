/**
 * Browser-side FAQ answer cache using IndexedDB.
 * Stores only confirmed FAQ_DB answers returned by backend.
 */

export interface CachedFaqAnswer {
  cacheKey: string;
  tenantSlug: string;
  langCode: string;
  normalizedQuestion: string;
  answer: string;
  faqId?: string | null;
  confidence: number;
  createdAt: number;
}

const BOOTSTRAP_DB_NAME = "KioskDB";
const BOOTSTRAP_STORE_NAME = "faqs";

const DB_NAME = "kiosk_faq_cache_db";
const DB_VERSION = 2;
const STORE_NAME = "faq_answers";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FAQ_ALIAS_MAP: Array<[string, string[]]> = [
  ["checkin time", ["check in time", "check-in time", "check and time", "second time", "checkin timing", "check in timing"]],
  ["checkout time", ["check out time", "check-out time", "checkout timing", "check out timing"]],
  ["breakfast time", ["breakfast timing", "what time is breakfast"]],
  ["wifi", ["wi fi", "internet"]],
  ["parking", ["car parking", "parking facility"]],
  ["pool", ["swimming pool", "pool timing"]],
];
export const FILLER_PATTERN = /\b(i would like to know|i want to know|can you tell me|please tell me|tell me about|information on|for this hotel|in this hotel|of this hotel|mujhe|batao|k baare m|baare mein|जानकारी|बताओं|बताओ|chahiye|hai|tha|the|ka|ke|ki|about|please)\b/gi;
export const QUESTION_SCAFFOLD_PATTERN = /\b(what is|what s|when is|what time is|what are|tell me|the|your|our|hotel|standard|is|are|am|was|were|a|an|the|this|that|these|those|at|for|in|on|around|about|with|from)\b/gi;

function applyAliases(value: string): string {
  let normalized = value;
  for (const [canonical, aliases] of FAQ_ALIAS_MAP) {
    for (const alias of aliases) {
      normalized = normalized.toLowerCase().split(alias).join(canonical);
    }
  }
  return normalized;
}

export function normalizeQuestion(input: string): string {
  if (!input) return "";
  let text = input.toLowerCase();

  // Standardize check-in/out variations first
  text = text.replace(/\bcheck[\s-]*in\b/g, "checkin")
    .replace(/\bcheck[\s-]*out\b/g, "checkout")
    .replace(/\bchecking time\b/g, "checkin time");

  return applyAliases(
    text
      .replace(/[^a-z0-9\u0900-\u097F\s]/g, " ") // Keep Devnagari characters
      .replace(FILLER_PATTERN, " ")
      .replace(QUESTION_SCAFFOLD_PATTERN, " ")
      .replace(/\btiming\b/g, "time")
      .replace(/\s+/g, " ")
      .trim()
  );
}

export function buildCacheKey(tenantSlug: string, faqId: string, langCode: string): string {
  return `${tenantSlug || "default"}::${langCode || "en"}::${faqId || "unknown"}`;
}

/**
 * Calculates token-based overlap between two normalized questions.
 * Returns a score between 0 and 1.
 */
function calculateTokenOverlap(s1: string, s2: string): number {
  if (!s1 || !s2) return 0;
  const tokens1 = new Set(s1.toLowerCase().split(/\s+/).filter(t => t.length > 1));
  const tokens2 = new Set(s2.toLowerCase().split(/\s+/).filter(t => t.length > 1));

  if (tokens1.size === 0 || tokens2.size === 0) return 0;

  let intersection = 0;
  tokens1.forEach(t => {
    if (tokens2.has(t)) intersection++;
  });

  // Calculate Jaccard-like score based on the larger token set to penalize major mismatches
  return intersection / Math.max(tokens1.size, tokens2.size);
}

function canUseIndexedDb(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "cacheKey" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getCachedFaqAnswer(
  tenantSlug: string,
  transcript: string,
  langCode: string,
  searchBootstrap: boolean = true
): Promise<CachedFaqAnswer | null> {
  if (!canUseIndexedDb()) {
    console.log("[FAQCache] IndexedDB unavailable for read");
    return null;
  }
  const normalizedQuestion = normalizeQuestion(transcript);
  const requestedLangCode = String(langCode || "en").trim() || "en";
  if (!normalizedQuestion) return null;

  const db = await openDb();
  console.log(`[FAQCache] READ tenant=${tenantSlug} lang=${requestedLangCode} normalized="${normalizedQuestion}"`);

  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();

    req.onsuccess = async () => {
      const allItems = (req.result as CachedFaqAnswer[]).filter((item) =>
        item.tenantSlug === tenantSlug && item.langCode === requestedLangCode
      );
      const exactMatch = allItems.find((item) => item.normalizedQuestion === normalizedQuestion);

      if (exactMatch) {
        if (Date.now() - exactMatch.createdAt > CACHE_TTL_MS) {
          console.log(`[FAQCache] STALE exact tenant=${tenantSlug} lang=${requestedLangCode}`);
          resolve(null);
          return;
        }
        console.log(`[FAQCache] HIT exact faqId=${exactMatch.faqId || "none"} lang=${requestedLangCode}`);
        resolve(exactMatch);
        return;
      }

      console.log(`[FAQCache] MISS exact lang=${requestedLangCode}. Trying fuzzy fallback...`);
      let bestMatch: CachedFaqAnswer | null = null;
      let highestScore = 0;

      for (const item of allItems) {
        const score = calculateTokenOverlap(item.normalizedQuestion, normalizedQuestion);
        if (score > highestScore) {
          highestScore = score;
          bestMatch = item;
        }
      }

      const FUZZY_THRESHOLD = 0.6;
      if (bestMatch && highestScore >= FUZZY_THRESHOLD) {
        console.log(`[FAQCache] HIT fuzzy score=${highestScore.toFixed(2)} match="${bestMatch.normalizedQuestion}" for query="${normalizedQuestion}" lang=${requestedLangCode}`);
        resolve(bestMatch);
      } else if (searchBootstrap) {
        console.log(`[FAQCache] MISS fuzzy. Searching bootstrap DB (KioskDB)...`);
        searchBootstrapDb(tenantSlug, normalizedQuestion, requestedLangCode).then(resolve);
      } else {
        console.log(`[FAQCache] MISS fuzzy highestScore=${highestScore.toFixed(2)}`);
        resolve(null);
      }
    };

    req.onerror = () => {
      console.log(`[FAQCache] READ_ERROR tenant=${tenantSlug} lang=${requestedLangCode}`);
      resolve(null);
    };
    tx.oncomplete = () => db.close();
  });
}

/**
 * Fallback to search pre-loaded FAQs in KioskDB.
 */
async function searchBootstrapDb(tenantSlug: string, normalizedQuestion: string, langCode: string): Promise<CachedFaqAnswer | null> {
  try {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(BOOTSTRAP_DB_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    const tx = db.transaction(BOOTSTRAP_STORE_NAME, "readonly");
    const store = tx.objectStore(BOOTSTRAP_STORE_NAME);
    const index = store.index("tenant_slug");
    const getReq = index.getAll(tenantSlug);

    return new Promise((resolve) => {
      getReq.onsuccess = () => {
        const faqs = getReq.result as any[];
        let bestMatch: any = null;
        let highestScore = 0;

        for (const faq of faqs) {
          if (!faq.is_active) continue;
          if (String(faq.lang_code || "en").trim() !== langCode) continue;
          // Use the index or compute on the fly if needed
          const faqNorm = faq.question_normalized || normalizeQuestion(faq.question);
          const score = calculateTokenOverlap(faqNorm, normalizedQuestion);
          if (score > highestScore) {
            highestScore = score;
            bestMatch = faq;
          }
        }

        const THRESHOLD = 0.6;
        if (bestMatch && highestScore >= THRESHOLD) {
          console.log(`[FAQCache] BOOTSTRAP_HIT score=${highestScore.toFixed(2)} q="${bestMatch.question}"`);
          resolve({
            cacheKey: buildCacheKey(tenantSlug, String(bestMatch.id || ""), langCode),
            tenantSlug,
            langCode,
            normalizedQuestion: normalizeQuestion(bestMatch.question),
            answer: bestMatch.answer,
            faqId: bestMatch.id,
            confidence: highestScore,
            createdAt: Date.now(),
          });
        } else {
          resolve(null);
        }
      };
      tx.oncomplete = () => db.close();
    });
  } catch (e) {
    console.warn("[FAQCache] Failed to search bootstrap DB", e);
    return null;
  }
}

export async function putCachedFaqAnswer(params: {
  tenantSlug: string;
  langCode: string;
  transcript: string;
  answer: string;
  faqId?: string | null;
  confidence: number;
}): Promise<void> {
  if (!canUseIndexedDb()) {
    console.log("[FAQCache] IndexedDB unavailable for write");
    return;
  }
  const normalizedQuestion = normalizeQuestion(params.transcript);
  const langCode = String(params.langCode || "en").trim() || "en";
  if (!normalizedQuestion || !params.answer?.trim() || !params.faqId) return;

  const db = await openDb();
  const cacheKey = buildCacheKey(params.tenantSlug, params.faqId, langCode);
  const payload: CachedFaqAnswer = {
    cacheKey,
    tenantSlug: params.tenantSlug || "default",
    langCode,
    normalizedQuestion,
    answer: params.answer,
    faqId: params.faqId ?? null,
    confidence: params.confidence,
    createdAt: Date.now(),
  };

  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(payload);
    console.log(`[FAQCache] WRITE key=${cacheKey} faqId=${payload.faqId || "none"} lang=${langCode}`);
    tx.oncomplete = () => {
      console.log(`[FAQCache] WRITE_OK key=${cacheKey}`);
      resolve();
    };
    tx.onerror = () => {
      console.log(`[FAQCache] WRITE_ERROR key=${cacheKey}`);
      resolve();
    };
  });
  db.close();
}
