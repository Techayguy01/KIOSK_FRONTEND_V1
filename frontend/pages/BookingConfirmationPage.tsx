import React from 'react';

// MOCK DATA: Simulating a database fetch
const FOUND_RESERVATION = {
    guestName: "Rahul Sharma",
    confirmation: "RES-8829-X",
    roomName: "Deluxe Ocean Suite",
    dates: "Oct 24 - Oct 26 (2 Nights)",
    status: "PRE-PAID",
    image: "https://images.unsplash.com/photo-1578683010236-d716f9a3f461?auto=format&fit=crop&w=800&q=80"
};

interface Props {
    onConfirm: () => void;
}

export const BookingConfirmationPage: React.FC<Props> = ({ onConfirm }) => {
    return (
        <div className="h-full w-full bg-gray-900 p-12 flex flex-col items-center justify-center animate-fade-in">

            <div className="text-center mb-8">
                <div className="inline-block p-4 rounded-full bg-green-500/20 text-green-400 mb-4 animate-bounce">
                    <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                </div>
                <h1 className="text-4xl text-white font-bold">Welcome back, {FOUND_RESERVATION.guestName}</h1>
                <p className="text-gray-400 mt-2">We found your reservation.</p>
            </div>

            <div className="bg-gray-800 rounded-2xl p-6 w-full max-w-2xl border border-gray-700 shadow-2xl flex gap-6">
                <div className="w-1/3 rounded-xl overflow-hidden">
                    <img src={FOUND_RESERVATION.image} className="w-full h-full object-cover" alt="Room" />
                </div>

                <div className="flex-1 flex flex-col justify-center">
                    <div className="flex justify-between items-start mb-4">
                        <div>
                            <h3 className="text-xl text-white font-bold">{FOUND_RESERVATION.roomName}</h3>
                            <p className="text-sm text-gray-400">Confirmation: {FOUND_RESERVATION.confirmation}</p>
                        </div>
                        <span className="px-3 py-1 bg-green-900 text-green-300 text-xs font-bold rounded-full">
                            {FOUND_RESERVATION.status}
                        </span>
                    </div>

                    <div className="space-y-2 mb-6">
                        <div className="flex justify-between text-gray-300 border-b border-gray-700 pb-2">
                            <span>Check-in</span>
                            <span className="font-mono">{FOUND_RESERVATION.dates}</span>
                        </div>
                    </div>

                    <button
                        onClick={onConfirm}
                        className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg transition-all shadow-lg shadow-blue-500/30"
                    >
                        Confirm & Issue Key Card
                    </button>
                </div>
            </div>
        </div>
    );
};
