import React, { useEffect, useState } from 'react';
// import { AgentAdapter } from '../agent/adapter'; // Not strictly needed if using window events, keeping import if we expand later

export const CaptionsOverlay: React.FC = () => {
    const [text, setText] = useState("");
    const [isFinal, setIsFinal] = useState(false);

    useEffect(() => {
        // Listen to Voice Runtime (Partial Transcripts) routed via window event
        const handleTranscript = (e: CustomEvent) => {
            setText(e.detail.text);
            setIsFinal(e.detail.isFinal);

            // Clear after 4 seconds if final
            if (e.detail.isFinal) {
                setTimeout(() => setText(""), 4000);
            }
        };

        window.addEventListener('VOICE_TRANSCRIPT' as any, handleTranscript as any);
        return () => window.removeEventListener('VOICE_TRANSCRIPT' as any, handleTranscript as any);
    }, []);

    if (!text) return null;

    return (
        <div className="fixed bottom-24 left-0 w-full flex justify-center z-40 pointer-events-none">
            <div className={`
                bg-black/60 backdrop-blur-md text-white px-6 py-3 rounded-2xl 
                shadow-2xl max-w-2xl text-center transition-all duration-300
                ${isFinal ? 'border-l-4 border-green-400' : 'border-l-4 border-blue-400'}
            `}>
                <p className="text-lg font-medium tracking-wide">
                    {text}
                    {!isFinal && <span className="animate-pulse">_</span>}
                </p>
            </div>
        </div>
    );
};
