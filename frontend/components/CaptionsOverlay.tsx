import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AgentAdapter } from '../agent/adapter';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { VoiceRuntime } from '../voice/VoiceRuntime';
import { TTSController } from '../voice/TTSController';

export const CaptionsOverlay: React.FC = () => {
    const prefersReducedMotion = usePrefersReducedMotion();

    const [userText, setUserText] = useState("");
    const [aiText, setAiText] = useState("");
    const [mode, setMode] = useState<'user' | 'ai' | null>(null);
    const [aiAnnouncement, setAiAnnouncement] = useState("");

    const userHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const aiHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearUserHideTimer = () => {
        if (userHideTimeoutRef.current) {
            clearTimeout(userHideTimeoutRef.current);
            userHideTimeoutRef.current = null;
        }
    };

    const clearAiHideTimer = () => {
        if (aiHideTimeoutRef.current) {
            clearTimeout(aiHideTimeoutRef.current);
            aiHideTimeoutRef.current = null;
        }
    };

    const clearAll = () => {
        clearUserHideTimer();
        clearAiHideTimer();
        setMode(null);
        setUserText("");
        setAiText("");
    };

    const scheduleAiHide = (delayMs: number) => {
        clearAiHideTimer();
        aiHideTimeoutRef.current = setTimeout(() => {
            setAiText("");
            setMode((current) => (current === 'ai' ? null : current));
            aiHideTimeoutRef.current = null;
        }, delayMs);
    };

    useEffect(() => {
        const unsubTranscript = AgentAdapter.onTranscript((text, isFinal, source) => {
            if (source === 'user') {
                clearUserHideTimer();
                setMode('user');
                setUserText(text);

                // Keep user transcript visual but avoid long lingering lines.
                if (isFinal) {
                    userHideTimeoutRef.current = setTimeout(() => {
                        setUserText("");
                        setMode((current) => (current === 'user' ? null : current));
                        userHideTimeoutRef.current = null;
                    }, 2500);
                }
                return;
            }

            // Compatibility fallback: if AI text arrives without an active TTS session,
            // show it briefly so text-only fallback remains visible.
            if (!TTSController.isSpeaking() && text.trim()) {
                clearAiHideTimer();
                setMode('ai');
                setAiText(text);
                setAiAnnouncement(text);
                scheduleAiHide(3500);
            }
        });

        const unsubTTS = TTSController.subscribe((event) => {
            if (event.type === 'TTS_STARTED') {
                clearAiHideTimer();
                setMode('ai');
                setAiText(event.text);
                setAiAnnouncement(event.text);
                return;
            }

            if (event.type === 'TTS_ENDED') {
                scheduleAiHide(800);
                return;
            }

            if (event.type === 'TTS_CANCELLED') {
                scheduleAiHide(200);
                return;
            }

            if (event.type === 'TTS_ERROR') {
                if (event.text?.trim()) {
                    clearAiHideTimer();
                    setMode('ai');
                    setAiText(event.text);
                    setAiAnnouncement(event.text);
                    scheduleAiHide(3500);
                }
            }
        });

        const unsubVoice = VoiceRuntime.subscribe((event) => {
            if (event.type === 'VOICE_SESSION_ENDED' || event.type === 'VOICE_SESSION_ABORTED') {
                clearAll();
            }
        });

        return () => {
            unsubTranscript();
            unsubTTS();
            unsubVoice();
            clearAll();
        };
    }, []);

    const MotionDiv = motion.div as any;

    return (
        <>
            <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                {aiAnnouncement}
            </div>

            <div className="fixed top-[68%] left-0 w-full flex justify-center z-50 pointer-events-none px-6" aria-live="off">
                <AnimatePresence mode="wait">
                    {mode && (
                        <MotionDiv
                            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
                            animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -10 }}
                            transition={{ duration: prefersReducedMotion ? 0.12 : 0.2 }}
                            className={`
                                max-w-4xl text-center
                                transition-colors duration-500
                                ${mode === 'user' ? 'text-blue-100 drop-shadow-lg' : 'text-emerald-100 drop-shadow-lg'}
                            `}
                        >
                            <div
                                className={`text-[10px] font-bold uppercase tracking-widest mb-2 opacity-80 ${mode === 'user' ? 'text-blue-300' : 'text-emerald-300'}`}
                                aria-hidden="true"
                            >
                                {mode === 'user' ? 'Guest Speaking' : 'Siya AI Speaking'}
                            </div>

                            <p
                                className="text-2xl md:text-3xl font-medium leading-relaxed tracking-wide"
                                style={{ textShadow: '0 2px 10px rgba(0,0,0,0.5)' }}
                            >
                                {mode === 'user' ? (
                                    <>
                                        {userText}
                                        <span
                                            className={`inline-block w-2 h-6 ml-1 bg-blue-400 align-middle rounded-full ${prefersReducedMotion ? '' : 'animate-pulse'}`}
                                            aria-hidden="true"
                                        />
                                    </>
                                ) : (
                                    aiText
                                )}
                            </p>
                        </MotionDiv>
                    )}
                </AnimatePresence>
            </div>
        </>
    );
};
