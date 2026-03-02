import { useEffect, useRef, type ReactNode } from "react";
import { LiveSQLClient } from "@livesql/client";
import { LiveSQLContext } from "./context.js";

export interface LiveSQLProviderProps {
  /** WebSocket server URL (ws:// or wss://) */
  url: string;
  /** Called on every connect/reconnect to retrieve the auth token */
  getToken?: () => string | Promise<string>;
  children: ReactNode;
}

/**
 * Provides a shared LiveSQLClient instance to the component tree.
 * Place this near the root of your app, inside your auth boundary.
 *
 * @example
 * <LiveSQLProvider url="wss://api.example.com/livesql" getToken={() => authToken}>
 *   <App />
 * </LiveSQLProvider>
 */
export function LiveSQLProvider({ url, getToken = () => "", children }: LiveSQLProviderProps) {
  const clientRef = useRef<LiveSQLClient | null>(null);

  if (!clientRef.current) {
    clientRef.current = new LiveSQLClient(url, getToken);
  }

  useEffect(() => {
    const client = clientRef.current!;
    client.connect();
    return () => {
      client.disconnect();
    };
    // url and getToken are intentionally excluded — reconnection is managed by LiveSQLClient
  }, []);

  return <LiveSQLContext.Provider value={clientRef.current}>{children}</LiveSQLContext.Provider>;
}
