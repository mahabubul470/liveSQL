import type { App } from "vue";
import { LiveSQLClient } from "@livesql/client";
import { LIVESQL_CLIENT_KEY } from "./keys.js";

export interface LiveSQLPluginOptions {
  /** WebSocket server URL (ws:// or wss://) */
  url: string;
  /** Called on every connect/reconnect to retrieve the auth token */
  getToken?: () => string | Promise<string>;
}

/**
 * Vue plugin that creates a shared LiveSQLClient and makes it available
 * to all components via `useLiveSQLClient()`.
 *
 * @example
 * app.use(createLiveSQLPlugin({ url: "wss://api.example.com/livesql", getToken: () => token }))
 */
export function createLiveSQLPlugin(options: LiveSQLPluginOptions) {
  const client = new LiveSQLClient(options.url, options.getToken ?? (() => ""));

  return {
    install(app: App): void {
      client.connect();
      app.provide(LIVESQL_CLIENT_KEY, client);

      app.config.globalProperties.$livesql = client;

      // Disconnect when the app is unmounted
      const originalUnmount = app.unmount.bind(app);
      app.unmount = () => {
        client.disconnect();
        originalUnmount();
      };
    },
  };
}
