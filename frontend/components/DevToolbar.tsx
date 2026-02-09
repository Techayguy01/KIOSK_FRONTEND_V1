import React, { useState } from 'react';
import { useUIState } from '../state/uiContext';
import { UIState } from '../contracts/backend.contract';
import { Settings, X, Zap } from 'lucide-react';

export const DevToolbar: React.FC = () => {
    const { emit, state } = useUIState();
    const [isOpen, setIsOpen] = useState(false);

    // The states you might want to jump to
    const states: UIState[] = [
        'IDLE',
        'WELCOME',
        'SCAN_ID',
        'ROOM_SELECT',
        'PAYMENT',
        'KEY_DISPENSING',
        'COMPLETE',
        'ERROR'
    ];

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className="fixed bottom-4 left-4 z-[100] p-3 bg-slate-900/80 text-slate-400 rounded-full hover:bg-blue-600 hover:text-white transition-all shadow-lg border border-slate-700 backdrop-blur-sm"
                title="Open Developer Tools"
            >
                <Settings size={20} />
            </button>
        );
    }

    return (
        <div className="fixed bottom-4 left-4 z-[100] bg-slate-900/95 border border-slate-700 p-4 rounded-xl shadow-2xl w-64 backdrop-blur-md animate-in fade-in slide-in-from-bottom-4">
            <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-2">
                    <Zap size={14} className="text-yellow-400" />
                    <h3 className="text-xs font-bold text-slate-100 uppercase tracking-widest">Dev Controls</h3>
                </div>
                <button onClick={() => setIsOpen(false)} className="text-slate-500 hover:text-white transition-colors">
                    <X size={16} />
                </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
                {states.map((s) => (
                    <button
                        key={s}
                        onClick={() => emit('FORCE_STATE' as any, { targetState: s })}
                        className={`px-2 py-2 text-[10px] rounded-md font-mono transition-all border ${state === s
                                ? 'bg-blue-600/20 border-blue-500 text-blue-300'
                                : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                            }`}
                    >
                        {s}
                    </button>
                ))}
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800 flex justify-between items-center">
                <span className="text-[10px] text-slate-600">Current State:</span>
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded">
                    {state}
                </span>
            </div>
        </div>
    );
};
