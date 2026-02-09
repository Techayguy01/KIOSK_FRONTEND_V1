import { Router, Request, Response } from 'express';
import { llm } from '../llm/groqClient';
import { LLMResponseSchema, FALLBACK_RESPONSE } from '../llm/contracts';
import { buildSystemContext } from '../context/contextBuilder';
import { HOTEL_CONFIG } from '../context/hotelData';

const router = Router();

/**
 * Phase 9.6: Session Memory Store
 * 
 * Simple in-memory session store (Map<sessionId, History[]>)
 * In production, use Redis. For Kiosk (single active user), memory is fine.
 * 
 * PRIVACY RULE: Memory is WIPED when user returns to WELCOME/IDLE.
 */
interface ChatMessage {
    role: "user" | "assistant";
    content: string;
}

const sessionMemory = new Map<string, ChatMessage[]>();
const MAX_HISTORY_TURNS = 6;  // Last 3 exchanges (6 messages)

/**
 * Phase 9.4 - Context-Aware System Prompt with Confidence Scoring
 * Phase 9.6 - Now includes conversation history
 */
const SYSTEM_PROMPT_TEMPLATE = `
You are Siya, the AI Concierge at {{HOTEL_NAME}}.
Your goal is to assist guests with Check-In, Booking, and General Questions.
You must be helpful, concise, and professional.

--- CURRENT SITUATIONAL CONTEXT ---
{{CONTEXT_JSON}}
-----------------------------------

{{CONVERSATION_HISTORY}}

# CRITICAL RULES:
1.  **Identify Intent:** Classify the user's request into one of these strict intents:
    * CHECK_IN (User wants to check in, scan ID, or lookup reservation).
    * BOOK_ROOM (User wants to book a new room).
    * RECOMMEND_ROOM (User asks YOU to choose/recommend a room).
    * HELP (User is confused, angry, or asks for a human).
    * GENERAL_QUERY (General questions about policy, weather, jokes).
    * IDLE (No speech detected or irrelevant).
    * UNKNOWN (Cannot determine intent).

2.  **State Awareness:** You are currently on the "{{CURRENT_STATE}}" screen.

3.  **Handle "Re-Stated" Intents:**
    * If the user says "I want to book" and they are *already* booking, treat it as a "GENERAL_QUERY" confirmation.
    * *Reply:* "Great. Please select a room from the screen to proceed."

4.  **Handle "Agentic Choice":**
    * If the user says "You choose" or "Recommend one", you MUST make a decision.
    * *Reply:* "I have selected the Deluxe Suite for you. It has a great view."
    * *Intent:* RECOMMEND_ROOM

5.  **Format:**
    * Keep 'speech' short (under 2 sentences).
    * Never say "I am an AI".
    * Output strictly in JSON format.

OUTPUT FORMAT (JSON ONLY):
{
  "speech": "string (The spoken response)",
  "intent": "VALID_INTENT_ENUM",
  "confidence": number (0.0 to 1.0)
}
`;

router.post('/', async (req: Request, res: Response) => {
    const start = Date.now();
    try {
        const { transcript, currentState, sessionId } = req.body;
        const sid = sessionId || "default";  // Fallback for testing

        console.log(`[Brain] Input: "${transcript}" | State: ${currentState} | Session: ${sid}`);

        // 1. PRIVACY GUARD 🛡️
        // If we are back at WELCOME or IDLE, the previous user is gone. Wipe memory.
        if (currentState === "WELCOME" || currentState === "IDLE") {
            if (sessionMemory.has(sid)) {
                console.log(`[Brain] Privacy wipe: Session ${sid} memory cleared`);
                sessionMemory.delete(sid);
            }
        }

        // Empty transcript = IDLE
        if (!transcript || transcript.trim().length === 0) {
            res.json({ speech: "", intent: "IDLE", confidence: 1.0 });
            return;
        }

        // 2. Retrieve History
        let history = sessionMemory.get(sid) || [];

        // 3. Build History String for Prompt
        const recentHistory = history.slice(-MAX_HISTORY_TURNS);
        let historySection = "";
        if (recentHistory.length > 0) {
            historySection = `--- PREVIOUS CONVERSATION ---
${recentHistory.map(m => `${m.role === 'user' ? 'Guest' : 'Concierge'}: ${m.content}`).join('\n')}
------------------------------`;
        } else {
            historySection = "--- PREVIOUS CONVERSATION ---\n(This is the start of the conversation)\n------------------------------";
        }

        // 4. Build the Dynamic Context
        const contextJson = buildSystemContext({
            currentState: currentState || "IDLE",
            transcript
        });

        // 5. Inject into Prompt Template
        const filledPrompt = SYSTEM_PROMPT_TEMPLATE
            .replace('{{HOTEL_NAME}}', HOTEL_CONFIG.name)
            .replace('{{CONTEXT_JSON}}', contextJson)
            .replace('{{CURRENT_STATE}}', currentState || "IDLE")
            .replace('{{CONVERSATION_HISTORY}}', historySection);

        // 6. Call LLM with Context + History
        const response = await llm.invoke([
            { role: "system", content: filledPrompt },
            { role: "user", content: transcript }
        ]);

        // 7. Extract JSON from response
        const rawContent = response.content.toString();
        const jsonMatch = rawContent.match(/\{[\s\S]*\}/);

        if (!jsonMatch) {
            console.warn("[Brain] LLM failed to output JSON:", rawContent);
            throw new Error("Malformed LLM Output");
        }

        const parsedJson = JSON.parse(jsonMatch[0]);

        // 8. ZOD VALIDATION
        const validated = LLMResponseSchema.parse(parsedJson);

        // 9. UPDATE MEMORY (Post-Response)
        history.push({ role: "user", content: transcript });
        if (validated.speech) {
            history.push({ role: "assistant", content: validated.speech });
        }
        sessionMemory.set(sid, history);

        console.log(`[Brain] Validated:`, validated, `(${Date.now() - start}ms)`);
        res.json(validated);

    } catch (error) {
        console.error("[Brain] Rejected:", error);
        res.json(FALLBACK_RESPONSE);
    }
});

export default router;
