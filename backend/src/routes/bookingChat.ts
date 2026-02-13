import { Router, Request, Response } from "express";
import { llm } from "../llm/groqClient.js";
import { BookingLLMResponseSchema, BOOKING_FALLBACK } from "../llm/bookingContracts.js";
import { buildSystemContext } from "../context/contextBuilder.js";
import { HOTEL_CONFIG } from "../context/hotelData.js";
import { formatInventoryForPrompt } from "../context/roomInventory.js";

const router = Router();

/**
 * Booking Session Memory
 * 
 * Tracks per-session: conversation history + accumulated booking slots.
 * Memory is wiped when session resets.
 */
interface BookingSession {
    history: { role: "user" | "assistant"; content: string }[];
    slots: Record<string, any>;
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

router.post("/", async (req: Request, res: Response) => {
    const start = Date.now();
    try {
        const { transcript, currentState, sessionId } = req.body;
        const sid = sessionId || "default";

        console.log(`[BookingBrain] Input: "${transcript}" | State: ${currentState} | Session: ${sid}`);

        // Privacy wipe on WELCOME/IDLE
        if (currentState === "WELCOME" || currentState === "IDLE") {
            if (bookingSessions.has(sid)) {
                console.log(`[BookingBrain] Privacy wipe: Session ${sid}`);
                bookingSessions.delete(sid);
            }
        }

        // Empty transcript
        if (!transcript || transcript.trim().length === 0) {
            res.json({ ...BOOKING_FALLBACK, speech: "", intent: "UNKNOWN", confidence: 1.0 });
            return;
        }

        // Get or create session
        let session = bookingSessions.get(sid) || { history: [], slots: {} };

        // Build history string
        const recentHistory = session.history.slice(-MAX_HISTORY_TURNS);
        const historySection = recentHistory.length > 0
            ? `--- PREVIOUS CONVERSATION ---\n${recentHistory.map(m => `${m.role === "user" ? "Guest" : "Concierge"}: ${m.content}`).join("\n")}\n------------------------------`
            : "--- PREVIOUS CONVERSATION ---\n(This is the start of the booking conversation)\n------------------------------";

        // Build context
        const contextJson = buildSystemContext({ currentState: currentState || "BOOKING", transcript });

        // Format current slots for prompt
        const slotsDisplay = Object.keys(session.slots).length > 0
            ? JSON.stringify(session.slots, null, 2)
            : "{ (no slots filled yet) }";

        const requiredSlots = ["roomType", "adults", "checkInDate", "checkOutDate", "guestName"];
        const missingSlots = requiredSlots.filter(s => !session.slots[s]);

        // Build prompt
        const filledPrompt = BOOKING_SYSTEM_PROMPT
            .replace("{{HOTEL_NAME}}", HOTEL_CONFIG.name)
            .replace("{{CONTEXT_JSON}}", contextJson)
            .replace("{{ROOM_INVENTORY}}", formatInventoryForPrompt())
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
            console.warn("[BookingBrain] LLM failed to output JSON:", rawContent);
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
        };

        console.log(`[BookingBrain] Response:`, finalResponse, `(${Date.now() - start}ms)`);
        res.json(finalResponse);

    } catch (error) {
        console.error("[BookingBrain] Error:", error);
        res.json(BOOKING_FALLBACK);
    }
});

export default router;
