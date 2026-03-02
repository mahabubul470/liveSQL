import type { WebSocket } from "ws";
import type { ChangeEvent } from "@livesql/core";

/** Maximum events per batch before an immediate flush */
const MAX_BATCH_SIZE = 50;
/** Maximum milliseconds before a pending batch is flushed */
const FLUSH_INTERVAL_MS = 16;
/** Backpressure threshold: drop events when the socket buffer exceeds 1 MiB */
const BACKPRESSURE_BYTES = 1_048_576;

/**
 * Coalesces CDC events per connected client and flushes them as a batch to
 * avoid sending one WebSocket frame per change.
 *
 * Flush triggers (whichever comes first):
 *  - 50 events have accumulated in the queue
 *  - 16 ms have elapsed since the first queued event
 *
 * Backpressure: if `ws.bufferedAmount > 1 MiB` the event is dropped and
 * `onBackpressure` is called, giving the application a chance to log or alert.
 */
export class EventBatcher {
  private queue: ChangeEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly ws: WebSocket,
    private readonly onFlush: (events: ChangeEvent[]) => void,
    private readonly onBackpressure?: () => void,
  ) {}

  /** Queue an event for the next batch. Drops the event under backpressure. */
  add(event: ChangeEvent): void {
    if (this.ws.bufferedAmount > BACKPRESSURE_BYTES) {
      this.onBackpressure?.();
      return;
    }

    this.queue.push(event);

    if (this.queue.length >= MAX_BATCH_SIZE) {
      this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), FLUSH_INTERVAL_MS);
    }
  }

  /** Immediately flush any pending events. */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.queue.length === 0) return;

    const events = this.queue.splice(0);
    this.onFlush(events);
  }

  /** Cancel any pending flush and discard queued events. Call on client disconnect. */
  destroy(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.queue = [];
  }
}
