import pg from "pg";
import crypto from "node:crypto";
import type { ChangeProvider, ChangeEvent, ChangeType } from "@livesql/core";

const { Client } = pg;

/**
 * LISTEN/NOTIFY-based ChangeProvider for Phase 0 PoC.
 *
 * This is a temporary, simplified CDC mechanism. It has fundamental limitations:
 * - At-most-once delivery (missed events on disconnect)
 * - 8KB payload limit
 * - NOTIFY acquires a global commit lock under high concurrency
 *
 * It will be replaced by the WAL-based PostgresProvider in Phase 1.
 */
export class ListenNotifyProvider implements ChangeProvider {
  private client: InstanceType<typeof Client> | null = null;
  private listeners = new Map<string, Set<(event: ChangeEvent) => void>>();
  private offset = BigInt(0);
  private tables: string[];
  private connectionString: string;

  constructor(opts: { connectionString: string; tables: string[] }) {
    this.connectionString = opts.connectionString;
    this.tables = opts.tables;
  }

  async connect(): Promise<void> {
    this.client = new Client({ connectionString: this.connectionString });
    await this.client.connect();

    // Create the trigger function if it doesn't exist
    await this.client.query(`
      CREATE OR REPLACE FUNCTION livesql_notify() RETURNS trigger AS $$
      DECLARE
        payload jsonb;
        change_type text;
      BEGIN
        change_type := TG_OP;

        IF (TG_OP = 'DELETE') THEN
          payload := jsonb_build_object(
            'table', TG_TABLE_NAME,
            'schema', TG_TABLE_SCHEMA,
            'type', lower(change_type),
            'row', row_to_json(OLD)
          );
        ELSIF (TG_OP = 'UPDATE') THEN
          payload := jsonb_build_object(
            'table', TG_TABLE_NAME,
            'schema', TG_TABLE_SCHEMA,
            'type', lower(change_type),
            'row', row_to_json(NEW),
            'oldRow', row_to_json(OLD)
          );
        ELSE
          payload := jsonb_build_object(
            'table', TG_TABLE_NAME,
            'schema', TG_TABLE_SCHEMA,
            'type', lower(change_type),
            'row', row_to_json(NEW)
          );
        END IF;

        PERFORM pg_notify('livesql_changes', payload::text);
        RETURN COALESCE(NEW, OLD);
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Create triggers on each watched table
    for (const table of this.tables) {
      await this.client.query(`
        DROP TRIGGER IF EXISTS livesql_trigger ON ${table};
        CREATE TRIGGER livesql_trigger
          AFTER INSERT OR UPDATE OR DELETE ON ${table}
          FOR EACH ROW EXECUTE FUNCTION livesql_notify();
      `);
    }

    // Listen for notifications
    await this.client.query("LISTEN livesql_changes");

    this.client.on("notification", (msg) => {
      if (msg.channel !== "livesql_changes" || !msg.payload) return;

      try {
        const data = JSON.parse(msg.payload) as {
          table: string;
          schema: string;
          type: string;
          row: Record<string, unknown>;
          oldRow?: Record<string, unknown>;
        };

        this.offset++;

        const event: ChangeEvent = {
          id: crypto.randomUUID(),
          lsn: "0/0", // LISTEN/NOTIFY doesn't provide LSN
          offset: this.offset,
          table: data.table,
          schema: data.schema,
          type: data.type as ChangeType,
          row: data.row,
          oldRow: data.oldRow,
          timestamp: new Date().toISOString(),
        };

        const callbacks = this.listeners.get(data.table);
        if (callbacks) {
          for (const cb of callbacks) {
            cb(event);
          }
        }
      } catch {
        // Ignore malformed payloads
      }
    });
  }

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

  async *replayFrom(_offset: bigint): AsyncIterable<ChangeEvent> {
    // LISTEN/NOTIFY has no replay capability — this is a fundamental limitation.
    // The WAL-based provider in Phase 1 will implement this properly.
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      // Clean up triggers
      for (const table of this.tables) {
        await this.client
          .query(`DROP TRIGGER IF EXISTS livesql_trigger ON ${table}`)
          .catch(() => {});
      }
      await this.client.end();
      this.client = null;
    }
    this.listeners.clear();
  }
}
