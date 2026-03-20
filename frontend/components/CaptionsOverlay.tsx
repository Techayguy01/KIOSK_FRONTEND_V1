import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MessageCircle, ChevronDown, Volume2 } from 'lucide-react';
import { AgentAdapter } from '../agent/adapter';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { VoiceRuntime } from '../voice/VoiceRuntime';
import { TTSController } from '../voice/TTSController';

/**
 * CaptionsOverlay (B+C Mode)
 *
 * User speech  → large center overlay (unchanged — guest needs STT confirmation)
 * AI speech    → hidden from overlay; small collapsible 💬 pill in bottom-right
 *
 * The pill matches the existing VoiceStatusIndicator / kiosk glassmorphism style:
 *   border-cyan-400/60  bg-slate-950/90  backdrop-blur-md  rounded-full
 */

export const CaptionsOverlay: React.FC = () => {
    const prefersReducedMotion = usePrefersReducedMotion();

    // User transcript state (shown as large overlay)
    const [userText, setUserText] = useState("");
    const [showUser, setShowUser] = useState(false);

    // AI transcript state (shown in collapsible bubble)
    const [aiText, setAiText] = useState("");
    const [aiSpeaking, setAiSpeaking] = useState(false);
    const [expanded, setExpanded] = useState(false);

    // Accessibility: screen reader announcement
    const [aiAnnouncement, setAiAnnouncement] = useState("");

    const userHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const aiHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    const clearUserTimer = () => {
        if (userHideRef.current) { clearTimeout(userHideRef.current); userHideRef.current = null; }
    };
    const clearAiTimer = () => {
        if (aiHideRef.current) { clearTimeout(aiHideRef.current); aiHideRef.current = null; }
    };

    // Auto-scroll expanded panel
    useEffect(() => {
        if (expanded && scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [expanded, aiText]);

    useEffect(() => {
        // === User transcript (large overlay — keep as-is) ===
        const unsubTranscript = AgentAdapter.onTranscript((text, isFinal, source) => {
            if (source === 'user') {
                clearUserTimer();
                setShowUser(true);
                setUserText(text);
                if (isFinal) {
                    userHideRef.current = setTimeout(() => {
                        setUserText("");
                        setShowUser(false);
                        userHideRef.current = null;
                    }, 2500);
                }
                return;
            }

            // AI text via transcript event (text-only fallback if TTS is off)
            if (!TTSController.isSpeaking() && text.trim()) {
                clearAiTimer();
                setAiText(text);
                setAiSpeaking(true);
                setAiAnnouncement(text);
                aiHideRef.current = setTimeout(() => {
                    setAiSpeaking(false);
                    setExpanded(false);
                    aiHideRef.current = null;
                }, 3500);
            }
        });

        // === AI TTS lifecycle → controls bubble visibility ===
        const unsubTTS = TTSController.subscribe((event) => {
            if (event.type === 'TTS_STARTED') {
                clearAiTimer();
                setAiText(event.text);
                setAiSpeaking(true);
                setAiAnnouncement(event.text);
                return;
            }
            if (event.type === 'TTS_ENDED') {
                aiHideRef.current = setTimeout(() => {
                    setAiSpeaking(false);
                    setExpanded(false);
                    aiHideRef.current = null;
                }, 2000);
                return;
            }
            if (event.type === 'TTS_CANCELLED') {
                setAiSpeaking(false);
                setExpanded(false);
                return;
            }
            if (event.type === 'TTS_ERROR' && event.text?.trim()) {
                // Show text as fallback if TTS fails
                clearAiTimer();
                setAiText(event.text);
                setAiSpeaking(true);
                setAiAnnouncement(event.text);
                aiHideRef.current = setTimeout(() => {
                    setAiSpeaking(false);
                    setExpanded(false);
                    aiHideRef.current = null;
                }, 3500);
            }
        });

        const unsubVoice = VoiceRuntime.subscribe((event) => {
            if (event.type === 'VOICE_SESSION_ENDED' || event.type === 'VOICE_SESSION_ABORTED') {
                clearUserTimer();
                clearAiTimer();
                setShowUser(false);
                setUserText("");
                setAiSpeaking(false);
                setExpanded(false);
            }
        });

        return () => {
            unsubTranscript();
            unsubTTS();
            unsubVoice();
            clearUserTimer();
            clearAiTimer();
        };
    }, []);

    const MotionDiv = motion.div as any;

    return (
        <>
            {/* Screen reader announcement (unchanged) */}
            <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                {aiAnnouncement}
            </div>

            {/* === USER TRANSCRIPT: large center overlay (unchanged behavior) === */}
            <div className="fixed top-[68%] left-0 w-full flex justify-center z-50 pointer-events-none px-6" aria-live="off">
                <AnimatePresence mode="wait">
                    {showUser && userText && (
                        <MotionDiv
                            key="user-caption"
                            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
                            animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -10 }}
                            transition={{ duration: prefersReducedMotion ? 0.12 : 0.2 }}
                            className="max-w-4xl text-center text-blue-100 drop-shadow-lg"
                        >
                            <div
                                className="text-[10px] font-bold uppercase tracking-widest mb-2 opacity-80 text-blue-300"
                                aria-hidden="true"
                            >
                                Guest Speaking
                            </div>
                            <p
                                className="text-2xl md:text-3xl font-medium leading-relaxed tracking-wide"
                                style={{ textShadow: '0 2px 10px rgba(0,0,0,0.5)' }}
                            >
                                {userText}
                                <span
                                    className={`inline-block w-2 h-6 ml-1 bg-blue-400 align-middle rounded-full ${prefersReducedMotion ? '' : 'animate-pulse'}`}
                                    aria-hidden="true"
                                />
                            </p>
                        </MotionDiv>
                    )}
                </AnimatePresence>
            </div>

            {/* === AI TRANSCRIPT: collapsible 💬 pill (bottom-right) === */}
            <div className="fixed bottom-20 right-6 z-40 pointer-events-auto flex flex-col items-end gap-2">
                <AnimatePresence>
                    {/* Expanded panel */}
                    {aiSpeaking && expanded && aiText && (
                        <MotionDiv
                            key="ai-expanded"
                            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.97 }}
                            animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
                            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.97 }}
                            transition={{ duration: prefersReducedMotion ? 0.1 : 0.2 }}
                            className="w-[480px] rounded-2xl border border-cyan-400/30 bg-slate-950/92 p-5 shadow-xl backdrop-blur-xl"
                        >
                            <div className="flex items-center justify-between mb-2">
                                <span className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-cyan-300/90">
                                    <Volume2 size={14} className={prefersReducedMotion ? '' : 'animate-pulse'} />
                                    Siya AI Speaking
                                </span>
                                <button
                                    onClick={() => setExpanded(false)}
                                    className="rounded-full p-1 text-slate-400 transition hover:bg-white/10 hover:text-white"
                                    aria-label="Collapse transcript"
                                >
                                    <ChevronDown size={14} />
                                </button>
                            </div>
                            <div
                                ref={scrollRef}
                                className="max-h-[180px] overflow-y-auto text-lg leading-relaxed text-slate-100 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-700/50"
                            >
                                {aiText}
                            </div>
                        </MotionDiv>
                    )}

                    {/* Collapsed pill */}
                    {aiSpeaking && !expanded && (
                        <MotionDiv
                            key="ai-pill"
                            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
                            animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
                            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
                            transition={{ duration: prefersReducedMotion ? 0.1 : 0.2 }}
                        >
                            <button
                                onClick={() => setExpanded(true)}
                                className="flex items-center gap-2.5 rounded-full border border-cyan-400/50 bg-slate-950/90 px-5 py-3 text-sm font-medium text-cyan-100 shadow-xl backdrop-blur-md transition hover:border-cyan-400/70 hover:brightness-110"
                                aria-label="Show Siya's transcript"
                            >
                                <MessageCircle size={18} className="text-cyan-400" />
                                <span>Siya is speaking…</span>
                                <Volume2 size={16} className={`text-cyan-400/70 ${prefersReducedMotion ? '' : 'animate-pulse'}`} />
                            </button>
                        </MotionDiv>
                    )}
                </AnimatePresence>
            </div>
        </>
    );
};
