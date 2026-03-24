import React, { useEffect, useRef, useState } from 'react';
import { useUIState } from '../state/uiContext';
import { RoomCard } from '../components/RoomCard';
import { ProgressBar } from '../components/ProgressBar';
import { Check, ChevronLeft, ChevronRight, Loader2, Minus, SkipForward } from 'lucide-react';
import AnimatedGradientBackground from '../components/ui/animated-gradient-background';
import { RoomDTO, RoomImageDTO, RoomService, RoomServiceError } from '../services/room.service';
import { AnimatePresence, motion } from 'framer-motion';
import { VoiceRuntime } from '../voice/VoiceRuntime';
import { TTSController } from '../voice/TTSController';

type DisplayMode = "intro" | "browse" | "filter" | "compare";

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

function joinAsSentence(parts: string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

function buildImageDescription(image: RoomImageDTO): string {
  const tags = Array.isArray(image.tags)
    ? image.tags.map((tag) => humanize(tag)).filter(Boolean)
    : [];
  if (tags.length > 0) return tags.slice(0, 5).join(' | ');
  if (image.caption) return String(image.caption).trim();
  return humanize(image.category) || 'Room preview';
}

function buildPreviewImages(room: RoomDTO | null): Array<{ category: string; description: string }> {
  if (!room) return [];

  if (Array.isArray(room.images) && room.images.length > 0) {
    return room.images
      .map((image) => ({
        category: humanize(image.category) || 'Room view',
        description: buildImageDescription(image),
      }))
      .filter((image) => Boolean(image.description));
  }

  return [];
}

function buildRoomNarrative(room: RoomDTO | null): string {
  if (!room) return 'Choose a room to begin the preview.';

  const images = buildPreviewImages(room);
  const spaces = Array.from(
    new Set(
      images
        .map((image) => String(image.category || '').trim())
        .filter(Boolean)
    )
  ).slice(0, 3);
  const features = Array.isArray(room.features) ? room.features.filter(Boolean).slice(0, 3) : [];

  const pieces = [
    spaces.length > 0 ? `Take a closer look at the ${joinAsSentence(spaces.map((space) => space.toLowerCase()))}` : null,
    features.length > 0 ? `with comforts such as ${joinAsSentence(features)}` : null,
  ].filter(Boolean) as string[];

  if (pieces.length === 0) {
    return `${room.name} is ready to preview. Browse the visuals and continue whenever the guest feels ready.`;
  }

  return `${room.name} is ready to preview. ${pieces.join(', ')}. Continue when the guest feels comfortable with this choice.`;
}

function buildRoomSpaces(room: RoomDTO | null): string[] {
  if (!room) return [];
  return Array.from(
    new Set(
      buildPreviewImages(room)
        .map((image) => String(image.category || '').trim())
        .filter(Boolean)
    )
  ).slice(0, 4);
}

function buildComforts(room: RoomDTO | null): string[] {
  if (!room || !Array.isArray(room.features)) return [];
  return room.features.filter(Boolean).slice(0, 4);
}

function buildVoicePrompts(room: RoomDTO | null): string[] {
  const prompts = new Set<string>();
  prompts.add(room?.name ? `Tell me about ${room.name}` : 'Tell me about this room');

  buildRoomSpaces(room)
    .slice(0, 2)
    .forEach((space) => {
      prompts.add(`Show me the ${space.toLowerCase()}`);
    });

  prompts.add('Compare these rooms');
  prompts.add('I want this room');
  return Array.from(prompts).slice(0, 4);
}

function normalizeFeatureLabel(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

export const RoomSelectPage: React.FC = () => {
  const { data, emit, loading } = useUIState();
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [liveRooms, setLiveRooms] = useState<RoomDTO[]>([]);
  const [isLoadingRooms, setIsLoadingRooms] = useState<boolean>(true);
  const [roomsError, setRoomsError] = useState<string | null>(null);
  const [activeIntroIndex, setActiveIntroIndex] = useState(0);
  const [activeIntroVisualIndex, setActiveIntroVisualIndex] = useState(0);
  const [localRoomDisplayMode, setLocalRoomDisplayMode] = useState<DisplayMode | null>(null);
  const [localIntroSequence, setLocalIntroSequence] = useState<string[]>([]);
  const [localSpeechQueue, setLocalSpeechQueue] = useState<string[]>([]);
  const activeIntroIndexRef = useRef(0);
  const speechQueueRef = useRef<string[]>([]);
  const introSequenceRef = useRef<string[]>([]);
  const introInitializedRef = useRef<string>("");
  const pendingSpeakIndexRef = useRef<number | null>(null);
  const roomDisplayModeRef = useRef<DisplayMode>("browse");
  const postIntroPromptKeyRef = useRef<string>("");
  const spokenIntroKeyRef = useRef<string>("");
  const introTouchStartXRef = useRef<number | null>(null);
  const [currentSpeechText, setCurrentSpeechText] = useState('');
  const [isPortrait, setIsPortrait] = useState<boolean>(() => window.innerHeight > window.innerWidth);
  const [introFinished, setIntroFinished] = useState(false);

  const rooms = liveRooms;
  const progress = data.progress || { currentStep: 2, totalSteps: 4, steps: ['Room'] };
  const interactionMode = String((data as any)?.metadata?.interactionMode || 'voice').toLowerCase();
  const isManualMode = interactionMode === 'manual';

  const roomDisplayModeFromBackend: DisplayMode = (data?.roomDisplayMode ?? "browse") as DisplayMode;
  const roomDisplayMode: DisplayMode = (localRoomDisplayMode ?? roomDisplayModeFromBackend) as DisplayMode;
  const focusRoomIds: string[] = Array.isArray(data?.focusRoomIds) ? data.focusRoomIds : [];
  const backendIntroSequence: string[] = Array.isArray(data?.roomIntroSequence) ? data.roomIntroSequence : [];
  const backendSpeechQueue: string[] = Array.isArray((data as any)?.roomIntroSpeechQueue) ? (data as any).roomIntroSpeechQueue : [];
  const compareRoomIds: string[] = Array.isArray((data as any)?.compareRoomIds) ? (data as any).compareRoomIds : [];
  const targetIntroIndex: number | null = typeof (data as any)?.targetIntroIndex === 'number' ? (data as any).targetIntroIndex : null;
  const effectiveIntroSequence = localRoomDisplayMode === "intro" && localIntroSequence.length > 0
    ? localIntroSequence
    : backendIntroSequence;
  const effectiveSpeechQueue = localRoomDisplayMode === "intro" && localSpeechQueue.length > 0
    ? localSpeechQueue
    : backendSpeechQueue;

  useEffect(() => {
    if (data?.selectedRoom?.id) {
      setSelectedRoomId(data.selectedRoom.id);
    }
  }, [data?.selectedRoom?.id]);

  useEffect(() => {
    roomDisplayModeRef.current = roomDisplayMode;
  }, [roomDisplayMode]);

  useEffect(() => {
    if (roomDisplayModeFromBackend === "intro" && backendIntroSequence.length > 0) {
      setLocalRoomDisplayMode(null);
      setLocalIntroSequence([]);
      setLocalSpeechQueue([]);
    }
  }, [backendIntroSequence.length, roomDisplayModeFromBackend]);

  useEffect(() => {
    let active = true;
    setRoomsError(null);
    setIsLoadingRooms(true);

    RoomService.getAvailableRooms()
      .then((fetchedRooms) => {
        if (!active) return;
        setLiveRooms(fetchedRooms);
        emit('GENERAL_QUERY', { rooms: fetchedRooms, suppressSpeech: true });
        setIsLoadingRooms(false);
      })
      .catch((error) => {
        console.error("[RoomSelectPage] Failed to load live rooms:", error);
        if (!active) return;
        setIsLoadingRooms(false);
        if (error instanceof RoomServiceError) {
          if (error.status === 404 || error.code === "TENANT_NOT_FOUND") {
            setRoomsError("Tenant not found. Please verify the kiosk URL.");
            return;
          }
          setRoomsError(error.message || "Failed to load rooms from the server.");
          return;
        }
        setRoomsError("Failed to load rooms from the server.");
      });

    return () => {
      active = false;
    };
  }, [emit]);

  useEffect(() => {
    // If backend hasn't started an intro (empty sequence / non-intro mode) but we do have rooms,
    // run the sequential intro locally so the guest still gets the guided experience.
    if (rooms.length === 0) return;
    if (introInitializedRef.current !== "") return;
    if (roomDisplayModeFromBackend === "intro" && backendIntroSequence.length > 0) return;

    const localSequence = rooms.map((r) => String((r as any)?.id || "")).filter(Boolean);
    if (localSequence.length === 0) return;

    let localQueue = rooms.map((room: any) => {
      const price = Number.isFinite(Number(room?.price)) && Number(room.price) > 0
        ? `INR ${Math.round(Number(room.price)).toLocaleString("en-IN")}`
        : "price on request";
      const features = Array.isArray(room?.features) ? room.features.slice(0, 3).filter(Boolean) : [];
      const featureText = features.length > 0 ? features.join(", ") : "comfortable amenities";
      const cap = typeof room?.maxAdults === "number" ? ` for up to ${room.maxAdults} adults` : "";
      return `${room?.name || "This room"} — available at ${price} per night${cap}. It features ${featureText}.`;
    });
    localQueue = rooms.map((room: any) => buildIntroSpeech(room));

    VoiceRuntime.stopSpeaking();
    TTSController.hardStop("state_change");
    introInitializedRef.current = localSequence.join(",");
    introSequenceRef.current = localSequence;
    speechQueueRef.current = localQueue;
    setLocalIntroSequence(localSequence);
    setLocalSpeechQueue(localQueue);
    activeIntroIndexRef.current = 0;
    setActiveIntroIndex(0);
    setActiveIntroVisualIndex(0);
    setIntroFinished(false);
    setLocalRoomDisplayMode("intro");
    pendingSpeakIndexRef.current = localQueue.length > 0 ? 0 : null;
    postIntroPromptKeyRef.current = "";
    spokenIntroKeyRef.current = "";
  }, [backendIntroSequence.length, roomDisplayModeFromBackend, rooms]);

  useEffect(() => {
    activeIntroIndexRef.current = activeIntroIndex;
  }, [activeIntroIndex]);

  useEffect(() => {
    if (effectiveIntroSequence.length === 0) return;
    const sequenceKey = effectiveIntroSequence.join(",");
    if (introInitializedRef.current === sequenceKey) return;

    introInitializedRef.current = sequenceKey;
    speechQueueRef.current = effectiveSpeechQueue;
    introSequenceRef.current = effectiveIntroSequence;
    activeIntroIndexRef.current = 0;
    setActiveIntroIndex(0);
    setActiveIntroVisualIndex(0);
    setIntroFinished(false);

    // Speak only after the first card finishes fading in.
    pendingSpeakIndexRef.current = effectiveSpeechQueue.length > 0 ? 0 : null;
    postIntroPromptKeyRef.current = "";
    spokenIntroKeyRef.current = "";
  }, [effectiveIntroSequence.join(","), effectiveSpeechQueue.join("|")]);

  useEffect(() => {
    if (effectiveIntroSequence.length === 0) return;

    const unsubscribe = TTSController.subscribe((event: any) => {
      if (roomDisplayModeRef.current !== "intro") return;
      if (event?.type !== "TTS_ENDED") return;

      const currentQueue = speechQueueRef.current;
      const currentSequence = introSequenceRef.current;
      const currentIndex = activeIntroIndexRef.current;
      const nextIndex = currentIndex + 1;

      if (nextIndex < currentSequence.length) {
        activeIntroIndexRef.current = nextIndex;
        setActiveIntroIndex(nextIndex);
        // Speak only after the next card has animated in.
        pendingSpeakIndexRef.current = nextIndex < currentQueue.length ? nextIndex : null;
        spokenIntroKeyRef.current = "";
      } else {
        setIntroFinished(true);
        setLocalRoomDisplayMode("browse");
        pendingSpeakIndexRef.current = null;
      }
      // If nextIndex >= currentSequence.length, all rooms are described.
      // Backend will switch to browse on the next interaction.
    });

    return () => unsubscribe();
  }, [effectiveIntroSequence.length]);

  useEffect(() => {
    if (!introFinished || roomDisplayMode !== "browse") return;
    const sequenceKey = effectiveIntroSequence.join(",");
    if (!sequenceKey) return;
    if (postIntroPromptKeyRef.current === sequenceKey) return;

    postIntroPromptKeyRef.current = sequenceKey;
    void VoiceRuntime.speak("Please select a room, or do you have any questions regarding the rooms?");
  }, [effectiveIntroSequence, introFinished, roomDisplayMode]);

  useEffect(() => {
    const unsubscribe = TTSController.subscribe((event: any) => {
      if (event?.type === 'TTS_STARTED') {
        setCurrentSpeechText(String(event.text || '').trim());
      }
      if (event?.type === 'TTS_ENDED' || event?.type === 'TTS_CANCELLED') {
        setCurrentSpeechText('');
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const handleResize = () => setIsPortrait(window.innerHeight > window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (targetIntroIndex == null) return;
    if (roomDisplayMode !== 'intro') return;
    const clamped = Math.max(0, Math.min(effectiveIntroSequence.length - 1, targetIntroIndex));
    activeIntroIndexRef.current = clamped;
    setActiveIntroIndex(clamped);
    setActiveIntroVisualIndex(0);
    pendingSpeakIndexRef.current = clamped;
    spokenIntroKeyRef.current = '';
  }, [effectiveIntroSequence.length, roomDisplayMode, targetIntroIndex]);

  const formatPrice = (room: RoomDTO): string => {
    const currency = String(room.currency || "INR").toUpperCase();
    const numericPrice = Number(room.price || 0);
    const amount = Number.isFinite(numericPrice) ? numericPrice.toLocaleString("en-IN") : String(room.price || "");
    return currency === "INR" ? `INR ${amount}` : `${currency} ${amount}`;
  };

  const buildIntroSpeech = (room: RoomDTO): string => {
    const price = formatPrice(room);
    const narrative = buildRoomNarrative(room);
    const spaces = buildRoomSpaces(room);
    const spaceLine = spaces.length > 0 ? ` You can explore ${joinAsSentence(spaces.map((space) => space.toLowerCase()))}.` : "";
    const adults = typeof (room as any)?.maxAdults === "number"
      ? ` It can host up to ${(room as any).maxAdults} adult${(room as any).maxAdults === 1 ? "" : "s"}`
      : "";
    const children = typeof (room as any)?.maxChildren === "number"
      ? ` and ${(room as any).maxChildren} child${(room as any).maxChildren === 1 ? "" : "ren"}`
      : "";
    const capacity = adults || children ? `${adults}${children}.` : "";
    return `${room.name} is available from ${price} per night.${capacity}${spaceLine} ${narrative}`.replace(/\s+/g, ' ').trim();
  };

  const getPrimaryImageUrl = (room: RoomDTO | null): string | null => {
    if (!room) return null;
    const images = Array.isArray((room as any).images) ? (room as any).images : [];
    const sorted = [...images].sort((a: any, b: any) => {
      const ap = Boolean(a?.isPrimary);
      const bp = Boolean(b?.isPrimary);
      if (ap !== bp) return ap ? -1 : 1;
      const ao = typeof a?.displayOrder === "number" ? a.displayOrder : 999;
      const bo = typeof b?.displayOrder === "number" ? b.displayOrder : 999;
      return ao - bo;
    });
    const url = String(sorted?.[0]?.url || "").trim();
    return url || null;
  };

  const getRoomImageUrls = (room: RoomDTO | null): string[] => {
    if (!room) return [];
    const fromImages = Array.isArray(room.images)
      ? room.images.map((image) => String(image?.url || '').trim()).filter(Boolean)
      : [];
    const fallbackUrls = Array.isArray((room as any).imageUrls)
      ? (room as any).imageUrls.map((url: unknown) => String(url || '').trim()).filter(Boolean)
      : [];
    const directImage = String((room as any).image || '').trim();
    return Array.from(new Set([...fromImages, ...fallbackUrls, ...(directImage ? [directImage] : [])]));
  };

  const activeRoomId = introSequenceRef.current[activeIntroIndex] ?? effectiveIntroSequence[activeIntroIndex];
  const activeIntroRoom = rooms.find((r: any) => String(r?.id) === String(activeRoomId)) ?? null;
  const activeIntroImages = getRoomImageUrls(activeIntroRoom);
  const activeIntroImage = activeIntroImages[activeIntroVisualIndex] || getPrimaryImageUrl(activeIntroRoom);
  const activeIntroSpaces = buildRoomSpaces(activeIntroRoom);
  const activeIntroComforts = buildComforts(activeIntroRoom);
  const activeIntroPrompts = buildVoicePrompts(activeIntroRoom);

  useEffect(() => {
    setActiveIntroVisualIndex(0);
  }, [activeIntroRoom?.id]);

  useEffect(() => {
    if (roomDisplayMode !== "intro") return;
    if (activeIntroImages.length <= 1) return;

    const interval = window.setInterval(() => {
      setActiveIntroVisualIndex((current) => (current + 1) % activeIntroImages.length);
    }, 2600);

    return () => window.clearInterval(interval);
  }, [activeIntroImages.length, roomDisplayMode]);

  const compareRooms: RoomDTO[] = (() => {
    if (roomDisplayMode !== "compare" || compareRoomIds.length < 2) return [];
    const byId = new Map(rooms.map((r) => [r.id, r]));
    return compareRoomIds.slice(0, 3).map((id) => byId.get(id)).filter(Boolean) as RoomDTO[];
  })();
  const comparisonFeatureUniverse = Array.from(
    new Set(
      compareRooms.flatMap((room) =>
        (Array.isArray(room.features) ? room.features : [])
          .map((feature) => String(feature || '').trim())
          .filter(Boolean)
      )
    )
  );

  const handleShowAllRooms = () => {
    VoiceRuntime.stopSpeaking();
    TTSController.hardStop('state_change');
    setIntroFinished(true);
    setLocalRoomDisplayMode('browse');
    pendingSpeakIndexRef.current = null;
    emit('GENERAL_QUERY', { transcript: 'show all rooms' });
  };

  const jumpToIntroIndex = (nextIndex: number) => {
    if (effectiveIntroSequence.length === 0) return;
    const clamped = Math.max(0, Math.min(effectiveIntroSequence.length - 1, nextIndex));
    VoiceRuntime.stopSpeaking();
    TTSController.hardStop('state_change');
    activeIntroIndexRef.current = clamped;
    setActiveIntroIndex(clamped);
    setActiveIntroVisualIndex(0);
    pendingSpeakIndexRef.current = clamped;
    spokenIntroKeyRef.current = '';
  };

  return (
    <div className="min-h-screen w-full relative overflow-x-hidden">
      <AnimatedGradientBackground Breathing={true} />
      <div className="relative z-10 h-full w-full flex flex-col p-6 md:p-10 lg:p-12">
        <ProgressBar
          currentStep={progress.currentStep}
          totalSteps={progress.totalSteps}
          labels={progress.steps}
        />

        <div className={`flex-1 flex flex-col mx-auto w-full relative ${roomDisplayMode === "browse" ? "max-w-[96vw]" : "max-w-7xl"}`}>
          <header className="mb-8 md:mb-10 text-center">
            <h2 className="text-3xl md:text-5xl font-light tracking-[-0.04em] text-white mb-3">Choose A Room That Feels Right</h2>
            <p className="text-base md:text-xl text-slate-300">Explore the rooms, compare the atmosphere, and select the one that suits your guest best.</p>
            {roomDisplayMode === "filter" && focusRoomIds.length > 0 && (
              <p className="text-sm text-cyan-300 mt-3">
                Showing {focusRoomIds.length} matching room{focusRoomIds.length !== 1 ? "s" : ""} - say "show all rooms" to reset
              </p>
            )}
            {roomsError && <p className="text-amber-300 text-base mt-4">{roomsError}</p>}
          </header>

          {isLoadingRooms ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-200">
              <Loader2 className="animate-spin mb-6" size={44} />
              <p className="text-xl">Loading available rooms...</p>
            </div>
          ) : roomsError ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <p className="text-rose-200 mb-6 text-xl">{roomsError}</p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-8 py-4 text-lg rounded-full bg-blue-600 text-white hover:bg-blue-500 transition-colors"
              >
                Retry
              </button>
            </div>
          ) : rooms.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-300">
              <p className="mb-3 text-xl">No rooms configured for this hotel yet.</p>
            </div>
          ) : (
            <div className={`flex-1 w-full ${loading ? "opacity-50 pointer-events-none" : ""}`}>
              {roomDisplayMode === "compare" && compareRooms.length >= 2 ? (
                <div className={`grid grid-cols-1 ${!isPortrait && compareRooms.length === 3 ? "xl:grid-cols-3" : !isPortrait ? "lg:grid-cols-2" : ""} gap-6 lg:gap-8 pb-10`}>
                  {compareRooms.map((room) => {
                    const img = getPrimaryImageUrl(room);
                    const focused = focusRoomIds.includes(room.id);
                    const roomFeatureSet = new Set(
                      (Array.isArray(room.features) ? room.features : [])
                        .map((feature) => normalizeFeatureLabel(feature))
                        .filter(Boolean)
                    );
                    return (
                      <div
                        key={room.id}
                        className={`overflow-hidden rounded-[2rem] border bg-slate-950/72 ${focused ? "border-cyan-200/70" : "border-white/10"}`}
                      >
                        <div className="relative aspect-[16/10] overflow-hidden bg-slate-900/40">
                          {img ? (
                            <img src={img} alt={room.name} className="h-full w-full object-cover" />
                          ) : (
                            <div className="h-full w-full flex items-center justify-center text-slate-400">
                              Image unavailable
                            </div>
                          )}
                        </div>
                        <div className="p-6">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <h3 className="text-2xl font-semibold tracking-[-0.03em] text-white leading-tight">{room.name}</h3>
                              <p className="mt-1 text-slate-300">{formatPrice(room)} <span className="text-slate-500">per night</span></p>
                            </div>
                            <div className="text-right text-sm text-slate-300">
                              {typeof room.maxAdults === "number" && <div>Adults: {room.maxAdults}</div>}
                              {typeof room.maxChildren === "number" && <div>Children: {room.maxChildren}</div>}
                            </div>
                          </div>

                          <div className="mt-5">
                            <div className="text-xs uppercase tracking-[0.22em] text-white/45">Feature differences</div>
                            <div className="mt-3 grid gap-2">
                              {comparisonFeatureUniverse.map((feature) => {
                                const hasFeature = roomFeatureSet.has(normalizeFeatureLabel(feature));
                                return (
                                  <div
                                    key={`${room.id}-${feature}`}
                                    className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-sm ${
                                      hasFeature
                                        ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-50"
                                        : "border-white/10 bg-white/[0.03] text-white/48"
                                    }`}
                                  >
                                    <span>{feature}</span>
                                    {hasFeature ? <Check size={16} /> : <Minus size={16} />}
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          <div className="mt-7">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedRoomId(room.id);
                                emit("ROOM_SELECTED", { room });
                              }}
                              className="w-full rounded-full bg-blue-600 text-white hover:bg-blue-500 transition-colors px-6 py-4 text-lg font-semibold"
                            >
                              Select this room
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : roomDisplayMode === "intro" && effectiveIntroSequence.length > 0 && !introFinished ? (
                <div className="flex min-h-[68vh] items-stretch justify-center py-4 md:py-6">
                  <div className="w-full">
                    <div className="mb-5 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        {effectiveIntroSequence.map((id: string, idx: number) => (
                          <div
                            key={`intro-dot-top-${id}`}
                            className={`rounded-full transition-all duration-400 ${
                              idx === activeIntroIndex
                                ? "h-3 w-6 bg-white"
                                : idx < activeIntroIndex
                                  ? "h-2 w-2 bg-white/55"
                                  : "h-2 w-2 bg-white/20"
                            }`}
                          />
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={handleShowAllRooms}
                        className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.05] px-4 py-2 text-sm text-white/84 transition hover:bg-white/[0.12]"
                      >
                        <SkipForward size={15} />
                        Show all rooms
                      </button>
                    </div>
                    {isManualMode && (
                      <div className="mb-5 flex items-center justify-center gap-3">
                        <button
                          type="button"
                          onClick={() => jumpToIntroIndex(activeIntroIndex - 1)}
                          disabled={activeIntroIndex <= 0}
                          className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.05] px-5 py-3 text-sm text-white/84 transition hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <ChevronLeft size={16} />
                          Previous room
                        </button>
                        <button
                          type="button"
                          onClick={() => jumpToIntroIndex(activeIntroIndex + 1)}
                          disabled={activeIntroIndex >= effectiveIntroSequence.length - 1}
                          className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.05] px-5 py-3 text-sm text-white/84 transition hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Next room
                          <ChevronRight size={16} />
                        </button>
                      </div>
                    )}
                    <AnimatePresence mode="wait">
                      {activeIntroRoom && (
                        <motion.div
                          key={activeIntroRoom.id}
                          initial={{ opacity: 0, scale: 0.985, y: 28 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.985, y: -28 }}
                          transition={{ duration: 0.55, ease: "easeInOut" }}
                          onAnimationComplete={() => {
                            const idx = pendingSpeakIndexRef.current;
                            if (idx == null) return;
                            if (idx !== activeIntroIndexRef.current) return;
                            const q = speechQueueRef.current;
                            if (idx >= 0 && idx < q.length) {
                              const speakKey = `${activeIntroRoom.id}:${idx}`;
                              if (spokenIntroKeyRef.current === speakKey) return;
                              spokenIntroKeyRef.current = speakKey;
                              pendingSpeakIndexRef.current = null;
                              void VoiceRuntime.speak(q[idx]);
                            }
                          }}
                          className="mx-auto h-full w-full max-w-7xl"
                          onTouchStart={(event) => {
                            introTouchStartXRef.current = event.changedTouches[0]?.clientX ?? null;
                          }}
                          onTouchEnd={(event) => {
                            const startX = introTouchStartXRef.current;
                            const endX = event.changedTouches[0]?.clientX ?? null;
                            introTouchStartXRef.current = null;
                            if (startX == null || endX == null) return;
                            const deltaX = endX - startX;
                            if (Math.abs(deltaX) < 48) return;
                            if (deltaX < 0) jumpToIntroIndex(activeIntroIndexRef.current + 1);
                            if (deltaX > 0) jumpToIntroIndex(activeIntroIndexRef.current - 1);
                          }}
                        >
                          <div className="grid min-h-[68vh] overflow-hidden rounded-[2rem] border border-white/15 bg-slate-950/72 shadow-[0_35px_120px_rgba(15,23,42,0.55)] backdrop-blur-xl lg:grid-cols-[1.35fr_0.9fr]">
                            <div className="relative min-h-[340px] bg-slate-900/50">
                              {activeIntroImage ? (
                                <img
                                  src={activeIntroImage}
                                  alt={activeIntroRoom.name}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-white/30 text-sm">
                                  No image available
                                </div>
                              )}
                              <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/12 to-transparent" />
                              <div className="absolute left-6 top-6 rounded-full border border-white/15 bg-slate-950/45 px-4 py-2 text-xs uppercase tracking-[0.28em] text-cyan-100/80">
                                Room Introduction
                              </div>
                              {activeIntroImages.length > 1 && (
                                <div className="absolute left-1/2 bottom-6 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-slate-950/35 px-3 py-2 backdrop-blur-md">
                                  {activeIntroImages.map((image, index) => (
                                    <span
                                      key={`${activeIntroRoom.id}-${image}-${index}`}
                                      className={index === activeIntroVisualIndex ? "h-2 w-6 rounded-full bg-white" : "h-2 w-2 rounded-full bg-white/35"}
                                    />
                                  ))}
                                </div>
                              )}
                            </div>

                            <div className="flex flex-col justify-between p-6 md:p-8 lg:p-10">
                              <div>
                                <p className="text-xs uppercase tracking-[0.28em] text-cyan-100/72">Now Showing</p>
                                <h2 className="mt-3 text-3xl md:text-5xl font-light tracking-[-0.05em] text-white leading-tight">
                                  {activeIntroRoom.name}
                                </h2>
                                <p className="mt-4 text-lg md:text-2xl text-cyan-100">
                                  {formatPrice(activeIntroRoom)} <span className="text-white/45 text-base md:text-lg">per night</span>
                                </p>
                                <p className="mt-5 max-w-2xl text-sm md:text-base leading-7 text-white/72">
                                  {buildRoomNarrative(activeIntroRoom)}
                                </p>
                                {currentSpeechText && (
                                  <div className="mt-6 rounded-[1.4rem] border border-cyan-200/20 bg-cyan-300/10 p-4 backdrop-blur-sm">
                                    <p className="text-[11px] uppercase tracking-[0.28em] text-cyan-100/75">Siya is saying</p>
                                    <p className="mt-2 text-sm md:text-base leading-7 text-white/88">{currentSpeechText}</p>
                                  </div>
                                )}
                              </div>

                              <div className="mt-8 grid gap-4">
                                <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-5">
                                  <p className="text-xs uppercase tracking-[0.3em] text-white/45">Inside the room</p>
                                  <div className="mt-4 flex flex-wrap gap-2.5">
                                    {activeIntroSpaces.length > 0 ? activeIntroSpaces.map((space) => (
                                      <span
                                        key={space}
                                        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/55 px-3 py-2 text-sm text-white/82"
                                      >
                                        {space}
                                      </span>
                                    )) : (
                                      <span className="text-sm text-white/56">Bedroom, bathroom, balcony, and room views will appear here.</span>
                                    )}
                                  </div>
                                </div>

                                <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-5">
                                  <p className="text-xs uppercase tracking-[0.3em] text-white/45">Room comforts</p>
                                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                    <div className="rounded-[1.1rem] border border-white/10 bg-slate-950/55 p-4">
                                      <p className="text-[11px] uppercase tracking-[0.26em] text-white/42">Included</p>
                                      <p className="mt-2 text-sm leading-6 text-white/78">
                                        {activeIntroComforts.length > 0 ? activeIntroComforts.join(", ") : "Comfort details are still being prepared."}
                                      </p>
                                    </div>
                                    <div className="rounded-[1.1rem] border border-white/10 bg-slate-950/55 p-4">
                                      <p className="text-[11px] uppercase tracking-[0.26em] text-white/42">Explore visually</p>
                                      <p className="mt-2 text-sm leading-6 text-white/78">
                                        {activeIntroSpaces.length > 0 ? activeIntroSpaces.join(", ") : "Room visuals will appear here as the intro continues."}
                                      </p>
                                    </div>
                                  </div>
                                </div>

                                <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-5">
                                  <p className="text-xs uppercase tracking-[0.3em] text-white/45">Try saying</p>
                                  <div className="mt-4 space-y-2.5">
                                    {activeIntroPrompts.map((prompt) => (
                                      <p key={prompt} className="text-sm leading-6 text-white/74">
                                        "{prompt}"
                                      </p>
                                    ))}
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4 text-sm text-white/75">
                                  <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.04] px-4 py-4">
                                    <p className="text-[11px] uppercase tracking-[0.24em] text-white/45">Adults</p>
                                    <p className="mt-2 text-2xl text-white">{typeof (activeIntroRoom as any).maxAdults === "number" ? (activeIntroRoom as any).maxAdults : "-"}</p>
                                  </div>
                                  <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.04] px-4 py-4">
                                    <p className="text-[11px] uppercase tracking-[0.24em] text-white/45">Children</p>
                                    <p className="mt-2 text-2xl text-white">{typeof (activeIntroRoom as any).maxChildren === "number" ? (activeIntroRoom as any).maxChildren : "-"}</p>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {effectiveIntroSequence.length > 1 && (
                      <div className="flex items-center justify-center gap-2 mt-6">
                        {effectiveIntroSequence.map((id: string, idx: number) => (
                          <div
                            key={id}
                            className={`rounded-full transition-all duration-400 ${
                              idx === activeIntroIndex
                                ? "w-3 h-3 bg-white"
                                : idx < activeIntroIndex
                                  ? "w-2 h-2 bg-white/50"
                                  : "w-2 h-2 bg-white/20"
                            }`}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="pb-12">
                  <div className="flex h-[calc(100vh-18rem)] w-full items-stretch gap-6 overflow-hidden px-1 pb-8">
                    {rooms.map((room) => {
                      const focused = focusRoomIds.includes(room.id);
                      return (
                        <div
                          key={room.id}
                          className={`min-w-0 basis-0 flex-1 ${focused ? "ring-2 ring-cyan-200/60 rounded-[2rem]" : ""}`}
                        >
                          <RoomCard
                            room={room}
                            compact
                            selected={selectedRoomId === room.id}
                            onSelect={(selected) => {
                              setSelectedRoomId(selected.id);
                              emit("ROOM_SELECTED", { room: selected });
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
