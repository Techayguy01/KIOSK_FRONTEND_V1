import React, { useState, useEffect, useRef } from 'react';
import { useUIState } from '../state/uiContext';
import { useFadeIn } from '../hooks/useAnimation';
import { Keyboard, Mic, CalendarCheck, BedDouble, HelpCircle, StopCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '../components/ui/button';
import { Orb, OrbState } from '../components/ui/orb';
import AnimatedGradientBackground from '../components/ui/animated-gradient-background';
import HoverRevealCards from '../components/ui/hover-reveal-cards';
import { VoiceRuntime, VoiceTurnState } from '../voice/VoiceRuntime'; // Phase 8.4 Turn Control

// Local type for UI logic (compatible with OrbState via mapping)
type AgentState = "idle" | "listening" | "thinking" | "talking" | null

interface WelcomePageProps {
  /**
   * CRITICAL: 
   * visualMode is PRESENTATIONAL ONLY. 
   * This component must NEVER infer navigation or flow based on this prop.
   */
  visualMode?: 'voice' | 'manual';
}

export const WelcomePage: React.FC<WelcomePageProps> = ({ visualMode = 'voice' }) => {
  const { data, emit, loading } = useUIState();

  // Internal animation state only - NOT navigational state
  const [interactionState, setInteractionState] = useState<AgentState>(null);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState<string>("");

  // Phase 8.4: Track voice turn state for UI control
  const [turnState, setTurnState] = useState<VoiceTurnState>("IDLE");

  const fade = useFadeIn(200);

  // Subscribe to VoiceRuntime for visual feedback only
  useEffect(() => {
    const unsubscribe = VoiceRuntime.subscribe((event) => {
      switch (event.type) {
        case "VOICE_SESSION_STARTED":
          setIsSessionActive(true);
          setInteractionState('listening');
          setLiveTranscript("");
          break;
        case "VOICE_TRANSCRIPT_PARTIAL":
          // Live display of interim transcript
          setLiveTranscript(event.transcript);
          break;
        case "VOICE_TRANSCRIPT_READY":
          setInteractionState('thinking');
          setLiveTranscript(event.transcript);
          break;
        case "VOICE_SESSION_ENDED":
          setIsSessionActive(false);
          setInteractionState(null); // Return to idle/Agent authority
          // Keep liveTranscript visible briefly, then clear
          setTimeout(() => setLiveTranscript(""), 2000);
          break;
      }
    });

    // Phase 8.4: Subscribe to turn state changes
    const unsubscribeTurn = VoiceRuntime.onTurnStateChange((state) => {
      setTurnState(state);

      // Map turn state to interaction state for Orb
      switch (state) {
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



  // Calculate the effective state of the agent for Orb animation
  const getAgentState = (): AgentState => {
    if (interactionState) return interactionState;
    if (loading) return 'thinking';
    return 'idle';
  };

  // Map local AgentState to OrbState
  const getOrbState = (state: AgentState): OrbState => {
    switch (state) {
      case 'listening': return 'listening';
      case 'thinking': return 'thinking';
      case 'talking': return 'talking';
      case 'idle':
      default: return null;
    }
  };

  // Phase 8.4: Check if mic button should be disabled
  const isMicDisabled = turnState === "PROCESSING" || turnState === "SYSTEM_RESPONDING";

  const toggleVoiceSession = async () => {
    // Phase 8.4: Respect turn control - mic only works when IDLE or USER_SPEAKING
    if (isMicDisabled) {
      console.log(`[WelcomePage] Mic tap ignored: turnState=${turnState}`);
      return;
    }

    if (isSessionActive) {
      VoiceRuntime.endSession();
    } else {
      await VoiceRuntime.startSession();
    }
  };

  const ManualMode = () => (
    <div className={`flex flex-col items-center justify-center h-full w-full max-w-4xl mx-auto p-6 ${fade}`}>
      <div className="text-center mb-12">
        <h2 className="text-4xl font-light text-white mb-4">Welcome to Nexus</h2>
        <p className="text-slate-400 text-lg">How would you like to proceed?</p>
      </div>

      <HoverRevealCards
        items={[
          {
            id: 'check-in',
            title: 'Check In',
            subtitle: 'I have a reservation',
            icon: <CalendarCheck size={40} />,
            accentColor: 'blue',
            onClick: () => emit('CHECK_IN_SELECTED'),
          },
          {
            id: 'book-room',
            title: 'Book Room',
            subtitle: 'Walk-in reservation',
            icon: <BedDouble size={40} />,
            accentColor: 'purple',
            onClick: () => emit('BOOK_ROOM_SELECTED'),
          },
          {
            id: 'help',
            title: 'Help',
            subtitle: 'Call staff member',
            icon: <HelpCircle size={40} />,
            accentColor: 'emerald',
            // onClick: () => emit('HELP_SELECTED'), // Not in contract, ignoring or mapping to Cancel/Voice
            onClick: () => console.warn("Help not implemented in Agent"),
          },
        ]}
      />

      <div className="mt-16">
        <Button
          variant="ghost"
          onClick={() => VoiceRuntime.startSession()} // Use Runtime directly
          className="flex items-center gap-2 text-slate-500 hover:text-white"
        >
          <Mic size={18} />
          <span>Switch to Voice Mode</span>
        </Button>
      </div>
    </div>
  );

  if (visualMode === 'manual') {
    return (
      <div className="h-screen w-full overflow-hidden pt-20 relative">
        <AnimatedGradientBackground Breathing={true} />
        <div className="relative z-10 w-full h-full">
          <ManualMode />
        </div>
      </div>
    );
  }

  // VOICE MODE LAYOUT
  return (
    <div className="h-screen w-full flex flex-col relative overflow-hidden">
      <AnimatedGradientBackground Breathing={true} />

      {/* 1. TOP BAR */}
      <div className="flex-none h-24 w-full px-8 flex items-center justify-end z-20">
        <Button
          variant="outline"
          size="sm"
          onClick={() => emit('TOUCH_SELECTED')} // Atomic Intent
          className="gap-2 bg-slate-800/50 backdrop-blur-md border-slate-700"
        >
          <Keyboard size={16} />
          <span className="hidden sm:inline">Use Touch</span>
        </Button>
      </div>

      {/* 2. MIDDLE - ORB VISUALIZATION */}
      <div className="flex-1 flex flex-col items-center justify-center relative z-10 min-h-0 w-full">
        {/* SIYA text above the orb */}
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

        {/* Orb container */}
        <div
          className="w-[300px] h-[300px] md:w-[450px] md:h-[450px] rounded-full relative"
          style={{
            boxShadow: '0 25px 60px rgba(0, 0, 0, 0.6), 0 10px 30px rgba(0, 0, 0, 0.4)',
          }}
        >
          <div
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              boxShadow: 'inset 0 0 40px 10px rgba(147, 197, 253, 0.3), inset 0 0 80px 20px rgba(96, 165, 250, 0.15)',
            }}
          />
          <div
            className="absolute inset-[3px] rounded-full bg-slate-950/80 pointer-events-none"
            style={{
              boxShadow: 'inset 0 0 20px 5px rgba(0, 0, 0, 0.5)',
            }}
          />
          <div className="absolute inset-0">
            <Orb agentState={getOrbState(getAgentState())} colors={["#977DFF", "#F2E6EE"]} />
          </div>
        </div>
      </div>

      {/* 3. BOTTOM - TRANSCRIPT & CONTROLS */}
      <div className="flex-none w-full pb-12 px-6 flex flex-col items-center gap-8 z-20">

        {/* Chat Transcript Area */}
        <div className="w-full max-w-lg min-h-[80px] flex flex-col justify-end items-center text-center space-y-2 pointer-events-none">
          <AnimatePresence mode="popLayout">
            {liveTranscript ? (
              <motion.div
                key="live-transcript"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="text-lg md:text-xl font-light leading-relaxed text-slate-100"
              >
                {liveTranscript}
              </motion.div>
            ) : (
              <motion.p
                key="placeholder"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-slate-500 text-lg"
              >
                {isSessionActive ? "Listening..." : '"Hello, I\'d like to check in..."'}
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {/* Mic Button - The Core Interaction */}
        <div className="relative group">
          {getAgentState() === 'listening' && (
            <div className="absolute inset-0 bg-blue-500/20 rounded-full animate-ping" />
          )}

          <button
            className={`relative flex items-center justify-center w-24 h-24 rounded-full transition-all duration-200 active:scale-95 shadow-lg ${getAgentState() === 'listening'
              ? 'bg-blue-600 text-white shadow-blue-500/50 scale-110'
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
              }`}
            onClick={toggleVoiceSession} // Tap-to-Toggle
            aria-label={isSessionActive ? "Stop listening" : "Start listening"}
          >
            {isSessionActive ? (
              <StopCircle size={32} className="animate-pulse text-red-400" />
            ) : (
              <Mic size={32} />
            )}
          </button>
        </div>

        <p className="text-xs text-slate-500 uppercase tracking-widest font-medium">
          {isSessionActive ? "Tap to Stop" : "Tap to Speak"}
        </p>
      </div>
    </div>
  );
};
