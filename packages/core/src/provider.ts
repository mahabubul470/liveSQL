import type { ChangeEvent } from "./protocol.js";

/**
 * Abstract interface for Change Data Capture providers.
 *
 * This decouples the CDC mechanism from the transport layer.
 * Each database gets its own implementation:
 * - PostgreSQL: WAL logical replication via pgoutput (Phase 1)
 * - PostgreSQL: LISTEN/NOTIFY for PoC (Phase 0, temporary)
 * - MySQL: Binary log events (Phase 4, if demand)
 */
export interface ChangeProvider {
  /** Connect to the database and begin capturing changes */
  connect(): Promise<void>;

  /**
   * Subscribe to change events on a specific table.
   * @param table - Table name to watch
   * @param callback - Called for each change event
   * @returns Unsubscribe function
   */
  subscribe(table: string, callback: (event: ChangeEvent) => void): () => void;

  /** Get the current replication offset */
  getCurrentOffset(): Promise<bigint>;

  /**
   * Replay events starting from a given offset.
   * Used for reconnection — client sends its last offset,
   * server replays all events since that point.
   */
  replayFrom(offset: bigint): AsyncIterable<ChangeEvent>;

  /** Graceful shutdown — release replication slot, close connections */
  disconnect(): Promise<void>;
}
