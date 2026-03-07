/**
 * Phase 0 integration tests — ListenNotifyProvider + WebSocket server
 *
 * Requires a running PostgreSQL instance. Set DATABASE_URL or rely on the
 * default (docker-compose.test.yml spins up postgres on port 5434).
 *
 * Run with:
 *   pnpm --filter integration test
 *
 * Skip automatically when the database is unreachable.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import http from "node:http";
import { WebSocket } from "ws";
import { ListenNotifyProvider } from "@livesql/server";
import { createLiveSQLServer } from "@livesql/server";
import type { SyncMessage } from "@livesql/core";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://livesql:test@localhost:5434/livesql_test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function waitForMessage(ws: WebSocket, timeoutMs = 3000): Promise<SyncMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timeout waiting for sync message")),
      timeoutMs,
    );
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as { type: string };
      if (msg.type === "sync") {
        clearTimeout(timer);
        resolve(msg as SyncMessage);
      }
    });
  });
}

function connectWS(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

let dbClient: pg.Client;
let provider: ListenNotifyProvider;
let httpServer: http.Server;
let serverPort: number;

beforeAll(async () => {
  // Check DB connectivity — skip suite if unreachable
  dbClient = new pg.Client({ connectionString: DATABASE_URL });
  try {
    await dbClient.connect();
  } catch {
    // vitest doesn't have a native suite-level skip, so we mark tests pending
    console.warn(`[integration] Skipping — cannot connect to ${DATABASE_URL}`);
    return;
  }

  // Ensure the orders table exists
  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      total NUMERIC(10,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Start the LiveSQL server on a random port
  provider = new ListenNotifyProvider({ connectionString: DATABASE_URL, tables: ["orders"] });
  await provider.connect();

  httpServer = http.createServer();
  const livesql = createLiveSQLServer(provider, { database: DATABASE_URL, tables: ["orders"] });
  livesql.attach(httpServer);

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  serverPort = (httpServer.address() as { port: number }).port;
});

afterAll(async () => {
  httpServer?.close();
  await provider?.disconnect();
  await dbClient?.end();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Phase 0 E2E — ListenNotifyProvider", () => {
  it("delivers an INSERT event to a subscribed client", async () => {
    if (!serverPort) return; // DB unavailable

    const ws = await connectWS(`ws://localhost:${serverPort}`);
    ws.send(JSON.stringify({ type: "subscribe", table: "orders" }));

    const msgPromise = waitForMessage(ws);

    await dbClient.query("INSERT INTO orders (customer_name, status, total) VALUES ($1, $2, $3)", [
      "Integration Test",
      "pending",
      19.99,
    ]);

    const msg = await msgPromise;
    ws.close();

    expect(msg.events).toHaveLength(1);
    const evt = msg.events[0]!;
    expect(evt.type).toBe("insert");
    expect(evt.table).toBe("orders");
    expect(evt.row["customer_name"]).toBe("Integration Test");
    expect(evt.row["status"]).toBe("pending");
    expect(typeof evt.offset).toBe("string"); // BigInt serialised as string over JSON
  });

  it("delivers an UPDATE event with old and new row data", async () => {
    if (!serverPort) return;

    // Insert a row to update
    const { rows } = await dbClient.query<{ id: string }>(
      "INSERT INTO orders (customer_name, status, total) VALUES ($1, $2, $3) RETURNING id",
      ["Update Subject", "pending", 5.0],
    );
    const id = rows[0]!.id;

    const ws = await connectWS(`ws://localhost:${serverPort}`);
    ws.send(JSON.stringify({ type: "subscribe", table: "orders" }));

    const msgPromise = waitForMessage(ws);

    await dbClient.query("UPDATE orders SET status = 'shipped' WHERE id = $1", [id]);

    const msg = await msgPromise;
    ws.close();

    expect(msg.events).toHaveLength(1);
    const evt = msg.events[0]!;
    expect(evt.type).toBe("update");
    expect(evt.row["status"]).toBe("shipped");
    // oldRow is present because the trigger captures OLD
    expect(evt.oldRow?.["status"]).toBe("pending");
  });

  it("delivers a DELETE event", async () => {
    if (!serverPort) return;

    const { rows } = await dbClient.query<{ id: string }>(
      "INSERT INTO orders (customer_name, status, total) VALUES ($1, $2, $3) RETURNING id",
      ["Delete Me", "pending", 1.0],
    );
    const id = rows[0]!.id;

    const ws = await connectWS(`ws://localhost:${serverPort}`);
    ws.send(JSON.stringify({ type: "subscribe", table: "orders" }));

    // Wait for a sync containing our specific delete event (previous tests
    // may produce events that get batched into the same message)
    const msgPromise = new Promise<SyncMessage>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout waiting for delete")), 5000);
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString()) as SyncMessage;
        if (
          msg.type === "sync" &&
          msg.events.some((e) => e.type === "delete" && String(e.row["id"]) === String(id))
        ) {
          clearTimeout(timer);
          resolve(msg);
        }
      });
    });

    await dbClient.query("DELETE FROM orders WHERE id = $1", [id]);

    const msg = await msgPromise;
    ws.close();

    const evt = msg.events.find((e) => e.type === "delete" && String(e.row["id"]) === String(id))!;
    expect(evt).toBeDefined();
    expect(evt.type).toBe("delete");
    expect(String(evt.row["id"])).toBe(String(id));
  });

  it("stops delivering events after unsubscribe", async () => {
    if (!serverPort) return;

    const ws = await connectWS(`ws://localhost:${serverPort}`);
    ws.send(JSON.stringify({ type: "subscribe", table: "orders" }));

    // Confirm subscription is active with a first insert
    const firstInsertPromise = waitForMessage(ws);
    await dbClient.query("INSERT INTO orders (customer_name, status, total) VALUES ($1, $2, $3)", [
      "Before Unsub",
      "pending",
      1.0,
    ]);
    await firstInsertPromise;

    // Now unsubscribe
    ws.send(JSON.stringify({ type: "unsubscribe", table: "orders" }));

    // Insert again — we should NOT receive this event
    let unexpectedMessage = false;
    ws.on("message", () => {
      unexpectedMessage = true;
    });

    await dbClient.query("INSERT INTO orders (customer_name, status, total) VALUES ($1, $2, $3)", [
      "After Unsub",
      "pending",
      2.0,
    ]);

    // Wait briefly to give any erroneous message a chance to arrive
    await new Promise((r) => setTimeout(r, 300));
    ws.close();

    expect(unexpectedMessage).toBe(false);
  });
});
