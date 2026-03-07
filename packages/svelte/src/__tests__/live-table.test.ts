import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";
import type { ChangeEvent } from "@livesql/core";
import type { LiveSQLClient } from "@livesql/client";
import { liveTable } from "../live-table.js";

// ---------------------------------------------------------------------------
// Mock client factory
// ---------------------------------------------------------------------------

type EventCb = (e: ChangeEvent) => void;
type ErrorCb = (err: { code: string; message: string }) => void;

function makeMockClient() {
  let onEvent: EventCb | null = null;
  let onError: ErrorCb | null = null;
  const unsubscribe = vi.fn();

  return {
    subscribe: vi.fn((_table: string, cb: EventCb, errCb?: ErrorCb, _filter?: string) => {
      onEvent = cb;
      onError = errCb ?? null;
      return unsubscribe;
    }),
    sendEvent(e: ChangeEvent): void {
      onEvent?.(e);
    },
    sendError(err: { code: string; message: string }): void {
      onError?.(err);
    },
    unsubscribe,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE = {
  id: "evt-1",
  lsn: "0/1",
  offset: BigInt(1),
  schema: "public",
  table: "orders",
  timestamp: "2026-03-01T00:00:00Z",
} as const;

function ins(row: Record<string, unknown>): ChangeEvent {
  return { ...BASE, type: "insert", row };
}
function upd(row: Record<string, unknown>): ChangeEvent {
  return { ...BASE, type: "update", row };
}
function del(row: Record<string, unknown>): ChangeEvent {
  return { ...BASE, type: "delete", row };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("liveTable (Svelte store)", () => {
  let mockClient: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    mockClient = makeMockClient();
  });

  it("starts with empty Map", () => {
    const store = liveTable(mockClient as unknown as LiveSQLClient, "orders");
    const unsub = store.subscribe(() => {});

    const state = get(store);
    expect(state.data).toBeInstanceOf(Map);
    expect(state.data.size).toBe(0);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();

    unsub();
  });

  it("calls client.subscribe with the table name on first subscriber", () => {
    const store = liveTable(mockClient as unknown as LiveSQLClient, "orders");

    expect(mockClient.subscribe).not.toHaveBeenCalled();

    const unsub = store.subscribe(() => {});
    expect(mockClient.subscribe).toHaveBeenCalledOnce();
    expect(mockClient.subscribe.mock.calls[0]?.[0]).toBe("orders");

    unsub();
  });

  it("passes filter to client.subscribe", () => {
    const store = liveTable(mockClient as unknown as LiveSQLClient, "orders", {
      filter: "status = pending",
    });
    const unsub = store.subscribe(() => {});

    expect(mockClient.subscribe.mock.calls[0]?.[3]).toBe("status = pending");

    unsub();
  });

  it("adds row to Map on insert event", () => {
    const store = liveTable(mockClient as unknown as LiveSQLClient, "orders");
    const unsub = store.subscribe(() => {});

    mockClient.sendEvent(ins({ id: "1", status: "pending" }));

    const state = get(store);
    expect(state.data.size).toBe(1);
    expect(state.data.get("1")).toEqual({ id: "1", status: "pending" });

    unsub();
  });

  it("replaces row on update event", () => {
    const store = liveTable(mockClient as unknown as LiveSQLClient, "orders");
    const unsub = store.subscribe(() => {});

    mockClient.sendEvent(ins({ id: "1", status: "pending" }));
    mockClient.sendEvent(upd({ id: "1", status: "shipped" }));

    expect(get(store).data.get("1")).toEqual({ id: "1", status: "shipped" });

    unsub();
  });

  it("removes row on delete event", () => {
    const store = liveTable(mockClient as unknown as LiveSQLClient, "orders");
    const unsub = store.subscribe(() => {});

    mockClient.sendEvent(ins({ id: "1" }));
    mockClient.sendEvent(del({ id: "1" }));

    expect(get(store).data.size).toBe(0);

    unsub();
  });

  it("uses custom key field", () => {
    const store = liveTable(mockClient as unknown as LiveSQLClient, "products", { key: "sku" });
    const unsub = store.subscribe(() => {});

    mockClient.sendEvent(ins({ sku: "A1", qty: 10 }));
    mockClient.sendEvent(upd({ sku: "A1", qty: 20 }));

    expect(get(store).data.get("A1")).toEqual({ sku: "A1", qty: 20 });

    unsub();
  });

  it("sets error state on server error", () => {
    const store = liveTable(mockClient as unknown as LiveSQLClient, "orders");
    const unsub = store.subscribe(() => {});

    mockClient.sendError({ code: "FORBIDDEN", message: "Access denied" });

    const state = get(store);
    expect(state.error).toBeInstanceOf(Error);
    expect(state.error?.message).toBe("FORBIDDEN: Access denied");

    unsub();
  });

  it("is lazy — no subscription until store has a subscriber", () => {
    liveTable(mockClient as unknown as LiveSQLClient, "orders");
    expect(mockClient.subscribe).not.toHaveBeenCalled();
  });

  it("calls unsubscribe when last subscriber unsubscribes", () => {
    const store = liveTable(mockClient as unknown as LiveSQLClient, "orders");
    const unsub = store.subscribe(() => {});

    unsub();

    expect(mockClient.unsubscribe).toHaveBeenCalledOnce();
  });
});
