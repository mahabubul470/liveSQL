# Changelog

All notable changes to LiveSQL will be documented in this file.

## [1.0.0-beta.1] — Unreleased

First public beta. All packages: `@livesql/core`, `@livesql/server`, `@livesql/client`, `@livesql/react`, `@livesql/vue`, `@livesql/svelte`.

### Features

- **WAL-based CDC** — PostgreSQL logical replication via pgoutput (replaced LISTEN/NOTIFY from PoC)
- **Reconnection backfill** — clients resume from last offset; missed events replayed automatically
- **JWT authentication** — `?token=<jwt>` query parameter or `Authorization: Bearer` header
- **Table and row permissions** — `permissions()` and `rowPermission()` callbacks
- **Filter validation** — server-side `"column op value"` filtering without SQL execution
- **Event batching** — `EventBatcher` coalesces up to 50 events or flushes every 16ms
- **Backpressure detection** — drops events when `ws.bufferedAmount > 1MB`
- **React hooks** — `useLiveQuery`, `useLiveTable`, `LiveSQLProvider`
- **Vue composables** — `useLiveQuery`, `useLiveTable`, `createLiveSQLPlugin`
- **Svelte stores** — `liveQuery`, `liveTable` (lazy `Readable`)
- **WAL slot health monitoring** — `checkSlotHealth()`, configurable lag warnings, inactive slot detection
- **Replication slot failover** — auto-recovery via `recoverFromSlotLoss()`
- **Observability hooks** — `onEvent`, `onClientConnect`, `onClientDisconnect`, `onBackpressure`, `onSlotLost`
- **Exponential backoff with jitter** — ±25% jitter, 250ms → 30s cap

### Testing

- 163 tests across 15 test files (unit, integration, chaos)
- 23 chaos tests covering 6 failure modes (network partition, slow client, failover, WAL disk, thundering herd, SQL injection)
- k6 load test: 1,000 concurrent clients, p95 96ms, 0% connection failures

### Documentation

- Docusaurus docs site with quickstart, concepts, and API reference
- Migration guides from Supabase Realtime and Firebase Realtime Database
- Architecture docs, decision records, and failure mode analysis

### Breaking Changes from Alpha

- None — API is stable from alpha.4

## [0.1.0-alpha.4] — 2026-03-07

- Added React, Vue, and Svelte packages
- Added `useLiveTable` / `liveTable` for Map-based O(1) row lookups
- Added event batching and backpressure detection
- Added row-level permissions

## [0.1.0-alpha.3] — 2026-03-07

- Updated core, server, client with Phase 2 hardening
- Added `LiveSQLError` and `onError` callback to client subscriptions
- Added `filter` param support in client `subscribe()`

## [0.1.0-alpha.2] — 2026-03-07

- WAL-based CDC via pgoutput (replaced LISTEN/NOTIFY)
- JWT authentication and table permissions
- Filter validation and offset-based reconnection
- First npm publish of core, server, client

## [0.1.0-alpha.1] — 2026-03-07

- Initial PoC with LISTEN/NOTIFY
- Basic WebSocket server and client
- Demo application
