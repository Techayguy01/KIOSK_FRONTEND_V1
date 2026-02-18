import React from 'react';
import QRCode from "react-qr-code";

interface PaymentModalProps {
    paymentUrl: string;
    onClose: () => void;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({ paymentUrl, onClose }) => {
    return (
        <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50">
            <div className="bg-white p-8 rounded-2xl shadow-2xl text-center max-w-md w-full animate-in fade-in zoom-in duration-300">

                <h2 className="text-2xl font-bold text-gray-900 mb-2">Complete Booking</h2>
                <p className="text-gray-600 mb-6">Scan to pay securely on your phone</p>

                <div className="flex justify-center mb-6">
                    <div className="p-4 bg-white border-2 border-gray-100 rounded-xl">
                        <QRCode value={paymentUrl} size={200} />
                    </div>
                </div>

                <p className="text-xs text-gray-400 mb-6 break-all">
                    {paymentUrl}
                </p>

                <button
                    onClick={onClose}
                    className="w-full py-3 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold rounded-lg transition-colors"
                >
                    Cancel / Close
                </button>
            </div>
        </div>
    );
};
