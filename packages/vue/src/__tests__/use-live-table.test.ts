import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import type { ChangeEvent } from "@livesql/core";
import type { LiveSQLClient } from "@livesql/client";
import { LIVESQL_CLIENT_KEY } from "../keys.js";
import { useLiveTable } from "../use-live-table.js";

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

function mountWithTable(
  table: string,
  options: Parameters<typeof useLiveTable>[1],
  mockClient: ReturnType<typeof makeMockClient>,
) {
  const TestComponent = defineComponent({
    setup() {
      return useLiveTable(table, options);
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

describe("useLiveTable (Vue)", () => {
  let mockClient: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    mockClient = makeMockClient();
  });

  it("starts with empty Map", () => {
    const wrapper = mountWithTable("orders", undefined, mockClient);

    expect(wrapper.vm.data).toBeInstanceOf(Map);
    expect(wrapper.vm.data.size).toBe(0);
    expect(wrapper.vm.loading).toBe(false);
    expect(wrapper.vm.error).toBeNull();
  });

  it("calls client.subscribe with the table name", () => {
    mountWithTable("orders", undefined, mockClient);

    expect(mockClient.subscribe).toHaveBeenCalledOnce();
    expect(mockClient.subscribe.mock.calls[0]?.[0]).toBe("orders");
  });

  it("passes filter to client.subscribe", () => {
    mountWithTable("orders", { filter: "status = pending" }, mockClient);

    expect(mockClient.subscribe.mock.calls[0]?.[3]).toBe("status = pending");
  });

  it("adds row to Map on insert event", async () => {
    const wrapper = mountWithTable("orders", undefined, mockClient);

    mockClient.sendEvent(ins({ id: "1", status: "pending" }));
    await nextTick();

    expect(wrapper.vm.data.size).toBe(1);
    expect(wrapper.vm.data.get("1")).toEqual({ id: "1", status: "pending" });
  });

  it("replaces row on update event", async () => {
    const wrapper = mountWithTable("orders", undefined, mockClient);

    mockClient.sendEvent(ins({ id: "1", status: "pending" }));
    await nextTick();
    mockClient.sendEvent(upd({ id: "1", status: "shipped" }));
    await nextTick();

    expect(wrapper.vm.data.get("1")).toEqual({ id: "1", status: "shipped" });
  });

  it("removes row on delete event", async () => {
    const wrapper = mountWithTable("orders", undefined, mockClient);

    mockClient.sendEvent(ins({ id: "1" }));
    await nextTick();
    mockClient.sendEvent(del({ id: "1" }));
    await nextTick();

    expect(wrapper.vm.data.size).toBe(0);
  });

  it("uses custom key field", async () => {
    const wrapper = mountWithTable("products", { key: "sku" }, mockClient);

    mockClient.sendEvent(ins({ sku: "A1", qty: 10 }));
    await nextTick();
    mockClient.sendEvent(upd({ sku: "A1", qty: 20 }));
    await nextTick();

    expect(wrapper.vm.data.get("A1")).toEqual({ sku: "A1", qty: 20 });
  });

  it("sets error state on server error", async () => {
    const wrapper = mountWithTable("orders", undefined, mockClient);

    mockClient.sendError({ code: "FORBIDDEN", message: "Access denied" });
    await nextTick();

    expect(wrapper.vm.error).toBeInstanceOf(Error);
    expect(wrapper.vm.error?.message).toBe("FORBIDDEN: Access denied");
  });

  it("calls unsubscribe on component unmount", () => {
    const wrapper = mountWithTable("orders", undefined, mockClient);
    wrapper.unmount();

    expect(mockClient.unsubscribe).toHaveBeenCalledOnce();
  });
});
