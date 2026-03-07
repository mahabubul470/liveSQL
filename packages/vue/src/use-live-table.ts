import { ref, onScopeDispose } from "vue";
import type { Ref } from "vue";
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
  data: Ref<Map<string, T>>;
  /** True until the subscription is established */
  loading: Ref<boolean>;
  /** Error received from the server */
  error: Ref<Error | null>;
}

/**
 * Subscribe to a table and maintain a reactive Map<id, row>.
 *
 * Use this over useLiveQuery when you need O(1) row lookups by ID,
 * or when rendering large tables with frequent updates.
 *
 * @example
 * const { data } = useLiveTable<Order>("orders");
 * const order = data.value.get(orderId);
 */
export function useLiveTable<T extends Record<string, unknown>>(
  table: string,
  options?: UseLiveTableOptions<T>,
): UseLiveTableResult<T> {
  const client = useLiveSQLClient();
  const keyField = options?.key ?? "id";

  const data = ref<Map<string, T>>(new Map()) as Ref<Map<string, T>>;
  const loading = ref(true);
  const error = ref<Error | null>(null);

  const unsubscribe = client.subscribe<T>(
    table,
    (event: ChangeEvent & { row: T }) => {
      const key = String(event.row[keyField]);
      const next = new Map(data.value);
      if (event.type === "delete") {
        next.delete(key);
      } else {
        next.set(key, event.row);
      }
      data.value = next;
      loading.value = false;
    },
    (err) => {
      error.value = new Error(`${err.code}: ${err.message}`);
      loading.value = false;
    },
    options?.filter,
  );

  loading.value = false;

  onScopeDispose(unsubscribe);

  return { data, loading, error };
}
