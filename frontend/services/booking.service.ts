import { buildTenantApiUrl, getTenantHeaders } from "./tenantContext";
import type {
    GuestRegistrationRequest,
    GuestDTO,
    BookingLookupRequest,
    BookingDTO,
    UpdateBookingStatusRequest
} from "@contracts/api.contract";
import { mockGuest, mockBookings } from "../mocks/booking.mock";

export class BookingServiceError extends Error {
    status: number;
    code?: string;

    constructor(message: string, status: number, code?: string) {
        super(message);
        this.name = "BookingServiceError";
        this.status = status;
        this.code = code;
    }
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === "true";

export const BookingService = {

    registerGuest: async (request: GuestRegistrationRequest): Promise<GuestDTO> => {
        if (USE_MOCKS) {
            await delay(600);
            return {
                ...mockGuest,
                fullName: request.fullName,
                email: request.email || mockGuest.email,
                phone: request.phone || mockGuest.phone,
                idType: request.idType || mockGuest.idType,
            };
        }

        const response = await fetch(buildTenantApiUrl("guests"), {
            method: "POST",
            headers: {
                ...getTenantHeaders(),
                "Content-Type": "application/json",
            },
            body: JSON.stringify(request),
        });

        if (!response.ok) throw new BookingServiceError("Failed to register guest", response.status);
        return response.json();
    },

    lookupBooking: async (request: BookingLookupRequest): Promise<BookingDTO[]> => {
        if (USE_MOCKS) {
            await delay(800);

            // Simulate lookup logic purely for frontend dev convenience
            if (request.bookingReference) {
                return mockBookings.filter(b => b.id.includes(request.bookingReference!));
            }
            if (request.guestName) {
                return mockBookings.filter(b => b.guestName?.toLowerCase().includes(request.guestName!.toLowerCase()));
            }
            return mockBookings;
        }

        const queryParams = new URLSearchParams();
        if (request.bookingReference) queryParams.append("bookingReference", request.bookingReference);
        if (request.guestName) queryParams.append("guestName", request.guestName);

        const response = await fetch(buildTenantApiUrl(`bookings/lookup?${queryParams.toString()}`), {
            method: "GET",
            headers: getTenantHeaders(),
        });

        if (!response.ok) throw new BookingServiceError("Failed to lookup booking", response.status);

        const data = await response.json();
        return Array.isArray(data) ? data : [data];
    },

    updateStatus: async (bookingId: string, request: UpdateBookingStatusRequest): Promise<BookingDTO> => {
        if (USE_MOCKS) {
            await delay(500);
            const existing = mockBookings.find(b => b.id === bookingId);
            if (!existing) throw new BookingServiceError("Booking not found in mocks", 404);

            return {
                ...existing,
                status: request.status,
            };
        }

        const response = await fetch(buildTenantApiUrl(`bookings/${bookingId}/status`), {
            method: "PUT",
            headers: {
                ...getTenantHeaders(),
                "Content-Type": "application/json",
            },
            body: JSON.stringify(request),
        });

        if (!response.ok) throw new BookingServiceError("Failed to update booking status", response.status);
        return response.json();
    },
};
