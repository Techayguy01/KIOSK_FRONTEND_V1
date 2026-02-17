import { Router, Request, Response } from "express";
import { z } from "zod";
import { llm } from "../llm/groqClient.js";
import { BookingLLMResponseSchema, BOOKING_FALLBACK } from "../llm/bookingContracts.js";
import { buildSystemContext } from "../context/contextBuilder.js";
import { HOTEL_CONFIG } from "../context/hotelData.js";
import { ROOM_INVENTORY } from "../context/roomInventory.js";
import { validateBody } from "../middleware/validateRequest.js";
import { logWithContext } from "../utils/logger.js";
import { sendApiError } from "../utils/http.js";
import { prisma } from "../db/prisma.js";

const router = Router();
const ENABLE_STATIC_CONTEXT_FALLBACK = process.env.ENABLE_STATIC_CONTEXT_FALLBACK === "1";
const BookingChatRequestSchema = z.object({
    transcript: z.string().optional(),
    currentState: z.string().optional(),
    sessionId: z.string().optional(),
});

/**
 * Booking Session Memory
 * 
 * Tracks per-session: conversation history + accumulated booking slots.
 * Memory is wiped when session resets.
 */
interface BookingSession {
    history: { role: "user" | "assistant"; content: string }[];
    slots: Record<string, any>;
    bookingId?: string;
}

const bookingSessions = new Map<string, BookingSession>();
const MAX_HISTORY_TURNS = 10; // 5 exchanges

const BOOKING_SYSTEM_PROMPT = `
You are Siya, the AI Concierge at {{HOTEL_NAME}}.
You are currently helping a guest BOOK A ROOM through voice conversation.

--- CURRENT CONTEXT ---
{{CONTEXT_JSON}}
-----------------------

--- AVAILABLE ROOMS ---
{{ROOM_INVENTORY}}
-----------------------

--- CURRENT BOOKING STATE ---
{{BOOKING_SLOTS}}
Unfilled slots: {{MISSING_SLOTS}}
-----------------------------

{{CONVERSATION_HISTORY}}

# YOUR TASK:
You are having a natural conversation to collect booking details.
You must extract information from the user's speech and fill these slots:
  - roomType (STANDARD, DELUXE, or PRESIDENTIAL)
  - adults (number of adult guests, 1-4)
  - children (number of children, 0-3) — only ask if relevant
  - checkInDate (ISO date string, e.g., "2026-02-13")
  - checkOutDate (ISO date string)
  - guestName (name for the reservation)

# EXTRACTION RULES:
1. Parse COMPOUND statements. "Book the deluxe for 2 nights starting tomorrow for me and my wife" = roomType:DELUXE, nights:2, checkInDate:tomorrow, adults:2
2. Resolve relative dates. "Tomorrow" = next calendar day. "Next weekend" = nearest Saturday. "The 15th" = 15th of current/next month. Use today's date from context.
3. Compute nights from check-in and check-out dates if both are given.
4. Compute totalPrice = pricePerNight × nights if room and nights are known.
5. Do NOT ask for children unless the user mentions them or it's the only slot left.
6. When ALL required slots are filled, set isComplete:true and generate a summary in speech.

# CONVERSATION RULES:
1. Ask for ONE slot at a time (unless user volunteers multiple).
2. If user corrects a value ("Actually make that 3 adults"), update the slot.
3. If user asks a question mid-booking ("What time is breakfast?"), answer it, then return to the next unfilled slot.
4. If user says "go back" or "cancel", set intent to CANCEL_BOOKING.
5. If user says "start over", set intent to CANCEL_BOOKING.
6. Be warm, concise, and human. Max 2 sentences per response.
7. When summarizing, read back ALL filled slots for confirmation.

# OUTPUT FORMAT (strict JSON):
{
  "speech": "Your spoken response (max 2 sentences)",
  "intent": "SELECT_ROOM|PROVIDE_GUESTS|PROVIDE_DATES|PROVIDE_NAME|CONFIRM_BOOKING|MODIFY_BOOKING|CANCEL_BOOKING|ASK_ROOM_DETAIL|ASK_PRICE|GENERAL_QUERY|HELP|UNKNOWN",
  "confidence": 0.0-1.0,
  "extractedSlots": {
    "roomType": "DELUXE" or null,
    "adults": 2 or null,
    "children": 0 or null,
    "checkInDate": "2026-02-13" or null,
    "checkOutDate": "2026-02-15" or null,
    "guestName": "John Smith" or null,
    "nights": 2 or null,
    "totalPrice": 9000 or null
  },
  "nextSlotToAsk": "adults" or null,
  "isComplete": false
}

ONLY output JSON. No markdown, no explanation, no preamble.
`;

function formatInventoryForPrompt(roomTypes: Array<{
    id: string;
    code: string;
    name: string;
    price: unknown;
    amenities: string[];
}>): string {
    if (!roomTypes || roomTypes.length === 0) {
        return "- No rooms are currently configured for this tenant.";
    }

    return roomTypes
        .map((room) => {
            const numericPrice = Number(room.price);
            return `- ${room.name} (${room.code}): $${numericPrice}/night | Amenities: ${room.amenities.join(", ")}`;
        })
        .join("\n");
}

function normalizeRoomKey(value: string): string {
    return value.trim().toUpperCase().replace(/[\s-]+/g, "_");
}

function resolveRoomType(
    roomTypes: Array<{ id: string; code: string; name: string }>,
    requestedRoomType: unknown
): { id: string; code: string; name: string } | null {
    if (!requestedRoomType || typeof requestedRoomType !== "string") {
        return null;
    }

    const normalizedRequested = normalizeRoomKey(requestedRoomType);
    const exactCode = roomTypes.find((room) => normalizeRoomKey(room.code) === normalizedRequested);
    if (exactCode) return exactCode;

    const byName = roomTypes.find((room) => normalizeRoomKey(room.name).includes(normalizedRequested));
    if (byName) return byName;

    if (normalizedRequested === "DELUXE") {
        return roomTypes.find((room) => normalizeRoomKey(room.code).includes("DELUXE")) || null;
    }
    if (normalizedRequested === "STANDARD") {
        return roomTypes.find((room) => normalizeRoomKey(room.code).includes("STANDARD")) || null;
    }
    if (normalizedRequested === "PRESIDENTIAL") {
        return roomTypes.find((room) => normalizeRoomKey(room.code).includes("PRESIDENTIAL")) || null;
    }

    return null;
}

function parseIsoDate(value: unknown): Date | null {
    if (!value || typeof value !== "string") return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return new Date(date.toISOString().slice(0, 10));
}

function isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

router.post("/", validateBody(BookingChatRequestSchema), async (req: Request, res: Response) => {
    const start = Date.now();
    try {
        const { transcript, currentState, sessionId } = req.body;
        const sid = sessionId || "default";

        logWithContext(req, "INFO", "Booking chat request received", {
            currentState,
            sessionId: sid,
        });

        // Privacy wipe on WELCOME/IDLE
        if (currentState === "WELCOME" || currentState === "IDLE") {
            if (bookingSessions.has(sid)) {
                logWithContext(req, "INFO", "Privacy wipe: cleared booking chat memory", { sessionId: sid });
                bookingSessions.delete(sid);
            }
        }

        // Empty transcript
        if (!transcript || transcript.trim().length === 0) {
            res.json({ ...BOOKING_FALLBACK, speech: "", intent: "UNKNOWN", confidence: 1.0 });
            return;
        }

        // Get or create session
        let session: BookingSession = bookingSessions.get(sid) || { history: [], slots: {} };
        const tenant = req.tenant;
        if (!tenant) {
            sendApiError(res, 404, "TENANT_NOT_FOUND", "Tenant not found", req.requestId);
            return;
        }

        let roomTypes: Array<{
            id: string;
            code: string;
            name: string;
            price: unknown;
            amenities: string[];
        }> = [];
        try {
            roomTypes = await prisma.roomType.findMany({
                where: { tenantId: tenant.id },
                select: {
                    id: true,
                    code: true,
                    name: true,
                    price: true,
                    amenities: true,
                },
                orderBy: { price: "asc" },
            });
        } catch (error) {
            if (!ENABLE_STATIC_CONTEXT_FALLBACK) {
                throw error;
            }
            roomTypes = ROOM_INVENTORY.map((room) => ({
                id: room.type,
                code: room.type,
                name: room.name,
                price: room.pricePerNight,
                amenities: room.amenities,
            }));
            logWithContext(req, "WARN", "Using static room inventory fallback", {
                reason: error instanceof Error ? error.message : String(error),
            });
        }

        if (roomTypes.length === 0 && ENABLE_STATIC_CONTEXT_FALLBACK) {
            roomTypes = ROOM_INVENTORY.map((room) => ({
                id: room.type,
                code: room.type,
                name: room.name,
                price: room.pricePerNight,
                amenities: room.amenities,
            }));
            logWithContext(req, "WARN", "Using static room inventory fallback because tenant has no room types");
        }

        // Build history string
        const recentHistory = session.history.slice(-MAX_HISTORY_TURNS);
        const historySection = recentHistory.length > 0
            ? `--- PREVIOUS CONVERSATION ---\n${recentHistory.map(m => `${m.role === "user" ? "Guest" : "Concierge"}: ${m.content}`).join("\n")}\n------------------------------`
            : "--- PREVIOUS CONVERSATION ---\n(This is the start of the booking conversation)\n------------------------------";

        // Build context
        const hotelConfig = tenant.hotelConfig;
        const fallbackConfig = ENABLE_STATIC_CONTEXT_FALLBACK ? HOTEL_CONFIG : null;
        const contextJson = buildSystemContext(
            { currentState: currentState || "BOOKING", transcript },
            {
                hotelName: tenant.name,
                timezone: hotelConfig?.timezone ?? fallbackConfig?.timezone,
                checkIn: hotelConfig?.checkInTime ?? fallbackConfig?.checkInStart,
                checkOut: fallbackConfig?.checkOutEnd ?? "11:00",
                amenities: fallbackConfig?.amenities ?? [],
                location: fallbackConfig?.location ?? "Lobby Kiosk",
            }
        );

        // Format current slots for prompt
        const slotsDisplay = Object.keys(session.slots).length > 0
            ? JSON.stringify(session.slots, null, 2)
            : "{ (no slots filled yet) }";

        const requiredSlots = ["roomType", "adults", "checkInDate", "checkOutDate", "guestName"];
        const missingSlots = requiredSlots.filter(s => !session.slots[s]);

        // Build prompt
        const filledPrompt = BOOKING_SYSTEM_PROMPT
            .replace("{{HOTEL_NAME}}", tenant.name)
            .replace("{{CONTEXT_JSON}}", contextJson)
            .replace("{{ROOM_INVENTORY}}", formatInventoryForPrompt(roomTypes))
            .replace("{{BOOKING_SLOTS}}", slotsDisplay)
            .replace("{{MISSING_SLOTS}}", missingSlots.length > 0 ? missingSlots.join(", ") : "(all filled!)")
            .replace("{{CONVERSATION_HISTORY}}", historySection);

        // Call LLM
        const response = await llm.invoke([
            { role: "system", content: filledPrompt },
            { role: "user", content: transcript }
        ]);

        // Extract JSON
        const rawContent = response.content.toString();
        const jsonMatch = rawContent.match(/\{[\s\S]*\}/);

        if (!jsonMatch) {
            logWithContext(req, "WARN", "Booking LLM failed to output JSON", { rawContent });
            throw new Error("Malformed LLM Output");
        }

        const parsedJson = JSON.parse(jsonMatch[0]);
        const validated = BookingLLMResponseSchema.parse(parsedJson);

        // Merge extracted slots into session
        if (validated.extractedSlots) {
            for (const [key, value] of Object.entries(validated.extractedSlots)) {
                if (value !== null && value !== undefined) {
                    session.slots[key] = value;
                }
            }
        }

        const shouldPersistBooking = validated.isComplete === true || validated.intent === "CONFIRM_BOOKING";
        let persistedBookingId: string | null = session.bookingId || null;
        if (shouldPersistBooking) {
            const room = resolveRoomType(roomTypes, session.slots.roomType);
            const checkInDate = parseIsoDate(session.slots.checkInDate);
            const checkOutDate = parseIsoDate(session.slots.checkOutDate);
            const adults = Number(session.slots.adults);
            const children = session.slots.children === undefined ? null : Number(session.slots.children);
            const nights =
                session.slots.nights !== undefined
                    ? Number(session.slots.nights)
                    : checkInDate && checkOutDate
                        ? Math.max(
                            1,
                            Math.ceil((checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24))
                        )
                        : NaN;

            const primaryRoomPrice = room
                ? Number(roomTypes.find((r) => r.id === room.id)?.price ?? 0)
                : 0;
            const totalPrice =
                session.slots.totalPrice !== undefined
                    ? Number(session.slots.totalPrice)
                    : Number.isFinite(nights)
                        ? primaryRoomPrice * Number(nights)
                        : NaN;

            if (room && isUuid(room.id) && checkInDate && checkOutDate && Number.isFinite(adults) && Number.isFinite(nights) && session.slots.guestName) {
                const idempotencyKey = `${tenant.id}:${sid}:${room.id}:${checkInDate.toISOString().slice(0, 10)}:${checkOutDate.toISOString().slice(0, 10)}:${String(session.slots.guestName).trim().toLowerCase()}`;
                const status = validated.intent === "CONFIRM_BOOKING" ? "CONFIRMED" : "DRAFT";

                if (session.bookingId) {
                    const updated = await prisma.booking.update({
                        where: { id: session.bookingId },
                        data: {
                            guestName: String(session.slots.guestName),
                            roomTypeId: room.id,
                            checkInDate,
                            checkOutDate,
                            adults,
                            children: children !== null && Number.isFinite(children) ? children : null,
                            nights: Number(nights),
                            totalPrice: Number.isFinite(totalPrice) ? totalPrice : null,
                            sessionId: sid,
                            idempotencyKey,
                            status,
                        },
                    });
                    persistedBookingId = updated.id;
                } else {
                    const existing = await prisma.booking.findFirst({
                        where: {
                            tenantId: tenant.id,
                            idempotencyKey,
                        },
                        select: { id: true },
                    });

                    if (existing) {
                        persistedBookingId = existing.id;
                        session.bookingId = existing.id;
                    } else {
                        const created = await prisma.booking.create({
                            data: {
                                tenantId: tenant.id,
                                guestName: String(session.slots.guestName),
                                roomTypeId: room.id,
                                checkInDate,
                                checkOutDate,
                                adults,
                                children: children !== null && Number.isFinite(children) ? children : null,
                                nights: Number(nights),
                                totalPrice: Number.isFinite(totalPrice) ? totalPrice : null,
                                sessionId: sid,
                                idempotencyKey,
                                status,
                            },
                            select: { id: true },
                        });
                        persistedBookingId = created.id;
                        session.bookingId = created.id;
                    }
                }
            } else {
                logWithContext(req, "WARN", "Booking marked complete but required persistence fields are invalid", {
                    roomType: session.slots.roomType,
                    checkInDate: session.slots.checkInDate,
                    checkOutDate: session.slots.checkOutDate,
                    adults: session.slots.adults,
                    guestName: session.slots.guestName,
                });
            }
        }

        // Update history
        session.history.push({ role: "user", content: transcript });
        if (validated.speech) {
            session.history.push({ role: "assistant", content: validated.speech });
        }

        // Save session
        bookingSessions.set(sid, session);

        // Return response with accumulated slots
        const finalResponse = {
            ...validated,
            accumulatedSlots: session.slots,
            missingSlots: requiredSlots.filter(s => !session.slots[s]),
            persistedBookingId,
        };

        logWithContext(req, "INFO", "Booking chat response validated", {
            intent: finalResponse.intent,
            confidence: finalResponse.confidence,
            elapsedMs: Date.now() - start,
            missingSlots: finalResponse.missingSlots,
        });
        res.json(finalResponse);

    } catch (error) {
        logWithContext(req, "ERROR", "Booking chat request failed", {
            error: error instanceof Error ? error.message : String(error),
        });
        sendApiError(
            res,
            500,
            "BOOKING_CHAT_INTERNAL_ERROR",
            BOOKING_FALLBACK.speech || "Booking chat request failed",
            req.requestId
        );
    }
});

export default router;
