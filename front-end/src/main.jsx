import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { AppErrorBoundary, OfflineBanner } from "./utils/ErrorHandler.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AppErrorBoundary>
      <OfflineBanner />
      <App />
    </AppErrorBoundary>
  </StrictMode>
);
