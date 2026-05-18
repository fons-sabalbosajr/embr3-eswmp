import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { AppErrorBoundary, OfflineBanner } from "./utils/ErrorHandler.jsx";
import { logClientError } from "./api.js";
import "./index.css";

window.addEventListener("error", (event) => {
  logClientError({
    message: event.message || "Unhandled portal runtime error",
    stack: event.error?.stack || "",
    meta: { filename: event.filename, lineno: event.lineno, colno: event.colno },
  });
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason || {};
  logClientError({
    message: reason.message || String(reason) || "Unhandled portal promise rejection",
    stack: reason.stack || "",
  });
});

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AppErrorBoundary>
      <OfflineBanner />
      <App />
    </AppErrorBoundary>
  </StrictMode>
);
