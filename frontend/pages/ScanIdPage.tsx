import React, { useState } from 'react';
import { useUIState } from '../state/uiContext';
import { WebcamScanner } from '../components/WebcamScanner'; // Import it
import { ShieldCheck, User } from 'lucide-react';

export const ScanIdPage: React.FC = () => {
  const { emit } = useUIState();
  const [status, setStatus] = useState<'IDLE' | 'ANALYZING' | 'APPROVED'>('IDLE');

  const handleCapture = (imageSrc: string) => {
    // 1. Image Captured
    setStatus('ANALYZING');
    console.log("[ScanPage] Image captured (simulated upload)");

    // 2. Simulate Backend Verification (1.5s delay)
    setTimeout(() => {
      setStatus('APPROVED');

      // 3. Move to Next Screen
      setTimeout(() => {
        emit('SCAN_COMPLETED');
      }, 800);
    }, 1500);
  };

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center animate-in fade-in zoom-in duration-500 bg-slate-900 text-white">

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-white mb-2">Identity Verification</h1>
        <p className="text-slate-400 text-lg">Please hold your ID card or Passport up to the camera.</p>
      </div>

      {/* The Scanner */}
      <div className="w-full max-w-xl mb-8">
        {status === 'APPROVED' ? (
          <div className="bg-emerald-900/30 border-2 border-emerald-500/50 p-12 rounded-2xl text-emerald-100 flex flex-col items-center animate-in zoom-in">
            <ShieldCheck size={64} className="mb-4 text-emerald-400" />
            <h2 className="text-2xl font-bold">Verification Successful</h2>
            <p className="text-emerald-200/80">Welcome back, Alex.</p>
          </div>
        ) : (
          <WebcamScanner onCapture={handleCapture} />
        )}
      </div>

      {/* Status Text */}
      {status === 'ANALYZING' && (
        <p className="text-blue-400 font-mono animate-pulse">
          Extracting Data... verifying hologram...
        </p>
      )}

      {/* Fallback for Demo (Director Safety Net) */}
      <button
        onClick={() => emit('SCAN_COMPLETED')}
        className="mt-8 text-xs text-slate-600 hover:text-slate-400 underline transition-colors"
      >
        (Demo: Skip Camera)
      </button>
    </div>
  );
};