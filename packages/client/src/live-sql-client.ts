import type { ChangeEvent, ClientMessage, ServerMessage } from "@livesql/core";

/**
 * Framework-agnostic LiveSQL client.
 *
 * Manages the WebSocket lifecycle, offset tracking for reconnection,
 * and subscription state. Zero framework dependencies — the React/Vue/Svelte
 * packages wrap this class with framework-specific hooks.
 */
export interface LiveSQLError {
  code: string;
  message: string;
}

export class LiveSQLClient {
  private ws: WebSocket | null = null;
  private offset = BigInt(0);
  private subscriptions = new Map<string, Set<(e: ChangeEvent) => void>>();
  private errorCallbacks = new Map<string, Set<(err: LiveSQLError) => void>>();
  private filters = new Map<string, string>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = true;

  constructor(
    private url: string,
    private getToken: () => string | Promise<string>,
  ) {}

  /** Connect to the LiveSQL WebSocket server */
  connect(): void {
    this.shouldReconnect = true;
    this.openSocket();
  }

  /**
   * Subscribe to changes on a table.
   * @returns Unsubscribe function
   */
  subscribe<T extends Record<string, unknown>>(
    table: string,
    callback: (event: ChangeEvent & { row: T }) => void,
    onError?: (err: LiveSQLError) => void,
    filter?: string,
  ): () => void {
    if (!this.subscriptions.has(table)) {
      this.subscriptions.set(table, new Set());
      this.errorCallbacks.set(table, new Set());
      if (filter) this.filters.set(table, filter);
      // Send subscribe message if already connected
      const msg = filter
        ? { type: "subscribe" as const, table, offset: this.offset, filter }
        : { type: "subscribe" as const, table, offset: this.offset };
      this.send(msg);
    }

    const callbacks = this.subscriptions.get(table)!;
    callbacks.add(callback as (e: ChangeEvent) => void);

    if (onError) {
      this.errorCallbacks.get(table)!.add(onError);
    }

    return () => {
      callbacks.delete(callback as (e: ChangeEvent) => void);
      if (onError) this.errorCallbacks.get(table)?.delete(onError);
      if (callbacks.size === 0) {
        this.subscriptions.delete(table);
        this.errorCallbacks.delete(table);
        this.filters.delete(table);
        this.send({ type: "unsubscribe", table });
      }
    };
  }

  /** Whether the WebSocket is currently connected */
  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Current offset (for debugging) */
  get currentOffset(): bigint {
    return this.offset;
  }

  /** Disconnect and clean up */
  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, "Client disconnect");
      this.ws = null;
    }
    this.subscriptions.clear();
    this.filters.clear();
  }

  private async openSocket(): Promise<void> {
    const token = await this.getToken();
    const separator = this.url.includes("?") ? "&" : "?";
    this.ws = new WebSocket(`${this.url}${separator}token=${token}`);

    this.ws.onmessage = (event: MessageEvent) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        return;
      }

      if (msg.type === "sync") {
        for (const change of msg.events) {
          // Parse offset from string back to bigint (JSON doesn't support bigint)
          const eventOffset =
            typeof change.offset === "string" ? BigInt(change.offset) : change.offset;
          if (eventOffset > this.offset) {
            this.offset = eventOffset;
          }

          const callbacks = this.subscriptions.get(change.table);
          if (callbacks) {
            for (const cb of callbacks) {
              cb(change);
            }
          }
        }
      } else if (msg.type === "error") {
        // Route error to all registered error callbacks
        const err: LiveSQLError = { code: msg.code, message: msg.message };
        for (const errSet of this.errorCallbacks.values()) {
          for (const cb of errSet) {
            cb(err);
          }
        }
      }
    };

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      // Re-subscribe all active subscriptions on reconnect
      for (const table of this.subscriptions.keys()) {
        const filter = this.filters.get(table);
        const msg = filter
          ? { type: "subscribe" as const, table, offset: this.offset, filter }
          : { type: "subscribe" as const, table, offset: this.offset };
        this.send(msg);
      }
    };

    this.ws.onclose = () => {
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror, triggering reconnect
    };
  }

  private scheduleReconnect(): void {
    // Exponential backoff: 250ms → 500ms → 1s → 2s → 4s → ... → 30s cap
    const baseDelay = Math.min(250 * 2 ** this.reconnectAttempt, 30_000);
    // Add jitter (±25%) to prevent thundering herd
    const jitter = baseDelay * (0.75 + Math.random() * 0.5);
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => this.openSocket(), jitter);
  }

  private send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify(msg, (_key, value) =>
          typeof value === "bigint" ? value.toString() : (value as unknown),
        ),
      );
    }
  }
}
