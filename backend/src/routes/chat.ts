import { Router } from 'express';
import { llm } from '../llm/groqClient';
import { LLMResponseSchema, FALLBACK_RESPONSE } from '../llm/contracts';
import { buildSystemContext } from '../context/contextBuilder';
import { sessionService } from '../services/sessionService';
import { hotelService } from '../services/hotelService';
import { bookingService } from '../services/bookingService';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
const MAX_HISTORY_TURNS = 6;

router.post('/', async (req, res) => {
    try {
        const { transcript, currentState, sessionId } = req.body;
        const sid = sessionId || "default-session";

        // 1. PRIVACY GUARD: Wipe memory when back at WELCOME/IDLE
        if (currentState === "WELCOME" || currentState === "IDLE") {
            await sessionService.clearSession(sid);
        }

        // 2. Fetch History from DB
        let history = await sessionService.getHistory(sid);

        // 3. Fetch REAL Room Data
        const availableRooms = await hotelService.getAvailableRooms();
        const roomContext = availableRooms.map(r =>
            `- Room ${r.number} (${r.type}): $${r.price}. ${r.description}`
        ).join('\n');

        // 4. Build Context (Now with real rooms!)
        const contextJson = buildSystemContext({
            currentState,
            transcript,
            hotelDataOverride: { availableRooms: roomContext }
        });

        // 5. Format History for LLM
        const recentHistory = history.slice(-MAX_HISTORY_TURNS);
        const historySection = recentHistory.length > 0
            ? `--- PREVIOUS CONVERSATION ---\n${recentHistory.map(m => `${m.role === 'user' ? 'Guest' : 'Siya'}: ${m.text}`).join('\n')}\n------------------------------`
            : "";

        // 6. Call LLM
        const systemPrompt = `You are Siya, the AI Concierge.
* Never say "I am an AI".
* Output strictly in JSON format.

6.  **Handle Booking:**
    * If the user explicitly confirms they want to book a specific room, you MUST:
    * Set "bookingIntent" object in your JSON response.
    * Set "roomId" to the Room Number (e.g., "101").
    * Set "confirmed" to true.
    * Keep your speech brief: "Excellent choice. I am initiating the payment for Room 101."

OUTPUT FORMAT (JSON ONLY):
${contextJson}
${historySection}`;

        const response = await llm.invoke([
            { role: "system", content: systemPrompt },
            { role: "user", content: transcript }
        ]);

        const rawContent = response.content.toString();
        // Extract JSON from LLM response (sometimes they add extra text)
        const jsonMatch = rawContent.match(/\{[\s\S]*\}/);

        if (!jsonMatch) throw new Error("No JSON found in LLM response");

        // 7. ZOD VALIDATION
        const parsedJson = JSON.parse(jsonMatch[0]);
        const validated = LLMResponseSchema.parse(parsedJson);

        // --- NEW: HANDLE BOOKING ---
        // Initialize clientResponse with validated data and default paymentUrl as null
        let clientResponse: any = { ...validated, paymentUrl: null };

        if (validated.bookingIntent && validated.bookingIntent.confirmed) {
            try {
                // 1. Find the room ID based on the number the AI heard
                const room = await hotelService.getRoomByNumber(validated.bookingIntent.roomId);

                if (room) {
                    // 2. Create Booking
                    // Hardcoded guest email for kiosk demo as per legacy instructions
                    const booking = await bookingService.createPendingBooking(room.id, "guest@example.com");

                    // 3. Create Payment Link
                    const paymentUrl = await bookingService.createPaymentSession(booking.id, room.price);

                    clientResponse.paymentUrl = paymentUrl;
                    clientResponse.speech += " I've prepared the payment terminal for you.";
                } else {
                    clientResponse.speech = "I apologize, but I couldn't find that room number.";
                }
            } catch (e) {
                console.error("Booking failed:", e);
                clientResponse.speech = "I apologize, but that room seems to have just been taken.";
            }
        }
        // ---------------------------

        // 8. UPDATE MEMORY (Post-Response) to DB
        await sessionService.addMessage(sid, {
            id: uuidv4(), role: "user", text: transcript, timestamp: Date.now()
        });

        if (clientResponse.speech) {
            await sessionService.addMessage(sid, {
                id: uuidv4(), role: "assistant", text: clientResponse.speech, timestamp: Date.now()
            });
        }

        res.json(clientResponse);

    } catch (error) {
        console.error("[Brain] Error:", error);
        res.json(FALLBACK_RESPONSE);
    }
});

export default router;
