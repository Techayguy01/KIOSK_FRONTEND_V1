export interface TenantConfig {
  timezone: string;
  supportPhone: string;
  checkInTime: string;
}

export interface TenantPayload {
  id: string;
  name: string;
  slug: string;
  plan: string;
  hotelConfig?: TenantConfig | null;
}

const API_BASE_URL = "http://localhost:3002";

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

export function buildTenantApiUrl(route: "chat" | "chat/booking" | "tenant" | "rooms"): string {
  return `${API_BASE_URL}/api/${currentTenantSlug}/${route}`;
}

export function getTenantHeaders(): Record<string, string> {
  return {
    "x-tenant-slug": currentTenantSlug,
  };
}
