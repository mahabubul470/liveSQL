# Architecture Decision Records

## ADR-001: WAL Logical Replication over LISTEN/NOTIFY

**Status**: Accepted
**Date**: February 2026

### Context

PostgreSQL offers three approaches for Change Data Capture: polling, LISTEN/NOTIFY, and WAL logical replication. The choice determines reliability, performance, and scaling of the entire system.

### Decision

Use WAL logical replication via the `pgoutput` plugin as the primary CDC mechanism. Use LISTEN/NOTIFY only for the Phase 0 proof of concept, then replace it.

### Rationale

**LISTEN/NOTIFY problems:**

- Delivers notifications at-most-once — a disconnected listener permanently misses messages
- Payload limit is 8,000 bytes, forcing row-ID-only payloads + re-querying
- NOTIFY acquires a global lock on the entire database during the commit phase, serializing all commits under heavy concurrent writes (discovered by Recall.ai)
- Useful only as a lightweight signaling complement, not a primary CDC mechanism

**WAL logical replication advantages:**

- Guaranteed delivery with historical replay (no missed events)
- Near-zero overhead — PostgreSQL already writes WAL during normal operation
- Sub-second latency via replication slot streaming
- ElectricSQL benchmarks show 20,000 changes/second in production
- Built-in consumer position tracking via replication slots

**WAL risks (accepted):**

- WAL disk exhaustion if consumer disconnects (mitigated by `max_slot_wal_keep_size`)
- Replication slot failover causes data loss (mitigated by slot recreation + gap warning)
- Schema changes invisible in WAL stream (mitigated by Relation message cache refresh)

### Consequences

- Requires PostgreSQL 13+ with `wal_level = logical`
- Must implement binary pgoutput message parsing
- Must implement WAL slot health monitoring from day one
- Must set `REPLICA IDENTITY FULL` on all watched tables

---

## ADR-002: WebSockets over HTTP Polling and SSE

**Status**: Accepted
**Date**: February 2026

### Context

The transport layer needs to deliver change events from server to client. Options: HTTP polling, Server-Sent Events (SSE), HTTP long-polling, or WebSockets.

### Decision

Use WebSockets (WSS) as the primary transport with offset-based resumption. Consider adding SSE as an alternative transport in the future for CDN cacheability.

### Rationale

- **Sub-100ms latency** — persistent connection eliminates HTTP overhead
- **Bi-directional** — clients can subscribe/unsubscribe without new HTTP requests
- **Offset-based resumption** — clients store last offset, send on reconnect, server replays from that position. Server remains stateless (no per-client session storage)
- ElectricSQL chose HTTP long-polling/SSE for CDN cacheability, but LiveSQL targets direct connections where latency matters most

### Consequences

- Each WebSocket connection consumes ~14-64KB of memory
- Need heartbeat (30s ping) to detect stale connections
- Need backpressure detection for slow clients
- Need exponential backoff with jitter for reconnection
- 10,000 connections ≈ 2GB RAM for buffers alone
- Consider planned periodic connection interruptions at scale

---

## ADR-003: Auth Outside the Sync Engine

**Status**: Accepted
**Date**: February 2026

### Context

Authentication and authorization are required for production use. Supabase evaluates Row-Level Security per subscriber per change, creating N database reads for N subscribers. ElectricSQL pushes auth to an HTTP proxy layer.

### Decision

Keep authentication and authorization outside the sync engine. Developers use their existing middleware (Express, Fastify, etc.) to authenticate, and provide permission callbacks to LiveSQL.

### Rationale

- Supabase's approach couples scaling of authorization to scaling of data delivery — N subscribers × 1 change = N database reads
- ElectricSQL's approach scales independently — auth is evaluated once at the proxy, sync engine only handles delivery
- Developers already have auth infrastructure — forcing them into LiveSQL's auth model creates adoption friction
- Three-layer permission model (table allowlist → table permission → row permission) provides granular control without database round-trips

### Consequences

- Permission callbacks are application code — bugs in user-provided callbacks can leak data
- Row-level permission is evaluated per event in-process (CPU cost, not DB cost)
- No automatic integration with PostgreSQL RLS — developers must mirror RLS logic in callbacks
- Filter validation prevents SQL injection from client-supplied filter expressions

---

## ADR-004: Server-Authoritative Model (No CRDTs)

**Status**: Accepted
**Date**: February 2026

### Context

Conflict resolution ranges from simple (last-write-wins) to research-level (CRDTs, OT). PowerSync and ElectricSQL v1.x both use server-authoritative models.

### Decision

Use a server-authoritative model where the server's state is always canonical. Adopt last-write-wins for v1. Evaluate CRDTs for v2+ only if user demand justifies the complexity.

### Rationale

- "CRDTs have been a distraction... You can get very far without addressing conflict resolution. If you can have single ownership or last write wins, you can drop a massive pile of complexity on the floor." — HackerNews (highly upvoted)
- Server-authoritative serves the vast majority of use cases: dashboards, notifications, collaborative views, admin panels
- CRDT support can be added later without breaking the server-authoritative model
- ElectricSQL rewrote their entire stack in July 2024, moving away from CRDT complexity

### Consequences

- No offline-first write support in v1 (read-only sync)
- Concurrent writes to the same row: last committed transaction wins
- Write operations go through the application's existing API (REST/GraphQL), not through LiveSQL

---

## ADR-005: ChangeProvider Interface from Day One

**Status**: Accepted
**Date**: February 2026

### Context

LiveSQL targets PostgreSQL first with MySQL planned for the future. Building MySQL support into v1 would delay shipping significantly, but the architecture should not prevent it.

### Decision

Define an abstract `ChangeProvider` interface from day one. PostgreSQL is the first implementation. MySQL support is a new provider implementation, not an architecture change.

### Rationale

- Every successful sync engine validates the Postgres-first strategy: PowerSync, ElectricSQL, Supabase are all Postgres-only or Postgres-first
- MySQL's Node.js binlog ecosystem is fragmented and poorly maintained
- PostgreSQL has 55.6% developer usage vs MySQL at 40.5% (Stack Overflow 2025)
- The ChangeProvider interface costs almost nothing to define upfront but saves months of refactoring later
- Market the library as "PostgreSQL-first" (not "PostgreSQL-only") — both PowerSync and Supabase proved this messaging works

### Consequences

- Must design the ChangeProvider interface to accommodate MySQL's differences (binlog has filenames + positions instead of LSNs, captures schema changes unlike PG WAL)
- Phase 4 MySQL implementation only proceeds if >20 GitHub issues request it
- No wasted effort on MySQL until there's proven demand

---

## ADR-006: TypeScript Monorepo

**Status**: Accepted
**Date**: February 2026

### Context

The project needs both a server-side component and client-side SDKs. Language choices include TypeScript, Rust, Go, or a mix.

### Decision

Use TypeScript for both server and client in a pnpm workspace monorepo.

### Rationale

- One language maximizes contributor accessibility — 92% of JS/TS projects use permissive licenses and the community is the largest in open source
- Shared type definitions across the wire protocol (server and client import from `@livesql/core`)
- Prisma's experience: their Rust engine historically limited community contributions because TypeScript developers couldn't contribute to Rust code. They're migrating to pure TypeScript in Prisma 7
- pnpm workspaces enable independent versioning and publishing while keeping everything in one repo
- TypeScript strict mode catches bugs at compile time

### Consequences

- Node.js performance ceiling for the server (acceptable for 10,000+ connections)
- Cannot leverage Rust/Go for CPU-intensive pgoutput parsing (profile first, optimize later if needed)
- All contributors need TypeScript knowledge (very common)

---

## ADR-007: Apache 2.0 License

**Status**: Accepted
**Date**: February 2026

### Context

License choice affects adoption, enterprise acceptance, and competitive positioning.

### Decision

Apache 2.0 license for all packages.

### Rationale

- Provides patent protection that enterprises require
- Permissive enough for maximum adoption
- Matches ElectricSQL's license
- MIT is simpler but lacks patent protection
- BSL, AGPL, and SSPL all create adoption friction
- 92% of JavaScript/TypeScript projects use permissive licenses
- PowerSync uses FSL (Functional Source License) which restricts commercial use — this is a competitive advantage for LiveSQL

### Consequences

- No license-based monetization (open-core model instead)
- Competitors can fork and build on LiveSQL (acceptable — community and execution are the moat)
