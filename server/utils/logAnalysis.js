/**
 * VERA log detection — evidence-based pattern analysis over AppLog.
 *
 * ── Why this is deterministic, not a prompt ─────────────────────────────────
 * Every finding here is produced by a MongoDB aggregation over real log records,
 * and every finding carries the counts and sample records it was derived from.
 * A language model asked to "find problems in these logs" will produce confident
 * prose for an empty log window; an aggregation cannot. The spec is explicit that
 * VERA must not present speculation as a confirmed incident, so the detection
 * itself is arithmetic and only the WORDING is fixed text.
 *
 * This reuses VERA's existing normalized finding shape (utils/veraFindings.js)
 * rather than introducing a second detection system, and adds the four-part
 * structure the spec asks for:
 *
 *   observed        — a fact, straight from the aggregation (counts, names, times)
 *   detectedPattern — what the shape of those facts is called
 *   possibleRisk    — a reasoned interpretation, explicitly hedged
 *   recommendation  — what a human should go and check
 *
 * ── Privacy ────────────────────────────────────────────────────────────────
 * Analysis reads `action`, `level`, `user`, `ip` and `createdAt` only. It never
 * reads `meta`, which is the field that can carry request payloads. Sample
 * evidence is scrubbed through `redactSample()` and user/IP values are partially
 * masked, so nothing that reaches the response (or a model, if one is ever put in
 * front of this) carries a secret or a full identifier.
 */
const AppLog = require("../models/AppLog");

// A pattern needs enough records behind it to be a pattern rather than noise.
const THRESHOLDS = {
  failedLogins: 5, // same account, within the window
  authFailuresByIp: 8, // same IP, any account
  moduleErrors: 10, // same action repeatedly erroring
  userErrors: 8, // one user hitting repeated errors
  permissionDenials: 5, // repeated authorization refusals
  errorSpikeFactor: 3, // this window vs the previous, same length
  errorSpikeFloor: 15, // …and at least this many, so 1→3 is not a "spike"
};

/** Mask the local part of an email / the last octet of an IP. */
function maskActor(value = "") {
  const s = String(value || "").trim();
  if (!s) return "(unknown)";
  if (s.includes("@")) {
    const [local, domain] = s.split("@");
    const head = local.slice(0, 2);
    return `${head}${local.length > 2 ? "***" : ""}@${domain}`;
  }
  return s;
}

function maskIp(value = "") {
  const s = String(value || "").trim();
  if (!s) return "(unknown)";
  if (s.includes(":")) return `${s.split(":").slice(0, 2).join(":")}:***`; // IPv6
  const parts = s.split(".");
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.x` : s;
}

/**
 * Reduce a log record to the few fields evidence needs, with actor values masked
 * and free-text truncated. `meta` is dropped entirely — it is the only field that
 * can carry a request body, and no detector reads it.
 */
function redactSample(log = {}) {
  return {
    at: log.createdAt,
    level: log.level,
    action: log.action,
    user: maskActor(log.user),
    ip: maskIp(log.ip),
    message: String(log.message || "").slice(0, 160),
  };
}

let _seq = 0;
function detection({ category, severity, title, observed, detectedPattern, possibleRisk, recommendation, evidence = [], count = 0, sourceModule }) {
  _seq += 1;
  return {
    id: `log-detect-${Date.now()}-${_seq}`,
    category,
    severity, // "critical" | "warning" | "recommendation" | "informational"
    title,
    sourceModule: sourceModule || "System Logs",
    // The four-part structure the spec requires. Kept as separate fields so the
    // UI cannot accidentally present an interpretation as an observed fact.
    observed,
    detectedPattern,
    possibleRisk,
    recommendation,
    count,
    evidence, // already redacted
    createdAt: new Date(),
  };
}

const isoOrNull = (d) => (d instanceof Date && !Number.isNaN(d.valueOf()) ? d.toISOString() : null);
const fmtWindow = (from, to) => `${isoOrNull(from) || "beginning"} → ${isoOrNull(to) || "now"}`;

/**
 * Run every detector over the log window described by `filter`.
 *
 * @param {object} filter a MongoDB filter (the SAME one the list view used, so
 *   the analysis always describes exactly what the admin is looking at)
 * @param {{from?:Date,to?:Date,sampleLimit?:number}} options
 * @returns {Promise<{findings:Array, scanned:number, window:string, generatedAt:Date}>}
 */
async function analyzeLogs(filter = {}, options = {}) {
  const { from, to, sampleLimit = 3 } = options;
  const findings = [];

  const scanned = await AppLog.countDocuments(filter);
  if (scanned === 0) {
    return { findings, scanned: 0, window: fmtWindow(from, to), generatedAt: new Date() };
  }

  // Evidence for a group: the newest few matching records, redacted.
  const samplesFor = async (extra) =>
    (await AppLog.find({ ...filter, ...extra })
      .sort({ createdAt: -1 })
      .limit(sampleLimit)
      .select("createdAt level action user ip message")
      .lean()).map(redactSample);

  // ── 1. Repeated failed logins, per account ────────────────────────────────
  const loginFailures = await AppLog.aggregate([
    { $match: { ...filter, action: /login.*(fail|denied)|auth.*fail/i } },
    { $group: { _id: { $toLower: "$user" }, n: { $sum: 1 }, first: { $min: "$createdAt" }, last: { $max: "$createdAt" } } },
    { $match: { n: { $gte: THRESHOLDS.failedLogins } } },
    { $sort: { n: -1 } },
    { $limit: 5 },
  ]);
  for (const g of loginFailures) {
    const minutes = Math.max(1, Math.round((new Date(g.last) - new Date(g.first)) / 60000));
    findings.push(detection({
      category: "authentication",
      severity: g.n >= THRESHOLDS.failedLogins * 3 ? "critical" : "warning",
      title: "Repeated failed sign-in attempts",
      sourceModule: "Authentication",
      observed: `${g.n} failed sign-in attempts for ${maskActor(g._id)} between ${isoOrNull(g.first)} and ${isoOrNull(g.last)} (about ${minutes} minute${minutes === 1 ? "" : "s"}).`,
      detectedPattern: "Repeated authentication failures against a single account.",
      possibleRisk: "May be credential guessing, or simply a user who has forgotten their password or is using a stale saved credential.",
      recommendation: `Confirm with the account owner whether the activity was expected. If it was not, reset the credential and review sign-in activity for ${maskActor(g._id)}.`,
      count: g.n,
      evidence: await samplesFor({ user: g._id, action: /login.*(fail|denied)|auth.*fail/i }),
    }));
  }

  // ── 2. Auth failures concentrated on one IP ───────────────────────────────
  const byIp = await AppLog.aggregate([
    { $match: { ...filter, action: /login.*(fail|denied)|auth.*fail/i, ip: { $nin: [null, ""] } } },
    { $group: { _id: "$ip", n: { $sum: 1 }, users: { $addToSet: { $toLower: "$user" } } } },
    { $match: { n: { $gte: THRESHOLDS.authFailuresByIp } } },
    { $sort: { n: -1 } },
    { $limit: 5 },
  ]);
  for (const g of byIp) {
    const distinct = (g.users || []).filter(Boolean).length;
    findings.push(detection({
      category: "authentication",
      severity: distinct > 3 ? "critical" : "warning",
      title: "Authentication failures concentrated on one address",
      sourceModule: "Authentication",
      observed: `${g.n} failed sign-in attempts came from ${maskIp(g._id)}, across ${distinct} distinct account${distinct === 1 ? "" : "s"}.`,
      detectedPattern: distinct > 3
        ? "One source address attempting several different accounts."
        : "Repeated authentication failures from a single source address.",
      possibleRisk: distinct > 3
        ? "Consistent with credential stuffing, but a shared office NAT address can also produce this."
        : "May be one user retrying, or an automated client with a stale credential.",
      recommendation: "Check whether this address belongs to a known office or VPN before treating it as hostile.",
      count: g.n,
      evidence: await samplesFor({ ip: g._id, action: /login.*(fail|denied)|auth.*fail/i }),
    }));
  }

  // ── 3. Repeated authorization denials ─────────────────────────────────────
  const denials = await AppLog.aggregate([
    { $match: { ...filter, action: /denied|forbidden|unauthorized|access\./i } },
    { $group: { _id: { user: { $toLower: "$user" }, action: "$action" }, n: { $sum: 1 } } },
    { $match: { n: { $gte: THRESHOLDS.permissionDenials } } },
    { $sort: { n: -1 } },
    { $limit: 5 },
  ]);
  for (const g of denials) {
    findings.push(detection({
      category: "authorization",
      severity: "warning",
      title: "Repeated authorization refusals",
      sourceModule: "Access Control",
      observed: `${maskActor(g._id.user)} was refused "${g._id.action}" ${g.n} times.`,
      detectedPattern: "The same account repeatedly attempting an action it is not permitted to perform.",
      possibleRisk: "Usually a permission that was expected but never granted; occasionally probing for an unguarded route.",
      recommendation: "Check whether this account is supposed to hold that permission, and grant or explain it accordingly.",
      count: g.n,
      evidence: await samplesFor({ user: g._id.user, action: g._id.action }),
    }));
  }

  // ── 4. One action erroring repeatedly ─────────────────────────────────────
  const moduleErrors = await AppLog.aggregate([
    { $match: { ...filter, level: "error" } },
    { $group: { _id: "$action", n: { $sum: 1 }, users: { $addToSet: { $toLower: "$user" } }, last: { $max: "$createdAt" } } },
    { $match: { n: { $gte: THRESHOLDS.moduleErrors } } },
    { $sort: { n: -1 } },
    { $limit: 5 },
  ]);
  for (const g of moduleErrors) {
    const affected = (g.users || []).filter(Boolean).length;
    findings.push(detection({
      category: "reliability",
      severity: g.n >= THRESHOLDS.moduleErrors * 5 ? "critical" : "warning",
      title: `Repeated errors from "${g._id}"`,
      sourceModule: g._id,
      observed: `"${g._id}" logged ${g.n} errors${affected ? `, affecting ${affected} distinct user${affected === 1 ? "" : "s"}` : ""}. Most recent: ${isoOrNull(g.last)}.`,
      detectedPattern: "A single operation failing repeatedly rather than intermittently.",
      possibleRisk: "Points at a broken dependency or an unhandled input case in that operation, not at user error.",
      recommendation: `Open the newest "${g._id}" entries below and read the error message — repeated identical failures usually share one cause.`,
      count: g.n,
      evidence: await samplesFor({ level: "error", action: g._id }),
    }));
  }

  // ── 5. One user hitting repeated errors ───────────────────────────────────
  const userErrors = await AppLog.aggregate([
    { $match: { ...filter, level: "error", user: { $nin: [null, ""] } } },
    { $group: { _id: { $toLower: "$user" }, n: { $sum: 1 }, actions: { $addToSet: "$action" } } },
    { $match: { n: { $gte: THRESHOLDS.userErrors } } },
    { $sort: { n: -1 } },
    { $limit: 5 },
  ]);
  for (const g of userErrors) {
    findings.push(detection({
      category: "user-impact",
      severity: "warning",
      title: "One account is hitting repeated errors",
      sourceModule: "User Experience",
      observed: `${maskActor(g._id)} encountered ${g.n} errors across ${(g.actions || []).length} different operation${(g.actions || []).length === 1 ? "" : "s"}.`,
      detectedPattern: "Errors concentrated on a single account rather than spread across the user base.",
      possibleRisk: "This user is likely blocked from completing their work, and may not have reported it.",
      recommendation: "Contact the account owner to confirm what they were trying to do, then reproduce it.",
      count: g.n,
      evidence: await samplesFor({ level: "error", user: g._id }),
    }));
  }

  // ── 6. Error spike vs the preceding window of equal length ────────────────
  if (from && to) {
    const span = new Date(to) - new Date(from);
    if (span > 0) {
      const prevFrom = new Date(new Date(from) - span);
      const scopeless = { ...filter };
      delete scopeless.createdAt;
      const [current, previous] = await Promise.all([
        AppLog.countDocuments({ ...scopeless, level: "error", createdAt: { $gte: from, $lte: to } }),
        AppLog.countDocuments({ ...scopeless, level: "error", createdAt: { $gte: prevFrom, $lt: from } }),
      ]);
      if (current >= THRESHOLDS.errorSpikeFloor && current >= previous * THRESHOLDS.errorSpikeFactor && previous >= 0) {
        findings.push(detection({
          category: "reliability",
          severity: "critical",
          title: "Error rate is sharply higher than the previous period",
          sourceModule: "System Health",
          observed: `${current} errors in the selected window, against ${previous} in the preceding window of the same length.`,
          detectedPattern: "A step change in error volume rather than a gradual drift.",
          possibleRisk: "Consistent with a recent deployment, configuration change, or a dependency that has started failing.",
          recommendation: "Compare the start of the spike against the most recent deployment or settings change.",
          count: current,
          evidence: await samplesFor({ level: "error" }),
        }));
      }
    }
  }

  // ── 7. Administrative activity worth a second look ────────────────────────
  const adminActions = await AppLog.aggregate([
    { $match: { ...filter, action: /delete|clear|reset|purge|permission|role|credential/i } },
    { $group: { _id: { user: { $toLower: "$user" }, action: "$action" }, n: { $sum: 1 }, last: { $max: "$createdAt" } } },
    { $sort: { n: -1 } },
    { $limit: 5 },
  ]);
  for (const g of adminActions) {
    findings.push(detection({
      category: "administrative",
      severity: "informational",
      title: "Sensitive administrative activity recorded",
      sourceModule: "Administration",
      observed: `${maskActor(g._id.user)} performed "${g._id.action}" ${g.n} time${g.n === 1 ? "" : "s"}, most recently ${isoOrNull(g.last)}.`,
      detectedPattern: "Destructive or permission-changing operations in the audit trail.",
      possibleRisk: "Normal administration in most cases. Listed so it is never invisible, not because it is suspected.",
      recommendation: "Confirm the operation was intended and carried out by the named administrator.",
      count: g.n,
      evidence: await samplesFor({ user: g._id.user, action: g._id.action }),
    }));
  }

  const rank = { critical: 0, warning: 1, recommendation: 2, informational: 3 };
  findings.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) || b.count - a.count);

  return { findings, scanned, window: fmtWindow(from, to), generatedAt: new Date() };
}

module.exports = { analyzeLogs, redactSample, maskActor, maskIp, THRESHOLDS };
