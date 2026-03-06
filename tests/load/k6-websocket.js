/**
 * k6 load test — 1,000 concurrent WebSocket clients subscribing to "orders".
 *
 * Scenario:
 *   1. Ramp up to 1,000 concurrent WebSocket connections over 30s
 *   2. Hold at 1,000 for 60s while inserts happen (via separate k6 scenario)
 *   3. Ramp down over 10s
 *
 * Each VU opens a WebSocket, subscribes to "orders", and measures latency
 * from the time an insert is triggered to the time a sync event arrives.
 *
 * Usage:
 *   k6 run tests/load/k6-websocket.js
 */

import ws from "k6/ws";
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";

const WS_URL = __ENV.WS_URL || "ws://localhost:3002";
const HTTP_URL = __ENV.HTTP_URL || "http://localhost:3002";

// Custom metrics
const eventsReceived = new Counter("livesql_events_received");
const eventLatency = new Trend("livesql_event_latency_ms", true);
const wsConnectTime = new Trend("livesql_ws_connect_ms", true);
const subscribeErrors = new Counter("livesql_subscribe_errors");

export const options = {
  scenarios: {
    // Scenario 1: WebSocket subscribers
    subscribers: {
      executor: "ramping-vus",
      exec: "subscriber",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 1000 }, // ramp to 1000
        { duration: "60s", target: 1000 }, // hold
        { duration: "10s", target: 0 },    // ramp down
      ],
      gracefulStop: "5s",
    },
    // Scenario 2: steady INSERT load to generate events
    inserter: {
      executor: "constant-arrival-rate",
      exec: "inserter",
      rate: 50,           // 50 inserts/sec
      timeUnit: "1s",
      duration: "90s",
      preAllocatedVUs: 10,
      maxVUs: 20,
      startTime: "5s",   // start after some subscribers are connected
    },
  },
  thresholds: {
    livesql_event_latency_ms: ["p(95)<200"],    // p95 event latency < 200ms
    livesql_ws_connect_ms: ["p(95)<500"],       // p95 connect time < 500ms
    livesql_events_received: ["count>1000"],    // received a meaningful number of events
  },
};

export function subscriber() {
  const connectStart = Date.now();

  const res = ws.connect(WS_URL, {}, function (socket) {
    const connectMs = Date.now() - connectStart;
    wsConnectTime.add(connectMs);

    socket.on("open", function () {
      // Subscribe to orders table
      socket.send(JSON.stringify({ type: "subscribe", table: "orders" }));
    });

    socket.on("message", function (msg) {
      try {
        const parsed = JSON.parse(msg);
        if (parsed.type === "sync" && parsed.events) {
          for (const event of parsed.events) {
            eventsReceived.add(1);
            // Measure latency from event timestamp to now
            if (event.timestamp) {
              const eventTime = new Date(event.timestamp).getTime();
              const latency = Date.now() - eventTime;
              if (latency >= 0 && latency < 30000) {
                eventLatency.add(latency);
              }
            }
          }
        } else if (parsed.type === "error") {
          subscribeErrors.add(1);
        }
      } catch (_) {
        // ignore parse errors
      }
    });

    socket.on("error", function (e) {
      subscribeErrors.add(1);
    });

    // Keep the connection alive for the scenario duration
    socket.setTimeout(function () {
      socket.close();
    }, 95000);
  });

  check(res, {
    "WebSocket connected": (r) => r && r.status === 101,
  });
}

export function inserter() {
  const res = http.post(`${HTTP_URL}/insert`);
  check(res, {
    "insert succeeded": (r) => r.status === 200,
  });
}
