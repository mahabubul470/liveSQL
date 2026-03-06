import { describe, it, expect, vi, afterEach } from "vitest";
import http from "node:http";
import crypto from "node:crypto";
import WebSocket from "ws";
import { createLiveSQLServer } from "../server.js";
import type { ChangeProvider } from "@livesql/core";

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
