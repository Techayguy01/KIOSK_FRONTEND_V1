import React from "react";
import { useUIState } from "../state/uiContext";
import { useBrain } from "../hooks/useBrain";
import { motion } from "framer-motion";

/**
 * BookingSummaryPage
 * 
 * Renders during BOOKING_SUMMARY state.
 * Shows the complete booking for confirmation before payment.
 */
export const BookingSummaryPage: React.FC = () => {
    const { emit } = useUIState();
    const { bookingSlots } = useBrain();

    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return "—";
        try {
            return new Date(dateStr).toLocaleDateString("en-IN", {
                weekday: "short",
                month: "long",
                day: "numeric",
                year: "numeric",
            });
        } catch {
            return dateStr;
        }
    };

    return (
        <div className="h-screen w-full flex flex-col items-center justify-center bg-slate-900 text-white p-8">

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="w-full max-w-lg"
            >
                {/* Header */}
                <h1 className="text-3xl font-light text-center mb-2">Booking Summary</h1>
                <p className="text-center text-white/50 text-sm mb-8">Please confirm your reservation</p>

                {/* Summary Card */}
                <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-6 space-y-4">

                    <div className="flex justify-between items-center border-b border-slate-700/30 pb-4">
                        <span className="text-white/50 text-sm">Room</span>
                        <span className="text-lg font-medium">{bookingSlots.roomType || "—"}</span>
                    </div>

                    <div className="flex justify-between items-center">
                        <span className="text-white/50 text-sm">Guests</span>
                        <span>
                            {bookingSlots.adults || "—"} adult{bookingSlots.adults !== 1 ? "s" : ""}
                            {bookingSlots.children ? `, ${bookingSlots.children} child${bookingSlots.children !== 1 ? "ren" : ""}` : ""}
                        </span>
                    </div>

                    <div className="flex justify-between items-center">
                        <span className="text-white/50 text-sm">Check-in</span>
                        <span>{formatDate(bookingSlots.checkInDate)}</span>
                    </div>

                    <div className="flex justify-between items-center">
                        <span className="text-white/50 text-sm">Check-out</span>
                        <span>{formatDate(bookingSlots.checkOutDate)}</span>
                    </div>

                    <div className="flex justify-between items-center">
                        <span className="text-white/50 text-sm">Duration</span>
                        <span>{bookingSlots.nights || "—"} night{bookingSlots.nights !== 1 ? "s" : ""}</span>
                    </div>

                    <div className="flex justify-between items-center">
                        <span className="text-white/50 text-sm">Guest Name</span>
                        <span className="font-medium">{bookingSlots.guestName || "—"}</span>
                    </div>

                    <div className="flex justify-between items-center border-t border-slate-700/30 pt-4">
                        <span className="text-white/50 text-sm">Total</span>
                        <span className="text-2xl font-semibold text-cyan-400">
                            ₹{bookingSlots.totalPrice ? bookingSlots.totalPrice.toLocaleString() : "—"}
                        </span>
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-4 mt-8">
                    <button
                        onClick={() => emit("MODIFY_BOOKING")}
                        className="flex-1 py-4 rounded-xl border border-slate-600/50 text-white/70 hover:text-white hover:border-white/30 transition-all"
                    >
                        Modify
                    </button>
                    <button
                        onClick={() => emit("CONFIRM_PAYMENT")}
                        className="flex-1 py-4 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 text-white font-medium hover:from-blue-500 hover:to-cyan-400 transition-all shadow-lg shadow-blue-500/20"
                    >
                        Confirm & Pay
                    </button>
                </div>

                {/* Voice hint */}
                <p className="text-center text-white/30 text-xs mt-6">
                    Say "Confirm" to proceed or "Change something" to modify
                </p>
            </motion.div>
        </div>
    );
};
