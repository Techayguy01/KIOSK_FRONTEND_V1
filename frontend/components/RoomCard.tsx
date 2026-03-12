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
      className={`group relative overflow-hidden rounded-2xl border-2 cursor-pointer transition-all duration-300 ${
        selected 
          ? 'border-blue-500 bg-slate-800 scale-[1.02] shadow-2xl shadow-blue-500/20' 
          : 'border-slate-700 bg-slate-800/50 hover:border-slate-500'
      }`}
    >
      <div
        className="aspect-video w-full overflow-hidden relative"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {currentImageSrc ? (
          <img
            src={currentImageSrc}
            alt={room.name}
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
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
              className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/45 hover:bg-black/60 text-white rounded-full p-2 transition-colors"
              aria-label="Previous room image"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={goToNextImage}
              className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/45 hover:bg-black/60 text-white rounded-full p-2 transition-colors"
              aria-label="Next room image"
            >
              <ChevronRight size={16} />
            </button>
            <div className="absolute bottom-3 left-0 right-0 flex items-center justify-center gap-1.5">
              {imageEntries.map((_, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setActiveImageIndex(index);
                  }}
                  className={`h-1.5 rounded-full transition-all ${
                    index === activeImageIndex ? 'w-5 bg-white' : 'w-2 bg-white/50'
                  }`}
                  aria-label={`Go to room image ${index + 1}`}
                />
              ))}
            </div>
          </>
        )}
        {selected && (
          <div className="absolute top-4 right-4 bg-blue-500 text-white p-2 rounded-full shadow-lg">
            <Check size={20} />
          </div>
        )}
      </div>
      
      <div className="p-5">
        <div className="flex justify-between items-start mb-2">
          <h3 className="text-xl font-bold text-white">{room.name}</h3>
          <div className="text-right">
            <span className="block text-lg font-bold text-blue-400">
              {room.currency === 'USD' ? '$' : room.currency}{room.price}
            </span>
            <span className="text-xs text-slate-400">/ night</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          {room.features.map((feature, i) => (
            <span key={i} className="px-2 py-1 bg-slate-700 text-slate-300 text-xs rounded-md flex items-center gap-1">
              <span className="w-1 h-1 bg-slate-400 rounded-full"></span>
              {feature}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
