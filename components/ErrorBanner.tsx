import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ErrorBannerProps {
  message: string;
  onDismiss: () => void;
}

export const ErrorBanner: React.FC<ErrorBannerProps> = ({ message, onDismiss }) => {
  return (
    <div className="fixed top-8 left-1/2 -translate-x-1/2 w-full max-w-lg z-50 animate-bounce-in">
      <div className="bg-red-500/10 backdrop-blur-md border border-red-500/50 text-red-200 p-4 rounded-xl shadow-2xl flex items-center gap-4">
        <AlertTriangle className="text-red-500 shrink-0" size={24} />
        <p className="flex-1 font-medium">{message}</p>
        <button 
          onClick={onDismiss}
          className="p-1 hover:bg-red-500/20 rounded-lg transition-colors"
        >
          <X size={20} />
        </button>
      </div>
    </div>
  );
};