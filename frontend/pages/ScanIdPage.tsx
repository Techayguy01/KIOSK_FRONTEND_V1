import React from 'react';
import { useUIState } from '../state/uiContext';
import { CreditCard, ScanLine } from 'lucide-react';
import { ProgressBar } from '../components/ProgressBar';

export const ScanIdPage: React.FC = () => {
  const { data, emit, loading } = useUIState();
  const progress = data.progress || { currentStep: 1, totalSteps: 4, steps: ['ID Scan'] };

  return (
    <div className="h-screen w-full flex flex-col p-8 bg-slate-900">
      <ProgressBar 
        currentStep={progress.currentStep} 
        totalSteps={progress.totalSteps} 
        labels={progress.steps} 
      />
      
      <div className="flex-1 flex flex-col items-center justify-center">
        {/* Scan Animation Container */}
        <div 
          onClick={() => !loading && emit('SCAN_COMPLETED')}
          className="relative w-96 h-64 border-2 border-dashed border-slate-600 rounded-2xl flex items-center justify-center mb-8 overflow-hidden bg-slate-800/30 cursor-pointer hover:border-slate-500 group transition-colors"
          title="Developer: Click to simulate scan success"
        >
          {loading ? (
             <div className="absolute inset-0 bg-slate-900/80 flex items-center justify-center z-20">
               <span className="text-blue-400 font-mono animate-pulse">VERIFYING...</span>
             </div>
          ) : (
            <>
              <div className="absolute inset-0 bg-blue-500/5 animate-pulse group-hover:bg-blue-500/10"></div>
              <div className="absolute top-0 left-0 w-full h-1 bg-blue-500 shadow-[0_0_20px_#3b82f6] animate-[scan_2s_ease-in-out_infinite]"></div>
              
              <div className="text-center z-10 opacity-70 group-hover:opacity-100 transition-opacity">
                <CreditCard size={48} className="mx-auto text-slate-400 mb-4" />
                <p className="text-slate-300 font-medium">Place ID / Passport Here</p>
                <p className="text-xs text-slate-500 mt-2">(Tap to Simulate)</p>
              </div>
            </>
          )}
        </div>

        <h2 className="text-3xl font-light text-white mb-2">Scanning Document</h2>
        <p className="text-slate-400">Please hold your ID steady...</p>
        
        {/* Developer / Manual Trigger (Explicit) */}
        <button 
          onClick={() => emit('SCAN_COMPLETED')}
          disabled={loading}
          className="mt-8 flex items-center gap-2 px-6 py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-full text-sm border border-slate-700 transition-colors"
        >
          <ScanLine size={16} />
          <span>Simulate Scan Success</span>
        </button>
      </div>

      <style>{`
        @keyframes scan {
          0% { transform: translateY(0); opacity: 0.5; }
          50% { transform: translateY(250px); opacity: 1; }
          100% { transform: translateY(0); opacity: 0.5; }
        }
      `}</style>
    </div>
  );
};