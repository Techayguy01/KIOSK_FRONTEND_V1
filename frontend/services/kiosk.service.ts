import { buildTenantApiUrl, getTenantHeaders } from "./tenantContext";
import type {
    KioskDeviceDTO,
    KioskSessionDTO,
    CreateKioskSessionRequest,
    UpdateKioskSessionRequest
} from "@contracts/api.contract";
import { mockKioskDevice, mockKioskSession } from "../mocks/kiosk.mock";

export class KioskServiceError extends Error {
    status: number;
    code?: string;

    constructor(message: string, status: number, code?: string) {
        super(message);
        this.name = "KioskServiceError";
        this.status = status;
        this.code = code;
    }
}

// Utility to simulate network delay for mocks
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === "true";

export const KioskService = {

    registerDevice: async (deviceCode: string): Promise<KioskDeviceDTO> => {
        if (USE_MOCKS) {
            await delay(500);
            return { ...mockKioskDevice, deviceCode };
        }

        const response = await fetch(buildTenantApiUrl("kiosk/devices/register"), {
            method: "POST",
            headers: {
                ...getTenantHeaders(),
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ deviceCode }),
        });

        if (!response.ok) throw new KioskServiceError("Failed to register device", response.status);
        return response.json();
    },

    sendHeartbeat: async (deviceId: string): Promise<void> => {
        if (USE_MOCKS) return;

        const response = await fetch(buildTenantApiUrl(`kiosk/devices/${deviceId}/heartbeat`), {
            method: "POST",
            headers: getTenantHeaders(),
        });

        if (!response.ok) throw new KioskServiceError("Failed to send heartbeat", response.status);
    },

    startSession: async (request: CreateKioskSessionRequest): Promise<KioskSessionDTO> => {
        if (USE_MOCKS) {
            await delay(400);
            return {
                ...mockKioskSession,
                deviceId: request.deviceId,
                language: request.language || "en",
                startedAt: new Date().toISOString(),
            };
        }

        const response = await fetch(buildTenantApiUrl("kiosk/sessions"), {
            method: "POST",
            headers: {
                ...getTenantHeaders(),
                "Content-Type": "application/json",
            },
            body: JSON.stringify(request),
        });

        if (!response.ok) throw new KioskServiceError("Failed to start session", response.status);
        return response.json();
    },

    endSession: async (sessionId: string, request: UpdateKioskSessionRequest): Promise<KioskSessionDTO> => {
        if (USE_MOCKS) {
            await delay(300);
            return {
                ...mockKioskSession,
                id: sessionId,
                finalState: request.finalState,
                endedAt: new Date().toISOString(),
            };
        }

        const response = await fetch(buildTenantApiUrl(`kiosk/sessions/${sessionId}`), {
            method: "PUT",
            headers: {
                ...getTenantHeaders(),
                "Content-Type": "application/json",
            },
            body: JSON.stringify(request),
        });

        if (!response.ok) throw new KioskServiceError("Failed to end session", response.status);
        return response.json();
    },
};
