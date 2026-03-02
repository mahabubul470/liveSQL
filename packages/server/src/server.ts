import { WebSocketServer, WebSocket } from "ws";
import jwt from "jsonwebtoken";
import type http from "node:http";
import type { ChangeEvent, ChangeProvider, ClientMessage, ServerMessage } from "@livesql/core";
import { validateFilter, matchesFilter, FilterValidationError } from "./validate-filter.js";
import type { ParsedFilter } from "./validate-filter.js";
import { EventBatcher } from "./event-batcher.js";

export interface ServerOptions {
  /** PostgreSQL connection string */
  database: string;
  /** Tables to expose over WebSocket */
  tables: string[];
  /** WebSocket server port (when running standalone, not attached to HTTP server) */
  port?: number;
  /**
   * JWT secret for built-in token verification.
   * When set, the server verifies the `?token=` query parameter as a JWT.
   * Mutually exclusive with `authenticate`.
   */
  jwtSecret?: string;
  /** Authentication function — return user object or null to reject */
  authenticate?: (req: http.IncomingMessage) => Promise<{ id: string } | null>;
  /** Table-level permission — can this user subscribe to this table? */
  permissions?: (userId: string, table: string) => Promise<boolean> | boolean;
  /** Row-level permission — can this user see this specific row? */
  rowPermission?: (userId: string, table: string, row: Record<string, unknown>) => boolean;
  /**
   * Columns allowed in client-supplied filter expressions, per table.
   * If not set, filters are rejected.
   * Example: { orders: ["status", "user_id"] }
   */
  allowedFilterColumns?: Record<string, string[]>;
  /**
   * Called when a client's send buffer exceeds 1 MiB and events are being
   * dropped due to backpressure. Use this for alerting or metrics.
   */
  onBackpressure?: (userId: string) => void;
}

interface ClientState {
  ws: WebSocket;
  userId: string;
  subscriptions: Map<string, () => void>; // table -> unsubscribe fn
  filters: Map<string, ParsedFilter>; // table -> parsed filter (optional)
  lastOffset: bigint;
  batcher: EventBatcher;
}

export interface LiveSQLServer {
  /** Attach to an existing HTTP server */
  attach(server: http.Server): void;
  /** Graceful shutdown */
  close(): Promise<void>;
}

export function createLiveSQLServer(provider: ChangeProvider, opts: ServerOptions): LiveSQLServer {
  let wss: WebSocketServer | null = null;
  const clients = new Map<string, ClientState>();
  let clientCounter = 0;

  function setupWebSocketServer(wssInstance: WebSocketServer) {
    wss = wssInstance;

    wss.on("connection", async (ws, req) => {
      // 1. Authenticate
      let userId = "anonymous";

      if (opts.jwtSecret) {
        // Built-in JWT verification from ?token= query parameter
        const rawUrl = req.url ?? "";
        const qIdx = rawUrl.indexOf("?");
        const params = new URLSearchParams(qIdx >= 0 ? rawUrl.slice(qIdx + 1) : "");
        const token = params.get("token");
        if (!token) {
          ws.close(4001, "Unauthorized");
          return;
        }
        try {
          const payload = jwt.verify(token, opts.jwtSecret) as Record<string, unknown>;
          const sub = payload["sub"] ?? payload["id"];
          userId = typeof sub === "string" ? sub : "authenticated";
        } catch {
          ws.close(4001, "Unauthorized");
          return;
        }
      } else if (opts.authenticate) {
        const user = await opts.authenticate(req);
        if (!user) {
          ws.close(4001, "Unauthorized");
          return;
        }
        userId = user.id;
      }

      // 2. Register client
      const clientId = `client_${++clientCounter}`;
      const batcher = new EventBatcher(
        ws,
        (events) => sendSync(ws, events),
        opts.onBackpressure ? () => opts.onBackpressure!(userId) : undefined,
      );
      const state: ClientState = {
        ws,
        userId,
        subscriptions: new Map(),
        filters: new Map(),
        lastOffset: BigInt(0),
        batcher,
      };
      clients.set(clientId, state);

      // 3. Handle messages
      ws.on("message", (raw) => {
        handleClientMessage(state, raw, opts);
      });

      // 4. Clean up on close
      ws.on("close", () => {
        state.batcher.destroy();
        for (const unsub of state.subscriptions.values()) {
          unsub();
        }
        clients.delete(clientId);
      });

      // 5. Heartbeat
      const heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        } else {
          clearInterval(heartbeat);
          clients.delete(clientId);
        }
      }, 30_000);

      ws.on("close", () => clearInterval(heartbeat));
    });
  }

  function handleClientMessage(state: ClientState, raw: unknown, serverOpts: ServerOptions) {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : (raw as Buffer).toString()) as ClientMessage;
    } catch {
      sendError(state.ws, "INVALID_MESSAGE", "Failed to parse message");
      return;
    }

    if (msg.type === "subscribe") {
      // offset arrives as a string from JSON (BigInt is serialised as string by sendSync)
      const rawOffset = (msg as unknown as Record<string, unknown>)["offset"];
      const offset =
        rawOffset !== undefined && rawOffset !== null ? BigInt(rawOffset as string) : undefined;
      void handleSubscribe(state, msg.table, msg.filter, offset, serverOpts);
    } else if (msg.type === "unsubscribe") {
      handleUnsubscribe(state, msg.table);
    }
  }

  async function handleSubscribe(
    state: ClientState,
    table: string,
    filterExpr: string | undefined,
    offset: bigint | undefined,
    serverOpts: ServerOptions,
  ) {
    // 1. Check table is in allowlist
    if (!serverOpts.tables.includes(table)) {
      sendError(state.ws, "TABLE_NOT_FOUND", `Table '${table}' not exposed`);
      return;
    }

    // 2. Check table-level permission
    if (serverOpts.permissions) {
      const allowed = await serverOpts.permissions(state.userId, table);
      if (!allowed) {
        sendError(state.ws, "FORBIDDEN", "Permission denied");
        return;
      }
    }

    // 3. Parse and validate filter expression (if provided)
    let parsedFilter: ParsedFilter | undefined;
    if (filterExpr) {
      const allowedCols = serverOpts.allowedFilterColumns?.[table];
      if (!allowedCols || allowedCols.length === 0) {
        sendError(state.ws, "INVALID_FILTER", `Filtering is not enabled for table '${table}'`);
        return;
      }
      try {
        parsedFilter = validateFilter(filterExpr, allowedCols);
      } catch (err) {
        const msg = err instanceof FilterValidationError ? err.message : "Invalid filter";
        sendError(state.ws, "INVALID_FILTER", msg);
        return;
      }
    }

    // 4. Unsubscribe from previous subscription to same table (if any)
    const existing = state.subscriptions.get(table);
    if (existing) {
      existing();
    }

    // Store filter for this subscription
    if (parsedFilter) {
      state.filters.set(table, parsedFilter);
    } else {
      state.filters.delete(table);
    }

    // 5. Subscribe to CDC events
    const unsubscribe = provider.subscribe(table, (event: ChangeEvent) => {
      // Row-level permission check
      if (serverOpts.rowPermission) {
        if (!serverOpts.rowPermission(state.userId, table, event.row)) {
          return;
        }
      }

      // Client-supplied filter check (in-process, never SQL)
      const filter = state.filters.get(table);
      if (filter && !matchesFilter(filter, event.row)) {
        return;
      }

      // Update client's last known offset
      state.lastOffset = event.offset;

      // Queue event for batched delivery
      state.batcher.add(event);
    });

    state.subscriptions.set(table, unsubscribe);

    // 6. Replay buffered events if client is resuming from a previous offset
    if (offset !== undefined) {
      void (async () => {
        for await (const event of provider.replayFrom(offset)) {
          if (serverOpts.rowPermission && !serverOpts.rowPermission(state.userId, table, event.row))
            continue;
          const filter = state.filters.get(table);
          if (filter && !matchesFilter(filter, event.row)) continue;
          state.batcher.add(event);
        }
        // Flush any remaining replay events immediately
        state.batcher.flush();
      })();
    }
  }

  function handleUnsubscribe(state: ClientState, table: string) {
    const unsub = state.subscriptions.get(table);
    if (unsub) {
      unsub();
      state.subscriptions.delete(table);
      state.filters.delete(table);
    }
  }

  function sendSync(ws: WebSocket, events: ChangeEvent[]) {
    if (ws.readyState !== WebSocket.OPEN) return;

    const msg: ServerMessage = { type: "sync", events };
    ws.send(
      JSON.stringify(msg, (_key, value) =>
        typeof value === "bigint" ? value.toString() : (value as unknown),
      ),
    );
  }

  function sendError(ws: WebSocket, code: string, message: string) {
    if (ws.readyState !== WebSocket.OPEN) return;

    const msg: ServerMessage = { type: "error", code, message };
    ws.send(JSON.stringify(msg));
  }

  // If a port is specified, start a standalone WebSocket server
  if (opts.port) {
    const standalone = new WebSocketServer({ port: opts.port });
    setupWebSocketServer(standalone);
  }

  return {
    attach(server: http.Server) {
      const attached = new WebSocketServer({ server });
      setupWebSocketServer(attached);
    },

    async close() {
      // Disconnect all clients
      for (const state of clients.values()) {
        for (const unsub of state.subscriptions.values()) {
          unsub();
        }
        state.ws.close(1001, "Server shutting down");
      }
      clients.clear();

      // Close WebSocket server
      if (wss) {
        await new Promise<void>((resolve) => wss!.close(() => resolve()));
      }

      // Disconnect CDC provider
      await provider.disconnect();
    },
  };
}
