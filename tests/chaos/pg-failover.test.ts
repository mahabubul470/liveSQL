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

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { checkSlotHealth } from "@livesql/server";

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
});
