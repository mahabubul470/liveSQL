import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WebSocket } from "ws";
import type { ChangeEvent } from "@livesql/core";
import { EventBatcher } from "../event-batcher.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(offset: number): ChangeEvent {
  return {
    id: `evt-${offset}`,
    lsn: `0/${offset}`,
    offset: BigInt(offset),
    schema: "public",
    table: "orders",
    type: "insert",
    row: { id: offset },
    timestamp: "2026-03-01T00:00:00Z",
  };
}

function makeMockWs(bufferedAmount = 0) {
  return { bufferedAmount } as unknown as WebSocket;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EventBatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes after 16ms when fewer than 50 events are queued", () => {
    const onFlush = vi.fn();
    const batcher = new EventBatcher(makeMockWs(), onFlush);

    batcher.add(makeEvent(1));
    batcher.add(makeEvent(2));

    expect(onFlush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(16);

    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush.mock.calls[0]?.[0]).toHaveLength(2);
  });

  it("flushes immediately when the 50-event limit is reached", () => {
    const onFlush = vi.fn();
    const batcher = new EventBatcher(makeMockWs(), onFlush);

    for (let i = 1; i <= 50; i++) {
      batcher.add(makeEvent(i));
    }

    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush.mock.calls[0]?.[0]).toHaveLength(50);
  });

  it("does not fire the timer after an immediate flush at batch limit", () => {
    const onFlush = vi.fn();
    const batcher = new EventBatcher(makeMockWs(), onFlush);

    for (let i = 1; i <= 50; i++) {
      batcher.add(makeEvent(i));
    }
    onFlush.mockClear();

    vi.advanceTimersByTime(100);

    expect(onFlush).not.toHaveBeenCalled();
  });

  it("does nothing when flush() is called with an empty queue", () => {
    const onFlush = vi.fn();
    const batcher = new EventBatcher(makeMockWs(), onFlush);

    batcher.flush();

    expect(onFlush).not.toHaveBeenCalled();
  });

  it("flushes immediately when flush() is called manually", () => {
    const onFlush = vi.fn();
    const batcher = new EventBatcher(makeMockWs(), onFlush);

    batcher.add(makeEvent(1));
    batcher.flush();

    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush.mock.calls[0]?.[0]).toHaveLength(1);
  });

  it("drops events and calls onBackpressure when bufferedAmount exceeds 1 MiB", () => {
    const onFlush = vi.fn();
    const onBackpressure = vi.fn();
    const highBufferWs = makeMockWs(1_048_577); // > 1 MiB
    const batcher = new EventBatcher(highBufferWs, onFlush, onBackpressure);

    batcher.add(makeEvent(1));

    expect(onFlush).not.toHaveBeenCalled();
    expect(onBackpressure).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(100);
    expect(onFlush).not.toHaveBeenCalled();
  });

  it("does not call onBackpressure when bufferedAmount is exactly at threshold", () => {
    const onFlush = vi.fn();
    const onBackpressure = vi.fn();
    const ws = makeMockWs(1_048_576); // exactly 1 MiB — allowed
    const batcher = new EventBatcher(ws, onFlush, onBackpressure);

    batcher.add(makeEvent(1));
    vi.advanceTimersByTime(16);

    expect(onFlush).toHaveBeenCalledOnce();
    expect(onBackpressure).not.toHaveBeenCalled();
  });

  it("cancels timer and discards queue on destroy()", () => {
    const onFlush = vi.fn();
    const batcher = new EventBatcher(makeMockWs(), onFlush);

    batcher.add(makeEvent(1));
    batcher.destroy();

    vi.advanceTimersByTime(100);

    expect(onFlush).not.toHaveBeenCalled();
  });

  it("batches events across multiple add() calls into one flush", () => {
    const onFlush = vi.fn();
    const batcher = new EventBatcher(makeMockWs(), onFlush);

    for (let i = 1; i <= 10; i++) {
      batcher.add(makeEvent(i));
    }

    vi.advanceTimersByTime(16);

    expect(onFlush).toHaveBeenCalledOnce();
    const flushed = onFlush.mock.calls[0]?.[0] as ChangeEvent[];
    expect(flushed).toHaveLength(10);
    expect(flushed.map((e) => Number(e.offset))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});
