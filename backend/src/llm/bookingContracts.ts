import { z } from "zod";

/**
 * Booking LLM Contracts
 * 
 * Extended schema for when the LLM is in "booking mode."
 * The LLM must return both the conversational response AND
 * any slot values it extracted from the user's speech.
 */

export const BookingSlotsSchema = z.object({
    roomType: z.string().min(1).nullable().optional(),
    adults: z.number().min(1).max(20).nullable().optional(),
    children: z.number().min(0).max(10).nullable().optional(),
    checkInDate: z.string().nullable().optional(),
    checkOutDate: z.string().nullable().optional(),
    guestName: z.string().nullable().optional(),
    nights: z.number().min(1).max(30).nullable().optional(),
    totalPrice: z.number().nullable().optional(),
});

export const BookingSlotNameSchema = z.enum([
    "roomType",
    "adults",
    "children",
    "checkInDate",
    "checkOutDate",
    "guestName"
]);

export const BookingSlotExpectedTypeSchema = z.enum(["number", "date", "string"]);

export const BookingHistoryTurnSchema = z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1),
});

export const BookingChatRequestSchema = z.object({
    transcript: z.string().optional(),
    currentState: z.string().optional(),
    sessionId: z.string().optional(),
    activeSlot: BookingSlotNameSchema.nullable().optional(),
    expectedType: BookingSlotExpectedTypeSchema.nullable().optional(),
    lastSystemPrompt: z.string().optional(),
    filledSlots: z.record(z.string(), z.unknown()).optional(),
    conversationHistory: z.array(BookingHistoryTurnSchema).max(12).optional(),
});

export const BookingIntentSchema = z.enum([
    "SELECT_ROOM",
    "PROVIDE_GUESTS",
    "PROVIDE_DATES",
    "PROVIDE_NAME",
    "CONFIRM_BOOKING",
    "MODIFY_BOOKING",
    "CANCEL_BOOKING",
    "ASK_ROOM_DETAIL",
    "COMPARE_ROOMS",
    "ASK_PRICE",
    "BACK_REQUESTED",
    "GENERAL_QUERY",
    "HELP",
    "REPEAT",
    "UNKNOWN"
]);

export const BookingLLMResponseSchema = z.object({
    speech: z.string().describe("Concise spoken response (max 2 sentences)"),
    intent: BookingIntentSchema.describe("Classified booking intent"),
    confidence: z.number().min(0).max(1).describe("Confidence score"),
    extractedSlots: BookingSlotsSchema.optional().describe("Any new slot values extracted from this utterance"),
    extractedValue: z.union([z.string(), z.number(), z.null()]).optional().describe("Direct value extracted for the active slot"),
    nextSlotToAsk: z.string().nullable().optional().describe("Which slot to ask for next, or null if complete"),
    isComplete: z.boolean().optional().describe("True if all required booking slots are filled"),
});

export type BookingLLMResponse = z.infer<typeof BookingLLMResponseSchema>;
export type BookingSlotName = z.infer<typeof BookingSlotNameSchema>;
export type BookingSlotExpectedType = z.infer<typeof BookingSlotExpectedTypeSchema>;
export type BookingChatRequest = z.infer<typeof BookingChatRequestSchema>;

export const BOOKING_FALLBACK: BookingLLMResponse = {
    speech: "I didn't catch that. Could you tell me more about your booking?",
    intent: "UNKNOWN",
    confidence: 0.0,
    extractedSlots: {},
    nextSlotToAsk: null,
    isComplete: false,
};
