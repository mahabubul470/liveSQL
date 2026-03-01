import { describe, it, expect, vi } from "vitest";
import { createLiveSQLServer } from "../server.js";
import type { ChangeProvider } from "@livesql/core";

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
