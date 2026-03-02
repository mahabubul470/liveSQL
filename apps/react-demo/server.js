import http from "node:http";
import { createLiveSQLServer, ListenNotifyProvider } from "@livesql/server";
import pg from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://livesql:test@localhost:5434/livesql_test";
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

// DB pool for REST endpoints
const pool = new pg.Pool({ connectionString: DATABASE_URL });

// Ensure trigger exists
await pool.query(`
  CREATE OR REPLACE FUNCTION livesql_notify() RETURNS trigger AS $$
  DECLARE payload json;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      payload = json_build_object('type', 'delete', 'table', TG_TABLE_NAME, 'row', row_to_json(OLD));
    ELSE
      payload = json_build_object('type', lower(TG_OP), 'table', TG_TABLE_NAME, 'row', row_to_json(NEW));
    END IF;
    PERFORM pg_notify('livesql_' || TG_TABLE_NAME, payload::text);
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;
`);

await pool.query(`
  DROP TRIGGER IF EXISTS livesql_trigger ON orders;
  CREATE TRIGGER livesql_trigger
  AFTER INSERT OR UPDATE OR DELETE ON orders
  FOR EACH ROW EXECUTE FUNCTION livesql_notify();
`);

// CDC provider
const provider = new ListenNotifyProvider({
  connectionString: DATABASE_URL,
  tables: ["orders"],
});

const livesql = createLiveSQLServer(provider, {
  database: DATABASE_URL,
  tables: ["orders"],
});

await provider.connect();

// HTTP server with REST API + static fallback
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS for Vite dev server
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // POST /api/orders — insert a new order
  if (req.method === "POST" && url.pathname === "/api/orders") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { customer_name, status, total } = JSON.parse(body);
        const result = await pool.query(
          "INSERT INTO orders (customer_name, status, total) VALUES ($1, $2, $3) RETURNING *",
          [customer_name, status ?? "pending", Number(total) ?? 0],
        );
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result.rows[0]));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  // PATCH /api/orders/:id — update order status
  const patchMatch = url.pathname.match(/^\/api\/orders\/([^/]+)$/);
  if (req.method === "PATCH" && patchMatch) {
    const id = patchMatch[1];
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { status } = JSON.parse(body);
        const result = await pool.query(
          "UPDATE orders SET status = $1, updated_at = now() WHERE id = $2 RETURNING *",
          [status, id],
        );
        if (result.rowCount === 0) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not found" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result.rows[0]));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

livesql.attach(server);

server.listen(PORT, () => {
  console.log(`LiveSQL React Demo backend running on :${PORT}`);
  console.log(`WebSocket: ws://localhost:${PORT}`);
  console.log(`REST API:  http://localhost:${PORT}/api/orders`);
});

process.on("SIGINT", async () => {
  await livesql.close();
  await pool.end();
  server.close();
  process.exit(0);
});
