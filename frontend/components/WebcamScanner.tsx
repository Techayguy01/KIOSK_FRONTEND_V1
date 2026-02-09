import React, { useRef, useState, useCallback } from 'react';
import Webcam from 'react-webcam';
import { motion } from 'framer-motion';
import { Camera, RefreshCw, CheckCircle } from 'lucide-react';

interface WebcamScannerProps {
    onCapture: (imageSrc: string) => void;
}

export const WebcamScanner: React.FC<WebcamScannerProps> = ({ onCapture }) => {
    const webcamRef = useRef<Webcam>(null);
    const [isScanning, setIsScanning] = useState(true);
    const [flash, setFlash] = useState(false);

    const capture = useCallback(() => {
        const imageSrc = webcamRef.current?.getScreenshot();
        if (imageSrc) {
            setFlash(true);
            setIsScanning(false);
            setTimeout(() => setFlash(false), 200); // Flash effect

            // Simulate "Analysis" delay before finishing
            setTimeout(() => {
                onCapture(imageSrc);
            }, 1500);
        }
    }, [webcamRef, onCapture]);

    return (
        <div className="relative w-full max-w-lg mx-auto overflow-hidden rounded-2xl shadow-2xl border-4 border-slate-800 bg-black">
            {/* 1. The Camera Feed */}
            <Webcam
                audio={false}
                ref={webcamRef}
                screenshotFormat="image/jpeg"
                className="w-full h-64 object-cover"
                videoConstraints={{ facingMode: "user" }}
            />

            {/* 2. The "Scanner" Laser Overlay */}
            {isScanning && (
                <motion.div
                    animate={{ top: ['10%', '90%', '10%'] }}
                    transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                    className="absolute left-0 w-full h-1 bg-green-500 shadow-[0_0_15px_rgba(34,197,94,0.8)] z-10"
                />
            )}

            {/* 3. The "HUD" Overlay (Corners) */}
            <div className="absolute inset-0 pointer-events-none border-[20px] border-transparent">
                <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-blue-500/50 rounded-tl-lg"></div>
                <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-blue-500/50 rounded-tr-lg"></div>
                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-blue-500/50 rounded-bl-lg"></div>
                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-blue-500/50 rounded-br-lg"></div>
            </div>

            {/* 4. Flash Effect */}
            {flash && <div className="absolute inset-0 bg-white z-50 animate-out fade-out duration-300" />}

            {/* 5. Controls */}
            <div className="absolute bottom-4 left-0 w-full flex justify-center z-20">
                {isScanning ? (
                    <button
                        onClick={capture}
                        className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-full font-bold shadow-lg transition-transform active:scale-95"
                    >
                        <Camera size={20} />
                        SCAN ID
                    </button>
                ) : (
                    <div className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-full font-bold">
                        <CheckCircle size={20} />
                        ANALYZING...
                    </div>
                )}
            </div>
        </div>
    );
};
