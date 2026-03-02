import { useContext } from "react";
import type { LiveSQLClient } from "@livesql/client";
import { LiveSQLContext } from "./context.js";

/**
 * Access the raw LiveSQLClient from context.
 * For advanced use cases — prefer useLiveQuery for most scenarios.
 *
 * @throws If called outside of <LiveSQLProvider>
 */
export function useLiveSQLClient(): LiveSQLClient {
  const client = useContext(LiveSQLContext);
  if (!client) {
    throw new Error("useLiveSQLClient must be used inside <LiveSQLProvider>");
  }
  return client;
}
