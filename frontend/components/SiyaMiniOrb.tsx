import React, { useEffect, useRef, useState } from "react";
import { Orb, OrbState } from "./ui/orb";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { VoiceRuntime, VoiceTurnState } from "../voice/VoiceRuntime";

type SiyaMiniOrbProps = {
  visible: boolean;
};

type AgentState = "idle" | "listening" | "thinking" | "talking" | null;

const toOrbState = (state: AgentState): OrbState => {
  switch (state) {
    case "listening":
      return "listening";
    case "thinking":
      return "thinking";
    case "talking":
      return "talking";
    default:
      return null;
  }
};

export const SiyaMiniOrb: React.FC<SiyaMiniOrbProps> = ({ visible }) => {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [interactionState, setInteractionState] = useState<AgentState>(null);
  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible) {
      if (thinkingTimerRef.current) {
        clearTimeout(thinkingTimerRef.current);
        thinkingTimerRef.current = null;
      }
      setInteractionState(null);
      return;
    }

    const clearThinkingTimer = () => {
      if (!thinkingTimerRef.current) return;
      clearTimeout(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    };

    const setFromTurnState = (turnState: VoiceTurnState) => {
      if (turnState === "USER_SPEAKING") {
        clearThinkingTimer();
        setInteractionState("listening");
        return;
      }
      if (turnState === "SYSTEM_RESPONDING") {
        clearThinkingTimer();
        setInteractionState("talking");
        return;
      }
      if (turnState === "IDLE") {
        setInteractionState((prev) => (prev === "thinking" ? prev : null));
      }
    };

    const unsubscribeVoice = VoiceRuntime.subscribe((event) => {
      switch (event.type) {
        case "VOICE_SESSION_STARTED":
          clearThinkingTimer();
          setInteractionState("listening");
          break;
        case "VOICE_TRANSCRIPT_READY":
          clearThinkingTimer();
          setInteractionState("thinking");
          thinkingTimerRef.current = setTimeout(() => {
            setInteractionState((prev) => (prev === "thinking" ? null : prev));
            thinkingTimerRef.current = null;
          }, 1600);
          break;
        case "VOICE_SESSION_ENDED":
        case "VOICE_SESSION_ABORTED":
          clearThinkingTimer();
          setInteractionState(null);
          break;
        case "VOICE_SESSION_ERROR":
          if (event.reason === "stt_permission_denied" || event.fatal) {
            clearThinkingTimer();
            setInteractionState(null);
          }
          break;
        default:
          break;
      }
    });

    const unsubscribeTurn = VoiceRuntime.onTurnStateChange((turnState) => {
      setFromTurnState(turnState as VoiceTurnState);
    });

    setFromTurnState(VoiceRuntime.getTurnState());

    return () => {
      clearThinkingTimer();
      unsubscribeVoice();
      unsubscribeTurn();
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="pointer-events-none fixed left-4 bottom-[8.5rem] z-30 w-[168px] flex justify-center">
      <div
        className="relative h-[68px] w-[68px] rounded-full"
        style={{
          boxShadow: "0 14px 28px rgba(0, 0, 0, 0.45), 0 6px 14px rgba(0, 0, 0, 0.3)",
        }}
      >
        <div
          className="absolute inset-0 rounded-full"
          style={{
            boxShadow:
              "inset 0 0 12px 3px rgba(147, 197, 253, 0.26), inset 0 0 24px 8px rgba(96, 165, 250, 0.12)",
          }}
        />
        <div
          className="absolute inset-[2px] rounded-full bg-slate-950/80"
          style={{
            boxShadow: "inset 0 0 10px 3px rgba(0, 0, 0, 0.4)",
          }}
        />
        <div className="absolute inset-0 rounded-full overflow-hidden">
          <Orb
            agentState={toOrbState(interactionState)}
            colors={["#977DFF", "#F2E6EE"]}
            reducedMotion={prefersReducedMotion}
          />
        </div>
      </div>
    </div>
  );
};
