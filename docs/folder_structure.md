# Folder Structure Documentation

Detailed breakdown of the Grand Hotel Kiosk project structure.

## Root Directory
- `index.html`: Entry point.
- `index.tsx`: React entry point.
- `vite.config.ts`: Vite build configuration.
- `tsconfig.json`: TypeScript configuration.
- `package.json`: Dependencies.

## Key Directories

### /agent (The Brain)
Core logic for the Conversational Agent.
- `adapter.ts`: **The Main Controller (Singleton)**. Bridges UI, Voice, and State Machine. Handles `handleIntent` and `dispatch`.
- `index.ts`: Legacy definitions and Speech Maps (`STATE_SPEECH_MAP`).
- `agent.test.ts`: Unit tests for agent logic.

### /app
App-level orchestration.
- `App.tsx`: Main component, handles routing based on UI State and subscribing to `AgentAdapter`.

### /backend
Node.js server for LLM integration and Voice Relay.
- `server.ts`: Express server entry point.
- `deepgramRelay.ts`: WebSocket relay for streaming audio to Deepgram.
- `routes/`: API routes (`chat.ts` for LLM interaction).
- `context/`: LLM Context Builders (`hotelData.ts`, `contextBuilder.ts`).
- `llm/`: LLM Clients (`groqClient.ts`).

### /components
Reusable UI components.
- `ui/`: Lower-level primitives (Buttons, Cards).
- `MicrophoneButton.tsx`: Audio control UI.
- `ErrorBanner.tsx`: System alerts.
- `ProgressBar.tsx`: Flow progress indicator.

### /contracts
Shared types and interfaces between Frontend and Backend (or internal modules).
- `backend.contract.ts`: Defines `UIState`, `AgentResponse`.
- `intents.ts`: Defines `Intent` (User actions).
- `events.contract.ts`: System event types.

### /docs
Project documentation.
- `state-machine.md`: Documentation of the FSM.
- `folder_structure.md`: This file.

### /mocks
Mock data for development.
- `voice.mock.ts`: Stub response for voice runtime.
- `rooms.mock.ts`: Room data simulation.
- `session.mock.ts`: Session data simulation.

### /pages
Full-page components corresponding to UI States.
- `WelcomePage.tsx`: Main voice interaction screen (renders for `WELCOME`, `AI_CHAT`, `MANUAL_MENU`).
- `IdlePage.tsx`: Attractor screen (`IDLE`).
- `ScanIdPage.tsx`: ID scanning flow (`SCAN_ID`).
- `RoomSelectPage.tsx`: Room selection (`ROOM_SELECT`).
- `PaymentPage.tsx`: Payment processing (`PAYMENT`).
- `CompletePage.tsx`: Success screen (`COMPLETE`).

### /services
Data access layer (Mock/API).
- `ApiService.ts`: Generalized API client.

### /state
State Management (Finite State Machine).
- `uiState.machine.ts`: **The Source of Truth** for state transitions. Defines `MACHINE_CONFIG`.
- `uiState.types.ts`: Local type definitions.
- `uiContext.ts`: React Context for global state access.

### /src
Miscellaneous source files types.
- `vite-env.d.ts`: Global environment types.

### /voice
Audio Processing Stack.
- `voice.types.ts`: Audio event definitions.
- `audioCapture.ts`: AudioWorklet/MediaRecorder logic for capturing mic input.
- `deepgramClient.ts`: WebSocket client for Deepgram Flux (Speech-to-Text).
- `VoiceRuntime.ts`: Singleton managing STT lifecycle and events.
- `TTSController.ts`: Text-to-Speech manager (handles interruptions/barge-in).
- `TtsRuntime.ts`: Web Speech API wrapper.
- `SpeechOutputController.ts`: Audio mixing/control.
- `normalizeTranscript.ts`: Text processing utility.
