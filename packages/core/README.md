# @livesql/core

Shared TypeScript types and wire protocol definitions for [LiveSQL](https://github.com/mahabubul470/liveSQL).

## What is this?

`@livesql/core` is a types-only package. It contains the interfaces shared between `@livesql/server` and `@livesql/client` — the wire protocol messages, change event shape, and the `ChangeProvider` interface.

You typically don't install this directly. It comes as a peer dependency of `@livesql/server` and `@livesql/client`.

## Install

```bash
npm install @livesql/core
```

## Types

### `ChangeEvent`

A single database row change delivered to subscribers.

```typescript
interface ChangeEvent {
  id: string; // UUID
  lsn: string; // PostgreSQL LSN ("A1B2/C3D4E5F6")
  offset: bigint; // Monotonic counter for reconnection
  table: string; // Table name
  schema: string; // Schema name (usually "public")
  type: "insert" | "update" | "delete";
  row: Record<string, unknown>; // New row data
  oldRow?: Record<string, unknown>; // Previous row (update/delete with REPLICA IDENTITY FULL)
  timestamp: string; // ISO-8601 commit timestamp
}
```

### Wire protocol messages

```typescript
// Client → Server
interface SubscribeMessage {
  type: "subscribe";
  table: string;
  filter?: string; // e.g. "status = pending"
  offset?: bigint; // Resume from this offset on reconnect
}

interface UnsubscribeMessage {
  type: "unsubscribe";
  table: string;
}

// Server → Client
interface SyncMessage {
  type: "sync";
  events: ChangeEvent[];
}

interface ErrorMessage {
  type: "error";
  code: string; // e.g. "TABLE_NOT_FOUND", "FORBIDDEN", "INVALID_FILTER"
  message: string;
}
```

### `ChangeProvider`

Interface for implementing custom CDC backends.

```typescript
interface ChangeProvider {
  connect(): Promise<void>;
  subscribe(table: string, callback: (event: ChangeEvent) => void): () => void;
  getCurrentOffset(): Promise<bigint>;
  replayFrom(offset: bigint): AsyncIterable<ChangeEvent>;
  disconnect(): Promise<void>;
}
```

## License

Apache 2.0
