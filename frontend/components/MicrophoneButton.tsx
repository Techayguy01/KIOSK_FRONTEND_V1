import React from 'react';
import { Mic } from 'lucide-react';

interface MicrophoneButtonProps {
  listening: boolean;
  onClick: () => void;
}

export const MicrophoneButton: React.FC<MicrophoneButtonProps> = ({ listening, onClick }) => {
  return (
    <button
      onClick={onClick}
      className={`relative flex items-center justify-center w-20 h-20 rounded-full transition-all duration-300 ${
        listening ? 'bg-red-500 scale-110 shadow-[0_0_20px_rgba(239,68,68,0.5)]' : 'bg-slate-700 hover:bg-slate-600'
      }`}
    >
      {listening && (
        <span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75 animate-ping"></span>
      )}
      <Mic className={`w-8 h-8 ${listening ? 'text-white' : 'text-slate-300'}`} />
    </button>
  );
};