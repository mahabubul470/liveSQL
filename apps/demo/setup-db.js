import pg from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://livesql:test@localhost:5432/livesql_test";

const client = new pg.Client({ connectionString: DATABASE_URL });

async function setup() {
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      total NUMERIC(10, 2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Insert some sample data
  await client.query(`
    INSERT INTO orders (customer_name, status, total) VALUES
      ('Alice Johnson', 'pending', 49.99),
      ('Bob Smith', 'processing', 129.50),
      ('Carol White', 'shipped', 75.00)
    ON CONFLICT DO NOTHING;
  `);

  console.log("Database setup complete. Orders table created with sample data.");
  await client.end();
}

setup().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
