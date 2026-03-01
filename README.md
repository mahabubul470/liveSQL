# LiveSQL

**Stream SQL database changes to web clients in real time.**

LiveSQL is an open-source TypeScript library that connects to your existing PostgreSQL database and pushes row-level changes to the browser via WebSockets. No database migration, no vendor lock-in — just add real-time sync to your existing tables.

```typescript
// Server: 4 lines to start streaming changes
import { createLiveSQLServer, ListenNotifyProvider } from "@livesql/server";

const provider = new ListenNotifyProvider({ connectionString: DATABASE_URL, tables: ["orders"] });
await provider.connect();

const livesql = createLiveSQLServer(provider, { database: DATABASE_URL, tables: ["orders"] });
livesql.attach(httpServer);
```

```javascript
// Client: subscribe and get live updates
const ws = new WebSocket("ws://localhost:3000");
ws.onopen = () => ws.send(JSON.stringify({ type: "subscribe", table: "orders" }));
ws.onmessage = (e) => console.log(JSON.parse(e.data)); // { type: "sync", events: [...] }
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

In another terminal:

```bash
docker exec -it livesql-postgres-1 psql -U livesql -d livesql_test -c \
  "INSERT INTO orders (customer_name, status, total) VALUES ('Live User', 'pending', 42.00);"

# Or directly via psql on port 5433:
psql postgresql://livesql:test@localhost:5434/livesql_test -c \
  "INSERT INTO orders (customer_name, status, total) VALUES ('Live User', 'pending', 42.00);"
```

The new order should appear in your browser instantly.

## Project Structure

```
livesql/
├── packages/
│   ├── core/       # Shared types and wire protocol
│   ├── server/     # CDC engine + WebSocket server
│   └── client/     # Framework-agnostic client SDK
├── apps/
│   └── demo/       # Live order dashboard demo
└── docs/           # Architecture and implementation docs
```

## How It Works

1. Your application writes to PostgreSQL as normal
2. LiveSQL detects the change via Change Data Capture (CDC)
3. The change is pushed to all subscribed WebSocket clients
4. Client-side code receives the event and updates the UI

## Status

**Phase 0 — Proof of Concept.** The current implementation uses PostgreSQL LISTEN/NOTIFY for simplicity. Phase 1 will replace this with WAL logical replication for guaranteed delivery and reconnection support.

See [docs/implementation-plan.md](docs/implementation-plan.md) for the full roadmap.

## License

Apache 2.0
