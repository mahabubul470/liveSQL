/**
 * Chaos Test: Network Partition (simulated)
 *
 * Simulates a network partition by forcibly closing the WebSocket connection
 * mid-stream and verifying the client reconnects and resumes from its last offset.
 *
 * Note: A full Toxiproxy-based test would inject latency and packet loss at the
 * TCP level. This test simulates the observable effect (sudden disconnect) without
 * requiring Toxiproxy infrastructure.
 *
 * Requires Docker PostgreSQL on port 5434.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import http from "node:http";
import pg from "pg";
import WebSocket from "ws";
import { createLiveSQLServer, PostgresProvider } from "@livesql/server";
import type { ChangeEvent } from "@livesql/core";

const DATABASE_URL = "postgresql://livesql:test@localhost:5434/livesql_test";

let pool: pg.Pool;
let canConnect = false;

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: DATABASE_URL });
  try {
    await pool.query("SELECT 1");
    canConnect = true;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chaos_partition (
        id SERIAL PRIMARY KEY,
        value TEXT NOT NULL
      );
      ALTER TABLE chaos_partition REPLICA IDENTITY FULL;
      DELETE FROM chaos_partition;
    `);
  } catch {
    console.warn("[chaos/network-partition] Skipping — cannot connect to PostgreSQL");
  }
});

afterAll(async () => {
  if (canConnect) {
    await pool.query("DROP TABLE IF EXISTS chaos_partition");
  }
  await pool.end();
});

describe("Network partition (simulated disconnect)", () => {
  let httpServer: http.Server;
  let livesql: ReturnType<typeof createLiveSQLServer>;
  let provider: InstanceType<typeof PostgresProvider>;
  let port: number;

  afterEach(async () => {
    await livesql?.close();
    await new Promise<void>((resolve) => httpServer?.close(() => resolve()));
  });

  async function setup() {
    const suffix = Math.random().toString(36).slice(2, 8);
    const slotName = "chaos_partition_" + suffix;
    provider = new PostgresProvider({
      connectionString: DATABASE_URL,
      tables: ["chaos_partition"],
      slotName,
      publicationName: "chaos_partition_pub_" + suffix,
    });
    await provider.connect();

    httpServer = http.createServer();
    livesql = createLiveSQLServer(provider, {
      database: DATABASE_URL,
      tables: ["chaos_partition"],
    });
    livesql.attach(httpServer);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        port = (httpServer.address() as { port: number }).port;
        resolve();
      });
    });
  }

  it("client receives events, survives forced disconnect, and reconnects", async () => {
    if (!canConnect) return;
    {
      await setup();
      const received: ChangeEvent[] = [];

      // Connect first client
      const ws1 = await new Promise<WebSocket>((resolve) => {
        const ws = new WebSocket(`ws://localhost:${port}`);
        ws.on("open", () => resolve(ws));
      });

      ws1.send(JSON.stringify({ type: "subscribe", table: "chaos_partition" }));

      ws1.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "sync") {
          received.push(...msg.events);
        }
      });

      // WAL replication needs time to establish the stream
      await new Promise((r) => setTimeout(r, 1500));

      // Insert a row — should be received
      await pool.query("INSERT INTO chaos_partition (value) VALUES ('before-disconnect')");
      await new Promise((r) => setTimeout(r, 2000));

      const beforeCount = received.length;
      expect(beforeCount).toBeGreaterThanOrEqual(1);

      // Simulate network partition — forcibly terminate the connection
      ws1.terminate();

      // Insert during "partition" — client is disconnected
      await pool.query("INSERT INTO chaos_partition (value) VALUES ('during-disconnect')");
      await new Promise((r) => setTimeout(r, 500));

      // Reconnect — new client connects and subscribes
      const ws2 = await new Promise<WebSocket>((resolve) => {
        const ws = new WebSocket(`ws://localhost:${port}`);
        ws.on("open", () => resolve(ws));
      });

      const reconnectReceived: ChangeEvent[] = [];
      ws2.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "sync") {
          reconnectReceived.push(...msg.events);
        }
      });

      // Subscribe with offset to replay missed events
      const lastOffset = received.length > 0 ? received[received.length - 1]!.offset : "0";
      ws2.send(
        JSON.stringify({
          type: "subscribe",
          table: "chaos_partition",
          offset: lastOffset.toString(),
        }),
      );

      await new Promise((r) => setTimeout(r, 1000));

      // Should have received the event that happened during disconnect
      const allValues = reconnectReceived.map((e) => e.row.value);
      expect(allValues).toContain("during-disconnect");

      ws2.close();
    }
  });
});
