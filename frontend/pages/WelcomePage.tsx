import React from 'react';
import { useUIState } from '../state/uiContext';
import { useFadeIn } from '../hooks/useAnimation';
import { Keyboard, Mic, CalendarCheck, BedDouble, HelpCircle } from 'lucide-react';
import { Button } from '../components/ui/button';
import AnimatedGradientBackground from '../components/ui/animated-gradient-background';
import HoverRevealCards from '../components/ui/hover-reveal-cards';
import { VoiceRuntime } from '../voice/VoiceRuntime';

interface WelcomePageProps {
  /**
   * CRITICAL: 
   * visualMode is PRESENTATIONAL ONLY. 
   * This component must NEVER infer navigation or flow based on this prop.
   */
  visualMode?: 'voice' | 'manual';
}

export const WelcomePage: React.FC<WelcomePageProps> = ({ visualMode = 'voice' }) => {
  const { emit } = useUIState();
  const fade = useFadeIn(200);

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
  // Note: Orb, SIYA text, and mic controls are now handled by GlobalOrbOverlay
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

      {/* 2. MIDDLE - Content area (Orb handled globally by GlobalOrbOverlay) */}
      <div className="flex-1 flex flex-col items-center justify-center relative z-10 min-h-0 w-full">
        {/* Empty - orb and controls are now in GlobalOrbOverlay */}
      </div>
    </div>
  );
};
