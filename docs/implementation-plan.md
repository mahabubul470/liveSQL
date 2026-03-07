# LiveSQL Implementation Plan

## Overview

The roadmap is structured around four phases, each shipping a usable artifact. Never spend more than 4-6 weeks without something a developer can install and try. Shipping early is more valuable than shipping complete.

---

## Phase 0 — Foundation & PoC ✅ COMPLETE

**Goal**: A working demo where a DB INSERT appears in the browser within 100ms. Use the simplest CDC mechanism (LISTEN/NOTIFY) to get a working proof of concept fast.

**Success gate**: A developer can clone the repo, run `docker compose up` + `pnpm dev`, and see a DB INSERT appear in the browser in under 5 minutes.

**Result**: Gate passed. INSERT → browser event in ~200ms via LISTEN/NOTIFY. 28 tests passing (unit + integration E2E). All packages build and typecheck clean.

### Deliverables

1. **Scaffold pnpm monorepo**
   - `pnpm-workspace.yaml` with `packages/*` and `apps/*`
   - Root `package.json` with build/test/lint scripts
   - Root `tsconfig.base.json` (ES2022, NodeNext, strict)
   - Per-package `package.json` and `tsconfig.json`
   - eslint, prettier, husky, lint-staged configuration

2. **Wire protocol types** (`packages/core`)
   - `ChangeType`, `ChangeEvent`, `SubscribeMessage`, `UnsubscribeMessage`
   - `SyncMessage`, `ErrorMessage`, `ClientMessage`, `ServerMessage`
   - `ChangeProvider` interface

3. **LISTEN/NOTIFY provider** (`packages/server`)
   - Simple PostgreSQL trigger that fires NOTIFY on INSERT/UPDATE/DELETE
   - Provider that listens and converts to `ChangeEvent` format
   - Temporary — will be replaced by WAL provider in Phase 1

4. **Minimal WebSocket server** (`packages/server`)
   - Accept connections, parse subscribe/unsubscribe messages
   - Fan-out: forward matching events to subscribed clients
   - No auth, no permissions (PoC only)

5. **Vanilla JS client** (`packages/client`)
   - Connect to WebSocket, send subscribe, receive events
   - Basic reconnection (simple retry, not exponential backoff yet)
   - Log received events, track offset

6. **Demo application** (`apps/demo`)
   - Live order status dashboard
   - Show orders table, auto-update when rows are inserted/updated
   - Plain HTML + vanilla JS (no framework dependency for PoC)

7. **Docker Compose for development**
   - PostgreSQL 16 with `wal_level=logical` (pre-configure for Phase 1)
   - Health check, proper environment variables

8. **README quickstart**
   - Clone, install, start, insert a row, see it appear

---

## Phase 1 — WAL-Based CDC Engine + Alpha (Weeks 4-9) ← CURRENT

**Goal**: Replace LISTEN/NOTIFY with production-grade WAL-based CDC. Add authentication, permissions, and filtering. Publish alpha packages to npm.

**Success gate**: Events are delivered via WAL logical replication with guaranteed delivery. Disconnected clients catch up from their last offset on reconnect.

### Deliverables

1. **PostgreSQL WAL provider** (`packages/server`)
   - Logical replication via `pgoutput` plugin
   - Binary pgoutput message parsing (Relation, Begin, Insert, Update, Delete, Commit)
   - Relation message caching by OID for column name mapping
   - Offset tracking per event

2. **WAL slot health monitoring** (`packages/server`)
   - Query `pg_replication_slots` for `lag_bytes` every 30s
   - Warn at configurable threshold (default 512MB)
   - Alert and emit event if slot becomes inactive

3. **Offset-based reconnection**
   - Client stores last received offset
   - On reconnect, sends offset in subscribe message
   - Server replays events from that offset via `replayFrom()`

4. **JWT authentication**
   - Verify JWT on WebSocket handshake
   - Extract user ID from token payload
   - Reject connection if token invalid/expired

5. **Table-level permission callback**
   - `opts.permissions(userId, table)` evaluated on subscribe

6. **Filter validation**
   - Parse `column operator value` format
   - Validate column against `allowedFilterColumns`
   - Validate operator against allowlist
   - In-process `matchesFilter()` per event

7. **Integration test suite**
   - Docker Compose with PostgreSQL (wal_level=logical)
   - Tests: INSERT delivery, UPDATE delivery, DELETE delivery
   - Tests: reconnection backfill
   - Tests: permission rejection
   - Tests: filter validation and matching

8. **Publish to npm**
   - `@livesql/core` v0.1.0-alpha
   - `@livesql/server` v0.1.0-alpha
   - `@livesql/client` v0.1.0-alpha

---

## Phase 2 — React SDK & Ecosystem + Beta (Weeks 10-16)

**Goal**: Ship framework integrations, row-level permissions, production-grade server features, documentation, and a polished demo. Publish beta and announce.

**Success gate**: A React developer can `npm install @livesql/react`, wrap their app in `<LiveSQLProvider>`, and use `useLiveQuery('orders')` to get live data.

### Deliverables

1. **React package** (`packages/react`)
   - `LiveSQLProvider` context provider
   - `useLiveQuery<T>(table, options?)` hook
   - `useLiveTable<T>(table, options?)` Map-based hook
   - `useLiveSQLClient()` escape hatch

2. **Vue composables** (`packages/vue`)
   - `useLiveQuery` composable

3. **Svelte stores** (`packages/svelte`)
   - `liveQuery` store

4. **Row-level permission callback**
   - `opts.rowPermission(userId, table, row)` evaluated per event

5. **Update batching & backpressure**
   - `EventBatcher`: coalesce events, flush at 50 or 16ms
   - Drop events when `ws.bufferedAmount > 1MB`
   - Emit `client:backpressure` event

6. **Docusaurus documentation site** (`apps/docs`)
   - 5-minute quickstart tutorial
   - Concepts page: how sync works
   - API reference for all packages
   - Migration guide from Supabase Realtime

7. **Polished demo application**
   - Collaborative dashboard with multiple data types
   - React-based, showcasing useLiveQuery

8. **k6 load test suite**
   - Target: 1,000 concurrent WebSocket connections
   - Metrics: connection time, message latency (p50/p95/p99), throughput

9. **Publish beta**
   - All packages at v0.5.0-beta
   - Post to HackerNews Show HN

---

## Phase 3 — Production Hardening & v1.0 (Weeks 17-24)

**Goal**: Make LiveSQL production-ready. Chaos testing, observability, failover handling, comprehensive TypeScript types, and stable v1.0 release.

### Deliverables

1. **Chaos test suite** (`tests/chaos`)
   - Toxiproxy for network partitions
   - Network partition between CDC consumer and PostgreSQL
   - Slow client (high bufferedAmount)
   - PostgreSQL primary failover (pg_ctl promote)
   - WAL disk approaching limit
   - Mass reconnect (thundering herd — 1,000 clients)
   - Invalid filter injection attempt

2. **Exponential backoff with jitter**
   - Prevent thundering herd on server restart
   - Jitter: +/-10-25% random delay

3. **Observability hooks**
   - `onEvent`, `onError`, `onSlotLag`
   - `onClientConnect`, `onClientDisconnect`

4. **Replication slot failover handling**
   - Detect missing slot on reconnect
   - Recreate slot, warn user of potential gap

5. **Comprehensive TypeScript types**
   - Full types for all configuration options
   - Strict generics on all hooks

6. **Performance benchmark**
   - Measure p50/p95/p99 end-to-end latency
   - Publish results in docs

7. **Migration guides**
   - From Supabase Realtime
   - From Firebase Realtime Database

8. **Publish v1.0.0 stable**
   - Launch blog post
   - Submit to Hacker News front page

---

## Phase 4 — MySQL & Enterprise (Weeks 25+)

**Goal**: Expand database support and build monetization path. Only proceed based on actual user demand.

### Deliverables (demand-gated)

1. **MySQL binlog provider** (only if >20 GitHub issues request it)
   - Implement `MySQLProvider` using `@vlasky/zongji` or maintained fork
   - MySQL binlog captures schema changes (unlike PostgreSQL WAL)
   - No Row-Level Security equivalent — handle in application layer

2. **Managed cloud service** (LiveSQL Cloud)
   - Open-core monetization model
   - Free tier: 50 connections, 2GB sync/month
   - Pro: $49/month, 1,000 connections, 30GB
   - Team: $599/month, SLAs, compliance

3. **Enterprise features**
   - Audit logging
   - SAML SSO
   - SLA-backed uptime
   - Compliance reports

---

## Future Ideas

### PostgREST + LiveSQL Integration

PostgREST (MIT, 24k+ stars) auto-generates a REST API from Postgres tables. LiveSQL streams changes via WebSocket. Together they give the full Supabase experience (CRUD + real-time) without vendor lock-in — two open-source sidecars on any Postgres.

**Deliverables:**

1. **Docker Compose one-command demo** — `docker compose up` spins up Postgres + PostgREST + LiveSQL + React frontend. Zero backend code, full real-time CRUD.
2. **"Works with PostgREST" integration guide** — docs page showing the architecture, setup, and React example.
3. **HN launch angle** — position LiveSQL as "the real-time companion to PostgREST." Targets an established community rather than competing with Supabase head-on.

**Why this matters:**

- PostgREST handles reads/writes, LiveSQL handles live updates — complementary, not competing
- Both are sidecars: no app code, no migration, no lock-in
- Works with any Postgres: self-hosted, RDS, Neon, Supabase, etc.
- Strong positioning for launch: piggyback on PostgREST's established trust
