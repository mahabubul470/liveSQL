/** The type of database change */
export type ChangeType = "insert" | "update" | "delete";

/** A single database change event */
export interface ChangeEvent {
  /** UUID of this event */
  id: string;
  /** PostgreSQL Log Sequence Number */
  lsn: string;
  /** Monotonic counter across all events (used for offset-based resumption) */
  offset: bigint;
  /** Table name */
  table: string;
  /** Schema name (usually "public") */
  schema: string;
  /** Type of change */
  type: ChangeType;
  /** New row data (present on insert and update) */
  row: Record<string, unknown>;
  /** Previous row data (present on update only, requires REPLICA IDENTITY FULL) */
  oldRow?: Record<string, unknown> | undefined;
  /** ISO-8601 timestamp of when the change was committed */
  timestamp: string;
}

// --- Client → Server messages ---

/** Subscribe to changes on a table */
export interface SubscribeMessage {
  type: "subscribe";
  /** Table to subscribe to (must be in server's allowlist) */
  table: string;
  /** Optional SQL WHERE fragment for server-side filtering (validated server-side) */
  filter?: string;
  /** Resume from this offset (for reconnection) */
  offset?: bigint;
}

/** Unsubscribe from a table */
export interface UnsubscribeMessage {
  type: "unsubscribe";
  /** Table to unsubscribe from */
  table: string;
}

/** Union of all client-to-server message types */
export type ClientMessage = SubscribeMessage | UnsubscribeMessage;

// --- Server → Client messages ---

/** Batch of change events delivered to the client */
export interface SyncMessage {
  type: "sync";
  /** Array of change events (batched for efficiency) */
  events: ChangeEvent[];
}

/** Error message sent to the client */
export interface ErrorMessage {
  type: "error";
  /** Machine-readable error code */
  code: string;
  /** Human-readable error description */
  message: string;
}

/** Union of all server-to-client message types */
export type ServerMessage = SyncMessage | ErrorMessage;
