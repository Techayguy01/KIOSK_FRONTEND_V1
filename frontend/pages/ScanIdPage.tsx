import React, { useState } from 'react';
import { useUIState } from '../state/uiContext';
import { WebcamScanner } from '../components/WebcamScanner'; // Import it
import { ShieldCheck } from 'lucide-react';
import AnimatedGradientBackground from '../components/ui/animated-gradient-background';
import { scanIdWithOcr } from '../services/ocr.service';

export const ScanIdPage: React.FC = () => {
  const { emit } = useUIState();
  const [status, setStatus] = useState<'IDLE' | 'ANALYZING' | 'APPROVED' | 'ERROR'>('IDLE');
  const [scannerVersion, setScannerVersion] = useState(0);
  const [guestName, setGuestName] = useState('Guest');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleCapture = async (imageSrc: string) => {
    setStatus('ANALYZING');
    setErrorMessage(null);

    try {
      const result = await scanIdWithOcr(imageSrc);
      const extractedName = result?.ocr?.fields?.fullName?.trim();
      if (extractedName) {
        setGuestName(extractedName);
      }
      setStatus('APPROVED');

      setTimeout(() => {
        emit('SCAN_COMPLETED');
      }, 800);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not process ID image.';
      console.error('[ScanPage] OCR failed:', error);
      setErrorMessage(message);
      setStatus('ERROR');
      setScannerVersion((prev) => prev + 1);
    }
  };

  return (
    <div className="h-screen w-full overflow-hidden relative text-white">
      <AnimatedGradientBackground Breathing={true} />
      <div className="relative z-10 flex flex-col items-center justify-center h-full p-8 text-center animate-in fade-in zoom-in duration-500">

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
              <p className="text-emerald-200/80">Welcome back, {guestName}.</p>
            </div>
          ) : (
            <WebcamScanner key={scannerVersion} onCapture={handleCapture} />
          )}
        </div>

        {/* Status Text */}
        {status === 'ANALYZING' && (
          <p className="text-blue-400 font-mono animate-pulse">
            Extracting Data... verifying hologram...
          </p>
        )}

        {status === 'ERROR' && (
          <p className="text-red-400 font-mono max-w-xl">
            OCR failed: {errorMessage || 'Unable to read ID. Please retry with better lighting.'}
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
    </div>
  );
};
