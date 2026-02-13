import React, { useEffect, useRef, useState } from "react";
import { useUIState } from "../state/uiContext";
import { useBrain } from "../hooks/useBrain";
import { motion, AnimatePresence } from "framer-motion";

/**
 * BookingCollectPage
 * 
 * Renders during BOOKING_COLLECT state.
 * Shows a live conversation + progressive booking form.
 * 
 * RULE: This page is a RENDERER. It does not control flow.
 * It displays what the brain tells it and emits user actions.
 */

// Slot display configuration
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

export const BookingCollectPage: React.FC = () => {
    const { emit } = useUIState();
    const { conversationHistory, bookingSlots, isProcessing, lastResponse } = useBrain();
    const chatEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll chat to bottom
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [conversationHistory]);

    // Calculate progress
    const filledCount = REQUIRED_SLOTS.filter(s => bookingSlots[s] !== null && bookingSlots[s] !== undefined).length;
    const progress = (filledCount / REQUIRED_SLOTS.length) * 100;

    // Track slot changes for visual feedback
    const [previousSlots, setPreviousSlots] = useState<Record<string, any>>({});
    const [recentlyChanged, setRecentlyChanged] = useState<Set<string>>(new Set());

    useEffect(() => {
        const changed = new Set<string>();
        for (const key of Object.keys(bookingSlots)) {
            if (
                bookingSlots[key] !== null &&
                bookingSlots[key] !== undefined &&
                previousSlots[key] !== undefined &&
                previousSlots[key] !== null &&
                previousSlots[key] !== bookingSlots[key]
            ) {
                changed.add(key);
            }
        }
        if (changed.size > 0) {
            setRecentlyChanged(changed);
            // Clear the "changed" highlight after 2 seconds
            setTimeout(() => setRecentlyChanged(new Set()), 2000);
        }
        setPreviousSlots({ ...bookingSlots });
    }, [bookingSlots]);

    return (
        <div className="h-screen w-full flex bg-slate-900 text-white overflow-hidden">

            {/* LEFT: Conversation Panel */}
            <div className="flex-1 flex flex-col p-8 max-w-[60%]">

                {/* Header */}
                <div className="mb-6">
                    <h1 className="text-3xl font-light text-white/90">Booking Your Stay</h1>
                    <p className="text-sm text-white/50 mt-1">Speak naturally — I'll handle the details</p>
                </div>

                {/* Chat Messages */}
                <div className="flex-1 overflow-y-auto space-y-4 pr-4 scrollbar-thin">
                    <AnimatePresence>
                        {conversationHistory.map((msg, i) => (
                            <motion.div
                                key={i}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.3 }}
                                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                            >
                                <div
                                    className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${msg.role === "user"
                                        ? "bg-blue-600/80 text-white rounded-br-sm"
                                        : "bg-slate-700/80 text-white/90 rounded-bl-sm"
                                        }`}
                                >
                                    {msg.role === "assistant" && (
                                        <span className="text-xs text-blue-300 block mb-1">Siya</span>
                                    )}
                                    {msg.text}
                                </div>
                            </motion.div>
                        ))}
                    </AnimatePresence>

                    {/* Typing indicator */}
                    {isProcessing && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="flex justify-start"
                        >
                            <div className="bg-slate-700/80 px-4 py-3 rounded-2xl rounded-bl-sm">
                                <div className="flex space-x-1">
                                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                                </div>
                            </div>
                        </motion.div>
                    )}

                    <div ref={chatEndRef} />
                </div>

                {/* Voice hint */}
                <div className="mt-4 text-center text-white/30 text-xs">
                    🎤 Speak to continue your booking
                </div>
            </div>

            {/* RIGHT: Booking Card */}
            <div className="w-[40%] bg-slate-800/50 border-l border-slate-700/50 p-8 flex flex-col">

                {/* Progress Bar */}
                <div className="mb-6">
                    <div className="flex justify-between text-xs text-white/50 mb-2">
                        <span>Booking Progress</span>
                        <span>{filledCount}/{REQUIRED_SLOTS.length} details</span>
                    </div>
                    <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                        <motion.div
                            className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full"
                            initial={{ width: 0 }}
                            animate={{ width: `${progress}%` }}
                            transition={{ duration: 0.5, ease: "easeOut" }}
                        />
                    </div>
                </div>

                {/* Slot Cards */}
                <div className="space-y-3 flex-1">
                    {Object.entries(SLOT_LABELS).map(([key, label]) => {
                        const value = bookingSlots[key];
                        const isFilled = value !== null && value !== undefined;
                        const isRequired = REQUIRED_SLOTS.includes(key);

                        // Skip children if not provided and not required
                        if (key === "children" && !isFilled) return null;
                        // Skip computed fields if not yet computed
                        if ((key === "nights" || key === "totalPrice") && !isFilled) return null;

                        return (
                            <motion.div
                                key={key}
                                layout
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                className={`p-3 rounded-xl border transition-all duration-300 ${recentlyChanged.has(key)
                                        ? "bg-amber-500/10 border-amber-500/50 ring-1 ring-amber-500/30"  // CHANGED highlight
                                        : isFilled
                                            ? "bg-slate-700/50 border-blue-500/30"
                                            : "bg-slate-800/30 border-slate-700/30"
                                    }`}
                            >
                                <div className="flex justify-between items-center">
                                    <span className="text-xs text-white/50 uppercase tracking-wider">{label}</span>
                                    {isFilled ? (
                                        <span className="text-xs text-green-400">✓</span>
                                    ) : isRequired ? (
                                        <span className="text-xs text-amber-400/60">pending</span>
                                    ) : null}
                                </div>
                                <div className={`mt-1 text-sm ${isFilled ? "text-white" : "text-white/20"}`}>
                                    {isFilled
                                        ? key === "totalPrice"
                                            ? `₹${value.toLocaleString()}`
                                            : String(value)
                                        : "—"
                                    }
                                </div>
                            </motion.div>
                        );
                    })}
                </div>

                {/* Cancel button (touch fallback) */}
                <button
                    onClick={() => emit("CANCEL_BOOKING")}
                    className="mt-6 w-full py-3 text-sm text-white/40 hover:text-white/80 border border-slate-700/50 hover:border-red-500/30 rounded-xl transition-all"
                >
                    Cancel Booking
                </button>
            </div>
        </div>
    );
};
