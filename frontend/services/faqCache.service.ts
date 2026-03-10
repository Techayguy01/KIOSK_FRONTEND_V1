/**
 * Browser-side FAQ answer cache using IndexedDB.
 * Stores only confirmed FAQ_DB answers returned by backend.
 */

export interface CachedFaqAnswer {
  cacheKey: string;
  tenantSlug: string;
  normalizedQuestion: string;
  answer: string;
  faqId?: string | null;
  confidence: number;
  createdAt: number;
}

const DB_NAME = "kiosk_faq_cache_db";
const DB_VERSION = 1;
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
const FILLER_PATTERN = /\b(i would like to know|i want to know|can you tell me|please tell me|for this hotel|in this hotel|of this hotel)\b/g;
const QUESTION_SCAFFOLD_PATTERN = /\b(what is|what s|when is|what time is|what are|tell me|the|your|our|hotel|standard)\b/g;

function applyAliases(value: string): string {
  let normalized = value;
  for (const [canonical, aliases] of FAQ_ALIAS_MAP) {
    for (const alias of aliases) {
      normalized = normalized.replaceAll(alias, canonical);
    }
  }
  return normalized;
}

export function normalizeQuestion(input: string): string {
  return applyAliases(
    (input || "")
    .toLowerCase()
    .replace(/\bchecking time\b/g, "checkin time")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(FILLER_PATTERN, " ")
    .replace(QUESTION_SCAFFOLD_PATTERN, " ")
    .replace(/\btiming\b/g, "time")
    .replace(/\s+/g, " ")
    .trim()
  );
}

export function buildCacheKey(tenantSlug: string, transcript: string): string {
  return `${tenantSlug || "default"}::${normalizeQuestion(transcript)}`;
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
  transcript: string
): Promise<CachedFaqAnswer | null> {
  if (!canUseIndexedDb()) {
    console.log("[FAQCache] IndexedDB unavailable for read");
    return null;
  }
  const normalizedQuestion = normalizeQuestion(transcript);
  if (!normalizedQuestion) return null;

  const db = await openDb();
  const cacheKey = buildCacheKey(tenantSlug, transcript);
  console.log(`[FAQCache] READ key=${cacheKey}`);

  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(cacheKey);

    req.onsuccess = () => {
      const item = req.result as CachedFaqAnswer | undefined;
      if (!item) {
        console.log(`[FAQCache] MISS key=${cacheKey}`);
        resolve(null);
        return;
      }
      if (Date.now() - item.createdAt > CACHE_TTL_MS) {
        console.log(`[FAQCache] STALE key=${cacheKey}`);
        resolve(null);
        return;
      }
      console.log(`[FAQCache] HIT key=${cacheKey} faqId=${item.faqId || "none"}`);
      resolve(item);
    };
    req.onerror = () => {
      console.log(`[FAQCache] READ_ERROR key=${cacheKey}`);
      resolve(null);
    };
    tx.oncomplete = () => db.close();
  });
}

export async function putCachedFaqAnswer(params: {
  tenantSlug: string;
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
  if (!normalizedQuestion || !params.answer?.trim()) return;

  const db = await openDb();
  const cacheKey = buildCacheKey(params.tenantSlug, params.transcript);
  const payload: CachedFaqAnswer = {
    cacheKey,
    tenantSlug: params.tenantSlug || "default",
    normalizedQuestion,
    answer: params.answer,
    faqId: params.faqId ?? null,
    confidence: params.confidence,
    createdAt: Date.now(),
  };

  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(payload);
    console.log(`[FAQCache] WRITE key=${cacheKey} faqId=${payload.faqId || "none"}`);
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
