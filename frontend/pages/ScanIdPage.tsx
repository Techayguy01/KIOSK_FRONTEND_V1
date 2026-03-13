import React, { useState, useEffect } from 'react';
import { useUIState } from '../state/uiContext';
import { AgentAdapter } from '../agent/adapter';
import { WebcamScanner, type WebcamCapturePayload } from '../components/WebcamScanner';
import { ShieldCheck } from 'lucide-react';
import AnimatedGradientBackground from '../components/ui/animated-gradient-background';
import { OcrServiceError, scanIdWithOcr } from '../services/ocr.service';

const ENABLE_OCR_DEMO_SKIP = import.meta.env.VITE_ENABLE_OCR_DEMO_SKIP === 'true';

function mapOcrErrorMessage(error: unknown): string {
  if (error instanceof OcrServiceError) {
    switch (error.code) {
      case 'OCR_ENGINE_NOT_AVAILABLE':
        return 'ID scanning service is unavailable on this kiosk. Please contact support.';
      case 'OCR_BAD_IMAGE':
        return 'Could not read the ID image. Place the full card inside the frame and retry with better lighting.';
      case 'OCR_PROCESSING_FAILED':
        return 'ID image was captured but not readable enough. Avoid glare, hold steady, and rescan.';
      default:
        return error.message || 'OCR service failed. Please try again.';
    }
  }
  if (error instanceof Error) return error.message;
  return 'Could not process ID image.';
}

export const ScanIdPage: React.FC = () => {
  const { emit } = useUIState();
  const [status, setStatus] = useState<'IDLE' | 'ANALYZING' | 'APPROVED' | 'ERROR'>('IDLE');
  const [scannerVersion, setScannerVersion] = useState(0);
  const [guestName, setGuestName] = useState('Guest');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Phase 10: Inactivity Guard - Send heartbeats to keep the session alive
  // while the user is actively focused on this page (aligning their ID).
  useEffect(() => {
    const interval = setInterval(() => {
      console.log('[ScanPage] Sending heartbeat to keep session alive...');
      AgentAdapter.heartbeat();
    }, 30000); // Every 30 seconds

    return () => clearInterval(interval);
  }, []);

  const handleCapture = async ({ imageSrc, cropBox }: WebcamCapturePayload) => {
    setStatus('ANALYZING');
    setErrorMessage(null);

    try {
      const result = await scanIdWithOcr(imageSrc, cropBox);

      if (result.weakExtraction) {
        // Keep the user on SCAN_ID: weak OCR must not advance as a successful verification turn.
        setStatus('ERROR');
        setErrorMessage(
          result.extractionMessage ||
            'We could not clearly read your ID. Place it fully inside the frame, avoid glare, and keep the text visible.',
        );
        setScannerVersion((prev) => prev + 1);
        return;
      }

      const extractedName = result?.ocr?.fields?.fullName?.trim();
      if (extractedName) {
        setGuestName(extractedName);
      }
      setStatus('APPROVED');

      setTimeout(() => {
        emit('OCR_SUCCESS', {
          ocr: result.ocr || null,
          matchedBooking: result.matchedBooking || null,
          multiplePossibleMatches: Boolean(result.multiplePossibleMatches),
          weakExtraction: Boolean(result.weakExtraction),
          extractionMessage: result.extractionMessage || null,
        });
      }, 800);
    } catch (error) {
      const message = mapOcrErrorMessage(error);
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
          <p className="text-slate-400 text-lg">Place your ID fully inside the frame, avoid glare, and hold steady until capture.</p>
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
            Isolating document... normalizing image... extracting identity...
          </p>
        )}

        {status === 'ERROR' && (
          <p className="text-red-400 font-mono max-w-xl">
            Scan issue: {errorMessage || 'Unable to read ID. Please retry with better lighting and a steady hold.'}
          </p>
        )}

        {ENABLE_OCR_DEMO_SKIP && (
          <button
            onClick={() =>
              emit('OCR_DEMO_SUCCESS', {
                ocr: {
                  text: 'DEMO_OCR_RESULT',
                  confidence: 1,
                  fields: {
                    fullName: 'Demo Guest',
                    documentNumber: 'DEMO1234',
                    dateOfBirth: '1990-01-01',
                    yearOfBirth: '1990',
                    documentType: 'UNKNOWN',
                  },
                },
                matchedBooking: null,
                multiplePossibleMatches: false,
                ocrDemo: true,
              })
            }
            className="mt-8 text-xs text-amber-500 hover:text-amber-300 underline transition-colors"
          >
            (Demo Mode: Skip Camera)
          </button>
        )}
      </div>
    </div>
  );
};
