import { inject } from "vue";
import type { LiveSQLClient } from "@livesql/client";
import { LIVESQL_CLIENT_KEY } from "./keys.js";

/**
 * Access the raw LiveSQLClient from the Vue plugin injection.
 * For advanced use cases — prefer useLiveQuery for most scenarios.
 *
 * @throws If called outside a component that has the LiveSQL plugin installed.
 */
export function useLiveSQLClient(): LiveSQLClient {
  const client = inject(LIVESQL_CLIENT_KEY);
  if (!client) {
    throw new Error(
      "useLiveSQLClient: no LiveSQL client found. Did you install createLiveSQLPlugin?",
    );
  }
  return client;
}
