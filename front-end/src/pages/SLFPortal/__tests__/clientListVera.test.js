/**
 * Per-hauler client list → VERA assessment: the contract, and the workflow
 * rules.
 *
 * WHY THIS EXISTS. `pageContext` is a contract with the server, and the server
 * is entitled to throw the whole snapshot away (sanitizePageContext returns
 * null with no tables and no stats; wantsPageData gates whether the snapshot is
 * spent at all; portalSafePageContext drops admin-sounding labels). When any of
 * those fires, VERA still answers — from its knowledge base, about nothing in
 * particular — and the UI shows that as a normal assessment. That silent
 * downgrade is the failure worth testing for, so these run the REAL server
 * sanitizer over the real snapshot the panel builds.
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
  buildClientListVeraContext,
  findSimilarClientNames,
  CLIENT_VERA_ASSESSMENT_PROMPT,
  CLIENT_VERA_TABLE_ROW_CAP,
} from "../clientListVeraContext.js";
import { annotateClientUploadRows, summarizeClientUpload } from "../clientListUpload.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.join(here, "..", "..", "..", "..", "..", "server");
const require = createRequire(pathToFileURL(path.join(serverRoot, "package.json")));

// The REAL server-side sanitizer this snapshot has to survive.
const veraPageData = require("./utils/veraPageData.js");

const HAULER = {
  haulerName: "XYZ Hauling Services",
  privateSectorClients: [
    { clientName: "ABC Manufacturing", clientType: "Private", provinceName: "Pampanga" },
    { clientName: "DEF Foods", clientType: "Private", provinceName: "Pampanga" },
  ],
};

const ROWS = annotateClientUploadRows(
  [
    { clientName: "ABC Manufacturing", clientType: "Private", clientAddress: "Corrected" },
    { clientName: "Baliuag LGU", clientType: "LGU", provinceName: "Bulacan", municipalityName: "Baliuag" },
    { clientName: "Tarlac City LGU", clientType: "LGU", provinceName: "Tarlac" },
  ],
  HAULER.privateSectorClients,
);
const SUMMARY = summarizeClientUpload(ROWS);

// ── The contract with the server ────────────────────────────────────────────
test("the client-list snapshot survives the server's sanitizer with its rows intact", () => {
  const clean = veraPageData.sanitizePageContext(
    buildClientListVeraContext(ROWS, SUMMARY, HAULER),
  );

  assert.ok(clean, "sanitize must not reject the snapshot — a null here means VERA sees NOTHING");
  assert.equal(clean.tables.length, 1);
  assert.equal(clean.tables[0].rows.length, 3, "every previewed row survives");
  assert.equal(clean.tables[0].columns.length, 8, "and its columns — inside the server's MAX_COLS of 12");
  assert.ok(clean.stats.length >= 10, "the counts survive too");
  assert.equal(clean.inModal, true);
});

test("the client-list prompt is one the server will actually spend the snapshot on", () => {
  assert.equal(
    veraPageData.wantsPageData(CLIENT_VERA_ASSESSMENT_PROMPT),
    true,
    "the assessment prompt must read as a question about the data on screen",
  );
});

test("a validated client list is never mistaken for an empty dataset", () => {
  const clean = veraPageData.sanitizePageContext(
    buildClientListVeraContext(ROWS, SUMMARY, HAULER),
  );
  assert.equal(veraPageData.isEmptyDataset(clean), false);
});

test("the client-list labels survive the portal-user safety filter", () => {
  const veraRoute = fs.readFileSync(path.join(serverRoot, "routes", "vera.js"), "utf8");
  const match = veraRoute.match(/const blocked = (\/.+\/i);/);
  assert.ok(match, "the portal blocklist must still be found in routes/vera.js");
  const blocked = new RegExp(match[1].slice(1, -2), "i");

  const ctx = buildClientListVeraContext(ROWS, SUMMARY, HAULER);
  assert.equal(blocked.test(`${ctx.label} ${ctx.modalTitle}`), false, "the snapshot label passes");
  ctx.tables.forEach((t) =>
    assert.equal(blocked.test(String(t.label)), false, `table label "${t.label}" passes`),
  );
  ctx.stats.forEach((s) =>
    assert.equal(blocked.test(String(s.label)), false, `stat label "${s.label}" passes`),
  );
});

test("the hauler being edited is named, since no column carries it", () => {
  // This format has no Hauler Name column by design, so without this stat VERA
  // would be assessing a client list with no idea whose it is.
  const ctx = buildClientListVeraContext(ROWS, SUMMARY, HAULER);
  const stat = ctx.stats.find((s) => s.label === "Hauler being edited");
  assert.equal(stat.value, "XYZ Hauling Services");
  assert.equal(
    ctx.stats.find((s) => s.label === "Clients already on this hauler").value,
    "2",
  );
});

// ── Payload discipline ──────────────────────────────────────────────────────
test("a large client list is capped, and says how large it really was", () => {
  const many = Array.from({ length: 500 }, (_, i) => ({
    _rowNumber: i + 2,
    _status: "new",
    clientName: `Client ${i}`,
    clientType: "Private",
    provinceName: "Bulacan",
  }));
  const ctx = buildClientListVeraContext(many, { ...SUMMARY, total: 500 }, HAULER);

  assert.equal(ctx.tables[0].rows.length, CLIENT_VERA_TABLE_ROW_CAP);
  assert.equal(ctx.tables[0].truncated, 500, "…but VERA is told the list is 500");
  const clean = veraPageData.sanitizePageContext(ctx);
  assert.equal(clean.tables[0].totalRowCount, 500);
});

test("an empty or malformed input does not throw", () => {
  assert.doesNotThrow(() => buildClientListVeraContext([], null, null));
  assert.doesNotThrow(() => buildClientListVeraContext(null, undefined, undefined));
  assert.equal(buildClientListVeraContext([], null, {}).tables[0].empty, true);
});

// ── The finding VERA exists here to make ────────────────────────────────────
test("a near-miss client name is computed, not left for the model to notice", () => {
  // Matching is by name, so "ABC Manufacturing Inc" against a stored
  // "ABC Manufacturing" validates, applies, and leaves the hauler with two
  // records for one company. Nothing about the row is invalid.
  const found = findSimilarClientNames(
    [{ clientName: "ABC Manufacturing Inc" }],
    HAULER.privateSectorClients,
  );
  assert.deepEqual(found, [
    { uploaded: "ABC Manufacturing Inc", existing: "ABC Manufacturing" },
  ]);

  const ctx = buildClientListVeraContext(
    [{ _rowNumber: 2, _status: "new", clientName: "ABC Manufacturing Inc", clientType: "Private" }],
    SUMMARY,
    HAULER,
  );
  const labels = ctx.stats.map((s) => s.label);
  assert.ok(labels.includes("Names resembling an existing client"));
  assert.ok(labels.some((l) => l.includes('Uploaded "ABC Manufacturing Inc" resembles stored')));
});

test("an EXACT client match is an update, and is never reported as a near-miss", () => {
  // Casing and spacing already resolve to the same client, so flagging them
  // would put a warning on every routine re-upload of an export.
  assert.deepEqual(
    findSimilarClientNames([{ clientName: "  abc   manufacturing " }], HAULER.privateSectorClients),
    [],
  );
  assert.deepEqual(
    findSimilarClientNames([{ clientName: "Unrelated Co" }], HAULER.privateSectorClients),
    [],
  );
  // A short shared prefix is a coincidence, not a resemblance.
  assert.deepEqual(findSimilarClientNames([{ clientName: "ABC" }], [{ clientName: "ABC Foods" }]), []);
  // A client stored as a bare string is still compared.
  assert.equal(findSimilarClientNames([{ clientName: "Legacy Client Co" }], ["Legacy Client"]).length, 1);
});

test("the type split and missing provinces are counted for VERA", () => {
  const ctx = buildClientListVeraContext(ROWS, SUMMARY, HAULER);
  const stat = (label) => ctx.stats.find((s) => s.label === label)?.value;
  assert.equal(stat("Rows typed as LGU"), "2");
  assert.equal(stat("Rows typed as Private"), "1");
  // Row 1 updates an existing client and supplies no province — legal, but
  // worth VERA seeing, since an LGU/Private mix-up changes how the client is
  // counted in the Region 3 LGU-served figures.
  assert.equal(stat("Rows with no province"), "1");
  assert.equal(stat("Distinct provinces in file"), "2");
});

// ── The workflow rules, read off the panel ──────────────────────────────────
const panel = fs.readFileSync(path.join(here, "..", "HaulerClientListPanel.jsx"), "utf8");

test("VERA runs only on a CLEAN client-list preview", () => {
  assert.match(panel, /const clean =\s*\n\s*missing\.length === 0 &&/);
  assert.match(panel, /getClientUploadRowErrors\(row, names\)\.length === 0/);
  assert.match(panel, /if \(clean\) \{/);
});

test("the client-list assessment is invoked deliberately, never from an effect", () => {
  assert.doesNotMatch(
    panel,
    /useEffect\([^)]*runVeraAssessment/s,
    "no effect may start an assessment",
  );
  // Two CALL sites: the clean-preview path and the re-assess helper.
  assert.equal(
    (panel.match(/runVeraAssessment\(/g) || []).length,
    2,
    "clean preview + the re-assess button, and nothing else",
  );
  assert.match(panel, /const runVeraAssessment = useCallback\(/);
});

test("a new file discards the previous assessment", () => {
  assert.match(panel, /veraCycleRef\.current \+= 1;/);
  assert.match(panel, /if \(veraCycleRef\.current !== cycle\) return;/);
});

test("a VERA failure is not a validation failure, and never gates Apply", () => {
  assert.match(panel, /VERA assessment could not be completed/);
  assert.match(panel, /still <b>valid<\/b> and can be applied/);
  assert.match(panel, /Retry assessment/);
  // Apply's disabled state depends on `blocked` only.
  assert.match(panel, /disabled: blocked \|\| annotated\.length === 0/);
  assert.doesNotMatch(panel, /disabled[^\n]*veraStage/, "VERA must never gate Apply");
});

test("no placeholder assessment is ever shown", () => {
  assert.match(panel, /data\?\.message \|\| "VERA could not assess this client list right now\."/);
  assert.match(
    panel,
    /veraStage === "done" && \(\s*\n\s*<div className="slf-hauler-vera-comment">\{veraComment\}<\/div>/,
  );
});

test("applying writes to the hauler DRAFT, not straight to the baseline", () => {
  // Two gates still stand between an upload and stored data: the modal's Update
  // and then Save Baseline Update. The panel must not bypass either.
  assert.match(panel, /updateHaulerDraft\(\s*\n?\s*"privateSectorClients",/);
  assert.doesNotMatch(panel, /api\.(post|put|patch)\(\s*"\/data-slf/, "the panel never persists directly");
  assert.match(panel, /Save Baseline Update/, "and says so in the preview");
});
