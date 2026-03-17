import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Bath, BedDouble, CheckCircle2, ChevronLeft, ChevronRight, Expand, ImageIcon, Sparkles, View } from 'lucide-react';
import AnimatedGradientBackground from '../components/ui/animated-gradient-background';
import { ProgressBar } from '../components/ProgressBar';
import { useUIState } from '../state/uiContext';
import { optimizeCloudinaryUrl } from '../lib/cloudinary';
import type { RoomDTO, RoomImageDTO } from '../services/room.service';

type PreviewImage = {
  id: string;
  src: string;
  title: string;
  description: string;
  category: string;
};

function humanize(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw
    .split(/[-_]+/)
    .filter(Boolean)
    .map((token, index) => {
      const lowered = token.toLowerCase();
      return index === 0 ? lowered.charAt(0).toUpperCase() + lowered.slice(1) : lowered;
    })
    .join(' ');
}

function buildImageDescription(image: RoomImageDTO): string {
  const tags = Array.isArray(image.tags)
    ? image.tags.map((tag) => humanize(tag)).filter(Boolean)
    : [];
  if (tags.length > 0) return tags.slice(0, 5).join(' | ');
  if (image.caption) return String(image.caption).trim();
  return humanize(image.category) || 'Room preview';
}

function buildPreviewImages(room: RoomDTO | null): PreviewImage[] {
  if (!room) return [];

  if (Array.isArray(room.images) && room.images.length > 0) {
    return room.images
      .map((image, index) => {
        const src = String(image.url || '').trim();
        if (!src) return null;
        const fallbackTitle = index === 0 ? room.name : `${room.name} ${index + 1}`;
        return {
          id: String(image.id || `${room.id}-${index}`),
          src,
          title: humanize(image.category) || String(image.caption || '').trim() || fallbackTitle,
          description: buildImageDescription(image),
          category: humanize(image.category) || 'Room view',
        } satisfies PreviewImage;
      })
      .filter((image): image is PreviewImage => Boolean(image));
  }

  const rawUrls = Array.isArray(room.imageUrls) && room.imageUrls.length > 0
    ? room.imageUrls
    : [room.image];

  return Array.from(new Set(rawUrls.map((url) => String(url || '').trim()).filter(Boolean))).map((src, index) => ({
    id: `${room.id}-${index}`,
    src,
    title: index === 0 ? room.name : `${room.name} ${index + 1}`,
    description: `Preview ${index + 1} of ${room.name}`,
    category: 'Room view',
  }));
}

function resolveSelectedRoom(data: any): RoomDTO | null {
  const selectedRoom = data?.selectedRoom || null;
  const rooms = Array.isArray(data?.rooms) ? data.rooms : [];
  if (selectedRoom?.id) {
    return rooms.find((room: RoomDTO) => room.id === selectedRoom.id) || selectedRoom;
  }

  const selectedLabel = String(
    selectedRoom?.displayName ||
    selectedRoom?.name ||
    data?.bookingSlots?.roomType ||
    ''
  ).trim().toLowerCase();

  if (!selectedLabel) return null;
  return rooms.find((room: RoomDTO) => String(room.name || '').trim().toLowerCase() === selectedLabel) || selectedRoom || null;
}

function getRoomNarrative(room: RoomDTO | null): string {
  if (!room) return 'Choose a room to continue.';
  const features = Array.isArray(room.features) ? room.features.filter(Boolean).slice(0, 3) : [];
  const featureLine = features.length > 0 ? features.join(', ') : 'curated room features';
  return `${room.name} is a polished, guest-ready option with ${featureLine}. Ask to see a specific part of the room or say yes when you want to continue with it.`;
}

export const RoomPreviewPage: React.FC = () => {
  const { data, emit } = useUIState();
  const room = resolveSelectedRoom(data);
  const images = useMemo(() => buildPreviewImages(room), [room]);
  const focusImageId = String(data?.visualFocus?.imageId || '').trim() || null;
  const [activeImageId, setActiveImageId] = useState<string | null>(images[0]?.id || null);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    setActiveImageId(images[0]?.id || null);
  }, [room?.id, images]);

  useEffect(() => {
    if (!focusImageId) return;
    const match = images.find((image) => image.id === focusImageId);
    if (!match) return;
    setActiveImageId(match.id);
    setIsExpanded(true);
  }, [focusImageId, images]);

  const activeIndex = Math.max(0, images.findIndex((image) => image.id === activeImageId));
  const activeImage = images[activeIndex] || null;
  const progress = data?.progress || { currentStep: 2, totalSteps: 4, steps: ['ID Scan', 'Room', 'Payment', 'Key'] };
  const priceLabel = room ? `${room.currency === 'USD' ? '$' : room.currency} ${Number(room.price || 0).toLocaleString()}` : '';
  const capacityLabel = room
    ? [
        typeof room.maxAdults === 'number' ? `${room.maxAdults} adults` : null,
        typeof room.maxChildren === 'number' ? `${room.maxChildren} children` : null,
        typeof room.maxTotalGuests === 'number' ? `${room.maxTotalGuests} total` : null,
      ].filter(Boolean).join(' | ')
    : '';
  const featurePills = Array.isArray(room?.features) ? room.features.filter(Boolean).slice(0, 6) : [];

  const quickAsks = [
    { icon: <BedDouble size={16} />, label: 'Show bedroom' },
    { icon: <View size={16} />, label: 'Show balcony' },
    { icon: <Bath size={16} />, label: 'Show bathroom' },
    { icon: <Sparkles size={16} />, label: 'Show another room' },
  ];

  const showPrevious = () => {
    if (images.length <= 1) return;
    const nextIndex = (activeIndex - 1 + images.length) % images.length;
    setActiveImageId(images[nextIndex].id);
  };

  const showNext = () => {
    if (images.length <= 1) return;
    const nextIndex = (activeIndex + 1) % images.length;
    setActiveImageId(images[nextIndex].id);
  };

  return (
    <div className="relative h-screen w-full overflow-hidden text-white">
      <AnimatedGradientBackground Breathing={true} />
      <div className="relative z-10 flex h-full w-full flex-col p-10">
        <ProgressBar
          currentStep={progress.currentStep}
          totalSteps={progress.totalSteps}
          labels={progress.steps}
        />

        <div className="mx-auto grid h-full w-full max-w-7xl gap-6 xl:grid-cols-[minmax(0,1.45fr)_400px]">
          <section className="flex min-h-0 flex-col overflow-hidden rounded-[34px] border border-white/10 bg-slate-950/60 shadow-2xl shadow-black/25 backdrop-blur-md">
            <div className="flex items-start justify-between gap-6 border-b border-white/8 px-8 pb-6 pt-7">
              <div className="max-w-3xl">
                <p className="text-xs uppercase tracking-[0.35em] text-cyan-200/75">Voice-First Preview</p>
                <h1 className="mt-3 text-5xl font-light leading-tight text-white">
                  {room?.name || 'Room preview'}
                </h1>
                <p className="mt-4 max-w-2xl text-base leading-7 text-white/68">
                  {getRoomNarrative(room)}
                </p>
              </div>

              <div className="rounded-[28px] border border-cyan-300/20 bg-cyan-400/10 px-5 py-4 text-right">
                <p className="text-xs uppercase tracking-[0.28em] text-cyan-100/70">Preview Mode</p>
                <p className="mt-2 text-sm leading-6 text-white/72">
                  Ask about features, switch rooms by voice, or say yes when you want to open booking.
                </p>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 gap-6 px-8 py-7 lg:grid-cols-[minmax(0,1fr)_260px]">
              <div className="flex min-h-0 flex-col">
                <div className="relative flex min-h-0 flex-1 overflow-hidden rounded-[30px] border border-white/10 bg-slate-900/75">
                  {activeImage ? (
                    <>
                      <img
                        src={optimizeCloudinaryUrl(activeImage.src)}
                        alt={activeImage.title}
                        className="h-full w-full object-cover"
                      />
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950 via-slate-950/70 to-transparent px-7 pb-7 pt-20">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="text-xs uppercase tracking-[0.3em] text-cyan-200/75">{activeImage.category}</p>
                            <h2 className="mt-2 text-3xl font-medium text-white">{activeImage.title}</h2>
                            <p className="mt-2 max-w-3xl text-sm leading-6 text-white/72">{activeImage.description}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setIsExpanded(true)}
                            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/6 px-4 py-2 text-sm text-white/78 transition hover:bg-white/12 hover:text-white"
                          >
                            <Expand size={16} />
                            Enlarge
                          </button>
                        </div>
                      </div>

                      {images.length > 1 && (
                        <>
                          <button
                            type="button"
                            onClick={showPrevious}
                            className="absolute left-5 top-1/2 -translate-y-1/2 rounded-full border border-white/15 bg-black/35 p-3 text-white transition hover:bg-black/55"
                            aria-label="Previous preview image"
                          >
                            <ChevronLeft size={20} />
                          </button>
                          <button
                            type="button"
                            onClick={showNext}
                            className="absolute right-5 top-1/2 -translate-y-1/2 rounded-full border border-white/15 bg-black/35 p-3 text-white transition hover:bg-black/55"
                            aria-label="Next preview image"
                          >
                            <ChevronRight size={20} />
                          </button>
                        </>
                      )}
                    </>
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-center text-white/55">
                      <ImageIcon size={42} />
                      <p className="text-lg">No preview images are available for this room yet.</p>
                    </div>
                  )}
                </div>

                <div className="mt-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
                  {quickAsks.map((item) => (
                    <div
                      key={item.label}
                      className="rounded-[24px] border border-white/8 bg-white/[0.03] px-4 py-4 text-sm text-white/74"
                    >
                      <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-cyan-400/12 text-cyan-100">
                        {item.icon}
                      </div>
                      <p className="mt-3 leading-6">{item.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              <aside className="flex min-h-0 flex-col gap-5">
                <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
                  <p className="text-xs uppercase tracking-[0.32em] text-white/45">Stay Snapshot</p>
                  <p className="mt-4 text-4xl font-light text-white">{priceLabel || '--'}</p>
                  <p className="mt-1 text-sm text-white/48">per night</p>
                  {capacityLabel && (
                    <p className="mt-4 text-sm leading-6 text-white/62">{capacityLabel}</p>
                  )}
                </div>

                <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
                  <p className="text-xs uppercase tracking-[0.32em] text-white/45">Room Highlights</p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    {featurePills.length > 0 ? featurePills.map((feature, index) => (
                      <span
                        key={`${feature}-${index}`}
                        className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm text-white/78"
                      >
                        {feature}
                      </span>
                    )) : (
                      <p className="text-sm text-white/52">Ask Siya to describe the room features.</p>
                    )}
                  </div>
                </div>

                <div className="rounded-[28px] border border-white/10 bg-slate-900/78 p-4">
                  <p className="text-xs uppercase tracking-[0.32em] text-white/45">Gallery</p>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    {images.slice(0, 6).map((image) => (
                      <button
                        key={image.id}
                        type="button"
                        onClick={() => setActiveImageId(image.id)}
                        className={`overflow-hidden rounded-[20px] border transition ${image.id === activeImage?.id ? 'border-cyan-300/80 ring-2 ring-cyan-300/25' : 'border-white/10 hover:border-white/30'}`}
                      >
                        <div className="aspect-[4/3] overflow-hidden bg-slate-950">
                          <img
                            src={optimizeCloudinaryUrl(image.src)}
                            alt={image.title}
                            className="h-full w-full object-cover transition duration-500 hover:scale-105"
                          />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-auto grid gap-3">
                  <button
                    type="button"
                    onClick={() => emit('CONFIRM_BOOKING')}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-cyan-300 px-5 py-4 text-base font-medium text-slate-950 transition hover:bg-cyan-200"
                  >
                    <CheckCircle2 size={18} />
                    Yes, continue with this room
                  </button>
                  <button
                    type="button"
                    onClick={() => emit('BACK_REQUESTED')}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.05] px-5 py-4 text-base text-white/82 transition hover:bg-white/[0.09] hover:text-white"
                  >
                    <ArrowLeft size={18} />
                    Show other rooms
                  </button>
                </div>
              </aside>
            </div>
          </section>

          <aside className="flex min-h-0 flex-col gap-6 rounded-[34px] border border-white/10 bg-slate-950/62 p-7 shadow-2xl shadow-black/25 backdrop-blur-md">
            <div className="rounded-[28px] border border-amber-300/15 bg-amber-400/8 p-5">
              <p className="text-xs uppercase tracking-[0.32em] text-amber-100/70">Siya Concierge</p>
              <p className="mt-3 text-sm leading-7 text-white/74">
                The preview stays voice-first. The guest can explore room features, ask for specific visuals, or switch to another room before the booking form opens.
              </p>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
              <p className="text-xs uppercase tracking-[0.32em] text-white/45">Recommended Voice Prompts</p>
              <div className="mt-4 space-y-3 text-sm text-white/74">
                <p>"Tell me about this room"</p>
                <p>"Show me the balcony"</p>
                <p>"I want to see another room"</p>
                <p>"Yes, I want this room"</p>
              </div>
            </div>

            <div className="flex-1 rounded-[28px] border border-white/10 bg-gradient-to-br from-cyan-400/10 via-white/[0.03] to-transparent p-5">
              <p className="text-xs uppercase tracking-[0.32em] text-white/45">Current Focus</p>
              {activeImage ? (
                <>
                  <p className="mt-4 text-2xl font-light text-white">{activeImage.title}</p>
                  <p className="mt-3 text-sm leading-7 text-white/70">{activeImage.description}</p>
                  <p className="mt-5 inline-flex rounded-full border border-cyan-300/25 bg-cyan-400/10 px-4 py-2 text-xs uppercase tracking-[0.26em] text-cyan-100/78">
                    {focusImageId ? 'AI-focused visual' : 'Guest preview visual'}
                  </p>
                </>
              ) : (
                <p className="mt-4 text-sm leading-7 text-white/58">Ask Siya to focus on a part of the room, such as the bathroom, balcony, or bedroom.</p>
              )}
            </div>
          </aside>
        </div>
      </div>

      {isExpanded && activeImage && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/94 p-10">
          <button
            type="button"
            onClick={() => setIsExpanded(false)}
            className="absolute right-8 top-8 rounded-full border border-white/15 bg-white/[0.05] px-4 py-2 text-sm text-white/78 transition hover:bg-white/[0.1] hover:text-white"
          >
            Close
          </button>
          <div className="grid h-full w-full max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="overflow-hidden rounded-[34px] border border-white/10 bg-slate-900">
              <img
                src={optimizeCloudinaryUrl(activeImage.src)}
                alt={activeImage.title}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="flex flex-col rounded-[34px] border border-white/10 bg-slate-900/82 p-6">
              <p className="text-xs uppercase tracking-[0.32em] text-cyan-200/75">{activeImage.category}</p>
              <h2 className="mt-3 text-3xl font-light text-white">{activeImage.title}</h2>
              <p className="mt-4 text-sm leading-7 text-white/72">{activeImage.description}</p>
              {images.length > 1 && (
                <div className="mt-6 grid grid-cols-2 gap-3">
                  {images.map((image) => (
                    <button
                      key={image.id}
                      type="button"
                      onClick={() => setActiveImageId(image.id)}
                      className={`overflow-hidden rounded-[20px] border transition ${image.id === activeImage.id ? 'border-cyan-300/80 ring-2 ring-cyan-300/25' : 'border-white/10 hover:border-white/30'}`}
                    >
                      <div className="aspect-[4/3] overflow-hidden bg-slate-950">
                        <img
                          src={optimizeCloudinaryUrl(image.src)}
                          alt={image.title}
                          className="h-full w-full object-cover"
                        />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
