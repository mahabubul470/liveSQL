---
sidebar_label: Production Deployment
sidebar_position: 4
title: Running LiveSQL in Production
---

# Running LiveSQL in Production

## PostgreSQL Configuration

These settings are required in `postgresql.conf`:

```ini
wal_level = logical                # required for CDC
max_replication_slots = 10         # at least 1 per LiveSQL instance
max_wal_senders = 10               # at least 1 per LiveSQL instance
max_slot_wal_keep_size = 1024      # cap WAL disk usage at 1GB — CRITICAL
```

Your database user needs the `REPLICATION` privilege:

```sql
ALTER USER livesql_user REPLICATION;
```

Every watched table must use `REPLICA IDENTITY FULL`:

```sql
ALTER TABLE orders REPLICA IDENTITY FULL;
ALTER TABLE products REPLICA IDENTITY FULL;
```

`PostgresProvider` sets this automatically on `connect()`, but it's good practice to set it explicitly in your migrations.

## Environment Variables

```bash
DATABASE_URL=postgresql://user:pass@db-host:5432/mydb
JWT_SECRET=your-secret-key
PORT=3000
```

## Health Checks

### WAL Slot Health

Monitor replication slot lag to prevent WAL disk exhaustion:

```typescript
import { checkSlotHealth } from "@livesql/server";
import { Client } from "pg";

// In your health check endpoint
app.get("/health/livesql", async (req, res) => {
  const client = new Client(process.env.DATABASE_URL);
  await client.connect();

  const health = await checkSlotHealth(client, "livesql_slot");
  await client.end();

  if (!health.active) {
    return res.status(503).json({ status: "unhealthy", reason: "slot inactive" });
  }
  if (health.lagBytes > 512 * 1024 * 1024) {
    return res.status(503).json({ status: "degraded", lagBytes: health.lagBytes });
  }
  res.json({ status: "healthy", lagBytes: health.lagBytes });
});
```

### Observability Hooks

Wire hooks into your metrics/logging system:

```typescript
const provider = new PostgresProvider({
  connectionString: DATABASE_URL,
  tables: ["orders"],
});

provider.onSlotLagWarning = ({ slotName, lagBytes }) => {
  metrics.gauge("livesql.wal_lag_bytes", lagBytes);
  logger.warn(`WAL lag: ${lagBytes} bytes on ${slotName}`);
};

provider.onSlotInactive = ({ slotName }) => {
  alerting.critical(`Replication slot ${slotName} is inactive`);
};

provider.onError = (err) => {
  logger.error("LiveSQL provider error", err);
};

const livesql = createLiveSQLServer(provider, {
  database: DATABASE_URL,
  tables: ["orders"],
  onClientConnect: (userId, clientId) => {
    metrics.increment("livesql.connections");
  },
  onClientDisconnect: (userId, clientId) => {
    metrics.decrement("livesql.connections");
  },
  onBackpressure: (userId) => {
    metrics.increment("livesql.backpressure_drops");
    logger.warn(`Dropping events for slow client ${userId}`);
  },
});
```

## Scaling

### Horizontal Scaling

Each LiveSQL instance creates its own replication slot. For multiple instances:

- Use unique `slotName` per instance (e.g., `livesql_slot_1`, `livesql_slot_2`)
- Put a load balancer with WebSocket support (sticky sessions) in front
- Monitor total replication slots — each consumes WAL retention

### Connection Limits

- Each LiveSQL instance uses 1 replication connection + 1 admin connection
- Account for these in `max_connections` and `max_wal_senders`
- Default `maxBufferedEvents` is 10,000 — increase if clients disconnect for long periods

## Failover Recovery

When a PostgreSQL primary fails over, replication slots are lost. LiveSQL detects this and can auto-recover:

```typescript
const provider = new PostgresProvider({
  connectionString: DATABASE_URL,
  tables: ["orders"],
  reconnectOnSlotLoss: true, // auto-recreate slot on new primary
});

provider.onSlotLost = ({ slotName, recovered }) => {
  if (recovered) {
    logger.info(`Slot ${slotName} recreated on new primary`);
  } else {
    alerting.critical(`Slot ${slotName} lost — manual intervention needed`);
  }
};
```

**Note:** Events between the last checkpoint and failover may be lost. This is inherent to PostgreSQL replication slot behavior. See [Failure Modes](https://github.com/mahabubul470/LiveSQL/blob/main/docs/failure-modes.md) for details.

## Docker / Docker Compose

```yaml title="docker-compose.yml"
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: myapp
      POSTGRES_PASSWORD: secret
      POSTGRES_DB: mydb
    command: >
      postgres
        -c wal_level=logical
        -c max_replication_slots=10
        -c max_slot_wal_keep_size=1024
    ports:
      - "5432:5432"

  app:
    build: .
    environment:
      DATABASE_URL: postgresql://myapp:secret@postgres:5432/mydb
      JWT_SECRET: your-secret
      PORT: 3000
    ports:
      - "3000:3000"
    depends_on:
      - postgres
```

## Checklist

- [ ] `wal_level = logical` set in PostgreSQL
- [ ] `max_slot_wal_keep_size` set (prevents WAL disk exhaustion)
- [ ] Database user has `REPLICATION` privilege
- [ ] `REPLICA IDENTITY FULL` on all watched tables
- [ ] JWT secret configured
- [ ] Health check endpoint monitoring slot lag
- [ ] Alerting on `onSlotInactive` and `onSlotLost`
- [ ] Backpressure logging enabled
- [ ] Load balancer configured for WebSocket (if scaling horizontally)
