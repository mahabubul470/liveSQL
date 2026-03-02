import { useRef, useEffect, useState } from "react";
import type { Order } from "../types.js";

interface Props {
  orders: Order[];
  loading: boolean;
  error: Error | null;
}

export function OrderTable({ orders, loading, error }: Props) {
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  const prevIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const incoming = new Set(orders.map((o) => o.id));
    const newIds = new Set<string>();
    for (const id of incoming) {
      if (!prevIds.current.has(id)) newIds.add(id);
    }
    if (newIds.size > 0) {
      setFlashIds(newIds);
      const timer = setTimeout(() => setFlashIds(new Set()), 800);
      return () => clearTimeout(timer);
    }
    prevIds.current = incoming;
  }, [orders]);

  if (loading) {
    return <div className="empty-state">Connecting to LiveSQL…</div>;
  }

  if (error) {
    return <div className="empty-state error">Error: {error.message}</div>;
  }

  if (orders.length === 0) {
    return <div className="empty-state">No orders. Insert one using the form →</div>;
  }

  return (
    <div className="table-wrap">
      <table className="orders-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Customer</th>
            <th>Status</th>
            <th>Total</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id} className={flashIds.has(order.id) ? "flash" : ""}>
              <td className="mono">{order.id.slice(0, 8)}…</td>
              <td>{order.customer_name}</td>
              <td>
                <span className={`badge badge-${order.status}`}>{order.status}</span>
              </td>
              <td>${Number(order.total).toFixed(2)}</td>
              <td className="muted">{new Date(order.created_at).toLocaleTimeString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
