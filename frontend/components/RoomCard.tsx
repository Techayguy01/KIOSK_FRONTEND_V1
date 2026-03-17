import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BedDouble, Check, ChevronLeft, ChevronRight, ImageIcon, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { optimizeCloudinaryUrl } from '../lib/cloudinary';
import type { RoomDTO } from '../services/room.service';

interface RoomCardProps {
  room: RoomDTO;
  onSelect: (room: RoomDTO) => void;
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
  const imageCount = imageEntries.length;
  const categoryHighlights = Array.isArray(room.images)
    ? Array.from(
      new Set(
        room.images
          .map((image) => String(image.category || image.caption || '').trim())
          .filter(Boolean)
      )
    ).slice(0, 3)
    : [];
  const guestCapacity = room.maxTotalGuests || room.maxAdults || null;
  const guestLabel = guestCapacity
    ? `${guestCapacity} guest${guestCapacity === 1 ? '' : 's'}`
    : 'Flexible stay';
  const childLabel = typeof room.maxChildren === 'number'
    ? `${room.maxChildren} child${room.maxChildren === 1 ? '' : 'ren'}`
    : 'Voice-guided preview';
  const imageLabel = imageCount > 1 ? `${imageCount} visuals` : '1 visual';
  const featureHighlights = room.features.slice(0, 6);
  const summary = [
    room.maxAdults ? `Designed for up to ${room.maxAdults} adult${room.maxAdults === 1 ? '' : 's'}` : null,
    room.maxChildren ? `and ${room.maxChildren} child${room.maxChildren === 1 ? '' : 'ren'}` : null,
    featureHighlights.length > 0 ? `with ${featureHighlights.slice(0, 3).join(', ')}` : null,
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const pricePrefix = room.currency === 'USD' ? '$' : room.currency;

  return (
      <div 
        onClick={() => onSelect(room)}
        className={`group relative overflow-hidden rounded-3xl border-2 cursor-pointer transition-all duration-300 ${
          selected 
            ? 'border-cyan-300 bg-slate-900/95 scale-[1.02] shadow-2xl shadow-cyan-500/20' 
            : 'border-slate-700 bg-slate-900/70 hover:border-slate-500 hover:bg-slate-900/90'
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
        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
          <div className="flex flex-wrap gap-2">
            {room.code && (
              <span className="rounded-full border border-white/15 bg-slate-950/70 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-white/80">
                {room.code}
              </span>
            )}
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-slate-950/70 px-3 py-1 text-xs font-medium text-white/80">
              <ImageIcon size={14} />
              {imageLabel}
            </span>
          </div>
          {selected && (
            <div className="bg-cyan-300 text-slate-950 p-3 rounded-full shadow-xl">
              <Check size={22} />
            </div>
          )}
        </div>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950 via-slate-950/70 to-transparent px-5 pb-5 pt-20">
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.08] px-3 py-1 text-xs text-white/88">
              <Users size={14} />
              {guestLabel}
            </span>
            {categoryHighlights.map((category) => (
              <span
                key={category}
                className="rounded-full border border-white/15 bg-white/[0.08] px-3 py-1 text-xs text-white/78"
              >
                {category}
              </span>
            ))}
          </div>
        </div>
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
      </div>
      
      <div className="p-7">
        <div className="flex justify-between items-start gap-4 mb-3">
          <div>
            <h3 className="text-2xl font-semibold text-white">{room.name}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              {summary || 'Ask Siya to describe the stay, features, and best fit for this room.'}
            </p>
          </div>
          <div className="text-right">
            <span className="block text-2xl font-bold text-cyan-200">
              {pricePrefix}{room.price}
            </span>
            <span className="text-sm text-slate-400">/ night</span>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
            <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-cyan-300/12 text-cyan-100">
              <Users size={16} />
            </div>
            <p className="mt-3 text-xs uppercase tracking-[0.18em] text-white/45">Stay</p>
            <p className="mt-1 text-sm text-white">{guestLabel}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
            <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-cyan-300/12 text-cyan-100">
              <BedDouble size={16} />
            </div>
            <p className="mt-3 text-xs uppercase tracking-[0.18em] text-white/45">Fit</p>
            <p className="mt-1 text-sm text-white">{childLabel}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
            <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-cyan-300/12 text-cyan-100">
              <ShieldCheck size={16} />
            </div>
            <p className="mt-3 text-xs uppercase tracking-[0.18em] text-white/45">Flow</p>
            <p className="mt-1 text-sm text-white">Preview before booking</p>
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-white/45">
            <Sparkles size={14} />
            Room Highlights
          </div>
          <div className="flex flex-wrap gap-3">
            {featureHighlights.map((feature, i) => (
              <span key={i} className="px-3 py-2 bg-slate-700/70 text-slate-100 text-sm rounded-xl flex items-center gap-2 border border-white/8">
                <span className="w-1.5 h-1.5 bg-cyan-200 rounded-full"></span>
                {feature}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-white/8 bg-slate-950/45 px-4 py-3 text-sm text-slate-300">
          Say: "Tell me about {room.name}", "Show me the bedroom", or "I want another room".
        </div>
      </div>
    </div>
  );
};
