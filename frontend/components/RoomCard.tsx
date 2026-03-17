import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, ImageIcon, Sparkles, Users } from 'lucide-react';
import { optimizeCloudinaryUrl } from '../lib/cloudinary';
import type { RoomDTO, RoomImageDTO } from '../services/room.service';

interface RoomCardProps {
  room: RoomDTO;
  onSelect: (room: RoomDTO) => void;
  selected: boolean;
}

function formatPrice(room: RoomDTO): string {
  const currency = String(room.currency || 'INR').toUpperCase();
  const numericPrice = Number(room.price || 0);
  const amount = Number.isFinite(numericPrice) ? numericPrice.toLocaleString('en-IN') : String(room.price || '');
  return currency === 'INR' ? `INR ${amount}` : `${currency} ${amount}`;
}

function normalizeCaption(value: unknown): string {
  const raw = String(value || '').trim().replace(/[.]+$/g, '');
  if (!raw) return '';
  return raw.charAt(0).toLowerCase() + raw.slice(1);
}

function sortImages(images: RoomImageDTO[]): RoomImageDTO[] {
  return [...images].sort((a, b) => {
    if (Boolean(a.isPrimary) !== Boolean(b.isPrimary)) {
      return a.isPrimary ? -1 : 1;
    }

    const aOrder = typeof a.displayOrder === 'number' ? a.displayOrder : 999;
    const bOrder = typeof b.displayOrder === 'number' ? b.displayOrder : 999;
    return aOrder - bOrder;
  });
}

function describeImage(image: RoomImageDTO): string | null {
  const caption = normalizeCaption(image.caption);
  if (caption) return caption;

  const searchable = [
    String(image.category || ''),
    ...(Array.isArray(image.tags) ? image.tags.map((tag) => String(tag || '')) : []),
  ]
    .join(' ')
    .toLowerCase();

  if (searchable.includes('living') || searchable.includes('lounge') || searchable.includes('sofa') || searchable.includes('sitting')) {
    return 'a living area for relaxing';
  }
  if (searchable.includes('balcony') || searchable.includes('terrace')) {
    return 'a private balcony with seating';
  }
  if (searchable.includes('bathroom') || searchable.includes('bathtub') || searchable.includes('shower')) {
    return searchable.includes('bathtub') ? 'a private bathroom with a bathtub' : 'a private bathroom';
  }
  if (searchable.includes('bedroom') || searchable.includes('bed')) {
    return 'a comfortable bedroom';
  }
  if (searchable.includes('view') || searchable.includes('ocean')) {
    return 'a lovely view';
  }

  return null;
}

function humanizeFeature(featureLike: unknown): string {
  const feature = String(featureLike || '').trim();
  if (!feature) return '';

  const normalized = feature.toLowerCase();
  if (normalized === 'wifi') return 'Wi-Fi';
  if (normalized === 'tv') return 'TV';
  if (normalized === 'ac') return 'Air conditioning';
  if (normalized === 'hottub') return 'Hot tub';
  return feature;
}

function buildRoomNarrative(room: RoomDTO): { headline: string; details: string[]; amenities: string[] } {
  const sortedImages = sortImages(Array.isArray(room.images) ? room.images : []);
  const imageDetails = sortedImages
    .map((image) => describeImage(image))
    .filter((detail): detail is string => Boolean(detail));

  const uniqueDetails: string[] = [];
  const seenDetails = new Set<string>();
  for (const detail of imageDetails) {
    const key = detail.toLowerCase();
    if (seenDetails.has(key)) continue;
    seenDetails.add(key);
    uniqueDetails.push(detail);
  }

  const details = uniqueDetails.slice(0, 3);
  const narrativeLead = details.length > 0
    ? details
    : ['a comfortable stay with thoughtfully designed interiors'];

  const featureAmenities: string[] = [];
  const seenAmenities = new Set<string>();
  for (const feature of Array.isArray(room.features) ? room.features : []) {
    const label = humanizeFeature(feature);
    const key = label.toLowerCase();
    if (!label || seenAmenities.has(key)) continue;
    if (
      (key === 'bathtub' && details.some((detail) => detail.toLowerCase().includes('bathtub'))) ||
      (key === 'fireplace' && details.some((detail) => detail.toLowerCase().includes('fireplace')))
    ) {
      continue;
    }
    seenAmenities.add(key);
    featureAmenities.push(label);
  }

  const capacityText = room.maxAdults
    ? `for up to ${room.maxAdults} guest${room.maxAdults === 1 ? '' : 's'}`
    : 'for a comfortable stay';
  const headline = `A welcoming room ${capacityText}, with ${narrativeLead.join(', ')}.`;

  return {
    headline,
    details,
    amenities: featureAmenities.slice(0, 5),
  };
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
      .map((url) => String(url || '').trim())
      .filter(Boolean)
      .map((rawUrl) => ({
        rawUrl,
        optimizedUrl: optimizeCloudinaryUrl(rawUrl),
      }));
  }, [room.image, room.imageUrls]);

  const narrative = useMemo(() => buildRoomNarrative(room), [room]);
  const imageCount = imageEntries.length;
  const currentEntry = imageEntries[activeImageIndex];
  const currentImageSrc = currentEntry
    ? (failedOptimizedIndexes[activeImageIndex] ? currentEntry.rawUrl : currentEntry.optimizedUrl)
    : '';
  const selectedImageCaption = useMemo(() => {
    const images = sortImages(Array.isArray(room.images) ? room.images : []);
    return normalizeCaption(images[activeImageIndex]?.caption);
  }, [activeImageIndex, room.images]);

  useEffect(() => {
    setActiveImageIndex(0);
    setFailedOptimizedIndexes({});
  }, [room.id]);

  useEffect(() => {
    if (activeImageIndex >= imageEntries.length) {
      setActiveImageIndex(0);
    }
  }, [activeImageIndex, imageEntries.length]);

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

  const guestsLine = room.maxAdults
    ? `${room.maxAdults} guest${room.maxAdults === 1 ? '' : 's'}`
    : 'Flexible stay';
  const supportLine = typeof room.maxChildren === 'number'
    ? `${room.maxChildren} child${room.maxChildren === 1 ? '' : 'ren'}`
    : 'Room details ready';

  return (
    <button
      type="button"
      onClick={() => onSelect(room)}
      className={`group relative overflow-hidden rounded-[2rem] border text-left transition-all duration-300 ${
        selected
          ? 'border-amber-200/80 bg-slate-950/95 shadow-[0_26px_70px_rgba(250,204,21,0.16)]'
          : 'border-white/10 bg-slate-950/72 hover:border-sky-200/35 hover:bg-slate-950/88'
      }`}
    >
      <div
        className="relative aspect-[16/10] sm:aspect-[16/9] overflow-hidden"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {currentImageSrc ? (
          <img
            src={currentImageSrc}
            alt={room.name}
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
            onError={() => {
              const entry = imageEntries[activeImageIndex];
              if (!entry) return;

              const isUsingOptimized = !failedOptimizedIndexes[activeImageIndex] && entry.optimizedUrl !== entry.rawUrl;
              if (isUsingOptimized) {
                setFailedOptimizedIndexes((prev) => ({ ...prev, [activeImageIndex]: true }));
              }
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-slate-800 text-sm text-slate-300">
            No image available
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/12 to-transparent" />

        <div className="absolute inset-x-0 top-0 flex items-start justify-between p-5">
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-white/15 bg-slate-950/65 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-white/85">
              {guestsLine}
            </span>
            {imageCount > 1 && (
              <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-slate-950/65 px-3 py-1 text-[11px] text-white/78">
                <ImageIcon size={13} />
                {imageCount} photos
              </span>
            )}
          </div>
          {selected && (
            <span className="inline-flex items-center gap-2 rounded-full bg-amber-200 px-3 py-2 text-xs font-semibold text-slate-950 shadow-lg">
              <Check size={15} />
              Selected
            </span>
          )}
        </div>

        <div className="absolute inset-x-0 bottom-0 p-4 md:p-5">
          <div className="max-w-[90%] sm:max-w-[85%] rounded-xl md:rounded-2xl border border-white/10 bg-slate-950/58 px-3 py-2 md:px-4 md:py-3 backdrop-blur-sm">
            <p className="text-[10px] uppercase tracking-[0.22em] text-amber-100/70">Room Snapshot</p>
            <p className="mt-1 md:mt-2 text-xs md:text-sm leading-relaxed md:leading-6 text-white/92">
              {selectedImageCaption || narrative.details[0] || narrative.headline}
            </p>
          </div>
        </div>

        {imageEntries.length > 1 && (
          <>
            <button
              type="button"
              onClick={goToPreviousImage}
              className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full border border-white/15 bg-slate-950/55 p-3 text-white transition-colors hover:bg-slate-950/72"
              aria-label="Previous room image"
            >
              <ChevronLeft size={20} />
            </button>
            <button
              type="button"
              onClick={goToNextImage}
              className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full border border-white/15 bg-slate-950/55 p-3 text-white transition-colors hover:bg-slate-950/72"
              aria-label="Next room image"
            >
              <ChevronRight size={20} />
            </button>
            <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2">
              {imageEntries.map((_, index) => (
                <span
                  key={index}
                  className={`rounded-full transition-all ${
                    index === activeImageIndex ? 'h-2 w-7 bg-white' : 'h-2 w-2 bg-white/45'
                  }`}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <div className="space-y-6 px-6 pb-6 pt-5">
        <div className="flex flex-col sm:flex-row items-start justify-between gap-4 md:gap-5">
          <div className="space-y-1 md:space-y-2">
            <h3 className="text-2xl md:text-[1.9rem] font-semibold tracking-[-0.03em] text-white leading-tight">{room.name}</h3>
            <p className="max-w-xl text-sm md:text-[15px] leading-relaxed md:leading-7 text-slate-300">
              {narrative.headline}
            </p>
          </div>
          <div className="rounded-xl md:rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left sm:text-right w-full sm:w-auto">
            <p className="text-[10px] md:text-xs uppercase tracking-[0.22em] text-white/45">From</p>
            <p className="mt-1 text-2xl md:text-[1.9rem] font-semibold tracking-[-0.04em] text-cyan-200">{formatPrice(room)}</p>
            <p className="text-xs md:text-sm text-slate-400">per night</p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.035] px-5 py-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-white/45">
              <Sparkles size={13} />
              Inside The Room
            </div>
            <div className="mt-4 space-y-3">
              {narrative.details.length > 0 ? narrative.details.map((detail) => (
                <p key={detail} className="text-sm leading-6 text-white/88">
                  {detail.charAt(0).toUpperCase() + detail.slice(1)}
                </p>
              )) : (
                <p className="text-sm leading-6 text-white/78">Room details will appear here as soon as the inventory finishes loading.</p>
              )}
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.035] px-5 py-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-white/45">
              <Users size={13} />
              Stay Details
            </div>
            <div className="mt-4 space-y-3 text-sm text-white/88">
              <p>Ideal for {guestsLine.toLowerCase()}.</p>
              <p>{typeof room.maxChildren === 'number' ? `Children: ${supportLine.toLowerCase()}.` : supportLine}.</p>
              {room.code && <p className="text-white/62">Category: {room.code}</p>}
            </div>
          </div>
        </div>

        {narrative.amenities.length > 0 && (
          <div>
            <div className="mb-3 text-xs uppercase tracking-[0.22em] text-white/45">Included Comforts</div>
            <div className="flex flex-wrap gap-2.5">
              {narrative.amenities.map((feature) => (
                <span
                  key={feature}
                  className="rounded-full border border-sky-200/20 bg-sky-300/10 px-3 py-2 text-sm text-sky-50"
                >
                  {feature}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-4 rounded-[1.4rem] border border-white/10 bg-slate-900/78 px-4 py-4">
          <div>
            <p className="text-sm font-medium text-white">{selected ? 'This room is selected' : 'Tap to select this room'}</p>
            <p className="mt-1 text-sm text-slate-400">
              {selected ? 'Continue below when this feels right for the guest.' : 'You can still ask Siya to describe another room before continuing.'}
            </p>
          </div>
          <div className={`rounded-full px-4 py-2 text-sm font-semibold ${selected ? 'bg-amber-200 text-slate-950' : 'bg-white/8 text-white/88'}`}>
            {selected ? 'Selected' : 'Choose Room'}
          </div>
        </div>
      </div>
    </button>
  );
};
