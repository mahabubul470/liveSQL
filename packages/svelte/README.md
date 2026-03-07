# @livesql/svelte

Svelte store for LiveSQL — real-time SQL table sync via WebSockets.

## Installation

```bash
npm install @livesql/svelte @livesql/client @livesql/core
```

## Quick Start

```svelte
<!-- App.svelte -->
<script lang="ts">
  import { LiveSQLClient } from "@livesql/client";
  import { liveQuery } from "@livesql/svelte";
  import { onMount, onDestroy } from "svelte";

  const client = new LiveSQLClient("wss://api.example.com/livesql", () => authToken);
  onMount(() => client.connect());
  onDestroy(() => client.disconnect());

  const orders = liveQuery(client, "orders", { filter: "status = pending" });
</script>

{#if $orders.loading}
  <p>Loading…</p>
{:else if $orders.error}
  <p>Error: {$orders.error.message}</p>
{:else}
  <ul>
    {#each $orders.data as order (order.id)}
      <li>{order.status}</li>
    {/each}
  </ul>
{/if}
```

## API

### `liveQuery<T>(client, table, options?)`

Returns a Svelte `Readable<{ data: T[], loading: boolean, error: Error | null }>`.

The store is **lazy** — it only subscribes to the server when a Svelte component subscribes to it (via `$store` syntax or `store.subscribe()`), and automatically unsubscribes when the last subscriber is gone.

```ts
const orders = liveQuery<Order>(client, "orders", {
  filter: "status = pending", // server-side filter
  initialData: [], // seed data
  key: "id", // primary key field (default: "id")
});
```

### `liveTable<T>(client, table, options?)`

Same as `liveQuery` but returns a `Map<key, row>` for O(1) lookups.

```ts
const orders = liveTable<Order>(client, "orders");
// $orders.data is Map<string, Order>
const order = $orders.data.get(orderId);
```

## License

Apache-2.0
