---
sidebar_label: PostgREST + LiveSQL
sidebar_position: 5
title: PostgREST + LiveSQL — Full Backend, Zero Server Code
---

# PostgREST + LiveSQL

Use **PostgREST** for CRUD and **LiveSQL** for real-time streaming. Together they give you a full backend without writing any server code.

## Architecture

```
┌──────────┐     REST      ┌────────────┐
│  Browser │──────────────▶│ PostgREST  │──────▶ PostgreSQL
│          │               └────────────┘           │
│          │   WebSocket   ┌────────────┐           │
│          │◀──────────────│  LiveSQL   │◀──── WAL stream
└──────────┘               └────────────┘
```

- **PostgREST** (port 3000): instant REST API from your PostgreSQL schema — reads, writes, filters, pagination
- **LiveSQL** (port 3001): streams row-level changes in real time via WebSocket

Your app writes through PostgREST, and LiveSQL pushes the changes back to all connected clients automatically.

## Docker Compose Setup

```yaml title="docker-compose.yml"
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: myapp
      POSTGRES_PASSWORD: secret
      POSTGRES_DB: mydb
    command: >
      postgres
        -c wal_level=logical
        -c max_replication_slots=10
        -c max_slot_wal_keep_size=1024
    ports:
      - "5432:5432"

  postgrest:
    image: postgrest/postgrest
    environment:
      PGRST_DB_URI: postgresql://myapp:secret@postgres:5432/mydb
      PGRST_DB_ANON_ROLE: myapp
      PGRST_OPENAPI_SERVER_PROXY_URI: http://localhost:3000
    ports:
      - "3000:3000"
    depends_on:
      - postgres

  livesql:
    build:
      context: .
      dockerfile: Dockerfile.livesql
    environment:
      DATABASE_URL: postgresql://myapp:secret@postgres:5432/mydb
      LIVESQL_TABLES: orders,products
      LIVESQL_PORT: 3001
    ports:
      - "3001:3001"
    depends_on:
      - postgres
```

## LiveSQL Server (Minimal)

```typescript title="livesql-server.ts"
import { createLiveSQLServer, PostgresProvider } from "@livesql/server";

const tables = (process.env.LIVESQL_TABLES ?? "").split(",");

const provider = new PostgresProvider({
  connectionString: process.env.DATABASE_URL!,
  tables,
});
await provider.connect();

createLiveSQLServer(provider, {
  database: process.env.DATABASE_URL!,
  tables,
  port: Number(process.env.LIVESQL_PORT ?? 3001),
});

console.log(`LiveSQL streaming ${tables.join(", ")} on :${process.env.LIVESQL_PORT ?? 3001}`);
```

## Client: Write via REST, Stream via WebSocket

### React Example

```tsx title="App.tsx"
import { LiveSQLProvider, useLiveQuery } from "@livesql/react";

const POSTGREST_URL = "http://localhost:3000";
const LIVESQL_URL = "ws://localhost:3001";

function App() {
  return (
    <LiveSQLProvider url={LIVESQL_URL} getToken={() => ""}>
      <OrderDashboard />
    </LiveSQLProvider>
  );
}

function OrderDashboard() {
  // Real-time updates via LiveSQL
  const { data: orders, loading } = useLiveQuery<Order>("orders");

  // Write via PostgREST
  const createOrder = async () => {
    await fetch(`${POSTGREST_URL}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "pending", total: 42.0 }),
    });
    // No need to refetch — LiveSQL pushes the INSERT event automatically
  };

  if (loading) return <p>Connecting...</p>;

  return (
    <div>
      <button onClick={createOrder}>New Order</button>
      <ul>
        {orders.map((o) => (
          <li key={o.id}>
            {o.status} — ${o.total}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

### Vanilla JS

```typescript
import { LiveSQLClient } from "@livesql/client";

// Write via PostgREST
await fetch("http://localhost:3000/orders", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ status: "pending", total: 42.0 }),
});

// Stream via LiveSQL
const client = new LiveSQLClient("ws://localhost:3001", () => "");
client.connect();
client.subscribe("orders", (event) => {
  console.log(event.type, event.row);
  // "insert" { id: "...", status: "pending", total: 42.0 }
});
```

## Adding Auth

PostgREST and LiveSQL can share the same JWT secret:

```yaml
# docker-compose.yml
postgrest:
  environment:
    PGRST_JWT_SECRET: "your-shared-secret"

livesql:
  environment:
    JWT_SECRET: "your-shared-secret"
```

```typescript
// livesql-server.ts
createLiveSQLServer(provider, {
  database: process.env.DATABASE_URL!,
  tables,
  port: 3001,
  jwtSecret: process.env.JWT_SECRET,
});
```

Clients send the same JWT to both services:

```typescript
// PostgREST
fetch("http://localhost:3000/orders", {
  headers: { Authorization: `Bearer ${token}` },
});

// LiveSQL
const client = new LiveSQLClient("ws://localhost:3001", () => token);
```

## When to Use This Pattern

**Good fit:**

- Internal dashboards, admin panels
- Prototypes and MVPs — skip writing a backend entirely
- CRUD apps where PostgreSQL is the source of truth

**Consider a custom server when:**

- You need complex business logic before writes
- You want to aggregate or transform data before sending to clients
- You need to integrate with external services on every write
