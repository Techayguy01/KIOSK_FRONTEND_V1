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

interface ContextOverrides {
    hotelName?: string;
    timezone?: string;
    location?: string;
    checkIn?: string;
    checkOut?: string;
    amenities?: string[];
}

function normalizeTimeString(value: unknown, fallback: string): string {
    if (!value) return fallback;

    if (typeof value === "string") {
        const hhmm = value.match(/^(\d{1,2}):(\d{2})/);
        if (hhmm) {
            const hour = hhmm[1].padStart(2, "0");
            return `${hour}:${hhmm[2]}`;
        }
        const fromDate = new Date(value);
        if (!Number.isNaN(fromDate.getTime())) {
            return fromDate.toISOString().slice(11, 16);
        }
        return fallback;
    }

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(11, 16);
    }

    return fallback;
}

export function buildSystemContext(input: ContextInput, overrides?: ContextOverrides): string {
    const timezone = overrides?.timezone || "UTC";
    const hotelName = overrides?.hotelName || "Kiosk Hotel";
    const location = overrides?.location || "Lobby Kiosk";
    const checkIn = normalizeTimeString(overrides?.checkIn, "14:00");
    const checkOut = normalizeTimeString(overrides?.checkOut, "11:00");
    const amenities = Array.isArray(overrides?.amenities) ? overrides!.amenities : [];

    // 1. Get Local Hotel Time (Not Server Time!)
    const now = new Date();

    const localTime = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        minute: 'numeric',
        hour12: true
    }).format(now);

    const currentHour = parseInt(new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        hour12: false
    }).format(now));

    const partOfDay = currentHour < 12 ? "Morning" : currentHour < 18 ? "Afternoon" : "Evening";

    // 2. Build Context Object
    const context = {
        environment: {
            hotel: hotelName,
            location: location,
            localTime: localTime,
            partOfDay: partOfDay,
        },
        kioskState: {
            currentScreen: input.currentState,
            canSpeak: true, // Voice is active
        },
        policy: {
            checkIn,
            checkOut,
            amenities,
        }
    };

    return JSON.stringify(context, null, 2);
}
