// ── SLF Portal — Constants & Utilities ──

export const PORTAL_SETTINGS_CACHE_KEY = "portal-settings-cache";
export const PORTAL_SUBMISSIONS_CACHE_KEY = "portal-submissions-cache";
export const PORTAL_WASTE_RECEIVED_CACHE_KEY = "portal-waste-received-cache";
export const PORTAL_CACHE_TTL = 2 * 60 * 1000;
export const PORTAL_UPDATE_TOUR_SEEN_PREFIX = "slf-portal-update-tour-seen-";
export const PORTAL_TOUR_DISMISSED_PREFIX = "slf-portal-tour-dismissed-"; // stable per-user key
// Local mirror of the FEATURE tour marker. Holds a release VERSION, not "1" —
// the value is compared against PORTAL_FEATURE_TOUR_VERSION so the next release
// shows again. See portalFeatureTour.js.
export const PORTAL_FEATURE_TOUR_SEEN_PREFIX = "slf-portal-feature-tour-seen-";
// The permanent "Don't show this again" for the feature tour, kept apart from the
// per-release marker above — see portalFeatureTourOptOutAt in models/UserPortal.js.
export const PORTAL_FEATURE_TOUR_OPT_OUT_PREFIX = "slf-portal-feature-tour-optout-";
export const ORGANIZE_CELLS_ENABLED = true;

// Request/amendment type → label + tag color, used by the "My Requests" table.
export const REQUEST_TYPE_MAP = {
  baseline_update_request: {
    label: "Baseline Update Request",
    color: "blue",
  },
  baseline_update_approved: {
    label: "Baseline Update Approved",
    color: "green",
  },
  // A rejection is logged under the request type with meta.action "rejected";
  // the server names it this way (row.displayType) so it does not read as a
  // second request.
  baseline_update_rejected: {
    label: "Baseline Update Rejected",
    color: "red",
  },
  submission_edit_request: { label: "Edit Request", color: "blue" },
  submission_edit_approved: { label: "Edit Approved", color: "green" },
  submission_edit_rejected: { label: "Edit Rejected", color: "red" },
  support_ticket: { label: "Support Ticket", color: "purple" },
  support_ticket_reply: { label: "Support Reply", color: "cyan" },
};

export const EMPTY_TRUCK = {
  disposalTicketNo: "",
  hauler: "",
  plateNumber: "",
  truckCapacity: null,
  truckCapacityUnit: "m³",
  vehicles: [],
  actualVolume: null,
  actualVolumeUnit: "m³",
  wasteType: undefined,
  hazWasteCode: [],
  cellName: "",
  cellType: "",
  cellIndex: null,
};

export const KNOWN_TRANSPORT_KEYS = new Set([
  "disposalTicketNo",
  "hauler",
  "plateNumber",
  "truckCapacity",
  "actualVolume",
  "wasteType",
  "hazWasteCode",
]);

export const EMPTY_VEHICLE = {
  plateNumber: "",
  vehicleType: "",
  capacity: null,
  capacityUnit: "m³",
  // Per-vehicle waste placement: each vehicle's waste goes to a specific open cell.
  actualVolume: null,
  actualVolumeUnit: "m³",
  wasteType: undefined,
  hazWasteCode: [],
  cellName: "",
  cellType: "",
  cellIndex: null,
};

export const EMPTY_HAULER = {
  haulerName: "",
  numberOfTrucks: null,
  officeAddress: "",
  officeRegion: "",
  officeProvince: "",
  officeCity: "",
  officeBarangay: "",
  vehicles: [],
  privateSectorClients: [],
};

/**
 * A fresh idempotency key for one draft/schedule SAVE action.
 *
 * Sent as `clientRequestId`. The server stores it against the queue record
 * (unique per user), so an axios retry — or a request the browser sent twice —
 * returns the record that was already created instead of duplicating it.
 * `withRetry` above makes retries genuinely likely, which is why this matters.
 */
export function newClientRequestId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `req-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

/**
 * Retry helper: calls fn up to `retries` times with exponential backoff.
 * Skips retries when browser is offline. Respects AbortSignal.
 */
export function withRetry(fn, { retries = 3, baseDelay = 1000, signal } = {}) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      if (signal?.aborted)
        return reject(new DOMException("Aborted", "AbortError"));
      fn()
        .then(resolve)
        .catch((err) => {
          if (err?.name === "AbortError" || err?.code === "ERR_CANCELED")
            return reject(err);
          // Never retry client errors (4xx). Retrying a 429 (Too Many Requests)
          // only feeds the rate limiter and turns a single throttle into a storm;
          // other 4xx (400/401/403/404) are deterministic and won't succeed on a
          // repeat. Only transient failures (network errors, 5xx) are retried.
          const status = err?.response?.status;
          if (typeof status === "number" && status >= 400 && status < 500)
            return reject(err);
          if (n >= retries || !navigator.onLine) return reject(err);
          setTimeout(() => attempt(n + 1), baseDelay * 2 ** n);
        });
    };
    attempt(0);
  });
}
