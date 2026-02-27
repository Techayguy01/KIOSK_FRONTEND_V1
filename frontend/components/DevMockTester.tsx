import React, { useEffect, useState } from 'react';
import { BookingService } from '../services/booking.service';
import { KioskService } from '../services/kiosk.service';

export const DevMockTester: React.FC = () => {
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const testMocks = async () => {
        setLoading(true);
        setError(null);
        try {
            const [device, bookings] = await Promise.all([
                KioskService.registerDevice('TEST-KIOSK-001'),
                BookingService.lookupBooking({ guestName: 'Rahul' }),
            ]);
            setData({ device, bookings });
        } catch (err: any) {
            setError(err.message || 'Failed to fetch mock data');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        // Only run this automatically in dev if we want
        if (import.meta.env.VITE_USE_MOCKS === "true") {
            testMocks();
        }
    }, []);

    if (import.meta.env.VITE_USE_MOCKS !== "true") return null;

    return (
        <div style={{
            position: 'fixed',
            bottom: 20,
            right: 20,
            backgroundColor: 'rgba(0,0,0,0.85)',
            color: '#00ffcc',
            padding: '16px',
            borderRadius: '8px',
            zIndex: 9999,
            maxWidth: '400px',
            maxHeight: '400px',
            overflow: 'auto',
            fontFamily: 'monospace',
            fontSize: '12px',
            border: '1px solid #00ffcc'
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <strong style={{ color: '#fff' }}>[DEV] Mock API Tester</strong>
                <button onClick={testMocks} style={{ background: '#333', color: '#fff', border: '1px solid #555', cursor: 'pointer' }}>
                    Refresh
                </button>
            </div>

            {loading && <div>Fetching mocks...</div>}
            {error && <div style={{ color: '#ff6b6b' }}>Error: {error}</div>}
            {!loading && !error && data && (
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}>
                    {JSON.stringify(data, null, 2)}
                </pre>
            )}
        </div>
    );
};
