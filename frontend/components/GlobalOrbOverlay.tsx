import React, { useState, useEffect } from 'react';
import { useUIState } from '../state/uiContext';
import { Orb, OrbState } from './ui/orb';
import { VoiceRuntime, VoiceTurnState } from '../voice/VoiceRuntime';
import { Mic, StopCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { UiState } from '../agent/index';

/**
 * GlobalOrbOverlay
 * 
 * Renders the voice orb persistently across all pages during an active voice session.
 * 
 * Position Logic:
 * - WELCOME, AI_CHAT: Centered (large orb with SIYA text)
 * - SCAN_ID, ROOM_SELECT, PAYMENT, KEY_DISPENSING, COMPLETE: Bottom-left (compact orb)
 * - IDLE, MANUAL_MENU, ERROR: Hidden
 */

type AgentState = "idle" | "listening" | "thinking" | "talking" | null;

// Pages where orb should be hidden
const HIDDEN_PAGES: UiState[] = ['IDLE', 'MANUAL_MENU', 'ERROR'];

// Pages where orb should be centered (large)
const CENTERED_PAGES: UiState[] = ['WELCOME', 'AI_CHAT'];

// ============================================================================
// Reusable Sub-Components
// ============================================================================

interface OrbContainerProps {
    size: 'large' | 'compact';
    orbState: OrbState;
}

/**
 * Reusable orb container with consistent styling
 */
const OrbContainer: React.FC<OrbContainerProps> = ({ size, orbState }) => {
    const isLarge = size === 'large';

    // Size classes
    const sizeClass = isLarge
        ? 'w-[300px] h-[300px] md:w-[450px] md:h-[450px]'
        : 'w-[120px] h-[120px]';

    // Box shadow intensity varies by size
    const outerShadow = isLarge
        ? '0 25px 60px rgba(0, 0, 0, 0.6), 0 10px 30px rgba(0, 0, 0, 0.4)'
        : '0 15px 40px rgba(0, 0, 0, 0.5), 0 5px 15px rgba(0, 0, 0, 0.3)';

    const innerGlow = isLarge
        ? 'inset 0 0 40px 10px rgba(147, 197, 253, 0.3), inset 0 0 80px 20px rgba(96, 165, 250, 0.15)'
        : 'inset 0 0 20px 5px rgba(147, 197, 253, 0.15), inset 0 0 40px 10px rgba(96, 165, 250, 0.08)';

    const darkRingShadow = isLarge
        ? 'inset 0 0 20px 5px rgba(0, 0, 0, 0.5)'
        : 'inset 0 0 10px 3px rgba(0, 0, 0, 0.4)';

    // Compact orb needs offset for centering the aura
    const orbOffset = isLarge ? {} : { left: '8px', top: '5px' };

    return (
        <div
            className={`${sizeClass} rounded-full relative pointer-events-auto flex items-center justify-center overflow-hidden`}
            style={{ boxShadow: outerShadow }}
        >
            {/* Inner glow overlay */}
            <div
                className="absolute inset-0 rounded-full pointer-events-none z-10"
                style={{ boxShadow: innerGlow }}
            />
            {/* Dark ring layer */}
            <div
                className="absolute inset-[3px] rounded-full bg-slate-950/80 pointer-events-none"
                style={{ boxShadow: darkRingShadow }}
            />
            {/* Orb visualization */}
            <div className="absolute inset-0 w-full h-full" style={orbOffset}>
                <Orb agentState={orbState} colors={["#977DFF", "#F2E6EE"]} className="w-full h-full" />
            </div>
        </div>
    );
};

interface MicButtonProps {
    size: 'large' | 'compact';
    isActive: boolean;
    isListening: boolean;
    onClick: () => void;
}

/**
 * Reusable mic button with consistent styling
 */
const MicButton: React.FC<MicButtonProps> = ({ size, isActive, isListening, onClick }) => {
    const isLarge = size === 'large';

    const sizeClass = isLarge ? 'w-24 h-24' : 'w-10 h-10';
    const iconSize = isLarge ? 32 : 18;

    if (isLarge) {
        return (
            <div className="relative group">
                {isListening && (
                    <div className="absolute inset-0 bg-blue-500/20 rounded-full animate-ping" />
                )}
                <button
                    className={`relative flex items-center justify-center ${sizeClass} rounded-full transition-all duration-200 active:scale-95 shadow-lg ${isListening
                        ? 'bg-blue-600 text-white shadow-blue-500/50 scale-110'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
                        }`}
                    onClick={onClick}
                    aria-label={isActive ? "Stop listening" : "Start listening"}
                >
                    {isActive ? (
                        <StopCircle size={iconSize} className="animate-pulse text-red-400" />
                    ) : (
                        <Mic size={iconSize} />
                    )}
                </button>
            </div>
        );
    }

    // Compact mic button
    return (
        <button
            onClick={onClick}
            className={`${sizeClass} rounded-full flex items-center justify-center transition-all duration-200 shadow-md ${isActive
                ? 'bg-red-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
                }`}
            aria-label={isActive ? "Stop listening" : "Start listening"}
        >
            {isActive ? <StopCircle size={iconSize} /> : <Mic size={iconSize} />}
        </button>
    );
};

// ============================================================================
// Main Component
// ============================================================================

export const GlobalOrbOverlay: React.FC = () => {
    const { state } = useUIState();

    // Voice session and interaction state
    const [isSessionActive, setIsSessionActive] = useState(false);
    const [interactionState, setInteractionState] = useState<AgentState>(null);
    const [turnState, setTurnState] = useState<VoiceTurnState>("IDLE");

    // Subscribe to VoiceRuntime for visual feedback
    useEffect(() => {
        const unsubscribe = VoiceRuntime.subscribe((event) => {
            switch (event.type) {
                case "VOICE_SESSION_STARTED":
                    setIsSessionActive(true);
                    setInteractionState('listening');
                    break;
                case "VOICE_TRANSCRIPT_PARTIAL":
                    break;
                case "VOICE_TRANSCRIPT_READY":
                    setInteractionState('thinking');
                    break;
                case "VOICE_SESSION_ENDED":
                case "VOICE_SESSION_ABORTED":
                    setIsSessionActive(false);
                    setInteractionState(null);
                    break;
            }
        });

        const unsubscribeTurn = VoiceRuntime.onTurnStateChange((voiceState) => {
            setTurnState(voiceState);
            switch (voiceState) {
                case "USER_SPEAKING":
                    setInteractionState('listening');
                    break;
                case "PROCESSING":
                    setInteractionState('thinking');
                    break;
                case "SYSTEM_RESPONDING":
                    setInteractionState('talking');
                    break;
                case "IDLE":
                    setInteractionState(null);
                    break;
            }
        });

        return () => {
            unsubscribe();
            unsubscribeTurn();
        };
    }, []);

    // Calculate agent state for Orb animation
    const getAgentState = (): AgentState => interactionState || 'idle';

    // Map AgentState to OrbState
    const getOrbState = (agentState: AgentState): OrbState => {
        switch (agentState) {
            case 'listening': return 'listening';
            case 'thinking': return 'thinking';
            case 'talking': return 'talking';
            default: return null;
        }
    };

    const isMicDisabled = turnState === "PROCESSING" || turnState === "SYSTEM_RESPONDING";

    const toggleVoiceSession = async () => {
        if (isMicDisabled) {
            console.log(`[GlobalOrbOverlay] Mic tap ignored: turnState=${turnState}`);
            return;
        }
        isSessionActive ? VoiceRuntime.endSession() : await VoiceRuntime.startSession();
    };

    // Determine visibility and position
    const isHidden = HIDDEN_PAGES.includes(state as UiState);
    const isCentered = CENTERED_PAGES.includes(state as UiState);

    if (isHidden) return null;

    const orbState = getOrbState(getAgentState());
    const isListening = getAgentState() === 'listening';

    // Centered Layout (Welcome/AI_CHAT pages)
    if (isCentered) {
        return (
            <div className="fixed inset-0 z-40 pointer-events-none flex flex-col">
                <div className="flex-1 flex flex-col items-center justify-center relative mt-24">
                    {/* SIYA text */}
                    <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.8, ease: "easeOut" }}
                        className="text-5xl md:text-6xl font-black tracking-wider mb-6"
                        style={{
                            fontFamily: "'Montserrat', sans-serif",
                            fontWeight: 900,
                            background: 'linear-gradient(135deg, #977DFF 0%, #c4b5fd 50%, #977DFF 100%)',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                            backgroundClip: 'text',
                            textShadow: '0 0 60px rgba(151, 125, 255, 0.4)',
                        }}
                    >
                        SIYA
                    </motion.div>

                    <OrbContainer size="large" orbState={orbState} />
                </div>

                {/* Bottom controls */}
                <div className="flex-none w-full pb-12 px-6 flex flex-col items-center gap-8 pointer-events-auto">
                    <div className="w-full max-w-lg min-h-[80px] pointer-events-none" />
                    <MicButton size="large" isActive={isSessionActive} isListening={isListening} onClick={toggleVoiceSession} />
                    <p className="text-xs text-slate-500 uppercase tracking-widest font-medium">
                        {isSessionActive ? "Tap to Stop" : "Tap to Speak"}
                    </p>
                </div>
            </div>
        );
    }

    // Compact Bottom-Left Layout (other pages)
    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0, scale: 0.8, x: -50 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.8, x: -50 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="fixed bottom-6 left-6 z-40 flex flex-col items-center gap-4 pointer-events-auto"
            >
                <OrbContainer size="compact" orbState={orbState} />
                <MicButton size="compact" isActive={isSessionActive} isListening={isListening} onClick={toggleVoiceSession} />
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">SIYA</p>
            </motion.div>
        </AnimatePresence>
    );
};
