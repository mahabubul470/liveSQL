/**
 * Chaos Test: PostgreSQL Primary Failover
 *
 * Tests that the PostgresProvider detects when its replication slot disappears
 * (as would happen during a primary failover) and handles it gracefully.
 *
 * Note: A full failover test requires a primary + replica PostgreSQL setup with
 * pg_ctl promote. This test simulates the observable effect by dropping the
 * replication slot while the provider is connected.
 *
 * Requires Docker PostgreSQL on port 5434.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { checkSlotHealth, PostgresProvider } from "@livesql/server";

const DATABASE_URL = "postgresql://livesql:test@localhost:5434/livesql_test";

let pool: pg.Pool;
let canConnect = false;

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: DATABASE_URL });
  try {
    await pool.query("SELECT 1");
    canConnect = true;
  } catch {
    console.warn("[chaos/pg-failover] Skipping — cannot connect to PostgreSQL");
  }
});

afterAll(async () => {
  await pool.end();
});

describe("PostgreSQL failover (simulated slot loss)", () => {
  it("detects missing replication slot after simulated failover", async () => {
    if (!canConnect) return;
    {
      const slotName = "chaos_failover_" + Math.random().toString(36).slice(2, 8);

      // Create a slot (simulates pre-failover state)
      await pool.query(`SELECT pg_create_logical_replication_slot($1, 'pgoutput')`, [slotName]);

      // Verify slot exists
      const health1 = await checkSlotHealth(pool, slotName);
      expect(health1.slotName).toBe(slotName);

      // Simulate failover: drop the slot (on a real failover, the slot doesn't
      // exist on the new primary)
      await pool.query(`SELECT pg_drop_replication_slot($1)`, [slotName]);

      // checkSlotHealth returns null for missing slots
      const health2 = await checkSlotHealth(pool, slotName);
      expect(health2).toBeNull();
    }
  });

  it("can recreate a replication slot after failover", async () => {
    if (!canConnect) return;
    {
      const slotName = "chaos_recreate_" + Math.random().toString(36).slice(2, 8);

      // Create, then drop (simulating failover)
      await pool.query(`SELECT pg_create_logical_replication_slot($1, 'pgoutput')`, [slotName]);
      await pool.query(`SELECT pg_drop_replication_slot($1)`, [slotName]);

      // Recreate on new primary
      const result = await pool.query(`SELECT pg_create_logical_replication_slot($1, 'pgoutput')`, [
        slotName,
      ]);
      expect(result.rows).toHaveLength(1);

      // Verify it's functional
      const health = await checkSlotHealth(pool, slotName);
      expect(health.slotName).toBe(slotName);

      // Clean up
      await pool.query(`SELECT pg_drop_replication_slot($1)`, [slotName]);
    }
  });

  it("PostgresProvider auto-recovers after slot is dropped", async () => {
    if (!canConnect) return;
    {
      const suffix = Math.random().toString(36).slice(2, 8);
      const slotName = "chaos_auto_" + suffix;
      const pubName = "chaos_auto_pub_" + suffix;

      // Set up table for this test
      await pool.query(`
        CREATE TABLE IF NOT EXISTS chaos_failover_test (
          id SERIAL PRIMARY KEY,
          value TEXT NOT NULL
        );
        ALTER TABLE chaos_failover_test REPLICA IDENTITY FULL;
        DELETE FROM chaos_failover_test;
      `);

      const provider = new PostgresProvider({
        connectionString: DATABASE_URL,
        tables: ["chaos_failover_test"],
        slotName,
        publicationName: pubName,
      });

      await provider.connect();

      // Verify slot exists and is active
      const health1 = await checkSlotHealth(pool, slotName);
      expect(health1).not.toBeNull();
      expect(health1!.slotName).toBe(slotName);

      // Disconnect, drop the slot, then reconnect (simulates failover)
      await provider.disconnect();

      try {
        await pool.query(`SELECT pg_drop_replication_slot($1)`, [slotName]);
      } catch {
        // Slot may already be gone
      }

      // Verify it's gone
      expect(await checkSlotHealth(pool, slotName)).toBeNull();

      // Reconnect — connect() recreates the slot automatically
      const provider2 = new PostgresProvider({
        connectionString: DATABASE_URL,
        tables: ["chaos_failover_test"],
        slotName,
        publicationName: pubName,
        reconnectOnSlotLoss: true,
      });

      const onSlotLost = vi.fn();
      provider2.onSlotLost = onSlotLost;

      await provider2.connect();

      // Verify the slot was recreated
      const health2 = await checkSlotHealth(pool, slotName);
      expect(health2).not.toBeNull();
      expect(health2!.slotName).toBe(slotName);

      // Clean up
      await provider2.disconnect();
      try {
        await pool.query(`SELECT pg_drop_replication_slot($1)`, [slotName]);
      } catch {
        // may already be cleaned up
      }
      await pool.query("DROP TABLE IF EXISTS chaos_failover_test");
    }
  });
});
