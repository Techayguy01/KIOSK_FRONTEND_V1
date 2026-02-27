import type { KioskDeviceDTO, KioskSessionDTO } from "@contracts/api.contract";

export const mockKioskDevice: KioskDeviceDTO = {
    id: "device_001_mock",
    tenantId: "tenant_demo",
    deviceCode: "LOBBY-01",
    name: "Lobby Primary Kiosk",
    location: "Main Lobby Entrance",
    status: "online",
    lastHeartbeat: new Date().toISOString(),
};

export const mockKioskSession: KioskSessionDTO = {
    id: "sess_mock_58392",
    tenantId: "tenant_demo",
    deviceId: "device_001_mock",
    sessionToken: "tok_mock_abc123",
    language: "en",
    startedAt: new Date().toISOString(),
};
