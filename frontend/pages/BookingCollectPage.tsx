import React, { useEffect, useRef, useState } from "react";
import { useUIState } from "../state/uiContext";
import { useBrain } from "../hooks/useBrain";
import { motion, AnimatePresence } from "framer-motion";
import { CalendarDays } from "lucide-react";
import AnimatedGradientBackground from "../components/ui/animated-gradient-background";

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
    const checkInInputRef = useRef<HTMLInputElement>(null);
    const checkOutInputRef = useRef<HTMLInputElement>(null);

    const buildManualForm = (): ManualBookingForm => {
        const matchedRoom = availableRooms.find((room: any) => room?.id === data?.selectedRoom?.id)
            || availableRooms.find((room: any) => String(room?.name || "").trim() === selectedRoomLabel)
            || null;

        return {
            roomId: matchedRoom?.id || "",
            roomType: matchedRoom?.name || selectedRoomLabel || String(effectiveBookingSlots.roomType || "").trim(),
            adults: hasValue(effectiveBookingSlots.adults) ? String(effectiveBookingSlots.adults) : "",
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
        effectiveBookingSlots.guestName,
        effectiveBookingSlots.checkInDate,
        effectiveBookingSlots.checkOutDate,
        roomOptionsFingerprint,
    ]);

    const filledCount = REQUIRED_SLOTS.filter((slot) => hasValue(effectiveBookingSlots[slot])).length;
    const progress = (filledCount / REQUIRED_SLOTS.length) * 100;

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
        const adultsText = manualForm.adults.trim();
        const guestName = manualForm.guestName.trim();

        if (!resolvedRoomName) {
            setManualError("Select a room before saving.");
            return;
        }

        if (adultsText && (!/^\d+$/.test(adultsText) || Number(adultsText) <= 0)) {
            setManualError("Adults must be a positive number.");
            return;
        }

        if (
            manualForm.checkInDate &&
            manualForm.checkOutDate &&
            manualForm.checkOutDate < manualForm.checkInDate
        ) {
            setManualError("Check-out date must be after check-in date.");
            return;
        }

        const nextSlots = {
            ...effectiveBookingSlots,
            roomType: resolvedRoomName,
            adults: adultsText ? Number(adultsText) : null,
            guestName: guestName || null,
            checkInDate: manualForm.checkInDate || null,
            checkOutDate: manualForm.checkOutDate || null,
        };

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

        emit("BOOKING_FIELDS_UPDATED", {
            slots: nextSlots,
            selectedRoom,
            error: null,
            manualOverride: true,
        });

        setManualError(null);
        setManualStatus("Manual changes applied. Voice and touch will use these details now.");
        setIsEditing(false);
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
        <div className="relative h-screen w-full overflow-hidden text-white">
            <AnimatedGradientBackground Breathing={true} />
            <div className="relative z-10 flex h-full w-full overflow-hidden">
                <div className="flex max-w-[60%] flex-1 flex-col p-8">
                    <div className="mb-6">
                        <h1 className="text-3xl font-light text-white/90">Booking Your Stay</h1>
                        <p className="mt-1 text-sm text-white/50">Speak naturally. The kiosk will keep the details in sync.</p>
                        {nextSlotHintLabel && (
                            <p className="mt-2 text-xs text-blue-200/80">Next detail: {nextSlotHintLabel}</p>
                        )}
                    </div>

                    <div className="scrollbar-thin flex-1 space-y-4 overflow-y-auto pr-4">
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
                                        className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${msg.role === "user"
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

                    <div className="mt-4 text-center text-xs text-white/30">
                        Speak to continue your booking
                    </div>
                </div>

                <div className="flex w-[40%] flex-col border-l border-slate-700/50 bg-slate-800/50 p-8">
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

                            if (key === "children" && !isFilled) return null;
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

                            {isEditing && (
                                <div className="mt-4 space-y-3">
                                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                        <label className="block text-xs text-white/60">
                                            Room
                                            {availableRooms.length > 0 ? (
                                                <select
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
                                                type="number"
                                                min="1"
                                                value={manualForm.adults}
                                                onChange={(event) => handleManualFieldChange("adults", event.target.value)}
                                                className={inputClassName}
                                                placeholder="2"
                                            />
                                        </label>

                                        <label className="block text-xs text-white/60 md:col-span-2">
                                            Guest name
                                            <input
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
                                                    ref={checkInInputRef}
                                                    type="date"
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
                                                    ref={checkOutInputRef}
                                                    type="date"
                                                    min={manualForm.checkInDate || undefined}
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
