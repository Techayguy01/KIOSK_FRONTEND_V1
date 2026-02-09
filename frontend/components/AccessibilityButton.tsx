import React from 'react';
import { Settings } from 'lucide-react';
import { useUIState } from '../state/uiContext';

/**
 * AccessibilityButton
 * 
 * Fixed position button at TOP-LEFT corner for accessibility settings.
 * Visible on all pages except IDLE.
 */
export const AccessibilityButton: React.FC = () => {
    const { state } = useUIState();

    // Hide only on IDLE page
    if (state === 'IDLE') {
        return null;
    }

    return (
        <button
            className="fixed top-6 left-6 z-50 w-12 h-12 rounded-full bg-slate-800/60 backdrop-blur-sm border border-slate-700/50 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700/70 transition-all duration-200 shadow-lg"
            onClick={() => console.log('[Accessibility] Settings clicked')}
            aria-label="Accessibility Settings"
        >
            <Settings size={20} />
        </button>
    );
};

