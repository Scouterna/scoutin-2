# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies (run from root)
pnpm install

# Start local PostgreSQL
docker-compose up -d

# Backend
cd packages/backend
pnpm dev          # Development with hot reload (requires .env)
pnpm build        # TypeScript compilation
pnpm start        # Production start

# Frontend
cd packages/frontend
pnpm dev          # Vite dev server (http://localhost:5173)
pnpm build        # Production build + type check
pnpm test         # Run Vitest tests
pnpm test -- src/path/to/test.test.ts  # Single test file

# Linting/formatting (from root)
pnpm biome check .
pnpm biome format --write .

# Database migrations
cd packages/backend
npx prisma migrate dev
npx prisma generate
```

## Architecture Overview

This is a **pnpm monorepo** (`packages/backend`, `packages/frontend`) implementing a kiosk-based check-in system for Scouterna, a Swedish scout organization. It integrates with the Scoutnet API to manage participant data.

### Tech Stack

- **Backend**: Node.js + Hono (HTTP + WebSocket), Prisma ORM, PostgreSQL, ArkType validation
- **Frontend**: React 19, TanStack Router (file-based), TanStack Query, Jotai (atoms), Tailwind CSS, Material-UI
- **Tooling**: Biome (lint/format), Vitest (frontend tests), TypeScript strict mode

### Core Concepts

**Step-based workflow engine**: Check-in sessions execute a sequence of steps defined in `packages/backend/stepConfig.yml`. Each step has a `uses` (implementation ID), `with` (config), and optional `if` (conditional). Steps are registered via a `StepRegistry` and can be extended via plugins (`src/plugins/`).

**Session model**: A `CheckinSession` has an actor (person operating the kiosk), subjects (participants being checked in), and `CheckinSessionStepData` (execution history per step).

**Real-time communication**: The frontend connects via WebSocket (`/ws/session`). The server sends `showScreen` messages; the client sends `step:callMethod` to invoke step methods. The WebSocket message format is `{ name: string; data?: unknown }`.

**Type-safe API**: The backend exports `AppType` from Hono; the frontend imports it and uses `hc()` for fully type-safe REST calls. No manual API contract duplication needed.

**Data sources**: Participant data is loaded from Scoutnet at startup (`dataSourceConfig.yml`). Two sources are configured: `groups` (scout leaders) and `staff` (IST staff). Keys are encrypted with `DATASOURCE_HASHING_*` env vars.

### Frontend Routing & Screens

Routes are file-based in `src/routes/`, split into `_kiosk/` (check-in UI) and `admin/` sections.

The kiosk UI is driven by `ScreenRenderer.tsx`, which maps step IDs to screen components via `screenRouter.ts`. Screens are React components that communicate with the backend via the WebSocket session.

State: server-derived state lives in TanStack Query; UI/session state in Jotai atoms. The current screen to render is stored in `currentScreenAtom`.

### Key Environment Variables

```
DATABASE_URL              # PostgreSQL connection string
TOKEN_SECRET              # JWT signing key for session tokens
DATASOURCE_HASHING_KEY    # Encryption key for data source secrets
SCOUTNET_GROUPS_KEYS      # Scoutnet API keys for groups data source
SCOUTNET_STAFF_KEYS       # Scoutnet API keys for staff data source
PORT                      # Server port (default: 3000)
```

See `.env.example` in `packages/backend` for full reference.
