const fs = require('fs');

const content = `1: import { Router, Request, Response } from "express";
2: import { z } from "zod";
3: import { llm } from "../llm/groqClient.js";
4: import {
5:     BookingChatRequestSchema,
6:     BookingLLMResponse,
7:     BookingLLMResponseSchema,
8:     BookingSlotExpectedType,
9:     BookingSlotName,
10:     BOOKING_FALLBACK
11: } from "../llm/bookingContracts.js";
12: import { buildBookingSlotContext, buildSystemContext } from "../context/contextBuilder.js";
13: import { HOTEL_CONFIG } from "../context/hotelData.js";
14: import { ROOM_INVENTORY } from "../context/roomInventory.js";
15: import { validateBody } from "../middleware/validateRequest.js";
16: import { logWithContext } from "../utils/logger.js";
17: import { sendApiError } from "../utils/http.js";
18: import { prisma } from "../db/prisma.js";
19: import { extractNormalizedNumber, normalizeForSlot } from "../utils/normalize.js";
20: 
21: const router = Router();
22: const ENABLE_STATIC_CONTEXT_FALLBACK = process.env.ENABLE_STATIC_CONTEXT_FALLBACK === "1";
23: 
24: /**
25:  * Booking Session Memory
26:  * 
27:  * Tracks per-session: conversation history + accumulated booking slots.
28:  * Memory is wiped when session resets.
29:  */
30: interface BookingSession {
31:     history: { role: "user" | "assistant"; content: string }[];
32:     slots: Record<string, any>;
33:     bookingId?: string;
34: }
35: 
36: const bookingSessions = new Map<string, BookingSession>();
37: const MAX_HISTORY_TURNS = 10; // 5 exchanges
38: const REQUIRED_SLOTS = ["roomType", "adults", "checkInDate", "checkOutDate", "guestName"];
39: const SLOT_FILLING_INTENTS = [
40:     "PROVIDE_GUESTS",
41:     "PROVIDE_DATES",
42:     "PROVIDE_NAME",
43:     "MODIFY_BOOKING",
44:     "CANCEL_BOOKING",
45:     "BACK_REQUESTED",
46: ];
47: const SLOT_TO_EXPECTED_INTENT: Partial<Record<BookingSlotName, BookingLLMResponse["intent"]>> = {
48:     roomType: "SELECT_ROOM",
49:     adults: "PROVIDE_GUESTS",
50:     children: "PROVIDE_GUESTS",
51:     checkInDate: "PROVIDE_DATES",
52:     checkOutDate: "PROVIDE_DATES",
53:     guestName: "PROVIDE_NAME",
54: };
55: 
56: const BOOKING_SYSTEM_PROMPT = \`
57: You are Siya, the AI Concierge at {{HOTEL_NAME}}.
58: You are currently helping a guest BOOK A ROOM through voice conversation.
59: 
60: --- CURRENT CONTEXT ---
61: {{CONTEXT_JSON}}
62: -----------------------
63: 
64: --- AVAILABLE ROOMS ---
65: {{ROOM_INVENTORY}}
66: -----------------------
67: 
68: --- CURRENT BOOKING STATE ---
69: {{BOOKING_SLOTS}}
70: Unfilled slots: {{MISSING_SLOTS}}
71: -----------------------------
72: 
73: {{ACTIVE_SLOT_CONTEXT}}
74: 
75: # YOUR TASK:
76: You are having a natural conversation to collect booking details.
77: You must extract information from the user's speech and fill these slots:
78:   - roomType (must match one of the room names or room codes listed in AVAILABLE ROOMS)
79:   - adults (number of adult guests, 1-4)
80:   - children (number of children, 0-3) — only ask if relevant
81:   - checkInDate (ISO date string, e.g., "2026-02-13")
82:   - checkOutDate (ISO date string)
83:   - guestName (name for the reservation)
84: 
85: # EXTRACTION RULES:
86: 1. Parse COMPOUND statements. "Book the ocean view deluxe for 2 nights starting tomorrow for me and my wife" = roomType:Ocean View Deluxe (or DELUXE_OCEAN), nights:2, checkInDate:tomorrow, adults:2
87: 2. Room type extraction must be grounded in AVAILABLE ROOMS. Prefer exact room code or room name from that list.
88: 3. Resolve relative dates. "Tomorrow" = next calendar day. "Next weekend" = nearest Saturday. "The 15th" = 15th of current/next month. Use today's date from context.
89: 4. Compute nights from check-in and check-out dates if both are given.
90: 5. Compute totalPrice = pricePerNight x nights if room and nights are known.
91: 6. Do NOT ask for children unless the user mentions them or it's the only slot left.
92: 7. When ALL required slots are filled, set isComplete:true and generate a summary in speech.
93: # CONVERSATION RULES:
94: 1. Ask for ONE slot at a time (unless user volunteers multiple).
95: 2. If user corrects a value ("Actually make that 3 adults"), update the slot.
96: 3. If user asks a question mid-booking ("What time is breakfast?"), answer it, then return to the next unfilled slot.
97: 4. If user says "go back" or "cancel", set intent to CANCEL_BOOKING.
98: 5. If user says "start over", set intent to CANCEL_BOOKING.
99: 6. Be warm, concise, and human. Max 2 sentences per response.
100: 7. When summarizing, read back ALL filled slots for confirmation.
101: 
102: # OUTPUT FORMAT (strict JSON):
103: {
104:   "speech": "Your spoken response (max 2 sentences)",
105:   "intent": "SELECT_ROOM|PROVIDE_GUESTS|PROVIDE_DATES|PROVIDE_NAME|CONFIRM_BOOKING|MODIFY_BOOKING|CANCEL_BOOKING|ASK_ROOM_DETAIL|COMPARE_ROOMS|ASK_PRICE|BACK_REQUESTED|GENERAL_QUERY|HELP|UNKNOWN",
106:   "confidence": 0.0-1.0,
107:   "extractedSlots": {
108:     "roomType": "Ocean View Deluxe" or "DELUXE_OCEAN" or null,
109:     "adults": 2 or null,
110:     "children": 0 or null,
111:     "checkInDate": "2026-02-13" or null,
112:     "checkOutDate": "2026-02-15" or null,
113:     "guestName": "John Smith" or null,
114:     "nights": 2 or null,
115:     "totalPrice": 9000 or null
116:   },
117:   "extractedValue": "5 or 2026-02-13 or John Smith",
118:   "nextSlotToAsk": "adults" or null,
119:   "isComplete": false
120: }
121: 
122: ONLY output JSON. No markdown, no explanation, no preamble.
123: \`;
124: 
125: function formatInventoryForPrompt(roomTypes: Array<{
126:     id: string;
127:     code: string;
128:     name: string;
129:     price: unknown;
130:     amenities: string[];
131: }>): string {
132:     if (!roomTypes || roomTypes.length === 0) {
133:         return "- No rooms are currently configured for this tenant.";
134:     }
135: 
136:     return roomTypes
137:         .map((room) => {
138:             const numericPrice = Number(room.price);
139:             return \`- \${room.name} (\${room.code}): $\${numericPrice}/night | Amenities: \${room.amenities.join(", ")}\`;
140:         })
141:         .join("\\n");
142: }
143: 
144: function normalizeRoomKey(value: string): string {
145:     return value.trim().toUpperCase().replace(/[\\s-]+/g, "_");
146: }
147: 
148: function resolveRoomType(
149:     roomTypes: Array<{ id: string; code: string; name: string }>,
150:     requestedRoomType: unknown
151: ): { id: string; code: string; name: string } | null {
152:     if (!requestedRoomType || typeof requestedRoomType !== "string") {
153:         return null;
154:     }
155: 
156:     const normalizedRequested = normalizeRoomKey(requestedRoomType);
157:     const exactCode = roomTypes.find((room) => normalizeRoomKey(room.code) === normalizedRequested);
158:     if (exactCode) return exactCode;
159: 
160:     const byName = roomTypes.find((room) => normalizeRoomKey(room.name).includes(normalizedRequested));
161:     if (byName) return byName;
162: 
163:     if (normalizedRequested === "DELUXE") {
164:         return roomTypes.find((room) => normalizeRoomKey(room.code).includes("DELUXE")) || null;
165:     }
166:     if (normalizedRequested === "STANDARD") {
167:         return roomTypes.find((room) => normalizeRoomKey(room.code).includes("STANDARD")) || null;
168:     }
169:     if (normalizedRequested === "PRESIDENTIAL") {
170:         return roomTypes.find((room) => normalizeRoomKey(room.code).includes("PRESIDENTIAL")) || null;
171:     }
172: 
173:     return null;
174: }
175: 
176: function parseIsoDate(value: unknown): Date | null {
177:     if (!value || typeof value !== "string") return null;
178:     const date = new Date(value);
179:     if (Number.isNaN(date.getTime())) return null;
180:     return new Date(date.toISOString().slice(0, 10));
181: }
182: 
183: function isUuid(value: string): boolean {
184:     return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
185: }
186: 
187: function hasOverlappingDates(existingStart: Date, existingEnd: Date, nextStart: Date, nextEnd: Date): boolean {
188:     return existingStart < nextEnd && nextStart < existingEnd;
189: }
190: 
191: function isFilledValue(value: unknown): boolean {
192:     return value !== null && value !== undefined && String(value).trim() !== "";
193: }
194: 
195: function mergeIncomingSlots(
196:     base: Record<string, unknown>,
197:     incoming?: Record<string, unknown>
198: ): Record<string, unknown> {
199:     if (!incoming) return base;
200:     const merged = { ...base };
201:     for (const [key, value] of Object.entries(incoming)) {
202:         if (isFilledValue(value)) {
203:             merged[key] = value;
204:         }
205:     }
206:     return merged;
207: }
208: 
209: function isExplicitTopicChange(transcript: string): boolean {
210:     const text = transcript.toLowerCase();
211:     return /\\b(cancel|go back|back|never mind|nevermind|start over|modify|change)\\b/.test(text);
212: }
213: 
214: function coerceSlotFillingIntent(
215:     result: BookingLLMResponse,
216:     activeSlot: BookingSlotName | null | undefined,
217:     transcript: string
218: ): BookingLLMResponse {
219:     if (!activeSlot) {
220:         return result;
221:     }
222: 
223:     if (SLOT_FILLING_INTENTS.includes(result.intent)) {
224:         return result;
225:     }
226: 
227:     if (isExplicitTopicChange(transcript)) {
228:         return result;
229:     }
230: 
231:     const expectedIntent = SLOT_TO_EXPECTED_INTENT[activeSlot];
232:     if (!expectedIntent) {
233:         return result;
234:     }
235: 
236:     return {
237:         ...result,
238:         intent: expectedIntent,
239:         confidence: Math.max(result.confidence, 0.8),
240:     };
241: }
242: 
243: function applyActiveSlotExtractionFallback(
244:     result: BookingLLMResponse,
245:     activeSlot: BookingSlotName | null | undefined,
246:     expectedType: BookingSlotExpectedType | null | undefined,
247:     transcript: string
248: ): BookingLLMResponse {
249:     if (!activeSlot) {
250:         return result;
251:     }
252: 
253:     const extractedSlots = { ...(result.extractedSlots || {}) } as Record<string, unknown>;
254:     if (isFilledValue(extractedSlots[activeSlot])) {
255:         return { ...result, extractedSlots, extractedValue: extractedSlots[activeSlot] as string | number | null };
256:     }
257: 
258:     if (expectedType === "number") {
259:         const parsed = extractNormalizedNumber(transcript, activeSlot);
260:         if (parsed !== null) {
261:             extractedSlots[activeSlot] = parsed;
262:             return { ...result, extractedSlots, extractedValue: parsed };
263:         }
264:     }
265: 
266:     if (expectedType === "string") {
267:         const value = transcript.trim();
268:         if (value) {
269:             extractedSlots[activeSlot] = value;
270:             return { ...result, extractedSlots, extractedValue: value };
271:         }
272:     }
273: 
274:     if (expectedType === "date") {
275:         const isoMatch = transcript.match(/\\d{4}-\\d{2}-\\d{2}/);
276:         if (isoMatch) {
277:             extractedSlots[activeSlot] = isoMatch[0];
278:             return { ...result, extractedSlots, extractedValue: isoMatch[0] };
279:         }
280:     }
281: 
282:     return result;
283: }
284: 
285: router.post("/", validateBody(BookingChatRequestSchema), async (req: Request, res: Response) => {
286:     const start = Date.now();
287:     try {
288:         const {
289:             transcript,
290:             currentState,
291:             sessionId,
292:             activeSlot,
293:             expectedType,
294:             lastSystemPrompt,
295:             filledSlots,
296:             conversationHistory,
297:         } = req.body as z.infer<typeof BookingChatRequestSchema>;
298:         const sid = sessionId || "default";
299: 
300:         logWithContext(req, "INFO", "Booking chat request received", {
301:             currentState,
302:             sessionId: sid,
303:             activeSlot: activeSlot || null,
304:             expectedType: expectedType || null,
305:         });
306: 
307:         // Privacy wipe on WELCOME/IDLE
308:         if (currentState === "WELCOME" || currentState === "IDLE") {
309:             if (bookingSessions.has(sid)) {
310:                 logWithContext(req, "INFO", "Privacy wipe: cleared booking chat memory", { sessionId: sid });
311:                 bookingSessions.delete(sid);
312:             }
313:         }
314: 
315:         // Empty transcript
316:         if (!transcript || transcript.trim().length === 0) {
317:             res.json({ ...BOOKING_FALLBACK, speech: "", intent: "UNKNOWN", confidence: 1.0 });
318:             return;
319:         }
320: 
321:         const normalizedTranscript = normalizeForSlot(transcript, expectedType, activeSlot);
322:         if (normalizedTranscript !== transcript) {
323:             logWithContext(req, "INFO", "Normalized transcript for active slot", {
324:                 before: transcript,
325:                 after: normalizedTranscript,
326:                 activeSlot: activeSlot || null,
327:                 expectedType: expectedType || null,
328:             });
329:         }
330: 
331:         // Get or create session
332:         let session: BookingSession = bookingSessions.get(sid) || { history: [], slots: {} };
333:         session.slots = mergeIncomingSlots(session.slots, filledSlots);
334: 
335:         if (Array.isArray(conversationHistory) && conversationHistory.length > 0 && session.history.length === 0) {
336:             session.history = conversationHistory.slice(-MAX_HISTORY_TURNS).map((turn) => ({
337:                 role: turn.role,
338:                 content: turn.content,
339:             }));
340:         }
341:         const tenant = req.tenant;
342:         if (!tenant) {
343:             sendApiError(res, 404, "TENANT_NOT_FOUND", "Tenant not found", req.requestId);
344:             return;
345:         }
346: 
347:         let roomTypes: Array<{
348:             id: string;
349:             code: string;
350:             name: string;
351:             price: unknown;
352:             amenities: string[];
353:         }> = [];
354:         try {
355:             roomTypes = await prisma.roomType.findMany({
356:                 where: { tenantId: tenant.id },
357:                 select: {
358:                     id: true,
359:                     code: true,
360:                     name: true,
361:                     price: true,
362:                     amenities: true,
363:                 },
364:                 orderBy: { price: "asc" },
365:             });
366:         } catch (error) {
367:             if (!ENABLE_STATIC_CONTEXT_FALLBACK) {
368:                 throw error;
369:             }
370:             roomTypes = ROOM_INVENTORY.map((room) => ({
371:                 id: room.type,
372:                 code: room.type,
373:                 name: room.name,
374:                 price: room.pricePerNight,
375:                 amenities: room.amenities,
376:             }));
377:             logWithContext(req, "WARN", "Using static room inventory fallback", {
378:                 reason: error instanceof Error ? error.message : String(error),
379:             });
380:         }
381: 
382:         if (roomTypes.length === 0 && ENABLE_STATIC_CONTEXT_FALLBACK) {
383:             roomTypes = ROOM_INVENTORY.map((room) => ({
384:                 id: room.type,
385:                 code: room.type,
386:                 name: room.name,
387:                 price: room.pricePerNight,
388:                 amenities: room.amenities,
389:             }));
390:             logWithContext(req, "WARN", "Using static room inventory fallback because tenant has no room types");
391:         }
392: 
393:         // Build history messages for LLM call
394:         const recentHistory = session.history.slice(-MAX_HISTORY_TURNS);
395: 
396:         // Build context
397:         const hotelConfig = tenant.hotelConfig;
398:         const fallbackConfig = ENABLE_STATIC_CONTEXT_FALLBACK ? HOTEL_CONFIG : null;
399:         const contextJson = buildSystemContext(
400:             { currentState: currentState || "BOOKING", transcript: normalizedTranscript },
401:             {
402:                 hotelName: tenant.name,
403:                 timezone: hotelConfig?.timezone ?? fallbackConfig?.timezone,
404:                 checkIn: hotelConfig?.checkInTime ?? fallbackConfig?.checkInStart,
405:                 checkOut: fallbackConfig?.checkOutEnd ?? "11:00",
406:                 amenities: fallbackConfig?.amenities ?? [],
407:                 location: fallbackConfig?.location ?? "Lobby Kiosk",
408:             }
409:         );
410: 
411:         // Format current slots for prompt
412:         const slotsDisplay = Object.keys(session.slots).length > 0
413:             ? JSON.stringify(session.slots, null, 2)
414:             : "{ (no slots filled yet) }";
415: 
416:         const missingSlots = REQUIRED_SLOTS.filter((slot) => !isFilledValue(session.slots[slot]));
417:         const slotContextSection = buildBookingSlotContext({
418:             activeSlot,
419:             expectedType,
420:             lastSystemPrompt,
421:             filledSlots: session.slots,
422:             missingSlots,
423:             constrainedIntents: activeSlot ? SLOT_FILLING_INTENTS : undefined,
424:         });
425: 
426:         // Build prompt
427:         const filledPrompt = BOOKING_SYSTEM_PROMPT
428:             .replace("{{HOTEL_NAME}}", tenant.name)
429:             .replace("{{CONTEXT_JSON}}", contextJson)
430:             .replace("{{ROOM_INVENTORY}}", formatInventoryForPrompt(roomTypes))
431:             .replace("{{BOOKING_SLOTS}}", slotsDisplay)
432:             .replace("{{MISSING_SLOTS}}", missingSlots.length > 0 ? missingSlots.join(", ") : "(all filled!)")
433:             .replace("{{ACTIVE_SLOT_CONTEXT}}", slotContextSection);
434: 
435:         const llmMessages: Array<{ role: "system" | "assistant" | "user"; content: string }> = [
436:             { role: "system", content: filledPrompt },
437:             ...recentHistory.map((entry) => ({
438:                 role: entry.role,
439:                 content: entry.content,
440:             })),
441:             { role: "user", content: normalizedTranscript },
442:         ];
443: 
444:         // Call LLM
445:         logWithContext(req, "INFO", "Booking LLM messages prepared", {
446:             sessionId: sid,
447:             messageCount: llmMessages.length,
448:             includesHistory: recentHistory.length > 0,
449:             activeSlot: activeSlot || null,
450:         });
451:         const response = await llm.invoke(llmMessages);
452: 
453:         // Extract JSON
454:         const rawContent = response.content.toString();
455:         const jsonMatch = rawContent.match(/\\{[\\s\\S]*\\}/);
456: 
457:         if (!jsonMatch) {
458:             logWithContext(req, "WARN", "Booking LLM failed to output JSON", { rawContent });
459:             throw new Error("Malformed LLM Output");
460:         }
461: 
462:         const parsedJson = JSON.parse(jsonMatch[0]);
463:         let validated = BookingLLMResponseSchema.parse(parsedJson);
464: 
465:         validated = applyActiveSlotExtractionFallback(
466:             validated,
467:             activeSlot,
468:             expectedType,
469:             normalizedTranscript
470:         );
471: 
472:         validated = coerceSlotFillingIntent(
473:             validated,
474:             activeSlot,
475:             normalizedTranscript
476:         );
477: 
478:         // Merge extracted slots into session
479:         if (validated.extractedSlots) {
480:             for (const [key, value] of Object.entries(validated.extractedSlots)) {
481:                 if (value !== null && value !== undefined) {
482:                     session.slots[key] = value;
483:                 }
484:             }
485:         }
486: 
487:         const shouldPersistBooking = validated.isComplete === true || validated.intent === "CONFIRM_BOOKING";
488:         let persistedBookingId: string | null = session.bookingId || null;
489:         if (shouldPersistBooking) {
490:             const room = resolveRoomType(roomTypes, session.slots.roomType);
491:             const checkInDate = parseIsoDate(session.slots.checkInDate);
492:             const checkOutDate = parseIsoDate(session.slots.checkOutDate);
493:             const adults = Number(session.slots.adults);
494:             const children = session.slots.children === undefined ? null : Number(session.slots.children);
495:             const nights =
496:                 session.slots.nights !== undefined
497:                     ? Number(session.slots.nights)
498:                     : checkInDate && checkOutDate
499:                         ? Math.max(
500:                             1,
501:                             Math.ceil((checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24))
502:                         )
503:                         : NaN;
504: 
505:             const primaryRoomPrice = room
506:                 ? Number(roomTypes.find((r) => r.id === room.id)?.price ?? 0)
507:                 : 0;
508:             const totalPrice =
509:                 session.slots.totalPrice !== undefined
510:                     ? Number(session.slots.totalPrice)
511:                     : Number.isFinite(nights)
512:                         ? primaryRoomPrice * Number(nights)
513:                         : NaN;
514: 
515:             if (room && isUuid(room.id) && checkInDate && checkOutDate && Number.isFinite(adults) && Number.isFinite(nights) && session.slots.guestName) {
516:                 const idempotencyKey = \`\${tenant.id}:\${sid}:\${room.id}:\${checkInDate.toISOString().slice(0, 10)}:\${checkOutDate.toISOString().slice(0, 10)}:\${String(session.slots.guestName).trim().toLowerCase()}\`;
517:                 const status = validated.intent === "CONFIRM_BOOKING" ? "CONFIRMED" : "DRAFT";
518: 
519:                 const persisted = await prisma.$transaction(async (tx) => {
520:                     const conflictingConfirmed = await tx.booking.findMany({
521:                         where: {
522:                             tenantId: tenant.id,
523:                             roomTypeId: room.id,
524:                             status: "CONFIRMED",
525:                             NOT: session.bookingId ? { id: session.bookingId } : undefined,
526:                         },
527:                         select: {
528:                             id: true,
529:                             checkInDate: true,
530:                             checkOutDate: true,
531:                         },
532:                     });
533: 
534:                     const hasConflict = conflictingConfirmed.some((item) =>
535:                         hasOverlappingDates(item.checkInDate, item.checkOutDate, checkInDate, checkOutDate)
536:                     );
537:                     if (hasConflict) {
538:                         throw new Error("BOOKING_DATE_CONFLICT");
539:                     }
540: 
541:                     if (session.bookingId) {
542:                         const existingOwnedBooking = await tx.booking.findFirst({
543:                             where: {
544:                                 id: session.bookingId,
545:                                 tenantId: tenant.id,
546:                             },
547:                             select: { id: true },
548:                         });
549: 
550:                         if (!existingOwnedBooking) {
551:                             throw new Error("BOOKING_NOT_FOUND_FOR_TENANT");
552:                         }
553: 
554:                         const updated = await tx.booking.update({
555:                             where: { id: session.bookingId },
556:                             data: {
557:                                 guestName: String(session.slots.guestName),
558:                                 roomTypeId: room.id,
559:                                 checkInDate,
560:                                 checkOutDate,
561:                                 adults,
562:                                 children: children !== null && Number.isFinite(children) ? children : null,
563:                                 nights: Number(nights),
564:                                 totalPrice: Number.isFinite(totalPrice) ? totalPrice : null,
565:                                 sessionId: sid,
566:                                 idempotencyKey,
567:                                 status,
568:                             },
569:                             select: { id: true },
570:                         });
571:                         return updated.id;
572:                     }
573: 
574:                     const existing = await tx.booking.findFirst({
575:                         where: {
576:                             tenantId: tenant.id,
577:                             idempotencyKey,
578:                         },
579:                         select: { id: true },
580:                     });
581: 
582:                     if (existing) {
583:                         return existing.id;
584:                     }
585: 
586:                     const created = await tx.booking.create({
587:                         data: {
588:                             tenantId: tenant.id,
589:                             guestName: String(session.slots.guestName),
590:                             roomTypeId: room.id,
591:                             checkInDate,
592:                             checkOutDate,
593:                             adults,
594:                             children: children !== null && Number.isFinite(children) ? children : null,
595:                             nights: Number(nights),
596:                             totalPrice: Number.isFinite(totalPrice) ? totalPrice : null,
597:                             sessionId: sid,
598:                             idempotencyKey,
599:                             status,
600:                         },
601:                         select: { id: true },
602:                     });
603:                     return created.id;
604:                 });
605: 
606:                 persistedBookingId = persisted;
607:                 session.bookingId = persisted;
608:             } else {
609:                 logWithContext(req, "WARN", "Booking marked complete but required persistence fields are invalid", {
610:                     roomType: session.slots.roomType,
611:                     checkInDate: session.slots.checkInDate,
612:                     checkOutDate: session.slots.checkOutDate,
613:                     adults: session.slots.adults,
614:                     guestName: session.slots.guestName,
615:                 });
616:             }
617:         }
618: 
619:         // Update history
620:         session.history.push({ role: "user", content: transcript });
621:         if (validated.speech) {
622:             session.history.push({ role: "assistant", content: validated.speech });
623:         }
624: 
625:         // Save session
626:         bookingSessions.set(sid, session);
627: 
628:         // Return response with accumulated slots
629:         const finalResponse = {
630:             ...validated,
631:             accumulatedSlots: session.slots,
632:             missingSlots: REQUIRED_SLOTS.filter(s => !session.slots[s]),
633:             persistedBookingId,
634:         };
635: 
636:         logWithContext(req, "INFO", "Booking chat response validated", {
637:             intent: finalResponse.intent,
638:             confidence: finalResponse.confidence,
639:             elapsedMs: Date.now() - start,
640:             missingSlots: finalResponse.missingSlots,
641:         });
642:         res.json(finalResponse);
643: 
644:     } catch (error) {
645:         if (error instanceof Error && error.message === "BOOKING_DATE_CONFLICT") {
646:             sendApiError(
647:                 res,
648:                 409,
649:                 "BOOKING_DATE_CONFLICT",
650:                 "Selected room is already booked for the requested dates",
651:                 req.requestId
652:             );
653:             return;
654:         }
655:         logWithContext(req, "ERROR", "Booking chat request failed", {
656:             error: error instanceof Error ? error.message : String(error),
657:         });
658:         sendApiError(
659:             res,
660:             500,
661:             "BOOKING_CHAT_INTERNAL_ERROR",
662:             BOOKING_FALLBACK.speech || "Booking chat request failed",
663:             req.requestId
664:         );
665:     }
666: });
667: 
668: export default router;
669: \`;

fs.writeFileSync('backend/src/routes/bookingChat.ts', content.replace(/^\\d+: /gm, ''));
console.log('Restored');
