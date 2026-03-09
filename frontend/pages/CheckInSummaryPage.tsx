import React from "react";
import { useUIState } from "../state/uiContext";
import AnimatedGradientBackground from "../components/ui/animated-gradient-background";

export const CheckInSummaryPage: React.FC = () => {
  const { data, emit } = useUIState();
  const matchedBooking = data?.matchedBooking || null;
  const fields = data?.ocr?.fields || {};

  return (
    <div className="h-screen w-full overflow-hidden relative text-white">
      <AnimatedGradientBackground Breathing={true} />
      <div className="relative z-10 h-full w-full max-w-4xl mx-auto px-6 py-10 flex flex-col">
        <h1 className="text-3xl font-light mb-2">Check In Summary</h1>
        <p className="text-white/60 mb-6">Final verification before issuing access.</p>

        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/50 p-6 space-y-4 flex-1">
          <div className="text-sm text-white/80">
            <span className="text-white/50">Verified Name:</span> {fields.fullName || "Not detected"}
          </div>
          <div className="text-sm text-white/80">
            <span className="text-white/50">Document:</span> {fields.documentType || "UNKNOWN"} {fields.documentNumber ? `(${fields.documentNumber})` : ""}
          </div>
          <div className="text-sm text-white/80">
            <span className="text-white/50">DOB / YOB:</span> {fields.dateOfBirth || fields.yearOfBirth || "Not detected"}
          </div>

          {matchedBooking ? (
            <div className="mt-4 border-t border-slate-700/60 pt-4 space-y-2 text-sm text-white/85">
              <div><span className="text-white/50">Booking ID:</span> {matchedBooking.id}</div>
              <div><span className="text-white/50">Guest:</span> {matchedBooking.guestName}</div>
              <div><span className="text-white/50">Room:</span> {matchedBooking.roomName || matchedBooking.roomTypeId}</div>
              <div><span className="text-white/50">Stay:</span> {matchedBooking.checkInDate} to {matchedBooking.checkOutDate}</div>
              <div><span className="text-white/50">Status:</span> {matchedBooking.status}</div>
            </div>
          ) : (
            <div className="mt-4 border-t border-slate-700/60 pt-4 text-amber-300 text-sm">
              No confirmed booking was auto-matched. Rescan the ID or return to welcome for manual assistance.
            </div>
          )}
        </div>

        <div className="pt-6 flex gap-3">
          <button
            onClick={() => emit("RESCAN")}
            className="px-5 py-3 rounded-xl border border-slate-600/60 text-white/80 hover:text-white hover:border-white/40"
          >
            Rescan ID
          </button>
          <button
            onClick={() => emit("BACK_REQUESTED")}
            className="px-5 py-3 rounded-xl border border-slate-600/60 text-white/80 hover:text-white hover:border-white/40"
          >
            Back
          </button>
          {matchedBooking ? (
            <button
              onClick={() => emit("CONFIRM_CHECKIN")}
              className="ml-auto px-6 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 text-white font-medium"
            >
              Continue
            </button>
          ) : (
            <button
              onClick={() => emit("RESET")}
              className="ml-auto px-6 py-3 rounded-xl bg-slate-700 text-white font-medium"
            >
              Return to Welcome
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
