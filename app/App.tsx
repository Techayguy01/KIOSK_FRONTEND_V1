import React, { useState, useEffect } from 'react';
import { UIContext } from '../state/uiContext';
import { UIState } from '../contracts/backend.contract';

// Backend Authority
import { BackendService } from '../services/mockBackend';

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

const App: React.FC = () => {
  // Local UI State (Renderer only)
  const [state, setState] = useState<UIState>('IDLE');
  const [data, setData] = useState<any>({});
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // 1. CONNECT TO BACKEND
  useEffect(() => {
    // Subscribe to the "Socket"
    const unsubscribe = BackendService.subscribe((newState, newData) => {
      console.log(`[APP RENDERER] Received State Update: ${newState}`);
      setState(newState);
      setData(newData);
      setLoading(false); // State update means request finished
    });

    return () => unsubscribe();
  }, []);

  // 2. INTENT EMITTER (Forwarder)
  const emit = async (type: string, payload?: any) => {
    console.log(`[APP RENDERER] Emitting Intent: ${type}`);
    
    // UI Feedback: "I am waiting for backend"
    setLoading(true);

    if (type === 'ERROR_DISMISSED') {
      setError(null);
      setLoading(false);
      return;
    }

    try {
      // Send to Authority
      await BackendService.sendIntent(type as any, payload);
      // Note: We do NOT set loading to false here immediately.
      // We wait for the backend to push the new state via the subscription.
      setLoading(false);
    } catch (e) {
      console.error("Backend Error", e);
      setError("Connection Lost");
      setLoading(false);
    }
  };

  // 3. DUMB ROUTER (State -> Component)
  const renderPage = () => {
    switch (state) {
      case 'IDLE': return <IdlePage />;
      case 'WELCOME': return <WelcomePage />;
      case 'SCAN_ID': return <ScanIdPage />;
      case 'ROOM_SELECT': return <RoomSelectPage />;
      case 'PAYMENT': return <PaymentPage />;
      case 'KEY_DISPENSING': return (
        <div className="h-screen w-full flex flex-col items-center justify-center bg-slate-900 text-white">
          <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-blue-500 mb-4"></div>
          <h2 className="text-2xl font-light">Dispensing Key Card...</h2>
        </div>
      );
      case 'COMPLETE': return <CompletePage />;
      default: return <IdlePage />;
    }
  };

  return (
    <UIContext.Provider value={{ state, data, emit, loading }}>
      <div className="antialiased w-full h-full relative">
        
        {/* Global Navigation Controls (Visibility controlled by Backend Data) */}
        <BackButton />

        {error && (
          <ErrorBanner 
            message={error} 
            onDismiss={() => setError(null)} 
          />
        )}
        
        {renderPage()}

        {/* Debug Info (To prove state comes from backend) */}
        <div className="fixed bottom-2 right-2 z-50 bg-black/50 text-white text-xs p-1 rounded opacity-30 hover:opacity-100 pointer-events-none">
          Authority: BackendService | State: {state}
        </div>
      </div>
    </UIContext.Provider>
  );
};

export default App;