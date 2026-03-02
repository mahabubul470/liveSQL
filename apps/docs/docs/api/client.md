---
sidebar_position: 2
title: "@livesql/client"
---

Framework-agnostic browser client. Zero runtime dependencies — uses the native `WebSocket` API.

```bash
npm install @livesql/client
```

---

## `LiveSQLClient`

### Constructor

```typescript
import { LiveSQLClient } from "@livesql/client";

const client = new LiveSQLClient(
  url, // WebSocket server URL (ws:// or wss://)
  getToken, // Function that returns the auth token
);
```

| Parameter  | Type                              | Description                                                     |
| ---------- | --------------------------------- | --------------------------------------------------------------- |
| `url`      | `string`                          | WebSocket server URL, e.g. `"wss://api.example.com/livesql"`    |
| `getToken` | `() => string \| Promise<string>` | Called on every connect/reconnect to get the current auth token |

The token is appended as `?token=<value>` to the WebSocket URL.

---

### `connect(): void`

Opens the WebSocket connection. The client automatically reconnects with exponential backoff (250ms → 500ms → 1s → 2s → … → 30s) on disconnect or network error.

```typescript
client.connect();
```

---

### `subscribe<T>(table, callback, options?)`

Subscribe to changes on a table. Returns an `unsubscribe` function.

```typescript
const unsubscribe = client.subscribe<Order>(
  "orders",
  (event) => {
    console.log(event.type); // "insert" | "update" | "delete"
    console.log(event.row); // T — the new (or deleted) row
    console.log(event.oldRow); // T | undefined — previous row on update
    console.log(event.offset); // bigint — for debugging
  },
  {
    filter: "status = pending", // optional server-side filter
  },
);

// Stop receiving events:
unsubscribe();
```

#### Parameters

| Parameter        | Type                                        | Description                                                      |
| ---------------- | ------------------------------------------- | ---------------------------------------------------------------- |
| `table`          | `string`                                    | Table name to subscribe to                                       |
| `callback`       | `(event: ChangeEvent & { row: T }) => void` | Called for every matching change                                 |
| `options.filter` | `string`                                    | Optional filter expression (see [Filter syntax](#filter-syntax)) |

#### Reconnect behavior

On reconnect, the client automatically re-subscribes to all active subscriptions. It includes the last received `offset` in the subscribe message so the server can replay any missed events.

---

### `disconnect(): void`

Close the WebSocket connection and stop reconnecting.

```typescript
client.disconnect();
```

---

### Properties

| Property    | Type      | Description                             |
| ----------- | --------- | --------------------------------------- |
| `connected` | `boolean` | Whether the WebSocket is currently open |
| `offset`    | `bigint`  | Last offset received from the server    |

---

## Filter syntax

Filters let the server deliver only matching rows. They are validated server-side before evaluation — no SQL is ever executed from a filter string.

```
column operator value
```

| Operator | Meaning               |
| -------- | --------------------- |
| `=`      | Equal                 |
| `!=`     | Not equal             |
| `<`      | Less than             |
| `>`      | Greater than          |
| `<=`     | Less than or equal    |
| `>=`     | Greater than or equal |

```typescript
// Only receive orders with status "shipped"
client.subscribe("orders", callback, { filter: "status = shipped" });

// Only receive high-value orders
client.subscribe("orders", callback, { filter: "total > 1000" });
```

The server validates:

1. The column exists in `opts.allowedFilterColumns[table]`
2. The operator is in the allowlist
3. The expression matches the `column operator value` format

Invalid filters return an `INVALID_FILTER` error.

---

## `ChangeEvent` type

Defined in `@livesql/core`. Received in every subscription callback.

```typescript
interface ChangeEvent {
  id: string; // UUID of this event
  lsn: string; // PostgreSQL LSN
  offset: bigint; // Monotonic counter
  table: string; // Table name
  schema: string; // Schema (usually "public")
  type: "insert" | "update" | "delete";
  row: Record<string, unknown>; // New row data
  oldRow?: Record<string, unknown>; // Previous row (UPDATE only)
  timestamp: string; // ISO-8601
}
```

---

## `LiveSQLError`

Exported from `@livesql/client`. Thrown (or passed to `onError`) when the server returns an error message.

```typescript
import { LiveSQLError } from "@livesql/client";

client.subscribe(
  "orders",
  (event) => {
    /* ... */
  },
  {
    onError: (err: LiveSQLError) => {
      console.error(err.code, err.message);
      // err.code: "FORBIDDEN" | "INVALID_FILTER" | "TABLE_NOT_FOUND" | ...
    },
  },
);
```

---

## Full example

```typescript
import { LiveSQLClient, LiveSQLError } from "@livesql/client";

const client = new LiveSQLClient(
  "wss://api.example.com/livesql",
  () => localStorage.getItem("token") ?? "",
);

client.connect();

interface Order {
  id: string;
  status: string;
  total: number;
  user_id: string;
}

const orders = new Map<string, Order>();

const unsubscribe = client.subscribe<Order>(
  "orders",
  (event) => {
    switch (event.type) {
      case "insert":
        orders.set(event.row.id, event.row);
        break;
      case "update":
        orders.set(event.row.id, event.row);
        break;
      case "delete":
        orders.delete(event.row.id);
        break;
    }
    renderUI(orders);
  },
  {
    filter: "status = pending",
    onError: (err: LiveSQLError) => {
      console.error("Subscription error:", err.code, err.message);
    },
  },
);

// Cleanup
window.addEventListener("beforeunload", () => {
  unsubscribe();
  client.disconnect();
});
```
