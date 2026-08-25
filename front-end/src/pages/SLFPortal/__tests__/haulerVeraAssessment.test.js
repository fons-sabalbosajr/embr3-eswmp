/**
 * Accredited Haulers upload → VERA assessment: the contract, and the workflow
 * rules.
 *
 * WHY THIS EXISTS. `pageContext` is a contract with the server, and the server
 * is entitled to throw the whole snapshot away:
 *   • sanitizePageContext returns null when there are no tables AND no stats;
 *   • wantsPageData decides whether the snapshot is spent on the prompt at all;
 *   • portalSafePageContext drops any table whose LABEL reads like an admin
 *     surface, and returns null if that leaves nothing.
 * When any of those fires, VERA still answers — from its knowledge base, about
 * nothing in particular — and the UI shows that as a normal assessment. That
 * silent downgrade is the failure worth testing for, so these run the REAL
 * server sanitizer over the real snapshot the portal builds.
 *
 * The rest pins the workflow rules that are easy to regress by editing the
 * portal: VERA only on a clean preview, never from an effect, never gating
 * Import, and never showing File A's answer for File B.
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

import {
  buildHaulerVeraContext,
  findSimilarHaulerNames,
  HAULER_VERA_ASSESSMENT_PROMPT,
  HAULER_VERA_TABLE_ROW_CAP,
} from "../haulerVeraContext.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.join(here, "..", "..", "..", "..", "..", "server");
const require = createRequire(pathToFileURL(path.join(serverRoot, "package.json")));

// The REAL server-side sanitizer this snapshot has to survive.
const veraPageData = require("./utils/veraPageData.js");

const row = (over = {}) => ({
  _rowNumber: 2,
  _status: "new",
  haulerName: "XYZ Hauling Services",
  numberOfTrucks: 2,
  plateNumber: "ABC-1234",
  vehicleType: "Dump Truck",
  capacity: 15,
  capacityUnit: "m³",
  privateSectorClients: ["ABC Manufacturing", "DEF Foods"],
  clientType: "Private",
  clientProvince: "Pampanga",
  ...over,
});

const SUMMARY = { total: 3, valid: 3, invalid: 0, duplicates: 0, newHaulers: 1, updatedHaulers: 1 };
const ROWS = [
  row(),
  row({ _rowNumber: 3, plateNumber: "DEF-5678", vehicleType: "Compactor", capacity: 12 }),
  row({
    _rowNumber: 4,
    _status: "update",
    haulerName: "Metro Waste Movers",
    plateNumber: "",
    vehicleType: "",
    capacity: null,
    privateSectorClients: ["Baliuag LGU"],
    clientType: "LGU",
    clientProvince: "",
  }),
];

// ── The contract with the server ────────────────────────────────────────────
test("the hauler snapshot survives the server's sanitizer with its rows intact", () => {
  const clean = veraPageData.sanitizePageContext(buildHaulerVeraContext(ROWS, SUMMARY, []));

  assert.ok(clean, "sanitize must not reject the snapshot — a null here means VERA sees NOTHING");
  assert.equal(clean.tables.length, 1);
  assert.equal(clean.tables[0].rows.length, 3, "every previewed row survives");
  assert.equal(clean.tables[0].columns.length, 11, "and its columns — inside the server's MAX_COLS of 12");
  assert.ok(clean.stats.length >= 8, "the counts survive too");
  assert.equal(clean.inModal, true);
});

test("the hauler prompt is one the server will actually spend the snapshot on", () => {
  // wantsPageData() is the gate. A reworded prompt that stops matching it would
  // leave VERA answering from its knowledge base about data it was never shown —
  // with no visible symptom.
  assert.equal(
    veraPageData.wantsPageData(HAULER_VERA_ASSESSMENT_PROMPT),
    true,
    "the assessment prompt must read as a question about the data on screen",
  );
});

test("a validated hauler batch is never mistaken for an empty dataset", () => {
  const clean = veraPageData.sanitizePageContext(buildHaulerVeraContext(ROWS, SUMMARY, []));
  // isEmptyDataset short-circuits to a canned "no records" reply with no model
  // call at all.
  assert.equal(veraPageData.isEmptyDataset(clean), false);
});

test("the hauler labels survive the portal-user safety filter", () => {
  // portalSafePageContext is not exported, so the blocklist is read from the
  // route itself — if it gains a term that collides with these labels, this
  // fails. "Accredited Haulers" is a portal surface, but a stray "system" or
  // "users" in a label would silently strip the whole snapshot.
  const veraRoute = fs.readFileSync(path.join(serverRoot, "routes", "vera.js"), "utf8");
  const match = veraRoute.match(/const blocked = (\/.+\/i);/);
  assert.ok(match, "the portal blocklist must still be found in routes/vera.js");
  const blocked = new RegExp(match[1].slice(1, -2), "i");

  const ctx = buildHaulerVeraContext(ROWS, SUMMARY, []);
  assert.equal(blocked.test(`${ctx.label} ${ctx.modalTitle}`), false, "the snapshot label passes");
  ctx.tables.forEach((t) =>
    assert.equal(blocked.test(String(t.label)), false, `table label "${t.label}" passes`),
  );
  ctx.stats.forEach((s) =>
    assert.equal(blocked.test(String(s.label)), false, `stat label "${s.label}" passes`),
  );
});

// ── Payload discipline ──────────────────────────────────────────────────────
test("a large hauler batch is capped, and says how large it really was", () => {
  const many = Array.from({ length: 500 }, (_, i) => row({ _rowNumber: i + 2 }));
  const ctx = buildHaulerVeraContext(many, { ...SUMMARY, total: 500 }, []);

  assert.equal(ctx.tables[0].rows.length, HAULER_VERA_TABLE_ROW_CAP, "sending more would only be discarded");
  assert.equal(ctx.tables[0].truncated, 500, "…but VERA is told the batch is 500");

  const clean = veraPageData.sanitizePageContext(ctx);
  assert.equal(clean.tables[0].totalRowCount, 500, "which the server surfaces as totalRowCount");
});

test("an empty or malformed input does not throw", () => {
  assert.doesNotThrow(() => buildHaulerVeraContext([], null, null));
  assert.doesNotThrow(() => buildHaulerVeraContext(null, undefined, undefined));
  assert.equal(buildHaulerVeraContext([], null, []).tables[0].empty, true);
});

// ── The finding VERA exists here to make ────────────────────────────────────
test("a near-miss hauler name is computed, not left for the model to notice", () => {
  // The signature failure of a name-matched import: it validates, it imports,
  // and it silently produces a SECOND hauler instead of updating the first.
  const existing = [{ haulerName: "XYZ Hauling Services" }, { haulerName: "Metro Waste Movers" }];
  const found = findSimilarHaulerNames([row({ haulerName: "XYZ Hauling" })], existing);

  assert.equal(found.length, 1);
  assert.deepEqual(found[0], { uploaded: "XYZ Hauling", existing: "XYZ Hauling Services" });

  // …and it reaches VERA as a stat, so the finding does not depend on the model
  // spotting it inside a 40-row sample.
  const ctx = buildHaulerVeraContext([row({ haulerName: "XYZ Hauling" })], SUMMARY, existing);
  const labels = ctx.stats.map((s) => s.label);
  assert.ok(labels.includes("Hauler names resembling an existing one"));
  assert.ok(labels.some((l) => l.includes('Uploaded "XYZ Hauling" resembles stored')));
});

test("an EXACT name match is an update, and is never reported as a near-miss", () => {
  const existing = [{ haulerName: "XYZ Hauling Services" }];
  // Same name, different casing and spacing — the matcher already treats these
  // as one hauler, so flagging them would be noise on every routine update.
  assert.deepEqual(findSimilarHaulerNames([row({ haulerName: "  xyz   hauling services " })], existing), []);
  // An unrelated new hauler is not a near-miss either.
  assert.deepEqual(findSimilarHaulerNames([row({ haulerName: "Bulacan Haulers Co" })], existing), []);
  // A short shared prefix is a coincidence, not a resemblance.
  assert.deepEqual(findSimilarHaulerNames([row({ haulerName: "ABC" })], [{ haulerName: "ABC Hauling" }]), []);
});

test("clients with no province are counted, since nothing else blocks them", () => {
  // Client Province is deliberately NOT a blocking validation (an upload is an
  // upsert, and a partial update must not have to restate a stored location) —
  // so this count is the only thing that surfaces a NEW client arriving
  // incomplete.
  const ctx = buildHaulerVeraContext(ROWS, SUMMARY, []);
  const stat = ctx.stats.find((s) => s.label === "Client rows with no province");
  assert.equal(stat.value, "1", "row 4 lists a client with no province");
});

// ── The workflow rules, read off the portal ─────────────────────────────────
const portal = fs.readFileSync(path.join(here, "..", "index.jsx"), "utf8");
const modals = fs.readFileSync(path.join(here, "..", "SLFPortalModals.jsx"), "utf8");

test("VERA runs only on a CLEAN hauler preview", () => {
  // Any failing row means the user has correcting to do, and no assessment is
  // started. Decided from the just-parsed rows, not from state that has not
  // re-rendered yet.
  assert.match(portal, /const cleanPreview =\s*\n\s*missingColumns\.length === 0 &&/);
  assert.match(portal, /normalized\.every\(\(row\) => !row\._errors\?\.length\)/);
  assert.match(portal, /if \(cleanPreview\) \{/);
});

test("the upload assessment is invoked deliberately, never from an effect", () => {
  // An effect keyed on preview data would re-fire on every re-render and could
  // issue an assessment per keystroke in the editable preview.
  assert.doesNotMatch(
    portal,
    /useEffect\([^)]*runUploadVeraAssessment/s,
    "no effect may start an assessment",
  );
  // Three CALL sites: the clean hauler preview, the disposal preview, and the
  // explicit re-assess helper. (The definition reads
  // `const runUploadVeraAssessment = useCallback(`, which has no bare call paren.)
  assert.equal(
    (portal.match(/runUploadVeraAssessment\(/g) || []).length,
    3,
    "hauler preview + disposal preview + the re-assess button, and nothing else",
  );
  assert.match(portal, /const runUploadVeraAssessment = useCallback\(/);
});

test("the disposal assessment runs when there is something to explain, not on every file", () => {
  // The hauler upload asks VERA only about a CLEAN batch. The disposal upload is
  // the opposite case — it is a failing batch that needs explaining — but an
  // ordinary file that parsed cleanly and matched exactly still gets no
  // commentary, because there is nothing to say about it.
  assert.match(portal, /const worthExplaining =/);
  assert.match(portal, /detection\.isSystemGenerated \|\|/);
  assert.match(portal, /alignment\.needsEncoding\.length > 0/);
  assert.match(portal, /if \(worthExplaining\) \{/);
});

test("a new upload discards the previous assessment", () => {
  // Scenario: upload File A → VERA assesses A → upload File B. A's comment must
  // never be shown as B's.
  assert.match(portal, /haulerVeraCycleRef\.current \+= 1;/, "each cycle gets a new id");
  assert.match(
    portal,
    /if \(haulerVeraCycleRef\.current !== cycle\) return;/,
    "a late response for an old cycle is dropped",
  );
});

test("a VERA failure is not a validation failure, and never gates Import", () => {
  const panel = modals.slice(
    modals.indexOf("slf-hauler-vera-panel"),
    modals.indexOf("slf-hauler-vera-panel") + 3200,
  );
  assert.match(panel, /VERA assessment could not be completed/);
  assert.match(panel, /still <b>valid<\/b> and can be imported/, "the user is told the batch is unaffected");
  assert.match(panel, /Retry assessment/, "and can try again without re-uploading");
  // The Import button must not depend on the assessment.
  assert.doesNotMatch(
    modals,
    /disabled:[^,}]*haulerVeraStage/,
    "VERA must never gate Import",
  );
});

test("no placeholder assessment is ever shown", () => {
  // On failure the server's own reason is surfaced; nothing is invented.
  assert.match(portal, /data\?\.message \|\|\s*\n?\s*"VERA could not assess this upload right now\."/);
  assert.match(
    modals,
    /haulerVeraStage === "done" && \(\s*\n\s*<div className="slf-hauler-vera-comment">\{haulerVeraComment\}<\/div>/,
    "the comment renders only in the done state",
  );
});

test("edited preview rows can be re-assessed against what is on screen NOW", () => {
  // The preview is editable, so an assessment of the parsed file goes stale the
  // moment a cell is corrected.
  assert.match(portal, /const reassessHaulerUpload = useCallback\(/);
  assert.match(
    portal,
    /buildHaulerVeraContext\(\s*\n\s*uploadPreviewRows,\s*\n\s*uploadPreviewSummary,\s*\n\s*haulers,/,
    "re-assessment reads the CURRENT rows, not the originally parsed ones",
  );
  assert.match(
    portal,
    /buildDisposalVeraContext\(\s*\n\s*uploadPreviewRows,\s*\n\s*uploadAlignmentSummary,/,
    "and the same holds for a disposal preview",
  );
  assert.match(modals, /Re-assess edited rows/);
});
