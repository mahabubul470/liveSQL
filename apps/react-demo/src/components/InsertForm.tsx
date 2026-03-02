import { useState, useCallback } from "react";
import { STATUSES, RANDOM_NAMES } from "../types.js";
import type { Status } from "../types.js";

export function InsertForm() {
  const [name, setName] = useState("");
  const [status, setStatus] = useState<Status>("pending");
  const [total, setTotal] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lastInserted, setLastInserted] = useState<string | null>(null);

  const submit = useCallback(
    async (overrides?: { name: string; status: Status; total: string }) => {
      const payload = {
        customer_name: overrides?.name ?? name,
        status: overrides?.status ?? status,
        total: parseFloat(overrides?.total ?? total) || 0,
      };
      if (!payload.customer_name.trim()) return;
      setSubmitting(true);
      try {
        await fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        setLastInserted(payload.customer_name);
        setName("");
        setTotal("");
      } finally {
        setSubmitting(false);
      }
    },
    [name, status, total],
  );

  const randomInsert = useCallback(() => {
    const rName = RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)] ?? "Test User";
    const rStatus = STATUSES[Math.floor(Math.random() * STATUSES.length)] ?? "pending";
    const rTotal = (Math.random() * 500 + 10).toFixed(2);
    void submit({ name: rName, status: rStatus, total: rTotal });
  }, [submit]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      void submit();
    },
    [submit],
  );

  return (
    <div className="insert-form">
      <h2 className="form-title">Insert Order</h2>
      <p className="form-subtitle">
        Submits to <code>POST /api/orders</code> → CDC fires → appears in table instantly.
      </p>

      <form onSubmit={handleSubmit}>
        <div className="field">
          <label>Customer name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Alice Johnson"
            required
          />
        </div>

        <div className="field">
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as Status)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Total ($)</label>
          <input
            type="number"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            placeholder="0.00"
            min="0"
            step="0.01"
          />
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={submitting || !name.trim()}>
            {submitting ? "Inserting…" : "Insert Row"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={randomInsert}
            disabled={submitting}
          >
            Random
          </button>
        </div>
      </form>

      {lastInserted && (
        <div className="form-success">
          ✓ Inserted order for <strong>{lastInserted}</strong>
        </div>
      )}

      <div className="update-section">
        <h3>Test CDC Update</h3>
        <p className="form-subtitle">Run in psql to see a live UPDATE:</p>
        <pre className="code-snippet">{`UPDATE orders SET status = 'shipped'
WHERE status = 'pending'
LIMIT 1;`}</pre>
      </div>
    </div>
  );
}
