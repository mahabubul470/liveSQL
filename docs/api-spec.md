# LiveSQL API Specification

## Package: @livesql/server

### `createLiveSQLServer(options): LiveSQLServer`

The primary server-side entry point. Creates a WebSocket server that streams database changes to connected clients.

```typescript
import { createLiveSQLServer } from "@livesql/server";

const livesql = createLiveSQLServer({
  // REQUIRED: PostgreSQL connection string
  database: "postgresql://user:pass@localhost:5432/mydb",

  // REQUIRED: Which tables to expose over WebSocket
  tables: ["orders", "products", "notifications"],

  // REQUIRED: Authentication function
  // Called on every WebSocket handshake
  // Return user object (truthy) to allow, null/undefined to reject
  authenticate: async (req: IncomingMessage) => {
    return verifyJWT(req.headers.authorization);
  },

  // OPTIONAL: Table-level permission
  // Called when a client subscribes to a table
  // Return true to allow, false to reject
  permissions: async (userId: string, table: string) => {
    if (table === "orders") return true; // all users see orders
    if (table === "products") return true;
    return false;
  },

  // OPTIONAL: Row-level permission
  // Called for EVERY change event before delivery
  // Return true to deliver, false to skip
  rowPermission: (userId: string, table: string, row: Record<string, unknown>) => {
    if (table === "orders") return row.user_id === userId;
    return true;
  },

  // OPTIONAL: Columns allowed in client-supplied filter expressions
  // If not set, no client-side filtering is permitted
  allowedFilterColumns: {
    orders: ["status", "user_id", "created_at"],
    products: ["category", "price"],
  },

  // OPTIONAL: WebSocket server port (if standalone, not attaching to HTTP server)
  port: 4000,
});
```

### `LiveSQLServer`

```typescript
interface LiveSQLServer {
  // Attach to an existing HTTP server (Express, Fastify, etc.)
  attach(server: http.Server): void;

  // Graceful shutdown — closes all connections and replication slot
  close(): Promise<void>;

  // Event emitter for observability
  on(event: "error", listener: (err: Error) => void): void;
  on(event: "client:connect", listener: (clientId: string) => void): void;
  on(event: "client:disconnect", listener: (clientId: string) => void): void;
  on(
    event: "client:backpressure",
    listener: (info: { clientId: string; buffered: number }) => void,
  ): void;
  on(
    event: "slot:lag-warning",
    listener: (info: { slotName: string; lagBytes: number }) => void,
  ): void;
  on(event: "slot:inactive", listener: (info: { slotName: string }) => void): void;
}
```

### Usage with Express

```typescript
import express from "express";
import { createLiveSQLServer } from "@livesql/server";

const app = express();
const livesql = createLiveSQLServer({
  /* options */
});

const httpServer = app.listen(3000);
livesql.attach(httpServer);
```

---

## Package: @livesql/client

### `LiveSQLClient`

Framework-agnostic client for connecting to a LiveSQL server.

```typescript
import { LiveSQLClient } from "@livesql/client";

const client = new LiveSQLClient(
  // WebSocket server URL
  "wss://api.example.com/livesql",
  // Token provider — called on every connect/reconnect
  () => localStorage.getItem("token") || "",
);

// Connect to server
client.connect();

// Subscribe to a table
const unsubscribe = client.subscribe<OrderRow>("orders", (event) => {
  console.log(event.type, event.row);
  // event.type: "insert" | "update" | "delete"
  // event.row: OrderRow
  // event.oldRow: OrderRow | undefined (on update)
});

// Unsubscribe
unsubscribe();

// Disconnect
client.disconnect();
```

### `LiveSQLClient` Full API

```typescript
class LiveSQLClient {
  constructor(url: string, getToken: () => string | Promise<string>);

  // Connect to the WebSocket server
  connect(): void;

  // Subscribe to changes on a table
  // Returns an unsubscribe function
  subscribe<T extends Record<string, unknown>>(
    table: string,
    callback: (event: ChangeEvent & { row: T }) => void,
  ): () => void;

  // Current connection state
  readonly connected: boolean;

  // Current offset (for debugging)
  readonly offset: bigint;

  // Disconnect and clean up
  disconnect(): void;
}
```

---

## Package: @livesql/react

### `LiveSQLProvider`

Context provider that creates and manages a shared `LiveSQLClient` instance.

```typescript
import { LiveSQLProvider } from "@livesql/react";

function App() {
  return (
    <LiveSQLProvider
      url="wss://api.example.com/livesql"
      getToken={() => localStorage.getItem("token")!}
    >
      <Dashboard />
    </LiveSQLProvider>
  );
}
```

### `useLiveQuery<T>(table, options?)`

Subscribe to a table and get a reactive array of rows. Automatically handles insert, update, and delete events.

```typescript
import { useLiveQuery } from "@livesql/react";

function Dashboard() {
  const { data, loading, error } = useLiveQuery<Order>("orders", {
    // OPTIONAL: Server-side filter expression
    filter: "status = pending",
    // OPTIONAL: Initial data (avoids loading state if you prefetch)
    initialData: [],
  });

  if (loading) return <Spinner />;
  if (error) return <Error message={error.message} />;

  return <OrderList orders={data} />;
}
```

#### Return Type

```typescript
interface UseLiveQueryResult<T> {
  data: T[]; // Current rows (reactive)
  loading: boolean; // True until first sync message received
  error: Error | null; // Connection or permission error
}
```

#### Behavior

- **insert**: Appends row to `data` array
- **update**: Replaces matching row (by `id` field) in `data` array
- **delete**: Removes matching row (by `id` field) from `data` array
- **reconnect**: Automatically re-subscribes from last offset — no data loss

### `useLiveTable<T>(table, options?)` (Phase 2)

Like `useLiveQuery` but returns a `Map<string, T>` keyed by primary key for O(1) lookups.

### `useLiveSQLClient()`

Access the raw `LiveSQLClient` instance from context.

```typescript
const client = useLiveSQLClient();
// For advanced use cases — prefer useLiveQuery for most cases
```

---

## Wire Protocol Messages

### Client → Server

#### Subscribe

```json
{
  "type": "subscribe",
  "table": "orders",
  "filter": "status = pending",
  "offset": 42
}
```

#### Unsubscribe

```json
{
  "type": "unsubscribe",
  "table": "orders"
}
```

### Server → Client

#### Sync (batched events)

```json
{
  "type": "sync",
  "events": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "lsn": "0/16B3748",
      "offset": 42,
      "table": "orders",
      "schema": "public",
      "type": "insert",
      "row": { "id": "abc-123", "status": "pending", "user_id": "user-1" },
      "timestamp": "2026-02-25T10:30:00.000Z"
    }
  ]
}
```

#### Error

```json
{
  "type": "error",
  "code": "TABLE_NOT_FOUND",
  "message": "Table 'secrets' not exposed"
}
```

### Error Codes

| Code              | Meaning                     | When                                         |
| ----------------- | --------------------------- | -------------------------------------------- |
| `UNAUTHORIZED`    | JWT invalid or missing      | WebSocket handshake                          |
| `TABLE_NOT_FOUND` | Table not in allowlist      | Subscribe to unknown table                   |
| `FORBIDDEN`       | Table permission denied     | Subscribe permission check fails             |
| `INVALID_FILTER`  | Filter expression malformed | Filter doesn't match `column operator value` |
| `RATE_LIMITED`    | Too many subscribe requests | Exceeds 100 subscribes/minute                |
| `INTERNAL_ERROR`  | Server-side error           | CDC failure, unexpected exception            |

---

## Package: @livesql/core

### Exported Types

All wire protocol types are exported from `@livesql/core` for use by both server and client:

```typescript
// Types
export type { ChangeType, ChangeEvent };
export type { SubscribeMessage, UnsubscribeMessage, ClientMessage };
export type { SyncMessage, ErrorMessage, ServerMessage };

// Interface
export type { ChangeProvider };
```

This package has **zero runtime dependencies**. It is types and interfaces only.
