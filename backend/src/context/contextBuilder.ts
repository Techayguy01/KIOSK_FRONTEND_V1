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

    // 1.5 Define Screen Contexts (Phase 17: Semantic Context)
    let screenContext = "User is navigating the kiosk.";
    switch (input.currentState) {
        case 'WELCOME':
            screenContext = "User is at the Start Screen. Goal: Get them to Check In.";
            break;
        case 'SCAN_ID':
            screenContext = "User is currently scanning their ID. If they ask 'Why?', explain it is for security.";
            break;
        case 'ROOM_SELECT':
            screenContext = "User is looking at Room Options (Deluxe, Standard). If they ask 'Which one?', recommend Deluxe.";
            break;
        case 'PAYMENT':
            screenContext = "User is at Payment. We accept Credit Cards and NFC.";
            break;
        case 'IDLE':
            screenContext = "User is approaching the kiosk.";
            break;
        case 'MANUAL_MENU':
            screenContext = "User is using the touch menu fallback.";
            break;
        case 'AI_CHAT':
            screenContext = "User is in general chat mode.";
            break;
    }

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
            screenDescription: screenContext,
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
