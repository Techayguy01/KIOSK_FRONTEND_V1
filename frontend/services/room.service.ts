import { buildTenantApiUrl, getTenantHeaders, getTenantSlug } from "./tenantContext";
import type { RoomsResponseDTO, RoomDTO } from "@contracts/api.contract";

export type { RoomDTO };

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

export const RoomService = {
  getAvailableRooms: async (): Promise<RoomDTO[]> => {
    const headers = {
      ...getTenantHeaders(),
    };

    const primaryResponse = await fetch(buildTenantApiUrl("rooms"), { headers });
    const response = primaryResponse.ok
      ? primaryResponse
      : await fetch("http://localhost:3002/api/rooms", {
        headers: {
          ...headers,
          "x-tenant-slug": getTenantSlug(),
        },
      });

    if (!response.ok) {
      let errorCode: string | undefined;
      let errorMessage = `Failed to load rooms (${response.status})`;
      try {
        const payload = await response.json();
        errorCode = payload?.error?.code;
        if (payload?.error?.message) {
          errorMessage = payload.error.message;
        }
      } catch {
        // ignore JSON parse failures and keep fallback message
      }
      throw new RoomServiceError(errorMessage, response.status, errorCode);
    }

    // V2 Python backend returns { success, data: [] }
    // Old Node backend returns { rooms: [] }
    const payload = await response.json();
    const rawRooms: any[] = Array.isArray(payload?.data) ? payload.data
      : Array.isArray(payload?.rooms) ? payload.rooms
        : [];

    // Normalize to the RoomDTO shape the UI expects.
    // Python returns `amenities` — map it to `features`.
    // Add sensible defaults for image and currency which the DB doesn't store.
    const rooms: RoomDTO[] = rawRooms.map((r: any) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      price: typeof r.price === "number" ? r.price : Number(r.price),
      currency: r.currency ?? "INR",
      image: r.image ?? r.image_url ?? "",
      features: Array.isArray(r.features) ? r.features
        : Array.isArray(r.amenities) ? r.amenities
          : [],
    }));

    return rooms;
  },
};
