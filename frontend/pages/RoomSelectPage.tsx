import React, { useEffect, useState } from 'react';
import { useUIState } from '../state/uiContext';
import { RoomCard } from '../components/RoomCard';
import { ProgressBar } from '../components/ProgressBar';
import { Loader2 } from 'lucide-react';
import AnimatedGradientBackground from '../components/ui/animated-gradient-background';
import { roomsMock } from '../mocks/rooms.mock';

export const RoomSelectPage: React.FC = () => {
  const { data, emit, loading } = useUIState();
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const rooms = Array.isArray(data.rooms) && data.rooms.length > 0
    ? data.rooms
    : roomsMock.available_rooms;
  const progress = data.progress || { currentStep: 2, totalSteps: 4, steps: ['Room'] };

  useEffect(() => {
    if (data?.selectedRoom?.id) {
      setSelectedRoomId(data.selectedRoom.id);
    }
  }, [data?.selectedRoom?.id]);

  const handleContinue = () => {
    if (selectedRoomId) {
      const room = rooms.find((r: any) => r.id === selectedRoomId);
      emit('ROOM_SELECTED', { room });
    }
  };

  return (
    <div className="h-screen w-full overflow-hidden relative">
      <AnimatedGradientBackground Breathing={true} />
      <div className="relative z-10 h-full w-full flex flex-col p-8">
        <ProgressBar
          currentStep={progress.currentStep}
          totalSteps={progress.totalSteps}
          labels={progress.steps}
        />

        <div className="flex-1 flex flex-col max-w-6xl mx-auto w-full relative">
          <header className="mb-8 text-center">
            <h2 className="text-3xl font-light text-white mb-2">Select Your Room</h2>
            <p className="text-slate-400">We have prepared a selection based on your preferences.</p>
          </header>

          <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 overflow-y-auto pb-24 px-4 transition-opacity ${loading ? 'opacity-50 pointer-events-none' : ''}`}>
            {rooms.map((room: any) => (
              <RoomCard
                key={room.id}
                room={room}
                selected={selectedRoomId === room.id}
                onSelect={(r) => setSelectedRoomId(r.id)}
              />
            ))}
          </div>

          <div className="fixed bottom-0 left-0 w-full p-6 bg-gradient-to-t from-slate-900 to-transparent flex justify-center z-10">
            <button
              disabled={!selectedRoomId || loading}
              onClick={handleContinue}
              className={`flex items-center gap-2 px-12 py-4 rounded-full font-semibold text-lg transition-all duration-300 shadow-xl ${selectedRoomId && !loading
                ? 'bg-blue-600 text-white hover:bg-blue-500 transform hover:-translate-y-1'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                }`}
            >
              {loading && <Loader2 className="animate-spin" size={20} />}
              <span>{loading ? 'Confirming...' : 'Confirm Selection'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
