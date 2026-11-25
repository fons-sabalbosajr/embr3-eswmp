import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  plugins: [
    react({
      // Babel's default `compact: "auto"` switches to compact output — and logs
      // "[BABEL] Note: The code generator has deoptimised the styling …" — for
      // any file over 500 KB. SLFPortal/index.jsx is past that. Output is
      // minified for production anyway, so keep normal formatting (readable in
      // dev tools) and no note. The lasting fix is splitting that file up.
      babel: { compact: false },
    }),
  ],
  // The app version comes from package.json at build time, so the version shown
  // in the admin sider can never drift from the released one again — it had been
  // hardcoded at v1.0.0 while the app was on 1.5.0.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  base: "/eswm-pipeline/",
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/eswm-pipeline/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/eswm-pipeline/, ""),
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
  },
});
