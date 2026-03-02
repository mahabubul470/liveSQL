---
sidebar_position: 1
title: Migrating from Supabase Realtime
---

This guide shows how to replace Supabase Realtime subscriptions with LiveSQL — moving from LISTEN/NOTIFY-based delivery to WAL-guaranteed delivery.

## Why migrate?

|                          | Supabase Realtime                           | LiveSQL                                        |
| ------------------------ | ------------------------------------------- | ---------------------------------------------- |
| CDC mechanism            | LISTEN/NOTIFY                               | WAL logical replication                        |
| Guaranteed delivery      | No — events lost on disconnect              | Yes — replayed from offset on reconnect        |
| Missed events on restart | Yes                                         | No                                             |
| Auth model               | Built-in (tied to Supabase)                 | Bring your own JWT                             |
| Row-level security       | Evaluated per subscriber in DB (N DB reads) | Evaluated in-process (0 DB reads)              |
| Self-hosted              | Requires Supabase stack                     | Single npm package, attaches to any PostgreSQL |
| Vendor lock-in           | Yes                                         | No                                             |

## Server-side comparison

### Supabase Realtime (managed)

With Supabase, real-time is automatic — you don't set up a server, but you're tied to the Supabase platform.

### LiveSQL

Add to your existing Node.js server:

```typescript
import { createLiveSQLServer } from "@livesql/server";
import jwt from "jsonwebtoken";

const livesql = createLiveSQLServer({
  database: process.env.DATABASE_URL!,
  tables: ["orders", "messages"],

  authenticate: async (req) => {
    const token = new URL(req.url!, "http://x").searchParams.get("token");
    return token ? jwt.verify(token, process.env.JWT_SECRET!) : null;
  },

  // Row-level filter (runs in-process, not in the database)
  rowPermission: (userId, table, row) => {
    if (table === "messages") return row.user_id === userId;
    return true;
  },
});

livesql.attach(httpServer);
```

## Client-side migration

### React

**Before (Supabase):**

```tsx
import { useEffect, useState } from "react";
import { supabase } from "./supabase";

function OrderList() {
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    // Load initial data separately
    supabase
      .from("orders")
      .select("*")
      .then(({ data }) => {
        setOrders(data ?? []);
      });

    const channel = supabase
      .channel("orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, (payload) => {
        if (payload.eventType === "INSERT") {
          setOrders((prev) => [...prev, payload.new as Order]);
        } else if (payload.eventType === "UPDATE") {
          setOrders((prev) =>
            prev.map((o) => (o.id === payload.new.id ? (payload.new as Order) : o)),
          );
        } else if (payload.eventType === "DELETE") {
          setOrders((prev) => prev.filter((o) => o.id !== payload.old.id));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
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

// Wrap once at app root:
function App() {
  return (
    <LiveSQLProvider
      url="wss://api.example.com/livesql"
      getToken={() => supabase.auth.getSession().then((s) => s.data.session?.access_token ?? "")}
    >
      <OrderList />
    </LiveSQLProvider>
  );
}

// Clean component — no useEffect, no state management:
function OrderList() {
  const { data: orders, loading, error } = useLiveQuery<Order>("orders");

  if (loading) return <p>Connecting…</p>;
  if (error) return <p>{error.message}</p>;

  return (
    <ul>
      {orders.map((o) => (
        <li key={o.id}>{o.status}</li>
      ))}
    </ul>
  );
}
```

### Vue

**Before (Supabase):**

```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { supabase } from "./supabase";

const orders = ref<Order[]>([]);
let channel: ReturnType<typeof supabase.channel>;

onMounted(async () => {
  const { data } = await supabase.from("orders").select("*");
  orders.value = data ?? [];

  channel = supabase
    .channel("orders")
    .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, (payload) => {
      // manual insert/update/delete handling...
    })
    .subscribe();
});

onUnmounted(() => {
  supabase.removeChannel(channel);
});
</script>
```

**After (LiveSQL):**

```vue
<script setup lang="ts">
import { useLiveQuery } from "@livesql/vue";

const { data: orders, loading, error } = useLiveQuery<Order>("orders");
</script>
```

### Vanilla JS

**Before (Supabase):**

```typescript
const channel = supabase
  .channel("orders")
  .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, handler)
  .subscribe();
```

**After (LiveSQL):**

```typescript
import { LiveSQLClient } from "@livesql/client";

const client = new LiveSQLClient("wss://api.example.com/livesql", getToken);
client.connect();
client.subscribe("orders", handler);
```

## PostgreSQL setup changes

Supabase Realtime manages its own replication internally. With LiveSQL you manage it directly.

### One-time setup per table

```sql
-- Enable WAL for the table (must be done once)
ALTER TABLE orders REPLICA IDENTITY FULL;
ALTER TABLE messages REPLICA IDENTITY FULL;
```

### PostgreSQL config (`postgresql.conf`)

```
wal_level = logical
max_replication_slots = 10      -- one per LiveSQL instance + headroom
max_wal_senders = 10
max_slot_wal_keep_size = 1024   -- MB, prevents disk exhaustion
```

LiveSQL creates its own replication slot automatically on first connect.

## Keeping your Supabase auth token

If you're using Supabase Auth but want to replace Realtime, you can keep using Supabase JWTs with LiveSQL — they are standard JWTs signed with your project's `JWT_SECRET`.

```typescript
// In your LiveSQL server config
authenticate: async (req) => {
  const token = new URL(req.url!, "http://x").searchParams.get("token");
  if (!token) return null;
  // Supabase JWTs are standard JWTs — verify with your Supabase JWT secret
  return jwt.verify(token, process.env.SUPABASE_JWT_SECRET!) as { sub: string };
},
```

```typescript
// In your client — pass the Supabase session token
const client = new LiveSQLClient("wss://api.example.com/livesql", async () => {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? "";
});
```

This lets you migrate Realtime incrementally — table by table — while keeping your existing auth infrastructure.
