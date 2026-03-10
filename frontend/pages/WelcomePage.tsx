import React, { useEffect, useId, useRef, useState } from 'react';
import { useUIState } from '../state/uiContext';
import { useFadeIn } from '../hooks/useAnimation';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { Keyboard, Mic, CalendarCheck, BedDouble, HelpCircle, StopCircle, Languages, RefreshCw, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '../components/ui/button';
import { Orb, OrbState } from '../components/ui/orb';
import AnimatedGradientBackground from '../components/ui/animated-gradient-background';
import HoverRevealCards from '../components/ui/hover-reveal-cards';
import {
  getAvailableTenantLanguages,
  getCurrentTenantLanguage,
  getDefaultTenantLanguage,
  setCurrentTenantLanguage,
  SupportedTenantLanguage,
} from '../services/tenantContext';
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
  const { data, emit, loading, tenant, refreshTenant } = useUIState();
  const tenantName = tenant?.name || "Nexus";
  const prefersReducedMotion = usePrefersReducedMotion();
  const micStatusId = useId();
  const longPressTimerRef = useRef<number | null>(null);

  // Internal animation state only - NOT navigational state
  const [interactionState, setInteractionState] = useState<AgentState>(null);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState<string>("");

  // Phase 8.4: Track voice turn state for UI control
  const [turnState, setTurnState] = useState<VoiceTurnState>("IDLE");
  const [isLanguagePanelOpen, setIsLanguagePanelOpen] = useState(false);
  const [isSyncingTenant, setIsSyncingTenant] = useState(false);
  const [languageMessage, setLanguageMessage] = useState<string | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<SupportedTenantLanguage>(getCurrentTenantLanguage());

  const fade = useFadeIn(200);
  const availableLanguages = getAvailableTenantLanguages();

  useEffect(() => {
    setSelectedLanguage(getCurrentTenantLanguage());
  }, [tenant]);

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
        case "VOICE_SESSION_ABORTED":
          setIsSessionActive(false);
          setInteractionState(null);
          break;
        case "VOICE_SESSION_ERROR":
          // Keep transcript visible for context, but reflect that active listening ended.
          if (event.reason === "stt_permission_denied" || event.fatal) {
            setIsSessionActive(false);
            setInteractionState(null);
          }
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

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        window.clearTimeout(longPressTimerRef.current);
      }
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
      await VoiceRuntime.startSession(getCurrentTenantLanguage());
    }
  };

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const beginSecretLongPress = () => {
    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      setIsLanguagePanelOpen(true);
      setLanguageMessage(null);
      longPressTimerRef.current = null;
    }, 3200);
  };

  const handleLanguageSelect = async (language: SupportedTenantLanguage) => {
    const appliedLanguage = setCurrentTenantLanguage(language);
    setSelectedLanguage(appliedLanguage);
    setLanguageMessage(`Language set to ${getLanguageLabel(appliedLanguage)}.`);

    if (isSessionActive) {
      VoiceRuntime.endSession();
      await VoiceRuntime.startSession(appliedLanguage);
    }
  };

  const handleTenantSync = async () => {
    setIsSyncingTenant(true);
    setLanguageMessage(null);
    try {
      await refreshTenant();
      const effectiveLanguage = getCurrentTenantLanguage();
      setSelectedLanguage(effectiveLanguage);
      setLanguageMessage(`Synced. Active language is ${getLanguageLabel(effectiveLanguage)}.`);
    } catch {
      setLanguageMessage("Sync failed. Tenant config was not refreshed.");
    } finally {
      setIsSyncingTenant(false);
    }
  };

  const SecretTrigger = ({ className = "" }: { className?: string }) => (
    <button
      type="button"
      className={className}
      onPointerDown={beginSecretLongPress}
      onPointerUp={clearLongPressTimer}
      onPointerLeave={clearLongPressTimer}
      onPointerCancel={clearLongPressTimer}
      aria-label="Hidden language controls"
    >
      {tenantName}
    </button>
  );

  const LanguagePanel = () => {
    if (!isLanguagePanelOpen) return null;

    return (
      <div className="absolute inset-0 z-40 flex items-start justify-start bg-slate-950/30 backdrop-blur-[2px]">
        <div className="m-5 w-[320px] rounded-3xl border border-white/10 bg-slate-950/95 p-5 text-white shadow-2xl shadow-black/50">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300">
                <Languages size={14} />
                Language Control
              </div>
              <p className="mt-2 text-sm text-slate-300">
                Hidden operator panel. Available languages come from tenant config.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsLanguagePanelOpen(false)}
              className="rounded-full border border-white/10 p-2 text-slate-400 transition hover:border-white/20 hover:text-white"
              aria-label="Close language controls"
            >
              <X size={16} />
            </button>
          </div>

          <div className="mb-4 space-y-2">
            {availableLanguages.map((language) => {
              const isActive = selectedLanguage === language;
              return (
                <button
                  key={language}
                  type="button"
                  onClick={() => void handleLanguageSelect(language)}
                  className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition ${
                    isActive
                      ? 'border-cyan-400/80 bg-cyan-500/10 text-white'
                      : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/20 hover:bg-white/[0.06]'
                  }`}
                >
                  <span className="font-medium">{getLanguageLabel(language)}</span>
                  <span className="text-xs uppercase tracking-[0.2em] text-slate-400">
                    {isActive ? 'Active' : 'Select'}
                  </span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => void handleTenantSync()}
            disabled={isSyncingTenant}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw size={16} className={isSyncingTenant ? 'animate-spin' : ''} />
            {isSyncingTenant ? 'Syncing...' : 'Sync Config'}
          </button>

          <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-xs text-slate-400">
            <div>Default: {getLanguageLabel(getDefaultTenantLanguage())}</div>
            <div className="mt-1">Current session: {getLanguageLabel(selectedLanguage)}</div>
            {languageMessage && <div className="mt-2 text-cyan-300">{languageMessage}</div>}
          </div>
        </div>
      </div>
    );
  };

  const ManualMode = () => (
    <div className={`flex flex-col items-center justify-center h-full w-full max-w-4xl mx-auto p-6 ${fade}`}>
      <div className="text-center mb-12">
        <h2 className="text-4xl font-light text-white mb-4">
          Welcome to <SecretTrigger className="rounded-xl px-3 py-1 transition hover:bg-white/5" />
        </h2>
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
          onClick={() => VoiceRuntime.startSession(getCurrentTenantLanguage())} // Use Runtime directly
          aria-label="Switch to voice mode"
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
        <LanguagePanel />
      </div>
    );
  }

  // VOICE MODE LAYOUT
  return (
    <div className="h-screen w-full flex flex-col relative overflow-hidden">
      <AnimatedGradientBackground Breathing={true} />

      {/* 1. TOP BAR */}
      <div className="flex-none h-24 w-full px-8 flex items-center justify-between z-20">
        <div className="text-sm text-white/80 tracking-wide">
          <SecretTrigger className="rounded-xl px-3 py-2 transition hover:bg-white/5" />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => emit('TOUCH_SELECTED')} // Atomic Intent
          aria-label="Switch to touch controls"
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
          initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -20 }}
          animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
          transition={{ duration: prefersReducedMotion ? 0.15 : 0.8, ease: "easeOut" }}
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
            <Orb
              agentState={getOrbState(getAgentState())}
              colors={["#977DFF", "#F2E6EE"]}
              reducedMotion={prefersReducedMotion}
            />
          </div>
        </div>
      </div>

      <LanguagePanel />

      {/* 3. BOTTOM - TRANSCRIPT & CONTROLS */}
      <div className="flex-none w-full pb-12 px-6 flex flex-col items-center gap-8 z-20">

        {/* Chat Transcript Area - REMOVED (Handled by Global CaptionsOverlay) */}
        <div className="w-full max-w-lg min-h-[80px] pointer-events-none">
          {/* Placeholder to keep layout spacing if needed, or remove entirely */}
        </div>

        {/* Mic Button - The Core Interaction */}
        <div className="relative group">
          {getAgentState() === 'listening' && (
            <div className={`absolute inset-0 bg-blue-500/20 rounded-full ${prefersReducedMotion ? '' : 'animate-ping'}`} />
          )}

          <button
            type="button"
            className={`relative flex items-center justify-center w-24 h-24 rounded-full transition-all duration-200 active:scale-95 shadow-lg ${getAgentState() === 'listening'
              ? 'bg-blue-600 text-white shadow-blue-500/50 scale-110'
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
              }`}
            onClick={toggleVoiceSession} // Tap-to-Toggle
            aria-label={isSessionActive ? "Stop listening" : "Start listening"}
            aria-pressed={isSessionActive}
            aria-describedby={micStatusId}
            title={isSessionActive ? "Stop listening" : "Start listening"}
          >
            {isSessionActive ? (
              <StopCircle size={32} className={`${prefersReducedMotion ? '' : 'animate-pulse'} text-red-400`} />
            ) : (
              <Mic size={32} />
            )}
          </button>
        </div>

        <p id={micStatusId} className="text-xs text-slate-500 uppercase tracking-widest font-medium">
          {isSessionActive ? "Tap to Stop" : "Tap to Speak"}
        </p>

        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {`Voice state: ${turnState}. ${isSessionActive ? "Listening is active." : "Listening is inactive."}`}
        </span>
      </div>
    </div>
  );
};

function getLanguageLabel(language: SupportedTenantLanguage): string {
  switch (language) {
    case "hi":
      return "Hindi";
    case "mr":
      return "Marathi";
    case "en":
    default:
      return "English";
  }
}
