import { describe, it, expect, vi, afterEach } from "vitest";
import http from "node:http";
import crypto from "node:crypto";
import WebSocket from "ws";
import { createLiveSQLServer } from "../server.js";
import type { ServerOptions } from "../server.js";
import type { ChangeEvent, ChangeProvider } from "@livesql/core";

/** Minimal HS256 JWT signer — avoids importing jsonwebtoken in tests */
function signJwt(payload: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

function makeMockProvider(): ChangeProvider {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
    getCurrentOffset: vi.fn().mockResolvedValue(BigInt(0)),
    replayFrom: vi.fn().mockReturnValue(
      (async function* () {
        // empty
      })(),
    ),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
}

describe("createLiveSQLServer", () => {
  it("returns a server object with attach and close methods", () => {
    const provider = makeMockProvider();
    const server = createLiveSQLServer(provider, {
      database: "postgresql://localhost/test",
      tables: ["orders"],
      // no port — avoids binding a real port in tests
    });

    expect(server).toHaveProperty("attach");
    expect(server).toHaveProperty("close");
    expect(typeof server.attach).toBe("function");
    expect(typeof server.close).toBe("function");
  });

  it("calls provider.disconnect on close", async () => {
    const provider = makeMockProvider();
    const server = createLiveSQLServer(provider, {
      database: "postgresql://localhost/test",
      tables: ["orders"],
    });

    await server.close();
    expect(provider.disconnect).toHaveBeenCalledOnce();
  });
});

describe("JWT authentication", () => {
  const JWT_SECRET = "test-secret";
  let httpServer: http.Server;
  let livesql: ReturnType<typeof createLiveSQLServer>;
  let port: number;

  afterEach(async () => {
    await livesql?.close();
    await new Promise<void>((resolve) => httpServer?.close(() => resolve()));
  });

  function setup() {
    const provider = makeMockProvider();
    httpServer = http.createServer();
    livesql = createLiveSQLServer(provider, {
      database: "postgresql://localhost/test",
      tables: ["orders"],
      jwtSecret: JWT_SECRET,
    });
    livesql.attach(httpServer);
    return new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        port = (httpServer.address() as { port: number }).port;
        resolve();
      });
    });
  }

  function connectWs(
    url: string,
    headers?: Record<string, string>,
  ): Promise<{ ws: WebSocket; code?: number }> {
    return new Promise((resolve) => {
      const ws = new WebSocket(url, { headers });
      ws.on("close", (code) => resolve({ ws, code }));
      // If the connection stays open for 200ms, consider it accepted
      ws.on("open", () => {
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) resolve({ ws });
        }, 200);
      });
    });
  }

  it("accepts a valid JWT from ?token= query parameter", async () => {
    await setup();
    const token = signJwt({ sub: "user-1" }, JWT_SECRET);
    const { ws, code } = await connectWs(`ws://localhost:${port}?token=${token}`);
    expect(code).toBeUndefined();
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("accepts a valid JWT from Authorization: Bearer header", async () => {
    await setup();
    const token = signJwt({ sub: "user-2" }, JWT_SECRET);
    const { ws, code } = await connectWs(`ws://localhost:${port}`, {
      Authorization: `Bearer ${token}`,
    });
    expect(code).toBeUndefined();
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("rejects connection with no token", async () => {
    await setup();
    const { code } = await connectWs(`ws://localhost:${port}`);
    expect(code).toBe(4001);
  });

  it("rejects connection with invalid token", async () => {
    await setup();
    const { code } = await connectWs(`ws://localhost:${port}?token=bad-token`);
    expect(code).toBe(4001);
  });
});

describe("Observability hooks", () => {
  let httpServer: http.Server;
  let livesql: ReturnType<typeof createLiveSQLServer>;
  let port: number;
  let subscribeCb: ((event: ChangeEvent) => void) | undefined;

  afterEach(async () => {
    subscribeCb = undefined;
    await livesql?.close();
    await new Promise<void>((resolve) => httpServer?.close(() => resolve()));
  });

  function setupWithHooks(hooks: Partial<ServerOptions>) {
    const provider: ChangeProvider = {
      connect: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockImplementation((_table: string, cb: (event: ChangeEvent) => void) => {
        subscribeCb = cb;
        return () => {};
      }),
      getCurrentOffset: vi.fn().mockResolvedValue(BigInt(0)),
      replayFrom: vi.fn().mockReturnValue((async function* () {})()),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    httpServer = http.createServer();
    livesql = createLiveSQLServer(provider, {
      database: "postgresql://localhost/test",
      tables: ["orders"],
      ...hooks,
    });
    livesql.attach(httpServer);
    return new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        port = (httpServer.address() as { port: number }).port;
        resolve();
      });
    });
  }

  function openWs(): Promise<WebSocket> {
    return new Promise((resolve) => {
      const ws = new WebSocket(`ws://localhost:${port}`);
      ws.on("open", () => resolve(ws));
    });
  }

  it("calls onClientConnect when a client connects", async () => {
    const onClientConnect = vi.fn();
    await setupWithHooks({ onClientConnect });
    const ws = await openWs();
    // Give the server a tick to process
    await new Promise((r) => setTimeout(r, 50));
    expect(onClientConnect).toHaveBeenCalledOnce();
    expect(onClientConnect).toHaveBeenCalledWith("anonymous", expect.stringContaining("client_"));
    ws.close();
  });

  it("calls onClientDisconnect when a client disconnects", async () => {
    const onClientDisconnect = vi.fn();
    await setupWithHooks({ onClientDisconnect });
    const ws = await openWs();
    await new Promise((r) => setTimeout(r, 50));
    ws.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(onClientDisconnect).toHaveBeenCalledOnce();
    expect(onClientDisconnect).toHaveBeenCalledWith(
      "anonymous",
      expect.stringContaining("client_"),
    );
  });

  it("calls onEvent when a change event is delivered", async () => {
    const onEvent = vi.fn();
    await setupWithHooks({ onEvent });
    const ws = await openWs();
    // Subscribe to orders
    ws.send(JSON.stringify({ type: "subscribe", table: "orders" }));
    await new Promise((r) => setTimeout(r, 50));

    // Simulate a CDC event
    const event: ChangeEvent = {
      id: "evt-1",
      lsn: "0/1",
      offset: BigInt(1),
      table: "orders",
      schema: "public",
      type: "insert",
      row: { id: 1, name: "test" },
      timestamp: new Date().toISOString(),
    };
    subscribeCb!(event);
    await new Promise((r) => setTimeout(r, 50));

    expect(onEvent).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenCalledWith(
      "anonymous",
      "orders",
      expect.objectContaining({ id: "evt-1" }),
    );
    ws.close();
  });
});
