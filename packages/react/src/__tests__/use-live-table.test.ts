import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import type { ChangeEvent } from "@livesql/core";
import type { LiveSQLClient } from "@livesql/client";
import { LiveSQLContext } from "../context.js";
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useLiveTable", () => {
  let mockClient: ReturnType<typeof makeMockClient>;
  let wrapper: (props: { children: ReactNode }) => ReturnType<typeof createElement>;

  beforeEach(() => {
    mockClient = makeMockClient();
    wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        LiveSQLContext.Provider,
        { value: mockClient as unknown as LiveSQLClient },
        children,
      );
  });

  it("is not loading with an empty Map after subscription is established", () => {
    const { result } = renderHook(() => useLiveTable("orders"), { wrapper });

    expect(result.current.loading).toBe(false);
    expect(result.current.data.size).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it("passes filter to client.subscribe", () => {
    renderHook(() => useLiveTable("orders", { filter: "status = pending" }), { wrapper });

    expect(mockClient.subscribe.mock.calls[0]?.[3]).toBe("status = pending");
  });

  it("adds a row to the Map on insert", () => {
    const { result } = renderHook(() => useLiveTable("orders"), { wrapper });

    act(() => {
      mockClient.sendEvent(ins({ id: "1", status: "pending" }));
    });

    expect(result.current.data.get("1")).toEqual({ id: "1", status: "pending" });
  });

  it("replaces a Map entry on update", () => {
    const { result } = renderHook(() => useLiveTable("orders"), { wrapper });

    act(() => {
      mockClient.sendEvent(ins({ id: "1", status: "pending" }));
    });
    act(() => {
      mockClient.sendEvent(upd({ id: "1", status: "shipped" }));
    });

    expect(result.current.data.get("1")).toEqual({ id: "1", status: "shipped" });
    expect(result.current.data.size).toBe(1);
  });

  it("removes a Map entry on delete", () => {
    const { result } = renderHook(() => useLiveTable("orders"), { wrapper });

    act(() => {
      mockClient.sendEvent(ins({ id: "1" }));
    });
    act(() => {
      mockClient.sendEvent(del({ id: "1" }));
    });

    expect(result.current.data.size).toBe(0);
  });

  it("handles multiple rows independently", () => {
    const { result } = renderHook(() => useLiveTable("orders"), { wrapper });

    act(() => {
      mockClient.sendEvent(ins({ id: "1", status: "pending" }));
      mockClient.sendEvent(ins({ id: "2", status: "pending" }));
    });
    act(() => {
      mockClient.sendEvent(del({ id: "1" }));
    });

    expect(result.current.data.size).toBe(1);
    expect(result.current.data.get("2")).toEqual({ id: "2", status: "pending" });
  });

  it("uses a custom key field", () => {
    const { result } = renderHook(() => useLiveTable("products", { key: "sku" }), { wrapper });

    act(() => {
      mockClient.sendEvent({
        ...BASE,
        table: "products",
        type: "insert",
        row: { sku: "A1", qty: 10 },
      });
    });
    act(() => {
      mockClient.sendEvent({
        ...BASE,
        table: "products",
        type: "update",
        row: { sku: "A1", qty: 20 },
      });
    });

    expect(result.current.data.get("A1")).toEqual({ sku: "A1", qty: 20 });
  });

  it("sets error state when server sends an error", () => {
    const { result } = renderHook(() => useLiveTable("orders"), { wrapper });

    act(() => {
      mockClient.sendError({ code: "TABLE_NOT_FOUND", message: "orders does not exist" });
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe("TABLE_NOT_FOUND: orders does not exist");
  });

  it("calls the unsubscribe function on unmount", () => {
    const { unmount } = renderHook(() => useLiveTable("orders"), { wrapper });

    unmount();

    expect(mockClient.unsubscribe).toHaveBeenCalledOnce();
  });
});
