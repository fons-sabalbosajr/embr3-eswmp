const express = require("express");
const AppLog = require("../models/AppLog");
const { writeLog } = require("../utils/logger");
const { resolveIpLocation } = require("../utils/ipLocation");

const router = express.Router();
const { authMiddleware, adminOnly } = require("../middleware/auth");
const { cacheJson } = require("../middleware/cacheRoute");
const { LOG_ANALYSIS_PREFIX } = require("../utils/cacheKeys");

/**
 * Cache key for VERA log analysis: every filter that changes the answer, hashed
 * so a long free-text search cannot produce a long Redis key. The result is a
 * global admin view (no per-user scoping in the analyzer), so one entry serves
 * every admin looking at the same window.
 */
const logAnalysisCacheKey = (req) => {
  const q = req.query || {};
  const shape = ["level", "search", "user", "action", "ip", "from", "to"]
    .map((k) => `${k}=${String(q[k] ?? "").trim().toLowerCase()}`)
    .join("&");
  const hash = require("crypto").createHash("sha1").update(shape).digest("hex").slice(0, 16);
  return `${LOG_ANALYSIS_PREFIX}:${hash}`;
};

// POST /client-error stays public so the front-end can report errors even when
// no user is signed in; reading and clearing logs are admin-only.
router.post("/client-error", async (req, res) => {
  try {
    const {
      message = "Client error",
      source = "portal",
      user = "",
      path = "",
      stack = "",
      meta = {},
    } = req.body || {};
    await writeLog("error", `${source}.client-error`, {
      message,
      user,
      ip: req.ip,
      meta: {
        path,
        stack: stack ? String(stack).slice(0, 4000) : "",
        ...meta,
      },
    });
    res.json({ message: "Logged" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Shared query building ───────────────────────────────────────────────────
//
// The list, the export, the backup and the VERA analysis all describe the SAME
// window. Building the filter in one place is what makes "export respects the
// current filters" true by construction rather than by remembering to keep four
// copies in step.

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A page must stay small enough that the browser can render it. 250 is the
// largest option the UI offers; anything above it is clamped rather than
// rejected, so a hand-made request cannot ask for the whole collection.
const MAX_PAGE_SIZE = 250;
const DEFAULT_PAGE_SIZE = 50;

/**
 * Build the AppLog filter from query parameters.
 * Only fields that exist on the schema are honoured — no invented filters.
 */
function buildLogFilter(query = {}) {
  const { level, search, user, action, ip, from, to } = query;
  const filter = {};

  if (level && level !== "all") filter.level = level;
  // Exact-ish scoping filters (anchored so "admin" does not match "superadmin"
  // by accident on the action, which is a controlled vocabulary).
  if (user) filter.user = new RegExp(escapeRegex(String(user).trim()), "i");
  if (action) filter.action = new RegExp(`^${escapeRegex(String(action).trim())}`, "i");
  if (ip) filter.ip = new RegExp(escapeRegex(String(ip).trim()), "i");

  // Date range on the indexed timestamp.
  const createdAt = {};
  const parsedFrom = from ? new Date(from) : null;
  const parsedTo = to ? new Date(to) : null;
  if (parsedFrom && !Number.isNaN(parsedFrom.valueOf())) createdAt.$gte = parsedFrom;
  if (parsedTo && !Number.isNaN(parsedTo.valueOf())) createdAt.$lte = parsedTo;
  if (Object.keys(createdAt).length) filter.createdAt = createdAt;

  if (search) {
    // Escape user input so special characters can't break the regex (500s)
    // or cause ReDoS. Mirrors the escaping used across the other routes.
    const regex = new RegExp(escapeRegex(search), "i");
    filter.$or = [
      { action: regex },
      { message: regex },
      { user: regex },
      { ip: regex },
      { "geo.label": regex },
      { "geo.country": regex },
      { "geo.city": regex },
    ];
  }
  return filter;
}

/** page/limit → skip, clamped. `skip` is still honoured for older callers. */
function resolvePaging(query = {}) {
  const limit = Math.min(Math.max(Number(query.limit) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const page = Math.max(Number(query.page) || 1, 1);
  const skip = query.skip != null ? Math.max(Number(query.skip) || 0, 0) : (page - 1) * limit;
  return { page, limit, skip };
}

// Get logs (paginated, filterable)
router.get("/", authMiddleware, adminOnly, async (req, res) => {
  try {
    const filter = buildLogFilter(req.query);
    const { page, limit, skip } = resolvePaging(req.query);
    const [logs, total] = await Promise.all([
      AppLog.find(filter)
        .sort({ createdAt: -1, _id: -1 }) // _id breaks ties so paging cannot repeat a row
        .skip(skip)
        .limit(limit)
        .lean(),
      AppLog.countDocuments(filter),
    ]);

    // Enrich each log with a display location: prefer browser-shared geo,
    // else resolve from IP (cached, best-effort, never blocks failures).
    const ipCache = new Map();
    const enriched = await Promise.all(
      logs.map(async (log) => {
        if (log.geo && log.geo.label) return log;
        const ip = log.ip || "";
        if (!ip) return { ...log, geo: { ...(log.geo || {}), label: "Unknown" } };
        if (!ipCache.has(ip)) ipCache.set(ip, await resolveIpLocation(ip));
        const resolved = ipCache.get(ip);
        return { ...log, geo: { ...(log.geo || {}), ...resolved } };
      }),
    );
    // `logs` + `total` are kept for the existing caller; `pagination` is the
    // structured metadata the paged UI navigates with.
    res.json({
      logs: enriched,
      total,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Export / Backup ─────────────────────────────────────────────────────────
//
// EXPORT is a human-readable CSV for analysis. BACKUP is a durable NDJSON archive
// for recovery/audit. They are deliberately different formats: a CSV flattens
// `meta` and loses type information, so it is not a restorable copy.
//
// Both stream row-by-row through a cursor. Neither builds the whole result set in
// memory, and neither is reachable by a non-admin. Both are capped, and both
// write an audit entry recording the SCOPE — never the exported rows themselves.

// A hard ceiling so a single click cannot try to serialise an unbounded
// collection. The TTL index keeps AppLog to 30 days, so this is far above any
// realistic window.
const MAX_EXPORT_ROWS = 100000;

/** Fields that are safe to publish. `meta` is included only in the backup. */
const EXPORT_COLUMNS = [
  "createdAt", "level", "action", "message", "user", "ip",
  "geo.label", "geo.city", "geo.region", "geo.country",
];

const readPath = (obj, path) => path.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), obj);

/** RFC-4180 quoting, plus the leading-character guard against formula injection. */
function csvCell(value) {
  if (value == null) return "";
  let s = value instanceof Date ? value.toISOString() : String(value);
  // A cell starting with = + - @ is executed as a formula by Excel/Sheets. Logs
  // contain attacker-influenced text (user agents, messages), so prefix-escape it.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Strip anything secret-shaped out of a `meta` blob before it is archived.
 * Backups are downloaded files that outlive the system, so this is the last
 * place a token can be caught.
 */
const SECRET_KEY = /pass|pwd|token|secret|api[-_]?key|authorization|cookie|session|credential|otp|refresh/i;
function scrubMeta(value, depth = 0) {
  if (value == null || depth > 6) return value;
  if (Array.isArray(value)) return value.map((v) => scrubMeta(v, depth + 1));
  if (typeof value !== "object" || value instanceof Date) return value;
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = SECRET_KEY.test(key) ? "[redacted]" : scrubMeta(val, depth + 1);
  }
  return out;
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

// GET /api/logs/export — CSV of the CURRENT filter selection.
router.get("/export", authMiddleware, adminOnly, async (req, res) => {
  try {
    const filter = buildLogFilter(req.query);
    const total = await AppLog.countDocuments(filter);
    const cap = Math.min(total, MAX_EXPORT_ROWS);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="system-logs-${stamp()}.csv"`);
    res.setHeader("X-Export-Rows", String(cap));
    res.write("﻿"); // BOM so Excel reads UTF-8 place names correctly
    res.write(`${EXPORT_COLUMNS.join(",")}\n`);

    const cursor = AppLog.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(cap)
      .select(`${EXPORT_COLUMNS.map((c) => c.split(".")[0]).join(" ")}`)
      .lean()
      .cursor();

    let written = 0;
    for await (const log of cursor) {
      res.write(`${EXPORT_COLUMNS.map((c) => csvCell(readPath(log, c))).join(",")}\n`);
      written += 1;
    }
    res.end();

    // Audited AFTER the response: the scope only, never the rows.
    writeLog("info", "logs.export", {
      message: `System logs exported (CSV): ${written} row(s)`,
      user: req.user?.email || req.user?.username || "",
      ip: req.ip,
      meta: { format: "csv", rows: written, matched: total, truncated: total > cap, filters: req.query },
    });
  } catch (error) {
    if (!res.headersSent) res.status(500).json({ message: "Server error", error: error.message });
    else res.end();
  }
});

// GET /api/logs/backup — durable NDJSON archive of the CURRENT filter selection.
router.get("/backup", authMiddleware, adminOnly, async (req, res) => {
  try {
    const filter = buildLogFilter(req.query);
    const total = await AppLog.countDocuments(filter);
    const cap = Math.min(total, MAX_EXPORT_ROWS);

    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="system-logs-backup-${stamp()}.ndjson"`);
    res.setHeader("X-Backup-Rows", String(cap));

    // Line 1 is a manifest describing WHAT this archive contains, so a restore
    // never has to guess the scope. NDJSON (not one JSON array) so the file
    // streams, appends and restores line-by-line without a full parse.
    res.write(`${JSON.stringify({
      _manifest: true,
      application: "EMBR3 ESWMP",
      collection: "app-logs",
      format: "ndjson",
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      createdBy: req.user?.email || req.user?.username || "admin",
      scope: { filters: req.query, matched: total, included: cap, truncated: total > cap },
      note: "Archival copy. Records are unmodified except for redaction of secret-shaped meta keys. No log was deleted or altered to produce this file.",
    })}\n`);

    const cursor = AppLog.find(filter).sort({ createdAt: -1, _id: -1 }).limit(cap).lean().cursor();
    let written = 0;
    for await (const log of cursor) {
      res.write(`${JSON.stringify({ ...log, meta: scrubMeta(log.meta) })}\n`);
      written += 1;
    }
    res.end();

    writeLog("info", "logs.backup", {
      message: `System logs backed up (NDJSON): ${written} record(s)`,
      user: req.user?.email || req.user?.username || "",
      ip: req.ip,
      meta: { format: "ndjson", rows: written, matched: total, truncated: total > cap, filters: req.query },
    });
  } catch (error) {
    if (!res.headersSent) res.status(500).json({ message: "Server error", error: error.message });
    else res.end();
  }
});

// GET /api/logs/analyze — VERA detection over the CURRENT filter selection.
//
// Deterministic aggregation, not a prompt: see utils/logAnalysis.js for why.
// A failure here must never take the logs page down, so the route answers 200
// with an empty finding set and an `error` note rather than a 5xx.
//
// CACHED, unlike the log list. The list is deliberately NOT cached: AppLog takes
// an insert on virtually every request, so a cached page is stale within seconds
// and each filter combination is near-unique — the hit rate would not repay the
// staleness. Analysis is the opposite: ~1.7s of aggregation over the same window,
// and an admin re-runs or re-opens it repeatedly while reading the results.
// 60s TTL is the whole freshness mechanism (there is no log-write event to hang
// an invalidation on, and 60s of staleness on a trend summary is immaterial).
router.get("/analyze", authMiddleware, adminOnly, cacheJson(logAnalysisCacheKey, 60000), async (req, res) => {
  try {
    const { analyzeLogs } = require("../utils/logAnalysis");
    const filter = buildLogFilter(req.query);
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;
    const result = await analyzeLogs(filter, {
      from: from && !Number.isNaN(from.valueOf()) ? from : null,
      to: to && !Number.isNaN(to.valueOf()) ? to : null,
    });
    res.json(result);
  } catch (error) {
    res.json({
      findings: [],
      scanned: 0,
      window: "",
      generatedAt: new Date(),
      error: "VERA could not analyze this log window.",
      detail: process.env.NODE_ENV === "production" ? undefined : error.message,
    });
  }
});

// Clear all logs
router.delete("/", authMiddleware, adminOnly, async (_req, res) => {
  try {
    await AppLog.deleteMany({});
    res.json({ message: "All logs cleared" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
