import React, { useEffect, useState } from 'react';
import { useUIState } from '../state/uiContext';
import { RoomCard } from '../components/RoomCard';
import { ProgressBar } from '../components/ProgressBar';
import { Loader2 } from 'lucide-react';
import AnimatedGradientBackground from '../components/ui/animated-gradient-background';
import { CardStack, CardStackItem } from '../components/ui/card-stack';
import { RoomDTO, RoomService, RoomServiceError } from '../services/room.service';

export const RoomSelectPage: React.FC = () => {
  const { data, emit, loading } = useUIState();
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [liveRooms, setLiveRooms] = useState<RoomDTO[]>([]);
  const [isLoadingRooms, setIsLoadingRooms] = useState<boolean>(true);
  const [roomsError, setRoomsError] = useState<string | null>(null);
  const stateRooms = Array.isArray(data?.rooms) ? (data.rooms as RoomDTO[]) : [];
  const rooms = liveRooms.length > 0 ? liveRooms : stateRooms;
  const progress = data.progress || { currentStep: 2, totalSteps: 4, steps: ['Room'] };
  const selectedRoom = selectedRoomId ? rooms.find((room) => room.id === selectedRoomId) || null : null;
  const stackItems: (RoomDTO & CardStackItem)[] = rooms.map((room, index) => ({
    ...room,
    id: room.id,
    title: room.name,
    description: Array.isArray(room.features) ? room.features.slice(0, 2).join(', ') : undefined,
    imageSrc: (Array.isArray(room.imageUrls) && room.imageUrls[0]) || room.image,
    href: undefined,
    tag: index === 0 ? 'Popular' : undefined,
  }));

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

  const handleContinue = () => {
    if (selectedRoomId) {
      const room = rooms.find((r: any) => r.id === selectedRoomId);
      emit('ROOM_SELECTED', { room });
    }
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
            <p className="text-sm md:text-base text-white/60 mt-3">Siya can describe each room using the live room details, images, and amenities.</p>
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
              <p className="mb-3 text-xl">No rooms are configured for this hotel yet.</p>
              <p className="text-base text-slate-400">Please contact front desk support.</p>
            </div>
          ) : (
            <div className={`w-full pb-72 px-2 transition-opacity ${loading ? 'opacity-50 pointer-events-none' : ''}`}>
              <div className="mx-auto w-full max-w-[1600px]">
                <CardStack
                  items={stackItems}
                  initialIndex={0}
                  autoAdvance
                  intervalMs={3000}
                  pauseOnHover={false}
                  loop
                  showDots
                  maxVisible={6}
                  cardWidth={900}
                  cardHeight={1400}
                  overlap={0}
                  spreadDeg={0}
                  depthPx={0}
                  tiltXDeg={0}
                  activeScale={1}
                  inactiveScale={1}
                  springStiffness={260}
                  springDamping={26}
                  className="w-full"
                  onChangeIndex={(index, item) => {
                    if (!item?.id) return;
                    setSelectedRoomId(String(item.id));
                  }}
                  renderCard={(item) => (
                    <div className="w-full h-full">
                      <RoomCard
                        room={item}
                        selected={selectedRoomId === String(item.id)}
                        onSelect={(selected) => setSelectedRoomId(selected.id)}
                      />
                    </div>
                  )}
                />
              </div>
            </div>
          )}

          <div className="fixed bottom-0 left-0 w-full p-4 md:p-8 bg-gradient-to-t from-slate-950 via-slate-950/90 to-transparent flex justify-center z-10">
            <div className="flex w-full max-w-4xl flex-col sm:flex-row items-center justify-between gap-5 rounded-2xl md:rounded-[2rem] border border-white/10 bg-slate-900/80 px-6 py-5 md:px-8 md:py-6 backdrop-blur-xl">
              <div className="text-center sm:text-left">
                <p className="text-xs uppercase tracking-[0.22em] text-white/45">Selected Room</p>
                <p className="mt-1 text-lg md:text-xl text-white">
                  {selectedRoom ? selectedRoom.name : 'Choose a room to continue'}
                </p>
                <p className="mt-1 text-xs md:text-sm text-slate-400 hidden sm:block">
                  {selectedRoom
                    ? 'Preview the room details before moving into the booking form.'
                    : 'Tap any card to select it, or keep exploring the room details.'}
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
