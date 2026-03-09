import React, { useCallback, useRef, useState } from 'react';
import Webcam from 'react-webcam';
import { motion } from 'framer-motion';
import { AlertTriangle, Camera, CheckCircle } from 'lucide-react';
import type { NormalizedCropBoxDTO } from '@contracts/api.contract';

export interface WebcamCapturePayload {
  imageSrc: string;
  cropBox: NormalizedCropBoxDTO;
}

interface WebcamScannerProps {
  onCapture: (payload: WebcamCapturePayload) => void;
}

type CaptureGateResult = {
  ok: boolean;
  message?: string;
};

const DOCUMENT_FRAME: NormalizedCropBoxDTO = {
  x: 0.05,
  y: 0.12,
  width: 0.9,
  height: 0.72,
};

const SCAN_TIPS = [
  'Full card inside frame',
  'Avoid glare',
  'Move closer',
  'Hold steady',
];

async function loadImage(imageSrc: string): Promise<HTMLImageElement> {
  return await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load captured frame.'));
    image.src = imageSrc;
  });
}

async function evaluateCaptureQuality(
  imageSrc: string,
  cropBox: NormalizedCropBoxDTO,
): Promise<CaptureGateResult> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return { ok: true };
  }

  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  context.drawImage(image, 0, 0);

  const left = Math.max(0, Math.floor(canvas.width * cropBox.x));
  const top = Math.max(0, Math.floor(canvas.height * cropBox.y));
  const width = Math.max(1, Math.floor(canvas.width * cropBox.width));
  const height = Math.max(1, Math.floor(canvas.height * cropBox.height));
  const crop = context.getImageData(left, top, width, height);
  const pixels = crop.data;

  let minLuma = 255;
  let maxLuma = 0;
  let sumLuma = 0;
  let brightPixels = 0;

  const grayscale = new Uint8Array(width * height);
  for (let index = 0; index < pixels.length; index += 4) {
    const r = pixels[index];
    const g = pixels[index + 1];
    const b = pixels[index + 2];
    const luma = Math.round((0.299 * r) + (0.587 * g) + (0.114 * b));
    const pixelIndex = index / 4;
    grayscale[pixelIndex] = luma;
    minLuma = Math.min(minLuma, luma);
    maxLuma = Math.max(maxLuma, luma);
    sumLuma += luma;
    if (luma >= 138) {
      brightPixels += 1;
    }
  }

  const contrast = maxLuma - minLuma;
  const brightRatio = brightPixels / grayscale.length;
  const averageLuma = sumLuma / grayscale.length;

  let edgeCount = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const current = grayscale[(y * width) + x];
      const right = grayscale[(y * width) + x + 1];
      const bottom = grayscale[((y + 1) * width) + x];
      const edgeStrength = Math.abs(current - right) + Math.abs(current - bottom);
      if (edgeStrength >= 52) {
        edgeCount += 1;
      }
    }
  }

  const edgeRatio = edgeCount / grayscale.length;

  if (brightRatio < 0.16 || averageLuma < 60) {
    return {
      ok: false,
      message: 'Move the ID closer and keep the full card inside the frame.',
    };
  }

  if (contrast < 28 || edgeRatio < 0.012) {
    return {
      ok: false,
      message: 'The card is too small or too soft in frame. Move closer and hold steady.',
    };
  }

  if (averageLuma > 242) {
    return {
      ok: false,
      message: 'Too much glare detected. Tilt the card slightly and try again.',
    };
  }

  return { ok: true };
}

export const WebcamScanner: React.FC<WebcamScannerProps> = ({ onCapture }) => {
  const webcamRef = useRef<Webcam>(null);
  const [isScanning, setIsScanning] = useState(true);
  const [flash, setFlash] = useState(false);
  const [qualityMessage, setQualityMessage] = useState<string | null>(null);

  const capture = useCallback(async () => {
    const imageSrc = webcamRef.current?.getScreenshot();
    if (!imageSrc) {
      setQualityMessage('Camera frame was not available. Please retry.');
      return;
    }

    setQualityMessage(null);
    const qualityGate = await evaluateCaptureQuality(imageSrc, DOCUMENT_FRAME);
    if (!qualityGate.ok) {
      setQualityMessage(
        qualityGate.message || 'Capture quality is too weak. Move closer and retry.',
      );
      return;
    }

    setFlash(true);
    setIsScanning(false);
    setTimeout(() => setFlash(false), 200);
    onCapture({
      imageSrc,
      cropBox: DOCUMENT_FRAME,
    });
  }, [onCapture]);

  return (
    <div className="relative mx-auto w-full max-w-5xl overflow-hidden rounded-[32px] border-4 border-slate-800 bg-black shadow-2xl">
      <div className="relative aspect-[4/3] w-full">
        <Webcam
          audio={false}
          ref={webcamRef}
          screenshotFormat="image/jpeg"
          screenshotQuality={1}
          forceScreenshotSourceSize={true}
          className="absolute inset-0 h-full w-full object-cover"
          videoConstraints={{
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1440 },
          }}
        />

        {isScanning && (
          <motion.div
            animate={{ top: ['16%', '76%', '16%'] }}
            transition={{ repeat: Infinity, duration: 2.4, ease: 'linear' }}
            className="absolute left-[5%] right-[5%] h-1 bg-emerald-400 shadow-[0_0_18px_rgba(74,222,128,0.8)]"
          />
        )}

        <div className="absolute inset-0 bg-gradient-to-b from-slate-950/35 via-transparent to-slate-950/45" />

        <div
          className="absolute rounded-[28px] border-[3px] border-cyan-300/80 bg-cyan-200/5 shadow-[0_0_0_9999px_rgba(2,6,23,0.38)]"
          style={{
            left: `${DOCUMENT_FRAME.x * 100}%`,
            top: `${DOCUMENT_FRAME.y * 100}%`,
            width: `${DOCUMENT_FRAME.width * 100}%`,
            height: `${DOCUMENT_FRAME.height * 100}%`,
          }}
        >
          <div className="absolute -left-1.5 -top-1.5 h-10 w-10 rounded-tl-xl border-l-4 border-t-4 border-cyan-300" />
          <div className="absolute -right-1.5 -top-1.5 h-10 w-10 rounded-tr-xl border-r-4 border-t-4 border-cyan-300" />
          <div className="absolute -bottom-1.5 -left-1.5 h-10 w-10 rounded-bl-xl border-b-4 border-l-4 border-cyan-300" />
          <div className="absolute -bottom-1.5 -right-1.5 h-10 w-10 rounded-br-xl border-b-4 border-r-4 border-cyan-300" />
          <div className="absolute inset-4 rounded-2xl border border-dashed border-cyan-200/60" />
          <div className="absolute left-4 right-4 top-4 rounded-xl bg-slate-950/55 px-3 py-2 text-center text-[11px] font-medium tracking-[0.12em] text-cyan-50/95 uppercase md:text-xs">
            Capture the full front of the ID card
          </div>
        </div>

        <div className="absolute left-4 right-4 top-4 z-20 rounded-xl border border-cyan-300/25 bg-slate-950/65 px-3 py-2 text-left text-[11px] text-cyan-50 md:text-xs">
          <div className="font-semibold uppercase tracking-[0.18em] text-cyan-200/90">Scan quality</div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-cyan-50/90">
            {SCAN_TIPS.map((tip) => (
              <span key={tip}>{tip}</span>
            ))}
          </div>
        </div>

        {qualityMessage && (
          <div className="absolute left-4 right-4 bottom-20 z-20 rounded-xl border border-amber-400/40 bg-slate-950/80 px-4 py-3 text-left text-sm text-amber-100">
            <div className="flex items-start gap-2">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-300" />
              <span>{qualityMessage}</span>
            </div>
          </div>
        )}

        {flash && <div className="absolute inset-0 z-50 bg-white animate-out fade-out duration-300" />}

        <div className="absolute bottom-4 left-0 z-20 flex w-full justify-center px-4">
          {isScanning ? (
            <button
              onClick={() => void capture()}
              className="flex items-center gap-2 rounded-full bg-blue-600 px-6 py-3 font-bold text-white shadow-lg transition-transform active:scale-95 hover:bg-blue-500"
            >
              <Camera size={20} />
              SCAN ID
            </button>
          ) : (
            <div className="flex items-center gap-2 rounded-full bg-emerald-600 px-6 py-3 font-bold text-white">
              <CheckCircle size={20} />
              ANALYZING...
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
