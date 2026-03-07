/**
 * Phase 1 integration tests — PostgresProvider (WAL logical replication)
 *
 * Requires a running PostgreSQL instance with:
 *   - wal_level = logical
 *   - User with REPLICATION privilege
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
import { PostgresProvider } from "@livesql/server";
import { createLiveSQLServer } from "@livesql/server";
import type { SyncMessage, ErrorMessage } from "@livesql/core";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://livesql:test@localhost:5434/livesql_test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function waitForMessage(
  ws: WebSocket,
  predicate: (msg: SyncMessage | ErrorMessage) => boolean,
  timeoutMs = 5000,
): Promise<SyncMessage | ErrorMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for message")), timeoutMs);
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as SyncMessage | ErrorMessage;
      if (predicate(msg)) {
        clearTimeout(timer);
        resolve(msg);
      }
    });
  });
}

function waitForSync(ws: WebSocket, timeoutMs = 5000): Promise<SyncMessage> {
  return waitForMessage(ws, (m) => m.type === "sync", timeoutMs) as Promise<SyncMessage>;
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
let provider: PostgresProvider;
let httpServer: http.Server;
let serverPort: number;
let serverAvailable = false;

beforeAll(async () => {
  dbClient = new pg.Client({ connectionString: DATABASE_URL });
  try {
    await dbClient.connect();
  } catch {
    console.warn(`[wal-integration] Skipping — cannot connect to ${DATABASE_URL}`);
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

  // Drop any existing slot so we start clean
  await dbClient.query(
    `SELECT pg_drop_replication_slot('livesql_wal_test_slot')
     WHERE EXISTS (
       SELECT 1 FROM pg_replication_slots WHERE slot_name = 'livesql_wal_test_slot'
     )`,
  );

  // Drop any existing publication
  await dbClient.query(`DROP PUBLICATION IF EXISTS livesql_wal_test_pub`);

  provider = new PostgresProvider({
    connectionString: DATABASE_URL,
    tables: ["orders"],
    slotName: "livesql_wal_test_slot",
    publicationName: "livesql_wal_test_pub",
  });

  try {
    await provider.connect();
  } catch (err) {
    console.warn(`[wal-integration] Skipping — provider connect failed: ${String(err)}`);
    await dbClient.end();
    return;
  }

  httpServer = http.createServer();
  const livesql = createLiveSQLServer(provider, {
    database: DATABASE_URL,
    tables: ["orders"],
    allowedFilterColumns: { orders: ["status", "customer_name"] },
  });
  livesql.attach(httpServer);

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  serverPort = (httpServer.address() as { port: number }).port;
  serverAvailable = true;
}, 30_000);

afterAll(async () => {
  httpServer?.close();
  await provider?.disconnect();
  await dbClient?.end();
}, 15_000);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Phase 1 E2E — PostgresProvider (WAL)", () => {
  it("delivers an INSERT event via WAL replication", async () => {
    if (!serverAvailable) return;

    const ws = await connectWS(`ws://localhost:${serverPort}`);
    ws.send(JSON.stringify({ type: "subscribe", table: "orders" }));

    // Wait for the specific event by customer_name (earlier tests may produce
    // WAL events that get batched into the first sync message)
    const msgPromise = waitForMessage(
      ws,
      (m) =>
        m.type === "sync" && m.events.some((e) => e.row["customer_name"] === "WAL Insert Test"),
    ) as Promise<SyncMessage>;

    await dbClient.query("INSERT INTO orders (customer_name, status, total) VALUES ($1, $2, $3)", [
      "WAL Insert Test",
      "pending",
      29.99,
    ]);

    const msg = await msgPromise;
    ws.close();

    const evt = msg.events.find((e) => e.row["customer_name"] === "WAL Insert Test")!;
    expect(evt).toBeDefined();
    expect(evt.type).toBe("insert");
    expect(evt.table).toBe("orders");
    expect(evt.row["status"]).toBe("pending");
    expect(typeof evt.lsn).toBe("string");
    expect(evt.lsn).toMatch(/^[0-9A-F]+\/[0-9A-F]+$/);
    expect(typeof evt.offset).toBe("string"); // BigInt serialised as string
  });

  it("delivers an UPDATE event with old and new row data", async () => {
    if (!serverAvailable) return;

    const { rows } = await dbClient.query<{ id: string }>(
      "INSERT INTO orders (customer_name, status, total) VALUES ($1, $2, $3) RETURNING id",
      ["WAL Update Subject", "pending", 9.99],
    );
    const id = rows[0]!.id;

    const ws = await connectWS(`ws://localhost:${serverPort}`);
    ws.send(JSON.stringify({ type: "subscribe", table: "orders" }));

    const msgPromise = waitForMessage(
      ws,
      (m) =>
        m.type === "sync" &&
        m.events.some((e) => e.type === "update" && String(e.row["id"]) === String(id)),
    ) as Promise<SyncMessage>;

    await dbClient.query("UPDATE orders SET status = 'shipped' WHERE id = $1", [id]);

    const msg = await msgPromise;
    ws.close();

    const evt = msg.events.find((e) => e.type === "update" && String(e.row["id"]) === String(id))!;
    expect(evt).toBeDefined();
    expect(evt.type).toBe("update");
    expect(evt.row["status"]).toBe("shipped");
    // REPLICA IDENTITY FULL: old row is available
    expect(evt.oldRow?.["status"]).toBe("pending");
  });

  it("delivers a DELETE event with the deleted row", async () => {
    if (!serverAvailable) return;

    const { rows } = await dbClient.query<{ id: string }>(
      "INSERT INTO orders (customer_name, status, total) VALUES ($1, $2, $3) RETURNING id",
      ["WAL Delete Me", "pending", 1.0],
    );
    const id = rows[0]!.id;

    const ws = await connectWS(`ws://localhost:${serverPort}`);
    ws.send(JSON.stringify({ type: "subscribe", table: "orders" }));

    // Wait for the specific delete event (pgoutput returns all values as text)
    const msgPromise = waitForMessage(
      ws,
      (m) =>
        m.type === "sync" &&
        m.events.some((e) => e.type === "delete" && String(e.row["id"]) === String(id)),
    ) as Promise<SyncMessage>;

    await dbClient.query("DELETE FROM orders WHERE id = $1", [id]);

    const msg = await msgPromise;
    ws.close();

    const evt = msg.events.find((e) => e.type === "delete" && String(e.row["id"]) === String(id))!;
    expect(evt).toBeDefined();
    expect(evt.type).toBe("delete");
    expect(String(evt.row["id"])).toBe(String(id));
  });

  it("replays buffered events on reconnect with offset", async () => {
    if (!serverAvailable) return;

    // Subscribe and get the first event to establish an offset
    const ws1 = await connectWS(`ws://localhost:${serverPort}`);
    ws1.send(JSON.stringify({ type: "subscribe", table: "orders" }));

    const firstSync = waitForSync(ws1);
    await dbClient.query("INSERT INTO orders (customer_name, status, total) VALUES ($1, $2, $3)", [
      "Reconnect First",
      "pending",
      5.0,
    ]);
    const first = await firstSync;
    const lastOffset = first.events[0]!.offset;
    ws1.close();

    // Insert another event while "disconnected"
    await dbClient.query("INSERT INTO orders (customer_name, status, total) VALUES ($1, $2, $3)", [
      "Reconnect Second",
      "pending",
      6.0,
    ]);

    // Small delay to ensure the WAL event is processed by the provider
    await new Promise((r) => setTimeout(r, 200));

    // Reconnect with offset — server should replay the missed event
    const ws2 = await connectWS(`ws://localhost:${serverPort}`);
    ws2.send(JSON.stringify({ type: "subscribe", table: "orders", offset: lastOffset }));

    const replayMsg = waitForSync(ws2, 3000);

    // May need to wait for server to call replayFrom and send
    const msg = await replayMsg;
    ws2.close();

    const names = msg.events.map((e) => e.row["customer_name"]);
    expect(names).toContain("Reconnect Second");
  });

  it("rejects subscribe to a table not in the allowlist", async () => {
    if (!serverAvailable) return;

    const ws = await connectWS(`ws://localhost:${serverPort}`);
    const errorMsg = waitForMessage(ws, (m) => m.type === "error") as Promise<ErrorMessage>;
    ws.send(JSON.stringify({ type: "subscribe", table: "secrets" }));

    const err = await errorMsg;
    ws.close();

    expect(err.code).toBe("TABLE_NOT_FOUND");
  });

  it("rejects a subscribe with an invalid filter expression", async () => {
    if (!serverAvailable) return;

    const ws = await connectWS(`ws://localhost:${serverPort}`);
    const errorMsg = waitForMessage(ws, (m) => m.type === "error") as Promise<ErrorMessage>;
    ws.send(JSON.stringify({ type: "subscribe", table: "orders", filter: "DROP TABLE orders" }));

    const err = await errorMsg;
    ws.close();

    expect(err.code).toBe("INVALID_FILTER");
  });

  it("rejects a subscribe when the permissions callback denies access", async () => {
    if (!serverAvailable) return;

    // Spin up a temporary server with a blanket-deny permissions callback.
    // We reuse the existing provider (no new DB connection needed).
    const restrictedHttp = http.createServer();
    const restrictedLivesql = createLiveSQLServer(provider, {
      database: DATABASE_URL,
      tables: ["orders"],
      permissions: async (_userId, _table) => false,
    });
    restrictedLivesql.attach(restrictedHttp);
    await new Promise<void>((resolve) => restrictedHttp.listen(0, resolve));
    const restrictedPort = (restrictedHttp.address() as { port: number }).port;

    try {
      const ws = await connectWS(`ws://localhost:${restrictedPort}`);
      const errorMsg = waitForMessage(ws, (m) => m.type === "error") as Promise<ErrorMessage>;
      ws.send(JSON.stringify({ type: "subscribe", table: "orders" }));

      const err = await errorMsg;
      ws.close();

      expect(err.code).toBe("FORBIDDEN");
    } finally {
      await new Promise<void>((resolve) => restrictedHttp.close(() => resolve()));
    }
  });

  it("stops delivering WAL events after unsubscribe", async () => {
    if (!serverAvailable) return;

    const ws = await connectWS(`ws://localhost:${serverPort}`);
    ws.send(JSON.stringify({ type: "subscribe", table: "orders" }));

    // Confirm subscription is active with a first insert
    const firstSync = waitForSync(ws);
    await dbClient.query("INSERT INTO orders (customer_name, status, total) VALUES ($1, $2, $3)", [
      "Before Unsub WAL",
      "pending",
      1.0,
    ]);
    await firstSync;

    // Unsubscribe
    ws.send(JSON.stringify({ type: "unsubscribe", table: "orders" }));

    // Any message arriving after this point is unexpected
    let unexpectedMessage = false;
    ws.on("message", () => {
      unexpectedMessage = true;
    });

    await dbClient.query("INSERT INTO orders (customer_name, status, total) VALUES ($1, $2, $3)", [
      "After Unsub WAL",
      "pending",
      2.0,
    ]);

    // Brief wait to give any erroneous message a chance to arrive
    await new Promise((r) => setTimeout(r, 300));
    ws.close();

    expect(unexpectedMessage).toBe(false);
  });

  it("delivers only matching rows when a filter is applied", async () => {
    if (!serverAvailable) return;

    const ws = await connectWS(`ws://localhost:${serverPort}`);
    ws.send(JSON.stringify({ type: "subscribe", table: "orders", filter: "status = shipped" }));

    // Allow subscription to be registered
    await new Promise((r) => setTimeout(r, 100));

    let nonMatchingReceived = false;
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as SyncMessage;
      if (msg.type === "sync") {
        for (const evt of msg.events) {
          if (evt.row["status"] !== "shipped") {
            nonMatchingReceived = true;
          }
        }
      }
    });

    // Insert a non-matching row (should NOT arrive)
    await dbClient.query("INSERT INTO orders (customer_name, status, total) VALUES ($1, $2, $3)", [
      "Filter Skip",
      "pending",
      1.0,
    ]);

    // Insert a matching row (SHOULD arrive)
    const matchPromise = waitForSync(ws, 3000);
    await dbClient.query("INSERT INTO orders (customer_name, status, total) VALUES ($1, $2, $3)", [
      "Filter Match",
      "shipped",
      2.0,
    ]);

    const matchMsg = await matchPromise;
    ws.close();

    expect(nonMatchingReceived).toBe(false);
    expect(matchMsg.events.some((e) => e.row["status"] === "shipped")).toBe(true);
  });
}, 60_000);
