---
sidebar_position: 5
title: "@livesql/svelte"
---

Svelte stores for LiveSQL. Built on top of `@livesql/client`.

```bash
npm install @livesql/svelte @livesql/client
```

**Svelte peer dependency**: Svelte 4+.

---

## Setup

Unlike the React and Vue packages, `@livesql/svelte` does not use a framework context or plugin — you create and manage the `LiveSQLClient` directly and pass it to `liveQuery`. This keeps the store dependency-free and works in any Svelte project structure.

```typescript title="lib/livesql.ts"
import { LiveSQLClient } from "@livesql/client";

export const client = new LiveSQLClient(
  "wss://api.example.com/livesql",
  () => localStorage.getItem("token") ?? "",
);

client.connect();
```

---

## `liveQuery<T>(client, table, options?)`

Returns a Svelte `Readable` store that emits `{ data, loading, error }` whenever the table changes.

```svelte title="OrderList.svelte"
<script lang="ts">
  import { liveQuery } from "@livesql/svelte";
  import { client } from "$lib/livesql";

  interface Order {
    id: string;
    status: string;
    total: number;
  }

  const orders = liveQuery<Order>(client, "orders");
</script>

{#if $orders.loading}
  <p>Connecting…</p>
{:else if $orders.error}
  <p>Error: {$orders.error.message}</p>
{:else}
  <ul>
    {#each $orders.data as order (order.id)}
      <li>#{order.id} — {order.status} — ${order.total}</li>
    {/each}
  </ul>
{/if}
```

### Parameters

| Parameter        | Type            | Description                            |
| ---------------- | --------------- | -------------------------------------- |
| `client`         | `LiveSQLClient` | The client instance to use             |
| `table`          | `string`        | Table name to subscribe to             |
| `options.filter` | `string`        | Optional server-side filter expression |

### Store value

```typescript
interface LiveQueryStore<T> {
  data: T[]; // Current rows
  loading: boolean; // True until first sync message
  error: Error | null; // Connection or permission error
}
```

The store is lazy — it subscribes to the table when the first Svelte subscriber appears and unsubscribes when the last one disappears.

### Row update behavior

| Event    | Effect on `data`                |
| -------- | ------------------------------- |
| `insert` | Row appended                    |
| `update` | Row with matching `id` replaced |
| `delete` | Row with matching `id` removed  |

### With a filter

```svelte
<script lang="ts">
  import { liveQuery } from "@livesql/svelte";
  import { client } from "$lib/livesql";

  const pending = liveQuery(client, "orders", { filter: "status = pending" });
</script>

<p>Pending orders: {$pending.data.length}</p>
```

---

## `liveTable<T>(client, table, options?)`

Same as `liveQuery` but returns a `Map<key, row>` for O(1) lookups by primary key.

```svelte title="OrderLookup.svelte"
<script lang="ts">
  import { liveTable } from "@livesql/svelte";
  import { client } from "$lib/livesql";

  interface Order {
    id: string;
    status: string;
    total: number;
  }

  const orders = liveTable<Order>(client, "orders");
  // $orders.data is Map<string, Order>
</script>

{#if !$orders.loading}
  <p>Order abc: {$orders.data.get("abc")?.status}</p>
  <p>Total orders: {$orders.data.size}</p>
{/if}
```

### Store value

```typescript
interface LiveTableStore<T> {
  data: Map<string, T>; // Map keyed by primary key
  loading: boolean;
  error: Error | null;
}
```

---

## Using `get()` for non-reactive reads

If you need to read the current value outside of a Svelte component:

```typescript
import { get } from "svelte/store";
import { liveQuery } from "@livesql/svelte";
import { client } from "$lib/livesql";

const orders = liveQuery(client, "orders");
const currentOrders = get(orders).data;
```

---

## Full example

```typescript title="lib/livesql.ts"
import { LiveSQLClient } from "@livesql/client";

export const client = new LiveSQLClient(
  import.meta.env.VITE_LIVESQL_URL,
  () => localStorage.getItem("token") ?? "",
);

client.connect();
```

```svelte title="Dashboard.svelte"
<script lang="ts">
  import { liveQuery } from "@livesql/svelte";
  import { client } from "$lib/livesql";

  interface Order {
    id: string;
    status: "pending" | "shipped" | "delivered";
    total: number;
    customer_name: string;
  }

  const orders = liveQuery<Order>(client, "orders");
  const pending = liveQuery<Order>(client, "orders", {
    filter: "status = pending",
  });
</script>

<h2>Pending Orders ({$pending.data.length})</h2>
{#if $pending.loading}
  <p>Connecting…</p>
{:else}
  <ul>
    {#each $pending.data as order (order.id)}
      <li>{order.customer_name} — ${order.total}</li>
    {/each}
  </ul>
{/if}

<h2>Total tracked: {$orders.data.length}</h2>
```
