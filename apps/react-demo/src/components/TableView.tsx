import { useLiveTable } from "@livesql/react";
import type { Order } from "../types.js";

export function TableView() {
  const { data: orders, loading, error } = useLiveTable<Order>("orders");

  if (loading) return <div className="empty-state">Connecting…</div>;
  if (error) return <div className="empty-state error">Error: {error.message}</div>;

  return (
    <div>
      <div className="table-meta">
        <span className="muted">Map size: </span>
        <strong>{orders.size}</strong>
        <span className="muted"> entries — O(1) lookup by id</span>
      </div>

      <div className="table-wrap">
        <table className="orders-table">
          <thead>
            <tr>
              <th>ID (key)</th>
              <th>Customer</th>
              <th>Status</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {[...orders.values()].map((order) => (
              <tr key={order.id}>
                <td className="mono">{order.id.slice(0, 8)}…</td>
                <td>{order.customer_name}</td>
                <td>
                  <span className={`badge badge-${order.status}`}>{order.status}</span>
                </td>
                <td>${Number(order.total).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {orders.size === 0 && (
        <div className="empty-state">No orders yet. Insert one using the form →</div>
      )}
    </div>
  );
}
