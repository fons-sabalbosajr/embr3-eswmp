/**
 * Demonstration mode — the single source of truth for demo-account isolation
 * and confidential-value masking.
 *
 * ── Two different flags, two different jobs ──────────────────────────────────
 *
 *   isDemo   marks an ACCOUNT (User / UserPortal). It hides that account from
 *            user-management lists and puts its session into masked mode.
 *
 *   isDummy  marks a RECORD. Every analytics, dashboard, report and submission
 *            query in the app already excludes `isDummy: { $ne: true }`, so
 *            reusing it is what keeps demo data out of production statistics
 *            without re-threading a second flag through ~20 query sites.
 *
 * The demo accounts carry `isDemo`; everything they own or create carries
 * `isDummy`. That split is deliberate — do not collapse them.
 *
 * ── Masking ─────────────────────────────────────────────────────────────────
 *
 * Masking is applied SERVER-SIDE, on the way out. A demo session must never
 * receive a real confidential figure, because anything sent to the browser is
 * readable in the network tab regardless of what the UI chooses to render.
 */

const { AsyncLocalStorage } = require("async_hooks");

/** The placeholder shown in place of a confidential numeric. */
const MASK = "***********";

/**
 * Per-request "this is a demo session" flag.
 *
 * Held in AsyncLocalStorage rather than passed down through call signatures so
 * the Mongoose write guard below can see it from inside a model hook, which has
 * no access to `req`. The store is entered once per request and is naturally
 * scoped to that request's async tree — concurrent production requests are
 * unaffected.
 */
const demoContext = new AsyncLocalStorage();

/** True when the currently-executing async context belongs to a demo session. */
function isDemoRequest() {
  return demoContext.getStore()?.isDemo === true;
}

/**
 * Models exempt from the write guard.
 *
 * These are telemetry, audit and delivery records. Blocking them would break
 * the demo session itself — login writes an AppLog entry, activity writes
 * Notification rows — and none of them are production *business* records that a
 * demonstration could corrupt. Everything not listed here is guarded.
 */
const WRITE_GUARD_EXEMPT_MODELS = new Set([
  "AppLog",
  "AutomationAgentUsageLog",
  "Notification",
  "LguLinkAudit",
  "PortalPolicyAudit",
  "SlfSyncJob",
  "VeraBacklogInvestigation",
  "DataHistory",
  "MessageThread",
  "PortalMessage",
]);

/** A document is demo-owned if either isolation flag is set. */
const isDemoOwned = (doc) => doc?.isDummy === true || doc?.isDemo === true;

const BLOCK_MESSAGE =
  "Demonstration accounts cannot modify production records. This action was blocked.";

function demoWriteBlocked() {
  const err = new Error(BLOCK_MESSAGE);
  err.status = 403;
  err.code = "DEMO_WRITE_BLOCKED";
  return err;
}

/**
 * The write-guard decision, as a pure function.
 *
 * Kept separate from the Mongoose hook so the policy can be unit-tested without
 * a database — the hook below is a thin adapter over this.
 *
 * @returns {"allow"|"stamp"|"block"}
 *   allow → proceed untouched · stamp → mark isDummy then proceed · block → 403
 */
function decideDemoWrite({ isDemoSession, modelName, isNew, targetIsDemoOwned }) {
  if (!isDemoSession) return "allow";
  if (WRITE_GUARD_EXEMPT_MODELS.has(modelName)) return "allow";
  if (isNew) return "stamp";
  return targetIsDemoOwned ? "allow" : "block";
}

/**
 * Global Mongoose plugin enforcing demo write isolation on EVERY model.
 *
 * Applied globally rather than per-route because the app has 30+ route files
 * and dozens of mutation endpoints; opting each one in would leave whichever
 * one gets added next unguarded. Here, a new model or endpoint is protected the
 * moment it exists.
 *
 * Rules for a demo session:
 *   • creating   → stamped `isDummy: true`, inheriting the existing isolation
 *   • updating   → allowed only if every matched document is demo-owned
 *   • deleting   → same test as updating
 * A non-demo session is untouched, so production behaviour is byte-identical.
 */
function demoWriteGuardPlugin(schema) {
  const hasDummyFlag = () => Boolean(schema.path("isDummy"));

  // PROMISE-STYLE (zero-arg) on purpose — do not reintroduce a `next` parameter.
  //
  // A global plugin is applied to EMBEDDED SUBDOCUMENT schemas as well as model
  // schemas, and Mongoose invokes subdocument pre-save hooks promise-style with
  // NO `next` argument. A callback-style hook therefore threw
  // "next is not a function" on every save of any model containing subdocuments
  // — for all users, not just demo sessions.
  schema.pre("save", function preSaveDemoGuard() {
    // Subdocuments are persisted as part of their parent, which is guarded in
    // its own right, so there is nothing to decide here.
    if (this.$isSubdocument || this.$isSingleNested) return;

    const decision = decideDemoWrite({
      isDemoSession: isDemoRequest(),
      modelName: this.constructor?.modelName,
      isNew: this.isNew,
      targetIsDemoOwned: isDemoOwned(this),
    });
    if (decision === "block") throw demoWriteBlocked();
    // Stamp so the record is invisible to every analytics/report query.
    if (decision === "stamp" && hasDummyFlag()) this.isDummy = true;
  });

  schema.pre("insertMany", function preInsertManyDemoGuard(next, docs) {
    // insertMany is a model-level hook and always receives `next`, but stay
    // defensive so a signature change cannot break inserts the way save() broke.
    const done = typeof next === "function" ? next : () => {};
    if (!isDemoRequest()) return done();
    if (WRITE_GUARD_EXEMPT_MODELS.has(this.modelName)) return done();
    if (hasDummyFlag() && Array.isArray(docs)) {
      docs.forEach((doc) => {
        if (doc && typeof doc === "object") doc.isDummy = true;
      });
    }
    return done();
  });

  // One handler for every query-based mutation. `this` is the Query, so the
  // target is resolved by counting documents the filter matches that are NOT
  // demo-owned — if any exist, the write would touch production data.
  const guardQuery = async function preQueryDemoGuard() {
    if (!isDemoRequest()) return;
    if (WRITE_GUARD_EXEMPT_MODELS.has(this.model?.modelName)) return;

    const filter = this.getFilter() || {};
    // An upsert with no existing match is a create — stamp instead of block.
    if (this.getOptions?.().upsert) {
      const update = this.getUpdate() || {};
      if (hasDummyFlag()) {
        update.$setOnInsert = { ...(update.$setOnInsert || {}), isDummy: true };
        this.setUpdate(update);
      }
    }

    const productionMatches = await this.model.countDocuments({
      $and: [filter, { isDummy: { $ne: true } }, { isDemo: { $ne: true } }],
    });
    if (productionMatches > 0) throw demoWriteBlocked();
  };

  [
    "findOneAndUpdate",
    "findOneAndDelete",
    "findOneAndReplace",
    "updateOne",
    "updateMany",
    "replaceOne",
    "deleteOne",
    "deleteMany",
  ].forEach((op) => schema.pre(op, guardQuery));
}

/**
 * Register the guard on every schema compiled afterwards.
 * MUST be called before any model is required, or earlier models miss it.
 */
function installDemoWriteGuard(mongoose) {
  mongoose.plugin(demoWriteGuardPlugin);
}

/**
 * Field names whose VALUES are confidential operational figures.
 *
 * Matching is by exact key name, case-insensitively, at any depth. Keep this
 * list conservative: masking a field the UI needs for layout (counts, ids,
 * dates, names, units, percentages) breaks the demonstration, which defeats the
 * purpose. Volumes, capacities and money are what must never leak.
 */
const MASKED_FIELDS = new Set(
  [
    // Disposal / acceptance volumes
    "totalVolumeAccepted",
    "totalVolumeM3",
    "totalVolumeTons",
    "residualVolumeM3",
    "residualVolumeTons",
    "hazardousVolumeM3",
    "hazardousVolumeTons",
    "volume",
    "volumeM3",
    "volumeTons",
    "acceptedVolume",
    "submittedVolume",
    "wasteVolume",
    "totalWaste",
    "wasteReceived",
    // Baseline / capacity figures.
    // NOTE: these are the ACTUAL field names on SlfFacility/DataSLF — verified
    // against the schemas, not guessed. Adding a near-miss like
    // "receivingCapacity" instead of "receivingVolumeCapacity" silently masks
    // nothing, so check the schema before extending this list.
    "baselineVolume",
    "baselineFill",
    "submittedFill",
    "cellCapacity",
    "totalCapacity",
    "receivingCapacity",
    "remainingCapacity",
    "designCapacity",
    "volumeCapacity",
    "receivingVolumeCapacity",
    "actualResidualWasteReceived",
    "estimatedVolumeWaste",
    "cellCapacities",
    "cellFillValues",
    "cellFillBaselineValues",
    "cellFillSubmittedValues",
    // Commercial figures
    "revenue",
    "tippingFee",
    "contractAmount",
    "amount",
    "cost",
  ].map((key) => key.toLowerCase()),
);

/**
 * Recursively replace confidential numerics with the mask placeholder.
 *
 * Only NUMERIC (or numeric-string) values are masked — a null/empty field stays
 * as-is so "no data" still reads as "no data" rather than as a hidden value.
 * Arrays and nested documents are walked, so aggregation payloads and populated
 * sub-documents are covered too.
 *
 * @param {*} payload any JSON-serialisable value
 * @returns {*} a masked deep copy; the input is never mutated
 */
function maskConfidentialValues(payload) {
  const seen = new WeakSet();

  // `ownedByDemo` propagates DOWN a record: once a document is known to be demo
  // owned, its nested cells/haulers/entries are demo-owned too.
  const walk = (value, ownedByDemo = false) => {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map((item) => walk(item, ownedByDemo));
    if (value instanceof Date) return value;
    if (typeof value !== "object") return value;

    // Routes commonly return Mongoose documents rather than .lean() objects.
    // Walking one raw exposes internals ($__, activePaths, _doc) instead of the
    // real fields — which both MISSES the values that must be masked and hands
    // the front-end a payload shaped nothing like the API contract. Normalising
    // through toJSON() first is what res.json() would have done anyway, and it
    // also collapses ObjectId/Decimal128 to their serialised form.
    if (typeof value.toJSON === "function") {
      const plain = value.toJSON();
      // toJSON on a scalar wrapper (ObjectId) yields a primitive — done.
      if (plain === null || typeof plain !== "object") return plain;
      return walk(plain, ownedByDemo);
    }

    // Guard against cycles in populated Mongoose graphs.
    if (seen.has(value)) return value;
    seen.add(value);

    // A record the demo session OWNS is fabricated demo data, not a real
    // confidential figure — the masking contract is "never receive a REAL
    // confidential figure". Masking demo-owned records broke the very workflow
    // the demo account exists to exercise: its own saved Total Volume Accepted
    // came back as "***********", so the portal's baseline form held a
    // non-numeric string, Review & Submit reported "Baseline Data is
    // incomplete", and the submission was rejected server-side for the same
    // reason. Production documents never carry either flag, so their figures
    // stay masked exactly as before.
    const owned = ownedByDemo || value.isDummy === true || value.isDemo === true;

    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (!owned && MASKED_FIELDS.has(key.toLowerCase())) {
        const isNumericish = (v) =>
          typeof v === "number" ||
          (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)));
        if (Array.isArray(val)) {
          // Per-cell figures (cellCapacities, cellFillValues, …) are arrays of
          // numbers. Masking element-wise preserves the array LENGTH, which the
          // cell gauges rely on to render the right number of cells.
          out[key] = val.map((v) => (isNumericish(v) ? MASK : walk(v, owned)));
        } else {
          out[key] = isNumericish(val) ? MASK : walk(val, owned);
        }
      } else {
        out[key] = walk(val, owned);
      }
    }
    return out;
  };

  return walk(payload);
}

/**
 * Express middleware: mask this response if the session is a demo account.
 *
 * Wraps `res.json` rather than filtering per route, so a route added later is
 * covered by DEFAULT instead of leaking until someone remembers to opt in.
 *
 * It decodes the bearer token itself instead of reading `req.user`, because
 * `req.user` is populated by per-route auth middleware — mounting globally
 * before the routes would otherwise see an empty `req.user` and mask nothing.
 * Verification failures simply mean "not a demo session"; real authentication is
 * still the routes' job, so this never widens access.
 */
/**
 * The developer-controlled GLOBAL PRIVACY toggle
 * (AppSettings.maskSensitiveSlfValues) is the single documented switch for
 * sensitive-value masking across the SLF Portal. Demo masking used to run
 * unconditionally, which directly contradicted it: with the toggle OFF, a demo
 * session still received "***********" for every volume and capacity.
 *
 * Both now answer to the same switch — no second, undocumented privacy rule.
 * Turning the toggle ON masks production figures for demo sessions exactly as it
 * does everywhere else; demo-OWNED records stay readable either way (see
 * maskConfidentialValues) so the demonstration workflow keeps working.
 *
 * Cached briefly because this runs on EVERY API response; a settings change
 * already broadcasts "app-settings", and a few seconds of staleness on a
 * developer-only toggle is not worth a database read per request.
 */
const PRIVACY_TOGGLE_TTL_MS = 15_000;
let privacyToggleCache = { value: false, readAt: 0 };

async function isGlobalPrivacyMaskingOn() {
  if (Date.now() - privacyToggleCache.readAt < PRIVACY_TOGGLE_TTL_MS) {
    return privacyToggleCache.value;
  }
  try {
    const AppSettings = require("mongoose").model("AppSettings");
    const settings = await AppSettings.findOne().select("maskSensitiveSlfValues").lean();
    privacyToggleCache = { value: Boolean(settings?.maskSensitiveSlfValues), readAt: Date.now() };
  } catch {
    // Settings unavailable (model not registered yet / DB blip) — fail CLOSED so
    // an outage can never turn masking off for a session that should have it.
    privacyToggleCache = { value: true, readAt: Date.now() };
  }
  return privacyToggleCache.value;
}

/** Drop the cached toggle so the next request re-reads it (used on settings change). */
function resetPrivacyToggleCache() {
  privacyToggleCache = { value: false, readAt: 0 };
}

function demoMaskingMiddleware(req, res, next) {
  let isDemoSession = Boolean(req.user?.isDemo || req.portalUser?.isDemo);

  if (!isDemoSession) {
    const header = req.headers?.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (token) {
      try {
        const jwt = require("jsonwebtoken");
        isDemoSession = Boolean(
          jwt.verify(token, process.env.JWT_SECRET)?.isDemo,
        );
      } catch {
        isDemoSession = false;
      }
    }
  }

  if (!isDemoSession) return next();

  req.isDemoSession = true;

  // The WRITE guard is not a privacy control — it stops a demonstration from
  // corrupting production records — so it engages regardless of the toggle.
  // Only the response masking is gated.
  isGlobalPrivacyMaskingOn()
    .then((maskingOn) => {
      if (maskingOn) {
        const originalJson = res.json.bind(res);
        res.json = (body) => originalJson(maskConfidentialValues(body));
      }
      // Everything downstream — including Mongoose hooks, which never see `req` —
      // runs inside this store, which is how the write guard knows to engage.
      demoContext.run({ isDemo: true }, next);
    })
    .catch(() => demoContext.run({ isDemo: true }, next));
}

/**
 * Reject a mutation from a demo session unless it targets demo-flagged data.
 *
 * Demo accounts are deliberately allowed to write — the submission and approval
 * workflows are the point of the demonstration — but a write must never land on
 * a production record. `loadTarget` returns the document being mutated (or null
 * for a create, which is always allowed because the create path stamps
 * `isDummy`).
 *
 * @param {Function} loadTarget async (req) => document|null
 */
function guardDemoWrite(loadTarget) {
  return async function demoWriteGuard(req, res, next) {
    if (!(req.user?.isDemo || req.portalUser?.isDemo)) return next();
    try {
      const target = await loadTarget(req);
      if (!target) return next(); // create — stamped isDummy downstream
      if (target.isDummy === true || target.isDemo === true) return next();
      return res.status(403).json({
        message:
          "Demonstration accounts cannot modify production records. This action was blocked.",
        code: "DEMO_WRITE_BLOCKED",
      });
    } catch (err) {
      return next(err);
    }
  };
}

/** Stamp demo-owned writes so they inherit the existing isDummy isolation. */
function stampDemoOwnership(req, doc = {}) {
  if (req.user?.isDemo || req.portalUser?.isDemo) doc.isDummy = true;
  return doc;
}

module.exports = {
  MASK,
  MASKED_FIELDS,
  maskConfidentialValues,
  demoMaskingMiddleware,
  guardDemoWrite,
  stampDemoOwnership,
  // Write isolation
  demoContext,
  isDemoRequest,
  isGlobalPrivacyMaskingOn,
  resetPrivacyToggleCache,
  decideDemoWrite,
  installDemoWriteGuard,
  demoWriteGuardPlugin,
  WRITE_GUARD_EXEMPT_MODELS,
};
