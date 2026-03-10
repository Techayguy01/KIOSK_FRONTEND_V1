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

function normalizeQuestion(input: string): string {
  return (input || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildCacheKey(tenantSlug: string, transcript: string): string {
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
  if (!canUseIndexedDb()) return null;
  const normalizedQuestion = normalizeQuestion(transcript);
  if (!normalizedQuestion) return null;

  const db = await openDb();
  const cacheKey = buildCacheKey(tenantSlug, transcript);

  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(cacheKey);

    req.onsuccess = () => {
      const item = req.result as CachedFaqAnswer | undefined;
      if (!item) {
        resolve(null);
        return;
      }
      if (Date.now() - item.createdAt > CACHE_TTL_MS) {
        resolve(null);
        return;
      }
      resolve(item);
    };
    req.onerror = () => resolve(null);
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
  if (!canUseIndexedDb()) return;
  const normalizedQuestion = normalizeQuestion(params.transcript);
  if (!normalizedQuestion || !params.answer?.trim()) return;

  const db = await openDb();
  const payload: CachedFaqAnswer = {
    cacheKey: buildCacheKey(params.tenantSlug, params.transcript),
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
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  db.close();
}
