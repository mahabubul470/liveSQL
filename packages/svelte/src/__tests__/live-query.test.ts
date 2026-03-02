import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";
import type { ChangeEvent } from "@livesql/core";
import type { LiveSQLClient } from "@livesql/client";
import { liveQuery } from "../live-query.js";

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

describe("liveQuery (Svelte store)", () => {
  let mockClient: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    mockClient = makeMockClient();
  });

  it("has empty data and loading=false before any events", () => {
    const store = liveQuery(mockClient as unknown as LiveSQLClient, "orders");
    const unsub = store.subscribe(() => {});

    const state = get(store);
    expect(state.loading).toBe(false);
    expect(state.data).toEqual([]);
    expect(state.error).toBeNull();

    unsub();
  });

  it("calls client.subscribe with the table name on first subscriber", () => {
    const store = liveQuery(mockClient as unknown as LiveSQLClient, "orders");

    expect(mockClient.subscribe).not.toHaveBeenCalled(); // lazy — no subscriber yet

    const unsub = store.subscribe(() => {});
    expect(mockClient.subscribe).toHaveBeenCalledOnce();
    expect(mockClient.subscribe.mock.calls[0]?.[0]).toBe("orders");

    unsub();
  });

  it("passes filter to client.subscribe", () => {
    const store = liveQuery(mockClient as unknown as LiveSQLClient, "orders", {
      filter: "status = pending",
    });
    const unsub = store.subscribe(() => {});

    expect(mockClient.subscribe.mock.calls[0]?.[3]).toBe("status = pending");

    unsub();
  });

  it("appends row on insert event", () => {
    const store = liveQuery(mockClient as unknown as LiveSQLClient, "orders");
    const unsub = store.subscribe(() => {});

    mockClient.sendEvent(ins({ id: 1, status: "pending" }));

    expect(get(store).data).toEqual([{ id: 1, status: "pending" }]);
    unsub();
  });

  it("replaces matching row on update event (keyed by id)", () => {
    const store = liveQuery(mockClient as unknown as LiveSQLClient, "orders");
    const unsub = store.subscribe(() => {});

    mockClient.sendEvent(ins({ id: 1, status: "pending" }));
    mockClient.sendEvent(upd({ id: 1, status: "shipped" }));

    expect(get(store).data).toEqual([{ id: 1, status: "shipped" }]);
    unsub();
  });

  it("does not affect non-matching rows on update", () => {
    const store = liveQuery(mockClient as unknown as LiveSQLClient, "orders");
    const unsub = store.subscribe(() => {});

    mockClient.sendEvent(ins({ id: 1, status: "pending" }));
    mockClient.sendEvent(ins({ id: 2, status: "pending" }));
    mockClient.sendEvent(upd({ id: 1, status: "shipped" }));

    expect(get(store).data).toEqual([
      { id: 1, status: "shipped" },
      { id: 2, status: "pending" },
    ]);
    unsub();
  });

  it("removes row on delete event", () => {
    const store = liveQuery(mockClient as unknown as LiveSQLClient, "orders");
    const unsub = store.subscribe(() => {});

    mockClient.sendEvent(ins({ id: 1 }));
    mockClient.sendEvent(del({ id: 1 }));

    expect(get(store).data).toEqual([]);
    unsub();
  });

  it("seeds data from initialData option", () => {
    const initialData = [{ id: 99, status: "delivered" }];
    const store = liveQuery(mockClient as unknown as LiveSQLClient, "orders", { initialData });

    expect(get(store).data).toEqual(initialData);
  });

  it("uses a custom key field for update/delete matching", () => {
    const store = liveQuery(mockClient as unknown as LiveSQLClient, "products", { key: "sku" });
    const unsub = store.subscribe(() => {});

    mockClient.sendEvent({
      ...BASE,
      table: "products",
      type: "insert",
      row: { sku: "A1", qty: 10 },
    });
    mockClient.sendEvent({
      ...BASE,
      table: "products",
      type: "update",
      row: { sku: "A1", qty: 20 },
    });

    expect(get(store).data).toEqual([{ sku: "A1", qty: 20 }]);
    unsub();
  });

  it("sets error state when server sends an error", () => {
    const store = liveQuery(mockClient as unknown as LiveSQLClient, "orders");
    const unsub = store.subscribe(() => {});

    mockClient.sendError({ code: "FORBIDDEN", message: "Access denied" });

    const state = get(store);
    expect(state.error).toBeInstanceOf(Error);
    expect(state.error?.message).toBe("FORBIDDEN: Access denied");
    expect(state.loading).toBe(false);

    unsub();
  });

  it("is lazy — client.subscribe is not called until the store has a subscriber", () => {
    liveQuery(mockClient as unknown as LiveSQLClient, "orders");
    expect(mockClient.subscribe).not.toHaveBeenCalled();
  });

  it("calls unsubscribe when the last subscriber unsubscribes", () => {
    const store = liveQuery(mockClient as unknown as LiveSQLClient, "orders");
    const unsub = store.subscribe(() => {});

    unsub();

    expect(mockClient.unsubscribe).toHaveBeenCalledOnce();
  });
});
