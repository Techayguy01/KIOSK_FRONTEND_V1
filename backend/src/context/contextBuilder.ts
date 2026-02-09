import { HOTEL_CONFIG } from "./hotelData";

/**
 * Context Builder (Phase 9.3 - Situational Awareness)
 * 
 * Builds the "World View" for the LLM every request.
 * This is STATELESS - we inject reality, not memory.
 */

interface ContextInput {
    currentState: string;
    transcript: string;
}

export function buildSystemContext(input: ContextInput): string {
    // 1. Get Local Hotel Time (Not Server Time!)
    const now = new Date();

    const localTime = new Intl.DateTimeFormat('en-US', {
        timeZone: HOTEL_CONFIG.timezone,
        hour: 'numeric',
        minute: 'numeric',
        hour12: true
    }).format(now);

    const currentHour = parseInt(new Intl.DateTimeFormat('en-US', {
        timeZone: HOTEL_CONFIG.timezone,
        hour: 'numeric',
        hour12: false
    }).format(now));

    const partOfDay = currentHour < 12 ? "Morning" : currentHour < 18 ? "Afternoon" : "Evening";

    // 2. Build Context Object
    const context = {
        environment: {
            hotel: HOTEL_CONFIG.name,
            location: HOTEL_CONFIG.location,
            localTime: localTime,
            partOfDay: partOfDay,
        },
        kioskState: {
            currentScreen: input.currentState,
            canSpeak: true, // Voice is active
        },
        policy: {
            checkIn: HOTEL_CONFIG.checkInStart,
            checkOut: HOTEL_CONFIG.checkOutEnd,
            amenities: HOTEL_CONFIG.amenities,
        }
    };

    return JSON.stringify(context, null, 2);
}
