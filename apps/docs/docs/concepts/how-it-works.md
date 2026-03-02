---
sidebar_position: 1
title: How Sync Works
---

This page explains the mechanics of LiveSQL end-to-end: how a database write becomes a browser event in under 100ms.

## Architecture overview

```
PostgreSQL
  └── WAL (Write-Ahead Log)
        └── Logical replication slot (pgoutput)
              └── @livesql/server
                    ├── PostgresProvider  — parses binary WAL stream
                    ├── Subscription Registry  — tracks which client wants which table
                    ├── EventBatcher  — coalesces rapid updates
                    └── WebSocket Server  — JWT auth, fan-out, backpressure
                          └── WebSocket (WSS)
                                ├── @livesql/client  — reconnect, offset tracking
                                ├── @livesql/react   — useLiveQuery, useLiveTable
                                ├── @livesql/vue     — useLiveQuery
                                └── @livesql/svelte  — liveQuery store
```

## Data flow: one change, step by step

1. **Application writes**: `INSERT INTO orders (status) VALUES ('pending')`
2. **PostgreSQL commits** → WAL entry is created.
3. **pgoutput plugin** decodes the WAL → emits `Relation` + `Insert` binary messages.
4. **`PostgresProvider`** parses the binary stream and emits a `ChangeEvent`:
   ```json
   {
     "id": "550e8400-...",
     "lsn": "0/16B3748",
     "offset": 42,
     "table": "orders",
     "schema": "public",
     "type": "insert",
     "row": { "id": "abc-123", "status": "pending", "user_id": "user-1" },
     "timestamp": "2026-02-25T10:30:00.000Z"
   }
   ```
5. **Subscription Registry** finds all clients subscribed to `"orders"`.
6. **For each client**, three permission checks run in sequence:
   - Table allowlist: is `"orders"` in `opts.tables`?
   - Table permission: does `opts.permissions(userId, "orders")` return `true`?
   - Row permission: does `opts.rowPermission(userId, "orders", row)` return `true`?
7. **EventBatcher** queues the event. It flushes automatically at 50 events or every 16ms, whichever comes first.
8. **WebSocket** sends the batch: `{ "type": "sync", "events": [...] }`
9. **Client SDK** receives the message, updates its `lastOffset`, and fires subscriber callbacks.
10. **React hook** updates component state → the component re-renders with the new row.

## Why WAL replication, not polling

LiveSQL uses PostgreSQL logical replication (the same mechanism database replicas use) instead of polling or LISTEN/NOTIFY.

| Approach        | Delivery     | Latency  | Missed events              |
| --------------- | ------------ | -------- | -------------------------- |
| Polling         | At-most-once | 1–30s    | Possible                   |
| LISTEN/NOTIFY   | At-most-once | `<100ms` | Yes, on disconnect         |
| WAL replication | Guaranteed   | `<100ms` | No — replayed on reconnect |

LISTEN/NOTIFY has a global commit lock during the notification phase, which serializes all database commits under heavy write load. It also permanently loses events sent while the listener is disconnected — there is no replay.

WAL replication has no per-notification overhead. PostgreSQL already writes WAL for crash recovery; LiveSQL just reads it as a secondary consumer.

## Wire protocol

All messages are JSON over WebSocket. Types are defined in `@livesql/core`.

### Client → server

```json title="Subscribe"
{
  "type": "subscribe",
  "table": "orders",
  "filter": "status = pending",
  "offset": 42
}
```

```json title="Unsubscribe"
{
  "type": "unsubscribe",
  "table": "orders"
}
```

### Server → client

```json title="Sync (batched events)"
{
  "type": "sync",
  "events": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "lsn": "0/16B3748",
      "offset": 42,
      "table": "orders",
      "schema": "public",
      "type": "insert",
      "row": { "id": "abc-123", "status": "pending" },
      "timestamp": "2026-02-25T10:30:00.000Z"
    }
  ]
}
```

```json title="Error"
{
  "type": "error",
  "code": "FORBIDDEN",
  "message": "Permission denied for table 'orders'"
}
```

### Error codes

| Code              | Meaning                               |
| ----------------- | ------------------------------------- |
| `UNAUTHORIZED`    | JWT invalid or missing                |
| `TABLE_NOT_FOUND` | Table not in `opts.tables` allowlist  |
| `FORBIDDEN`       | Table permission check returned false |
| `INVALID_FILTER`  | Filter expression is malformed        |
| `RATE_LIMITED`    | More than 100 subscribes/minute       |
| `INTERNAL_ERROR`  | Server-side CDC or unexpected error   |

## Reconnection and backfill

The client tracks the offset of the last event it received. On reconnect, it includes that offset in the subscribe message. The server replays all events from that offset before switching to live delivery.

```
Client connects   →  subscribes with offset: 0
Server streams    →  events 1, 2, 3… client stores lastOffset = 3
Network drops     →  client starts exponential backoff (250ms → 500ms → 1s → … → 30s)
Client reconnects →  subscribes with offset: 3
Server replays    →  events 4, 5 (missed during disconnect)
Server streams    →  live events from 6 onwards
```

No events are lost. The backfill window is bounded by how far the replication slot has advanced.

## Permission model

Three layers of access control run independently. A failure at any layer blocks delivery.

| Layer            | When                  | Callback                                 |
| ---------------- | --------------------- | ---------------------------------------- |
| Table allowlist  | On subscribe          | `opts.tables: string[]`                  |
| Table permission | On subscribe          | `opts.permissions(userId, table)`        |
| Row permission   | On every change event | `opts.rowPermission(userId, table, row)` |

Row-level permissions run in-process (pure JavaScript), not as database queries. This means 1,000 clients watching the same table adds zero database load for permission checks.

## Filter validation

Clients can supply server-side filters to receive only matching rows:

```json
{ "type": "subscribe", "table": "orders", "filter": "user_id = user-123" }
```

Filters are **never** executed as SQL. The server:

1. Parses the expression against a strict regex: `column operator value`
2. Validates the column against `opts.allowedFilterColumns[table]`
3. Validates the operator against an allowlist: `=`, `!=`, `<`, `>`, `<=`, `>=`
4. Evaluates the filter in JavaScript (`matchesFilter()`) on each event — no database query

This prevents SQL injection entirely.

## Batching and backpressure

**EventBatcher** coalesces rapid database writes before sending them to the client:

- Flushes at **50 events** or **16ms**, whichever comes first
- Under high insert rate, a single WebSocket frame carries multiple events instead of one frame per row

If a client is receiving data slower than it arrives (slow network, heavy JavaScript), the server-side WebSocket send buffer grows. When `ws.bufferedAmount` exceeds **1 MB**:

1. The event batch for that client is dropped
2. `opts.onBackpressure(userId)` is called (if configured)
3. The client reconnects and resumes from its last offset

This prevents one slow client from consuming server memory indefinitely.

## PostgreSQL requirements

| Setting                  | Value                | Why                                               |
| ------------------------ | -------------------- | ------------------------------------------------- |
| `wal_level`              | `logical`            | Required for pgoutput decoding                    |
| `max_replication_slots`  | `≥ 2`                | One slot per LiveSQL instance                     |
| `max_wal_senders`        | `≥ 2`                | One sender per slot                               |
| `max_slot_wal_keep_size` | `1024` (MB)          | Prevents disk exhaustion if consumer falls behind |
| `REPLICA IDENTITY`       | `FULL` on each table | Includes previous row in UPDATE events            |
