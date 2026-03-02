# @livesql/client

Framework-agnostic WebSocket client for [LiveSQL](https://github.com/mahabubul470/liveSQL).

Handles connection management, subscription state, offset tracking, and automatic reconnection with exponential backoff. Works in any browser environment — React, Vue, Svelte, or vanilla JS.

## Install

```bash
npm install @livesql/client @livesql/core
```

## Quick Start

```typescript
import { LiveSQLClient } from "@livesql/client";

const client = new LiveSQLClient("ws://localhost:3000", () => localStorage.getItem("token") ?? "");

client.connect();

// Subscribe to a table
const unsubscribe = client.subscribe("orders", (event) => {
  console.log(event.type, event.row); // "insert" { id: "...", status: "pending", ... }
});

// Unsubscribe when done
unsubscribe();

// Disconnect cleanly
client.disconnect();
```

## API

### `new LiveSQLClient(url, getToken)`

| Parameter  | Type                              | Description                                  |
| ---------- | --------------------------------- | -------------------------------------------- |
| `url`      | `string`                          | WebSocket server URL (`ws://` or `wss://`)   |
| `getToken` | `() => string \| Promise<string>` | Called on each connect to get the auth token |

The token is appended as `?token=<value>` to the URL. Pass `() => ""` if your server doesn't require authentication.

### `client.connect()`

Opens the WebSocket connection. Automatically re-subscribes all active subscriptions on reconnect.

### `client.subscribe<T>(table, callback)`

Subscribe to change events on a table. Returns an unsubscribe function.

```typescript
const unsubscribe = client.subscribe<{ id: string; status: string }>("orders", (event) => {
  if (event.type === "insert") {
    console.log("New order:", event.row.id);
  }
  if (event.type === "update") {
    console.log("Changed from:", event.oldRow, "to:", event.row);
  }
  if (event.type === "delete") {
    console.log("Deleted:", event.row.id);
  }
});

// Later:
unsubscribe();
```

The `ChangeEvent` type:

```typescript
{
  id: string;
  lsn: string;
  offset: bigint;
  table: string;
  schema: string;
  type: "insert" | "update" | "delete";
  row: T;
  oldRow?: T;        // Present on update and delete (requires REPLICA IDENTITY FULL)
  timestamp: string; // ISO-8601
}
```

### `client.disconnect()`

Closes the connection and clears all subscriptions. Does not reconnect.

### `client.connected`

`boolean` — whether the WebSocket is currently open.

### `client.currentOffset`

`bigint` — the highest offset received. Sent to the server on reconnect so the server can replay missed events.

## Reconnection

The client reconnects automatically on disconnect with exponential backoff plus ±25% jitter to prevent thundering herd:

| Attempt | Delay (approx) |
| ------- | -------------- |
| 1       | ~250ms         |
| 2       | ~500ms         |
| 3       | ~1s            |
| 4       | ~2s            |
| 5       | ~4s            |
| …       | …              |
| cap     | 30s            |

On reconnect, the client automatically re-sends all active subscriptions with the last known `offset`. The server replays any events buffered since that offset, so your UI stays consistent even after a disconnect.

## Filtering (server-side)

Pass a `filter` option to `subscribe` to receive only matching rows (filtered server-side, never SQL):

```typescript
client.subscribe("orders", (event) => { ... }, { filter: "status = shipped" });
```

> Filtering must be enabled per-table in the server config (`allowedFilterColumns`).

## Vanilla JS Example

```html
<script type="module">
  import { LiveSQLClient } from "https://cdn.jsdelivr.net/npm/@livesql/client/dist/index.js";

  const client = new LiveSQLClient("ws://localhost:3000", () => "");
  client.connect();

  client.subscribe("orders", ({ type, row }) => {
    const li = document.createElement("li");
    li.textContent = `${type}: order #${row.id}`;
    document.getElementById("feed").prepend(li);
  });
</script>
```

## License

Apache 2.0
