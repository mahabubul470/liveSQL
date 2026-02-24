# LiveSQL Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        PostgreSQL                                │
│  ┌──────────┐    ┌──────────────┐    ┌───────────────────────┐  │
│  │  Tables   │───▶│  WAL (Write  │───▶│  Logical Replication  │  │
│  │ (orders,  │    │  Ahead Log)  │    │  Slot (pgoutput)      │  │
│  │  users..) │    └──────────────┘    └───────────┬───────────┘  │
│  └──────────┘                                     │              │
└───────────────────────────────────────────────────┼──────────────┘
                                                    │
                                                    │ Replication stream
                                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                    @livesql/server                                │
│                                                                  │
│  ┌─────────────────┐    ┌──────────────┐    ┌────────────────┐  │
│  │ PostgresProvider │───▶│  Subscription │───▶│  WebSocket     │  │
│  │ (ChangeProvider) │    │  Registry     │    │  Server (ws)   │  │
│  │                  │    │              │    │                │  │
│  │ - parse pgoutput │    │ - table map  │    │ - JWT auth     │  │
│  │ - track offset   │    │ - filters    │    │ - fan-out      │  │
│  │ - emit events    │    │ - permissions│    │ - batching     │  │
│  └─────────────────┘    └──────────────┘    │ - backpressure │  │
│                                              │ - heartbeat    │  │
│  ┌─────────────────┐                        └───────┬────────┘  │
│  │ WAL Slot Health  │                                │           │
│  │ Monitor (30s)    │                                │           │
│  └─────────────────┘                                │           │
└──────────────────────────────────────────────────────┼──────────┘
                                                       │
                                          WebSocket (WSS)
                                                       │
                    ┌──────────────────────────────────┼──────┐
                    │                                  ▼      │
                    │  ┌────────────────────────────────────┐  │
                    │  │         @livesql/client            │  │
                    │  │                                    │  │
                    │  │  - WebSocket lifecycle             │  │
                    │  │  - offset tracking                 │  │
                    │  │  - exponential backoff reconnect   │  │
                    │  │  - subscription management         │  │
                    │  └──────────────┬─────────────────────┘  │
                    │                 │                         │
                    │    ┌────────────┼────────────┐           │
                    │    ▼            ▼            ▼           │
                    │  @livesql/   @livesql/   @livesql/      │
                    │  react       vue         svelte          │
                    │                                          │
                    │  useLiveQuery useLiveQuery liveQuery     │
                    │  useLiveTable              store          │
                    │  Provider                                │
                    │                                          │
                    │              Browser / Client             │
                    └──────────────────────────────────────────┘
```

## Data Flow

A single database change flows through the system like this:

```
1. Application writes: INSERT INTO orders (status) VALUES ('pending')
2. PostgreSQL commits → WAL entry created
3. pgoutput plugin decodes WAL → emits Relation + Insert messages
4. PostgresProvider parses binary pgoutput messages
5. PostgresProvider emits ChangeEvent { type: "insert", table: "orders", row: {...}, offset: 42 }
6. Subscription Registry checks: which clients subscribe to "orders"?
7. For each client:
   a. Table permission check: can this user see "orders"? (skip if no)
   b. Filter check: does row match client's filter? (skip if no)
   c. Row permission check: can this user see this specific row? (skip if no)
   d. EventBatcher queues the event
8. EventBatcher flushes (at 50 events or 16ms, whichever first)
9. WebSocket sends: { type: "sync", events: [...] }
10. Client SDK receives, updates offset, fires callbacks
11. React hook updates state → component re-renders
```

## Wire Protocol

All messages are JSON over WebSocket. Defined in `packages/core/src/protocol.ts`.

### Change Types

```typescript
export type ChangeType = "insert" | "update" | "delete";
```

### ChangeEvent (core data structure)

```typescript
export interface ChangeEvent {
  id: string; // UUID of this event
  lsn: string; // PostgreSQL Log Sequence Number
  offset: bigint; // Monotonic counter across all events
  table: string; // Table name
  schema: string; // Schema name (usually "public")
  type: ChangeType;
  row: Record<string, unknown>; // New row data
  oldRow?: Record<string, unknown>; // Previous row (on UPDATE only)
  timestamp: string; // ISO-8601
}
```

### Client → Server Messages

```typescript
export interface SubscribeMessage {
  type: "subscribe";
  table: string;
  filter?: string; // SQL WHERE fragment (server-validated)
  offset?: bigint; // Resume from this offset
}

export interface UnsubscribeMessage {
  type: "unsubscribe";
  table: string;
}

export type ClientMessage = SubscribeMessage | UnsubscribeMessage;
```

### Server → Client Messages

```typescript
export interface SyncMessage {
  type: "sync";
  events: ChangeEvent[];
}

export interface ErrorMessage {
  type: "error";
  code: string;
  message: string;
}

export type ServerMessage = SyncMessage | ErrorMessage;
```

## ChangeProvider Interface

Defined in `packages/core/src/provider.ts`. This is the abstraction that makes multi-database support possible.

```typescript
export interface ChangeProvider {
  /** Connect to the database and begin capturing changes */
  connect(): Promise<void>;

  /** Stream change events to the callback */
  subscribe(table: string, callback: (event: ChangeEvent) => void): () => void; // returns unsubscribe function

  /** Current replication offset */
  getCurrentOffset(): Promise<bigint>;

  /** Replay events from a given offset */
  replayFrom(offset: bigint): AsyncIterable<ChangeEvent>;

  /** Graceful shutdown */
  disconnect(): Promise<void>;
}
```

### Implementations

| Provider               | Package         | CDC Mechanism                      | Status              |
| ---------------------- | --------------- | ---------------------------------- | ------------------- |
| `PostgresProvider`     | @livesql/server | WAL logical replication (pgoutput) | Phase 1             |
| `ListenNotifyProvider` | @livesql/server | LISTEN/NOTIFY (PoC only)           | Phase 0             |
| `MySQLProvider`        | @livesql/server | Binary log (binlog) events         | Phase 4 (if demand) |

## PostgreSQL CDC Engine

### Prerequisites

- PostgreSQL 13+ with `wal_level = logical`
- `max_replication_slots = 10` (one per LiveSQL instance + headroom)
- `max_wal_senders = 10`
- `max_slot_wal_keep_size = 1024` (MB, prevents disk exhaustion on PG 13+)
- `REPLICA IDENTITY FULL` on every watched table (mandatory for UPDATE diffs)
- Dedicated replication user with REPLICATION + SELECT on watched tables

### pgoutput Message Types

| Message Type | Byte 0 (Tag) | Key Contents                               | When Emitted                                       |
| ------------ | ------------ | ------------------------------------------ | -------------------------------------------------- |
| Relation     | 0x52 (R)     | Table OID, schema, table name, column defs | Before first change after connect or schema change |
| Begin        | 0x42 (B)     | Final LSN, commit timestamp, XID           | Start of transaction                               |
| Insert       | 0x49 (I)     | Relation OID, new row tuple                | Row INSERT committed                               |
| Update       | 0x55 (U)     | Relation OID, old + new row tuples         | Row UPDATE committed                               |
| Delete       | 0x44 (D)     | Relation OID, old row key                  | Row DELETE committed                               |
| Commit       | 0x43 (C)     | Commit LSN, end LSN, timestamp             | End of transaction                                 |

Cache Relation messages in a `Map<number, RelationMessage>` keyed by OID. You receive them before the first change on each table, and you need them to map column positions to names.

## WebSocket Server Architecture

### Client State

```typescript
interface ClientState {
  ws: WebSocket;
  userId: string;
  subscriptions: Map<string, Subscription>;
  lastOffset: bigint;
  rateLimit: RateLimiter;
}
```

### Key Behaviors

- **Authentication**: JWT verification on WebSocket handshake (query string or Authorization header)
- **Rate limiting**: Max 100 subscribe messages per minute per client
- **Heartbeat**: Ping every 30s; remove client if no pong
- **Fan-out**: One CDC stream from PostgreSQL, N filtered client connections
- **Batching**: EventBatcher coalesces rapid updates — flushes at 50 events or 16ms
- **Backpressure**: Drop events when `ws.bufferedAmount > 1MB`, emit `client:backpressure` event

## Permission Model (3 Layers)

Each layer must pass independently. A failure at any layer rejects the event.

| Layer            | What It Controls                              | When Evaluated        | Mechanism                                         |
| ---------------- | --------------------------------------------- | --------------------- | ------------------------------------------------- |
| Table Allowlist  | Which tables are exposed at all               | On subscribe          | Static config in `createLiveSQLServer()`          |
| Table Permission | Whether this user can subscribe to this table | On subscribe          | `opts.permissions(userId, table)` callback        |
| Row Permission   | Whether this user can see this specific row   | On every change event | `opts.rowPermission(userId, table, row)` callback |

## Filter Validation

Client-supplied filters are **never** executed as SQL. They are:

1. Parsed against a strict regex: `column operator value`
2. Column validated against `opts.allowedFilterColumns[table]`
3. Operator validated against allowlist: `=`, `!=`, `<`, `>`, `<=`, `>=`
4. Applied in-process via `matchesFilter()` on each event (no database query)

## Client SDK Architecture

### Core Client (`packages/client`)

- Zero framework dependencies
- Manages WebSocket lifecycle: connect, message parsing, reconnect
- Offset tracking: stores last received offset, sends on reconnect
- Exponential backoff: 250ms → 500ms → 1s → 2s → 4s → ... → 30s cap
- Re-subscribes all active subscriptions on reconnect with last known offset

### Framework Wrappers

Each wrapper is thin — the core client does all the heavy lifting:

- **React** (`packages/react`): `LiveSQLProvider` context + `useLiveQuery` hook
- **Vue** (`packages/vue`): `useLiveQuery` composable
- **Svelte** (`packages/svelte`): `liveQuery` store

## Package Dependency Graph

```
@livesql/core       ← zero dependencies
    ↑
@livesql/server     ← pg, ws, jsonwebtoken

@livesql/core
    ↑
@livesql/client     ← zero runtime deps (WebSocket is native)
    ↑
@livesql/react      ← react (peer)
@livesql/vue        ← vue (peer)
@livesql/svelte     ← svelte (peer)
```
