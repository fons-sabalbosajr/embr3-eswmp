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

// True while the SLF Portal is the active app (including its login/verify pages).
function inPortalApp() {
  return typeof window !== "undefined" && window.location.pathname.includes("/slfportal");
}

// Attach token to every request if available (skip if already set explicitly).
//
// The Portal signs in with `portal_token` and NEVER stores the admin `token`, but
// this interceptor only ever read `token` — so every Portal request that did not
// hand-set its own Authorization header went out with NO credentials at all, and
// any authenticated portal route answered 401. That is why the Portal dashboard
// cards, Data Entry tabs and drafts came up empty.
//
// It also broke Developer Portal Mode in the opposite direction: a developer has
// BOTH tokens in storage, so their Portal requests carried the ADMIN token, and
// the portal-context resolver (which sees a developer with no bound context)
// rejected them.
//
// Pick the token that matches the app the request is coming from.
api.interceptors.request.use((config) => {
  config.headers = config.headers || {};
  if (!config.headers.Authorization) {
    const portalToken = secureStorage.get("portal_token");
    const adminToken = secureStorage.get("token");
    // In the Portal, the portal session wins — even when an admin/developer token
    // is also present in the same browser.
    const token = inPortalApp() ? portalToken || adminToken : adminToken;
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
