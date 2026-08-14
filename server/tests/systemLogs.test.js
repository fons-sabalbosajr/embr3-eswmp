/**
 * System & Logs — pagination, filtering, export, backup, and VERA detection.
 *
 * ── What was wrong ──────────────────────────────────────────────────────────
 * The backend already accepted skip/limit and returned a total. The FRONT END
 * hardcoded `limit: 100` and never sent a page, so the newest 100 records were
 * the only ones an administrator could ever reach — on a collection holding
 * 4,868. The ceiling was entirely client-side.
 *
 * These tests pin the pieces that must not regress: that a page is bounded, that
 * the export describes the same window as the table, that a non-admin cannot
 * reach any of it, and that VERA reports evidence rather than prose.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { redactSample, maskActor, maskIp, THRESHOLDS } = require("../utils/logAnalysis");

const routeSource = fs.readFileSync(path.join(__dirname, "..", "routes", "logs.js"), "utf8");
const modelSource = fs.readFileSync(path.join(__dirname, "..", "models", "AppLog.js"), "utf8");

// ── Pagination ──────────────────────────────────────────────────────────────

test("a page is bounded — an enormous limit is clamped, never honoured", () => {
  assert.match(routeSource, /const MAX_PAGE_SIZE = 250;/);
  assert.match(
    routeSource,
    /Math\.min\(Math\.max\(Number\(query\.limit\) \|\| DEFAULT_PAGE_SIZE, 1\), MAX_PAGE_SIZE\)/,
    "limit must be clamped so one request cannot pull the whole collection",
  );
});

test("the response carries structured pagination metadata", () => {
  for (const field of ["page", "limit", "total", "totalPages"]) {
    assert.match(routeSource, new RegExp(`${field}[,:]`), `pagination.${field} must be returned`);
  }
  assert.match(routeSource, /totalPages: Math\.max\(1, Math\.ceil\(total \/ limit\)\)/);
  // The previous shape stays, so the existing caller does not break.
  assert.match(routeSource, /logs: enriched,\s*\n\s*total,/);
});

test("paging sorts on a tiebreaker so a row cannot repeat across pages", () => {
  assert.match(
    routeSource,
    /\.sort\(\{ createdAt: -1, _id: -1 \}\)/,
    "equal timestamps without a tiebreaker can show the same record on two pages",
  );
});

test("page → skip is derived, and an explicit skip still works", () => {
  assert.match(routeSource, /\(page - 1\) \* limit/);
  assert.match(routeSource, /query\.skip != null/, "older callers passing skip must keep working");
});

// ── Filtering ───────────────────────────────────────────────────────────────

test("filters cover only fields that exist on the schema", () => {
  const filterFn = routeSource.slice(routeSource.indexOf("function buildLogFilter"), routeSource.indexOf("function resolvePaging"));
  for (const field of ["level", "user", "action", "ip", "createdAt"]) {
    assert.match(filterFn, new RegExp(`filter\\.${field}`), `${field} filter missing`);
  }
  // Every one of those is a real AppLog path.
  for (const field of ["level", "action", "user", "ip"]) {
    assert.match(modelSource, new RegExp(`${field}:`), `${field} must exist on the schema`);
  }
});

test("free-text search is regex-escaped (no ReDoS, no 500 on a stray bracket)", () => {
  assert.match(routeSource, /const escapeRegex = \(value\) => String\(value\)\.replace/);
  assert.match(routeSource, /new RegExp\(escapeRegex\(search\), "i"\)/);
});

test("an unparseable date is ignored rather than poisoning the query", () => {
  assert.match(routeSource, /Number\.isNaN\(parsedFrom\.valueOf\(\)\)/);
  assert.match(routeSource, /Number\.isNaN\(parsedTo\.valueOf\(\)\)/);
});

test("the indexes match what the view actually filters and sorts by", () => {
  assert.match(modelSource, /appLogSchema\.index\(\{ level: 1, createdAt: -1 \}\)/);
  assert.match(modelSource, /appLogSchema\.index\(\{ user: 1, createdAt: -1 \}\)/);
  assert.match(modelSource, /appLogSchema\.index\(\{ action: 1, createdAt: -1 \}\)/);
  // Restraint: AppLog takes an insert on nearly every request.
  const count = (modelSource.match(/appLogSchema\.index\(/g) || []).length;
  assert.ok(count <= 4, `expected a small number of indexes on a write-heavy collection, found ${count}`);
});

// ── Export / Backup ─────────────────────────────────────────────────────────

test("export and backup are admin-only, exactly like the list", () => {
  for (const route of ["/export", "/backup", "/analyze"]) {
    assert.match(
      routeSource,
      new RegExp(`router\\.get\\("${route}", authMiddleware, adminOnly`),
      `${route} must require an admin`,
    );
  }
});

test("export and backup describe the SAME window as the table", () => {
  const exportBlock = routeSource.slice(routeSource.indexOf('router.get("/export"'), routeSource.indexOf('router.get("/backup"'));
  const backupBlock = routeSource.slice(routeSource.indexOf('router.get("/backup"'), routeSource.indexOf('router.get("/analyze"'));
  assert.match(exportBlock, /buildLogFilter\(req\.query\)/, "the export must reuse the list's filter builder");
  assert.match(backupBlock, /buildLogFilter\(req\.query\)/);
});

test("both stream through a cursor instead of buffering the result set", () => {
  assert.match(routeSource, /\.lean\(\)\s*\n?\s*\.cursor\(\)/);
  assert.equal((routeSource.match(/\.cursor\(\)/g) || []).length, 2, "export and backup both stream");
  assert.match(routeSource, /const MAX_EXPORT_ROWS = 100000;/);
});

test("CSV cells are quoted AND guarded against formula injection", () => {
  assert.match(routeSource, /\/\^\[=\+\\-@\\t\\r\]\//, "a cell starting with = + - @ executes in Excel");
  assert.match(routeSource, /s\.replace\(\/"\/g, '""'\)/);
});

test("the backup is a restorable archive, not a CSV in disguise", () => {
  const backupBlock = routeSource.slice(routeSource.indexOf('router.get("/backup"'), routeSource.indexOf('router.get("/analyze"'));
  assert.match(backupBlock, /_manifest: true/, "an archive must describe its own scope");
  assert.match(backupBlock, /application\/x-ndjson/);
  assert.match(backupBlock, /schemaVersion/);
  assert.match(backupBlock, /scope: \{ filters/);
});

test("secret-shaped meta keys are redacted before archiving", () => {
  assert.match(routeSource, /const SECRET_KEY = \/pass\|pwd\|token\|secret\|api\[-_\]\?key\|authorization\|cookie\|session\|credential\|otp\|refresh\/i/);
  assert.match(routeSource, /SECRET_KEY\.test\(key\) \? "\[redacted\]"/);
  const backupBlock = routeSource.slice(routeSource.indexOf('router.get("/backup"'), routeSource.indexOf('router.get("/analyze"'));
  assert.match(backupBlock, /meta: scrubMeta\(log\.meta\)/);
});

test("export and backup are audited by SCOPE, never by content", () => {
  assert.match(routeSource, /writeLog\("info", "logs\.export"/);
  assert.match(routeSource, /writeLog\("info", "logs\.backup"/);
  // The audit records counts and filters — never the rows themselves.
  assert.doesNotMatch(routeSource, /meta: \{[^}]*rows: written, logs:/);
});

test("neither operation deletes or modifies a log", () => {
  const readOnly = routeSource.slice(routeSource.indexOf('router.get("/export"'), routeSource.indexOf('// Clear all logs'));
  assert.doesNotMatch(readOnly, /deleteMany|deleteOne|updateOne|updateMany|findOneAndUpdate/);
});

// ── VERA detection ──────────────────────────────────────────────────────────

test("findings separate fact from interpretation", async () => {
  const { analyzeLogs } = require("../utils/logAnalysis");
  assert.equal(typeof analyzeLogs, "function");
  // The four-part shape is constructed for every finding.
  const src = fs.readFileSync(path.join(__dirname, "..", "utils", "logAnalysis.js"), "utf8");
  for (const part of ["observed", "detectedPattern", "possibleRisk", "recommendation"]) {
    assert.match(src, new RegExp(`${part},`), `${part} must be its own field`);
  }
  assert.match(src, /evidence, \/\/ already redacted/);
});

test("detection thresholds require a pattern, not a single event", () => {
  assert.ok(THRESHOLDS.failedLogins >= 3, "one failed login is not a pattern");
  assert.ok(THRESHOLDS.moduleErrors >= 5);
  assert.ok(THRESHOLDS.errorSpikeFloor >= 10, "1 → 3 errors must not read as a spike");
  assert.ok(THRESHOLDS.errorSpikeFactor >= 2);
});

test("actors are masked in findings and evidence", () => {
  assert.equal(maskActor("operator@example.gov.ph"), "op***@example.gov.ph");
  assert.equal(maskActor("ab@x.com"), "ab@x.com", "a 2-char local part has nothing left to mask");
  assert.equal(maskActor(""), "(unknown)");
  assert.equal(maskIp("203.177.12.44"), "203.177.12.x");
  assert.equal(maskIp(""), "(unknown)");
});

test("evidence carries no request payload — `meta` is dropped entirely", () => {
  const sample = redactSample({
    createdAt: new Date("2026-01-01T00:00:00Z"),
    level: "error",
    action: "auth.login.failed",
    user: "operator@example.gov.ph",
    ip: "203.177.12.44",
    message: "x".repeat(500),
    meta: { password: "hunter2", token: "abc.def.ghi", body: { secret: 1 } },
  });
  assert.equal(sample.meta, undefined, "meta is the field that can carry a request body");
  assert.equal(sample.user, "op***@example.gov.ph");
  assert.equal(sample.ip, "203.177.12.x");
  assert.equal(sample.message.length, 160, "free text is truncated");
  assert.doesNotMatch(JSON.stringify(sample), /hunter2|abc\.def\.ghi/);
});

test("an empty window yields no findings — VERA does not invent a problem", async () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "utils", "logAnalysis.js"), "utf8");
  assert.match(src, /if \(scanned === 0\) \{[\s\S]*?findings, scanned: 0/, "zero logs must mean zero findings");
});

test("an analysis failure does not take the logs page down", () => {
  const block = routeSource.slice(routeSource.indexOf('router.get("/analyze"'), routeSource.indexOf("// Clear all logs"));
  assert.match(block, /res\.json\(\{\s*findings: \[\],/, "a failure must answer 200 with an empty result, not a 5xx");
  assert.doesNotMatch(block, /res\.status\(500\)/);
});

test("the log LIST is not cached, only the analysis is", () => {
  const listBlock = routeSource.slice(routeSource.indexOf('router.get("/", authMiddleware'), routeSource.indexOf('router.get("/export"'));
  assert.doesNotMatch(listBlock, /cacheJson\(/, "logs are written constantly — a cached page would be stale on arrival");
  assert.match(routeSource, /router\.get\("\/analyze", authMiddleware, adminOnly, cacheJson\(logAnalysisCacheKey, 60000\)/);
});

test("the analysis cache key covers every filter that changes the answer", () => {
  const keyFn = routeSource.slice(routeSource.indexOf("const logAnalysisCacheKey"), routeSource.indexOf("// POST /client-error"));
  for (const f of ["level", "search", "user", "action", "ip", "from", "to"]) {
    assert.match(keyFn, new RegExp(`"${f}"`), `${f} must be part of the cache key`);
  }
  assert.match(keyFn, /createHash\("sha1"\)/, "a long search term must not become a long Redis key");
});
