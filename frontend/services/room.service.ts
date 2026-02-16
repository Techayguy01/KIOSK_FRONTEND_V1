import { buildTenantApiUrl, getTenantHeaders } from "./tenantContext";

export interface RoomDTO {
  id: string;
  name: string;
  price: number;
  currency: string;
  image: string;
  features: string[];
  code?: string;
}

export const RoomService = {
  getAvailableRooms: async (): Promise<RoomDTO[]> => {
    const response = await fetch(buildTenantApiUrl("rooms"), {
      headers: {
        ...getTenantHeaders(),
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to load rooms (${response.status})`);
    }

    const payload = await response.json();
    return Array.isArray(payload?.rooms) ? payload.rooms : [];
  },
};
