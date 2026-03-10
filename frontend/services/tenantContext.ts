import type { TenantDTO } from "@contracts/api.contract";

export type TenantPayload = TenantDTO;
export type SupportedTenantLanguage = "en" | "hi" | "mr";

const PYTHON_API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://localhost:8000").replace(/\/+$/, "");
const NODE_API_BASE_URL = (import.meta.env.VITE_NODE_API_BASE_URL || "http://localhost:3002").replace(/\/+$/, "");

let currentTenantSlug = "";
let currentTenant: TenantPayload | null = null;
let currentTenantLanguage: SupportedTenantLanguage = "en";

const LANGUAGE_ALIASES: Record<string, SupportedTenantLanguage> = {
  english: "en",
  en: "en",
  "en-in": "en",
  hindi: "hi",
  hi: "hi",
  "hi-in": "hi",
  marathi: "mr",
  mr: "mr",
  "mr-in": "mr",
};

export function normalizeTenantLanguage(rawLanguage?: string | null): SupportedTenantLanguage {
  const normalized = String(rawLanguage || "").trim().toLowerCase();
  return LANGUAGE_ALIASES[normalized] || "en";
}

export function getAvailableTenantLanguages(): SupportedTenantLanguage[] {
  const rawValues = currentTenant?.hotelConfig?.availableLang || [];
  const normalized = rawValues.map(normalizeTenantLanguage);
  return Array.from(new Set(normalized));
}

export function getDefaultTenantLanguage(): SupportedTenantLanguage {
  const rawDefault = currentTenant?.hotelConfig?.defaultLang;
  return normalizeTenantLanguage(rawDefault || "en");
}

export function setTenantContext(tenantSlug: string, tenant: TenantPayload | null): void {
  currentTenantSlug = tenantSlug;
  currentTenant = tenant;
  const availableLanguages = tenant?.hotelConfig?.availableLang?.map(normalizeTenantLanguage) || [];
  const normalizedDefault = normalizeTenantLanguage(tenant?.hotelConfig?.defaultLang || "en");
  if (availableLanguages.length === 0) {
    currentTenantLanguage = normalizedDefault;
    return;
  }
  if (!availableLanguages.includes(currentTenantLanguage)) {
    currentTenantLanguage = availableLanguages.includes(normalizedDefault)
      ? normalizedDefault
      : availableLanguages[0];
  }
}

export function getTenantSlug(): string {
  return currentTenantSlug;
}

export function getTenant(): TenantPayload | null {
  return currentTenant;
}

export function getCurrentTenantLanguage(fallback?: string): SupportedTenantLanguage {
  if (currentTenantLanguage) return currentTenantLanguage;
  return normalizeTenantLanguage(fallback || getDefaultTenantLanguage());
}

export function setCurrentTenantLanguage(nextLanguage: string): SupportedTenantLanguage {
  const normalized = normalizeTenantLanguage(nextLanguage);
  const availableLanguages = getAvailableTenantLanguages();
  if (availableLanguages.length === 0 || availableLanguages.includes(normalized)) {
    currentTenantLanguage = normalized;
    return currentTenantLanguage;
  }
  currentTenantLanguage = availableLanguages.includes(getDefaultTenantLanguage())
    ? getDefaultTenantLanguage()
    : availableLanguages[0];
  return currentTenantLanguage;
}

export function getPythonApiBaseUrl(): string {
  return PYTHON_API_BASE_URL;
}

export function getNodeApiBaseUrl(): string {
  return NODE_API_BASE_URL;
}

export function buildTenantApiUrl(route: "chat" | "chat/booking" | "tenant" | "rooms" | "ocr" | "voice/tts" | "voice/stt"): string {
  if (route === "chat" || route === "chat/booking") {
    return `${PYTHON_API_BASE_URL}/api/chat`;
  }
  if (route === "rooms") {
    return `${PYTHON_API_BASE_URL}/api/rooms?slug=${currentTenantSlug}`;
  }
  if (route === "tenant") {
    return `${PYTHON_API_BASE_URL}/api/tenant?slug=${currentTenantSlug}`;
  }
  if (route === "voice/tts") {
    return `${PYTHON_API_BASE_URL}/api/voice/tts`;
  }
  if (route === "voice/stt") {
    return `${PYTHON_API_BASE_URL}/api/voice/stt`;
  }
  return `${PYTHON_API_BASE_URL}/api/ocr`;
}

export function getTenantHeaders(): Record<string, string> {
  return {
    "x-tenant-slug": currentTenantSlug,
  };
}
