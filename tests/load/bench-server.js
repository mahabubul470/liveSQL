/**
 * Benchmark server for k6 load testing.
 *
 * Starts a LiveSQL server with PostgresProvider on port 3002.
 * Also exposes POST /insert to trigger DB writes from k6.
 *
 * Usage:
 *   node tests/load/bench-server.js
 */

import http from "node:http";
import pg from "pg";
import { createLiveSQLServer, PostgresProvider } from "@livesql/server";

const DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://livesql:test@localhost:5434/livesql_test";
const PORT = 3002;

const pool = new pg.Pool({ connectionString: DATABASE_URL });

// Ensure clean state
await pool.query("DELETE FROM orders");

// CDC provider (WAL-based)
const provider = new PostgresProvider({
  connectionString: DATABASE_URL,
  tables: ["orders"],
  slotName: "livesql_bench_" + Math.random().toString(36).slice(2, 8),
});

const livesql = createLiveSQLServer(provider, {
  database: DATABASE_URL,
  tables: ["orders"],
  // No auth for benchmark — simplifies k6 script
});

await provider.connect();

// HTTP server — POST /insert triggers a DB write
const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/insert") {
    try {
      const name = `user_${Date.now()}`;
      await pool.query(
        "INSERT INTO orders (customer_name, status, total) VALUES ($1, 'pending', 9.99)",
        [name],
      );
      res.writeHead(200);
      res.end("ok");
    } catch (err) {
      res.writeHead(500);
      res.end(String(err));
    }
    return;
  }
  res.writeHead(404);
  res.end();
});

livesql.attach(server);

server.listen(PORT, () => {
  console.log(`Bench server ready on :${PORT}`);
  console.log(`WebSocket: ws://localhost:${PORT}`);
  console.log(`Insert:    POST http://localhost:${PORT}/insert`);
});

process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  await livesql.close();
  await pool.end();
  server.close();
  process.exit(0);
});
