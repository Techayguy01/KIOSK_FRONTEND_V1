import React from "react";
import { useUIState } from "../state/uiContext";
import AnimatedGradientBackground from "../components/ui/animated-gradient-background";

export const IdVerifyPage: React.FC = () => {
  const { data, emit } = useUIState();
  const ocr = data?.ocr || null;
  const fields = ocr?.fields || {};
  const matchedBooking = data?.matchedBooking || null;
  const multiplePossibleMatches = Boolean(data?.multiplePossibleMatches);
  const weakExtraction = Boolean(data?.weakExtraction);
  const extractionMessage = String(data?.extractionMessage || "").trim();

  return (
    <div className="h-screen w-full overflow-hidden relative text-white">
      <AnimatedGradientBackground Breathing={true} />
      <div className="relative z-10 h-full w-full max-w-5xl mx-auto px-6 py-10 flex flex-col">
        <h1 className="text-3xl font-light mb-2">Verify ID Details</h1>
        <p className="text-white/60 mb-6">Review extracted details before continuing check in.</p>

        {weakExtraction && (
          <div className="mb-6 rounded-2xl border border-amber-500/40 bg-amber-950/30 px-5 py-4 text-sm text-amber-100">
            <div className="font-medium text-amber-200">Partial OCR result</div>
            <div className="mt-1">
              {extractionMessage || "We could only read part of the ID. Please review the extracted details carefully before continuing."}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1">
          <div className="rounded-2xl border border-slate-700/60 bg-slate-900/50 p-5 space-y-3">
            <h2 className="text-lg font-medium">Extracted Identity</h2>
            <div className="text-sm text-white/80 space-y-2">
              <div><span className="text-white/50">Full Name:</span> {fields.fullName || "Not detected"}</div>
              <div><span className="text-white/50">Document Number:</span> {fields.documentNumber || "Not detected"}</div>
              <div><span className="text-white/50">Date of Birth / YOB:</span> {fields.dateOfBirth || fields.yearOfBirth || "Not detected"}</div>
              <div><span className="text-white/50">Document Type:</span> {fields.documentType || "UNKNOWN"}</div>
              <div><span className="text-white/50">OCR Confidence:</span> {typeof ocr?.confidence === "number" ? `${Math.round(ocr.confidence * 100)}%` : "N/A"}</div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-700/60 bg-slate-900/50 p-5">
            <h2 className="text-lg font-medium mb-3">Booking Match</h2>
            {matchedBooking ? (
              <div className="text-sm text-white/80 space-y-2">
                <div><span className="text-white/50">Guest:</span> {matchedBooking.guestName}</div>
                <div><span className="text-white/50">Room:</span> {matchedBooking.assignedRoomNumber || matchedBooking.roomName || matchedBooking.roomTypeId}</div>
                <div><span className="text-white/50">Check-in:</span> {matchedBooking.checkInDate}</div>
                <div><span className="text-white/50">Check-out:</span> {matchedBooking.checkOutDate}</div>
                <div><span className="text-white/50">Status:</span> {matchedBooking.status}</div>
              </div>
            ) : multiplePossibleMatches ? (
              <p className="text-amber-300 text-sm">
                Multiple possible bookings were found. Please rescan or continue and verify manually.
              </p>
            ) : (
              <p className="text-white/70 text-sm">
                No confirmed booking match found for this ID. You can rescan or continue for manual verification.
              </p>
            )}
          </div>
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
          <button
            onClick={() => emit("CONFIRM_ID")}
            className="ml-auto px-6 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 text-white font-medium"
          >
            Confirm Identity
          </button>
        </div>
      </div>
    </div>
  );
};
