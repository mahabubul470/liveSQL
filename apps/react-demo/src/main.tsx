import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LiveSQLProvider } from "@livesql/react";
import { App } from "./App.js";
import "./App.css";

const root = document.getElementById("root");
if (!root) throw new Error("No #root element");

createRoot(root).render(
  <StrictMode>
    <LiveSQLProvider url="ws://localhost:3001" getToken={() => ""}>
      <App />
    </LiveSQLProvider>
  </StrictMode>,
);
