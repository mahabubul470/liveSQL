# LiveSQL Progress Tracker

> Update this file as tasks are completed. Check boxes with `[x]`.

### Current Sprint — v1.0.0-beta.1 Release

#### Pre-Release Documentation

1. [x] Update README: npm badge to beta, remove alpha references, update roadmap Phase 3 to say "beta"
2. [x] Update svelte package description to include `liveTable` (already done)
3. [x] Package READMEs: review for accuracy, ensure install commands don't reference alpha
4. [x] CONTRIBUTING.md: brief contributor guide (setup, PR process, coding conventions)
5. [x] CHANGELOG.md: summarize changes from alpha → beta (features, breaking changes if any)
6. [x] Docs site (`apps/docs`): update intro page version references to beta (already version-agnostic)
7. [x] Integration guide: brief "Adding LiveSQL to an existing Express/Fastify app" page
8. [x] Deployment guide: brief "Running LiveSQL in production" (PostgreSQL config, env vars, health checks)
9. [x] PostgREST integration guide: "Using PostgREST + LiveSQL" — Docker Compose setup, architecture diagram, example showing PostgREST for CRUD + LiveSQL for real-time streaming

#### Release

10. [x] Bump all package versions to `1.0.0-beta.1`
11. [x] Add `publishConfig: { "access": "public" }` to all packages (already set)
12. [x] Build all packages (`pnpm build`)
13. [x] Run full test suite (`pnpm test`) — 163 tests passing
14. [ ] Commit version bump and doc updates
15. [ ] Publish to npm in dependency order: core → client → server → react → vue → svelte
16. [ ] Create git tag `v1.0.0-beta.1` and GitHub release with beta pre-release flag
17. [ ] Push tag and release

#### Post-Release

18. [ ] Hacker News "Show HN" submission
19. [ ] Reddit post (r/typescript, r/node, r/webdev)
20. [ ] Twitter/X announcement thread
21. [ ] Dev.to / Hashnode launch blog post (how LiveSQL works, benchmarks, quick start)
22. [ ] PostgREST deeper integration: shared Docker Compose template, example repo (`postgrest-livesql-starter`), optional auto-discovery of PostgREST tables
23. [ ] Collect feedback for 2–4 weeks
24. [ ] Triage issues and fix API ergonomic problems (if any)
25. [ ] Promote to `v1.0.0` stable release once feedback is addressed

### Previous Sprint — Phase 3: Production Hardening — DONE

1. ~~Chaos tests (23 tests across 6 failure modes)~~ → all passing
2. ~~Replication slot failover detection and auto-recovery~~ → PostgresProvider.recoverFromSlotLoss()
3. ~~Comprehensive TypeScript types~~ → audit clean, added useLiveTable to Vue/Svelte for parity
4. ~~Firebase migration guide~~ → apps/docs/docs/guides/migration-firebase.md
5. ~~Fix integration test event batching assertions~~ → predicate-based wait instead of exact count

### Previous Sprint (2026-03-07) — DONE

1. ~~Authorization header support (`Bearer <token>`)~~ → Phase 1 complete
2. ~~k6 load test (1,000 concurrent clients)~~ → p95 96ms, all thresholds passed
3. ~~Publish benchmark results~~ → tests/load/RESULTS.md
4. ~~Observability hooks (`onEvent`, `onClientConnect`, `onClientDisconnect`)~~ → done

---

## Phase 0 — Foundation & PoC

### Monorepo Setup

- [x] Initialize git repository
- [x] Create `pnpm-workspace.yaml`
- [x] Create root `package.json` with workspace scripts
- [x] Create root `tsconfig.base.json` (ES2022, NodeNext, strict)
- [x] Configure eslint + prettier
- [x] Configure husky + lint-staged
- [x] Create `.gitignore`
- [x] Create `docker-compose.test.yml` (PostgreSQL 16, wal_level=logical)

### packages/core

- [x] Create `package.json` for `@livesql/core`
- [x] Create `tsconfig.json` with project references
- [x] Define `ChangeType` and `ChangeEvent` types
- [x] Define `SubscribeMessage` and `UnsubscribeMessage` types
- [x] Define `SyncMessage` and `ErrorMessage` types
- [x] Define `ClientMessage` and `ServerMessage` union types
- [x] Define `ChangeProvider` interface
- [x] Create `index.ts` with public exports
- [x] Build succeeds with `tsup`

### packages/server

- [x] Create `package.json` for `@livesql/server`
- [x] Create `tsconfig.json`
- [x] Implement `ListenNotifyProvider` (LISTEN/NOTIFY for PoC)
- [x] Create trigger function for INSERT/UPDATE/DELETE notifications
- [x] Implement minimal WebSocket server (`createLiveSQLServer`)
- [x] Handle subscribe/unsubscribe messages
- [x] Fan-out events to matching subscribers
- [x] Create `index.ts` with public exports
- [x] Build succeeds

### packages/client

- [x] Create `package.json` for `@livesql/client`
- [x] Create `tsconfig.json`
- [x] Implement `LiveSQLClient` class
- [x] WebSocket connect and message handling
- [x] Subscribe/unsubscribe methods
- [x] Basic reconnection (simple retry)
- [x] Offset tracking
- [x] Create `index.ts` with public exports
- [x] Build succeeds

### apps/demo

- [x] Create demo application (HTML + vanilla JS)
- [x] Live order status dashboard
- [x] Auto-updates on INSERT/UPDATE/DELETE
- [x] SQL setup script for demo tables

### Documentation

- [x] Write README.md with 5-minute quickstart
- [x] Verify: clone → install → docker up → insert row → see in browser < 5 min

---

## Phase 1 — WAL-Based CDC Engine + Alpha

### PostgreSQL WAL Provider

- [x] Implement `PostgresProvider` class
- [x] Create publication and replication slot
- [x] Open replication connection
- [x] Parse pgoutput binary messages (Relation, Begin, Insert, Update, Delete, Commit)
- [x] Cache Relation messages by OID
- [x] Map column positions to names
- [x] Emit `ChangeEvent` for each row change
- [x] Track monotonic offset per event
- [x] Implement `replayFrom(offset)` for reconnection backfill

### WAL Slot Health

- [x] Implement `checkSlotHealth()` function
- [x] Query `pg_replication_slots` for `lag_bytes`
- [x] Configurable warning threshold (default 512MB)
- [x] Emit `slot:lag-warning` event
- [x] Emit `slot:inactive` event
- [x] Run health check on 30s interval

### Authentication & Permissions

- [x] JWT verification on WebSocket handshake
- [x] Token from query string (`?token=`)
- [x] Token from Authorization header (`Bearer <token>`)
- [x] `opts.permissions(userId, table)` callback on subscribe
- [x] Reject with `FORBIDDEN` error code

### Filter Validation

- [x] Implement `validateFilter()` — parse `column operator value`
- [x] Validate column against `allowedFilterColumns`
- [x] Validate operator against allowlist (`=`, `!=`, `<`, `>`, `<=`, `>=`)
- [x] Implement `matchesFilter()` — in-process filter evaluation
- [x] Reject with `INVALID_FILTER` error code

### Reconnection

- [x] Client stores `lastOffset` on every received event
- [x] Client sends `offset` in subscribe message on reconnect
- [x] Server replays from offset via `replayFrom()`
- [x] Exponential backoff: 250ms → 30s cap

### Integration Tests

- [x] Test: INSERT event delivered to subscribed client
- [x] Test: UPDATE event delivered with old + new row
- [x] Test: DELETE event delivered
- [x] Test: Reconnection backfills missed events
- [x] Test: Permission rejection returns FORBIDDEN
- [x] Test: Invalid filter returns INVALID_FILTER
- [x] Test: Unsubscribe stops event delivery

### Publish Alpha

- [x] `@livesql/core` v0.1.0-alpha.2 on npm (updated to alpha.3 in Phase 2)
- [x] `@livesql/server` v0.1.0-alpha.2 on npm (updated to alpha.3 in Phase 2)
- [x] `@livesql/client` v0.1.0-alpha.2 on npm (updated to alpha.3 in Phase 2)

---

## Phase 2 — React SDK & Ecosystem + Beta

### React Package

- [x] `LiveSQLProvider` context provider
- [x] `useLiveQuery<T>()` hook with insert/update/delete handling
- [x] `useLiveTable<T>()` Map-based hook
- [x] `useLiveSQLClient()` escape hatch

### Vue Package

- [x] `useLiveQuery` composable
- [x] `useLiveTable` composable (Map-based, O(1) row lookups)
- [x] `createLiveSQLPlugin` Vue plugin (provide/inject via `LIVESQL_CLIENT_KEY`)

### Svelte Package

- [x] `liveQuery` store (lazy `Readable<{data, loading, error}>`, explicit client param)
- [x] `liveTable` store (Map-based, O(1) row lookups)

### Server Hardening

- [x] Row-level permission: `opts.rowPermission(userId, table, row)` (Phase 1)
- [x] `EventBatcher` — coalesce, flush at 50 events or 16ms
- [x] Backpressure detection (`ws.bufferedAmount > 1MB`)
- [x] `opts.onBackpressure(userId)` callback

### Client Hardening

- [x] `LiveSQLError` exported from `@livesql/client`
- [x] `onError` callback in `subscribe()` routes server errors to callers
- [x] `filter` param in `subscribe()` sent in subscribe/re-subscribe messages

### Publish Alpha

- [x] `@livesql/core` v0.1.0-alpha.3 on npm
- [x] `@livesql/server` v0.1.0-alpha.3 on npm
- [x] `@livesql/client` v0.1.0-alpha.3 on npm
- [x] `@livesql/react` v0.1.0-alpha.4 on npm (first publish)
- [x] `@livesql/vue` v0.1.0-alpha.4 on npm (first publish)
- [x] `@livesql/svelte` v0.1.0-alpha.4 on npm (first publish)

### Documentation Site

- [x] Set up Docusaurus in `apps/docs`
- [x] 5-minute quickstart tutorial
- [x] Concepts page: how sync works
- [x] API reference for all packages
- [x] Migration guide from Supabase Realtime

### Demo & Load Testing

- [x] Polished React demo application (apps/react-demo — Vite + @livesql/react)
- [x] k6 load test: 1,000 concurrent clients (p95 event latency 96ms, all thresholds passed)
- [x] Published benchmark results (tests/load/RESULTS.md)

### Publish Beta

- [x] Publish beta before stable — v1.0.0-beta.1 for early adopter feedback

---

## Phase 3 — Production Hardening & v1.0

### Chaos Tests

- [x] Network partition (simulated disconnect + reconnect with offset replay)
- [x] Slow client / high bufferedAmount (backpressure detection)
- [x] PostgreSQL primary failover (slot loss detection + auto-recovery)
- [x] WAL disk approaching limit (checkSlotHealth lag detection)
- [x] Mass reconnect / thundering herd (200 simultaneous connections)
- [x] SQL injection via filter (13 injection vectors tested)

### Production Features

- [x] Exponential backoff with jitter (±25%, implemented in client)
- [x] Observability hooks: onEvent, onError, onSlotLag, onClientConnect, onClientDisconnect
- [x] Replication slot failover detection and auto-recovery (reconnectOnSlotLoss, onSlotLost)
- [x] Comprehensive TypeScript types — audit clean, useLiveTable added to Vue/Svelte

### Documentation

- [x] Performance benchmark (p50/p95/p99) — tests/load/RESULTS.md
- [x] Migration guide from Firebase Realtime Database
- [ ] Launch blog post

### Publish v1.0

- [ ] v1.0.0-beta.1 → collect feedback → v1.0.0 stable
- [ ] Hacker News submission

---

## Phase 4 — MySQL & Enterprise

### MySQL (demand-gated: >20 GitHub issues)

- [ ] Implement `MySQLProvider` with binlog support
- [ ] Integration tests for MySQL

### Enterprise

- [ ] Managed cloud service (LiveSQL Cloud)
- [ ] Audit logging
- [ ] SAML SSO
