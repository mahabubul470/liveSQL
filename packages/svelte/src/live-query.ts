import { readable } from "svelte/store";
import type { Readable } from "svelte/store";
import type { ChangeEvent } from "@livesql/core";
import type { LiveSQLClient } from "@livesql/client";

export interface LiveQueryOptions<T> {
  /** Server-side filter expression, e.g. "status = pending" */
  filter?: string;
  /** Seed the store with pre-fetched data to avoid an empty initial render */
  initialData?: T[];
  /** Row primary key field used to match rows on update/delete (default: "id") */
  key?: keyof T & string;
}

export interface LiveQueryState<T> {
  /** Current array of rows */
  data: T[];
  /** True until the subscription is established */
  loading: boolean;
  /** Error received from the server (e.g. FORBIDDEN, TABLE_NOT_FOUND) */
  error: Error | null;
}

/**
 * Subscribe to a table and return a Svelte readable store containing
 * `{ data, loading, error }`.
 *
 * The store automatically unsubscribes from the server when the last
 * Svelte subscriber unsubscribes (i.e. when the component is destroyed).
 *
 * @example
 * const orders = liveQuery(client, "orders", { filter: "status = pending" });
 * // In template: {#each $orders.data as order}...{/each}
 */
export function liveQuery<T extends Record<string, unknown>>(
  client: LiveSQLClient,
  table: string,
  options?: LiveQueryOptions<T>,
): Readable<LiveQueryState<T>> {
  const keyField = options?.key ?? "id";

  return readable<LiveQueryState<T>>(
    { data: options?.initialData ?? [], loading: false, error: null },
    (set) => {
      let data: T[] = options?.initialData ?? [];

      const unsubscribe = client.subscribe<T>(
        table,
        (event: ChangeEvent & { row: T }) => {
          data = applyEvent(data, event, keyField);
          set({ data, loading: false, error: null });
        },
        (err) => {
          set({ data, loading: false, error: new Error(`${err.code}: ${err.message}`) });
        },
        options?.filter,
      );

      return unsubscribe;
    },
  );
}

function applyEvent<T extends Record<string, unknown>>(
  prev: T[],
  event: ChangeEvent & { row: T },
  keyField: string,
): T[] {
  switch (event.type) {
    case "insert":
      return [...prev, event.row];
    case "update":
      return prev.map((row) => (row[keyField] === event.row[keyField] ? event.row : row));
    case "delete":
      return prev.filter((row) => row[keyField] !== event.row[keyField]);
  }
}
