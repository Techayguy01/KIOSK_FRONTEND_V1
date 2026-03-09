export type FAQRecord = {
  id: string;
  tenant_id?: string;
  question: string;
  answer: string;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
};

const DB_NAME = "KioskDB";
const DB_VERSION = 2;
const STORE_NAME = "faqs";

let dbPromise: Promise<IDBDatabase> | null = null;

const ensureIndexedDB = (): boolean => typeof indexedDB !== "undefined";

const idbRequestToPromise = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const openDB = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME);
      }
      const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
      store.createIndex("tenant_id", "tenant_id", { unique: false });
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export const initDB = async (): Promise<IDBDatabase> => {
  if (!ensureIndexedDB()) {
    return Promise.reject(new Error("IndexedDB is not available in this environment."));
  }

  if (!dbPromise) {
    dbPromise = openDB();
  }

  return dbPromise;
};

const normalizeTenantId = (tenantId?: string): string => tenantId || "default";

const deleteTenantFAQs = async (store: IDBObjectStore, tenantId: string): Promise<void> => {
  const index = store.index("tenant_id");
  const keyRange = IDBKeyRange.only(tenantId);

  await new Promise<void>((resolve, reject) => {
    const request = index.openCursor(keyRange);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };
  });
};

export const syncFAQs = async (tenantId: string | undefined, faqList: FAQRecord[]): Promise<void> => {
  if (!ensureIndexedDB()) {
    return;
  }

  const resolvedTenantId = normalizeTenantId(tenantId);
  const db = await initDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);

  await deleteTenantFAQs(store, resolvedTenantId);

  const insertions = faqList.map((faq) => idbRequestToPromise(store.put({
    ...faq,
    tenant_id: faq.tenant_id || resolvedTenantId,
    key: `${resolvedTenantId}:${faq.id}`,
  })));
  await Promise.all(insertions);

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
};

export const getAllFAQs = async (tenantId?: string): Promise<FAQRecord[]> => {
  if (!ensureIndexedDB()) {
    return [];
  }

  const resolvedTenantId = normalizeTenantId(tenantId);
  const db = await initDB();
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);

  const index = store.index("tenant_id");
  const faqs = await idbRequestToPromise(index.getAll(IDBKeyRange.only(resolvedTenantId)));

  return Array.isArray(faqs) ? faqs : [];
};
