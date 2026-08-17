/**
 * Bulk Organize Cells → VERA assessment: the contract, and the workflow rules.
 *
 * WHY THIS EXISTS. `pageContext` is a contract with the server, and the server is
 * entitled to throw the whole snapshot away:
 *   • sanitizePageContext returns null when there are no tables AND no stats;
 *   • wantsPageData decides whether the snapshot is spent on the prompt at all;
 *   • portalSafePageContext drops any table whose LABEL reads like an admin
 *     surface, and returns null if that leaves nothing.
 * When any of those fires, VERA still answers — from its knowledge base, about
 * nothing in particular — and the UI shows that as a normal assessment. A silent
 * downgrade is the failure mode worth testing for, so these run the real server
 * sanitizer over the real snapshot the modal builds.
 *
 * The rest pins the workflow rules that are easy to regress by editing the modal:
 * VERA only on a clean validation, exactly once, never from an effect, and never
 * showing File A's answer for File B.
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

import { buildBulkVeraContext, VERA_ASSESSMENT_PROMPT, VERA_TABLE_ROW_CAP } from "../bulkVeraContext.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.join(here, "..", "..", "..", "..", "..", "server");
const require = createRequire(pathToFileURL(path.join(serverRoot, "package.json")));

// The REAL server-side sanitizer this snapshot has to survive.
const veraPageData = require("./utils/veraPageData.js");

const row = (over = {}) => ({
  row: 2,
  disposalTicketNo: "DT-1001",
  truckCapacity: 12,
  submissionId: "SUB-2026-0001",
  targetCell: "CELL 02",
  remaining: 481.25,
  status: "valid",
  message: "",
  ...over,
});

const SUMMARY = { total: 3, valid: 2, invalid: 0, warning: 1 };
const ROWS = [
  row(),
  row({ row: 3, targetCell: "CELL 02", status: "warning", message: "Reassigning an already-placed transaction." }),
  row({ row: 4, targetCell: "CELL 04", remaining: null, truckCapacity: null }),
];

// ── The contract with the server ────────────────────────────────────────────
test("the snapshot survives the server's sanitizer with its rows intact", () => {
  const clean = veraPageData.sanitizePageContext(buildBulkVeraContext(ROWS, SUMMARY));

  assert.ok(clean, "sanitize must not reject the snapshot — a null here means VERA sees NOTHING");
  assert.equal(clean.tables.length, 1);
  assert.equal(clean.tables[0].rows.length, 3, "every validated row survives");
  assert.equal(clean.tables[0].columns.length, 8, "and its columns");
  assert.ok(clean.stats.length >= 4, "the counts survive too");
  assert.equal(clean.inModal, true);
});

test("the prompt is one the server will actually spend the snapshot on", () => {
  // wantsPageData() is the gate. A reworded prompt that stops matching it would
  // leave VERA answering from its knowledge base about data it was never shown —
  // with no visible symptom.
  assert.equal(
    veraPageData.wantsPageData(VERA_ASSESSMENT_PROMPT),
    true,
    "the assessment prompt must read as a question about the data on screen",
  );
});

test("a validated batch is never mistaken for an empty dataset", () => {
  const clean = veraPageData.sanitizePageContext(buildBulkVeraContext(ROWS, SUMMARY));
  // isEmptyDataset short-circuits to a canned "no records" reply with no model
  // call at all.
  assert.equal(veraPageData.isEmptyDataset(clean), false);
});

test("the labels survive the portal-user safety filter", () => {
  // portalSafePageContext is not exported, so the blocklist is read from the route
  // itself — if it gains a term that collides with these labels, this fails.
  const veraRoute = fs.readFileSync(path.join(serverRoot, "routes", "vera.js"), "utf8");
  const match = veraRoute.match(/const blocked = (\/.+\/i);/);
  assert.ok(match, "the portal blocklist must still be found in routes/vera.js");
  const blocked = new RegExp(match[1].slice(1, -2), "i");

  const ctx = buildBulkVeraContext(ROWS, SUMMARY);
  assert.equal(blocked.test(`${ctx.label} ${ctx.modalTitle}`), false, "the snapshot label passes");
  ctx.tables.forEach((t) =>
    assert.equal(blocked.test(String(t.label)), false, `table label "${t.label}" passes`),
  );
  ctx.stats.forEach((s) =>
    assert.equal(blocked.test(String(s.label)), false, `stat label "${s.label}" passes`),
  );
});

// ── Payload discipline ──────────────────────────────────────────────────────
test("a large batch is capped, and says how large it really was", () => {
  const many = Array.from({ length: 500 }, (_, i) => row({ row: i + 2 }));
  const ctx = buildBulkVeraContext(many, { total: 500, valid: 500, invalid: 0, warning: 0 });

  assert.equal(ctx.tables[0].rows.length, VERA_TABLE_ROW_CAP, "sending more would only be discarded");
  assert.equal(ctx.tables[0].truncated, 500, "…but VERA is told the batch is 500");

  const clean = veraPageData.sanitizePageContext(ctx);
  assert.equal(clean.tables[0].totalRowCount, 500, "which the server surfaces as totalRowCount");
  assert.equal(clean.tables[0].rows.length, VERA_TABLE_ROW_CAP);
});

test("the per-cell distribution is summarized rather than left to be counted", () => {
  const ctx = buildBulkVeraContext(ROWS, SUMMARY);
  const labels = ctx.stats.map((s) => s.label);
  assert.ok(labels.includes("Placements into CELL 02"));
  assert.ok(labels.includes("Placements into CELL 04"));
  const cell02 = ctx.stats.find((s) => s.label === "Placements into CELL 02");
  assert.equal(cell02.value, "2", "two rows target CELL 02");
});

test("an empty or malformed input does not throw", () => {
  assert.doesNotThrow(() => buildBulkVeraContext([], null));
  assert.doesNotThrow(() => buildBulkVeraContext(null, undefined));
  assert.equal(buildBulkVeraContext([], null).tables[0].empty, true);
});

// ── The workflow rules, read off the modal ──────────────────────────────────
const modal = fs.readFileSync(path.join(here, "..", "BulkOrganizeCells.jsx"), "utf8");

test("VERA runs only on a CLEAN validation", () => {
  // Any failing row — client-side reject or server-side invalid — means the user
  // has correcting to do, and no assessment is started.
  assert.match(
    modal,
    /const passed =\s*\n?\s*res\.summary && res\.summary\.invalid === 0 && clientRejects === 0 && serverRows\.length > 0;/,
    "both reject sources must be checked, from the response rather than from state",
  );
  assert.match(modal, /if \(passed\) runVeraAssessment\(serverRows, res\.summary\);/);
});

test("VERA is invoked deliberately, never from an effect", () => {
  // An effect keyed on validated data would re-fire on re-render and could issue a
  // second assessment per validation.
  assert.doesNotMatch(modal, /useEffect\([^)]*runVeraAssessment/s, "no effect may start an assessment");
  // Exactly two CALL sites: the one on a clean validation, and the explicit Retry
  // button. (The definition reads `const runVeraAssessment = useCallback(`, so it
  // is not a call.) A third would mean something else can trigger an assessment.
  assert.equal(
    (modal.match(/runVeraAssessment\(/g) || []).length,
    2,
    "validation success + the Retry button, and nothing else",
  );
  assert.match(modal, /const runVeraAssessment = useCallback\(/, "memoized, so it is not a new fn each render");
});

test("a new upload or re-validation discards the previous assessment", () => {
  // Scenario: validate File A → VERA assesses A → upload File B. A's comment must
  // never be shown as B's.
  assert.match(modal, /veraCycleRef\.current \+= 1;/, "each cycle gets a new id");
  assert.match(
    modal,
    /if \(veraCycleRef\.current !== cycle\) return;/,
    "a late response for an old cycle is dropped",
  );
  // Reset happens both when a file is parsed (via resetPreview) and when
  // re-validating.
  assert.match(modal, /resetVeraAssessment\(\);\s*\n\s*};/, "resetPreview clears it");
  assert.match(modal, /resetVeraAssessment\(\);\s*\n\s*setValidating\(true\);/, "so does re-validating");
});

test("the instructions give way to the assessment only after validation passes", () => {
  assert.match(modal, /\{!validationPassed \? \(/, "the card is conditional on validation");
  assert.match(modal, /message="How bulk organization works"/, "the card itself is unchanged");
  assert.match(modal, /const validationPassed = canApply;/, "…and 'passed' is the same condition that enables Apply");
});

test("a VERA failure is not a validation failure", () => {
  const panel = modal.slice(modal.indexOf("bulk-vera-panel"), modal.indexOf("bulk-vera-panel") + 2600);
  assert.match(panel, /VERA assessment could not be completed/);
  assert.match(panel, /still <b>validated<\/b> and can be applied/, "the user is told the batch is unaffected");
  assert.match(panel, /Retry assessment/, "and can try again without re-uploading");
  // The Apply button must not depend on the assessment.
  assert.doesNotMatch(modal, /disabled=\{[^}]*veraStage[^}]*\}/, "VERA must never gate Apply");
});

test("no placeholder comment is ever shown", () => {
  // On failure the server's own reason is surfaced; nothing is invented.
  assert.match(modal, /data\?\.message \|\|\s*\n?\s*"VERA could not assess this upload right now\."/);
  assert.match(modal, /\{veraStage === "done" && \(\s*\n\s*<div className="bulk-vera-comment">\{veraComment\}<\/div>/,
    "the comment renders only in the done state");
});

// ── Table density (Part A) ──────────────────────────────────────────────────
test("the validated table is compact but still legible", () => {
  const styles = modal.slice(modal.indexOf(".bulk-preview-table"), modal.indexOf(".bulk-vera-panel"));
  const sizes = [...styles.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1]));
  assert.ok(sizes.length >= 3, "header, body and pagination are all sized");
  // 10.5px is the floor, set by the operators who actually read this table: 10px
  // was tried and reported as too small. Below it the density gain is paid for in
  // misreadings, which is the opposite of the point.
  assert.ok(Math.min(...sizes) >= 10.5, `nothing below 10.5px, got ${Math.min(...sizes)}`);
  assert.ok(Math.max(...sizes) <= 13, "and nothing left at the page-sized default");
  assert.match(styles, /padding:\s*4px 8px/, "row padding is tightened");
  assert.match(styles, /line-height:\s*1\.4/);
});

test("the Status column is exempt from the shrink", () => {
  // It carries the pass/fail verdict, so it is the column the eye lands on first.
  // Shrinking it with the rest would cost more than the row it saves.
  assert.match(modal, /className: "bulk-col-status"/, "the column is tagged so CSS can exempt it");
  const styles = modal.slice(modal.indexOf(".bulk-preview-table"), modal.indexOf(".bulk-vera-panel"));
  const exempt = styles.slice(styles.indexOf("th.bulk-col-status"));
  const statusSize = Number(exempt.match(/font-size:\s*([\d.]+)px/)[1]);
  const bodySize = Number(
    styles.slice(styles.indexOf(".ant-table {")).match(/font-size:\s*([\d.]+)px/)[1],
  );
  assert.ok(statusSize > bodySize, `Status (${statusSize}px) must stay larger than the body (${bodySize}px)`);
});

test("a long value is truncated with its full text still reachable", () => {
  // One long server message must not be able to stretch the table.
  assert.match(modal, /const ellipsisCell = \(v\) =>/);
  assert.match(modal, /<Tooltip title=\{v\} placement="topLeft">/, "the full value stays available on hover");
  ["disposalTicketNo", "submissionId", "targetCell"].forEach((field) =>
    assert.ok(
      new RegExp(`dataIndex: "${field}"[^}]*ellipsis: true`).test(modal),
      `${field} ellipses`,
    ),
  );
});

test("more rows are shown per page now that they are denser", () => {
  assert.match(modal, /pageSize: 25/);
  assert.match(modal, /showSizeChanger: true/, "and the operator can go further");
});
