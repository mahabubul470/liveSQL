import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLiveSQLServer, ListenNotifyProvider } from "@livesql/server";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://livesql:test@localhost:5432/livesql_test";
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

// 1. Create the CDC provider
const provider = new ListenNotifyProvider({
  connectionString: DATABASE_URL,
  tables: ["orders"],
});

// 2. Create the LiveSQL server
const livesql = createLiveSQLServer(provider, {
  database: DATABASE_URL,
  tables: ["orders"],
  // No auth for the PoC demo
});

// 3. Connect the CDC provider
await provider.connect();
console.log("CDC provider connected — listening for changes on 'orders' table");

// 4. Create HTTP server to serve the demo page
const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html" });
    fs.createReadStream(path.join(__dirname, "index.html")).pipe(res);
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

// 5. Attach LiveSQL WebSocket server to HTTP server
livesql.attach(server);

server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║            LiveSQL Demo — Order Dashboard            ║
╠══════════════════════════════════════════════════════╣
║                                                      ║
║  Dashboard:  http://localhost:${PORT}                   ║
║  WebSocket:  ws://localhost:${PORT}                     ║
║                                                      ║
║  Try inserting a row:                                ║
║  psql -U livesql -d livesql_test -c \\               ║
║    "INSERT INTO orders (customer_name, status, total)║
║     VALUES ('Demo User', 'pending', 99.99);"        ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
`);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  await livesql.close();
  server.close();
  process.exit(0);
});
