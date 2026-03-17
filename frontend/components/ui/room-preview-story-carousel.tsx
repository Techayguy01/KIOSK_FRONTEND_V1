"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Bath,
  BedDouble,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Expand,
  Flame,
  ImageIcon,
  Sparkles,
  Tv,
  Users,
  View,
  Wifi,
} from "lucide-react";
import type { RoomDTO } from "../../services/room.service";
import { optimizeCloudinaryUrl } from "../../lib/cloudinary";
import { cn } from "../../lib/utils";

export type RoomPreviewVisual = {
  id: string;
  src: string;
  title: string;
  description: string;
  category: string;
};

type RoomPreviewStoryCarouselProps = {
  room: RoomDTO | null;
  visuals: RoomPreviewVisual[];
  narrative: string;
  focusImageId?: string | null;
  voicePrompts: string[];
  onConfirm: () => void;
  onBack: () => void;
};

const AUTO_PLAY_INTERVAL = 4200;
const ITEM_HEIGHT = 76;

const wrapIndex = (min: number, max: number, value: number) => {
  const range = max - min;
  return ((((value - min) % range) + range) % range) + min;
};

function formatRoomPrice(room: RoomDTO | null): string {
  if (!room) return "--";

  const amount = Number(room.price || 0);
  const formattedAmount = Number.isFinite(amount)
    ? amount.toLocaleString("en-IN")
    : String(room.price || "");
  const currency = String(room.currency || "INR").trim().toUpperCase();

  if (currency === "USD") return `$${formattedAmount}`;
  return `${currency} ${formattedAmount}`;
}

function getGuestLabel(room: RoomDTO | null): string {
  if (!room) return "Guest stay";
  if (typeof room.maxAdults === "number" && room.maxAdults > 0) {
    return `${room.maxAdults} guest${room.maxAdults > 1 ? "s" : ""}`;
  }
  if (typeof room.maxTotalGuests === "number" && room.maxTotalGuests > 0) {
    return `${room.maxTotalGuests} guests`;
  }
  return "Guest stay";
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function featureIcon(feature: string) {
  const normalized = normalizeToken(feature);
  if (normalized.includes("wifi")) return Wifi;
  if (normalized.includes("tv")) return Tv;
  if (normalized.includes("bath")) return Bath;
  if (normalized.includes("fire")) return Flame;
  if (normalized.includes("view") || normalized.includes("balcony")) return View;
  return Sparkles;
}

function categoryIcon(category: string) {
  const normalized = normalizeToken(category);
  if (normalized.includes("bed")) return BedDouble;
  if (normalized.includes("bath")) return Bath;
  if (normalized.includes("balcony") || normalized.includes("view")) return View;
  return ImageIcon;
}

function buildRoomSpaces(visuals: RoomPreviewVisual[]): string[] {
  return Array.from(
    new Set(
      visuals
        .map((visual) => String(visual.category || visual.title || "").trim())
        .filter(Boolean)
    )
  ).slice(0, 4);
}

function buildComforts(room: RoomDTO | null): string[] {
  if (!room || !Array.isArray(room.features)) return [];
  return room.features.filter(Boolean).slice(0, 4);
}

export function RoomPreviewStoryCarousel({
  room,
  visuals,
  narrative,
  focusImageId,
  voicePrompts,
  onConfirm,
  onBack,
}: RoomPreviewStoryCarouselProps) {
  const [step, setStep] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    setStep(0);
  }, [room?.id]);

  useEffect(() => {
    if (!focusImageId) return;
    const index = visuals.findIndex((visual) => visual.id === focusImageId);
    if (index >= 0) setStep(index);
  }, [focusImageId, visuals]);

  useEffect(() => {
    if (visuals.length <= 1 || isPaused || focusImageId) return undefined;
    const interval = window.setInterval(() => {
      setStep((current) => current + 1);
    }, AUTO_PLAY_INTERVAL);
    return () => window.clearInterval(interval);
  }, [focusImageId, isPaused, visuals.length]);

  const currentIndex = visuals.length > 0
    ? ((step % visuals.length) + visuals.length) % visuals.length
    : 0;
  const activeVisual = visuals[currentIndex] || null;
  const roomSpaces = useMemo(() => buildRoomSpaces(visuals), [visuals]);
  const comforts = useMemo(() => buildComforts(room), [room]);

  const showPrevious = () => {
    if (visuals.length <= 1) return;
    setStep((current) => current - 1);
  };

  const showNext = () => {
    if (visuals.length <= 1) return;
    setStep((current) => current + 1);
  };

  const handleRailSelect = (index: number) => {
    setStep(index);
    setIsPaused(true);
  };

  return (
    <>
      <div className="relative overflow-hidden rounded-[38px] border border-white/12 bg-slate-950/68 shadow-[0_30px_120px_rgba(15,23,42,0.45)] backdrop-blur-md">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-y-0 left-0 w-1/3 bg-[radial-gradient(circle_at_top_left,rgba(103,232,249,0.18),transparent_62%)]" />
          <div className="absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.18),transparent_58%)]" />
        </div>

        <div className="relative grid min-h-0 lg:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="flex flex-col border-b border-white/10 p-6 lg:border-b-0 lg:border-r">
            <div>
              <p className="text-xs uppercase tracking-[0.34em] text-cyan-100/70">Room Story</p>
              <h1 className="mt-4 text-4xl font-light tracking-[-0.04em] text-white">
                {room?.name || "Room preview"}
              </h1>
              <p className="mt-4 text-sm leading-7 text-white/68">
                {narrative}
              </p>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <div className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2">
                <p className="text-[11px] uppercase tracking-[0.24em] text-white/45">Nightly rate</p>
                <p className="mt-1 text-lg text-white">{formatRoomPrice(room)}</p>
              </div>
              <div className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2">
                <p className="text-[11px] uppercase tracking-[0.24em] text-white/45">Best for</p>
                <p className="mt-1 text-lg text-white">{getGuestLabel(room)}</p>
              </div>
            </div>

            <div
              className="relative mt-8 min-h-[360px] flex-1 overflow-hidden hidden lg:block"
              onMouseEnter={() => setIsPaused(true)}
              onMouseLeave={() => setIsPaused(false)}
            >
              {visuals.length > 0 ? visuals.map((visual, index) => {
                const isActive = index === currentIndex;
                const distance = index - currentIndex;
                const wrappedDistance = wrapIndex(-(visuals.length / 2), visuals.length / 2, distance);
                const Icon = categoryIcon(visual.category || visual.title);

                return (
                  <motion.div
                    key={visual.id}
                    style={{ height: ITEM_HEIGHT }}
                    animate={{
                      y: wrappedDistance * ITEM_HEIGHT,
                      opacity: 1 - Math.min(Math.abs(wrappedDistance) * 0.22, 0.72),
                      scale: isActive ? 1 : 0.94,
                    }}
                    transition={{ type: "spring", stiffness: 110, damping: 20, mass: 0.85 }}
                    className="absolute left-0 right-0"
                  >
                    <button
                      type="button"
                      onClick={() => handleRailSelect(index)}
                      className={cn(
                        "group flex w-full items-center gap-4 rounded-full border px-5 py-4 text-left transition-all duration-500",
                        isActive
                          ? "border-cyan-200/55 bg-cyan-300/12 text-white shadow-[0_0_0_1px_rgba(165,243,252,0.1)]"
                          : "border-white/10 bg-white/[0.03] text-white/62 hover:border-white/25 hover:text-white"
                      )}
                    >
                      <div className={cn(
                        "flex h-10 w-10 items-center justify-center rounded-full border transition-colors",
                        isActive
                          ? "border-cyan-200/50 bg-cyan-200/18 text-cyan-50"
                          : "border-white/10 bg-white/[0.04] text-white/50"
                      )}>
                        <Icon size={17} />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm uppercase tracking-[0.24em] text-white/42">
                          {visual.category || "Room view"}
                        </p>
                        <p className="mt-1 truncate text-base text-inherit">
                          {visual.title}
                        </p>
                      </div>
                    </button>
                  </motion.div>
                );
              }) : (
                <div className="flex h-full items-center justify-center rounded-[28px] border border-dashed border-white/12 bg-white/[0.02] text-center text-white/52">
                  <div>
                    <ImageIcon className="mx-auto" size={30} />
                    <p className="mt-3 text-sm">Room visuals will appear here.</p>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-8 grid gap-4">
              <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
                <p className="text-xs uppercase tracking-[0.3em] text-white/45">Inside the room</p>
                <div className="mt-4 flex flex-wrap gap-2.5">
                  {roomSpaces.length > 0 ? roomSpaces.map((space) => {
                    const Icon = categoryIcon(space);
                    return (
                      <span
                        key={space}
                        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/55 px-3 py-2 text-sm text-white/82"
                      >
                        <Icon size={15} />
                        {space}
                      </span>
                    );
                  }) : (
                    <span className="text-sm text-white/56">Bedroom, balcony, bathroom, and more will appear from the room gallery.</span>
                  )}
                </div>
              </div>

              <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
                <p className="text-xs uppercase tracking-[0.3em] text-white/45">Try saying</p>
                <div className="mt-4 space-y-2.5">
                  {voicePrompts.map((prompt) => (
                    <p key={prompt} className="text-sm leading-6 text-white/74">
                      "{prompt}"
                    </p>
                  ))}
                </div>
              </div>
            </div>
          </aside>

          <section className="flex flex-col p-6 lg:p-8">
            <div className="relative flex-1 overflow-hidden rounded-[34px] border border-white/10 bg-slate-900/82">
              {activeVisual ? (
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeVisual.id}
                    initial={{ opacity: 0, scale: 1.05 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                    className="absolute inset-0"
                  >
                    <img
                      src={optimizeCloudinaryUrl(activeVisual.src)}
                      alt={activeVisual.title}
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/38 to-slate-950/10" />
                  </motion.div>
                </AnimatePresence>
              ) : (
                <div className="flex h-full min-h-[520px] items-center justify-center text-center text-white/55">
                  <div>
                    <ImageIcon className="mx-auto" size={42} />
                    <p className="mt-4 text-lg">No preview images are available for this room yet.</p>
                  </div>
                </div>
              )}

              <div className="absolute left-4 top-4 right-4 md:left-6 md:top-6 md:right-6 flex items-start justify-between gap-4">
                <div className="rounded-full border border-white/10 bg-black/28 px-3 py-1.5 md:px-4 md:py-2 backdrop-blur-md">
                  <p className="text-[10px] md:text-[11px] uppercase tracking-[0.3em] text-cyan-100/72">
                    {activeVisual ? `${currentIndex + 1} of ${visuals.length}` : "Room preview"}
                  </p>
                </div>
                <div className="rounded-xl md:rounded-[24px] border border-white/10 bg-black/28 px-3 py-2 md:px-4 md:py-3 text-right backdrop-blur-md">
                  <p className="text-[10px] uppercase tracking-[0.28em] text-white/45">Guest snapshot</p>
                  <p className="mt-1 text-xl md:text-2xl font-light text-white">{formatRoomPrice(room)}</p>
                  <p className="mt-1 text-xs md:text-sm text-white/62">{getGuestLabel(room)}</p>
                </div>
              </div>

              <div className="absolute inset-x-0 bottom-0 p-6 lg:p-8">
                <div className="flex flex-col gap-5 rounded-[28px] border border-white/10 bg-slate-950/58 p-6 backdrop-blur-md">
                <div className="flex flex-col md:flex-row items-start justify-between gap-4">
                  <div className="flex-1">
                    <p className="text-[10px] md:text-xs uppercase tracking-[0.28em] text-cyan-100/75">
                      {activeVisual?.category || "Room view"}
                    </p>
                    <h2 className="mt-2 md:mt-3 text-2xl md:text-3xl font-medium tracking-[-0.03em] text-white leading-tight">
                      {activeVisual?.title || room?.name || "Room preview"}
                    </h2>
                    <p className="mt-2 md:mt-3 max-w-3xl text-sm leading-relaxed md:leading-7 text-white/72">
                      {activeVisual?.description || narrative}
                    </p>
                  </div>
                    {activeVisual && (
                      <button
                        type="button"
                        onClick={() => setIsExpanded(true)}
                        className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.05] px-4 py-2 text-sm text-white/82 transition hover:bg-white/[0.11]"
                      >
                        <Expand size={15} />
                        Open full view
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2.5">
                    {comforts.length > 0 ? comforts.map((feature) => {
                      const Icon = featureIcon(feature);
                      return (
                        <span
                          key={feature}
                          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm text-white/82"
                        >
                          <Icon size={14} />
                          {feature}
                        </span>
                      );
                    }) : (
                      <span className="text-sm text-white/56">Comfort details will appear as amenities are added to this room.</span>
                    )}
                  </div>
                </div>
              </div>

              {visuals.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={showPrevious}
                    className="absolute left-6 top-1/2 inline-flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/12 bg-black/35 text-white transition hover:bg-black/55"
                    aria-label="Previous room visual"
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <button
                    type="button"
                    onClick={showNext}
                    className="absolute right-6 top-1/2 inline-flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/12 bg-black/35 text-white transition hover:bg-black/55"
                    aria-label="Next room visual"
                  >
                    <ChevronRight size={20} />
                  </button>
                </>
              )}
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="rounded-[30px] border border-white/10 bg-white/[0.04] p-5">
                <p className="text-xs uppercase tracking-[0.3em] text-white/45">Room comforts</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[22px] border border-white/10 bg-slate-950/55 p-4">
                    <p className="text-[11px] uppercase tracking-[0.26em] text-white/42">Included</p>
                    <p className="mt-2 text-base leading-7 text-white/78">
                      {comforts.length > 0 ? comforts.join(", ") : "Comfort details are still being prepared."}
                    </p>
                  </div>
                  <div className="rounded-[22px] border border-white/10 bg-slate-950/55 p-4">
                    <p className="text-[11px] uppercase tracking-[0.26em] text-white/42">Explore visually</p>
                    <p className="mt-2 text-base leading-7 text-white/78">
                      {roomSpaces.length > 0 ? roomSpaces.join(", ") : "Bedroom, bathroom, balcony, and room views will appear here."}
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-3">
                <button
                  type="button"
                  onClick={onConfirm}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-cyan-300 px-6 py-4 text-base font-medium text-slate-950 transition hover:bg-cyan-200"
                >
                  <CheckCircle2 size={18} />
                  Continue with this room
                </button>
                <button
                  type="button"
                  onClick={onBack}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.05] px-6 py-4 text-base text-white/84 transition hover:bg-white/[0.1]"
                >
                  <ArrowLeft size={18} />
                  Show other rooms
                </button>
                <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
                  <div className="inline-flex items-center gap-2 rounded-full border border-cyan-200/18 bg-cyan-300/10 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-cyan-100/78">
                    <Users size={13} />
                    Voice-first browsing
                  </div>
                  <p className="mt-3 text-sm leading-6 text-white/68">
                    Ask Siya to focus on a space, compare another room, or simply say yes when you are ready to continue.
                  </p>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      {isExpanded && activeVisual && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/94 p-6 lg:p-10">
          <div className="grid h-full w-full max-w-7xl gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="overflow-hidden rounded-[36px] border border-white/10 bg-slate-900">
              <img
                src={optimizeCloudinaryUrl(activeVisual.src)}
                alt={activeVisual.title}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="flex flex-col rounded-[36px] border border-white/10 bg-slate-900/88 p-6">
              <div className="flex items-center justify-between gap-4">
                <p className="text-xs uppercase tracking-[0.3em] text-cyan-100/74">{activeVisual.category}</p>
                <button
                  type="button"
                  onClick={() => setIsExpanded(false)}
                  className="rounded-full border border-white/12 bg-white/[0.05] px-4 py-2 text-sm text-white/82 transition hover:bg-white/[0.1]"
                >
                  Close
                </button>
              </div>

              <h3 className="mt-4 text-3xl font-light text-white">{activeVisual.title}</h3>
              <p className="mt-4 text-sm leading-7 text-white/72">{activeVisual.description}</p>

              {visuals.length > 1 && (
                <div className="mt-6 grid grid-cols-2 gap-3">
                  {visuals.map((visual, index) => (
                    <button
                      key={visual.id}
                      type="button"
                      onClick={() => {
                        setStep(index);
                        setIsExpanded(false);
                      }}
                      className={cn(
                        "overflow-hidden rounded-[20px] border transition",
                        index === currentIndex
                          ? "border-cyan-300/70 ring-2 ring-cyan-300/25"
                          : "border-white/10 hover:border-white/30"
                      )}
                    >
                      <div className="aspect-[4/3] overflow-hidden bg-slate-950">
                        <img
                          src={optimizeCloudinaryUrl(visual.src)}
                          alt={visual.title}
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
    </>
  );
}

export default RoomPreviewStoryCarousel;
