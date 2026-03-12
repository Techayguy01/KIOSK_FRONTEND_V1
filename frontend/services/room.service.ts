import { buildTenantApiUrl, getNodeApiBaseUrl, getTenantHeaders } from "./tenantContext";
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
      : await fetch(`${getNodeApiBaseUrl()}/api/rooms`, {
        headers: {
          ...headers,
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

    // V2 Python backend returns { rooms: [] }.
    // Old Node backend may return { data: [] }.
    const payload = await response.json();
    const rawRooms: any[] = Array.isArray(payload?.data) ? payload.data
      : Array.isArray(payload?.rooms) ? payload.rooms
        : [];

    // Normalize to the RoomDTO shape the UI expects.
    // Python returns `amenities` — map it to `features`.
    // Add sensible defaults for image and currency which the DB doesn't store.
    const asNonEmptyString = (value: unknown): string => {
      if (typeof value !== "string") return "";
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : "";
    };

    const rooms: RoomDTO[] = rawRooms.map((r: any) => {
      const directImage = asNonEmptyString(r.image);
      const snakeImage = asNonEmptyString(r.image_url);
      const camelImage = asNonEmptyString(r.imageUrl);
      const imageUrlsFromArray = Array.isArray(r.imageUrls)
        ? r.imageUrls.map((url: unknown) => asNonEmptyString(url)).filter(Boolean)
        : [];
      const imageUrlsFromSnakeArray = Array.isArray(r.image_urls)
        ? r.image_urls.map((url: unknown) => asNonEmptyString(url)).filter(Boolean)
        : [];
      const imageUrlsFromCsv = (typeof r.image_urls === "string" && asNonEmptyString(r.image_urls))
        ? asNonEmptyString(r.image_urls).split(",").map((url) => url.trim()).filter(Boolean)
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
        id: r.id,
        name: r.name,
        code: r.code,
        price: typeof r.price === "number" ? r.price : Number(r.price),
        currency: r.currency ?? "INR",
        image: mergedImageUrls[0] || "",
        imageUrls: mergedImageUrls,
        features: Array.isArray(r.features) ? r.features
          : Array.isArray(r.amenities) ? r.amenities
            : [],
      };
    });

    if (import.meta.env.DEV) {
      const roomSample = {
        count: rooms.length,
        firstRoom: rooms[0] || null,
        rawFirstRoom: rawRooms[0] || null,
      };
      console.log("[RoomService] Rooms payload sample:", roomSample);
      console.log("[RoomService] Rooms payload sample JSON:", JSON.stringify(roomSample, null, 2));
    }

    return rooms;
  },
};
