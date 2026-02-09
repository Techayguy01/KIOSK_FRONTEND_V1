import { z } from "zod";

/**
 * LLM Contracts (Phase 9.2 - Prompt Governance)
 * 
 * This is the SINGLE SOURCE OF TRUTH for LLM output validation.
 * The LLM is an ADVISOR - it can only suggest intents from this list.
 * The Agent (FSM) is the AUTHORITY - it decides if the intent is valid.
 */

// 1. Define the Strict List of Allowed Intents
// These MUST match your Agent's FSM capabilities.
export const IntentSchema = z.enum([
    "IDLE",
    "WELCOME",
    "CHECK_IN",     // User wants to check in
    "SCAN_ID",      // User is ready to scan ID / providing name
    "PAYMENT",      // User wants to pay
    "HELP",         // User needs assistance
    "REPEAT",       // User asked to repeat the last thing
    "UNKNOWN"       // LLM is confused / Out of domain
]);

// Phase 9.4: Confidence Thresholds for Safety Gating
export const CONFIDENCE_THRESHOLDS = {
    HIGH: 0.85,     // Execute immediately
    MEDIUM: 0.50,   // Ask clarifying question
    // Below 0.50 is considered Noise/Silence - reject
};

// 2. Define the strict JSON Output Schema
export const LLMResponseSchema = z.object({
    speech: z.string().describe("A concise, polite response for the TTS (max 2 sentences)."),
    intent: IntentSchema.describe("The classification of the user's request."),
    confidence: z.number().min(0).max(1).describe("Self-evaluated confidence score (0.0 to 1.0).")
});

export type LLMResponse = z.infer<typeof LLMResponseSchema>;
export type ValidIntent = z.infer<typeof IntentSchema>;

// 3. Default fallback for validation failures
export const FALLBACK_RESPONSE: LLMResponse = {
    speech: "I'm having trouble understanding. Please use the touch screen.",
    intent: "UNKNOWN",
    confidence: 0.0
};
