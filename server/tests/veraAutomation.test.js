/**
 * VERA doing its own job:
 *
 *   1. Submissions — VERA reviews every submission automatically. A stored remark
 *      carries a fingerprint of the issues it covered; a list read recomputes it
 *      and re-queues the review only when the issues changed. These pin the
 *      fingerprint and the two checks added with it.
 *   2. Hauler Clients — "Let VERA fix" collapses copies of one problem. 28,479
 *      open issues were 961 problems, filed once per baseline copy of the hauler
 *      roster; problemKey is what tells a copy from a different problem.
 *
 * Pure — no database. Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { computeFormatRemarks } = require("../utils/submissionRemarks");
const { problemKey } = require("../services/veraIssueAutofix");
const { veraRemarkSignature, mergeRemarkLists } = require("../routes/dataSLF");

// ── Submission review fingerprint ────────────────────────────────────────────

test("the fingerprint ignores order but not content", () => {
  const a = [{ text: "Missing plate no.", level: "warning", detail: "#1" }, { text: "No truck capacity", level: "warning" }];
  const b = [a[1], a[0]];
  assert.equal(veraRemarkSignature(a), veraRemarkSignature(b), "same issues, any order → same fingerprint");
  assert.notEqual(
    veraRemarkSignature(a),
    veraRemarkSignature([{ ...a[0], detail: "#1, #2" }, a[1]]),
    "a changed detail (another load now affected) is a change worth re-reviewing",
  );
  assert.equal(veraRemarkSignature([]), veraRemarkSignature([]), "an issue-free submission still has a stable fingerprint");
});

test("a grouped row's issues merge with the most severe level winning", () => {
  const merged = mergeRemarkLists([
    [{ text: "Missing cell placement", level: "warning" }],
    [{ text: "Missing cell placement", level: "error" }, { text: "No truck capacity", level: "warning" }],
  ]);
  assert.deepEqual(merged.map((r) => [r.text, r.level]).sort(), [["Missing cell placement", "error"], ["No truck capacity", "warning"]]);
});

// ── New submission checks ────────────────────────────────────────────────────

test("REGRESSION — an entirely empty submission is ONE clear error, not a wall of 'missing' tags", () => {
  const empty = { trucks: [{}, { vehicles: [{ selectedClients: [] }] }, { hauler: "  " }] };
  const remarks = computeFormatRemarks(empty);
  assert.deepEqual(remarks.map((r) => r.text), ["No transport data"]);
  assert.equal(remarks[0].level, "error");
});

test("some empty rows among real ones are a warning", () => {
  const entry = {
    trucks: [
      { hauler: "H", disposalTicketNo: "T-1", plateNumber: "ABC 1234", actualVolume: 5, wasteType: "Residual" },
      {},
    ],
  };
  const labels = computeFormatRemarks(entry).map((r) => r.text);
  assert.ok(labels.includes("Empty transport rows"));
  assert.ok(!labels.includes("No transport data"));
});

test("a load with no client is noted — but only when the read carried client data", () => {
  const load = { hauler: "H", disposalTicketNo: "T-1", plateNumber: "ABC 1234", actualVolume: 5, wasteType: "Residual" };
  assert.ok(
    computeFormatRemarks({ trucks: [{ ...load, selectedClients: [] }] }).some((r) => r.text === "No client on trip"),
  );
  assert.ok(
    !computeFormatRemarks({ trucks: [{ ...load, selectedClients: [{ clientName: "City of Balanga" }] }] }).some((r) => r.text === "No client on trip"),
  );
  // A projection that left clients out entirely must not read as "no client".
  assert.ok(!computeFormatRemarks({ trucks: [load] }).some((r) => r.text === "No client on trip"));
});

// ── Hauler Clients: what makes two issues the same problem ───────────────────

test("REGRESSION — copies of one problem from different baseline copies share a key", () => {
  const base = { flagType: "missing_hauler", clientName: "DIGAMA", hauler: "", portalUserEmail: "ops@example.com" };
  assert.equal(
    problemKey({ ...base, _id: "a", baselineRef: "b1" }),
    problemKey({ ...base, _id: "b", baselineRef: "b2" }),
  );
  // …while a different portal user's declaration is a different problem.
  assert.notEqual(problemKey({ ...base, _id: "a" }), problemKey({ ...base, _id: "c", portalUserEmail: "other@example.com" }));
});

test("a client-level flag is one problem whoever declared it, spelling aside", () => {
  assert.equal(
    problemKey({ _id: "a", flagType: "region_unclassified", clientName: "Bataan Peninsula State University", portalUserEmail: "x@a.com" }),
    problemKey({ _id: "b", flagType: "region_unclassified", clientName: "BATAAN PENINSULA STATE UNIVERSITY", portalUserEmail: "" }),
  );
});

test("a per-record flag is never collapsed", () => {
  assert.notEqual(
    problemKey({ _id: "a", flagType: "invalid_baseline" }),
    problemKey({ _id: "b", flagType: "invalid_baseline" }),
  );
});
