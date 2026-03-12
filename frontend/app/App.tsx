import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { UIContext } from '../state/uiContext';
// Agent Authority
import { AgentAdapter } from '../agent/adapter';
import { UiState } from '../agent/index'; // Import directly from source

// Pages
import { IdlePage } from '../pages/IdlePage';
import { WelcomePage } from '../pages/WelcomePage';
import { ScanIdPage } from '../pages/ScanIdPage';
import { IdVerifyPage } from '../pages/IdVerifyPage';
import { CheckInSummaryPage } from '../pages/CheckInSummaryPage';
import { RoomSelectPage } from '../pages/RoomSelectPage';
import { BookingCollectPage } from '../pages/BookingCollectPage';
import { BookingSummaryPage } from '../pages/BookingSummaryPage';
import { PaymentPage } from '../pages/PaymentPage';
import { CompletePage } from '../pages/CompletePage';

// Components
import { ErrorBanner } from '../components/ErrorBanner';
import { BackButton } from '../components/BackButton';
import { CaptionsOverlay } from '../components/CaptionsOverlay';
import { VoiceStatusIndicator } from '../components/VoiceStatusIndicator';
import { SiyaMiniOrb } from '../components/SiyaMiniOrb';
import AnimatedGradientBackground from '../components/ui/animated-gradient-background';
import { buildTenantApiUrl, getTenantHeaders, setTenantContext, TenantPayload } from '../services/tenantContext';

// Tenant slug is derived from the URL route parameter only. No hardcoded default.

const STATE_TO_ROUTE: Record<UiState, string> = {
  IDLE: 'idle',
  WELCOME: 'welcome',
  AI_CHAT: 'ai-chat',
  MANUAL_MENU: 'manual-menu',
  SCAN_ID: 'scan-id',
  ID_VERIFY: 'id-verify',
  CHECK_IN_SUMMARY: 'check-in-summary',
  ROOM_SELECT: 'room-select',
  BOOKING_COLLECT: 'booking-collect',
  BOOKING_SUMMARY: 'booking-summary',
  PAYMENT: 'payment',
  KEY_DISPENSING: 'key-dispensing',
  COMPLETE: 'complete',
  ERROR: 'error',
};

const VOICE_RELEVANT_STATES = new Set<UiState>([
  'WELCOME',
  'AI_CHAT',
  'MANUAL_MENU',
  'ROOM_SELECT',
  'BOOKING_COLLECT',
  'BOOKING_SUMMARY',
  'PAYMENT',
]);

const MINI_SIYA_ORB_STATES = new Set<UiState>([
  'ID_VERIFY',
  'CHECK_IN_SUMMARY',
  'ROOM_SELECT',
  'BOOKING_COLLECT',
  'BOOKING_SUMMARY',
  'COMPLETE',
]);

type JourneyMode = 'voice' | 'manual' | null;

const TenantKioskApp: React.FC = () => {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  // Local UI State (Renderer only)
  const [state, setState] = useState<UiState>('IDLE');
  const [data, setData] = useState<any>({});
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [tenant, setTenant] = useState<TenantPayload | null>(null);
  const [journeyMode, setJourneyMode] = useState<JourneyMode>(null);
  const previousStateRef = useRef<UiState>('IDLE');

  const refreshTenant = useCallback(async () => {
    const safeTenantSlug = tenantSlug || '';

    try {
      const response = await fetch(buildTenantApiUrl("tenant"), { headers: getTenantHeaders() });

      if (!response.ok) {
        throw new Error(`Tenant resolve failed (${response.status})`);
      }

      const payload = await response.json();
      const resolvedTenant = (payload?.tenant || null) as TenantPayload | null;

      setTenant(resolvedTenant);
      setTenantContext(safeTenantSlug, resolvedTenant);
    } catch (e) {
      console.error('[App] Failed to resolve tenant', e);
      setTenant(null);
      setTenantContext(safeTenantSlug, null);
      throw e;
    }
  }, [tenantSlug]);

  // 1. CONNECT TO AGENT BRAIN
  useEffect(() => {
    // Subscribe to the Agent Adapter
    const unsubscribe = AgentAdapter.subscribe((newState, newData) => {
      console.log(`[APP RENDERER] Received State Update from Agent: ${newState}`);
      setState(newState);
      setData(newData || {});
      setLoading(false);
    });

    return () => {
      unsubscribe();
    }
  }, []);

  useEffect(() => {
    const handlePageHide = () => {
      AgentAdapter.clearSession('pagehide', { keepalive: true });
    };

    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      AgentAdapter.clearSession('app_unmount', { keepalive: true });
    };
  }, []);

  // 2. INTENT EMITTER (Forwarder to Agent)
  const emit = useCallback(async (type: string, payload?: any) => {
    console.log(`[APP RENDERER] Emitting Intent: ${type}`);

    // UI Feedback: "Processing..."
    // Note: We don't disable UI for *every* intent, but for major transitions it's good practice.
    // However, since Agent is instantaneous (synchronous pure function), loading is minimal.
    // We'll keep it simple.

    if (type === 'ERROR_DISMISSED') {
      setError(null);
      // If error clearing needs to change state, dispatch an intent. 
      // Current design: ERROR state handles dismissal via BACK/TOUCH.
      return;
    }

    try {
      // Send to Authority
      AgentAdapter.handleIntent(type as any, payload);
    } catch (e) {
      console.error("Agent Error", e);
      setError("System Error");
    }
  }, []);

  // 3. DUMB ROUTER (State -> Component)
  // CRITICAL: This is a pure switch on Agent State. No logic allowed.
  const effectiveState = state;
  const showVoiceStatus = VOICE_RELEVANT_STATES.has(effectiveState);
  const derivedVoiceEnabled = typeof data?.metadata?.listening === 'boolean'
    ? Boolean(data.metadata.listening)
    : showVoiceStatus;
  const showMiniSiyaOrb = journeyMode === 'voice' && MINI_SIYA_ORB_STATES.has(effectiveState);

  // Track whether the current flow originated from voice mode or manual mode.
  // This supports flows that jump from WELCOME directly to transaction pages.
  useEffect(() => {
    const previousState = previousStateRef.current;

    setJourneyMode((currentMode) => {
      if (effectiveState === 'IDLE') return null;
      if (effectiveState === 'MANUAL_MENU') return 'manual';
      if (effectiveState === 'AI_CHAT') return 'voice';

      // Voice command from WELCOME can route directly into SCAN_ID/ROOM_SELECT.
      if (
        previousState === 'WELCOME' &&
        (effectiveState === 'SCAN_ID' || effectiveState === 'ROOM_SELECT')
      ) {
        return 'voice';
      }

      // Manual menu actions continue as manual flow.
      if (
        previousState === 'MANUAL_MENU' &&
        (effectiveState === 'SCAN_ID' || effectiveState === 'ROOM_SELECT')
      ) {
        return 'manual';
      }

      // Preserve chosen journey mode through downstream pages.
      return currentMode;
    });

    previousStateRef.current = effectiveState;
  }, [effectiveState]);

  // Keep URL in sync with rendered kiosk state under /:tenantSlug/<page>
  useEffect(() => {
    const safeTenantSlug = tenantSlug || '';
    const expectedPath = `/${safeTenantSlug}/${STATE_TO_ROUTE[effectiveState]}`;

    if (location.pathname !== expectedPath) {
      navigate(expectedPath, { replace: true });
    }
  }, [effectiveState, location.pathname, navigate, tenantSlug]);

  // Resolve tenant object once slug is known and expose it globally
  useEffect(() => {
    let alive = true;
    const safeTenantSlug = tenantSlug || '';

    setTenantContext(safeTenantSlug, null);
    setTenant(null);

    (async () => {
      try {
        await refreshTenant();
        if (!alive) return;
      } catch (e) {
        if (!alive) return;
      }
    })();

    return () => {
      alive = false;
    };
  }, [refreshTenant]);

  const renderPage = () => {
    switch (effectiveState) {
      case 'IDLE': return <IdlePage />;

      // WelcomePage handles both Voice and Manual visual modes
      case 'WELCOME': return <WelcomePage visualMode="voice" />;
      case 'AI_CHAT': return <WelcomePage visualMode="voice" />;
      case 'MANUAL_MENU': return <WelcomePage visualMode="manual" />;

      case 'SCAN_ID': return <ScanIdPage />;
      case 'ID_VERIFY': return <IdVerifyPage />;
      case 'CHECK_IN_SUMMARY': return <CheckInSummaryPage />;
      case 'ROOM_SELECT': return <RoomSelectPage />;
      case 'BOOKING_COLLECT': return <BookingCollectPage />;
      case 'BOOKING_SUMMARY': return <BookingSummaryPage />;
      case 'PAYMENT': return <PaymentPage />;

      case 'KEY_DISPENSING': return (
        <div className="h-screen w-full overflow-hidden relative text-white">
          <AnimatedGradientBackground Breathing={true} />
          <div className="relative z-10 h-full w-full flex flex-col items-center justify-center">
            <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-blue-500 mb-4"></div>
            <h2 className="text-2xl font-light">Dispensing Key Card...</h2>
          </div>
        </div>
      );

      // Complete Page
      case 'COMPLETE': return <CompletePage />;

      // Error State (Runtime)
      case 'ERROR': return (
        <div className="h-screen w-full overflow-hidden relative text-white" onClick={() => emit('TOUCH_SELECTED')}>
          <AnimatedGradientBackground Breathing={true} />
          <div className="relative z-10 h-full w-full flex flex-col items-center justify-center bg-red-900/20">
            <h2 className="text-3xl font-bold mb-4">System Error</h2>
            <p>Please touch to restart.</p>
          </div>
        </div>
      );

      default: return <IdlePage />;
    }
  };

  return (
    <UIContext.Provider value={{ state, data, emit, loading, transcript: '', tenantSlug: tenantSlug || '', tenant, refreshTenant }}>
      <div className="antialiased w-full h-full relative">

        {/* Global Navigation Controls (Visibility controlled implicitly by page rendering, backing is Agent driven) */}
        {/* <BackButton /> -- Removed global back button until Phase 7C data contract is ready. */}
        {/* <BackButton /> */}

        {error && (
          <ErrorBanner
            message={error}
            onDismiss={() => setError(null)}
          />
        )}

        <CaptionsOverlay />

        {renderPage()}

        <SiyaMiniOrb visible={showMiniSiyaOrb} />

        {showVoiceStatus && (
          <VoiceStatusIndicator
            currentState={effectiveState}
            voiceEnabled={derivedVoiceEnabled}
          />
        )}
      </div>
    </UIContext.Provider>
  );
};

const TenantRootRedirect: React.FC = () => {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  if (!tenantSlug) return <MissingTenantPage />;
  return <Navigate to={`/${tenantSlug}/welcome`} replace />;
};

/** Shown when no tenant slug is present in the URL (e.g. bare domain visit). */
const MissingTenantPage: React.FC = () => (
  <div className="h-screen w-full flex flex-col items-center justify-center bg-gray-950 text-white">
    <h1 className="text-3xl font-bold mb-4">Kiosk Not Configured</h1>
    <p className="text-gray-400 text-lg">Please access this kiosk via a valid tenant URL.</p>
    <p className="text-gray-500 text-sm mt-2">Example: <code className="bg-gray-800 px-2 py-1 rounded">/your-hotel/welcome</code></p>
  </div>
);

const App: React.FC = () => {
  return (
    <Routes>
      <Route path="/" element={<MissingTenantPage />} />
      <Route path="/:tenantSlug" element={<TenantRootRedirect />} />
      <Route path="/:tenantSlug/*" element={<TenantKioskApp />} />
      <Route path="*" element={<MissingTenantPage />} />
    </Routes>
  );
};

export default App;
