import { buildTenantApiUrl, getNodeApiBaseUrl, getTenantHeaders, getTenantSlug } from "./tenantContext";
import type { RoomDTO } from "@contracts/api.contract";

export type { RoomDTO };

const ROOM_CACHE_TTL_MS = Number(import.meta.env.VITE_ROOMS_CACHE_TTL_MS || 60000);
const PRIMARY_FETCH_TIMEOUT_MS = Number(import.meta.env.VITE_ROOMS_PRIMARY_TIMEOUT_MS || 3000);
const FALLBACK_FETCH_TIMEOUT_MS = Number(import.meta.env.VITE_ROOMS_FALLBACK_TIMEOUT_MS || 3000);

type RoomCacheEntry = {
  tenantSlug: string;
  rooms: RoomDTO[];
  fetchedAt: number;
};

type InflightFetch = {
  tenantSlug: string;
  promise: Promise<RoomDTO[]>;
};

let roomCache: RoomCacheEntry | null = null;
let inflightFetch: InflightFetch | null = null;

export class RoomServiceError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "RoomServiceError";
    this.status = status;
    this.code = code;
  }
}

function normalizeRooms(payload: any): RoomDTO[] {
  const rawRooms: any[] = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.rooms)
      ? payload.rooms
      : [];

  const asNonEmptyString = (value: unknown): string => {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : "";
  };

  const normalized = rawRooms.map((room: any) => {
    const directImage = asNonEmptyString(room.image);
    const snakeImage = asNonEmptyString(room.image_url);
    const camelImage = asNonEmptyString(room.imageUrl);
    const imageUrlsFromArray = Array.isArray(room.imageUrls)
      ? room.imageUrls.map((url: unknown) => asNonEmptyString(url)).filter(Boolean)
      : [];
    const imageUrlsFromSnakeArray = Array.isArray(room.image_urls)
      ? room.image_urls.map((url: unknown) => asNonEmptyString(url)).filter(Boolean)
      : [];
    const imageUrlsFromCsv = (typeof room.image_urls === "string" && asNonEmptyString(room.image_urls))
      ? asNonEmptyString(room.image_urls).split(",").map((url) => url.trim()).filter(Boolean)
      : [];

    const mergedImageUrls = Array.from(
      new Set([
        ...imageUrlsFromArray,
        ...imageUrlsFromSnakeArray,
        ...imageUrlsFromCsv,
        directImage,
        snakeImage,
        camelImage,
      ].filter(Boolean))
    );

    return {
      id: room.id,
      name: room.name,
      code: room.code,
      price: typeof room.price === "number" ? room.price : Number(room.price),
      currency: room.currency ?? "INR",
      image: mergedImageUrls[0] || "",
      imageUrls: mergedImageUrls,
      features: Array.isArray(room.features)
        ? room.features
        : Array.isArray(room.amenities)
          ? room.amenities
          : [],
    } as RoomDTO;
  });

  if (import.meta.env.DEV) {
    const roomSample = {
      count: normalized.length,
      firstRoom: normalized[0] || null,
      rawFirstRoom: rawRooms[0] || null,
    };
    console.log("[RoomService] Rooms payload sample:", roomSample);
    console.log("[RoomService] Rooms payload sample JSON:", JSON.stringify(roomSample, null, 2));
  }

  return normalized;
}

async function fetchWithTimeout(url: string, headers: Record<string, string>, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function toRoomServiceError(response: Response): Promise<RoomServiceError> {
  let code: string | undefined;
  let message = `Failed to load rooms (${response.status})`;

  try {
    const payload = await response.json();
    code = payload?.error?.code;
    if (payload?.error?.message) {
      message = payload.error.message;
    }
  } catch {
    // Ignore parse errors and keep fallback message
  }

  return new RoomServiceError(message, response.status, code);
}

function isCacheValid(entry: RoomCacheEntry | null, tenantSlug: string): boolean {
  if (!entry) return false;
  if (entry.tenantSlug !== tenantSlug) return false;
  return Date.now() - entry.fetchedAt < ROOM_CACHE_TTL_MS;
}

function getTenantCacheKey(): string {
  const slug = getTenantSlug();
  return slug || "default";
}

export const RoomService = {
  async getAvailableRooms(options?: { forceRefresh?: boolean }): Promise<RoomDTO[]> {
    const tenantKey = getTenantCacheKey();
    const forceRefresh = Boolean(options?.forceRefresh);

    if (!forceRefresh && isCacheValid(roomCache, tenantKey)) {
      return roomCache!.rooms;
    }

    if (!forceRefresh && inflightFetch && inflightFetch.tenantSlug === tenantKey) {
      return inflightFetch.promise;
    }

    const headers = { ...getTenantHeaders() };
    const primaryUrl = buildTenantApiUrl("rooms");
    const fallbackUrl = `${getNodeApiBaseUrl()}/api/rooms`;

    const requestPromise = (async () => {
      let primaryError: Error | null = null;

      try {
        const primaryResponse = await fetchWithTimeout(primaryUrl, headers, PRIMARY_FETCH_TIMEOUT_MS);
        if (primaryResponse.ok) {
          const payload = await primaryResponse.json();
          const rooms = normalizeRooms(payload);
          roomCache = { tenantSlug: tenantKey, rooms, fetchedAt: Date.now() };
          return rooms;
        }
        primaryError = await toRoomServiceError(primaryResponse);
      } catch (error) {
        primaryError = error as Error;
        console.warn("[RoomService] Primary room fetch failed, trying fallback:", error);
      }

      try {
        const fallbackResponse = await fetchWithTimeout(fallbackUrl, headers, FALLBACK_FETCH_TIMEOUT_MS);
        if (!fallbackResponse.ok) {
          throw await toRoomServiceError(fallbackResponse);
        }
        const payload = await fallbackResponse.json();
        const rooms = normalizeRooms(payload);
        roomCache = { tenantSlug: tenantKey, rooms, fetchedAt: Date.now() };
        return rooms;
      } catch (fallbackError) {
        if (primaryError instanceof RoomServiceError) throw primaryError;
        if (fallbackError instanceof RoomServiceError) throw fallbackError;
        if (primaryError) throw primaryError;
        throw fallbackError;
      }
    })();

    inflightFetch = { tenantSlug: tenantKey, promise: requestPromise };
    try {
      return await requestPromise;
    } finally {
      if (inflightFetch?.promise === requestPromise) {
        inflightFetch = null;
      }
    }
  },

  async prefetchAvailableRooms(): Promise<void> {
    try {
      await this.getAvailableRooms();
    } catch (error) {
      console.warn("[RoomService] Room prefetch failed:", error);
    }
  },

  clearCache(): void {
    roomCache = null;
    inflightFetch = null;
  },
};
