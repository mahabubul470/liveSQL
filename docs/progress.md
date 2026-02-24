# LiveSQL Progress Tracker

> Update this file as tasks are completed. Check boxes with `[x]`.

---

## Phase 0 — Foundation & PoC

### Monorepo Setup

- [ ] Initialize git repository
- [ ] Create `pnpm-workspace.yaml`
- [ ] Create root `package.json` with workspace scripts
- [ ] Create root `tsconfig.base.json` (ES2022, NodeNext, strict)
- [ ] Configure eslint + prettier
- [ ] Configure husky + lint-staged
- [ ] Create `.gitignore`
- [ ] Create `docker-compose.test.yml` (PostgreSQL 16, wal_level=logical)

### packages/core

- [ ] Create `package.json` for `@livesql/core`
- [ ] Create `tsconfig.json` with project references
- [ ] Define `ChangeType` and `ChangeEvent` types
- [ ] Define `SubscribeMessage` and `UnsubscribeMessage` types
- [ ] Define `SyncMessage` and `ErrorMessage` types
- [ ] Define `ClientMessage` and `ServerMessage` union types
- [ ] Define `ChangeProvider` interface
- [ ] Create `index.ts` with public exports
- [ ] Build succeeds with `tsup`

### packages/server

- [ ] Create `package.json` for `@livesql/server`
- [ ] Create `tsconfig.json`
- [ ] Implement `ListenNotifyProvider` (LISTEN/NOTIFY for PoC)
- [ ] Create trigger function for INSERT/UPDATE/DELETE notifications
- [ ] Implement minimal WebSocket server (`createLiveSQLServer`)
- [ ] Handle subscribe/unsubscribe messages
- [ ] Fan-out events to matching subscribers
- [ ] Create `index.ts` with public exports
- [ ] Build succeeds

### packages/client

- [ ] Create `package.json` for `@livesql/client`
- [ ] Create `tsconfig.json`
- [ ] Implement `LiveSQLClient` class
- [ ] WebSocket connect and message handling
- [ ] Subscribe/unsubscribe methods
- [ ] Basic reconnection (simple retry)
- [ ] Offset tracking
- [ ] Create `index.ts` with public exports
- [ ] Build succeeds

### apps/demo

- [ ] Create demo application (HTML + vanilla JS)
- [ ] Live order status dashboard
- [ ] Auto-updates on INSERT/UPDATE/DELETE
- [ ] SQL setup script for demo tables

### Documentation

- [ ] Write README.md with 5-minute quickstart
- [ ] Verify: clone → install → docker up → insert row → see in browser < 5 min

---

## Phase 1 — WAL-Based CDC Engine + Alpha

### PostgreSQL WAL Provider

- [ ] Implement `PostgresProvider` class
- [ ] Create publication and replication slot
- [ ] Open replication connection
- [ ] Parse pgoutput binary messages (Relation, Begin, Insert, Update, Delete, Commit)
- [ ] Cache Relation messages by OID
- [ ] Map column positions to names
- [ ] Emit `ChangeEvent` for each row change
- [ ] Track monotonic offset per event
- [ ] Implement `replayFrom(offset)` for reconnection backfill

### WAL Slot Health

- [ ] Implement `checkSlotHealth()` function
- [ ] Query `pg_replication_slots` for `lag_bytes`
- [ ] Configurable warning threshold (default 512MB)
- [ ] Emit `slot:lag-warning` event
- [ ] Emit `slot:inactive` event
- [ ] Run health check on 30s interval

### Authentication & Permissions

- [ ] JWT verification on WebSocket handshake
- [ ] Token from query string (`?token=`) or Authorization header
- [ ] `opts.permissions(userId, table)` callback on subscribe
- [ ] Reject with `FORBIDDEN` error code

### Filter Validation

- [ ] Implement `validateFilter()` — parse `column operator value`
- [ ] Validate column against `allowedFilterColumns`
- [ ] Validate operator against allowlist (`=`, `!=`, `<`, `>`, `<=`, `>=`)
- [ ] Implement `matchesFilter()` — in-process filter evaluation
- [ ] Reject with `INVALID_FILTER` error code

### Reconnection

- [ ] Client stores `lastOffset` on every received event
- [ ] Client sends `offset` in subscribe message on reconnect
- [ ] Server replays from offset via `replayFrom()`
- [ ] Exponential backoff: 250ms → 30s cap

### Integration Tests

- [ ] Test: INSERT event delivered to subscribed client
- [ ] Test: UPDATE event delivered with old + new row
- [ ] Test: DELETE event delivered
- [ ] Test: Reconnection backfills missed events
- [ ] Test: Permission rejection returns FORBIDDEN
- [ ] Test: Invalid filter returns INVALID_FILTER
- [ ] Test: Unsubscribe stops event delivery

### Publish Alpha

- [ ] `@livesql/core` v0.1.0-alpha on npm
- [ ] `@livesql/server` v0.1.0-alpha on npm
- [ ] `@livesql/client` v0.1.0-alpha on npm

---

## Phase 2 — React SDK & Ecosystem + Beta

### React Package

- [ ] `LiveSQLProvider` context provider
- [ ] `useLiveQuery<T>()` hook with insert/update/delete handling
- [ ] `useLiveTable<T>()` Map-based hook
- [ ] `useLiveSQLClient()` escape hatch

### Vue Package

- [ ] `useLiveQuery` composable

### Svelte Package

- [ ] `liveQuery` store

### Server Hardening

- [ ] Row-level permission: `opts.rowPermission(userId, table, row)`
- [ ] `EventBatcher` — coalesce, flush at 50 events or 16ms
- [ ] Backpressure detection (`ws.bufferedAmount > 1MB`)
- [ ] Emit `client:backpressure` event

### Documentation Site

- [ ] Set up Docusaurus in `apps/docs`
- [ ] 5-minute quickstart tutorial
- [ ] Concepts page: how sync works
- [ ] API reference for all packages
- [ ] Migration guide from Supabase Realtime

### Demo & Load Testing

- [ ] Polished React demo application
- [ ] k6 load test: 1,000 concurrent clients
- [ ] Published benchmark results

### Publish Beta

- [ ] All packages at v0.5.0-beta
- [ ] HackerNews Show HN post

---

## Phase 3 — Production Hardening & v1.0

### Chaos Tests

- [ ] Network partition (Toxiproxy)
- [ ] Slow client / high bufferedAmount
- [ ] PostgreSQL primary failover
- [ ] WAL disk approaching limit
- [ ] Mass reconnect (thundering herd)
- [ ] SQL injection via filter

### Production Features

- [ ] Exponential backoff with jitter (+/-10-25%)
- [ ] Observability hooks: onEvent, onError, onSlotLag, onClientConnect, onClientDisconnect
- [ ] Replication slot failover detection and recreation
- [ ] Comprehensive TypeScript types for all config

### Documentation

- [ ] Performance benchmark (p50/p95/p99)
- [ ] Migration guide from Firebase Realtime Database
- [ ] Launch blog post

### Publish v1.0

- [ ] All packages at v1.0.0
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
