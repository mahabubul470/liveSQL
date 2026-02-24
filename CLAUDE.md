# LiveSQL

**Open-source, drop-in TypeScript library that streams SQL database changes to web clients via WebSockets.**

LiveSQL attaches to your existing PostgreSQL (MySQL planned) as a sidecar — no database migration, no vendor lock-in, no architecture changes. A developer can add real-time sync to an existing SQL table in under 10 lines of code with end-to-end latency under 100ms.

---

## Tech Stack

| Layer           | Choice                | Why                                                         |
| --------------- | --------------------- | ----------------------------------------------------------- |
| Language        | TypeScript (strict)   | One language for server + client; contributor accessibility |
| Package manager | pnpm workspaces       | Monorepo with independent versioning/publishing             |
| Runtime         | Node.js 20+           | LTS, native WebSocket support                               |
| Build           | tsup                  | Fast, zero-config TypeScript bundler                        |
| Test            | vitest                | Fast, ESM-native, compatible with TypeScript                |
| Lint            | eslint + prettier     | @typescript-eslint/eslint-plugin                            |
| Git hooks       | husky + lint-staged   | Pre-commit formatting and linting                           |
| Versioning      | changesets            | Monorepo-aware version management                           |
| Docs            | Docusaurus (Phase 2+) | Used by React Native, Supabase                              |
| License         | Apache 2.0            | Permissive + patent protection                              |

## Monorepo Structure

```
livesql/
├── packages/
│   ├── core/           # Shared types, wire protocol, ChangeProvider interface
│   ├── server/         # Node.js CDC engine + WebSocket server
│   ├── client/         # Framework-agnostic client SDK
│   ├── react/          # React hooks (useLiveQuery, useLiveTable)
│   ├── vue/            # Vue composables (Phase 2)
│   └── svelte/         # Svelte stores (Phase 2)
├── apps/
│   ├── demo/           # Reference dashboard application
│   └── docs/           # Docusaurus documentation site (Phase 2)
├── tests/
│   ├── integration/    # End-to-end sync correctness tests
│   └── chaos/          # Network partition & failover tests
├── docs/               # Architecture, specs, tracking (for development)
├── CLAUDE.md           # This file
├── pnpm-workspace.yaml
└── package.json
```

## Core Architectural Decisions

These are settled. Do not revisit unless explicitly asked.

1. **PostgreSQL WAL logical replication** — not LISTEN/NOTIFY. WAL provides guaranteed delivery, historical replay, and no missed events. LISTEN/NOTIFY is unreliable (8KB payload limit, at-most-once delivery, global commit lock). Use LISTEN/NOTIFY only as an optional lightweight signaling complement. See [docs/decisions.md](docs/decisions.md) ADR-001.

2. **WebSockets with offset-based resumption** — not HTTP polling or SSE. Persistent connections provide sub-100ms latency. Clients track their last offset and send it on reconnect to resume from the exact position. Server remains stateless (no per-client session storage). See ADR-002.

3. **Auth outside the sync engine** — not inside it. Follow ElectricSQL's middleware pattern: developers use their existing auth middleware to filter subscriptions before they reach the sync engine. Supabase's model of running RLS per subscriber per change creates N database reads for N subscribers. Separation enables independent scaling. See ADR-003.

4. **Server-authoritative model** — no CRDTs for v1. The server's state is always canonical. Last-write-wins for conflicts. CRDTs add massive complexity with marginal benefit for most use cases. See ADR-004.

5. **ChangeProvider interface from day one** — abstract CDC mechanism from transport. Future MySQL support is a matter of implementing the interface, not restructuring. See ADR-005.

6. **TypeScript monorepo** — one language for both server and client. Maximizes contributor accessibility and enables shared type definitions across the wire protocol. See ADR-006.

## Coding Conventions

### TypeScript

- `strict: true` in all tsconfig files
- `exactOptionalPropertyTypes: true`
- `noUncheckedIndexedAccess: true`
- Target: ES2022, Module: NodeNext
- Use `interface` for object shapes, `type` for unions/intersections
- Export types explicitly — no `export *`
- Prefer `async/await` over raw Promises
- Use `BigInt` for offsets and LSNs (not number)

### Naming

- Files: `kebab-case.ts` (e.g., `slot-health.ts`, `live-sql-client.ts`)
- Classes: `PascalCase` (e.g., `PostgresProvider`, `LiveSQLClient`)
- Functions/variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE` for true constants
- Interfaces: `PascalCase`, no `I` prefix
- Types: `PascalCase`

### File Structure (per package)

```
packages/<name>/
├── src/
│   ├── index.ts          # Public API exports only
│   ├── <feature>.ts      # Implementation files
│   └── __tests__/        # Co-located unit tests
├── package.json
├── tsconfig.json
└── tsconfig.build.json
```

### Security Rules (CRITICAL)

- **NEVER** execute client-provided SQL against the database
- **NEVER** expose raw database ports (5432, 3306) to clients
- **ALWAYS** validate filter expressions against a strict allowlist of column names and operators
- **ALWAYS** require JWT authentication on WebSocket handshake
- **ALWAYS** check table-level permissions on subscribe
- **ALWAYS** check row-level permissions on every change event
- **ALWAYS** set `REPLICA IDENTITY FULL` on watched tables
- **ALWAYS** set `max_slot_wal_keep_size` in PostgreSQL config

## Commands

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Build a specific package
pnpm --filter @livesql/core build

# Run all tests
pnpm test

# Run tests for a specific package
pnpm --filter @livesql/server test

# Lint
pnpm lint

# Format
pnpm format

# Type check
pnpm typecheck

# Start demo app
pnpm --filter demo dev

# Start dev PostgreSQL (Docker)
docker compose -f docker-compose.test.yml up -d
```

## Git Workflow

### Commit Messages

Use conventional commits:

```
feat(core): add ChangeEvent wire protocol types
fix(server): prevent WAL slot leak on disconnect
test(integration): add reconnection backfill test
docs: update architecture diagram
chore: configure pnpm workspace
```

### Branch Naming

```
feat/<short-description>
fix/<short-description>
docs/<short-description>
chore/<short-description>
```

## Current Phase

**Phase 0 — Foundation & PoC (Weeks 1–3)**

The immediate goal is a working proof of concept: insert a row in psql, see it appear in the browser within 100ms. Use LISTEN/NOTIFY for the PoC (simplest path), then replace with WAL in Phase 1.

Phase 0 deliverables:

1. Scaffold pnpm monorepo with packages/core, packages/server, packages/client
2. Define wire protocol types in packages/core
3. Define ChangeProvider interface in packages/core
4. Build PostgreSQL LISTEN/NOTIFY provider (temporary, for PoC only)
5. Build minimal WebSocket server with fan-out
6. Build vanillaJS client that subscribes and logs events
7. Create a single demo: live order status dashboard
8. Write a 5-minute quickstart README

**Success gate**: A developer can clone the repo, run docker compose + pnpm dev, and see a DB INSERT appear in the browser in under 5 minutes.

See [docs/implementation-plan.md](docs/implementation-plan.md) for all phases.
See [docs/progress.md](docs/progress.md) for current task tracking.

## Working With This Codebase

### For Claude (AI Assistant)

- **Autonomy**: Make reasonable implementation decisions and explain your choices. Only ask for major architectural direction changes.
- **Before coding**: Always read the relevant existing files first. Check docs/progress.md for current status.
- **New sessions**: Read this file first, then docs/progress.md to understand where we left off.
- **Architecture reference**: See docs/architecture.md for system design, docs/api-spec.md for API contracts.
- **Known dangers**: See docs/failure-modes.md before touching CDC, WebSocket, or reconnection code.
- **Testing**: Every feature needs tests. Use vitest. Integration tests need Docker PostgreSQL.
- **Don't over-engineer**: Ship the simplest thing that works for the current phase. No premature abstractions.
- **Package boundaries**: core has zero dependencies. server depends on core + pg + ws. client depends on core. react/vue/svelte depend on client.

### For Contributors

- Run `pnpm install` at the root
- Run `docker compose -f docker-compose.test.yml up -d` for a test PostgreSQL instance
- Each package builds independently: `pnpm --filter @livesql/<package> build`
- Tests require a running PostgreSQL with `wal_level=logical`
- See docs/architecture.md for system overview before diving into code

## Key Reference Docs

| Doc                                                        | Purpose                                 |
| ---------------------------------------------------------- | --------------------------------------- |
| [docs/architecture.md](docs/architecture.md)               | System design, wire protocol, data flow |
| [docs/api-spec.md](docs/api-spec.md)                       | Full API specification for all packages |
| [docs/implementation-plan.md](docs/implementation-plan.md) | Phased roadmap with deliverables        |
| [docs/progress.md](docs/progress.md)                       | Current task tracking (checkboxes)      |
| [docs/decisions.md](docs/decisions.md)                     | Architecture Decision Records           |
| [docs/failure-modes.md](docs/failure-modes.md)             | Production failure modes & mitigations  |
