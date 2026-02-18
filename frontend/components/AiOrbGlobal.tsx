import React, { useState, useEffect } from 'react';
import { useUIState } from '../state/uiContext';
import { UiState } from '../agent/index';

/**
 * AiOrbGlobal — Persistent AI assistant orb visible across pages
 * 
 * Behavior:
 * - WELCOME: Large, centered (main interaction point)
 * - Other pages: Small, bottom-right corner (ambient, always accessible)
 * - Pulses when listening
 * - Tap to activate voice (on non-welcome pages)
 */

interface AiOrbGlobalProps {
    currentState: UiState;
}

export const AiOrbGlobal: React.FC<AiOrbGlobalProps> = ({ currentState }) => {
    const { emit } = useUIState();
    const [isListening, setIsListening] = useState(false);
    const [pulseIntensity, setPulseIntensity] = useState(0);

    // On Welcome page, orb is large and central — handled by WelcomePage itself
    // On other pages, we show a compact floating orb
    const isWelcomePage = currentState === 'WELCOME' || currentState === 'AI_CHAT' || currentState === 'MANUAL_MENU';

    // Don't render on welcome — WelcomePage has its own orb
    if (isWelcomePage) return null;

    // Ambient breathing animation
    useEffect(() => {
        const interval = setInterval(() => {
            setPulseIntensity(prev => {
                const next = prev + 0.05;
                return next > Math.PI * 2 ? 0 : next;
            });
        }, 50);
        return () => clearInterval(interval);
    }, []);

    const breathScale = 1 + Math.sin(pulseIntensity) * 0.08;
    const glowOpacity = 0.4 + Math.sin(pulseIntensity) * 0.2;

    return (
        <div className="fixed bottom-24 right-6 z-40 flex flex-col items-center gap-2">
            {/* Hint text */}
            <div className="bg-slate-800/80 backdrop-blur-sm text-slate-300 text-xs px-3 py-1.5 rounded-full border border-slate-700/50 shadow-lg">
                {isListening ? '🎙️ Listening...' : 'Say something or tap me'}
            </div>

            {/* The Orb */}
            <button
                onClick={() => {
                    setIsListening(!isListening);
                    // Trigger voice input start/stop
                    if (!isListening) {
                        emit('VOICE_STARTED');
                    } else {
                        emit('VOICE_SILENCE');
                    }
                }}
                className="relative group cursor-pointer"
                aria-label="AI Assistant"
            >
                {/* Outer glow ring */}
                <div
                    className="absolute inset-0 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 blur-xl transition-all duration-300"
                    style={{
                        opacity: isListening ? 0.8 : glowOpacity,
                        transform: `scale(${isListening ? 1.5 : breathScale * 1.2})`,
                    }}
                />

                {/* Middle glow */}
                <div
                    className="absolute inset-0 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 blur-md transition-all duration-300"
                    style={{
                        opacity: isListening ? 0.6 : glowOpacity * 0.7,
                        transform: `scale(${isListening ? 1.3 : breathScale * 1.1})`,
                    }}
                />

                {/* Core orb */}
                <div
                    className={`relative w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 ${isListening
                            ? 'bg-gradient-to-br from-blue-400 to-purple-500 shadow-lg shadow-blue-500/50'
                            : 'bg-gradient-to-br from-slate-700 to-slate-800 shadow-lg shadow-slate-900/50 group-hover:from-blue-600 group-hover:to-purple-700'
                        }`}
                    style={{ transform: `scale(${breathScale})` }}
                >
                    {/* Icon */}
                    {isListening ? (
                        <div className="flex gap-0.5 items-end h-6">
                            {[1, 2, 3, 4, 5].map((i) => (
                                <div
                                    key={i}
                                    className="w-1 bg-white rounded-full animate-pulse"
                                    style={{
                                        height: `${8 + Math.random() * 16}px`,
                                        animationDelay: `${i * 0.1}s`,
                                        animationDuration: '0.5s',
                                    }}
                                />
                            ))}
                        </div>
                    ) : (
                        <svg className="w-7 h-7 text-slate-300 group-hover:text-white transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                        </svg>
                    )}
                </div>
            </button>
        </div>
    );
};
