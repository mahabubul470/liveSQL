# @livesql/vue

Vue 3 composables for LiveSQL — real-time SQL table sync via WebSockets.

## Installation

```bash
npm install @livesql/vue @livesql/client @livesql/core
```

## Quick Start

```ts
// main.ts
import { createApp } from "vue";
import { createLiveSQLPlugin } from "@livesql/vue";
import App from "./App.vue";

const app = createApp(App);
app.use(
  createLiveSQLPlugin({
    url: "wss://api.example.com/livesql",
    getToken: () => authToken,
  }),
);
app.mount("#app");
```

```vue
<!-- OrderList.vue -->
<script setup lang="ts">
import { useLiveQuery } from "@livesql/vue";

const { data: orders, loading } = useLiveQuery<Order>("orders", {
  filter: "status = pending",
});
</script>

<template>
  <p v-if="loading">Loading…</p>
  <ul v-else>
    <li v-for="order in orders" :key="order.id">{{ order.status }}</li>
  </ul>
</template>
```

## API

### `createLiveSQLPlugin(options)`

Vue plugin. Install at app root.

```ts
app.use(
  createLiveSQLPlugin({
    url: "wss://api.example.com/livesql",
    getToken: () => yourAuthToken, // optional
  }),
);
```

### `useLiveQuery<T>(table, options?)`

Returns reactive refs that stay in sync with the server table.

```ts
const { data, loading, error } = useLiveQuery<Order>("orders", {
  filter: "status = pending", // server-side filter
  initialData: [], // seed data
  key: "id", // primary key field (default: "id")
});
// data is Ref<T[]>, loading is Ref<boolean>, error is Ref<Error | null>
```

### `useLiveSQLClient()`

Access the raw `LiveSQLClient` instance.

## License

Apache-2.0
