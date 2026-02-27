import React, { useState, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { UIContext } from '../state/uiContext';
// Agent Authority
import { AgentAdapter } from '../agent/adapter';
import { UiState } from '../agent/index'; // Import directly from source

// Pages
import { IdlePage } from '../pages/IdlePage';
import { WelcomePage } from '../pages/WelcomePage';
import { ScanIdPage } from '../pages/ScanIdPage';
import { RoomSelectPage } from '../pages/RoomSelectPage';
import { BookingCollectPage } from '../pages/BookingCollectPage';
import { BookingSummaryPage } from '../pages/BookingSummaryPage';
import { PaymentPage } from '../pages/PaymentPage';
import { CompletePage } from '../pages/CompletePage';

// Components
import { ErrorBanner } from '../components/ErrorBanner';
import { BackButton } from '../components/BackButton';
import { CaptionsOverlay } from '../components/CaptionsOverlay';
import { DevToolbar } from '../components/DevToolbar';
import { DevMockTester } from '../components/DevMockTester';
import AnimatedGradientBackground from '../components/ui/animated-gradient-background';
import { setTenantContext, TenantPayload } from '../services/tenantContext';

const DEFAULT_TENANT_SLUG = 'grand-hotel';

const STATE_TO_ROUTE: Record<UiState, string> = {
  IDLE: 'idle',
  WELCOME: 'welcome',
  AI_CHAT: 'ai-chat',
  MANUAL_MENU: 'manual-menu',
  SCAN_ID: 'scan-id',
  ROOM_SELECT: 'room-select',
  BOOKING_COLLECT: 'booking-collect',
  BOOKING_SUMMARY: 'booking-summary',
  PAYMENT: 'payment',
  KEY_DISPENSING: 'key-dispensing',
  COMPLETE: 'complete',
  ERROR: 'error',
};

const TenantKioskApp: React.FC = () => {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  // Local UI State (Renderer only)
  const [state, setState] = useState<UiState>('IDLE');
  const [forcedState, setForcedState] = useState<UiState | null>(null);
  const [data, setData] = useState<any>({});
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [tenant, setTenant] = useState<TenantPayload | null>(null);

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

  // 2. INTENT EMITTER (Forwarder to Agent)
  const emit = async (type: string, payload?: any) => {
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
  };

  // 3. DUMB ROUTER (State -> Component)
  // CRITICAL: This is a pure switch on Agent State. No logic allowed.
  const effectiveState = forcedState ?? state;

  // Keep URL in sync with rendered kiosk state under /:tenantSlug/<page>
  useEffect(() => {
    const safeTenantSlug = tenantSlug || DEFAULT_TENANT_SLUG;
    const expectedPath = `/${safeTenantSlug}/${STATE_TO_ROUTE[effectiveState]}`;

    if (location.pathname !== expectedPath) {
      navigate(expectedPath, { replace: true });
    }
  }, [effectiveState, location.pathname, navigate, tenantSlug]);

  // Resolve tenant object once slug is known and expose it globally
  useEffect(() => {
    const safeTenantSlug = tenantSlug || DEFAULT_TENANT_SLUG;
    let alive = true;

    setTenantContext(safeTenantSlug, null);

    (async () => {
      try {
        const response = await fetch(`http://localhost:3002/api/${safeTenantSlug}/tenant`, {
          headers: { 'x-tenant-slug': safeTenantSlug },
        });

        if (!response.ok) {
          throw new Error(`Tenant resolve failed (${response.status})`);
        }

        const payload = await response.json();
        const resolvedTenant = (payload?.tenant || null) as TenantPayload | null;
        if (!alive) return;

        setTenant(resolvedTenant);
        setTenantContext(safeTenantSlug, resolvedTenant);
      } catch (e) {
        console.error('[App] Failed to resolve tenant', e);
        if (!alive) return;
        setTenant(null);
        setTenantContext(safeTenantSlug, null);
      }
    })();

    return () => {
      alive = false;
    };
  }, [tenantSlug]);

  const renderPage = () => {
    switch (effectiveState) {
      case 'IDLE': return <IdlePage />;

      // WelcomePage handles both Voice and Manual visual modes
      case 'WELCOME': return <WelcomePage visualMode="voice" />;
      case 'AI_CHAT': return <WelcomePage visualMode="voice" />;
      case 'MANUAL_MENU': return <WelcomePage visualMode="manual" />;

      case 'SCAN_ID': return <ScanIdPage />;
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
    <UIContext.Provider value={{ state, data, emit, loading, transcript: '', tenantSlug: tenantSlug || DEFAULT_TENANT_SLUG, tenant }}>
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

        {/* Debug Info (To prove state comes from Agent) */}
        <div className="fixed bottom-2 right-2 z-50 bg-black/50 text-white text-xs p-1 rounded opacity-30 hover:opacity-100 pointer-events-none">
          Authority: AgentAdapter | State: {state}
          {forcedState ? ` | Override: ${forcedState}` : ''}
        </div>

        {/* Development Toolbar */}
        <DevToolbar
          onForceState={(next) => setForcedState(next as UiState | null)}
          isUnlocked={Boolean(forcedState)}
          currentState={effectiveState as any}
        />

        {/* Global Mock Tester */}
        <DevMockTester />
      </div>
    </UIContext.Provider>
  );
};

const TenantRootRedirect: React.FC = () => {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const slug = tenantSlug || DEFAULT_TENANT_SLUG;
  return <Navigate to={`/${slug}/welcome`} replace />;
};

const App: React.FC = () => {
  return (
    <Routes>
      <Route path="/" element={<Navigate to={`/${DEFAULT_TENANT_SLUG}/welcome`} replace />} />
      <Route path="/:tenantSlug" element={<TenantRootRedirect />} />
      <Route path="/:tenantSlug/*" element={<TenantKioskApp />} />
      <Route path="*" element={<Navigate to={`/${DEFAULT_TENANT_SLUG}/welcome`} replace />} />
    </Routes>
  );
};

export default App;
