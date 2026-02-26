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
    adults: z.number().min(1).max(4).nullable().optional(),
    children: z.number().min(0).max(3).nullable().optional(),
    checkInDate: z.string().nullable().optional(),
    checkOutDate: z.string().nullable().optional(),
    guestName: z.string().nullable().optional(),
    nights: z.number().min(1).max(30).nullable().optional(),
    totalPrice: z.number().nullable().optional(),
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
    nextSlotToAsk: z.string().nullable().optional().describe("Which slot to ask for next, or null if complete"),
    isComplete: z.boolean().optional().describe("True if all required booking slots are filled"),
});

export type BookingLLMResponse = z.infer<typeof BookingLLMResponseSchema>;

export const BOOKING_FALLBACK: BookingLLMResponse = {
    speech: "I didn't catch that. Could you tell me more about your booking?",
    intent: "UNKNOWN",
    confidence: 0.0,
    extractedSlots: {},
    nextSlotToAsk: null,
    isComplete: false,
};
