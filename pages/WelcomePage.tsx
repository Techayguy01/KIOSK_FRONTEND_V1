import React, { useState, useEffect, useRef } from 'react';
import { useUIState } from '../state/uiContext';
import { useFadeIn } from '../hooks/useAnimation';
import { Keyboard, Mic, CalendarCheck, BedDouble, HelpCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '../components/ui/button';
import { Orb, OrbState } from '../components/ui/orb';
import AnimatedGradientBackground from '../components/ui/animated-gradient-background';
import HoverRevealCards from '../components/ui/hover-reveal-cards';

// Local type for UI logic (compatible with OrbState via mapping)
type AgentState = "idle" | "listening" | "thinking" | "talking" | null

export const WelcomePage: React.FC = () => {
  const { data, emit, loading } = useUIState();
  const [mode, setMode] = useState<'voice' | 'manual'>('voice');

  // Local state for immediate UI feedback (overrides backend temporarily)
  const [interactionState, setInteractionState] = useState<AgentState>(null);

  const messages = data.messages || [];
  const fade = useFadeIn(200);

  // Calculate the effective state of the agent
  const getAgentState = (): AgentState => {
    if (interactionState) return interactionState;
    if (data.listening) return 'listening';
    if (loading) return 'thinking';
    return 'idle';
  };

  // Map local AgentState to OrbState (null | "thinking" | "listening" | "talking")
  const getOrbState = (state: AgentState): OrbState => {
    switch (state) {
      case 'listening': return 'listening';
      case 'thinking': return 'thinking';
      case 'talking': return 'talking';
      case 'idle':
      default: return null;
    }
  };

  const handleInteractionStart = () => {
    setInteractionState('listening');
    emit('VOICE_INPUT_START');
  };

  const handleInteractionEnd = () => {
    setInteractionState('thinking');
    emit('VOICE_INPUT_END');

    // Clear local override after a delay to let backend state take over
    setTimeout(() => {
      setInteractionState(null);
    }, 2000);
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
            onClick: () => emit('HELP_SELECTED'),
          },
        ]}
      />

      <div className="mt-16">
        <Button
          variant="ghost"
          onClick={() => setMode('voice')}
          className="flex items-center gap-2 text-slate-500 hover:text-white"
        >
          <Mic size={18} />
          <span>Switch to Voice Mode</span>
        </Button>
      </div>
    </div>
  );

  if (mode === 'manual') {
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
          onClick={() => setMode('manual')}
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

        {/* Orb container with inner glow and shadow */}
        <div
          className="w-[300px] h-[300px] md:w-[450px] md:h-[450px] rounded-full relative"
          style={{
            // Outer shadow for depth
            boxShadow: '0 25px 60px rgba(0, 0, 0, 0.6), 0 10px 30px rgba(0, 0, 0, 0.4)',
          }}
        >
          {/* Inner glow ring */}
          <div
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              // Inner glow effect using inset box-shadow
              boxShadow: 'inset 0 0 40px 10px rgba(147, 197, 253, 0.3), inset 0 0 80px 20px rgba(96, 165, 250, 0.15)',
            }}
          />
          {/* Dark backing circle for contrast */}
          <div
            className="absolute inset-[3px] rounded-full bg-slate-950/80 pointer-events-none"
            style={{
              boxShadow: 'inset 0 0 20px 5px rgba(0, 0, 0, 0.5)',
            }}
          />
          {/* The orb itself */}
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
            {messages.slice(-1).map((msg: any) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className={`text-lg md:text-xl font-light leading-relaxed ${msg.role === 'user' ? 'text-slate-400 italic' : 'text-slate-100'
                  }`}
              >
                {msg.text}
              </motion.div>
            ))}
            {messages.length === 0 && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-slate-500 text-lg"
              >
                "Hello, I'd like to check in..."
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {/* Mic Button - The Core Interaction */}
        <div className="relative group">
          {/* Ripple Effect when listening */}
          {getAgentState() === 'listening' && (
            <div className="absolute inset-0 bg-blue-500/20 rounded-full animate-ping" />
          )}

          <button
            className={`relative flex items-center justify-center w-24 h-24 rounded-full transition-all duration-200 active:scale-95 shadow-lg ${getAgentState() === 'listening'
              ? 'bg-blue-600 text-white shadow-blue-500/50 scale-110'
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
              }`}
            onMouseDown={handleInteractionStart}
            onMouseUp={handleInteractionEnd}
            onTouchStart={(e) => { e.preventDefault(); handleInteractionStart(); }}
            onTouchEnd={(e) => { e.preventDefault(); handleInteractionEnd(); }}
            aria-label="Hold to speak"
          >
            <Mic size={32} className={getAgentState() === 'listening' ? 'animate-pulse' : ''} />
          </button>
        </div>

        <p className="text-xs text-slate-500 uppercase tracking-widest font-medium">Hold to Speak</p>
      </div>
    </div>
  );
};