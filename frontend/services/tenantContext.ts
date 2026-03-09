import type { TenantDTO } from "@contracts/api.contract";

export type TenantPayload = TenantDTO;

const PYTHON_API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://localhost:8000").replace(/\/+$/, "");
const NODE_API_BASE_URL = (import.meta.env.VITE_NODE_API_BASE_URL || "http://localhost:3002").replace(/\/+$/, "");

let currentTenantSlug = "";
let currentTenant: TenantPayload | null = null;

export function setTenantContext(tenantSlug: string, tenant: TenantPayload | null): void {
  currentTenantSlug = tenantSlug;
  currentTenant = tenant;
}

export function getTenantSlug(): string {
  return currentTenantSlug;
}

export function getTenant(): TenantPayload | null {
  return currentTenant;
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
