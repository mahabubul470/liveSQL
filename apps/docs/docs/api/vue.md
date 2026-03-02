---
sidebar_position: 4
title: "@livesql/vue"
---

Vue composables for LiveSQL. Built on top of `@livesql/client`.

```bash
npm install @livesql/vue @livesql/client
```

**Vue peer dependency**: Vue 3.

---

## Setup

Register the LiveSQL plugin in your app's entry point. It creates a shared `LiveSQLClient` instance and makes it available via `provide/inject`.

```typescript title="main.ts"
import { createApp } from "vue";
import { createLiveSQLPlugin } from "@livesql/vue";
import App from "./App.vue";

const app = createApp(App);

app.use(
  createLiveSQLPlugin({
    url: "wss://api.example.com/livesql",
    getToken: () => localStorage.getItem("token") ?? "",
  }),
);

app.mount("#app");
```

### `createLiveSQLPlugin(options)`

| Option     | Type                              | Description                       |
| ---------- | --------------------------------- | --------------------------------- |
| `url`      | `string`                          | WebSocket server URL              |
| `getToken` | `() => string \| Promise<string>` | Called on every connect/reconnect |

---

## `useLiveQuery<T>(table, options?)`

Subscribe to a table and receive reactive refs for `data`, `loading`, and `error`.

```vue title="OrderList.vue"
<script setup lang="ts">
import { useLiveQuery } from "@livesql/vue";

interface Order {
  id: string;
  status: string;
  total: number;
}

const { data: orders, loading, error } = useLiveQuery<Order>("orders");
</script>

<template>
  <div v-if="loading">Connecting…</div>
  <div v-else-if="error">Error: {{ error.message }}</div>
  <ul v-else>
    <li v-for="order in orders" :key="order.id">#{{ order.id }} — {{ order.status }}</li>
  </ul>
</template>
```

### Options

| Option        | Type     | Default | Description                                              |
| ------------- | -------- | ------- | -------------------------------------------------------- |
| `filter`      | `string` | —       | Server-side filter expression, e.g. `"status = pending"` |
| `initialData` | `T[]`    | `[]`    | Rows to show before first sync message                   |

### Return value

```typescript
interface UseLiveQueryResult<T> {
  data: Ref<T[]>; // Reactive array of rows
  loading: Ref<boolean>; // True until first sync message
  error: Ref<Error | null>; // Connection or permission error
}
```

### Row update behavior

| Event    | Effect on `data`                |
| -------- | ------------------------------- |
| `insert` | Row appended                    |
| `update` | Row with matching `id` replaced |
| `delete` | Row with matching `id` removed  |

### With a filter

```vue
<script setup lang="ts">
import { useLiveQuery } from "@livesql/vue";

const { data: pendingOrders } = useLiveQuery<Order>("orders", {
  filter: "status = pending",
});
</script>
```

---

## `LIVESQL_CLIENT_KEY`

The injection key used internally by `createLiveSQLPlugin`. Use this to access the raw `LiveSQLClient` for advanced use cases.

```vue
<script setup lang="ts">
import { inject } from "vue";
import { LIVESQL_CLIENT_KEY } from "@livesql/vue";
import type { LiveSQLClient } from "@livesql/client";

const client = inject<LiveSQLClient>(LIVESQL_CLIENT_KEY);
</script>
```

---

## Full example

```vue title="Dashboard.vue"
<script setup lang="ts">
import { useLiveQuery } from "@livesql/vue";

interface Order {
  id: string;
  status: "pending" | "shipped" | "delivered";
  total: number;
  customer_name: string;
}

const { data: allOrders, loading } = useLiveQuery<Order>("orders");
const { data: pendingOrders } = useLiveQuery<Order>("orders", {
  filter: "status = pending",
});
</script>

<template>
  <div>
    <h2>Pending ({{ pendingOrders.length }})</h2>
    <ul>
      <li v-for="order in pendingOrders" :key="order.id">
        {{ order.customer_name }} — ${{ order.total }}
      </li>
    </ul>

    <h2>All Orders ({{ allOrders.length }})</h2>
  </div>
</template>
```

```typescript title="main.ts"
import { createApp } from "vue";
import { createLiveSQLPlugin } from "@livesql/vue";
import Dashboard from "./Dashboard.vue";

createApp(Dashboard)
  .use(
    createLiveSQLPlugin({
      url: import.meta.env.VITE_LIVESQL_URL,
      getToken: () => localStorage.getItem("token") ?? "",
    }),
  )
  .mount("#app");
```
