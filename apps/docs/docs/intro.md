---
slug: /
sidebar_label: Quickstart
sidebar_position: 1
title: LiveSQL — 5-Minute Quickstart
---

Stream SQL database changes to web clients in real time — no migrations, no vendor lock-in.

LiveSQL reads your PostgreSQL WAL (Write-Ahead Log) and pushes row-level INSERT, UPDATE, and DELETE events to browser clients over WebSockets with guaranteed delivery and sub-100ms latency.

## Prerequisites

- Node.js 20+
- PostgreSQL 13+ with `wal_level = logical`
- pnpm, npm, or yarn

## Install

```bash
npm install @livesql/server @livesql/client
```

For React:

```bash
npm install @livesql/react
```

## 1. Prepare PostgreSQL

You need `wal_level = logical`. With Docker:

```yaml title="docker-compose.yml"
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: myapp
      POSTGRES_PASSWORD: secret
      POSTGRES_DB: mydb
    command: >
      postgres
        -c wal_level=logical
        -c max_replication_slots=10
        -c max_slot_wal_keep_size=1024
    ports:
      - "5432:5432"
```

```bash
docker compose up -d
```

Or on an existing PostgreSQL instance, add to `postgresql.conf`:

```
wal_level = logical
max_replication_slots = 10
max_slot_wal_keep_size = 1024
```

Then restart PostgreSQL.

## 2. Set up your table

Run `REPLICA IDENTITY FULL` on every table you want to sync. This tells PostgreSQL to include the full previous row in UPDATE events.

```sql
CREATE TABLE orders (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status  TEXT NOT NULL DEFAULT 'pending',
  total   NUMERIC(10, 2),
  user_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE orders REPLICA IDENTITY FULL;
```

## 3. Start the server

```typescript title="server.ts"
import http from "http";
import express from "express";
import { createLiveSQLServer } from "@livesql/server";
import jwt from "jsonwebtoken";

const app = express();
const httpServer = http.createServer(app);

const livesql = createLiveSQLServer({
  database: "postgresql://myapp:secret@localhost:5432/mydb",
  tables: ["orders"],

  // Called on every WebSocket handshake — return user or null
  authenticate: async (req) => {
    const token = new URL(req.url!, "http://x").searchParams.get("token");
    if (!token) return null;
    return jwt.verify(token, process.env.JWT_SECRET!) as { userId: string };
  },

  // Optional: row-level access control
  rowPermission: (_userId, _table, _row) => true,
});

livesql.attach(httpServer);

httpServer.listen(3000, () => {
  console.log("LiveSQL running on :3000");
});
```

## 4. Subscribe in the browser

### Vanilla JS / TypeScript

```typescript title="client.ts"
import { LiveSQLClient } from "@livesql/client";

const client = new LiveSQLClient("ws://localhost:3000", () => localStorage.getItem("token") ?? "");

client.connect();

const unsubscribe = client.subscribe<{
  id: string;
  status: string;
  total: number;
}>("orders", (event) => {
  console.log(event.type, event.row);
  // "insert" { id: "abc-123", status: "pending", total: 42 }
  // "update" { id: "abc-123", status: "shipped", total: 42 }
  // "delete" { id: "abc-123", ... }
});

// Later:
unsubscribe();
```

### React

```tsx title="App.tsx"
import { LiveSQLProvider, useLiveQuery } from "@livesql/react";

function App() {
  return (
    <LiveSQLProvider url="ws://localhost:3000" getToken={() => localStorage.getItem("token")!}>
      <OrderList />
    </LiveSQLProvider>
  );
}

interface Order {
  id: string;
  status: string;
  total: number;
}

function OrderList() {
  const { data, loading, error } = useLiveQuery<Order>("orders");

  if (loading) return <p>Connecting…</p>;
  if (error) return <p>Error: {error.message}</p>;

  return (
    <ul>
      {data.map((order) => (
        <li key={order.id}>
          {order.id} — {order.status} — ${order.total}
        </li>
      ))}
    </ul>
  );
}
```

## 5. See it in action

Insert a row and watch it appear in real time:

```bash
psql postgresql://myapp:secret@localhost:5432/mydb -c \
  "INSERT INTO orders (status, total, user_id) VALUES ('pending', 42.00, 'user-1');"
```

The event arrives in the browser in under 100ms.

## Next Steps

- [How sync works](/concepts/how-it-works) — WAL replication, wire protocol, reconnection
- [Server API reference](/api/server) — full configuration, permissions, and events
- [React hooks](/api/react) — `useLiveQuery`, `useLiveTable`
- [Vue composables](/api/vue) — `useLiveQuery`, `createLiveSQLPlugin`
- [Svelte stores](/api/svelte) — `liveQuery`
