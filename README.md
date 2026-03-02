# LiveSQL

**Stream SQL database changes to web clients in real time.**

LiveSQL is an open-source TypeScript library that connects to your existing PostgreSQL database and pushes row-level changes to the browser via WebSockets — using WAL logical replication for guaranteed delivery and sub-100ms latency. No database migration, no vendor lock-in.

```typescript
// Server — 5 lines to start streaming changes
import { createLiveSQLServer, PostgresProvider } from "@livesql/server";

const provider = new PostgresProvider({ connectionString: DATABASE_URL, tables: ["orders"] });
await provider.connect();

const livesql = createLiveSQLServer(provider, { database: DATABASE_URL, tables: ["orders"] });
livesql.attach(httpServer);
```

```typescript
// Client — subscribe and get live updates
import { LiveSQLClient } from "@livesql/client";

const client = new LiveSQLClient("ws://localhost:3000", () => authToken);
client.connect();
client.subscribe("orders", (event) => console.log(event.type, event.row));
```

## Install

```bash
npm install @livesql/server @livesql/client @livesql/core
```

## Quick Start (5 minutes)

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

### 4. Set up the demo database

```bash
pnpm --filter demo setup-db
```

### 5. Start the demo

```bash
pnpm --filter demo dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 6. Insert a row and watch it appear

```bash
psql postgresql://livesql:test@localhost:5434/livesql_test -c \
  "INSERT INTO orders (customer_name, status, total) VALUES ('Live User', 'pending', 42.00);"
```

The new order appears in the browser instantly.

## How It Works

1. Your app writes to PostgreSQL as normal
2. LiveSQL reads the WAL (Write-Ahead Log) via logical replication
3. Changes are pushed to all subscribed WebSocket clients
4. The client receives the event and updates the UI

## Features

- **WAL-based CDC** — guaranteed delivery via PostgreSQL logical replication (pgoutput). No triggers, no polling.
- **Reconnection backfill** — clients resume from their last offset; missed events are replayed from an in-memory buffer.
- **Filter validation** — clients filter events server-side with `"status = shipped"` syntax. Never executes SQL.
- **JWT authentication** — built-in `?token=<jwt>` verification on WebSocket connect.
- **Table and row permissions** — callbacks to enforce access control per user per change.
- **WAL slot health monitoring** — configurable lag warnings and inactive slot detection.
- **Zero migration** — attaches to existing tables as a sidecar.

## Packages

| Package                              | Description                               |
| ------------------------------------ | ----------------------------------------- |
| [`@livesql/core`](packages/core)     | Shared TypeScript types and wire protocol |
| [`@livesql/server`](packages/server) | CDC engine and WebSocket server           |
| [`@livesql/client`](packages/client) | Framework-agnostic browser client         |

## Project Structure

```
livesql/
├── packages/
│   ├── core/       # Shared types and wire protocol
│   ├── server/     # WAL CDC engine + WebSocket server
│   └── client/     # Framework-agnostic client SDK
├── apps/
│   └── demo/       # Live order dashboard demo
└── docs/           # Architecture and implementation docs
```

## Status

**Phase 1 complete.** WAL logical replication is live. 62 tests passing.

- [x] Phase 0 — LISTEN/NOTIFY PoC
- [x] Phase 1 — WAL CDC engine, JWT auth, filter validation, reconnection backfill, alpha publish
- [ ] Phase 2 — React hooks (`useLiveQuery`, `useLiveTable`), Vue composables, Svelte stores
- [ ] Phase 3 — Production hardening, chaos tests, v1.0

See [docs/implementation-plan.md](docs/implementation-plan.md) for the full roadmap.

## License

Apache 2.0
