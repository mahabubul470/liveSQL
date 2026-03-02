import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import type { ChangeEvent } from "@livesql/core";
import type { LiveSQLClient } from "@livesql/client";
import { LIVESQL_CLIENT_KEY } from "../keys.js";
import { useLiveQuery } from "../use-live-query.js";

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

/**
 * Mount a test component that calls useLiveQuery and exposes results.
 * The global provide injects the mock client for the composable.
 */
function mountWithQuery(
  table: string,
  options: Parameters<typeof useLiveQuery>[1],
  mockClient: ReturnType<typeof makeMockClient>,
) {
  const TestComponent = defineComponent({
    setup() {
      return useLiveQuery(table, options);
    },
    template: "<div></div>",
  });

  return mount(TestComponent, {
    global: {
      provide: {
        [LIVESQL_CLIENT_KEY as symbol]: mockClient as unknown as LiveSQLClient,
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useLiveQuery (Vue)", () => {
  let mockClient: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    mockClient = makeMockClient();
  });

  it("starts not loading with empty data after subscription is established", () => {
    const wrapper = mountWithQuery("orders", undefined, mockClient);

    expect(wrapper.vm.loading).toBe(false);
    expect(wrapper.vm.data).toEqual([]);
    expect(wrapper.vm.error).toBeNull();
  });

  it("calls client.subscribe with the table name", () => {
    mountWithQuery("orders", undefined, mockClient);

    expect(mockClient.subscribe).toHaveBeenCalledOnce();
    expect(mockClient.subscribe.mock.calls[0]?.[0]).toBe("orders");
  });

  it("passes filter to client.subscribe", () => {
    mountWithQuery("orders", { filter: "status = pending" }, mockClient);

    expect(mockClient.subscribe.mock.calls[0]?.[3]).toBe("status = pending");
  });

  it("appends row on insert event", async () => {
    const wrapper = mountWithQuery("orders", undefined, mockClient);

    mockClient.sendEvent(ins({ id: 1, status: "pending" }));
    await nextTick();

    expect(wrapper.vm.data).toEqual([{ id: 1, status: "pending" }]);
  });

  it("replaces matching row on update event (keyed by id)", async () => {
    const wrapper = mountWithQuery("orders", undefined, mockClient);

    mockClient.sendEvent(ins({ id: 1, status: "pending" }));
    await nextTick();
    mockClient.sendEvent(upd({ id: 1, status: "shipped" }));
    await nextTick();

    expect(wrapper.vm.data).toEqual([{ id: 1, status: "shipped" }]);
  });

  it("does not affect non-matching rows on update", async () => {
    const wrapper = mountWithQuery("orders", undefined, mockClient);

    mockClient.sendEvent(ins({ id: 1, status: "pending" }));
    mockClient.sendEvent(ins({ id: 2, status: "pending" }));
    await nextTick();
    mockClient.sendEvent(upd({ id: 1, status: "shipped" }));
    await nextTick();

    expect(wrapper.vm.data).toEqual([
      { id: 1, status: "shipped" },
      { id: 2, status: "pending" },
    ]);
  });

  it("removes row on delete event", async () => {
    const wrapper = mountWithQuery("orders", undefined, mockClient);

    mockClient.sendEvent(ins({ id: 1 }));
    await nextTick();
    mockClient.sendEvent(del({ id: 1 }));
    await nextTick();

    expect(wrapper.vm.data).toEqual([]);
  });

  it("seeds data from initialData option", () => {
    const initialData = [{ id: 99, status: "delivered" }];
    const wrapper = mountWithQuery("orders", { initialData }, mockClient);

    expect(wrapper.vm.data).toEqual(initialData);
  });

  it("uses a custom key field for update/delete matching", async () => {
    const wrapper = mountWithQuery("products", { key: "sku" }, mockClient);

    mockClient.sendEvent({
      ...BASE,
      table: "products",
      type: "insert",
      row: { sku: "A1", qty: 10 },
    });
    await nextTick();
    mockClient.sendEvent({
      ...BASE,
      table: "products",
      type: "update",
      row: { sku: "A1", qty: 20 },
    });
    await nextTick();

    expect(wrapper.vm.data).toEqual([{ sku: "A1", qty: 20 }]);
  });

  it("sets error state when server sends an error", async () => {
    const wrapper = mountWithQuery("orders", undefined, mockClient);

    mockClient.sendError({ code: "FORBIDDEN", message: "Access denied" });
    await nextTick();

    expect(wrapper.vm.error).toBeInstanceOf(Error);
    expect(wrapper.vm.error?.message).toBe("FORBIDDEN: Access denied");
    expect(wrapper.vm.loading).toBe(false);
  });

  it("calls unsubscribe on component unmount", () => {
    const wrapper = mountWithQuery("orders", undefined, mockClient);

    wrapper.unmount();

    expect(mockClient.unsubscribe).toHaveBeenCalledOnce();
  });
});
