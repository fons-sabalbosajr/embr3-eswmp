/**
 * Summary Overview → Waste Breakdown: which submissions' volume counts.
 *
 * The bug this pins
 * -----------------
 * GET /summary-by-slf feeds the admin Summary Overview. Its aggregation matched
 * only `{ deletedAt: null, isDummy: { $ne: true } }` — no status rule at all — so
 * `residualM3/Tons` and `hazardousM3/Tons` summed EVERY submission, including
 * ones an admin had rejected and ones that had been reverted and handed back to
 * the portal user for correction.
 *
 * That put the Waste Breakdown at odds with every other waste display in the
 * app. utils/cellOccupancy.js — the calculation that writes
 * SlfFacility.cellFillValues and drives the SLF Data Table, Cell Infrastructure,
 * Waste in Cell and the portal gauges — counts only ACTIVE_VOLUME_STATUSES.
 *
 * What is asserted here
 * ---------------------
 * Two different things, deliberately:
 *
 *   1. The RULE itself, executed. `ACTIVE_VOLUME_STATUSES` is a real exported
 *      Set, so the reverted/rejected exclusions are checked by running them, not
 *      by reading them.
 *
 *   2. The pipeline's SHAPE. The aggregation runs in MongoDB, so it cannot be
 *      executed here without a live server. The source assertions below are
 *      therefore scoped tightly: that the volume fields are gated on the shared
 *      constant, that the per-status COUNTS are not gated (a rejected submission
 *      must still be reported as having happened), and that the gate reads a
 *      missing status as "pending" the way every other consumer does.
 *
 * Run: node --test tests/summaryWasteStatusRule.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { ACTIVE_VOLUME_STATUSES } = require("../utils/cellOccupancy");
const source = fs.readFileSync(path.join(__dirname, "..", "routes", "dataSLF.js"), "utf8");

/** One route handler's source, bounded at the next route declaration. */
function routeBlock(needle) {
  const start = source.indexOf(needle);
  assert.ok(start > -1, `${needle} route should exist`);
  const next = source.indexOf("\nrouter.", start + 20);
  return source.slice(start, next === -1 ? source.length : next);
}

const summaryBySlfBlock = () => routeBlock('router.get("/summary-by-slf"');

/**
 * THE endpoint the Submission Summary page calls.
 *
 * /summary-by-slf looks like the obvious home for this rule and was where the
 * gate first landed — but SubmissionSummary.jsx fetches /summary-dashboard,
 * which carries its own copy of the same aggregation in a $facet. Gating only
 * the former fixed an endpoint the page never calls and left the Waste Breakdown
 * exactly as wrong as before. Both are asserted here so neither can regress
 * alone.
 */
const summaryDashboardBlock = () => routeBlock('router.get("/summary-dashboard"');

test("the shared status rule excludes exactly the submissions that no longer stand", () => {
  // Executed, not read: these are the statuses whose waste must NOT be counted.
  assert.equal(ACTIVE_VOLUME_STATUSES.has("rejected"), false, "a rejected submission's waste must not count");
  assert.equal(ACTIVE_VOLUME_STATUSES.has("reverted"), false, "a reverted submission's waste must not count");

  // …and the ones that must.
  assert.equal(ACTIVE_VOLUME_STATUSES.has("pending"), true);
  assert.equal(ACTIVE_VOLUME_STATUSES.has("acknowledged"), true);
  // A revert that has only been REQUESTED is still live waste sitting in a cell.
  assert.equal(
    ACTIVE_VOLUME_STATUSES.has("revert_requested"),
    true,
    "a requested-but-not-granted revert is still live waste",
  );
});

test("summary-by-slf gates every volume field on that shared rule", () => {
  const block = summaryBySlfBlock();

  assert.match(
    block,
    /ACTIVE_VOLUME_STATUSES/,
    "the volume gate must reuse the shared constant, not restate the status list — " +
      "a fourth copy of this rule is how the three that already exist drifted apart",
  );

  // Each volume pair must be multiplied by the gate. If a new volume field is
  // added later and left ungated, this catches it.
  const gated = ["totalM3", "totalTons", "residualM3", "residualTons", "hazardousM3", "hazardousTons"];
  for (const field of gated) {
    assert.match(
      block,
      new RegExp(`${field}: \\{ \\$multiply: \\["\\$${field}", "\\$_counts"\\] \\}`),
      `${field} must be zeroed for submissions that no longer stand`,
    );
  }
});

test("a missing status is read as pending, not dropped", () => {
  // Legacy records predate the status field. Treating "no status" as inactive
  // would silently delete their volume from the summary — a new bug wearing the
  // fix's clothes.
  assert.match(
    summaryBySlfBlock(),
    /\$ifNull: \["\$status", "pending"\]/,
    "the gate must default a missing status to pending",
  );
});

test("submission and per-status counts still span every status", () => {
  const block = summaryBySlfBlock();
  // The point of the status breakdown is to report that a rejection happened, so
  // these must NOT be gated — only the volumes are.
  for (const status of ["rejected", "reverted"]) {
    assert.match(
      block,
      new RegExp(`${status}: \\{ \\$sum: \\{ \\$cond: \\[\\{ \\$eq: \\["\\$status", "${status}"\\] \\}, 1, 0\\] \\} \\}`),
      `the ${status} COUNT must still be reported`,
    );
  }
  assert.match(
    block,
    /submissions: \{ \$sum: 1 \}/,
    "the submission count must still span every status",
  );
});

test("summary-dashboard gates BOTH of its facets — it is what the page calls", () => {
  const block = summaryDashboardBlock();
  const gated = ["totalM3", "totalTons", "residualM3", "residualTons", "hazardousM3", "hazardousTons"];

  for (const field of gated) {
    const hits = (
      block.match(new RegExp(`${field}: \\{ \\$multiply: \\["\\$${field}", "\\$_counts"\\] \\}`, "g")) || []
    ).length;
    // Twice: once in the `tiles` facet (the pre-load fallback) and once in the
    // `rows` facet (what the page sums once the table arrives). If only one
    // facet were gated the figure would visibly change as the table loaded.
    assert.equal(
      hits,
      2,
      `${field} must be gated in BOTH the tiles and rows facets — found ${hits}`,
    );
  }

  assert.match(
    block,
    /\$ifNull: \["\$status", "pending"\]/,
    "summary-dashboard must default a missing status to pending too",
  );
});

test("the page's endpoint is the one that was actually fixed", () => {
  // Guards the mistake this file exists to remember: fixing the endpoint that
  // sounds right instead of the one the component fetches.
  const page = fs.readFileSync(
    path.join(__dirname, "..", "..", "front-end", "src", "pages", "admin", "SubmissionSummary.jsx"),
    "utf8",
  );
  assert.match(
    page,
    /api\.get\("\/data-slf\/summary-dashboard"\)/,
    "SubmissionSummary should still read /summary-dashboard — if this moved, move the gate with it",
  );
  assert.match(
    summaryDashboardBlock(),
    /ACTIVE_VOLUME_STATUSES/,
    "the endpoint SubmissionSummary calls must carry the status gate",
  );
});

test("the volume gate is not applied twice", () => {
  // `_counts` is the gate flag; multiplying by it more than once per field would
  // be a no-op for 1 but would mask a later change to the flag's shape.
  const block = summaryBySlfBlock();
  const occurrences = (block.match(/"\$_counts"/g) || []).length;
  assert.equal(
    occurrences,
    6,
    `expected the gate to be applied once per volume field (6), found ${occurrences}`,
  );
});
