# Kiosk AI Platform (Nexus / Siya)

Multi-tenant hotel kiosk platform with a React + Vite frontend and a FastAPI + LangGraph backend.

## Monorepo Structure

```text
KIOSK_FRONTEND_V1/
|-- frontend/                  # Kiosk UI runtime (React + Vite)
|-- KIOSK_BACKEND_V2_PYTHON/   # Backend API + agent orchestration (FastAPI)
|-- shared/                    # Shared contracts (TS)
|-- Reference document/        # Technical docs and SOPs
`-- Kiosk Images/              # Screenshot assets used by SOP
```

## Documentation

- Technical documentation: [Reference document/Kiosk_Documentation.md](Reference%20document/Kiosk_Documentation.md)
- SOP playbook: [Reference document/Kiosk_SOP.md](Reference%20document/Kiosk_SOP.md)

## Quick Start

### 1) Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend default URL: `http://localhost:3000`

### 2) Backend

```bash
cd KIOSK_BACKEND_V2_PYTHON
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe main.py
```

Backend default URL: `http://localhost:8000` (or `PORT` from `.env`)

Health check:

```bash
curl http://127.0.0.1:8000/health
```

## Environment Notes

- Backend config is read from `KIOSK_BACKEND_V2_PYTHON/.env`
- Frontend API base URL is controlled by `frontend/.env.local` (`VITE_API_BASE_URL`)
- Keep frontend and backend ports aligned

## Key API Endpoints

- `POST /api/chat`
- `GET /api/tenant?slug=...`
- `GET /api/rooms?slug=...`
- `GET /api/faqs?slug=...`
- `POST /api/ocr`
- `POST /api/checkin/confirm`
- `POST /api/voice/stt`
- `POST /api/voice/tts`

## Test Backend

```bash
cd KIOSK_BACKEND_V2_PYTHON
.venv\Scripts\python.exe -m pytest tests -q
```

## Current Screenshot Set

Kiosk journey screenshots are in `Kiosk Images/` and are embedded in the SOP document.

