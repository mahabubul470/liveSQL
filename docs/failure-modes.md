# Known Failure Modes & Mitigations

These are production failure modes that have broken real-time sync systems in practice. Each must be explicitly addressed before v1.0 ships.

---

## 1. WAL Disk Exhaustion (CRITICAL)

**Severity**: Can crash your production database

**Root Cause**: If the CDC consumer disconnects or falls behind, PostgreSQL retains all WAL files for the replication slot indefinitely. This can fill the primary disk and crash the production database.

**Detection**:

- Monitor `lag_bytes` in `pg_replication_slots` every 30 seconds
- Alert at 50% of `max_slot_wal_keep_size`

**Mitigation**:

- **ALWAYS** set `max_slot_wal_keep_size = 1024` (MB) in PostgreSQL 13+
  - This caps WAL retention — PostgreSQL will drop old WAL segments beyond this limit
  - The replication slot becomes invalidated, requiring re-creation
- Implement `checkSlotHealth()` function that runs on 30s interval
- Emit `slot:lag-warning` event when lag exceeds threshold
- Emit `slot:inactive` event when slot is not actively consuming
- Document the slot deletion procedure for operators

**Code location**: `packages/server/src/monitoring/slot-health.ts`

```sql
-- PostgreSQL config (requires restart)
max_slot_wal_keep_size = 1024   -- MB, prevents disk exhaustion
```

```typescript
// Health check query
SELECT slot_name, active,
  pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn) AS lag_bytes
FROM pg_replication_slots
WHERE slot_name = $1
```

---

## 2. Silent Event Loss on Disconnect (LISTEN/NOTIFY only)

**Severity**: Data permanently lost — no way to recover

**Root Cause**: LISTEN/NOTIFY delivers at-most-once. If the listener is disconnected when NOTIFY fires, the event is permanently lost. There is no replay mechanism.

**Detection**:

- Integration test: insert rows during client disconnect, verify backfill on reconnect

**Mitigation**:

- Use WAL logical replication (not LISTEN/NOTIFY) as the primary CDC mechanism
- WAL retains event history in the replication slot
- Client sends last offset on reconnect → server replays from that position
- LISTEN/NOTIFY is acceptable only for Phase 0 PoC

**Why this matters**: This is the #1 reason LISTEN/NOTIFY is unsuitable for production. Supabase Realtime documentation itself states it "does not guarantee delivery."

---

## 3. Thundering Herd on Server Restart

**Severity**: Server crash or extreme latency spike

**Root Cause**: When the LiveSQL server restarts, all 1,000+ connected clients detect the disconnect simultaneously and attempt to reconnect at the same time.

**Detection**:

- Load test: disconnect all clients simultaneously, measure reconnection behavior

**Mitigation**:

- Exponential backoff: 250ms → 500ms → 1s → 2s → 4s → ... → 30s cap
- **Jitter**: Add ±10-25% random delay to each backoff interval
  - Without jitter, all clients reconnect in synchronized waves
  - With jitter, reconnections spread across the backoff window
- Server must handle burst of reconnections without crashing

```typescript
// Backoff with jitter
const baseDelay = Math.min(250 * 2 ** this.reconnectAttempt, 30_000);
const jitter = baseDelay * (0.75 + Math.random() * 0.5); // ±25%
```

---

## 4. OOM from Slow Client

**Severity**: Server crash (out of memory)

**Root Cause**: `ws.bufferedAmount` grows unboundedly for slow receivers. If a client on a poor connection can't consume events as fast as they arrive, the server-side send buffer accumulates until the process runs out of memory.

**Detection**:

- Monitor `ws.bufferedAmount` per connection
- Alert when any connection exceeds 1MB

**Mitigation**:

- Check `ws.bufferedAmount` before sending each batch
- If `bufferedAmount > 1_000_000` (1MB):
  - Drop the event batch
  - Emit `client:backpressure` event with client ID and buffer size
  - Optionally close unresponsive connections after sustained backpressure
- DraftKings engineering learned that WebSocket APIs at scale require planned periodic connection interruptions to prevent slow clients from accumulating buffers

```typescript
if (ws.bufferedAmount > 1_000_000) {
  emit("client:backpressure", { clientId, buffered: ws.bufferedAmount });
  return; // Drop events for this client
}
```

---

## 5. Replication Slot Failover Data Loss

**Severity**: Silent data loss — events during failover window are permanently missed

**Root Cause**: PostgreSQL logical replication slots cannot go backwards after primary failover. The new primary creates a slot at a forward LSN position. Events between the old primary's last confirmed LSN and the new primary's starting LSN are lost.

**Detection**:

- Chaos test: `pg_ctl promote` on replica, verify replication slot state
- Monitor for slot disappearance on reconnect

**Mitigation** (IMPLEMENTED):

- `PostgresProvider` health check detects missing slot every 30s
- `reconnectOnSlotLoss: true` (default) automatically recreates the slot and restarts the WAL stream
- `onSlotLost({ slotName, recovered })` callback warns the application of the potential data gap
- Relation cache is cleared on recovery (new primary may have different OIDs)
- Guard prevents concurrent recovery attempts
- Events between the old primary's last confirmed LSN and the new slot are permanently lost — the callback lets operators detect and handle the gap

---

## 6. Schema Change Breaks Parsing

**Severity**: Silent data corruption or parsing errors

**Root Cause**: PostgreSQL's logical replication stream does not include DDL statements. An `ALTER TABLE` or `DROP TABLE` changes column OIDs without notification. The cached Relation messages become stale, causing column position mismatches.

**Detection**:

- Integration test: run `ALTER TABLE ADD COLUMN` during active sync
- Detect OID mismatch between cached Relation and incoming tuple

**Mitigation**:

- Refresh Relation cache on every Commit message
- Detect OID mismatch: if an incoming tuple references a relation OID not in cache, or column count doesn't match, re-request the Relation
- Log a warning when schema change is detected during active sync
- Consider: periodically query `pg_catalog` to detect DDL changes

---

## 7. SQL Injection via Filter

**Severity**: Critical security vulnerability

**Root Cause**: If client-supplied filter strings are passed to the database as SQL, an attacker can inject arbitrary SQL. Example: `filter: "1=1; DROP TABLE orders;--"`

**Detection**:

- Security test: send malicious SQL strings as filter parameter
- Verify no SQL is ever executed from client input

**Mitigation**:

- **NEVER** execute client-provided SQL against the database
- Parse filter against strict regex: `/^(\w+)\s*(=|!=|<|>|<=|>=)\s*(.+)$/`
- Validate column name against `allowedFilterColumns` config
- Validate operator against explicit allowlist
- Apply filter in-process using `matchesFilter()` — pure JavaScript comparison, no database query
- Return `INVALID_FILTER` error for any expression that doesn't match the expected format

```typescript
const ALLOWED_OPERATORS = ["=", "!=", "<", ">", "<=", ">="];

// This runs in JavaScript, NOT as a SQL query
function matchesFilter(row: Record<string, unknown>, f: SafeFilter): boolean {
  const rowVal = row[f.column];
  switch (f.operator) {
    case "=":
      return String(rowVal) === f.value;
    case "!=":
      return String(rowVal) !== f.value;
    // ...
  }
}
```
