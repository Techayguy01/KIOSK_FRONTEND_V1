import React, { useEffect, useState, useRef } from 'react';
import { AgentAdapter } from '../agent/adapter';
import { AnimatePresence, motion } from 'framer-motion';
import { VoiceRuntime } from '../voice/VoiceRuntime';

export const CaptionsOverlay: React.FC = () => {
    const [userText, setUserText] = useState("");
    const [aiText, setAiText] = useState("");
    const [mode, setMode] = useState<'user' | 'ai' | null>(null);
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        // 1. Listen for Transcripts
        const unsubTranscript = AgentAdapter.onTranscript((text, isFinal, source) => {
            // Clear previous timeout
            if (timeoutRef.current) clearTimeout(timeoutRef.current);

            setMode(source);
            if (source === 'user') setUserText(text);
            if (source === 'ai') setAiText(text);

            // Auto-hide after 4 seconds of silence (only if final or AI)
            if (isFinal || source === 'ai') {
                timeoutRef.current = setTimeout(() => {
                    setMode(null);
                    setUserText("");
                    setAiText("");
                }, 4000);
            }
        });

        // 2. Listen for Session Lifecycle (Close = Clear Immediately)
        const unsubVoice = VoiceRuntime.subscribe((event) => {
            if (event.type === 'VOICE_SESSION_ENDED' || event.type === 'VOICE_SESSION_ABORTED') {
                if (timeoutRef.current) clearTimeout(timeoutRef.current);
                setMode(null);
                setUserText("");
                setAiText("");
            }
        });

        return () => {
            unsubTranscript();
            unsubVoice();
        };
    }, []);

    const MotionDiv = motion.div as any;

    return (
        // Position moved to top-[68%] to sit between Orb and Bottom Controls
        <div className="fixed top-[68%] left-0 w-full flex justify-center z-50 pointer-events-none px-6">
            <AnimatePresence mode="wait">
                {mode && (
                    <MotionDiv
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className={`
                            max-w-4xl text-center
                            transition-colors duration-500
                            ${mode === 'user'
                                ? 'text-blue-100 drop-shadow-lg'
                                : 'text-emerald-100 drop-shadow-lg'}
                        `}
                    >
                        {/* Label - Keep small and subtle */}
                        <div className={`text-[10px] font-bold uppercase tracking-widest mb-2 opacity-80 ${mode === 'user' ? 'text-blue-300' : 'text-emerald-300'
                            }`}>
                            {mode === 'user' ? 'Listening...' : 'Siya AI'}
                        </div>

                        {/* Text Content - Larger and cleaner */}
                        <p className="text-2xl md:text-3xl font-medium leading-relaxed tracking-wide" style={{ textShadow: '0 2px 10px rgba(0,0,0,0.5)' }}>
                            {mode === 'user' ? (
                                <>
                                    {userText}
                                    <span className="inline-block w-2 h-6 ml-1 bg-blue-400 animate-pulse align-middle rounded-full" />
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
