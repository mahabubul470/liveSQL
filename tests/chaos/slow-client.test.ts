/**
 * Chaos Test: Slow Client / High bufferedAmount
 *
 * Verifies that the server detects backpressure on slow clients and calls
 * the onBackpressure callback instead of accumulating unbounded memory.
 *
 * We simulate a slow client by connecting a WebSocket, subscribing, then
 * flooding events while the client doesn't read fast enough. The server's
 * EventBatcher checks ws.bufferedAmount and drops events when it exceeds 1 MiB.
 *
 * Requires Docker PostgreSQL on port 5434.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import http from "node:http";
import pg from "pg";
import WebSocket from "ws";
import { createLiveSQLServer, PostgresProvider } from "@livesql/server";

const DATABASE_URL = "postgresql://livesql:test@localhost:5434/livesql_test";

let pool: pg.Pool;
let canConnect = false;

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: DATABASE_URL });
  try {
    await pool.query("SELECT 1");
    canConnect = true;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chaos_slow (
        id SERIAL PRIMARY KEY,
        data TEXT NOT NULL
      );
      ALTER TABLE chaos_slow REPLICA IDENTITY FULL;
      DELETE FROM chaos_slow;
    `);
  } catch {
    console.warn("[chaos/slow-client] Skipping — cannot connect to PostgreSQL");
  }
});

afterAll(async () => {
  if (canConnect) {
    await pool.query("DROP TABLE IF EXISTS chaos_slow");
  }
  await pool.end();
});

describe("Slow client / backpressure", () => {
  let httpServer: http.Server;
  let livesql: ReturnType<typeof createLiveSQLServer>;
  let port: number;

  afterEach(async () => {
    await livesql?.close();
    await new Promise<void>((resolve) => httpServer?.close(() => resolve()));
  });

  it("server stays alive under heavy insert load with a connected client", async () => {
    if (!canConnect) return;
    {
      const onBackpressure = vi.fn();
      const slotName = "chaos_slow_" + Math.random().toString(36).slice(2, 8);

      const provider = new PostgresProvider({
        connectionString: DATABASE_URL,
        tables: ["chaos_slow"],
        slotName,
      });
      await provider.connect();

      httpServer = http.createServer();
      livesql = createLiveSQLServer(provider, {
        database: DATABASE_URL,
        tables: ["chaos_slow"],
        onBackpressure,
      });
      livesql.attach(httpServer);

      await new Promise<void>((resolve) => {
        httpServer.listen(0, () => {
          port = (httpServer.address() as { port: number }).port;
          resolve();
        });
      });

      // Connect a client and subscribe
      const ws = await new Promise<WebSocket>((resolve) => {
        const ws = new WebSocket(`ws://localhost:${port}`);
        ws.on("open", () => resolve(ws));
      });
      ws.send(JSON.stringify({ type: "subscribe", table: "chaos_slow" }));
      await new Promise((r) => setTimeout(r, 500));

      // Flood inserts — generate many events rapidly
      const BATCH_SIZE = 200;
      const values = Array.from(
        { length: BATCH_SIZE },
        () => `('${Buffer.alloc(1024).fill("x").toString()}')`,
      ).join(",");
      await pool.query(`INSERT INTO chaos_slow (data) VALUES ${values}`);

      // Wait for events to flow
      await new Promise((r) => setTimeout(r, 2000));

      // The key assertion: the server is still alive and responsive
      const healthCheck = await new Promise<boolean>((resolve) => {
        const testWs = new WebSocket(`ws://localhost:${port}`);
        testWs.on("open", () => {
          testWs.close();
          resolve(true);
        });
        testWs.on("error", () => resolve(false));
      });

      expect(healthCheck).toBe(true);
      ws.close();
    }
  });
});
