import { useState, useEffect } from "react";
import type { ChangeEvent } from "@livesql/core";
import { useLiveSQLClient } from "./use-live-sql-client.js";

export interface UseLiveTableOptions<T> {
  /** Server-side filter expression, e.g. "status = pending" */
  filter?: string;
  /** Row primary key field used as the Map key (default: "id") */
  key?: keyof T & string;
}

export interface UseLiveTableResult<T> {
  /** Current reactive Map of rows, keyed by primary key */
  data: Map<string, T>;
  /** True until the subscription is established */
  loading: boolean;
  /** Error received from the server */
  error: Error | null;
}

/**
 * Subscribe to a table and maintain a reactive Map<id, row>.
 *
 * Use this over useLiveQuery when you need O(1) row lookups by ID,
 * or when rendering large tables with frequent updates.
 *
 * @example
 * const { data } = useLiveTable<Order>("orders");
 * const order = data.get(orderId);
 */
export function useLiveTable<T extends Record<string, unknown>>(
  table: string,
  options?: UseLiveTableOptions<T>,
): UseLiveTableResult<T> {
  const client = useLiveSQLClient();
  const keyField = options?.key ?? "id";

  const [data, setData] = useState<Map<string, T>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const unsubscribe = client.subscribe<T>(
      table,
      (event: ChangeEvent & { row: T }) => {
        const key = String(event.row[keyField]);
        setData((prev) => {
          const next = new Map(prev);
          if (event.type === "delete") {
            next.delete(key);
          } else {
            next.set(key, event.row);
          }
          return next;
        });
      },
      (err) => {
        setError(new Error(`${err.code}: ${err.message}`));
        setLoading(false);
      },
      options?.filter,
    );

    setLoading(false);

    return unsubscribe;
  }, [client, table, options?.filter, keyField]);

  return { data, loading, error };
}
