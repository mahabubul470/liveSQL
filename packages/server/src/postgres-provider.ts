/**
 * PostgresProvider — WAL-based CDC via PostgreSQL logical replication (pgoutput).
 *
 * This is the production-grade replacement for the Phase 0 ListenNotifyProvider.
 *
 * Prerequisites on the PostgreSQL server:
 *   - wal_level = logical
 *   - max_replication_slots >= 2 (at least one for LiveSQL)
 *   - max_wal_senders >= 2
 *   - max_slot_wal_keep_size = 1024 (prevents disk exhaustion, PG 13+)
 *   - User must have REPLICATION privilege
 *
 * All watched tables are set to REPLICA IDENTITY FULL on connect (required
 * for old row data in UPDATE/DELETE events).
 */

import pg from "pg";
import crypto from "node:crypto";
import type { ChangeProvider, ChangeEvent, ChangeType } from "@livesql/core";
import { BufferReader } from "./buffer-reader.js";
import { checkSlotHealth } from "./slot-health.js";

// pgoutput message tags
const TAG_RELATION = 0x52; // 'R'
const TAG_BEGIN = 0x42; // 'B'
const TAG_INSERT = 0x49; // 'I'
const TAG_UPDATE = 0x55; // 'U'
const TAG_DELETE = 0x44; // 'D'
const TAG_COMMIT = 0x43; // 'C'

// XLogData / Keepalive type bytes (inside CopyData)
const XLOG_DATA = 0x77; // 'w'
const PRIMARY_KEEPALIVE = 0x6b; // 'k'
const STANDBY_STATUS = 0x72; // 'r'

// Microseconds from Unix epoch (1970-01-01) to PostgreSQL epoch (2000-01-01)
const PG_EPOCH_OFFSET_US = BigInt(Date.UTC(2000, 0, 1)) * BigInt(1000);

// Default WAL lag warning threshold: 512 MB
const DEFAULT_LAG_WARN_BYTES = 512 * 1024 * 1024;

interface RelationInfo {
  schema: string;
  table: string;
  columns: Array<{ name: string; typeOid: number; flags: number }>;
}

export interface PostgresProviderOptions {
  connectionString: string;
  tables: string[];
  /** Replication slot name (default: "livesql_slot") */
  slotName?: string;
  /** Publication name (default: "livesql_publication") */
  publicationName?: string;
  /** Max events to buffer for replayFrom() (default: 10_000) */
  maxBufferedEvents?: number;
  /** WAL lag bytes before emitting a warning (default: 512MB) */
  lagWarningBytes?: number;
  /**
   * Automatically recreate the replication slot and restart the WAL stream
   * when the slot is detected as missing (e.g., after a primary failover).
   * Default: true.
   */
  reconnectOnSlotLoss?: boolean;
}

/** Convert a raw Int64 LSN to the human-readable "X/Y" format */
function lsnToString(lsn: bigint): string {
  const high = Number(lsn >> BigInt(32));
  const low = Number(lsn & BigInt(0xffffffff));
  return `${high.toString(16).toUpperCase()}/${low.toString(16).toUpperCase().padStart(8, "0")}`;
}

/** Parse "X/Y" LSN string to BigInt */
function lsnFromString(lsn: string): bigint {
  const [high, low] = lsn.split("/");
  if (!high || !low) return BigInt(0);
  return (BigInt(parseInt(high, 16)) << BigInt(32)) | BigInt(parseInt(low, 16));
}

export class PostgresProvider implements ChangeProvider {
  private readonly connectionString: string;
  private readonly tables: string[];
  private readonly slotName: string;
  private readonly pubName: string;
  private readonly maxBuffered: number;
  private readonly lagWarningBytes: number;
  private readonly reconnectOnSlotLoss: boolean;

  // Connections
  private adminClient: InstanceType<typeof pg.Client> | null = null;
  private replClient: InstanceType<typeof pg.Client> | null = null;
  // Internal pg Connection object (raw protocol handler) — used for sending
  // the START_REPLICATION command and for writing standby status updates.
  private replConn: {
    stream: { write(data: Buffer): void; end?(): void };
    on(event: "error", handler: (err: Error) => void): void;
    query(sql: string): void;
    sendCopyFromChunk(chunk: Buffer): void;
  } | null = null;

  // State
  private relations = new Map<number, RelationInfo>();
  private listeners = new Map<string, Set<(event: ChangeEvent) => void>>();
  private eventBuffer: ChangeEvent[] = [];
  private offset = BigInt(0);
  private lastReceivedLSN = BigInt(0);
  private recovering = false;

  // Timers
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;

  // Event callbacks (optional observability hooks)
  onSlotLagWarning?: (info: { slotName: string; lagBytes: number }) => void;
  onSlotInactive?: (info: { slotName: string }) => void;
  /** Called when the replication slot is missing (e.g., after failover). */
  onSlotLost?: (info: { slotName: string; recovered: boolean }) => void;
  onError?: (err: Error) => void;

  constructor(opts: PostgresProviderOptions) {
    this.connectionString = opts.connectionString;
    this.tables = opts.tables;
    this.slotName = opts.slotName ?? "livesql_slot";
    this.pubName = opts.publicationName ?? "livesql_publication";
    this.maxBuffered = opts.maxBufferedEvents ?? 10_000;
    this.lagWarningBytes = opts.lagWarningBytes ?? DEFAULT_LAG_WARN_BYTES;
    this.reconnectOnSlotLoss = opts.reconnectOnSlotLoss ?? true;
  }

  async connect(): Promise<void> {
    // ── Admin connection (regular SQL) ────────────────────────────────────────
    this.adminClient = new pg.Client({ connectionString: this.connectionString });
    await this.adminClient.connect();

    // Set REPLICA IDENTITY FULL on all watched tables
    for (const table of this.tables) {
      await this.adminClient.query(`ALTER TABLE "${table}" REPLICA IDENTITY FULL`);
    }

    // Create (or update) publication for the watched tables
    const tableList = this.tables.map((t) => `"${t}"`).join(", ");
    try {
      await this.adminClient.query(`CREATE PUBLICATION "${this.pubName}" FOR TABLE ${tableList}`);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("already exists")) {
        await this.adminClient.query(`ALTER PUBLICATION "${this.pubName}" SET TABLE ${tableList}`);
      } else {
        throw err;
      }
    }

    // ── Replication slot creation (via admin connection) ───────────────────────
    // pg_create_logical_replication_slot() works on a regular connection,
    // avoiding the replication protocol complexity of CREATE_REPLICATION_SLOT.
    const { rows: existingSlots } = await this.adminClient.query<{ slot_name: string }>(
      `SELECT slot_name FROM pg_replication_slots WHERE slot_name = $1`,
      [this.slotName],
    );

    if (existingSlots.length === 0) {
      await this.adminClient.query(`SELECT pg_create_logical_replication_slot($1, 'pgoutput')`, [
        this.slotName,
      ]);
    }

    // ── Start replication stream + monitoring ──────────────────────────────────
    await this.startReplicationStream();

    // ── Heartbeat: acknowledge WAL every 10s ──────────────────────────────────
    this.heartbeatTimer = setInterval(() => {
      this.sendStandbyStatus(this.lastReceivedLSN, false);
    }, 10_000);

    // ── Slot health monitoring: check every 30s ───────────────────────────────
    this.healthTimer = setInterval(() => {
      void this.runHealthCheck();
    }, 30_000);
  }

  // ── Replication stream setup (reusable for failover recovery) ─────────────

  private async startReplicationStream(): Promise<void> {
    // pg.ClientConfig doesn't expose `replication` in its TypeScript types,
    // but the option is valid and documented in the pg package README.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.replClient = new (pg.Client as any)({
      connectionString: this.connectionString,
      replication: "database",
    }) as InstanceType<typeof pg.Client>;
    await this.replClient.connect();

    // Access the raw Connection object (pg internals) for CopyBoth protocol.
    type ReplConnType = NonNullable<typeof this.replConn>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conn = (this.replClient as any).connection as ReplConnType;
    this.replConn = conn;

    conn.on("error", (err) => {
      this.onError?.(err);
    });

    // ── CopyBoth intercept ─────────────────────────────────────────────────────
    // pg.Client._handleCopyData (registered as conn.on('copyData', fn.bind(client)))
    // calls `this._getActiveQuery()`. Even though _handleCopyData is bound, the call
    // to `this._getActiveQuery()` inside it is a dynamic property lookup on the client
    // instance — so overriding _getActiveQuery as an OWN property on the instance
    // shadows the prototype method and correctly intercepts all CopyData messages.
    //
    // We never call client.query() on the replication connection (slot creation is
    // done on adminClient), so there is no Client-managed query lifecycle to conflict.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.replClient as any)._getActiveQuery = () => ({
      handleCopyData: (msg: { chunk: Buffer }) => {
        this.handleCopyData(msg.chunk);
      },
      // pg calls handleError on all active queries during _errorAllQueries()
      // (triggered by client.end() or a connection error). No-op is correct:
      // we handle cleanup in disconnect() ourselves.
      handleError: (_err: Error) => {},
      // pg calls handleReadyForQuery after a query completes. No-op is safe.
      handleReadyForQuery: () => {},
    });

    // START_REPLICATION transitions the connection to streaming CopyBoth mode.
    // Use raw Connection.query (bypasses Client query pipeline).
    const startLSN = "0/0";
    conn.query(
      `START_REPLICATION SLOT "${this.slotName}" LOGICAL ${startLSN}` +
        ` (proto_version '1', publication_names '${this.pubName}')`,
    );
  }

  // ── CopyBoth data handler ───────────────────────────────────────────────────

  private handleCopyData(chunk: Buffer): void {
    if (chunk.length === 0) return;

    const msgType = chunk[0];

    if (msgType === XLOG_DATA) {
      // XLogData: 1B type + 8B walStart + 8B walEnd + 8B serverClock + pgoutput data
      if (chunk.length < 25) return;
      const walStart = chunk.readBigUInt64BE(1);
      const walData = chunk.subarray(25);
      this.lastReceivedLSN = walStart;
      this.handleWALMessage(walData, walStart);
    } else if (msgType === PRIMARY_KEEPALIVE) {
      // Primary keepalive: 1B + 8B walEnd + 8B clock + 1B replyRequested
      if (chunk.length < 18) return;
      const replyRequested = chunk[17] === 1;
      if (replyRequested) {
        const walEnd = chunk.readBigUInt64BE(1);
        this.sendStandbyStatus(walEnd, false);
      }
    }
  }

  // ── pgoutput message dispatch ───────────────────────────────────────────────

  private handleWALMessage(data: Buffer, lsn: bigint): void {
    if (data.length === 0) return;
    const tag = data[0]!;
    const reader = new BufferReader(data, 1); // start after tag byte

    switch (tag) {
      case TAG_RELATION:
        this.parseRelation(reader);
        break;
      case TAG_INSERT:
        this.parseInsert(reader, lsn);
        break;
      case TAG_UPDATE:
        this.parseUpdate(reader, lsn);
        break;
      case TAG_DELETE:
        this.parseDelete(reader, lsn);
        break;
      case TAG_BEGIN:
      case TAG_COMMIT:
        break; // tracked via lastReceivedLSN, no per-row action
      default:
        break;
    }
  }

  // ── pgoutput message parsers ────────────────────────────────────────────────

  private parseRelation(reader: BufferReader): void {
    const oid = reader.readUInt32();
    const schema = reader.readCString();
    const table = reader.readCString();
    reader.readUInt8(); // replica identity setting (ignore)
    const numCols = reader.readInt16();

    const columns: RelationInfo["columns"] = [];
    for (let i = 0; i < numCols; i++) {
      const flags = reader.readUInt8();
      const name = reader.readCString();
      const typeOid = reader.readUInt32();
      reader.readUInt32(); // type modifier (ignored)
      columns.push({ name, typeOid, flags });
    }

    this.relations.set(oid, { schema, table, columns });
  }

  private parseInsert(reader: BufferReader, lsn: bigint): void {
    const oid = reader.readUInt32();
    const relation = this.relations.get(oid);
    if (!relation || !this.tables.includes(relation.table)) return;

    reader.readUInt8(); // 'N' new tuple marker
    const row = this.parseTupleData(reader, relation);

    this.emitEvent({ type: "insert", table: relation.table, schema: relation.schema, row, lsn });
  }

  private parseUpdate(reader: BufferReader, lsn: bigint): void {
    const oid = reader.readUInt32();
    const relation = this.relations.get(oid);
    if (!relation || !this.tables.includes(relation.table)) return;

    let oldRow: Record<string, unknown> | undefined;
    const marker = reader.readUInt8();

    if (marker === 0x4b /* 'K' */ || marker === 0x4f /* 'O' */) {
      // Old tuple (key-only or full, depending on REPLICA IDENTITY setting)
      oldRow = this.parseTupleData(reader, relation);
      reader.readUInt8(); // 'N' new tuple marker
    }
    // If marker === 'N' (0x4e): no old tuple, reader is at the tuple data

    const newRow = this.parseTupleData(reader, relation);

    if (oldRow !== undefined) {
      this.emitEvent({
        type: "update",
        table: relation.table,
        schema: relation.schema,
        row: newRow,
        oldRow,
        lsn,
      });
    } else {
      this.emitEvent({
        type: "update",
        table: relation.table,
        schema: relation.schema,
        row: newRow,
        lsn,
      });
    }
  }

  private parseDelete(reader: BufferReader, lsn: bigint): void {
    const oid = reader.readUInt32();
    const relation = this.relations.get(oid);
    if (!relation || !this.tables.includes(relation.table)) return;

    reader.readUInt8(); // 'K' or 'O' marker (key or full old row)
    const row = this.parseTupleData(reader, relation);

    this.emitEvent({ type: "delete", table: relation.table, schema: relation.schema, row, lsn });
  }

  /**
   * Parse a TupleData block.
   * Format: Int16(numCols) + per-column: Byte(type) + if 't': Int32(len) + Bytes(data)
   */
  private parseTupleData(reader: BufferReader, relation: RelationInfo): Record<string, unknown> {
    const numCols = reader.readInt16();
    const row: Record<string, unknown> = {};

    for (let i = 0; i < numCols; i++) {
      const colType = reader.readUInt8();
      const colName = relation.columns[i]?.name;

      if (colType === 0x6e /* 'n' = null */) {
        if (colName) row[colName] = null;
      } else if (colType === 0x75 /* 'u' = unchanged TOAST */) {
        // Value unchanged and not transmitted — skip (no column in output)
      } else if (colType === 0x74 /* 't' = text */) {
        const len = reader.readUInt32();
        const textVal = reader.readBytes(len).toString("utf8");
        if (colName) row[colName] = textVal;
      }
      // 'b' (binary, proto_version >= 2) not handled in proto_version=1
    }

    return row;
  }

  // ── Event emission ──────────────────────────────────────────────────────────

  private emitEvent(partial: {
    type: ChangeType;
    table: string;
    schema: string;
    row: Record<string, unknown>;
    oldRow?: Record<string, unknown>;
    lsn: bigint;
  }): void {
    this.offset++;

    const event: ChangeEvent = {
      id: crypto.randomUUID(),
      lsn: lsnToString(partial.lsn),
      offset: this.offset,
      table: partial.table,
      schema: partial.schema,
      type: partial.type,
      row: partial.row,
      timestamp: new Date().toISOString(),
      ...(partial.oldRow !== undefined ? { oldRow: partial.oldRow } : {}),
    };

    // Ring buffer: drop oldest event if at capacity
    if (this.eventBuffer.length >= this.maxBuffered) {
      this.eventBuffer.shift();
    }
    this.eventBuffer.push(event);

    // Notify all listeners for this table
    const callbacks = this.listeners.get(partial.table);
    if (callbacks) {
      for (const cb of callbacks) {
        cb(event);
      }
    }
  }

  // ── Standby status update ───────────────────────────────────────────────────

  /**
   * Send a standby status update to PostgreSQL via connection.sendCopyFromChunk().
   * This advances the replication slot (prevents WAL disk exhaustion).
   *
   * Standby status update format (34 bytes):
   *   Byte   0: 'r' (0x72)
   *   Int64  1: write LSN (last received + 1)
   *   Int64  9: flush LSN
   *   Int64 17: apply LSN
   *   Int64 25: timestamp (microseconds since 2000-01-01)
   *   Byte  33: reply requested (0 or 1)
   */
  private sendStandbyStatus(lsn: bigint, replyRequested: boolean): void {
    if (!this.replConn) return;

    const buf = Buffer.allocUnsafe(34);
    buf[0] = STANDBY_STATUS;

    const ackLSN = lsn + BigInt(1);
    buf.writeBigUInt64BE(ackLSN, 1); // write LSN
    buf.writeBigUInt64BE(ackLSN, 9); // flush LSN
    buf.writeBigUInt64BE(ackLSN, 17); // apply LSN

    const nowUs = BigInt(Date.now()) * BigInt(1000) - PG_EPOCH_OFFSET_US;
    buf.writeBigUInt64BE(nowUs < BigInt(0) ? BigInt(0) : nowUs, 25);
    buf[33] = replyRequested ? 1 : 0;

    try {
      // sendCopyFromChunk wraps buf in a CopyData ('d') frontend message
      this.replConn.sendCopyFromChunk(buf);
    } catch {
      // Socket may have closed; disconnect will clean up
    }
  }

  // ── WAL slot health check ───────────────────────────────────────────────────

  private async runHealthCheck(): Promise<void> {
    if (!this.adminClient || this.recovering) return;

    try {
      const health = await checkSlotHealth(this.adminClient, this.slotName);
      if (!health) {
        // Slot is missing — likely a failover
        if (this.reconnectOnSlotLoss) {
          await this.recoverFromSlotLoss();
        } else {
          this.onSlotLost?.({ slotName: this.slotName, recovered: false });
        }
        return;
      }
      if (!health.active) {
        this.onSlotInactive?.({ slotName: this.slotName });
      } else if (health.lagBytes > this.lagWarningBytes) {
        this.onSlotLagWarning?.({ slotName: this.slotName, lagBytes: health.lagBytes });
      }
    } catch {
      // Health check failure is non-fatal
    }
  }

  /**
   * Recover from a missing replication slot by recreating it and restarting
   * the WAL stream. This happens after a PostgreSQL primary failover where
   * the slot doesn't exist on the new primary.
   *
   * WARNING: Events between the old primary's last confirmed LSN and the
   * new slot's starting LSN are permanently lost. The onSlotLost callback
   * is fired to notify the application of this potential data gap.
   */
  private async recoverFromSlotLoss(): Promise<void> {
    if (this.recovering || !this.adminClient) return;
    this.recovering = true;

    try {
      // Tear down the old replication stream
      try {
        this.replConn?.stream.end?.();
      } catch {
        // ignore
      }
      this.replConn = null;
      if (this.replClient) {
        await this.replClient.end().catch(() => {});
        this.replClient = null;
      }

      // Clear stale relation cache (new primary may have different OIDs)
      this.relations.clear();

      // Recreate the replication slot on the new primary
      await this.adminClient.query(`SELECT pg_create_logical_replication_slot($1, 'pgoutput')`, [
        this.slotName,
      ]);

      // Restart the WAL stream
      await this.startReplicationStream();

      this.onSlotLost?.({ slotName: this.slotName, recovered: true });
    } catch (err) {
      this.onSlotLost?.({ slotName: this.slotName, recovered: false });
      this.onError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.recovering = false;
    }
  }

  // ── ChangeProvider interface ────────────────────────────────────────────────

  subscribe(table: string, callback: (event: ChangeEvent) => void): () => void {
    if (!this.listeners.has(table)) {
      this.listeners.set(table, new Set());
    }
    const callbacks = this.listeners.get(table)!;
    callbacks.add(callback);

    return () => {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.listeners.delete(table);
      }
    };
  }

  async getCurrentOffset(): Promise<bigint> {
    return this.offset;
  }

  async *replayFrom(offset: bigint): AsyncIterable<ChangeEvent> {
    for (const event of this.eventBuffer) {
      if (event.offset > offset) {
        yield event;
      }
    }
  }

  async disconnect(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }

    // Destroy the replication stream
    try {
      this.replConn?.stream.end?.();
    } catch {
      // ignore
    }
    this.replConn = null;

    if (this.replClient) {
      await this.replClient.end().catch(() => {});
      this.replClient = null;
    }

    if (this.adminClient) {
      await this.adminClient.end().catch(() => {});
      this.adminClient = null;
    }

    this.listeners.clear();
    this.relations.clear();
  }

  /** @internal Exposed for testing — access the LSN parser */
  static _lsnFromString = lsnFromString;
  static _lsnToString = lsnToString;
}
