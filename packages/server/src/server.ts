import { WebSocketServer, WebSocket } from "ws";
import type http from "node:http";
import type { ChangeEvent, ChangeProvider, ClientMessage, ServerMessage } from "@livesql/core";

export interface ServerOptions {
  /** PostgreSQL connection string */
  database: string;
  /** Tables to expose over WebSocket */
  tables: string[];
  /** WebSocket server port (when running standalone, not attached to HTTP server) */
  port?: number;
  /** Authentication function — return user object or null to reject */
  authenticate?: (req: http.IncomingMessage) => Promise<{ id: string } | null>;
  /** Table-level permission — can this user subscribe to this table? */
  permissions?: (userId: string, table: string) => Promise<boolean> | boolean;
  /** Row-level permission — can this user see this specific row? */
  rowPermission?: (userId: string, table: string, row: Record<string, unknown>) => boolean;
}

interface ClientState {
  ws: WebSocket;
  userId: string;
  subscriptions: Map<string, () => void>; // table -> unsubscribe fn
  lastOffset: bigint;
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
      if (opts.authenticate) {
        const user = await opts.authenticate(req);
        if (!user) {
          ws.close(4001, "Unauthorized");
          return;
        }
        userId = user.id;
      }

      // 2. Register client
      const clientId = `client_${++clientCounter}`;
      const state: ClientState = {
        ws,
        userId,
        subscriptions: new Map(),
        lastOffset: BigInt(0),
      };
      clients.set(clientId, state);

      // 3. Handle messages
      ws.on("message", (raw) => {
        handleClientMessage(state, raw, opts);
      });

      // 4. Clean up on close
      ws.on("close", () => {
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
      handleSubscribe(state, msg.table, serverOpts);
    } else if (msg.type === "unsubscribe") {
      handleUnsubscribe(state, msg.table);
    }
  }

  async function handleSubscribe(state: ClientState, table: string, serverOpts: ServerOptions) {
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

    // 3. Unsubscribe from previous subscription to same table (if any)
    const existing = state.subscriptions.get(table);
    if (existing) {
      existing();
    }

    // 4. Subscribe to CDC events
    const unsubscribe = provider.subscribe(table, (event: ChangeEvent) => {
      // Row-level permission check
      if (serverOpts.rowPermission) {
        if (!serverOpts.rowPermission(state.userId, table, event.row)) {
          return;
        }
      }

      // Update client's last known offset
      state.lastOffset = event.offset;

      // Send to client
      sendSync(state.ws, [event]);
    });

    state.subscriptions.set(table, unsubscribe);
  }

  function handleUnsubscribe(state: ClientState, table: string) {
    const unsub = state.subscriptions.get(table);
    if (unsub) {
      unsub();
      state.subscriptions.delete(table);
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
