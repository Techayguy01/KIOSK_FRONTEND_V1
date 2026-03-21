import React, { useEffect, useRef, useState } from 'react';
import { useUIState } from '../state/uiContext';
import { RoomCard } from '../components/RoomCard';
import { ProgressBar } from '../components/ProgressBar';
import { Loader2 } from 'lucide-react';
import AnimatedGradientBackground from '../components/ui/animated-gradient-background';
import { RoomDTO, RoomService, RoomServiceError } from '../services/room.service';

const CHARS_PER_MS = 14 / 1000;

type DisplayMode = "intro" | "browse" | "filter";

interface IntroStep {
  roomId: string;
  charOffset: number;
}

export const RoomSelectPage: React.FC = () => {
  const { data, emit, loading } = useUIState();
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [liveRooms, setLiveRooms] = useState<RoomDTO[]>([]);
  const [isLoadingRooms, setIsLoadingRooms] = useState<boolean>(true);
  const [roomsError, setRoomsError] = useState<string | null>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("browse");
  const [focusRoomIds, setFocusRoomIds] = useState<string[] | null>(null);
  const introTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const rooms = liveRooms;
  const progress = data.progress || { currentStep: 2, totalSteps: 4, steps: ['Room'] };
  const selectedRoom = selectedRoomId
    ? rooms.find((room) => room.id === selectedRoomId) || null
    : null;

  useEffect(() => {
    if (data?.selectedRoom?.id) {
      setSelectedRoomId(data.selectedRoom.id);
    }
  }, [data?.selectedRoom?.id]);

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
    const mode: DisplayMode = data?.roomDisplayMode ?? "browse";
    const ids: string[] | null = data?.focusRoomIds ?? null;
    const sequence: IntroStep[] = data?.roomIntroSequence ?? [];

    introTimersRef.current.forEach(clearTimeout);
    introTimersRef.current = [];

    setDisplayMode(mode);
    setFocusRoomIds(ids);

    if (mode === "intro" && sequence.length > 0) {
      sequence.forEach((step, index) => {
        const delayMs = Math.round(step.charOffset / CHARS_PER_MS);
        const timer = setTimeout(() => {
          setFocusRoomIds([step.roomId]);

          if (index === sequence.length - 1) {
            const browseTimer = setTimeout(() => {
              setDisplayMode("browse");
              setFocusRoomIds(null);
            }, 3000);
            introTimersRef.current.push(browseTimer);
          }
        }, delayMs);

        introTimersRef.current.push(timer);
      });
    }
  }, [data?.roomDisplayMode, data?.focusRoomIds, data?.roomIntroSequence]);

  useEffect(() => {
    return () => {
      introTimersRef.current.forEach(clearTimeout);
    };
  }, []);

  const handleContinue = () => {
    if (selectedRoomId) {
      const room = rooms.find((r) => r.id === selectedRoomId);
      emit('ROOM_SELECTED', { room });
    }
  };

  const getRoomOpacity = (roomId: string): number => {
    if (displayMode === "browse") return 1;
    if (!focusRoomIds) return 1;
    return focusRoomIds.includes(roomId) ? 1 : 0.2;
  };

  const getRoomPointerEvents = (roomId: string): "auto" | "none" => {
    if (displayMode === "intro" && focusRoomIds && !focusRoomIds.includes(roomId)) {
      return "none";
    }
    return "auto";
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

        <div className="flex-1 flex flex-col max-w-7xl mx-auto w-full relative">
          <header className="mb-8 md:mb-10 text-center">
            <h2 className="text-3xl md:text-5xl font-light tracking-[-0.04em] text-white mb-3">Choose A Room That Feels Right</h2>
            <p className="text-base md:text-xl text-slate-300">Explore the rooms, compare the atmosphere, and select the one that suits your guest best.</p>
            {displayMode === "filter" && focusRoomIds && (
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
            <div className={`grid grid-cols-1 lg:grid-cols-2 gap-8 overflow-y-auto pb-40 px-2 ${loading ? "opacity-50 pointer-events-none" : ""}`}>
              {rooms.map((room) => (
                <RoomCard
                  key={room.id}
                  room={room}
                  selected={selectedRoomId === room.id}
                  onSelect={(selected) => {
                    introTimersRef.current.forEach(clearTimeout);
                    introTimersRef.current = [];
                    setDisplayMode("browse");
                    setFocusRoomIds(null);
                    setSelectedRoomId(selected.id);
                  }}
                  opacity={getRoomOpacity(room.id)}
                  pointerEvents={getRoomPointerEvents(room.id)}
                />
              ))}
            </div>
          )}

          <div className="fixed bottom-0 left-0 w-full p-4 md:p-8 bg-gradient-to-t from-slate-950 via-slate-950/90 to-transparent flex justify-center z-10">
            <div className="flex w-full max-w-4xl flex-col sm:flex-row items-center justify-between gap-5 rounded-2xl md:rounded-[2rem] border border-white/10 bg-slate-900/80 px-6 py-5 md:px-8 md:py-6 backdrop-blur-xl">
              <div className="text-center sm:text-left">
                <p className="text-xs uppercase tracking-[0.22em] text-white/45">Selected Room</p>
                <p className="mt-1 text-lg md:text-xl text-white">
                  {selectedRoom ? selectedRoom.name : "Choose a room to continue"}
                </p>
              </div>
              <button
                disabled={!selectedRoomId || loading || isLoadingRooms || Boolean(roomsError) || rooms.length === 0}
                onClick={handleContinue}
                className={`flex items-center gap-3 rounded-full px-8 md:px-12 py-4 md:py-5 font-semibold text-lg md:text-xl transition-all duration-300 shadow-2xl w-full sm:w-auto justify-center ${selectedRoomId && !loading
                  ? 'bg-blue-600 text-white hover:bg-blue-500 hover:-translate-y-1'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  }`}
              >
                {loading && <Loader2 className="animate-spin" size={20} />}
                <span>{loading ? 'Opening...' : selectedRoom ? `Continue` : 'Select a room'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
