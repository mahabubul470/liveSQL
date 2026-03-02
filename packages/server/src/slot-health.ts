import type pg from "pg";

export interface SlotHealthInfo {
  slotName: string;
  active: boolean;
  lagBytes: number;
}

/**
 * Query the WAL replication slot for lag_bytes and active status.
 * Returns null if the slot does not exist.
 */
export async function checkSlotHealth(
  client: InstanceType<typeof pg.Client>,
  slotName: string,
): Promise<SlotHealthInfo | null> {
  const { rows } = await client.query<{
    slot_name: string;
    active: boolean;
    lag_bytes: string;
  }>(
    `
    SELECT
      slot_name,
      active,
      COALESCE(
        pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn),
        0
      )::bigint AS lag_bytes
    FROM pg_replication_slots
    WHERE slot_name = $1
    `,
    [slotName],
  );

  if (rows.length === 0) return null;

  const row = rows[0]!;
  return {
    slotName: row.slot_name,
    active: row.active,
    lagBytes: Number(row.lag_bytes),
  };
}
