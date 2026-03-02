# @livesql/server

Server-side CDC engine and WebSocket server for [LiveSQL](https://github.com/mahabubul470/liveSQL).

Attaches to your existing PostgreSQL database via WAL logical replication and streams row-level changes to connected clients. No schema changes required.

## Install

```bash
npm install @livesql/server @livesql/core
```

## Requirements

- Node.js 20+
- PostgreSQL 14+ with `wal_level = logical`
- Database user with `REPLICATION` privilege

## Quick Start

```typescript
import http from "node:http";
import { createLiveSQLServer, PostgresProvider } from "@livesql/server";

const provider = new PostgresProvider({
  connectionString: process.env.DATABASE_URL,
  tables: ["orders", "products"],
});

await provider.connect();

const httpServer = http.createServer(/* your express/fastify app */);

const livesql = createLiveSQLServer(provider, {
  database: process.env.DATABASE_URL,
  tables: ["orders", "products"],
});

livesql.attach(httpServer);
httpServer.listen(3000);
```

Clients connect via WebSocket and receive change events in real time:

```json
{ "type": "sync", "events": [{ "type": "insert", "table": "orders", "row": { ... } }] }
```

## PostgresProvider

WAL-based CDC using PostgreSQL logical replication (pgoutput). Provides guaranteed delivery, historical replay, and true sub-100ms latency.

### Options

| Option              | Type       | Default                 | Description                           |
| ------------------- | ---------- | ----------------------- | ------------------------------------- |
| `connectionString`  | `string`   | required                | PostgreSQL connection string          |
| `tables`            | `string[]` | required                | Tables to watch                       |
| `slotName`          | `string`   | `"livesql_slot"`        | Replication slot name                 |
| `publicationName`   | `string`   | `"livesql_publication"` | Publication name                      |
| `maxBufferedEvents` | `number`   | `10000`                 | Ring buffer size for `replayFrom()`   |
| `lagWarningBytes`   | `number`   | `536870912`             | WAL lag threshold for warning (512MB) |

### Observability hooks

```typescript
provider.onSlotLagWarning = ({ slotName, lagBytes }) => {
  console.warn(`WAL lag: ${lagBytes} bytes on slot ${slotName}`);
};

provider.onSlotInactive = ({ slotName }) => {
  console.error(`Replication slot ${slotName} is inactive`);
};

provider.onError = (err) => {
  console.error("Provider error:", err);
};
```

### PostgreSQL setup

```sql
-- Required: your user needs REPLICATION privilege
ALTER USER your_user REPLICATION;

-- Recommended: cap WAL disk usage (PostgreSQL 13+)
-- In postgresql.conf:
-- max_slot_wal_keep_size = 1024   -- 1 GB
```

`PostgresProvider` automatically sets `REPLICA IDENTITY FULL` on watched tables and creates the publication and replication slot on `connect()`.

## createLiveSQLServer

### Options

| Option                 | Type                       | Description                                           |
| ---------------------- | -------------------------- | ----------------------------------------------------- |
| `database`             | `string`                   | PostgreSQL connection string                          |
| `tables`               | `string[]`                 | Tables clients are allowed to subscribe to            |
| `port`                 | `number`                   | Standalone WebSocket port (alternative to `attach()`) |
| `jwtSecret`            | `string`                   | Verify `?token=<jwt>` on WebSocket connect            |
| `authenticate`         | `function`                 | Custom auth — return `{ id: string }` or `null`       |
| `permissions`          | `function`                 | Table-level permission check per user                 |
| `rowPermission`        | `function`                 | Row-level permission check per change event           |
| `allowedFilterColumns` | `Record<string, string[]>` | Columns clients can filter on, per table              |

### JWT authentication

```typescript
const livesql = createLiveSQLServer(provider, {
  database: DATABASE_URL,
  tables: ["orders"],
  jwtSecret: process.env.JWT_SECRET,
});
```

Clients connect with `ws://host:3000?token=<jwt>`. The JWT payload's `sub` (or `id`) field becomes the `userId` passed to permission callbacks.

### Table and row permissions

```typescript
const livesql = createLiveSQLServer(provider, {
  database: DATABASE_URL,
  tables: ["orders"],
  permissions: async (userId, table) => {
    return await db.userCanAccess(userId, table);
  },
  rowPermission: (userId, table, row) => {
    return row["owner_id"] === userId;
  },
});
```

### Filter validation

Clients can filter events server-side without executing SQL. Specify which columns are filterable per table:

```typescript
const livesql = createLiveSQLServer(provider, {
  database: DATABASE_URL,
  tables: ["orders"],
  allowedFilterColumns: {
    orders: ["status", "customer_id"],
  },
});
```

Client sends: `{ type: "subscribe", table: "orders", filter: "status = shipped" }`

Supported operators: `=`, `!=`, `<`, `>`, `<=`, `>=`

### Attach vs standalone

```typescript
// Attach to existing HTTP server (recommended — share port with your API)
livesql.attach(httpServer);

// Or run standalone on a dedicated port
const livesql = createLiveSQLServer(provider, { ..., port: 3001 });
```

## WAL Slot Health

```typescript
import { checkSlotHealth } from "@livesql/server";

const health = await checkSlotHealth(adminClient, "livesql_slot");
// { slotName: "livesql_slot", active: true, lagBytes: 1024 }
```

## Reconnection Backfill

When a client reconnects after a disconnect, it sends its last known offset. The server replays all buffered events since that offset:

```json
{ "type": "subscribe", "table": "orders", "offset": "42" }
```

The in-memory ring buffer holds up to `maxBufferedEvents` events (default 10,000). Events older than the buffer are not replayed.

## License

Apache 2.0
