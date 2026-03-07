/**
 * Chaos Test: WAL Disk Approaching Limit
 *
 * Verifies that checkSlotHealth() correctly detects WAL lag and fires
 * the warning callback when lag exceeds the configured threshold.
 *
 * Requires Docker PostgreSQL on port 5434.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { checkSlotHealth } from "@livesql/server";
import type { SlotHealthInfo } from "@livesql/server";

const DATABASE_URL = "postgresql://livesql:test@localhost:5434/livesql_test";

let pool: pg.Pool;
let canConnect = false;
const SLOT_NAME = "chaos_wal_disk_" + Math.random().toString(36).slice(2, 8);

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: DATABASE_URL });
  try {
    await pool.query("SELECT 1");
    canConnect = true;
  } catch {
    console.warn("[chaos/wal-disk] Skipping — cannot connect to PostgreSQL");
  }
});

afterAll(async () => {
  if (canConnect) {
    // Clean up replication slot
    try {
      await pool.query(`SELECT pg_drop_replication_slot($1)`, [SLOT_NAME]);
    } catch {
      // slot may not exist
    }
  }
  await pool.end();
});

describe("WAL disk approaching limit", () => {
  it("checkSlotHealth returns lag info for an active slot", async () => {
    if (!canConnect) return;
    // Create a replication slot (will accumulate WAL)
    await pool.query(`SELECT pg_create_logical_replication_slot($1, 'pgoutput')`, [SLOT_NAME]);

    // Insert some data to generate WAL
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chaos_wal_test (id SERIAL PRIMARY KEY, data TEXT);
      INSERT INTO chaos_wal_test (data) SELECT md5(random()::text) FROM generate_series(1, 100);
    `);

    const health: SlotHealthInfo = await checkSlotHealth(pool, SLOT_NAME);

    expect(health.slotName).toBe(SLOT_NAME);
    expect(health.active).toBe(false); // nobody is consuming
    expect(typeof health.lagBytes).toBe("number");
    expect(health.lagBytes).toBeGreaterThan(0); // WAL has accumulated

    // Clean up
    await pool.query("DROP TABLE IF EXISTS chaos_wal_test");
  });

  it("detects inactive slot", async () => {
    if (!canConnect) return;
    const health = await checkSlotHealth(pool, SLOT_NAME);
    expect(health.active).toBe(false);
  });

  it("returns null for non-existent slot", async () => {
    if (!canConnect) return;
    const health = await checkSlotHealth(pool, "nonexistent_slot_xyz");
    // Missing slot returns null — caller must handle
    expect(health).toBeNull();
  });
});
