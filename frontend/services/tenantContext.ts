import type { TenantDTO } from "@contracts/api.contract";

export type TenantPayload = TenantDTO;

// V2: Python FastAPI backend
const API_BASE_URL = "http://localhost:8000";

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

export function buildTenantApiUrl(route: "chat" | "chat/booking" | "tenant" | "rooms" | "ocr" | "voice/tts" | "voice/stt"): string {
  // V2: Python backend handles chat, rooms, and voice.
  if (route === "chat" || route === "chat/booking") {
    return `${API_BASE_URL}/api/chat`;
  }
  if (route === "rooms") {
    return `${API_BASE_URL}/api/rooms?slug=${currentTenantSlug}`;
  }
  if (route === "tenant") {
    return `${API_BASE_URL}/api/tenant?slug=${currentTenantSlug}`;
  }
  if (route === "voice/tts") {
    return `${API_BASE_URL}/api/voice/tts`;
  }
  if (route === "voice/stt") {
    return `${API_BASE_URL}/api/voice/stt`;
  }
  // OCR still hits the old Node backend for now
  return `http://localhost:3002/api/${currentTenantSlug}/${route}`;
}

export function getTenantHeaders(): Record<string, string> {
  return {
    "x-tenant-slug": currentTenantSlug,
  };
}
