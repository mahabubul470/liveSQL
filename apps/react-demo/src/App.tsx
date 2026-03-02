import { useState } from "react";
import { useLiveQuery } from "@livesql/react";
import { StatsPanel } from "./components/StatsPanel.js";
import { FilterBar } from "./components/FilterBar.js";
import { OrderTable } from "./components/OrderTable.js";
import { TableView } from "./components/TableView.js";
import { InsertForm } from "./components/InsertForm.js";
import type { Order } from "./types.js";

type Tab = "orders" | "table";

export function App() {
  const [tab, setTab] = useState<Tab>("orders");
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);

  const filter = statusFilter ? `status = ${statusFilter}` : undefined;
  const { data: allOrders } = useLiveQuery<Order>("orders");
  const { data: filteredOrders, loading, error } = useLiveQuery<Order>("orders", { filter });

  return (
    <div className="app">
      <header className="header">
        <div className="header-title">
          <span className="logo">⚡</span>
          <h1>LiveSQL React Demo</h1>
          <span className="badge">@livesql/react</span>
        </div>
        <p className="header-subtitle">
          Real-time PostgreSQL → WebSocket → React. Insert a row and watch it appear instantly.
        </p>
      </header>

      <StatsPanel orders={allOrders} />

      <div className="main-grid">
        <div className="left-panel">
          <div className="tabs">
            <button
              className={`tab ${tab === "orders" ? "active" : ""}`}
              onClick={() => setTab("orders")}
            >
              useLiveQuery
            </button>
            <button
              className={`tab ${tab === "table" ? "active" : ""}`}
              onClick={() => setTab("table")}
            >
              useLiveTable
            </button>
          </div>

          {tab === "orders" && (
            <>
              <FilterBar value={statusFilter} onChange={setStatusFilter} />
              <OrderTable orders={filteredOrders} loading={loading} error={error} />
            </>
          )}

          {tab === "table" && <TableView />}
        </div>

        <div className="right-panel">
          <InsertForm />
        </div>
      </div>
    </div>
  );
}
