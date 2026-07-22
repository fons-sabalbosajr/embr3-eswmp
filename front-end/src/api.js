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

// ── Error classification (shared by logging + retry + user feedback) ──
export function classifyError(error) {
  if (error?.code === "ERR_CANCELED" || error?.name === "CanceledError") return "canceled";
  const status = error?.response?.status;
  if (!error?.response) {
    if (error?.code === "ECONNABORTED" || /timeout/i.test(error?.message || "")) return "timeout";
    return "network";
  }
  if (status === 401) return "authentication";
  if (status === 403) return "authorization";
  if (status === 409) return "conflict";
  if (status === 422 || status === 400) return "validation";
  if (status === 408 || status === 504) return "timeout";
  if (status >= 500) return "server";
  return "unknown";
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retry only SAFE reads (GET) on transient failures — network/timeout or
// 502/503/504 — with exponential backoff + jitter, capped at 2 retries. Writes
// (POST/PUT/PATCH/DELETE) and validation/auth errors are NEVER auto-retried.
const RETRYABLE_STATUS = new Set([502, 503, 504]);
const MAX_RETRIES = 2;
function isRetryable(error) {
  const cfg = error?.config;
  if (!cfg || cfg.__noRetry) return false;
  if (String(cfg.method || "get").toLowerCase() !== "get") return false;
  const cat = classifyError(error);
  if (cat === "network" || cat === "timeout") return true;
  return RETRYABLE_STATUS.has(error?.response?.status);
}

// ── Centralized session-expiration handling ──
// The app has NO refresh-token flow, so an expired/invalid token cannot be
// silently renewed. Instead of letting every in-flight request fail with a
// generic error, the FIRST 401 in the portal clears the invalid session, saves
// the intended route, flags a session-expired message, and redirects to login
// exactly once (guarded so there is no redirect/refresh loop).
let sessionExpiring = false;
function isAuthEndpoint(url = "") {
  return /\/portal-auth\/(login|forgot|reset)|\/dev-portal\/(override|verify-pin)|\/auth\/(login|forgot|reset)/.test(url);
}
function handleSessionExpiry() {
  if (sessionExpiring) return;
  sessionExpiring = true;
  try {
    const portal = inPortalApp();
    const loginPath = portal ? "/slfportal/login" : "/admin/login";
    const here = window.location.pathname + window.location.search;
    if (!/\/login$/.test(window.location.pathname)) {
      try { sessionStorage.setItem(portal ? "portal_return_to" : "admin_return_to", here); } catch { /* ignore */ }
    }
    try { sessionStorage.setItem("session_expired", "1"); } catch { /* ignore */ }
    // Drop the invalid auth state (never the whole store — keep drafts/prefs).
    secureStorage.remove(portal ? "portal_token" : "token");
    window.dispatchEvent(new CustomEvent("session-expired"));
    if (window.location.pathname !== loginPath) window.location.assign(loginPath);
  } finally {
    // Allow a future genuine expiry after navigation settles.
    setTimeout(() => { sessionExpiring = false; }, 4000);
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const cfg = error.config || {};
    const url = cfg.url || "";
    const category = classifyError(error);

    // Retry safe reads on transient failures (does not touch writes/validation).
    if (isRetryable(error)) {
      cfg.__retryCount = (cfg.__retryCount || 0) + 1;
      if (cfg.__retryCount <= MAX_RETRIES) {
        const backoff = 400 * 2 ** (cfg.__retryCount - 1) + Math.floor(Math.random() * 200);
        await sleep(backoff);
        return api(cfg);
      }
    }

    // Session expiry: a 401 on an AUTHENTICATED endpoint (not the login/refresh
    // endpoints, where 401 just means bad credentials).
    if (category === "authentication" && !isAuthEndpoint(url)) {
      handleSessionExpiry();
    }

    if (!url.includes("/logs/client-error") && category !== "canceled") {
      // NB: never logs tokens/bodies — only url, method, status, category, retries.
      logClientError({
        message: error.response?.data?.message || error.message || "Portal API error",
        meta: {
          url,
          method: cfg.method,
          status: error.response?.status,
          category,
          retryCount: cfg.__retryCount || 0,
        },
      });
    }
    return Promise.reject(error);
  },
);

// ── In-flight GET de-duplication ────────────────────────────────────────────
//
// The Portal mounts many effects at once and (under React Strict Mode) runs each
// twice, so identical reads — most notably /portal-auth/me and
// /portal-auth/my-submissions — fire two or more concurrent requests. Against the
// portal-auth rate limiter that alone doubled the request count for no benefit.
//
// Collapse concurrent identical GETs onto a SINGLE network request: the first call
// makes the request, any caller that asks for the same url+params while it is still
// in flight receives the same promise, and the entry is cleared as soon as it
// settles. Requests that pass their own AbortSignal opt out (aborting a shared
// promise would cancel it for the other caller), so cancellation semantics are
// preserved for the effects that rely on them.
const inFlightGets = new Map();
const originalGet = api.get.bind(api);
api.get = function dedupedGet(url, config = {}) {
  if (config && config.signal) return originalGet(url, config);
  const key = `${url}::${JSON.stringify(config?.params || {})}`;
  const existing = inFlightGets.get(key);
  if (existing) return existing;
  const promise = originalGet(url, config).finally(() => {
    inFlightGets.delete(key);
  });
  inFlightGets.set(key, promise);
  return promise;
};

export default api;
