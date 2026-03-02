---
sidebar_position: 3
title: "@livesql/react"
---

React hooks for LiveSQL. Built on top of `@livesql/client`.

```bash
npm install @livesql/react @livesql/client
```

**React peer dependency**: React 18+.

---

## Setup

Wrap your app (or the subtree that needs real-time data) with `LiveSQLProvider`. It creates and manages a single shared `LiveSQLClient` instance.

```tsx title="App.tsx"
import { LiveSQLProvider } from "@livesql/react";

export function App() {
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

### `LiveSQLProvider` props

| Prop       | Type                              | Description                       |
| ---------- | --------------------------------- | --------------------------------- |
| `url`      | `string`                          | WebSocket server URL              |
| `getToken` | `() => string \| Promise<string>` | Called on every connect/reconnect |
| `children` | `ReactNode`                       | Your component tree               |

---

## `useLiveQuery<T>(table, options?)`

Subscribe to a table and receive a reactive array of rows. Handles INSERT, UPDATE, and DELETE automatically.

```tsx
import { useLiveQuery } from "@livesql/react";

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
          #{order.id} — {order.status}
        </li>
      ))}
    </ul>
  );
}
```

### Options

| Option        | Type     | Default | Description                                              |
| ------------- | -------- | ------- | -------------------------------------------------------- |
| `filter`      | `string` | —       | Server-side filter expression, e.g. `"status = pending"` |
| `initialData` | `T[]`    | `[]`    | Rows to show before the first sync message arrives       |

### Return value

```typescript
interface UseLiveQueryResult<T> {
  data: T[]; // Current rows
  loading: boolean; // True until first sync message received
  error: Error | null; // Connection or permission error
}
```

### Row update behavior

| Event type | What happens to `data`               |
| ---------- | ------------------------------------ |
| `insert`   | Row appended to the end of the array |
| `update`   | Row with matching `id` is replaced   |
| `delete`   | Row with matching `id` is removed    |

The hook uses the `id` field of each row for matching. Your rows must have an `id` field (UUID or string). If your primary key has a different name, use `useLiveSQLClient()` to handle events manually.

### With a filter

```tsx
function PendingOrders() {
  const { data } = useLiveQuery<Order>("orders", {
    filter: "status = pending",
  });
  return <OrderList orders={data} />;
}
```

### With initial data (SSR / prefetch)

If you prefetch data server-side, pass it as `initialData` to avoid a loading flash:

```tsx
export async function getServerSideProps() {
  const orders = await db.query("SELECT * FROM orders WHERE status = 'pending'");
  return { props: { initialOrders: orders } };
}

function Page({ initialOrders }: { initialOrders: Order[] }) {
  const { data } = useLiveQuery<Order>("orders", {
    filter: "status = pending",
    initialData: initialOrders,
  });
  return <OrderList orders={data} />;
}
```

---

## `useLiveTable<T>(table, options?)`

Like `useLiveQuery`, but returns a `Map<string, T>` keyed by `id` for O(1) lookups.

```tsx
import { useLiveTable } from "@livesql/react";

function OrderDashboard() {
  const { data: orders, loading } = useLiveTable<Order>("orders");

  if (loading) return <p>Loading…</p>;

  // O(1) lookup by ID
  const featuredOrder = orders.get("abc-123");

  return (
    <>
      <p>{orders.size} active orders</p>
      {featuredOrder && <OrderCard order={featuredOrder} />}
    </>
  );
}
```

### Return value

```typescript
interface UseLiveTableResult<T> {
  data: Map<string, T>; // Map keyed by row.id
  loading: boolean;
  error: Error | null;
}
```

Accepts the same `filter` and `initialData` options as `useLiveQuery`.

---

## `useLiveSQLClient()`

Returns the raw `LiveSQLClient` instance from context. Use this for advanced cases where you need direct control over subscriptions.

```tsx
import { useLiveSQLClient } from "@livesql/react";

function CustomSubscriber() {
  const client = useLiveSQLClient();

  useEffect(() => {
    const unsubscribe = client.subscribe<Notification>("notifications", (event) => {
      showToast(event.row.message);
    });
    return unsubscribe;
  }, [client]);

  return null;
}
```

---

## Full example

```tsx title="Dashboard.tsx"
import { LiveSQLProvider, useLiveQuery, useLiveTable } from "@livesql/react";

interface Order {
  id: string;
  status: "pending" | "shipped" | "delivered";
  total: number;
  customer_name: string;
}

function App() {
  return (
    <LiveSQLProvider
      url={import.meta.env.VITE_LIVESQL_URL}
      getToken={() => localStorage.getItem("token")!}
    >
      <Dashboard />
    </LiveSQLProvider>
  );
}

function Dashboard() {
  const pending = useLiveQuery<Order>("orders", { filter: "status = pending" });
  const allOrders = useLiveTable<Order>("orders");

  return (
    <div>
      <h2>Pending Orders ({pending.data.length})</h2>
      {pending.loading && <p>Connecting…</p>}
      <ul>
        {pending.data.map((order) => (
          <li key={order.id}>
            {order.customer_name} — ${order.total}
          </li>
        ))}
      </ul>

      <h2>Total orders tracked: {allOrders.data.size}</h2>
    </div>
  );
}
```
