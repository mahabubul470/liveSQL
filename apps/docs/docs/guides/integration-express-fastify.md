---
sidebar_label: Express / Fastify Integration
sidebar_position: 3
title: Adding LiveSQL to an Existing App
---

# Adding LiveSQL to an Existing Express or Fastify App

LiveSQL runs as a sidecar — it attaches to your existing HTTP server and shares the same port. No new services, no proxy configuration.

## Express

```typescript title="server.ts"
import express from "express";
import http from "http";
import { createLiveSQLServer, PostgresProvider } from "@livesql/server";

const app = express();
const httpServer = http.createServer(app);

// Your existing routes
app.get("/api/orders", async (req, res) => {
  const orders = await db.query("SELECT * FROM orders");
  res.json(orders);
});

// Add LiveSQL
const provider = new PostgresProvider({
  connectionString: process.env.DATABASE_URL!,
  tables: ["orders", "products"],
});
await provider.connect();

const livesql = createLiveSQLServer(provider, {
  database: process.env.DATABASE_URL!,
  tables: ["orders", "products"],
  jwtSecret: process.env.JWT_SECRET,
});

livesql.attach(httpServer);

httpServer.listen(3000);
// REST API on http://localhost:3000/api/*
// WebSocket on ws://localhost:3000 (same port)
```

## Fastify

```typescript title="server.ts"
import Fastify from "fastify";
import { createLiveSQLServer, PostgresProvider } from "@livesql/server";

const fastify = Fastify();

// Your existing routes
fastify.get("/api/orders", async () => {
  return await db.query("SELECT * FROM orders");
});

const provider = new PostgresProvider({
  connectionString: process.env.DATABASE_URL!,
  tables: ["orders"],
});
await provider.connect();

const livesql = createLiveSQLServer(provider, {
  database: process.env.DATABASE_URL!,
  tables: ["orders"],
  jwtSecret: process.env.JWT_SECRET,
});

await fastify.listen({ port: 3000 });

// Attach to Fastify's underlying HTTP server
livesql.attach(fastify.server);
```

## Auth: Reusing Your Existing Middleware

LiveSQL doesn't replace your auth — it uses it. Pass a `jwtSecret` for simple JWT validation, or use `authenticate` for full control:

```typescript
const livesql = createLiveSQLServer(provider, {
  database: process.env.DATABASE_URL!,
  tables: ["orders"],

  // Option A: shared JWT secret (validates ?token=<jwt> or Authorization header)
  jwtSecret: process.env.JWT_SECRET,

  // Option B: custom auth function
  authenticate: async (req) => {
    const token = req.headers["authorization"]?.replace("Bearer ", "");
    if (!token) return null;
    const user = await verifyTokenWithYourAuthService(token);
    return user ? { id: user.id } : null;
  },

  // Per-table access control
  permissions: async (userId, table) => {
    return await db.userHasAccess(userId, table);
  },

  // Per-row access control (runs on every change event)
  rowPermission: (userId, table, row) => {
    return row["owner_id"] === userId;
  },
});
```

## Standalone Mode

If you prefer a dedicated port for WebSocket traffic (e.g., behind a separate load balancer):

```typescript
const livesql = createLiveSQLServer(provider, {
  database: process.env.DATABASE_URL!,
  tables: ["orders"],
  port: 3001, // WebSocket on its own port
});
// No attach() needed — starts automatically
```

## Client Connection

From the browser, connect to the same host:

```typescript
import { LiveSQLClient } from "@livesql/client";

const client = new LiveSQLClient("ws://localhost:3000", () => authToken);
client.connect();
client.subscribe("orders", (event) => {
  console.log(event.type, event.row);
});
```

## Next Steps

- [Running in Production](/guides/deployment) — PostgreSQL config, health checks, scaling
- [PostgREST + LiveSQL](/guides/postgrest) — full backend with zero server code
