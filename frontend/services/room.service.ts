import { buildTenantApiUrl, getTenantHeaders } from "./tenantContext";
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
    const response = await fetch(buildTenantApiUrl("rooms"), {
      headers: {
        ...getTenantHeaders(),
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

    const payload = (await response.json()) as RoomsResponseDTO;
    return Array.isArray(payload?.rooms) ? payload.rooms : [];
  },
};
