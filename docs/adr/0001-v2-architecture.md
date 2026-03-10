# ADR 0001: Parallel v2 Architecture Foundation

- Status: Accepted
- Date: 2026-03-10
- Scope: `refactor/v2-architecture`

## Context

`claw-trace` is an internal debugging console for OpenClaw sessions. The current v1 app is intentionally lightweight, but it couples file access, raw-stream tailing, API responses, and UI behavior in a single Node + static-page implementation.

That v1 path is still useful and must remain runnable while v2 is designed and introduced incrementally.

The main product goals for v2 are:

1. Make it easy to understand what a selected session is doing right now.
2. Show whether a session is running, stalled, failed, or completed.
3. Expose reliable action history and raw debug stream views together.
4. Minimize page flashing and uncontrolled focus jumps.
5. Stay lightweight enough for single-machine deployment and iterative shipping.

## Decision

Build v2 as a parallel workspace that does not replace or remove v1:

- Backend: Node.js + TypeScript + Fastify + SQLite (`better-sqlite3`) + `zod`
- Frontend: React + Vite + TypeScript + Zustand
- Realtime transport: SSE with cursor resume via query cursor and `Last-Event-ID`
- Storage model: normalized SQLite event store for session history plus raw debug stream persistence

The branch adds a scaffold only:

- New code lives under `apps/server` and `apps/web`
- Existing v1 files stay intact
- The v2 server exposes health, session list, action history, and SSE placeholder routes
- The v2 web app provides a stable three-panel shell and client/store skeleton
- The ingest pipeline from current OpenClaw files into SQLite is deferred to a later phase

## Why This Shape

### Fastify over a larger framework

- Fastify keeps startup fast and deployment small.
- Route/plugin structure is enough for iterative delivery without introducing a heavier application framework.
- Native streaming support works well for SSE.

### SQLite over a separate database service

- Single-file storage matches the current single-machine operational model.
- `better-sqlite3` is synchronous and predictable for low-concurrency internal tooling.
- SQLite is sufficient for read-heavy debugging views and replay cursors.

### SSE over WebSocket

- The primary need is server-to-client event delivery, not bidirectional collaboration.
- Browser `EventSource` handles reconnection naturally.
- `Last-Event-ID` provides a simple resume primitive without maintaining socket session state.
- SSE maps well to append-only debug event feeds.

### Zustand over a heavier client state stack

- The UI needs shared state for session selection, action history, and stream cursors.
- Zustand is enough for stable selection and render control without extra ceremony.
- Keeping the store explicit helps reduce accidental remounts and focus churn.

## Proposed v2 Structure

```text
apps/
  server/
    src/
      config.ts
      app.ts
      index.ts
      db/sqlite.ts
      domain/events.ts
      store/event-store.ts
      routes/
        health.ts
        sessions.ts
        action-history.ts
        stream.ts
  web/
    src/
      App.tsx
      main.tsx
      styles.css
      components/
      lib/api.ts
      store/app-store.ts
docs/
  adr/
    0001-v2-architecture.md
```

## Data Model

v2 centers on a normalized read model instead of deriving every screen directly from raw files at request time.

### `sessions`

One row per logical OpenClaw session.

- `id`
- `title`
- `status`
- `started_at`
- `updated_at`
- `last_action_summary`
- `metadata_json`

Purpose:

- drive the session list quickly
- store latest derived status
- keep selection stable even while new events arrive

### `action_events`

Normalized action history for a session.

- `id`
- `session_id`
- `sequence`
- `kind`
- `status`
- `title`
- `summary`
- `started_at`
- `ended_at`
- `cursor`
- `payload_json`

Purpose:

- render a reliable action-history timeline
- support derived status such as running / stalled / failed / completed
- decouple UI history from raw raw-stream event noise

### `raw_stream_entries`

Append-only record of raw debug events.

- `stream_cursor`
- `event_id`
- `session_id`
- `run_id`
- `source`
- `kind`
- `event_ts`
- `payload_json`

Purpose:

- preserve raw diagnostics for debugging and replay
- back SSE resume from a monotonic cursor
- enable later re-derivation of normalized action history

### `ingest_cursors`

Cursor state for importers.

- `name`
- `cursor`
- `updated_at`

Purpose:

- remember file offsets or replay markers
- let ingestion resume after restarts

## API Shape

Initial route surface:

- `GET /api/v2/health`
- `GET /api/v2/sessions`
- `GET /api/v2/sessions/:sessionId/actions`
- `GET /api/v2/stream`

Response rules:

- All REST routes return explicit placeholder metadata until ingestion is built.
- Zod validates query and path inputs.
- The SSE endpoint accepts a `cursor` query parameter and also honors `Last-Event-ID`.

## Realtime Model

The stream contract is append-only and cursor-based.

1. Client connects to `/api/v2/stream?cursor=<n>` or reconnects automatically with `Last-Event-ID`.
2. Server replays persisted `raw_stream_entries` after the given cursor.
3. Server emits a `ready` event describing the current resume point.
4. Future phases will append live ingested events and stream them immediately.

This allows reconnect without diffing whole session payloads and avoids full-screen refreshes.

## Frontend State Principles

The v2 shell is built around stable, panel-level updates:

- Session list selection lives in a shared Zustand store.
- Action history and raw debug panels update independently.
- Panels stay mounted so selection, scroll position, and focus are less likely to reset.
- Initial skeleton avoids optimistic auto-focus behavior entirely.

This is meant to reduce two common v1 failure modes:

- page flashing caused by broad rerenders
- focus jumps caused by replacing panel trees during refresh

## Migration Plan

### Phase 0: Foundation

Delivered in this branch.

- Create isolated backend/frontend workspaces
- Define database schema and API contract
- Add placeholder routes and stable shell panels
- Keep v1 unchanged

### Phase 1: Read-side ingestion

- Import `sessions.json` and session `jsonl` data into `sessions` and `action_events`
- Tail raw-stream data into `raw_stream_entries`
- Persist importer offsets in `ingest_cursors`

### Phase 2: Derived session status

- Compute running / stalled / failed / completed from normalized action events
- Expose richer summaries in the session list
- Add timestamps and stale-session heuristics

### Phase 3: Realtime refinement

- Stream newly ingested raw events over SSE
- Update selected-session action history incrementally
- Add bounded client caches keyed by cursor

### Phase 4: Controlled adoption

- Run v1 and v2 side-by-side behind separate ports
- Validate operator workflows on v2
- Only switch default entrypoint after parity is acceptable

## Consequences

Positive:

- v2 can ship incrementally without risking the current operational path
- normalized history is a better fit for “what is this session doing?” queries
- SQLite + SSE keeps deployment small and debuggable

Tradeoffs:

- ingestion logic becomes an explicit subsystem instead of ad hoc request-time parsing
- there will be temporary duplication between v1 and v2 while migration is incomplete
- synchronous SQLite access is acceptable now, but long-running ingestion must stay disciplined

## Non-Goals In This Branch

- No full migration from file-based reads to SQLite yet
- No replacement of the current `server.js` or `public/` app
- No production bundling or process manager changes
- No websocket infrastructure
