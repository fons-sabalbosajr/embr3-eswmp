import axios from "axios";
import secureStorage from "./utils/secureStorage";
import { getAdminDisplayName } from "./utils/adminIdentity";

const api = axios.create({
  baseURL: "/eswm-pipeline/api",
});

let lastClientLogAt = 0;

export function logClientError(payload = {}) {
  const portalUser = secureStorage.getJSON("portal_user") || {};
  const isPortalContext = window.location.pathname.includes("/slfportal") || !!secureStorage.get("portal_token");
  if (!isPortalContext) return;
  const now = Date.now();
  if (now - lastClientLogAt < 1500) return;
  lastClientLogAt = now;
  axios.post("/eswm-pipeline/api/logs/client-error", {
    source: "portal",
    user: portalUser.email || "",
    path: window.location.pathname,
    ...payload,
  }).catch(() => {});
}

// Attach token to every request if available (skip if already set explicitly)
api.interceptors.request.use((config) => {
  config.headers = config.headers || {};
  if (!config.headers.Authorization) {
    const token = secureStorage.get("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  const adminUser = secureStorage.getJSON("user") || {};
  const adminName = getAdminDisplayName(adminUser);
  if (adminName || adminUser.email || adminUser.username) {
    config.headers["X-User-Name"] = adminName || adminUser.username || adminUser.email;
    config.headers["X-User-Email"] = adminUser.email || "";
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const url = error.config?.url || "";
    if (!url.includes("/logs/client-error")) {
      logClientError({
        message: error.response?.data?.message || error.message || "Portal API error",
        meta: {
          url,
          method: error.config?.method,
          status: error.response?.status,
        },
      });
    }
    return Promise.reject(error);
  },
);

export default api;
