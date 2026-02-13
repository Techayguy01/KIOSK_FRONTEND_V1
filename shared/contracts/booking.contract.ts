/**
 * Booking Contract — Single Source of Truth
 * 
 * Defines the data model for conversational room booking.
 * Both backend (slot-filling LLM) and frontend (booking UI) import this.
 * 
 * RULE: If you change a type here, both sides must be updated.
 */

// ============================================
// 1. Room Types (must match hotel inventory)
// ============================================
export type RoomType = "STANDARD" | "DELUXE" | "PRESIDENTIAL";

export interface RoomInfo {
    type: RoomType;
    name: string;
    pricePerNight: number;
    maxAdults: number;
    maxChildren: number;
    amenities: string[];
    description: string;
}

// ============================================
// 2. Booking Slots (conversational form fields)
// ============================================
export interface BookingSlots {
    roomType: RoomType | null;
    adults: number | null;
    children: number | null;
    checkInDate: string | null;   // ISO format: "2026-02-13"
    checkOutDate: string | null;  // ISO format: "2026-02-15"
    guestName: string | null;
    nights: number | null;        // Computed from dates
    totalPrice: number | null;    // Computed from room + nights
}

/** Returns an empty booking with all slots null */
export function createEmptyBooking(): BookingSlots {
    return {
        roomType: null,
        adults: null,
        children: null,
        checkInDate: null,
        checkOutDate: null,
        guestName: null,
        nights: null,
        totalPrice: null,
    };
}

/** Returns list of slot names that are still null (unfilled) */
export function getMissingSlots(slots: BookingSlots): string[] {
    const required: (keyof BookingSlots)[] = [
        "roomType", "adults", "checkInDate", "checkOutDate", "guestName"
    ];
    return required.filter(key => slots[key] === null);
}

/** Returns true if all required slots are filled */
export function isBookingComplete(slots: BookingSlots): boolean {
    return getMissingSlots(slots).length === 0;
}

// ============================================
// 3. Booking-Specific Intents (extends base intents)
// ============================================
export type BookingIntent =
    | "SELECT_ROOM"         // User chose a specific room
    | "PROVIDE_GUESTS"      // User stated guest count
    | "PROVIDE_DATES"       // User stated check-in/out dates
    | "PROVIDE_NAME"        // User gave their name
    | "CONFIRM_BOOKING"     // User confirmed the summary
    | "MODIFY_BOOKING"      // User wants to change a slot
    | "CANCEL_BOOKING"      // User wants to abort booking
    | "ASK_ROOM_DETAIL"     // User wants info about a room
    | "COMPARE_ROOMS"       // User wants to compare options
    | "ASK_PRICE";          // User asks about pricing

// ============================================
// 4. Enhanced Backend Response (for booking flow)
// ============================================
export interface BookingResponse {
    speech: string;                    // TTS output
    intent: string;                    // Classified intent
    confidence: number;                // 0.0 - 1.0
    bookingSlots?: Partial<BookingSlots>;  // Newly extracted slot values
    nextSlotToAsk?: string;            // Which slot to ask for next
    isComplete?: boolean;              // All required slots filled?
    summary?: string;                  // Human-readable booking summary
}
