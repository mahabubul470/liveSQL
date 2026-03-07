# LiveSQL

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@livesql/server?label=%40livesql%2Fserver)](https://www.npmjs.com/package/@livesql/server)
[![Tests](https://img.shields.io/badge/tests-163%20passing-brightgreen.svg)](#testing)

Real-time sync for PostgreSQL. When a row changes in your database, every connected client sees it instantly — no polling, no manual invalidation, no infrastructure changes.

## Why

Most apps need some form of live data — dashboards, notifications, collaborative editing, order tracking. The usual options all have tradeoffs:

| Approach                              | Problem                                                                                                                |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Polling** (`setInterval` + `fetch`) | 1-5s latency, wasted bandwidth, scales poorly — N clients = N queries/interval                                         |
| **PostgreSQL LISTEN/NOTIFY**          | At-most-once delivery, 8KB payload limit, no replay on reconnect, missed events are gone forever                       |
| **Supabase Realtime**                 | Runs Row-Level Security per subscriber per change — N subscribers = N database reads. Locks you into Supabase platform |
| **Firebase Realtime DB**              | Forces NoSQL document model. Can't use SQL, can't join tables, have to remodel your entire data layer                  |
| **Custom WebSocket server**           | Works, but you're building reconnection, backfill, backpressure, auth, batching, failover handling from scratch        |

LiveSQL gives you real-time table sync as a library. Add it to your existing Node.js server, point it at your existing PostgreSQL, and your frontend gets live-updating data through a one-line hook.

### What's different

- **vs Supabase Realtime** — LiveSQL evaluates filters and permissions in-process, not as database queries. 1 subscriber or 10,000 — same database load. Self-hosted, no platform dependency.
- **vs Firebase** — keep your PostgreSQL schema, your SQL queries, your existing backend. LiveSQL is additive — it doesn't replace anything, it just makes your tables real-time.
- **vs LISTEN/NOTIFY** — LiveSQL uses WAL logical replication. Events are durable, ordered, and replayable. Clients that disconnect and reconnect get every event they missed.
- **vs DIY WebSocket** — reconnection with offset-based backfill, exponential backoff with jitter, event batching, backpressure detection, WAL slot monitoring, and failover recovery — already built and tested (163 tests including 23 chaos tests).

## Usage

**Server** — 5 lines to start streaming:

```typescript
import { createLiveSQLServer, PostgresProvider } from "@livesql/server";

const provider = new PostgresProvider({ connectionString: DATABASE_URL, tables: ["orders"] });
await provider.connect();

const livesql = createLiveSQLServer(provider, { database: DATABASE_URL, tables: ["orders"] });
livesql.attach(httpServer); // shares your existing port
```

**React** — one hook:

```tsx
const { data: orders, loading } = useLiveQuery<Order>("orders");
```

**Vue:**

```ts
const { data: orders, loading } = useLiveQuery<Order>("orders");
```

**Svelte:**

```ts
const orders = liveQuery<Order>(client, "orders");
```

**Vanilla JS:**

```typescript
const client = new LiveSQLClient("ws://localhost:3000", () => authToken);
client.connect();
client.subscribe("orders", (event) => console.log(event.type, event.row));
```

Insert a row in psql, and it shows up in the browser. Update it, and the UI updates. Delete it, and it disappears. No refetching, no cache invalidation.

### Works with PostgREST

Pair [PostgREST](https://postgrest.org) for CRUD with LiveSQL for streaming — full real-time backend, zero server code:

```tsx
// Write through PostgREST
await fetch("http://localhost:3000/orders", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ status: "pending", total: 42.0 }),
});

// LiveSQL pushes the change to all clients automatically
const { data: orders } = useLiveQuery<Order>("orders");
```

Both services share the same JWT secret and PostgreSQL instance. See the full [PostgREST + LiveSQL guide](apps/docs/docs/guides/postgrest.md) with Docker Compose setup.

## Install

```bash
npm install @livesql/server @livesql/core          # server
npm install @livesql/client @livesql/core           # vanilla JS client
npm install @livesql/react                           # React
npm install @livesql/vue                             # Vue
npm install @livesql/svelte                          # Svelte
```

## What you get

- **No missed events** — uses PostgreSQL WAL replication, not triggers or LISTEN/NOTIFY
- **Automatic reconnection** — clients resume from their last offset; missed events are replayed
- **Works with your existing database** — no migrations, no schema changes, no new services to deploy
- **Works with your existing auth** — JWT verification and permission callbacks, not a proprietary auth system
- **Scales without N+1 reads** — filters and permissions are evaluated in-process, not as database queries
- **Production-ready** — backpressure handling, event batching, WAL slot monitoring, failover recovery, exponential backoff with jitter

## Performance

1,000 concurrent clients, 50 inserts/sec ([full results](tests/load/RESULTS.md)):

| Metric              | Value              |
| ------------------- | ------------------ |
| p50 latency         | 41ms               |
| p95 latency         | 96ms               |
| Throughput          | ~37,872 events/sec |
| Connection failures | 0%                 |

## How it works

LiveSQL connects to PostgreSQL as a logical replication subscriber. It reads the WAL stream, parses row changes, and fans them out to WebSocket clients. Clients track their offset — on reconnect, the server replays missed events from a ring buffer.

```
Your App ──writes──> PostgreSQL ──WAL──> LiveSQL Server ──WebSocket──> Clients
```

No triggers, no polling, no additional database load beyond the replication connection.

For technical details, see [Architecture](docs/architecture.md) and [Failure Modes](docs/failure-modes.md).

## PostgreSQL requirements

```sql
-- postgresql.conf
wal_level = logical
max_replication_slots = 10
max_wal_senders = 10
max_slot_wal_keep_size = 1024   -- cap WAL disk usage (MB)
```

LiveSQL automatically creates the publication, replication slot, and sets `REPLICA IDENTITY FULL` on watched tables.

## Server configuration

```typescript
const livesql = createLiveSQLServer(provider, {
  database: DATABASE_URL,
  tables: ["orders", "users"],

  // Auth — use your existing JWT secret
  jwtSecret: process.env.JWT_SECRET,

  // Who can subscribe to which tables
  permissions: async (userId, table) => {
    return await db.userCanAccess(userId, table);
  },

  // Which rows each user can see
  rowPermission: (userId, table, row) => {
    return row.owner_id === userId;
  },

  // Which columns clients can filter on
  allowedFilterColumns: {
    orders: ["status", "customer_id"],
  },
});
```

## Packages

| Package                              | What it does                                          |
| ------------------------------------ | ----------------------------------------------------- |
| [`@livesql/core`](packages/core)     | Shared types and wire protocol                        |
| [`@livesql/server`](packages/server) | CDC engine + WebSocket server                         |
| [`@livesql/client`](packages/client) | Framework-agnostic browser client                     |
| [`@livesql/react`](packages/react)   | `useLiveQuery`, `useLiveTable`, `LiveSQLProvider`     |
| [`@livesql/vue`](packages/vue)       | `useLiveQuery`, `useLiveTable`, `createLiveSQLPlugin` |
| [`@livesql/svelte`](packages/svelte) | `liveQuery`, `liveTable` stores                       |

## Testing

```bash
pnpm test                                            # 163 tests, 15 files
pnpm --filter integration test                       # E2E (needs Docker PG)
npx vitest run --config tests/chaos/vitest.config.ts # 23 chaos tests
```

## Quick start (from source)

```bash
git clone https://github.com/mahabubul470/LiveSQL.git && cd LiveSQL
pnpm install
docker compose -f docker-compose.test.yml up -d
pnpm build
pnpm --filter demo setup-db
pnpm --filter react-demo dev
```

Open http://localhost:5173 — insert rows in psql, watch them appear.

## Docs

- [5-Minute Quickstart](apps/docs/docs/intro.md)
- [How It Works](apps/docs/docs/concepts/how-it-works.md)
- [API Reference](apps/docs/docs/api/)
- [Express / Fastify Integration](apps/docs/docs/guides/integration-express-fastify.md)
- [Production Deployment](apps/docs/docs/guides/deployment.md)
- [PostgREST + LiveSQL](apps/docs/docs/guides/postgrest.md)
- [Migration from Supabase](apps/docs/docs/guides/migration-supabase.md)
- [Migration from Firebase](apps/docs/docs/guides/migration-firebase.md)

## Roadmap

- [x] Phase 0 — LISTEN/NOTIFY PoC
- [x] Phase 1 — WAL CDC, JWT auth, filters, reconnection backfill
- [x] Phase 2 — React/Vue/Svelte SDKs, batching, backpressure, docs
- [x] Phase 3 — Chaos tests, observability, failover recovery
- [ ] v1.0.0-beta.1 — current
- [ ] Phase 4 — MySQL support (demand-gated)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache 2.0](LICENSE)
