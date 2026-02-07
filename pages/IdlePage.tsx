import React from 'react';
import { useUIState } from '../state/uiContext';
import { useFadeIn } from '../hooks/useAnimation';
import { ParticleWave } from '../components/ui/particle-wave';

export const IdlePage: React.FC = () => {
  const { emit } = useUIState();
  const fade = useFadeIn(100);

  return (
    <div 
      className="relative h-screen w-full overflow-hidden bg-slate-900 cursor-pointer"
      onClick={() => emit('START_SESSION')}
    >
      {/* Background Layer */}
      <div className="absolute inset-0 z-0">
        <ParticleWave className="w-full h-full" />
      </div>

      {/* Content Layer */}
      <div className="relative z-10 w-full h-full flex flex-col items-center justify-center pointer-events-none">
        {/* We use pointer-events-none to let clicks pass through to container, but text is selectable if we wanted. 
            Here the container click is primary interaction. */}
            
        <div className={`text-center transform transition-all duration-1000 ${fade}`}>
          <h1 className="text-8xl font-thin tracking-tighter text-white mb-6">
            NEXUS
            <span className="text-blue-500 font-bold">.</span>
          </h1>
          <p className="text-xl text-slate-400 tracking-[0.2em] uppercase mb-12">
            Future Hospitality
          </p>
          
          <div className="animate-pulse">
            <div className="px-8 py-3 rounded-full border border-slate-700 bg-slate-800/30 text-slate-300 text-sm tracking-widest backdrop-blur-sm">
              TOUCH ANYWHERE TO START
            </div>
          </div>
        </div>

        <div className="absolute bottom-8 text-slate-600 text-xs">
          v2.4.0 • System Operational
        </div>
      </div>
    </div>
  );
};