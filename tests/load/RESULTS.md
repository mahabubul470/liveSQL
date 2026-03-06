# k6 Load Test Results

**Date:** 2026-03-07
**Environment:** Local (single machine), PostgreSQL 16 (Docker), Node.js v24.11.1
**k6 version:** v1.6.1

## Scenario

- **Subscribers:** Ramp 0 → 1,000 WebSocket clients over 30s, hold 60s, ramp down 10s
- **Inserters:** 50 INSERTs/sec for 90s (4,500 total inserts)
- **CDC engine:** PostgresProvider (WAL logical replication via pgoutput)
- **Batching:** EventBatcher (50 events or 16ms flush)

## Results

| Metric                                | Value              |
| ------------------------------------- | ------------------ |
| **Peak concurrent WebSocket clients** | 1,000              |
| **Total events delivered**            | 3,976,800          |
| **Event throughput**                  | ~37,872 events/sec |
| **Total inserts**                     | 4,500 (0% failure) |
| **Insert rate**                       | ~43/sec            |

### Event Latency (DB write → client receive)

| Percentile | Latency  |
| ---------- | -------- |
| p50        | 41ms     |
| p90        | 84ms     |
| **p95**    | **96ms** |
| max        | 165ms    |

### WebSocket Connect Time

| Percentile | Latency |
| ---------- | ------- |
| p50        | 6ms     |
| p90        | 126ms   |
| p95        | 272ms   |
| max        | 579ms   |

### HTTP Insert Latency

| Percentile | Latency |
| ---------- | ------- |
| p50        | 61ms    |
| p90        | 97ms    |
| p95        | 106ms   |

## Thresholds

| Threshold           | Target  | Actual    | Status |
| ------------------- | ------- | --------- | ------ |
| Event latency p95   | < 200ms | 96ms      | PASS   |
| WS connect time p95 | < 500ms | 272ms     | PASS   |
| Events received     | > 1,000 | 3,976,800 | PASS   |

## Network

- Data received: 1.4 GB (14 MB/s)
- Data sent: 710 KB (6.8 KB/s)

## Key Takeaways

- **p95 event latency of 96ms** — well under the 100ms target for most percentiles
- 1,000 concurrent clients with zero connection failures
- Fan-out: each of the 4,500 inserts was delivered to ~883 average connected clients (3,976,800 / 4,500)
- EventBatcher keeps throughput high while maintaining low latency
