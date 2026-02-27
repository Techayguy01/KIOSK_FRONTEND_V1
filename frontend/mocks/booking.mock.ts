import type { GuestDTO, BookingDTO } from "@contracts/api.contract";

export const mockGuest: GuestDTO = {
    id: "guest_mock_991",
    tenantId: "tenant_demo",
    fullName: "Rahul Desai",
    phone: "+91 98765 43210",
    email: "rahul.desai@example.com",
};

export const mockBookings: BookingDTO[] = [
    {
        id: "booking_abc_123",
        tenantId: "tenant_demo",
        guestId: "guest_mock_991",
        roomTypeId: "room_type_deluxe_id",
        status: "confirmed",
        adults: 2,
        children: 1,
        checkInDate: new Date().toISOString(),
        checkOutDate: new Date(Date.now() + 86400000 * 2).toISOString(), // + 2 days
        nights: 2,
        totalPrice: 15000,
        currency: "INR",
        guestName: "Rahul Desai",
    },
    {
        id: "booking_xyz_889",
        tenantId: "tenant_demo",
        roomTypeId: "room_type_suite_id",
        status: "draft",
        adults: 1,
        children: 0,
        checkInDate: new Date(Date.now() + 86400000).toISOString(),
        checkOutDate: new Date(Date.now() + 86400000 * 3).toISOString(),
        nights: 2,
        totalPrice: 22000,
        currency: "INR",
        guestName: "Priya Sharma",
    }
];
