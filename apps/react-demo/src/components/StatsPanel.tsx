import type { Order } from "../types.js";

interface Props {
  orders: Order[];
}

export function StatsPanel({ orders }: Props) {
  const pending = orders.filter((o) => o.status === "pending").length;
  const revenue = orders.reduce((sum, o) => sum + Number(o.total), 0);

  return (
    <div className="stats-panel">
      <Stat label="Total Orders" value={orders.length} />
      <Stat label="Pending" value={pending} accent="yellow" />
      <Stat label="Revenue" value={`$${revenue.toFixed(2)}`} accent="green" />
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: "yellow" | "green";
}) {
  return (
    <div className={`stat ${accent ?? ""}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
