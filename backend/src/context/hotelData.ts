/**
 * Hotel Configuration (Phase 9.3 - Context Injection)
 * 
 * Static "Truth" about the hotel.
 * This data is injected into every LLM prompt.
 */

export const HOTEL_CONFIG = {
    name: "Grand Hotel Nagpur",
    timezone: "Asia/Kolkata", // CRITICAL: Force local time, not server time
    checkInStart: "14:00", // THis is Check-in-Time
    checkOutEnd: "11:00", // This is Check-out-Time
    amenities: ["Free Wi-Fi", "Pool (6AM-10PM)", "Breakfast (7AM-10AM)", "Spa"], // This is Amenities
    supportPhone: "999", // This is Support Phone
    location: "Lobby Kiosk" // This is Location
};
