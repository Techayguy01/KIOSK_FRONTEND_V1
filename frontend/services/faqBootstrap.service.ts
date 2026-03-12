import { buildTenantApiUrl, getTenantHeaders } from "./tenantContext";
import { normalizeQuestion } from "./faqCache.service";

type RemoteFaq = {
  id: string;
  tenant_id: string;
  tenant_slug?: string;
  question: string;
  answer: string;
  is_active?: boolean;
  updated_at?: string | null;
};

type FaqBootstrapResponse = {
  tenantId: string;
  tenantSlug: string;
  count: number;
  faqs: RemoteFaq[];
};

const DB_NAME = "KioskDB";
const DB_VERSION = 3;
const STORE_NAME = "faqs";

function canUseIndexedDb(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

function applyRequiredKeyPath<T extends Record<string, any>>(
  record: T,
  keyPath: string | null,
  fallbackKey: string
): T {
  if (!keyPath) return record;
  if (record[keyPath] === undefined || record[keyPath] === null || record[keyPath] === "") {
    (record as any)[keyPath] = fallbackKey;
  }
  return record;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "faq_key" });
        store.createIndex("tenant_id", "tenant_id", { unique: false });
        store.createIndex("tenant_slug", "tenant_slug", { unique: false });
        store.createIndex("question_normalized", "question_normalized", { unique: false });
      } else {
        const store = request.transaction?.objectStore(STORE_NAME);
        if (!store) return;
        if (!store.indexNames.contains("tenant_id")) {
          store.createIndex("tenant_id", "tenant_id", { unique: false });
        }
        if (!store.indexNames.contains("tenant_slug")) {
          store.createIndex("tenant_slug", "tenant_slug", { unique: false });
        }
        if (!store.indexNames.contains("question_normalized")) {
          store.createIndex("question_normalized", "question_normalized", { unique: false });
        }
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function clearTenantFaqs(db: IDBDatabase, tenantId: string, tenantSlug: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const indexName = store.indexNames.contains("tenant_id")
      ? "tenant_id"
      : store.indexNames.contains("tenant_slug")
        ? "tenant_slug"
        : "";

    if (!indexName) {
      if (store.keyPath === "tenant_id") {
        store.delete(tenantId);
      } else {
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) return;
          const value = cursor.value as Record<string, any>;
          const rowTenantId = String(value?.tenant_id || "").trim();
          const rowTenantSlug = String(value?.tenant_slug || "").trim();
          if (rowTenantId === tenantId || rowTenantSlug === tenantSlug) {
            cursor.delete();
          }
          cursor.continue();
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      return;
    }

    const index = store.index(indexName);
    const key = indexName === "tenant_id" ? tenantId : tenantSlug;
    const req = index.openCursor(IDBKeyRange.only(key));
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

async function writeTenantFaqs(db: IDBDatabase, tenantId: string, tenantSlug: string, faqs: RemoteFaq[]): Promise<void> {
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const keyPath = typeof store.keyPath === "string" ? store.keyPath : null;

    // Backward compatibility: if pre-existing store uses tenant_id as primary key,
    // keep one tenant-scoped aggregate row so writes do not fail on duplicate keys.
    if (keyPath === "tenant_id") {
      const items = faqs
        .map((faq) => {
          const question = String(faq.question || "").trim();
          const answer = String(faq.answer || "").trim();
          if (!question || !answer) return null;
          return {
            id: faq.id,
            question,
            question_normalized: normalizeQuestion(question),
            answer,
            is_active: faq.is_active ?? true,
            updated_at: faq.updated_at ?? null,
          };
        })
        .filter(Boolean);

      const tenantAggregate = applyRequiredKeyPath({
        tenant_id: tenantId,
        tenant_slug: tenantSlug,
        faqs: items,
        count: items.length,
        synced_at: Date.now(),
      }, keyPath, tenantId);
      store.put(tenantAggregate);
    } else {
      for (const faq of faqs) {
        const question = String(faq.question || "").trim();
        const answer = String(faq.answer || "").trim();
        if (!question || !answer) continue;

        const normalized = normalizeQuestion(question);
        const payload = applyRequiredKeyPath({
          faq_key: `${tenantSlug}::${faq.id}`,
          id: faq.id,
          tenant_id: tenantId,
          tenant_slug: tenantSlug,
          question,
          question_normalized: normalized,
          answer,
          is_active: faq.is_active ?? true,
          updated_at: faq.updated_at ?? null,
          synced_at: Date.now(),
        }, keyPath, `${tenantSlug}::${faq.id}`);
        store.put(payload);
      }
    }

    tx.onabort = () => {
      console.error("[FAQBootstrap] WRITE_ABORT", tx.error);
      resolve();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      console.error("[FAQBootstrap] WRITE_ERROR", tx.error);
      resolve();
    };
  });
}

async function countStoreRows(db: IDBDatabase): Promise<number> {
  return await new Promise<number>((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).count();
    req.onsuccess = () => resolve(Number(req.result || 0));
    req.onerror = () => resolve(0);
  });
}

export async function prewarmTenantFaqsInIndexedDb(): Promise<void> {
  if (!canUseIndexedDb()) {
    console.log("[FAQBootstrap] IndexedDB unavailable");
    return;
  }

  const response = await fetch(buildTenantApiUrl("faqs"), { headers: getTenantHeaders() });
  if (!response.ok) {
    console.warn(`[FAQBootstrap] FAQ prewarm failed status=${response.status}`);
    return;
  }

  const payload = (await response.json()) as FaqBootstrapResponse;
  const tenantId = String(payload?.tenantId || "").trim();
  const tenantSlug = String(payload?.tenantSlug || "").trim();
  const faqs = Array.isArray(payload?.faqs) ? payload.faqs : [];
  if (!tenantId || !tenantSlug) {
    console.warn("[FAQBootstrap] Missing tenant identity in FAQ response");
    return;
  }

  const db = await openDb();
  try {
    await clearTenantFaqs(db, tenantId, tenantSlug);
    await writeTenantFaqs(db, tenantId, tenantSlug, faqs);
    const totalRows = await countStoreRows(db);
    console.log(`[FAQBootstrap] Prewarmed ${faqs.length} FAQs for tenant=${tenantSlug}; storeRows=${totalRows}`);
  } finally {
    db.close();
  }
}
