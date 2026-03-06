# LiveSQL

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@livesql/server?label=%40livesql%2Fserver)](https://www.npmjs.com/package/@livesql/server)
[![Tests](https://img.shields.io/badge/tests-118%20passing-brightgreen.svg)](#testing)

**Stream SQL database changes to web clients in real time.**

LiveSQL is an open-source TypeScript library that connects to your existing PostgreSQL database and pushes row-level changes to the browser via WebSockets — using WAL logical replication for guaranteed delivery and sub-100ms latency. No database migration, no vendor lock-in, no architecture changes.

> **Add real-time sync to an existing SQL table in under 10 lines of code.**

## Benchmark

Tested with 1,000 concurrent WebSocket clients and 50 inserts/sec ([full results](tests/load/RESULTS.md)):

| Metric                  | Value       |
| ----------------------- | ----------- |
| p50 event latency       | 41ms        |
| **p95 event latency**   | **96ms**    |
| Peak concurrent clients | 1,000       |
| Events delivered        | 3,976,800   |
| Event throughput        | ~37,872/sec |
| Connection failures     | 0%          |

---

## Quick Example

**Server** — start streaming changes in 5 lines:

```typescript
import { createLiveSQLServer, PostgresProvider } from "@livesql/server";

const provider = new PostgresProvider({ connectionString: DATABASE_URL, tables: ["orders"] });
await provider.connect();

const livesql = createLiveSQLServer(provider, { database: DATABASE_URL, tables: ["orders"] });
livesql.attach(httpServer);
```

**React** — live-updating UI with one hook:

```tsx
import { useLiveQuery } from "@livesql/react";

function OrderList() {
  const { data: orders, loading } = useLiveQuery<Order>("orders");
  if (loading) return <p>Loading...</p>;
  return orders.map((o) => (
    <div key={o.id}>
      {o.customer_name} — {o.status}
    </div>
  ));
}
```

**Vanilla client** — framework-agnostic:

```typescript
import { LiveSQLClient } from "@livesql/client";

const client = new LiveSQLClient("ws://localhost:3000", () => authToken);
client.connect();
client.subscribe("orders", (event) => console.log(event.type, event.row));
```

---

## Install

```bash
# Server
npm install @livesql/server @livesql/core

# Client (pick your framework)
npm install @livesql/client @livesql/core        # vanilla JS
npm install @livesql/react                        # React
npm install @livesql/vue                          # Vue
npm install @livesql/svelte                       # Svelte
```

## Features

- **WAL-based CDC** — guaranteed delivery via PostgreSQL logical replication (pgoutput). No triggers, no polling.
- **Sub-100ms latency** — p95 event latency of 96ms at 1,000 concurrent clients.
- **Reconnection backfill** — clients resume from their last offset; missed events are replayed automatically.
- **Framework SDKs** — React hooks (`useLiveQuery`, `useLiveTable`), Vue composables, Svelte stores.
- **Event batching** — coalesces up to 50 events or flushes every 16ms for optimal throughput.
- **Backpressure detection** — drops events for slow clients (bufferedAmount > 1MB) to prevent OOM.
- **Filter validation** — clients filter events server-side with `"status = shipped"` syntax. Never executes SQL.
- **JWT authentication** — `?token=<jwt>` query parameter or `Authorization: Bearer` header.
- **Table and row permissions** — callbacks to enforce access control per user per change.
- **WAL slot health monitoring** — configurable lag warnings and inactive slot detection.
- **Zero migration** — attaches to existing tables as a sidecar. No schema changes required.

## Packages

| Package                              | Description                                  |
| ------------------------------------ | -------------------------------------------- |
| [`@livesql/core`](packages/core)     | Shared TypeScript types and wire protocol    |
| [`@livesql/server`](packages/server) | WAL CDC engine and WebSocket server          |
| [`@livesql/client`](packages/client) | Framework-agnostic browser client            |
| [`@livesql/react`](packages/react)   | React hooks — `useLiveQuery`, `useLiveTable` |
| [`@livesql/vue`](packages/vue)       | Vue composables — `useLiveQuery`             |
| [`@livesql/svelte`](packages/svelte) | Svelte stores — `liveQuery`                  |

## How It Works

```
┌──────────┐    ┌────────────┐    ┌──────────────┐    ┌──────────┐
│ Your App │───▶│ PostgreSQL │───▶│ LiveSQL      │───▶│ Browser  │
│ (writes) │    │ WAL stream │    │ Server (CDC) │    │ (React,  │
└──────────┘    └────────────┘    │ + WebSocket  │    │  Vue, …) │
                                  └──────────────┘    └──────────┘
```

1. Your app writes to PostgreSQL as normal
2. LiveSQL reads the WAL (Write-Ahead Log) via logical replication
3. Changes are pushed to all subscribed WebSocket clients in batches
4. The client SDK updates your UI automatically

## Quick Start

### Prerequisites

- Node.js 20+
- Docker (for PostgreSQL)
- pnpm (`npm install -g pnpm`)

### 1. Clone and install

```bash
git clone https://github.com/mahabubul470/LiveSQL.git
cd LiveSQL
pnpm install
```

### 2. Start PostgreSQL

```bash
docker compose -f docker-compose.test.yml up -d
```

### 3. Build packages

```bash
pnpm build
```

### 4. Run the React demo

```bash
pnpm --filter demo setup-db
pnpm --filter react-demo dev
```

Open [http://localhost:5173](http://localhost:5173) — insert orders and watch them appear in real time.

## Server Configuration

```typescript
import { createLiveSQLServer, PostgresProvider } from "@livesql/server";

const provider = new PostgresProvider({
  connectionString: "postgresql://user:pass@localhost:5432/mydb",
  tables: ["orders", "users"],
  lagWarningBytes: 512 * 1024 * 1024, // warn at 512MB WAL lag
});

await provider.connect();

const livesql = createLiveSQLServer(provider, {
  database: "postgresql://user:pass@localhost:5432/mydb",
  tables: ["orders", "users"],

  // JWT authentication
  jwtSecret: process.env.JWT_SECRET,

  // Table-level permissions
  permissions: async (userId, table) => {
    return table === "orders"; // only allow orders table
  },

  // Row-level permissions
  rowPermission: (userId, table, row) => {
    return row.user_id === userId;
  },

  // Filter columns allowed per table
  allowedFilterColumns: {
    orders: ["status", "user_id"],
  },

  // Backpressure callback
  onBackpressure: (userId) => {
    console.warn(`Client ${userId} is too slow, dropping events`);
  },
});

livesql.attach(httpServer);
```

## PostgreSQL Requirements

Your PostgreSQL server must have logical replication enabled:

```sql
-- postgresql.conf (or via Docker command flags)
wal_level = logical
max_replication_slots = 10
max_wal_senders = 10
max_slot_wal_keep_size = 1024   -- prevents WAL disk exhaustion
```

Watched tables must use `REPLICA IDENTITY FULL` for old row data in UPDATE/DELETE events:

```sql
ALTER TABLE orders REPLICA IDENTITY FULL;
```

## Testing

```bash
# Run all unit tests (118 tests across 11 test files)
pnpm test

# Run tests for a specific package
pnpm --filter @livesql/server test

# Run integration tests (requires Docker PostgreSQL)
docker compose -f docker-compose.test.yml up -d
pnpm --filter integration test

# Run k6 load test (requires k6 + Docker PostgreSQL)
node tests/load/bench-server.js &
k6 run tests/load/k6-websocket.js
```

## Project Structure

```
livesql/
├── packages/
│   ├── core/           # Shared types and wire protocol
│   ├── server/         # WAL CDC engine + WebSocket server
│   ├── client/         # Framework-agnostic client SDK
│   ├── react/          # React hooks (useLiveQuery, useLiveTable)
│   ├── vue/            # Vue composables (useLiveQuery)
│   └── svelte/         # Svelte stores (liveQuery)
├── apps/
│   ├── demo/           # Vanilla JS demo
│   ├── react-demo/     # React + Vite demo application
│   └── docs/           # Docusaurus documentation site
├── tests/
│   ├── integration/    # E2E sync correctness tests
│   └── load/           # k6 load test (1,000 clients)
└── docs/               # Architecture, specs, decision records
```

## Roadmap

- [x] **Phase 0** — LISTEN/NOTIFY PoC
- [x] **Phase 1** — WAL CDC engine, JWT auth, filter validation, reconnection backfill
- [x] **Phase 2** — React/Vue/Svelte SDKs, event batching, backpressure, docs site _(in progress — beta pending)_
- [ ] **Phase 3** — Chaos tests, observability hooks, production hardening, v1.0
- [ ] **Phase 4** — MySQL support, managed cloud service

See [docs/implementation-plan.md](docs/implementation-plan.md) for the full roadmap and [docs/progress.md](docs/progress.md) for task tracking.

## Documentation

- [5-Minute Quickstart](apps/docs/docs/intro.md)
- [How It Works](apps/docs/docs/concepts/how-it-works.md)
- [API Reference](apps/docs/docs/api/)
- [Architecture](docs/architecture.md)
- [Decision Records](docs/decisions.md)
- [Failure Modes](docs/failure-modes.md)
- [Migration from Supabase Realtime](apps/docs/docs/guides/migration-supabase.md)

## Contributing

1. Fork the repo and create a branch (`feat/my-feature`)
2. Run `pnpm install` at the root
3. Start PostgreSQL: `docker compose -f docker-compose.test.yml up -d`
4. Make your changes and add tests
5. Run `pnpm test` and `pnpm lint`
6. Open a pull request

See [CLAUDE.md](CLAUDE.md) for coding conventions and architectural guidelines.

## License

[Apache 2.0](LICENSE)
