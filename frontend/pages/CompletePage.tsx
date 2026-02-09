import React, { useEffect } from 'react';
import { useUIState } from '../state/uiContext';
import { ProgressBar } from '../components/ProgressBar';
import { Key, RotateCcw } from 'lucide-react';
import confetti from 'canvas-confetti';

export const CompletePage: React.FC = () => {
  const { data, emit, loading } = useUIState();
  const progress = data.progress || { currentStep: 4, totalSteps: 4, steps: ['Key'] };

  useEffect(() => {
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#3b82f6', '#60a5fa', '#ffffff']
    });
    // No auto-reset timer here. User must explicitly leave.
  }, []);

  return (
    <div className="h-screen w-full flex flex-col p-8 bg-slate-900">
       <ProgressBar 
        currentStep={progress.currentStep} 
        totalSteps={progress.totalSteps} 
        labels={progress.steps} 
       />
       
       <div className="flex-1 flex flex-col items-center justify-center text-center">
         <div className="w-32 h-32 bg-green-500 rounded-full flex items-center justify-center mb-8 shadow-[0_0_40px_rgba(34,197,94,0.4)] animate-scale-in">
            <Key size={64} className="text-white" />
         </div>

         <h2 className="text-4xl font-light text-white mb-4">You're All Set!</h2>
         <p className="text-xl text-slate-400 mb-2">Room <span className="text-white font-bold">204</span> is ready for you.</p>
         <p className="text-slate-500">Your key has been dispensed below.</p>

         <button 
           onClick={() => emit('RESET')}
           disabled={loading}
           className="mt-16 flex items-center gap-2 px-8 py-4 rounded-full border border-slate-700 bg-slate-800/50 hover:bg-slate-800 hover:text-white text-slate-400 transition-all uppercase tracking-widest text-sm"
         >
           <RotateCcw size={16} />
           <span>Start New Session</span>
         </button>
       </div>

       <style>{`
        @keyframes scale-in {
          from { transform: scale(0); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        .animate-scale-in {
          animation: scale-in 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
        }
       `}</style>
    </div>
  );
};