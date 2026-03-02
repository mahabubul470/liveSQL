import type { InjectionKey } from "vue";
import type { LiveSQLClient } from "@livesql/client";

/** Injection key for the LiveSQLClient instance */
export const LIVESQL_CLIENT_KEY: InjectionKey<LiveSQLClient> = Symbol("livesql-client");
