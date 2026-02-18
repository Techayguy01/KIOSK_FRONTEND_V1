import React, { useState, useEffect } from 'react';
import { UIContext } from '../state/uiContext';
// Agent Authority
import { AgentAdapter } from '../agent/adapter';
import { UiState } from '../agent/index'; // Import directly from source

// Pages
import { IdlePage } from '../pages/IdlePage';
import { WelcomePage } from '../pages/WelcomePage';
import { ScanIdPage } from '../pages/ScanIdPage';
import { RoomSelectPage } from '../pages/RoomSelectPage';
import { PaymentPage } from '../pages/PaymentPage';
import { CompletePage } from '../pages/CompletePage';

// Components
import { ErrorBanner } from '../components/ErrorBanner';
import { BackButton } from '../components/BackButton';
import { CaptionsOverlay } from '../components/CaptionsOverlay';
import { DevToolbar } from '../components/DevToolbar';
import { PaymentModal } from '../components/PaymentModal';

const App: React.FC = () => {
  // Local UI State (Renderer only)
  const [state, setState] = useState<UiState>('IDLE');
  const [data, setData] = useState<any>({});
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);

  // 1. CONNECT TO AGENT BRAIN
  useEffect(() => {
    // Subscribe to the Agent Adapter
    const unsubscribe = AgentAdapter.subscribe((newState, newData) => {
      console.log(`[APP RENDERER] Received State Update from Agent: ${newState}`, newData);
      setState(newState);

      // Phase 16: Handle Payment URL from Agent
      if (newData?.paymentUrl) {
        console.log("[App] Payment Request Received:", newData.paymentUrl);
        setPaymentUrl(newData.paymentUrl);
      }

      setLoading(false);
    });

    return () => {
      unsubscribe();
    }
  }, []);

  // ... (rest of the file) ...

  return (
    <UIContext.Provider value={{ state, data, emit, loading, transcript: '' }}>
      <div className="antialiased w-full h-full relative">

        {/* Global Navigation Controls */}
        {/* <BackButton /> */}

        {error && (
          <ErrorBanner
            message={error}
            onDismiss={() => setError(null)}
          />
        )}

        {/* Payment Modal Overlay */}
        {paymentUrl && (
          <PaymentModal
            paymentUrl={paymentUrl}
            onClose={() => setPaymentUrl(null)}
          />
        )}

        <CaptionsOverlay />

        {renderPage()}


        {/* Debug Info (To prove state comes from Agent) */}
        <div className="fixed bottom-2 right-2 z-50 bg-black/50 text-white text-xs p-1 rounded opacity-30 hover:opacity-100 pointer-events-none">
          Authority: AgentAdapter | State: {state}
        </div>

        {/* Development Toolbar */}
        <DevToolbar />
      </div>
    </UIContext.Provider>
  );
};

export default App;