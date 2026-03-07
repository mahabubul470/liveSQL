---
sidebar_position: 2
title: Migrating from Firebase Realtime Database
---

This guide shows how to replace Firebase Realtime Database (or Firestore) listeners with LiveSQL, moving from a proprietary NoSQL backend to PostgreSQL with WAL-guaranteed delivery.

## Why migrate?

|                     | Firebase Realtime DB / Firestore  | LiveSQL                                            |
| ------------------- | --------------------------------- | -------------------------------------------------- |
| Data model          | NoSQL documents/JSON tree         | Relational tables (PostgreSQL)                     |
| Query language      | Limited (no JOINs, no aggregates) | Full SQL via your existing backend                 |
| Guaranteed delivery | Yes (within Firebase SDK)         | Yes — WAL replay from offset on reconnect          |
| Vendor lock-in      | Yes — tied to Google Cloud        | No — any PostgreSQL (self-hosted, RDS, Neon)       |
| Data portability    | Firebase export format only       | Standard PostgreSQL (pg_dump, logical replication) |
| Self-hosted         | No                                | Yes — single npm package                           |
| Pricing             | Per read/write/connection         | Free (open source, Apache 2.0)                     |
| Auth                | Firebase Auth (tied to platform)  | Bring your own JWT                                 |

## Concept mapping

| Firebase                            | LiveSQL equivalent                                        |
| ----------------------------------- | --------------------------------------------------------- |
| `firebase.database().ref("orders")` | `useLiveQuery("orders")` or `useLiveTable("orders")`      |
| `ref.on("child_added", cb)`         | `client.subscribe("orders", cb)` — receives insert events |
| `ref.on("child_changed", cb)`       | Same subscribe — receives update events                   |
| `ref.on("child_removed", cb)`       | Same subscribe — receives delete events                   |
| `ref.off()`                         | Return value of `subscribe()` is unsubscribe function     |
| Firestore `onSnapshot()`            | `useLiveQuery()` hook (React/Vue/Svelte)                  |
| Firebase Auth                       | Any JWT provider (Auth0, Clerk, custom)                   |
| Firestore Security Rules            | `permissions()` + `rowPermission()` callbacks             |
| `ref.push()` / `doc.set()`          | Standard SQL INSERT via your API                          |

## Migration steps

### 1. Set up PostgreSQL tables

Replace your Firebase document structure with SQL tables:

```sql
-- Firebase: /orders/{orderId} → { status, userId, total, createdAt }
CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',
  user_id TEXT NOT NULL,
  total NUMERIC(10, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Required for LiveSQL change tracking
ALTER TABLE orders REPLICA IDENTITY FULL;
```

### 2. Add LiveSQL server

```typescript
import http from "node:http";
import { createLiveSQLServer, PostgresProvider } from "@livesql/server";

const provider = new PostgresProvider({
  connectionString: process.env.DATABASE_URL!,
  tables: ["orders", "messages"],
});
await provider.connect();

const httpServer = http.createServer(/* your existing API handler */);

const livesql = createLiveSQLServer(provider, {
  database: process.env.DATABASE_URL!,
  tables: ["orders", "messages"],
  jwtSecret: process.env.JWT_SECRET!,

  // Equivalent to Firestore Security Rules
  permissions: (userId, table) => {
    return true; // all authenticated users can subscribe
  },
  rowPermission: (userId, table, row) => {
    if (table === "orders") return row.user_id === userId;
    return true;
  },
});

livesql.attach(httpServer);
httpServer.listen(3000);
```

### 3. Replace client-side listeners

#### React

**Before (Firebase):**

```tsx
import { useEffect, useState } from "react";
import { getDatabase, ref, onValue, off } from "firebase/database";

function OrderList() {
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    const db = getDatabase();
    const ordersRef = ref(db, "orders");

    onValue(ordersRef, (snapshot) => {
      const data = snapshot.val();
      setOrders(data ? Object.values(data) : []);
    });

    return () => off(ordersRef);
  }, []);

  return (
    <ul>
      {orders.map((o) => (
        <li key={o.id}>{o.status}</li>
      ))}
    </ul>
  );
}
```

**After (LiveSQL):**

```tsx
import { LiveSQLProvider, useLiveQuery } from "@livesql/react";

function App() {
  return (
    <LiveSQLProvider url="wss://api.example.com/livesql" getToken={getJwtToken}>
      <OrderList />
    </LiveSQLProvider>
  );
}

function OrderList() {
  const { data: orders, loading } = useLiveQuery<Order>("orders");

  if (loading) return <p>Connecting...</p>;

  return (
    <ul>
      {orders.map((o) => (
        <li key={o.id}>{o.status}</li>
      ))}
    </ul>
  );
}
```

#### Vue

**Before (Firebase):**

```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { getDatabase, ref as dbRef, onValue, off } from "firebase/database";

const orders = ref<Order[]>([]);
let ordersRef: ReturnType<typeof dbRef>;

onMounted(() => {
  const db = getDatabase();
  ordersRef = dbRef(db, "orders");
  onValue(ordersRef, (snapshot) => {
    orders.value = snapshot.val() ? Object.values(snapshot.val()) : [];
  });
});

onUnmounted(() => off(ordersRef));
</script>
```

**After (LiveSQL):**

```vue
<script setup lang="ts">
import { useLiveQuery } from "@livesql/vue";

const { data: orders, loading } = useLiveQuery<Order>("orders");
</script>
```

#### Vanilla JS

**Before (Firebase):**

```typescript
import { getDatabase, ref, onValue } from "firebase/database";

const db = getDatabase();
onValue(ref(db, "orders"), (snapshot) => {
  renderOrders(snapshot.val());
});
```

**After (LiveSQL):**

```typescript
import { LiveSQLClient } from "@livesql/client";

const client = new LiveSQLClient("wss://api.example.com/livesql", getJwtToken);
client.connect();
client.subscribe<Order>("orders", (event) => {
  // event.type: "insert" | "update" | "delete"
  // event.row: the full row data
  updateUI(event);
});
```

### 4. Replace writes

Firebase handles reads and writes through the same SDK. With LiveSQL, writes go through your existing REST API or any backend — LiveSQL only handles the real-time streaming.

**Before (Firebase):**

```typescript
import { getDatabase, ref, push } from "firebase/database";
push(ref(getDatabase(), "orders"), { status: "pending", userId: "u_123", total: 42.0 });
```

**After (standard API call):**

```typescript
await fetch("/api/orders", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ status: "pending", userId: "u_123", total: 42.0 }),
});
// LiveSQL automatically streams the INSERT to all subscribed clients
```

### 5. Replace Firebase Security Rules

**Firebase rules:**

```json
{
  "rules": {
    "orders": {
      "$orderId": {
        ".read": "auth != null && data.child('userId').val() === auth.uid",
        ".write": "auth != null"
      }
    }
  }
}
```

**LiveSQL equivalent:**

```typescript
const livesql = createLiveSQLServer(provider, {
  database: process.env.DATABASE_URL!,
  tables: ["orders"],
  jwtSecret: process.env.JWT_SECRET!,

  // Table-level: can this user subscribe?
  permissions: (userId, table) => true,

  // Row-level: can this user see this row?
  rowPermission: (userId, table, row) => {
    if (table === "orders") return row.user_id === userId;
    return true;
  },
});
```

## Data migration

### Export from Firebase

```bash
# Using Firebase CLI
firebase database:get /orders > orders.json
```

### Import to PostgreSQL

```typescript
import fs from "fs";
import pg from "pg";

const orders = JSON.parse(fs.readFileSync("orders.json", "utf8"));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

for (const [id, order] of Object.entries(orders)) {
  await pool.query(
    "INSERT INTO orders (status, user_id, total, created_at) VALUES ($1, $2, $3, $4)",
    [order.status, order.userId, order.total, new Date(order.createdAt)],
  );
}
```

## Key differences to remember

1. **Writes are separate** — Firebase combines reads and writes in one SDK. LiveSQL only handles real-time reads. Use your existing REST/GraphQL API for writes.

2. **No offline mode** — Firebase has built-in offline persistence. If you need offline support, use a client-side cache (e.g., IndexedDB) with LiveSQL's offset-based reconnection to sync on reconnect.

3. **SQL queries** — You now have full SQL power (JOINs, aggregates, window functions) for your read APIs. LiveSQL streams individual table changes.

4. **Auth is yours** — Replace `firebase.auth()` with any JWT provider. LiveSQL verifies standard JWTs — no vendor-specific auth required.
