---
sidebar_position: 1
title: "@livesql/server"
---

The server-side CDC engine and WebSocket server.

```bash
npm install @livesql/server
```

**Peer / runtime dependencies**: `pg`, `ws`, `jsonwebtoken` (all included).

---

## `createLiveSQLServer(options)`

Creates a WebSocket server that streams database changes to connected clients.

```typescript
import { createLiveSQLServer } from "@livesql/server";

const livesql = createLiveSQLServer({
  database: "postgresql://user:pass@localhost:5432/mydb",
  tables: ["orders", "products"],
  authenticate: async (req) => {
    const token = new URL(req.url!, "http://x").searchParams.get("token");
    return token ? verifyJWT(token) : null;
  },
});
```

### Options

#### `database` · `string` · **required**

PostgreSQL connection string.

```typescript
database: "postgresql://user:password@host:5432/dbname";
```

#### `tables` · `string[]` · **required**

The tables to expose over WebSocket. Clients can only subscribe to tables in this list. Any subscribe request for a table not listed here returns a `TABLE_NOT_FOUND` error.

```typescript
tables: ["orders", "products", "notifications"];
```

#### `authenticate` · `(req: IncomingMessage) => Promise<object | null>` · **required**

Called on every WebSocket handshake. Return a truthy object (the user) to allow the connection, or `null`/`undefined` to reject with `UNAUTHORIZED`.

The returned object is passed as `userId` to `permissions` and `rowPermission`.

```typescript
authenticate: async (req) => {
  // Token from query string: ws://host?token=<jwt>
  const token = new URL(req.url!, "http://x").searchParams.get("token");
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET!) as { userId: string };
  } catch {
    return null;
  }
},
```

#### `permissions` · `(userId: string, table: string) => boolean | Promise<boolean>` · optional

Called when a client subscribes to a table. Return `true` to allow, `false` to reject with `FORBIDDEN`.

If not set, all authenticated users can subscribe to any table in the `tables` list.

```typescript
permissions: async (userId, table) => {
  if (table === "admin_logs") return isAdmin(userId);
  return true;
},
```

#### `rowPermission` · `(userId: string, table: string, row: Record<string, unknown>) => boolean` · optional

Called for every change event before delivery. Return `false` to skip the event for this client.

This runs in-process (pure JavaScript) — no database query per event.

```typescript
rowPermission: (userId, table, row) => {
  if (table === "orders") return row.user_id === userId;
  return true;
},
```

#### `allowedFilterColumns` · `Record<string, string[]>` · optional

Columns that clients are allowed to use in filter expressions. If a client sends a filter referencing a column not in this list, it receives `INVALID_FILTER`.

```typescript
allowedFilterColumns: {
  orders: ["status", "user_id", "created_at"],
  products: ["category", "price"],
},
```

#### `port` · `number` · optional

If provided, starts a standalone WebSocket server on this port. Omit if you're using `attach()` to bind to an existing HTTP server.

#### `onBackpressure` · `(userId: string) => void` · optional

Called when a client's WebSocket send buffer exceeds 1 MB. The event batch is dropped for that client; they will resume from their last offset on reconnect.

```typescript
onBackpressure: (userId) => {
  console.warn(`Backpressure: dropping events for ${userId}`);
},
```

---

## `LiveSQLServer`

The object returned by `createLiveSQLServer()`.

### `attach(server: http.Server): void`

Bind the WebSocket server to an existing HTTP server (Express, Fastify, Hono, etc.). Use this instead of `port` when you want to serve WebSocket and HTTP from the same port.

```typescript
import express from "express";
import http from "http";

const app = express();
const httpServer = http.createServer(app);

const livesql = createLiveSQLServer({
  /* opts */
});
livesql.attach(httpServer);

httpServer.listen(3000);
```

### `close(): Promise<void>`

Gracefully shuts down. Closes all WebSocket connections and releases the PostgreSQL replication slot.

```typescript
process.on("SIGTERM", async () => {
  await livesql.close();
  process.exit(0);
});
```

### Events

`LiveSQLServer` extends `EventEmitter`. Listen for these events for observability and alerting.

```typescript
livesql.on("error", (err: Error) => {
  console.error("LiveSQL error:", err);
});

livesql.on("client:connect", (clientId: string) => {
  console.log("Client connected:", clientId);
});

livesql.on("client:disconnect", (clientId: string) => {
  console.log("Client disconnected:", clientId);
});

livesql.on("client:backpressure", (info: { clientId: string; buffered: number }) => {
  console.warn(`Backpressure: ${info.clientId} has ${info.buffered} bytes buffered`);
});

livesql.on("slot:lag-warning", (info: { slotName: string; lagBytes: number }) => {
  console.warn(`WAL lag: ${info.lagBytes} bytes on slot ${info.slotName}`);
});

livesql.on("slot:inactive", (info: { slotName: string }) => {
  console.error(`Replication slot inactive: ${info.slotName}`);
});
```

---

## WAL slot health

LiveSQL automatically monitors the PostgreSQL replication slot every 30 seconds. If the consumer falls behind (e.g. server restart), WAL files accumulate on disk. Configure `max_slot_wal_keep_size` in PostgreSQL to set a hard cap:

```
max_slot_wal_keep_size = 1024   # MB — slot is invalidated beyond this
```

If the slot is invalidated, LiveSQL emits `slot:inactive` and reconnects with a fresh slot. Events during the gap window are permanently lost — your application should handle the `slot:inactive` event and warn operators.

---

## Express integration example

```typescript
import express from "express";
import http from "http";
import { createLiveSQLServer } from "@livesql/server";
import jwt from "jsonwebtoken";

const app = express();
app.use(express.json());

// Your existing REST routes
app.post("/orders", async (req, res) => {
  // ... insert into database
});

const httpServer = http.createServer(app);

const livesql = createLiveSQLServer({
  database: process.env.DATABASE_URL!,
  tables: ["orders", "notifications"],

  authenticate: async (req) => {
    const token = new URL(req.url!, "http://x").searchParams.get("token");
    if (!token) return null;
    try {
      return jwt.verify(token, process.env.JWT_SECRET!) as { userId: string };
    } catch {
      return null;
    }
  },

  permissions: async (userId, table) => {
    // Check table-level access in your DB/cache
    return checkTablePermission(userId, table);
  },

  rowPermission: (userId, table, row) => {
    if (table === "orders") return row.user_id === userId;
    return true;
  },

  allowedFilterColumns: {
    orders: ["status", "user_id"],
  },

  onBackpressure: (userId) => {
    console.warn(`Slow client: ${userId}`);
  },
});

livesql.on("slot:lag-warning", ({ lagBytes }) => {
  // Send alert to PagerDuty/Slack
  alertOps(`WAL lag: ${lagBytes} bytes`);
});

livesql.attach(httpServer);
httpServer.listen(3000);
```
