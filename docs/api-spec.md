# LiveSQL API Specification

## Package: @livesql/server

### `createLiveSQLServer(provider, options): LiveSQLServer`

The primary server-side entry point. Creates a WebSocket server that streams database changes to connected clients.

```typescript
import { createLiveSQLServer, PostgresProvider } from "@livesql/server";

const provider = new PostgresProvider({
  connectionString: "postgresql://user:pass@localhost:5432/mydb",
  tables: ["orders", "products"],
  // OPTIONAL: Custom replication slot name (default: "livesql_slot")
  slotName: "my_app_slot",
  // OPTIONAL: Auto-recover when slot is lost after failover (default: true)
  reconnectOnSlotLoss: true,
});
await provider.connect();

// Failover recovery hook (on provider)
provider.onSlotLost = ({ slotName, recovered }) => {
  console.warn(`Slot ${slotName} lost — ${recovered ? "recovered" : "failed"}`);
};

const livesql = createLiveSQLServer(provider, {
  // REQUIRED: PostgreSQL connection string
  database: "postgresql://user:pass@localhost:5432/mydb",

  // REQUIRED: Which tables to expose over WebSocket
  tables: ["orders", "products"],

  // OPTIONAL: JWT secret for built-in verification (from ?token= or Authorization header)
  jwtSecret: process.env.JWT_SECRET,

  // OPTIONAL: Custom authentication function (mutually exclusive with jwtSecret)
  // Return user object to allow, null to reject
  authenticate: async (req: IncomingMessage) => {
    return verifyJWT(req.headers.authorization);
  },

  // OPTIONAL: Table-level permission
  permissions: async (userId: string, table: string) => {
    return true;
  },

  // OPTIONAL: Row-level permission
  // The row object contains column values as strings from pgoutput
  rowPermission: (userId: string, table: string, row: Record<string, unknown>) => {
    if (table === "orders") return row.user_id === userId;
    return true;
  },

  // OPTIONAL: Columns allowed in client-supplied filter expressions
  allowedFilterColumns: {
    orders: ["status", "user_id"],
  },

  // OPTIONAL: Observability hooks
  onBackpressure: (userId: string) => void 0,
  onEvent: (userId: string, table: string, event: ChangeEvent) => void 0,
  onClientConnect: (userId: string, clientId: string) => void 0,
  onClientDisconnect: (userId: string, clientId: string) => void 0,
});
```

### `LiveSQLServer`

```typescript
interface LiveSQLServer {
  // Attach to an existing HTTP server (Express, Fastify, etc.)
  attach(server: http.Server): void;

  // Graceful shutdown — closes all connections and replication slot
  close(): Promise<void>;
}
```

Observability is handled via callback options in `ServerOptions`:

- `onEvent(userId, table, event)` — after every change event delivery
- `onClientConnect(userId, clientId)` — after successful auth
- `onClientDisconnect(userId, clientId)` — on WebSocket close
- `onBackpressure(userId)` — when a client's send buffer exceeds 1 MiB

Provider-level hooks (on `PostgresProvider` instance):

- `onSlotLost({ slotName, recovered })` — replication slot missing (e.g., after failover)
- `onSlotLagWarning({ slotName, lagBytes })` — WAL lag exceeds threshold
- `onSlotInactive({ slotName })` — slot exists but not actively consuming
- `onError(err)` — replication stream error

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

### `useLiveTable<T>(table, options?)`

Like `useLiveQuery` but returns a `Map<string, T>` keyed by primary key for O(1) lookups.

```typescript
import { useLiveTable } from "@livesql/react";

function OrderDashboard() {
  const { data: orders } = useLiveTable<Order>("orders", { key: "id" });
  const order = orders.get("order-123"); // O(1) lookup
}
```

#### Return Type

```typescript
interface UseLiveTableResult<T> {
  data: Map<string, T>; // Current rows keyed by primary key
  loading: boolean;
  error: Error | null;
}
```

### `useLiveSQLClient()`

Access the raw `LiveSQLClient` instance from context.

```typescript
const client = useLiveSQLClient();
// For advanced use cases — prefer useLiveQuery for most cases
```

---

## Package: @livesql/vue

### `createLiveSQLPlugin(options)`

Vue plugin that provides a shared `LiveSQLClient` instance via `provide/inject`.

```typescript
import { createApp } from "vue";
import { createLiveSQLPlugin } from "@livesql/vue";

const app = createApp(App);
app.use(createLiveSQLPlugin({ url: "wss://api.example.com/livesql", getToken }));
```

### `useLiveQuery<T>(table, options?)`

Composable that returns reactive `{ data, loading, error }` with an array of rows.

```vue
<script setup lang="ts">
import { useLiveQuery } from "@livesql/vue";
const { data: orders, loading } = useLiveQuery<Order>("orders");
</script>
```

### `useLiveTable<T>(table, options?)`

Composable that returns reactive `{ data, loading, error }` with a `Map<string, T>` for O(1) lookups.

```vue
<script setup lang="ts">
import { useLiveTable } from "@livesql/vue";
const { data: orders } = useLiveTable<Order>("orders");
// orders.value.get("order-123")
</script>
```

---

## Package: @livesql/svelte

### `liveQuery<T>(client, table, options?)`

Store factory that returns a `Readable<{ data: T[], loading, error }>`.

```svelte
<script>
import { liveQuery } from "@livesql/svelte";
const orders = liveQuery(client, "orders", { filter: "status = pending" });
</script>
{#each $orders.data as order}
  <div>{order.status}</div>
{/each}
```

### `liveTable<T>(client, table, options?)`

Store factory that returns a `Readable<{ data: Map<string, T>, loading, error }>` for O(1) lookups.

```svelte
<script>
import { liveTable } from "@livesql/svelte";
const orders = liveTable(client, "orders");
// $orders.data.get("order-123")
</script>
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
