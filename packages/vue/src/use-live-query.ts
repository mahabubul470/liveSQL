import { ref, onScopeDispose } from "vue";
import type { Ref } from "vue";
import type { ChangeEvent } from "@livesql/core";
import { useLiveSQLClient } from "./use-live-sql-client.js";

export interface UseLiveQueryOptions<T> {
  /** Server-side filter expression, e.g. "status = pending" */
  filter?: string;
  /** Seed the composable with pre-fetched data to avoid an empty initial render */
  initialData?: T[];
  /** Row primary key field used to match rows on update/delete (default: "id") */
  key?: keyof T & string;
}

export interface UseLiveQueryResult<T> {
  /** Current reactive array of rows */
  data: Ref<T[]>;
  /** True until the subscription is established */
  loading: Ref<boolean>;
  /** Error received from the server (e.g. FORBIDDEN, TABLE_NOT_FOUND) */
  error: Ref<Error | null>;
}

/**
 * Subscribe to a table and maintain a reactive array of rows.
 *
 * - **insert** → row appended
 * - **update** → matching row replaced (by `key` field, default "id")
 * - **delete** → matching row removed
 *
 * @example
 * const { data, loading } = useLiveQuery<Order>("orders", { filter: "status = pending" })
 */
export function useLiveQuery<T extends Record<string, unknown>>(
  table: string,
  options?: UseLiveQueryOptions<T>,
): UseLiveQueryResult<T> {
  const client = useLiveSQLClient();
  const keyField = options?.key ?? "id";

  const data = ref<T[]>(options?.initialData ?? []) as Ref<T[]>;
  const loading = ref(true);
  const error = ref<Error | null>(null);

  const unsubscribe = client.subscribe<T>(
    table,
    (event: ChangeEvent & { row: T }) => {
      loading.value = false;
      data.value = applyEvent(data.value, event, keyField);
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
