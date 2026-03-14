import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { optimizeCloudinaryUrl } from '../lib/cloudinary';

interface Room {
  id: string;
  name: string;
  price: number;
  currency: string;
  image: string;
  imageUrls?: string[];
  features: string[];
}

interface RoomCardProps {
  room: Room;
  onSelect: (room: Room) => void;
  selected: boolean;
}

export const RoomCard: React.FC<RoomCardProps> = ({ room, onSelect, selected }) => {
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [failedOptimizedIndexes, setFailedOptimizedIndexes] = useState<Record<number, boolean>>({});
  const touchStartX = useRef<number | null>(null);

  const imageEntries = useMemo(() => {
    const raw = Array.isArray(room.imageUrls) && room.imageUrls.length > 0
      ? room.imageUrls
      : [room.image];

    return raw
      .map((url) => String(url || "").trim())
      .filter((url) => Boolean(url))
      .map((rawUrl) => ({
        rawUrl,
        optimizedUrl: optimizeCloudinaryUrl(rawUrl),
      }));
  }, [room.image, room.imageUrls]);

  useEffect(() => {
    setActiveImageIndex(0);
    setFailedOptimizedIndexes({});
  }, [room.id]);

  useEffect(() => {
    if (activeImageIndex >= imageEntries.length) {
      setActiveImageIndex(0);
    }
  }, [activeImageIndex, imageEntries.length]);

  const goToPreviousImage = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (imageEntries.length <= 1) return;
    setActiveImageIndex((current) => (current - 1 + imageEntries.length) % imageEntries.length);
  };

  const goToNextImage = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (imageEntries.length <= 1) return;
    setActiveImageIndex((current) => (current + 1) % imageEntries.length);
  };

  const onTouchStart = (event: React.TouchEvent) => {
    touchStartX.current = event.changedTouches[0]?.clientX ?? null;
  };

  const onTouchEnd = (event: React.TouchEvent) => {
    if (imageEntries.length <= 1 || touchStartX.current === null) return;
    const endX = event.changedTouches[0]?.clientX ?? touchStartX.current;
    const delta = endX - touchStartX.current;
    touchStartX.current = null;

    if (Math.abs(delta) < 40) return;
    event.stopPropagation();
    if (delta > 0) {
      setActiveImageIndex((current) => (current - 1 + imageEntries.length) % imageEntries.length);
    } else {
      setActiveImageIndex((current) => (current + 1) % imageEntries.length);
    }
  };

  const currentEntry = imageEntries[activeImageIndex];
  const currentImageSrc = currentEntry
    ? (failedOptimizedIndexes[activeImageIndex] ? currentEntry.rawUrl : currentEntry.optimizedUrl)
    : "";

  return (
      <div 
        onClick={() => onSelect(room)}
        className={`group relative overflow-hidden rounded-3xl border-2 cursor-pointer transition-all duration-300 ${
          selected 
            ? 'border-blue-500 bg-slate-800 scale-[1.02] shadow-2xl shadow-blue-500/25' 
            : 'border-slate-700 bg-slate-800/50 hover:border-slate-500'
        }`}
      >
        <div
          className="aspect-[16/10] w-full overflow-hidden relative"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
        {currentImageSrc ? (
          <img
            src={currentImageSrc}
            alt={room.name}
              className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
            onError={() => {
              const entry = imageEntries[activeImageIndex];
              if (!entry) return;

              const isUsingOptimized = !failedOptimizedIndexes[activeImageIndex] && entry.optimizedUrl !== entry.rawUrl;
              if (isUsingOptimized) {
                setFailedOptimizedIndexes((prev) => ({ ...prev, [activeImageIndex]: true }));
                if (import.meta.env.DEV) {
                  console.warn("[RoomCard] Optimized image failed, falling back to raw URL", {
                    roomId: room.id,
                    roomName: room.name,
                    optimizedUrl: entry.optimizedUrl,
                    rawUrl: entry.rawUrl,
                  });
                }
                return;
              }

              if (import.meta.env.DEV) {
                console.error("[RoomCard] Image failed to load", {
                  roomId: room.id,
                  roomName: room.name,
                  attemptedUrl: currentImageSrc,
                });
              }
            }}
          />
        ) : (
          <div className="h-full w-full bg-slate-700/70 flex items-center justify-center text-slate-300 text-sm">
            No image available
          </div>
        )}
        {imageEntries.length > 1 && (
          <>
            <button
              type="button"
              onClick={goToPreviousImage}
              className="absolute left-3 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/65 text-white rounded-full p-3 transition-colors"
              aria-label="Previous room image"
            >
              <ChevronLeft size={22} />
            </button>
            <button
              type="button"
              onClick={goToNextImage}
              className="absolute right-3 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/65 text-white rounded-full p-3 transition-colors"
              aria-label="Next room image"
            >
              <ChevronRight size={22} />
            </button>
            <div className="absolute bottom-4 left-0 right-0 flex items-center justify-center gap-2">
              {imageEntries.map((_, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setActiveImageIndex(index);
                  }}
                  className={`h-2 rounded-full transition-all ${
                    index === activeImageIndex ? 'w-6 bg-white' : 'w-3 bg-white/50'
                  }`}
                  aria-label={`Go to room image ${index + 1}`}
                />
              ))}
            </div>
          </>
        )}
        {selected && (
          <div className="absolute top-4 right-4 bg-blue-500 text-white p-3 rounded-full shadow-xl">
            <Check size={24} />
          </div>
        )}
      </div>
      
      <div className="p-7">
        <div className="flex justify-between items-start mb-3">
          <h3 className="text-2xl font-semibold text-white">{room.name}</h3>
          <div className="text-right">
            <span className="block text-2xl font-bold text-blue-300">
              {room.currency === 'USD' ? '$' : room.currency}{room.price}
            </span>
            <span className="text-sm text-slate-400">/ night</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 mt-5">
          {room.features.map((feature, i) => (
            <span key={i} className="px-3 py-2 bg-slate-700 text-slate-200 text-sm rounded-lg flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-slate-300 rounded-full"></span>
              {feature}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
