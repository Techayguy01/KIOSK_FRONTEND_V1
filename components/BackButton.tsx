import React from 'react';
import { useUIState } from '../state/uiContext';
import { ArrowLeft } from 'lucide-react';

export const BackButton: React.FC = () => {
  const { data, emit, loading } = useUIState();

  // STRICT RULE: Backend controls visibility via metadata
  const canGoBack = data.metadata?.canGoBack === true;

  if (!canGoBack) {
    return null;
  }

  return (
    <button
      onClick={() => !loading && emit('BACK_REQUESTED')}
      disabled={loading}
      className="absolute top-8 left-8 z-50 flex items-center gap-2 px-4 py-2 rounded-full bg-slate-800/50 hover:bg-slate-700 text-slate-300 hover:text-white backdrop-blur-md border border-slate-700 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
      aria-label="Go Back"
    >
      <ArrowLeft size={20} />
      <span className="text-sm font-medium hidden md:inline">Back</span>
    </button>
  );
};