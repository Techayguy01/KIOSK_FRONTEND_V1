import React, { useEffect, useState, useRef } from 'react';
import { AgentAdapter } from '../agent/adapter';
import { AnimatePresence, motion } from 'framer-motion';

export const CaptionsOverlay: React.FC = () => {
    const [userText, setUserText] = useState("");
    const [aiText, setAiText] = useState("");
    const [mode, setMode] = useState<'user' | 'ai' | null>(null);
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        const unsub = AgentAdapter.onTranscript((text, isFinal, source) => {
            // Clear previous timeout
            if (timeoutRef.current) clearTimeout(timeoutRef.current);

            setMode(source);
            if (source === 'user') setUserText(text);
            if (source === 'ai') setAiText(text);

            // Auto-hide after 4 seconds of silence (only if final or AI)
            // Note: AI text is always final in our adapter.
            if (isFinal || source === 'ai') {
                timeoutRef.current = setTimeout(() => {
                    setMode(null);
                    setUserText("");
                    setAiText("");
                }, 4000);
            }
        });
        return unsub;
    }, []);

    const MotionDiv = motion.div as any;

    return (
        <div className="fixed bottom-32 left-0 w-full flex justify-center z-50 pointer-events-none px-6">
            <AnimatePresence mode="wait">
                {mode && (
                    <MotionDiv
                        initial={{ opacity: 0, y: 20, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        className={`
                            backdrop-blur-xl px-8 py-4 rounded-2xl shadow-2xl max-w-3xl text-center
                            border transition-colors duration-500
                            ${mode === 'user'
                                ? 'bg-black/60 border-blue-500/30 text-blue-50'
                                : 'bg-white/90 border-emerald-500/30 text-slate-900'}
                        `}
                    >
                        {/* Label */}
                        <div className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${mode === 'user' ? 'text-blue-400' : 'text-emerald-600'
                            }`}>
                            {mode === 'user' ? 'Listening...' : 'Siya AI'}
                        </div>

                        {/* Text Content */}
                        <p className="text-xl md:text-2xl font-medium leading-relaxed">
                            {mode === 'user' ? (
                                <>
                                    {userText}
                                    <span className="inline-block w-2 h-5 ml-1 bg-blue-400 animate-pulse align-middle" />
                                </>
                            ) : (
                                aiText
                            )}
                        </p>
                    </MotionDiv>
                )}
            </AnimatePresence>
        </div>
    );
};
