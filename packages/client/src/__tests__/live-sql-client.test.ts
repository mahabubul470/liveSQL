import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LiveSQLClient } from "../live-sql-client.js";

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;

  readyState: number = MockWebSocket.OPEN;
  url: string;

  onmessage: ((e: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  readonly sent: string[] = [];
  closeCode: number | undefined;
  closeReason: string | undefined;

  constructor(url: string) {
    this.url = url;
    // Fire onopen after current call stack clears, simulating async connection
    queueMicrotask(() => {
      if (this.onopen) this.onopen();
    });
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closeCode = code;
    this.closeReason = reason;
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose();
  }

  /** Test helper: simulate an incoming message */
  receive(payload: unknown): void {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(payload) });
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let instances: MockWebSocket[];

beforeEach(() => {
  instances = [];
  const Tracked = class extends MockWebSocket {
    constructor(url: string) {
      super(url);
      instances.push(this);
    }
  };
  // Attach instances list so lastSocket() can access it
  (MockWebSocket as unknown as { instances: MockWebSocket[] }).instances = instances;
  vi.stubGlobal("WebSocket", Tracked);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LiveSQLClient — connection", () => {
  it("opens a WebSocket with the token appended", async () => {
    const client = new LiveSQLClient("ws://localhost:3000", () => "tok123");
    client.connect();
    await flushMicrotasks();

    expect(instances).toHaveLength(1);
    expect(instances[0]!.url).toBe("ws://localhost:3000?token=tok123");
  });

  it("appends token with & when URL already has query params", async () => {
    const client = new LiveSQLClient("ws://localhost:3000?foo=bar", () => "tok456");
    client.connect();
    await flushMicrotasks();

    expect(instances[0]!.url).toBe("ws://localhost:3000?foo=bar&token=tok456");
  });

  it("reports connected=true after socket opens", async () => {
    const client = new LiveSQLClient("ws://localhost:3000", () => "t");
    client.connect();
    await flushMicrotasks(); // fires onopen

    expect(client.connected).toBe(true);
  });
});

describe("LiveSQLClient — subscribe", () => {
  it("sends a subscribe message when socket is open", async () => {
    const client = new LiveSQLClient("ws://localhost:3000", () => "t");
    client.connect();
    await flushMicrotasks();

    client.subscribe("orders", vi.fn());
    const socket = instances[0]!;
    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0]!)).toMatchObject({
      type: "subscribe",
      table: "orders",
    });
  });

  it("re-subscribes on reconnect with the latest offset", async () => {
    const client = new LiveSQLClient("ws://localhost:3000", () => "t");
    client.connect();
    await flushMicrotasks();

    client.subscribe("orders", vi.fn());

    // Simulate receiving an event to advance offset
    instances[0]!.receive({
      type: "sync",
      events: [
        {
          id: "a",
          lsn: "0/1",
          offset: "7",
          table: "orders",
          schema: "public",
          type: "insert",
          row: { id: 1 },
          timestamp: "2026-03-01T00:00:00.000Z",
        },
      ],
    });

    // Simulate disconnect → reconnect
    instances[0]!.close();
    vi.runAllTimers(); // advance reconnect backoff
    await flushMicrotasks(); // open new socket + onopen

    const socket2 = instances[1]!;
    // Should re-subscribe with offset=7
    const resubMsg = JSON.parse(socket2.sent[0]!);
    expect(resubMsg.type).toBe("subscribe");
    expect(resubMsg.table).toBe("orders");
    expect(resubMsg.offset).toBe("7");
  });

  it("dispatches sync events to the matching callback", async () => {
    const client = new LiveSQLClient("ws://localhost:3000", () => "t");
    client.connect();
    await flushMicrotasks();

    const cb = vi.fn();
    client.subscribe("orders", cb);

    instances[0]!.receive({
      type: "sync",
      events: [
        {
          id: "b",
          lsn: "0/2",
          offset: "1",
          table: "orders",
          schema: "public",
          type: "insert",
          row: { id: 2, status: "pending" },
          timestamp: "2026-03-01T00:00:00.000Z",
        },
      ],
    });

    expect(cb).toHaveBeenCalledOnce();
    expect(cb.mock.calls[0][0]).toMatchObject({ type: "insert", table: "orders" });
  });

  it("does not dispatch events for a different table", async () => {
    const client = new LiveSQLClient("ws://localhost:3000", () => "t");
    client.connect();
    await flushMicrotasks();

    const cb = vi.fn();
    client.subscribe("orders", cb);

    instances[0]!.receive({
      type: "sync",
      events: [
        {
          id: "c",
          lsn: "0/3",
          offset: "2",
          table: "users",
          schema: "public",
          type: "insert",
          row: { id: 5 },
          timestamp: "2026-03-01T00:00:00.000Z",
        },
      ],
    });

    expect(cb).not.toHaveBeenCalled();
  });

  it("updates currentOffset on received events", async () => {
    const client = new LiveSQLClient("ws://localhost:3000", () => "t");
    client.connect();
    await flushMicrotasks();

    client.subscribe("orders", vi.fn());
    expect(client.currentOffset).toBe(BigInt(0));

    instances[0]!.receive({
      type: "sync",
      events: [
        {
          id: "d",
          lsn: "0/4",
          offset: "99",
          table: "orders",
          schema: "public",
          type: "update",
          row: { id: 1 },
          timestamp: "2026-03-01T00:00:00.000Z",
        },
      ],
    });

    expect(client.currentOffset).toBe(BigInt(99));
  });
});

describe("LiveSQLClient — unsubscribe", () => {
  it("sends an unsubscribe message when the last callback is removed", async () => {
    const client = new LiveSQLClient("ws://localhost:3000", () => "t");
    client.connect();
    await flushMicrotasks();

    const unsub = client.subscribe("orders", vi.fn());
    const socket = instances[0]!;
    expect(socket.sent).toHaveLength(1); // subscribe sent

    unsub();
    expect(socket.sent).toHaveLength(2);
    expect(JSON.parse(socket.sent[1]!)).toMatchObject({
      type: "unsubscribe",
      table: "orders",
    });
  });

  it("does not send unsubscribe until all callbacks are removed", async () => {
    const client = new LiveSQLClient("ws://localhost:3000", () => "t");
    client.connect();
    await flushMicrotasks();

    const unsub1 = client.subscribe("orders", vi.fn());
    const unsub2 = client.subscribe("orders", vi.fn());
    const socket = instances[0]!;

    unsub1(); // one callback left — no unsubscribe yet
    expect(socket.sent).toHaveLength(1); // only the initial subscribe

    unsub2(); // last callback removed — now unsubscribe
    expect(socket.sent).toHaveLength(2);
    expect(JSON.parse(socket.sent[1]!)).toMatchObject({ type: "unsubscribe" });
  });
});

describe("LiveSQLClient — disconnect", () => {
  it("closes the socket with code 1000", async () => {
    const client = new LiveSQLClient("ws://localhost:3000", () => "t");
    client.connect();
    await flushMicrotasks();

    client.disconnect();
    expect(instances[0]!.closeCode).toBe(1000);
  });

  it("does not reconnect after explicit disconnect", async () => {
    const client = new LiveSQLClient("ws://localhost:3000", () => "t");
    client.connect();
    await flushMicrotasks();

    client.disconnect();
    vi.runAllTimers();
    await flushMicrotasks();

    // Only one socket ever created
    expect(instances).toHaveLength(1);
  });
});

describe("LiveSQLClient — reconnection", () => {
  it("reconnects automatically on unexpected close", async () => {
    const client = new LiveSQLClient("ws://localhost:3000", () => "t");
    client.connect();
    await flushMicrotasks();

    instances[0]!.close(); // unexpected close
    vi.runAllTimers();
    await flushMicrotasks();

    expect(instances).toHaveLength(2);
  });
});
