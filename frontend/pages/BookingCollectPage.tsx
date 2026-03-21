import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUIState } from "../state/uiContext";
import { useBrain } from "../hooks/useBrain";
import { motion, AnimatePresence } from "framer-motion";
import { CalendarDays } from "lucide-react";
import AnimatedGradientBackground from "../components/ui/animated-gradient-background";
import { ImagesScrollingAnimation } from "../components/ui/images-scrolling-animation";

const SLOT_LABELS: Record<string, string> = {
    roomType: "Room",
    adults: "Adults",
    children: "Children",
    checkInDate: "Check-in",
    checkOutDate: "Check-out",
    guestName: "Guest Name",
    nights: "Nights",
    totalPrice: "Total",
};

const REQUIRED_SLOTS = ["roomType", "adults", "checkInDate", "checkOutDate", "guestName"];

type ManualBookingForm = {
    roomId: string;
    roomType: string;
    adults: string;
    children: string;
    guestName: string;
    checkInDate: string;
    checkOutDate: string;
};

function hasValue(value: unknown): boolean {
    return value !== null && value !== undefined && String(value).trim() !== "";
}

function toDateInputValue(value: unknown): string {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
        return `${match[1]}-${match[2]}-${match[3]}`;
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
        return "";
    }

    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, "0");
    const day = String(parsed.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function getTodayDateValue(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function parseCount(value: string): number | null {
    const trimmed = String(value || "").trim();
    if (!trimmed) return null;
    if (!/^\d+$/.test(trimmed)) return null;
    return Number(trimmed);
}

function validateBookingConstraints(input: {
    room: any;
    roomName: string;
    adults: number | null;
    children: number | null;
    checkInDate: string;
    checkOutDate: string;
    guestName: string;
}): string | null {
    const { room, roomName, adults, children, checkInDate, checkOutDate, guestName } = input;
    const today = getTodayDateValue();

    if (!roomName) {
        return "Select a room before continuing.";
    }

    if (adults === null || adults <= 0) {
        return "Adults must be a positive number.";
    }

    if (children !== null && children < 0) {
        return "Children cannot be negative.";
    }

    if (!guestName.trim()) {
        return "Guest name is required before continuing.";
    }

    if (!checkInDate) {
        return "Check-in date is required.";
    }

    if (checkInDate < today) {
        return "Check-in date cannot be in the past.";
    }

    if (!checkOutDate) {
        return "Check-out date is required.";
    }

    if (checkOutDate <= checkInDate) {
        return "Check-out date must be after check-in date.";
    }

    const maxAdults = typeof room?.maxAdults === "number" ? room.maxAdults : null;
    const maxChildren = typeof room?.maxChildren === "number" ? room.maxChildren : null;
    const maxTotalGuests = typeof room?.maxTotalGuests === "number" ? room.maxTotalGuests : null;
    const childCount = children ?? 0;

    if (maxAdults !== null && adults > maxAdults) {
        return `This room allows up to ${maxAdults} adult${maxAdults === 1 ? "" : "s"}.`;
    }

    if (maxChildren !== null && childCount > maxChildren) {
        return `This room allows up to ${maxChildren} child${maxChildren === 1 ? "" : "ren"}.`;
    }

    if (maxTotalGuests !== null && adults + childCount > maxTotalGuests) {
        return `This room allows up to ${maxTotalGuests} guest${maxTotalGuests === 1 ? "" : "s"} in total.`;
    }

    return null;
}

function formatSlotValue(key: string, value: unknown, selectedRoomLabel: string | null): string {
    if (!hasValue(value)) {
        return "-";
    }

    if (key === "roomType" && selectedRoomLabel) {
        return selectedRoomLabel;
    }

    if (key === "totalPrice") {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? `INR ${numeric.toLocaleString()}` : String(value);
    }

    return String(value);
}

function toImageList(room: any, fallbackLabel: string | null) {
    const rawUrls = Array.isArray(room?.imageUrls) && room.imageUrls.length > 0
        ? room.imageUrls
        : [room?.image];

    const urls = rawUrls
        .map((value: unknown) => String(value || "").trim())
        .filter(Boolean);

    const uniqueUrls = Array.from(new Set(urls));
    const baseTitle = String(room?.displayName || room?.name || fallbackLabel || "Hotel").trim() || "Hotel";
    const features = Array.isArray(room?.features) ? room.features.filter(Boolean) : [];
    const featureSummary = features.slice(0, 3).join(" • ");

    return uniqueUrls.map((src, index) => ({
        id: `${String(room?.id || baseTitle)}-${index}`,
        title: index === 0 ? baseTitle : `${baseTitle} ${index + 1}`,
        description: featureSummary || `Preview ${index + 1} of ${baseTitle}`,
        src,
    }));
}

function humanizeImageMeta(value: unknown): string {
    const raw = String(value || "").trim();
    if (!raw) return "";

    return raw
        .split(/[-_]+/)
        .filter(Boolean)
        .map((part, index) => {
            const lowered = part.toLowerCase();
            if (index === 0) {
                return lowered.charAt(0).toUpperCase() + lowered.slice(1);
            }
            return lowered;
        })
        .join(" ");
}

function buildImageDescription(image: any): string | undefined {
    const tags = Array.isArray(image?.tags)
        ? image.tags.map((tag: unknown) => humanizeImageMeta(tag)).filter(Boolean)
        : [];

    if (tags.length > 0) {
        return tags.slice(0, 5).join(" | ");
    }

    const caption = String(image?.caption || "").trim();
    if (caption) {
        return caption;
    }

    const category = humanizeImageMeta(image?.category);
    return category || undefined;
}

function buildRoomImageItems(room: any, fallbackLabel: string | null) {
    const baseTitle = String(room?.displayName || room?.name || fallbackLabel || "Hotel").trim() || "Hotel";
    const imageRecords = Array.isArray(room?.images) ? room.images : [];

    if (imageRecords.length === 0) {
        return toImageList(room, fallbackLabel);
    }

    return imageRecords
        .map((image: any, index: number) => {
            const src = String(image?.url || "").trim();
            if (!src) return null;
            const categoryTitle = humanizeImageMeta(image?.category);
            const captionTitle = String(image?.caption || "").trim();

            return {
                id: String(image?.id || `${String(room?.id || baseTitle)}-${index}`),
                title: categoryTitle || captionTitle || (index === 0 ? baseTitle : `${baseTitle} ${index + 1}`),
                description: buildImageDescription(image),
                src,
            };
        })
        .filter(Boolean);
}

export const BookingCollectPage: React.FC = () => {
    const { emit, data } = useUIState();
    const { conversationHistory, bookingSlots, isProcessing } = useBrain();
    const effectiveBookingSlots = data?.bookingSlots || bookingSlots || {};
    const availableRooms = Array.isArray(data?.rooms) ? data.rooms : [];
    const selectedRoomLabel = String(
        data?.selectedRoom?.displayName ||
        data?.selectedRoom?.name ||
        effectiveBookingSlots.roomType ||
        ""
    ).trim() || null;
    const nextSlotHintKey = String(data?.nextSlotToAsk || "").trim();
    const nextSlotHintLabel = nextSlotHintKey ? SLOT_LABELS[nextSlotHintKey] || nextSlotHintKey : null;
    const roomOptionsFingerprint = availableRooms
        .map((room: any) => `${String(room?.id || "")}:${String(room?.name || "")}`)
        .join("|");
    const chatEndRef = useRef<HTMLDivElement>(null);
    const manualEditorRef = useRef<HTMLDivElement>(null);
    const checkInInputRef = useRef<HTMLInputElement>(null);
    const checkOutInputRef = useRef<HTMLInputElement>(null);
    const todayDateValue = getTodayDateValue();

    const buildManualForm = (): ManualBookingForm => {
        const matchedRoom = availableRooms.find((room: any) => room?.id === data?.selectedRoom?.id)
            || availableRooms.find((room: any) => String(room?.name || "").trim() === selectedRoomLabel)
            || null;

        return {
            roomId: matchedRoom?.id || "",
            roomType: matchedRoom?.name || selectedRoomLabel || String(effectiveBookingSlots.roomType || "").trim(),
            adults: hasValue(effectiveBookingSlots.adults) ? String(effectiveBookingSlots.adults) : "",
            children: hasValue(effectiveBookingSlots.children) ? String(effectiveBookingSlots.children) : "",
            guestName: String(effectiveBookingSlots.guestName || "").trim(),
            checkInDate: toDateInputValue(effectiveBookingSlots.checkInDate),
            checkOutDate: toDateInputValue(effectiveBookingSlots.checkOutDate),
        };
    };

    const previousSlotsRef = useRef<Record<string, any>>({});
    const [recentlyChanged, setRecentlyChanged] = useState<Set<string>>(new Set());
    const [isEditing, setIsEditing] = useState(false);
    const [manualError, setManualError] = useState<string | null>(null);
    const [manualStatus, setManualStatus] = useState<string | null>(null);
    const [manualForm, setManualForm] = useState<ManualBookingForm>(buildManualForm);

    const focusFirstEmptyManualField = useCallback(() => {
        const container = manualEditorRef.current;
        if (!container) return;

        const firstEmptyField = container.querySelector<HTMLElement>('[data-empty="true"], [data-slot-empty="true"]');
        const firstField = container.querySelector<HTMLElement>("input, select");
        const target = firstEmptyField || firstField;
        if (!target) return;

        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.focus();
    }, []);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [conversationHistory]);

    useEffect(() => {
        const changed = new Set<string>();
        const previousSlots = previousSlotsRef.current;
        for (const key of Object.keys(effectiveBookingSlots)) {
            if (
                hasValue(effectiveBookingSlots[key]) &&
                hasValue(previousSlots[key]) &&
                previousSlots[key] !== effectiveBookingSlots[key]
            ) {
                changed.add(key);
            }
        }

        if (changed.size > 0) {
            setRecentlyChanged(changed);
            const timer = window.setTimeout(() => setRecentlyChanged(new Set()), 2000);
            previousSlotsRef.current = { ...effectiveBookingSlots };
            return () => window.clearTimeout(timer);
        }

        previousSlotsRef.current = { ...effectiveBookingSlots };
        return undefined;
    }, [effectiveBookingSlots]);

    useEffect(() => {
        if (!isEditing) {
            setManualForm(buildManualForm());
        }
    }, [
        isEditing,
        data?.selectedRoom?.id,
        selectedRoomLabel,
        effectiveBookingSlots.roomType,
        effectiveBookingSlots.adults,
        effectiveBookingSlots.children,
        effectiveBookingSlots.guestName,
        effectiveBookingSlots.checkInDate,
        effectiveBookingSlots.checkOutDate,
        roomOptionsFingerprint,
    ]);

    useEffect(() => {
        const handleFallback = (event: Event) => {
            const detail = (event as CustomEvent).detail;
            if (detail?.screen !== "BOOKING_COLLECT" && detail?.screen !== "BOOKING_SUMMARY") return;
            setManualError(null);
            setManualStatus("Voice timed out. Continue by tapping the form below.");
            setManualForm(buildManualForm());
            setIsEditing(true);
            window.setTimeout(() => {
                focusFirstEmptyManualField();
            }, 50);
        };

        window.addEventListener("voice-fallback-to-touch", handleFallback);
        return () => window.removeEventListener("voice-fallback-to-touch", handleFallback);
    }, [focusFirstEmptyManualField]);

    const filledCount = REQUIRED_SLOTS.filter((slot) => hasValue(effectiveBookingSlots[slot])).length;
    const progress = (filledCount / REQUIRED_SLOTS.length) * 100;
    const selectedRoomDetails = availableRooms.find((room: any) => room?.id === data?.selectedRoom?.id)
        || availableRooms.find((room: any) => String(room?.name || "").trim() === selectedRoomLabel)
        || data?.selectedRoom
        || null;
    const readinessError = validateBookingConstraints({
        room: selectedRoomDetails,
        roomName: String(effectiveBookingSlots.roomType || selectedRoomLabel || "").trim(),
        adults: hasValue(effectiveBookingSlots.adults) ? Number(effectiveBookingSlots.adults) : null,
        children: hasValue(effectiveBookingSlots.children) ? Number(effectiveBookingSlots.children) : null,
        checkInDate: toDateInputValue(effectiveBookingSlots.checkInDate),
        checkOutDate: toDateInputValue(effectiveBookingSlots.checkOutDate),
        guestName: String(effectiveBookingSlots.guestName || "").trim(),
    });
    const canContinueToSummary = !isEditing && !readinessError && filledCount === REQUIRED_SLOTS.length;
    const hotelImageItems = useMemo(
        () => buildRoomImageItems(selectedRoomDetails, selectedRoomLabel),
        [selectedRoomDetails, selectedRoomLabel],
    );
    const focusedImageId = String(data?.visualFocus?.imageId || "").trim() || null;

    const handleManualFieldChange = (field: keyof ManualBookingForm, value: string) => {
        setManualError(null);
        setManualStatus(null);
        setManualForm((current) => {
            if (field === "roomId") {
                const selectedRoom = availableRooms.find((room: any) => room?.id === value) || null;
                return {
                    ...current,
                    roomId: value,
                    roomType: selectedRoom ? String(selectedRoom.name || "").trim() : current.roomType,
                };
            }

            return {
                ...current,
                [field]: value,
            };
        });
    };

    const handleStartEditing = () => {
        setManualError(null);
        setManualStatus(null);
        setManualForm(buildManualForm());
        setIsEditing(true);
        emit("BOOKING_FIELDS_EDIT_STARTED");
    };

    const handleCancelEditing = () => {
        setManualError(null);
        setManualForm(buildManualForm());
        setIsEditing(false);
        emit("BOOKING_FIELDS_EDIT_CANCELLED");
    };

    const handleManualSave = () => {
        const matchedRoom = manualForm.roomId
            ? availableRooms.find((room: any) => room?.id === manualForm.roomId) || null
            : availableRooms.find((room: any) => String(room?.name || "").trim().toLowerCase() === manualForm.roomType.trim().toLowerCase()) || null;
        const resolvedRoomName = String(matchedRoom?.name || manualForm.roomType || "").trim();
        const adultsCount = parseCount(manualForm.adults);
        const childrenCount = parseCount(manualForm.children);
        const guestName = manualForm.guestName.trim();
        const selectedRoom = matchedRoom
            ? {
                ...matchedRoom,
                name: resolvedRoomName,
                displayName: resolvedRoomName,
                roomType: resolvedRoomName,
            }
            : {
                ...(data?.selectedRoom || {}),
                name: resolvedRoomName,
                displayName: resolvedRoomName,
                roomType: resolvedRoomName,
            };
        const validationError = validateBookingConstraints({
            room: selectedRoom,
            roomName: resolvedRoomName,
            adults: adultsCount,
            children: childrenCount,
            checkInDate: manualForm.checkInDate,
            checkOutDate: manualForm.checkOutDate,
            guestName,
        });

        if (validationError) {
            setManualError(validationError);
            return;
        }

        const nextSlots = {
            ...effectiveBookingSlots,
            roomType: resolvedRoomName,
            adults: adultsCount,
            children: childrenCount,
            guestName: guestName || null,
            checkInDate: manualForm.checkInDate || null,
            checkOutDate: manualForm.checkOutDate || null,
        };

        emit("BOOKING_FIELDS_UPDATED", {
            slots: nextSlots,
            selectedRoom,
            error: null,
            manualOverride: true,
        });

        setManualError(null);
        setManualStatus("Manual changes applied. Review the booking and continue when ready.");
        setIsEditing(false);
    };

    const handleContinueToReview = () => {
        if (!canContinueToSummary) {
            setManualError(readinessError || "Complete the required booking details before continuing.");
            return;
        }

        emit("CONFIRM_BOOKING");
    };

    const openDatePicker = (field: "checkInDate" | "checkOutDate") => {
        const input = field === "checkInDate" ? checkInInputRef.current : checkOutInputRef.current;
        if (!input) return;
        if (typeof input.showPicker === "function") {
            input.showPicker();
            return;
        }
        input.focus();
    };

    const inputClassName = "mt-1 w-full rounded-xl border border-slate-600/70 bg-slate-950/50 px-3 py-2 text-sm text-white outline-none transition focus:border-blue-400";

    return (
        <div className="relative min-h-screen w-full text-white overflow-x-hidden">
            <AnimatedGradientBackground Breathing={true} />
            <div className="relative z-10 flex h-full min-h-screen w-full flex-col lg:flex-row">
                <div className="flex w-full lg:w-[60%] flex-col p-6 md:p-8">
                    <div className="mb-6">
                        <h1 className="text-2xl md:text-3xl font-light text-white/90">Booking Your Stay</h1>
                        <p className="mt-1 text-xs md:text-sm text-white/50">Speak naturally. The kiosk will keep the details in sync.</p>
                        <p className="mt-2 text-[10px] md:text-xs text-white/30">Single-room booking only.</p>
                        {nextSlotHintLabel && (
                            <p className="mt-2 text-xs text-blue-200/80">Next detail: {nextSlotHintLabel}</p>
                        )}
                    </div>

                    <div className="relative min-h-[300px] md:min-h-0 flex-1 pr-0 md:pr-4">
                        <ImagesScrollingAnimation
                            items={hotelImageItems}
                            className="absolute inset-0"
                            focusItemId={focusedImageId}
                            emptyState={
                                <div className="px-6 text-center">
                                    <p className="text-sm text-white/55">
                                        Hotel images will appear here after a room with uploaded media is selected.
                                    </p>
                                </div>
                            }
                        />

                        <div className="absolute inset-x-0 bottom-0 max-h-[36%] overflow-y-auto rounded-t-[28px] bg-gradient-to-t from-slate-950/88 via-slate-950/72 to-transparent px-4 pb-4 pt-16">
                            <div className="space-y-4">
                                <AnimatePresence>
                                    {conversationHistory.map((msg, index) => (
                                        <motion.div
                                            key={index}
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ duration: 0.3 }}
                                            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                                        >
                                            <div
                                                className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-lg shadow-black/15 ${msg.role === "user"
                                                    ? "rounded-br-sm bg-blue-600/80 text-white"
                                                    : "rounded-bl-sm bg-slate-700/80 text-white/90"
                                                    }`}
                                            >
                                                {msg.role === "assistant" && (
                                                    <span className="mb-1 block text-xs text-blue-300">Siya</span>
                                                )}
                                                {msg.text}
                                            </div>
                                        </motion.div>
                                    ))}
                                </AnimatePresence>

                                {isProcessing && (
                                    <motion.div
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        className="flex justify-start"
                                    >
                                        <div className="rounded-2xl rounded-bl-sm bg-slate-700/80 px-4 py-3">
                                            <div className="flex space-x-1">
                                                <div className="h-2 w-2 animate-bounce rounded-full bg-blue-400" style={{ animationDelay: "0ms" }} />
                                                <div className="h-2 w-2 animate-bounce rounded-full bg-blue-400" style={{ animationDelay: "150ms" }} />
                                                <div className="h-2 w-2 animate-bounce rounded-full bg-blue-400" style={{ animationDelay: "300ms" }} />
                                            </div>
                                        </div>
                                    </motion.div>
                                )}

                                <div ref={chatEndRef} />
                            </div>
                        </div>
                    </div>

                    <div className="mt-4 text-center text-xs text-white/30">
                        Speak to continue your booking
                    </div>
                </div>

                <div className="flex w-full lg:w-[40%] flex-col border-t lg:border-t-0 lg:border-l border-slate-700/50 bg-slate-800/50 p-6 md:p-8">
                    <div className="mb-6">
                        <div className="mb-2 flex justify-between text-xs text-white/50">
                            <span>Booking Progress</span>
                            <span>{filledCount}/{REQUIRED_SLOTS.length} details</span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-700">
                            <motion.div
                                className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400"
                                initial={{ width: 0 }}
                                animate={{ width: `${progress}%` }}
                                transition={{ duration: 0.5, ease: "easeOut" }}
                            />
                        </div>
                    </div>

                    <div className="flex-1 space-y-3 overflow-y-auto pr-1">
                        {Object.entries(SLOT_LABELS).map(([key, label]) => {
                            const value = effectiveBookingSlots[key];
                            const isFilled = hasValue(value);
                            const isRequired = REQUIRED_SLOTS.includes(key);

                            if ((key === "nights" || key === "totalPrice") && !isFilled) return null;

                            return (
                                <motion.div
                                    key={key}
                                    layout
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    className={`rounded-xl border p-3 transition-all duration-300 ${recentlyChanged.has(key)
                                        ? "border-amber-500/50 bg-amber-500/10 ring-1 ring-amber-500/30"
                                        : isFilled
                                            ? "border-blue-500/30 bg-slate-700/50"
                                            : "border-slate-700/30 bg-slate-800/30"
                                        }`}
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs uppercase tracking-wider text-white/50">{label}</span>
                                        {isFilled ? (
                                            <span className="text-xs text-green-400">filled</span>
                                        ) : isRequired ? (
                                            <span className="text-xs text-amber-400/60">pending</span>
                                        ) : key === "children" ? (
                                            <span className="text-xs text-white/35">optional</span>
                                        ) : null}
                                    </div>
                                    <div className={`mt-1 text-sm ${isFilled ? "text-white" : "text-white/20"}`}>
                                        {formatSlotValue(key, value, selectedRoomLabel)}
                                    </div>
                                </motion.div>
                            );
                        })}

                        <div className="rounded-2xl border border-cyan-400/20 bg-slate-950/40 p-4">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <h2 className="text-sm font-medium text-white">Review and edit manually</h2>
                                    <p className="mt-1 text-xs leading-relaxed text-white/50">
                                        Use this when voice capture gets a room, name, or dates wrong. Manual changes override captured values.
                                    </p>
                                </div>
                                {!isEditing && (
                                    <button
                                        type="button"
                                        onClick={handleStartEditing}
                                        className="rounded-full border border-cyan-400/40 px-4 py-2 text-xs font-medium text-cyan-100 transition hover:border-cyan-300 hover:bg-cyan-400/10"
                                    >
                                        Edit details
                                    </button>
                                )}
                            </div>

                            {manualStatus && !isEditing && (
                                <p className="mt-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                                    {manualStatus}
                                </p>
                            )}

                            {!isEditing && selectedRoomDetails && (
                                <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/60">
                                    Room capacity:
                                    {typeof selectedRoomDetails?.maxAdults === "number" ? ` ${selectedRoomDetails.maxAdults} adults` : " adults not set"}
                                    {typeof selectedRoomDetails?.maxChildren === "number" ? `, ${selectedRoomDetails.maxChildren} children` : ""}
                                    {typeof selectedRoomDetails?.maxTotalGuests === "number" ? `, ${selectedRoomDetails.maxTotalGuests} total guests` : ""}
                                </p>
                            )}

                            {isEditing && (
                                    <div ref={manualEditorRef} data-booking-form="true" className="mt-4 space-y-3">
                                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                            <label
                                                className="block text-xs text-white/60"
                                            >
                                                Room
                                                {availableRooms.length > 0 ? (
                                                    <select
                                                        data-empty={(!manualForm.roomId && !manualForm.roomType).toString()}
                                                        value={manualForm.roomId}
                                                        onChange={(event) => handleManualFieldChange("roomId", event.target.value)}
                                                        className={inputClassName}
                                                    >
                                                        <option value="">Select a room</option>
                                                        {availableRooms.map((room: any) => (
                                                            <option key={room.id} value={room.id}>
                                                                {room.name}
                                                            </option>
                                                        ))}
                                                    </select>
                                                ) : (
                                                    <input
                                                        data-empty={(!manualForm.roomType).toString()}
                                                        type="text"
                                                        value={manualForm.roomType}
                                                        onChange={(event) => handleManualFieldChange("roomType", event.target.value)}
                                                        className={inputClassName}
                                                        placeholder="Room name"
                                                    />
                                                )}
                                            </label>

                                            <label className="block text-xs text-white/60">
                                                Adults
                                                <input
                                                    data-empty={(!manualForm.adults).toString()}
                                                    type="number"
                                                    min="1"
                                                    value={manualForm.adults}
                                                    onChange={(event) => handleManualFieldChange("adults", event.target.value)}
                                                    className={inputClassName}
                                                    placeholder="2"
                                                />
                                            </label>

                                            <label className="block text-xs text-white/60">
                                                Children
                                                <input
                                                    type="number"
                                                    min="0"
                                                    value={manualForm.children}
                                                    onChange={(event) => handleManualFieldChange("children", event.target.value)}
                                                    className={inputClassName}
                                                    placeholder="0"
                                                />
                                            </label>

                                            <label className="block text-xs text-white/60 md:col-span-2">
                                                Guest name
                                                <input
                                                    data-empty={(!manualForm.guestName.trim()).toString()}
                                                    type="text"
                                                    value={manualForm.guestName}
                                                    onChange={(event) => handleManualFieldChange("guestName", event.target.value)}
                                                    className={inputClassName}
                                                    placeholder="Guest name"
                                                />
                                            </label>

                                            <label className="block text-xs text-white/60">
                                                Check-in date
                                                <div className="mt-1 flex items-center gap-2">
                                                    <input
                                                        data-slot-empty={(!manualForm.checkInDate).toString()}
                                                        ref={checkInInputRef}
                                                        type="date"
                                                        min={todayDateValue}
                                                        value={manualForm.checkInDate}
                                                        onChange={(event) => handleManualFieldChange("checkInDate", event.target.value)}
                                                        className={`${inputClassName} mt-0`}
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => openDatePicker("checkInDate")}
                                                        className="inline-flex items-center gap-1 rounded-lg border border-slate-600/70 px-3 py-2 text-xs text-cyan-100 transition hover:border-cyan-400"
                                                    >
                                                        <CalendarDays size={14} />
                                                        Calendar
                                                    </button>
                                                </div>
                                            </label>

                                            <label className="block text-xs text-white/60">
                                                Check-out date
                                                <div className="mt-1 flex items-center gap-2">
                                                    <input
                                                        data-slot-empty={(!manualForm.checkOutDate).toString()}
                                                        ref={checkOutInputRef}
                                                        type="date"
                                                        min={manualForm.checkInDate || todayDateValue}
                                                        value={manualForm.checkOutDate}
                                                        onChange={(event) => handleManualFieldChange("checkOutDate", event.target.value)}
                                                        className={`${inputClassName} mt-0`}
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => openDatePicker("checkOutDate")}
                                                        className="inline-flex items-center gap-1 rounded-lg border border-slate-600/70 px-3 py-2 text-xs text-cyan-100 transition hover:border-cyan-400"
                                                    >
                                                        <CalendarDays size={14} />
                                                        Calendar
                                                    </button>
                                                </div>
                                            </label>
                                    </div>

                                    {manualError && (
                                        <p className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                                            {manualError}
                                        </p>
                                    )}

                                    <div className="flex gap-3">
                                        <button
                                            type="button"
                                            onClick={handleCancelEditing}
                                            className="flex-1 rounded-xl border border-slate-600/70 px-4 py-3 text-sm text-white/70 transition hover:border-slate-500 hover:text-white"
                                        >
                                            Cancel edits
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleManualSave}
                                            className="flex-1 rounded-xl bg-cyan-500 px-4 py-3 text-sm font-medium text-slate-950 transition hover:bg-cyan-400"
                                        >
                                            Save changes
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {!isEditing && (
                        <div className="mt-4 space-y-3">
                            {readinessError && (
                                <p className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                                    {readinessError}
                                </p>
                            )}

                            <button
                                type="button"
                                onClick={handleContinueToReview}
                                disabled={!canContinueToSummary}
                                className={`w-full rounded-xl px-4 py-3 text-sm font-medium transition ${canContinueToSummary
                                    ? "bg-cyan-500 text-slate-950 hover:bg-cyan-400"
                                    : "cursor-not-allowed border border-slate-700/70 bg-slate-900/50 text-white/35"
                                    }`}
                            >
                                Continue to review
                            </button>
                        </div>
                    )}

                    <button
                        onClick={() => emit("CANCEL_BOOKING")}
                        className="mt-6 w-full rounded-xl border border-slate-700/50 py-3 text-sm text-white/40 transition-all hover:border-red-500/30 hover:text-white/80"
                    >
                        Cancel Booking
                    </button>
                </div>
            </div>
        </div>
    );
};
