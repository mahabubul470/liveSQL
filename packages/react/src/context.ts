import { createContext } from "react";
import type { LiveSQLClient } from "@livesql/client";

export const LiveSQLContext = createContext<LiveSQLClient | null>(null);
