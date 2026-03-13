import React from 'react';
import { useUIState } from '../state/uiContext';
import { ProgressBar } from '../components/ProgressBar';
import { Key, RotateCcw } from 'lucide-react';
import AnimatedGradientBackground from '../components/ui/animated-gradient-background';

export const CompletePage: React.FC = () => {
  const { data, emit, loading } = useUIState();
  const progress = data.progress || { currentStep: 4, totalSteps: 4, steps: ['Key'] };
  const persistedBookingId = String(data?.persistedBookingId || '').trim();
  const assignedRoomNumber = String(
    data?.assignedRoomNumber ||
    data?.matchedBooking?.assignedRoomNumber ||
    ''
  ).trim();
  const resolvedRoomLabel = String(
    data?.matchedBooking?.roomName ||
    data?.selectedRoom?.displayName ||
    data?.selectedRoom?.name ||
    data?.selectedRoom?.code ||
    ''
  ).trim();
  const looksLikeRoomNumber = /^[A-Za-z]?\d+[A-Za-z0-9-]*$/.test(resolvedRoomLabel);

  return (
    <div className="h-screen w-full overflow-hidden relative">
       <AnimatedGradientBackground Breathing={true} />
       <div className="relative z-10 h-full w-full flex flex-col p-8">
         <ProgressBar 
          currentStep={progress.currentStep} 
          totalSteps={progress.totalSteps} 
          labels={progress.steps} 
         />
         
         <div className="flex-1 flex flex-col items-center justify-center text-center">
           <div className="w-32 h-32 bg-green-500 rounded-full flex items-center justify-center mb-8 shadow-[0_0_40px_rgba(34,197,94,0.4)]">
              <Key size={64} className="text-white" />
           </div>

           <h2 className="text-4xl font-light text-white mb-4">You're All Set!</h2>
           {assignedRoomNumber ? (
             <p className="text-xl text-slate-400 mb-2">
               Room <span className="text-white font-bold">{assignedRoomNumber}</span> is ready for you.
             </p>
           ) : resolvedRoomLabel ? (
             <p className="text-xl text-slate-400 mb-2">
               {looksLikeRoomNumber ? (
                 <>
                   Room <span className="text-white font-bold">{resolvedRoomLabel}</span> is ready for you.
                 </>
               ) : (
                 <>
                   <span className="text-white font-bold">{resolvedRoomLabel}</span> is confirmed for your stay.
                 </>
               )}
             </p>
           ) : (
             <p className="text-xl text-slate-400 mb-2">Your booking is confirmed and your key is ready below.</p>
           )}
           <p className="text-slate-500">Your key has been dispensed below.</p>
           {persistedBookingId && (
             <p className="text-sm text-slate-500 mt-3">
               Booking reference <span className="text-white">{persistedBookingId}</span>
             </p>
           )}

           <button 
             onClick={() => emit('RESET')}
             disabled={loading}
             className="mt-16 flex items-center gap-2 px-8 py-4 rounded-full border border-slate-700 bg-slate-800/50 hover:bg-slate-800 hover:text-white text-slate-400 transition-all uppercase tracking-widest text-sm"
           >
             <RotateCcw size={16} />
             <span>Start New Session</span>
           </button>
         </div>
       </div>

    </div>
  );
};
