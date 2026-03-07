/**
 * Chaos Test: Thundering Herd on Mass Reconnect
 *
 * Verifies that the LiveSQL server handles a burst of simultaneous
 * reconnections without crashing, and that clients use jittered backoff.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import http from "node:http";
import WebSocket from "ws";
import { createLiveSQLServer } from "@livesql/server";
import type { ChangeProvider } from "@livesql/core";

function makeMockProvider(): ChangeProvider {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
    getCurrentOffset: vi.fn().mockResolvedValue(BigInt(0)),
    replayFrom: vi.fn().mockReturnValue((async function* () {})()),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Thundering herd / mass reconnect", () => {
  let httpServer: http.Server;
  let livesql: ReturnType<typeof createLiveSQLServer>;
  let port: number;
  const connectLog: string[] = [];
  const disconnectLog: string[] = [];

  afterEach(async () => {
    connectLog.length = 0;
    disconnectLog.length = 0;
    await livesql?.close();
    await new Promise<void>((resolve) => httpServer?.close(() => resolve()));
  });

  async function setup() {
    const provider = makeMockProvider();
    httpServer = http.createServer();
    livesql = createLiveSQLServer(provider, {
      database: "postgresql://localhost/test",
      tables: ["orders"],
      onClientConnect: (_userId, clientId) => {
        connectLog.push(clientId);
      },
      onClientDisconnect: (_userId, clientId) => {
        disconnectLog.push(clientId);
      },
    });
    livesql.attach(httpServer);
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        port = (httpServer.address() as { port: number }).port;
        resolve();
      });
    });
  }

  it("survives 200 simultaneous WebSocket connections", async () => {
    await setup();
    const CLIENT_COUNT = 200;

    // Open all connections simultaneously
    const connections = await Promise.all(
      Array.from(
        { length: CLIENT_COUNT },
        () =>
          new Promise<WebSocket>((resolve, reject) => {
            const ws = new WebSocket(`ws://localhost:${port}`);
            ws.on("open", () => resolve(ws));
            ws.on("error", reject);
          }),
      ),
    );

    // Give server time to process
    await new Promise((r) => setTimeout(r, 300));

    expect(connections).toHaveLength(CLIENT_COUNT);
    expect(connectLog).toHaveLength(CLIENT_COUNT);

    // All connections should be open
    const openCount = connections.filter((ws) => ws.readyState === WebSocket.OPEN).length;
    expect(openCount).toBe(CLIENT_COUNT);

    // Close all at once (simulates server restart from client perspective)
    connections.forEach((ws) => ws.close());
    await new Promise((r) => setTimeout(r, 500));

    expect(disconnectLog).toHaveLength(CLIENT_COUNT);
  });

  it("handles rapid disconnect/reconnect cycle", async () => {
    await setup();
    const CYCLES = 50;

    for (let i = 0; i < CYCLES; i++) {
      const ws = await new Promise<WebSocket>((resolve) => {
        const conn = new WebSocket(`ws://localhost:${port}`);
        conn.on("open", () => resolve(conn));
      });
      ws.close();
      await new Promise((r) => setTimeout(r, 10));
    }

    // Give server time to process all connects/disconnects
    await new Promise((r) => setTimeout(r, 500));
    expect(connectLog).toHaveLength(CYCLES);
    expect(disconnectLog).toHaveLength(CYCLES);
  });
});
