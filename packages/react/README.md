# @livesql/react

React hooks for LiveSQL — real-time SQL table sync via WebSockets.

## Installation

```bash
npm install @livesql/react @livesql/client @livesql/core
```

## Quick Start

```tsx
import { LiveSQLProvider, useLiveQuery } from "@livesql/react";

// 1. Wrap your app
function App() {
  return (
    <LiveSQLProvider url="wss://api.example.com/livesql" getToken={() => authToken}>
      <OrderList />
    </LiveSQLProvider>
  );
}

// 2. Subscribe to a table
function OrderList() {
  const { data: orders, loading } = useLiveQuery<Order>("orders");

  if (loading) return <p>Loading…</p>;
  return (
    <ul>
      {orders.map((o) => (
        <li key={o.id}>{o.status}</li>
      ))}
    </ul>
  );
}
```

## API

### `<LiveSQLProvider>`

```tsx
<LiveSQLProvider url="wss://api.example.com/livesql" getToken={() => yourAuthToken}>
  {children}
</LiveSQLProvider>
```

### `useLiveQuery<T>(table, options?)`

Returns a reactive array that stays in sync with the server table.

```ts
const { data, loading, error } = useLiveQuery<Order>("orders", {
  filter: "status = pending", // server-side filter
  initialData: [], // seed data to avoid empty flash
  key: "id", // primary key field (default: "id")
});
```

### `useLiveTable<T>(table, options?)`

Same as `useLiveQuery` but returns a `Map<key, row>` for O(1) lookups.

```ts
const { data } = useLiveTable<Order>("orders");
const order = data.get(orderId);
```

### `useLiveSQLClient()`

Access the raw `LiveSQLClient` instance for advanced use cases.

## License

Apache-2.0
