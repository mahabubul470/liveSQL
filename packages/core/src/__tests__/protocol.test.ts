import { describe, it, expect } from "vitest";
import type {
  ChangeEvent,
  ChangeType,
  SubscribeMessage,
  UnsubscribeMessage,
  ClientMessage,
  SyncMessage,
  ErrorMessage,
  ServerMessage,
} from "../protocol.js";

describe("ChangeEvent", () => {
  it("constructs a valid insert event", () => {
    const event: ChangeEvent = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      lsn: "0/1A2B3C4",
      offset: BigInt(1),
      table: "orders",
      schema: "public",
      type: "insert",
      row: { id: 1, status: "pending" },
      timestamp: "2026-03-01T00:00:00.000Z",
    };
    expect(event.type).toBe("insert");
    expect(event.offset).toBe(BigInt(1));
    expect(event.row).toEqual({ id: 1, status: "pending" });
    expect(event.oldRow).toBeUndefined();
  });

  it("constructs a valid update event with oldRow", () => {
    const event: ChangeEvent = {
      id: "550e8400-e29b-41d4-a716-446655440001",
      lsn: "0/1A2B3C5",
      offset: BigInt(2),
      table: "orders",
      schema: "public",
      type: "update",
      row: { id: 1, status: "shipped" },
      oldRow: { id: 1, status: "pending" },
      timestamp: "2026-03-01T00:01:00.000Z",
    };
    expect(event.type).toBe("update");
    expect(event.row["status"]).toBe("shipped");
    expect(event.oldRow?.["status"]).toBe("pending");
  });

  it("constructs a valid delete event", () => {
    const event: ChangeEvent = {
      id: "550e8400-e29b-41d4-a716-446655440002",
      lsn: "0/1A2B3C6",
      offset: BigInt(3),
      table: "orders",
      schema: "public",
      type: "delete",
      row: { id: 1 },
      timestamp: "2026-03-01T00:02:00.000Z",
    };
    expect(event.type).toBe("delete");
  });

  it("all ChangeType values are strings", () => {
    const types: ChangeType[] = ["insert", "update", "delete"];
    expect(types).toHaveLength(3);
    for (const t of types) {
      expect(typeof t).toBe("string");
    }
  });
});

describe("ClientMessage discriminated union", () => {
  it("narrows to SubscribeMessage on type=subscribe", () => {
    const msg: ClientMessage = { type: "subscribe", table: "orders" };
    if (msg.type === "subscribe") {
      const sub: SubscribeMessage = msg;
      expect(sub.table).toBe("orders");
      expect(sub.filter).toBeUndefined();
      expect(sub.offset).toBeUndefined();
    } else {
      throw new Error("should have been subscribe");
    }
  });

  it("narrows to SubscribeMessage with optional fields", () => {
    const msg: ClientMessage = {
      type: "subscribe",
      table: "orders",
      filter: "status = pending",
      offset: BigInt(42),
    };
    if (msg.type === "subscribe") {
      expect(msg.filter).toBe("status = pending");
      expect(msg.offset).toBe(BigInt(42));
    }
  });

  it("narrows to UnsubscribeMessage on type=unsubscribe", () => {
    const msg: ClientMessage = { type: "unsubscribe", table: "orders" };
    if (msg.type === "unsubscribe") {
      const unsub: UnsubscribeMessage = msg;
      expect(unsub.table).toBe("orders");
    } else {
      throw new Error("should have been unsubscribe");
    }
  });
});

describe("ServerMessage discriminated union", () => {
  it("narrows to SyncMessage on type=sync", () => {
    const msg: ServerMessage = { type: "sync", events: [] };
    if (msg.type === "sync") {
      const sync: SyncMessage = msg;
      expect(sync.events).toHaveLength(0);
    } else {
      throw new Error("should have been sync");
    }
  });

  it("narrows to ErrorMessage on type=error", () => {
    const msg: ServerMessage = {
      type: "error",
      code: "FORBIDDEN",
      message: "Permission denied",
    };
    if (msg.type === "error") {
      const err: ErrorMessage = msg;
      expect(err.code).toBe("FORBIDDEN");
      expect(err.message).toBe("Permission denied");
    } else {
      throw new Error("should have been error");
    }
  });
});
