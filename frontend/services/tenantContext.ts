import type { TenantDTO } from "@contracts/api.contract";

export type TenantPayload = TenantDTO;

// V2: Python FastAPI backend
const API_BASE_URL = "http://localhost:8000";

let currentTenantSlug = "grand-hotel";
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

export function buildTenantApiUrl(route: "chat" | "chat/booking" | "tenant" | "rooms" | "ocr"): string {
  // V2: Python backend handles chat and rooms.
  if (route === "chat" || route === "chat/booking") {
    return `${API_BASE_URL}/api/chat`;
  }
  if (route === "rooms") {
    // V2 Python rooms endpoint — looks up rooms by slug
    return `${API_BASE_URL}/api/rooms?slug=${currentTenantSlug}`;
  }
  if (route === "tenant") {
    // V2 Python tenant endpoint
    return `${API_BASE_URL}/api/tenant?slug=${currentTenantSlug}`;
  }
  // OCR still hits the old Node backend for now
  return `http://localhost:3002/api/${currentTenantSlug}/${route}`;
}

export function getTenantHeaders(): Record<string, string> {
  return {
    "x-tenant-slug": currentTenantSlug,
  };
}
