import { readable } from "svelte/store";
import type { Readable } from "svelte/store";
import type { ChangeEvent } from "@livesql/core";
import type { LiveSQLClient } from "@livesql/client";

export interface LiveTableOptions<T> {
  /** Server-side filter expression, e.g. "status = pending" */
  filter?: string;
  /** Row primary key field used as the Map key (default: "id") */
  key?: keyof T & string;
}

export interface LiveTableState<T> {
  /** Current Map of rows, keyed by primary key */
  data: Map<string, T>;
  /** True until the subscription is established */
  loading: boolean;
  /** Error received from the server */
  error: Error | null;
}

/**
 * Subscribe to a table and return a Svelte readable store containing
 * a `Map<id, row>` for O(1) row lookups.
 *
 * The store automatically unsubscribes from the server when the last
 * Svelte subscriber unsubscribes (i.e. when the component is destroyed).
 *
 * @example
 * const orders = liveTable(client, "orders");
 * // In template: {#each [...$orders.data.values()] as order}...{/each}
 * // Lookup: $orders.data.get(orderId)
 */
export function liveTable<T extends Record<string, unknown>>(
  client: LiveSQLClient,
  table: string,
  options?: LiveTableOptions<T>,
): Readable<LiveTableState<T>> {
  const keyField = options?.key ?? "id";

  return readable<LiveTableState<T>>({ data: new Map(), loading: false, error: null }, (set) => {
    let data = new Map<string, T>();

    const unsubscribe = client.subscribe<T>(
      table,
      (event: ChangeEvent & { row: T }) => {
        const key = String(event.row[keyField]);
        const next = new Map(data);
        if (event.type === "delete") {
          next.delete(key);
        } else {
          next.set(key, event.row);
        }
        data = next;
        set({ data, loading: false, error: null });
      },
      (err) => {
        set({ data, loading: false, error: new Error(`${err.code}: ${err.message}`) });
      },
      options?.filter,
    );

    return unsubscribe;
  });
}
