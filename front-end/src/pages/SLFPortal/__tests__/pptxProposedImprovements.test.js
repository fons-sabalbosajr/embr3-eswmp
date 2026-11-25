/**
 * Acceptance checks for docs/files/Proposed_SLF_Portal_Improvements.pptx —
 * the portal half. One block per slide, using the deck's own examples (the
 * fictional demo facility "Demonstration Valley Sanitary Landfill"), against
 * the functions the portal actually calls. Detailed edge cases live in each
 * feature's own test file; this file is the slide-by-slide checklist.
 *
 * The server half lives in server/tests/pptxProposedImprovements.test.js.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { autosaveDecision, AUTOSAVE_IDLE_MS } from "../draftAutosave.js";
import { filterDocuments, countByType, fileNameFromDisposition, DOCUMENT_TYPES } from "../myDocuments.js";
import { backlogWindow, applyBacklogRules, summarizeBacklog } from "../backlogUpload.js";
import { convertEntered, enteredVolumePatch, describeConversion, factorText, uploadRowToSlfUnit } from "../enteredVolume.js";
import { normalizeComparableText } from "../uploadHelpers.js";
import { findClientNearMisses, findHaulerNearMisses, resolveDisposalIdentity } from "../systemGeneratedUpload.js";
import { portalSource } from "./portalSource.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(here, "..", rel), "utf8");

// The deck's "today": Nov 24, 2026 (local calendar day, as the browser sees it).
const NOW = new Date(2026, 10, 24, 10, 0, 0);
const day = (offset) => {
  const d = new Date(2026, 9, 24 + offset); // Oct 24 + offset
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// ── Slide 3 · Autosave entries to Drafts ─────────────────────────────────────
test("slide 3: the draft saves on its own once the user pauses typing", () => {
  const t0 = 1_000_000;
  // Nothing entered yet: nothing to save.
  assert.equal(autosaveDecision({ signature: null, now: t0 }).action, "empty");
  // The user types: the change is noticed, then the portal waits for a pause…
  assert.equal(autosaveDecision({ signature: "A", savedSignature: null, seenSignature: null, changedAt: t0, now: t0 }).action, "changed");
  assert.equal(autosaveDecision({ signature: "A", savedSignature: null, seenSignature: "A", changedAt: t0, now: t0 + 1000 }).action, "wait");
  // …and saves without a click once the user stops.
  assert.equal(
    autosaveDecision({ signature: "A", savedSignature: null, seenSignature: "A", changedAt: t0, now: t0 + AUTOSAVE_IDLE_MS }).action,
    "save",
  );
  // Already saved: no repeat save.
  assert.equal(autosaveDecision({ signature: "A", savedSignature: "A", seenSignature: "A", changedAt: t0, now: t0 + 60_000 }).action, "clean");
});

test("slide 3: a failed autosave does not hammer the server, and the draft list shows when it was saved", () => {
  const t0 = 1_000_000;
  const decision = autosaveDecision({
    signature: "A",
    savedSignature: null,
    seenSignature: "A",
    changedAt: t0,
    failedSignature: "A",
    failedAt: t0 + AUTOSAVE_IDLE_MS,
    now: t0 + AUTOSAVE_IDLE_MS + 1000,
  });
  assert.equal(decision.action, "wait", "a failed save is retried later, not on every poll");
  const panel = read("DraftsScheduledPanel.jsx");
  assert.match(panel, /title: "Last Saved"/, "Drafts & Scheduled has a last-saved column");
  assert.match(panel, /autosavedAt/, "and it marks a draft the portal saved on its own");
});

// ── Slide 4 · Multiple MOV downloads + My Documents ──────────────────────────
const DOCS = [
  { id: "1", type: "mov", section: "Active Cells", cellName: "Cell 2", fileName: "MOV · Active Cells (Cell 2).pdf", submissionIds: [] },
  { id: "2", type: "mov", section: "Closed Cells", fileName: "MOV · Closed Cells.pdf", submissionIds: [] },
  { id: "3", type: "mov", section: "Leachate Monitoring", fileName: "MOV · Leachate Monitoring.pdf", submissionIds: [] },
  { id: "4", type: "attachment", section: "Support Ticket", fileName: "trip tickets.pdf", reference: "SLF-2026-0342", submissionIds: ["SLF-2026-0342"] },
];

test("slide 4: My Documents is a portal menu item", () => {
  const src = portalSource();
  assert.match(src, /key: "documents"/);
  assert.match(src, /My Documents/);
  assert.match(src, /activeMenu === "documents"/, "the menu opens the documents panel");
});

test("slide 4: files filter by type, by cell, and by Submission ID", () => {
  assert.deepEqual(DOCUMENT_TYPES.map((t) => t.label).slice(0, 2), ["All", "MOV"]);
  assert.equal(filterDocuments(DOCS, { type: "mov" }).length, 3);
  assert.deepEqual(filterDocuments(DOCS, { place: "Active Cells · Cell 2" }).map((d) => d.id), ["1"]);
  assert.deepEqual(filterDocuments(DOCS, { search: "SLF-2026-0342" }).map((d) => d.id), ["4"]);
  assert.deepEqual(countByType(DOCS), { all: 4, mov: 3, letter: 0, attachment: 1 });
});

test("slide 4: the ticked files come back as one .zip", () => {
  assert.equal(
    fileNameFromDisposition(`attachment; filename="x.zip"; filename*=UTF-8''${encodeURIComponent("My Documents - Demonstration Valley Sanitary Landfill - 2026-11-24.zip")}`),
    "My Documents - Demonstration Valley Sanitary Landfill - 2026-11-24.zip",
  );
  const panel = read("MyDocumentsPanel.jsx");
  assert.match(panel, /\/download/, "the panel posts the selection to the zip download");
  assert.match(panel, /ids/, "by document id");
});

// ── Slide 5 · Upload up to one month of backlog at once ──────────────────────
test("slide 5: the accepted window is one month back to today", () => {
  assert.deepEqual(backlogWindow(NOW), { from: "2026-10-24", to: "2026-11-24" });
});

test("slide 5: an Oct 24 – Nov 23 file is accepted and previewed day by day", () => {
  const rows = Array.from({ length: 31 }, (_, i) => ({ disposalDate: day(i), actualVolume: 20 }));
  const checked = applyBacklogRules(rows, { now: NOW });
  assert.ok(checked.every((row) => !row._errors?.length), "no row is refused");
  const summary = summarizeBacklog(rows, "", { now: NOW });
  assert.equal(summary.days.length, 31, "one submission per disposal date");
  assert.equal(summary.from, "2026-10-24");
  assert.equal(summary.to, "2026-11-23");
  assert.deepEqual(summary.outOfWindow, []);
});

test("slide 5: rows too old or in the future are refused, the rest are not", () => {
  const rows = [
    { disposalDate: "2026-10-23", actualVolume: 5 }, // one day past the window
    { disposalDate: "2026-11-10", actualVolume: 5 },
    { disposalDate: "2026-11-25", actualVolume: 5 }, // tomorrow
  ];
  const [old, ok, future] = applyBacklogRules(rows, { now: NOW });
  assert.match(old._errors.join(" "), /more than one month ago/);
  assert.equal(ok._errors, undefined);
  assert.match(future._errors.join(" "), /in the future/);
});

// ── Slide 6 · Tons converted to m³ in the preview ────────────────────────────
test("slide 6: 12.5 tons shows as 25.0 m³ using m³ = tons ÷ 0.5", () => {
  assert.equal(convertEntered(12.5, "tons", "m³"), 25);
  assert.equal(factorText("m³"), "m³ = tons ÷ 0.5");
});

test("slide 6: the m³ value is what is saved, and the tons stay with the record", () => {
  const patch = enteredVolumePatch(12.5, "tons", "m³");
  assert.deepEqual(patch, { actualVolume: 25, enteredVolume: 12.5, enteredVolumeUnit: "tons" });
  assert.equal(describeConversion({ ...patch, actualVolumeUnit: "m³" }, "m³"), "12.5 tons → 25 m³");
  // An entry already in the SLF's unit is left exactly as typed.
  assert.deepEqual(enteredVolumePatch(18.5, "m³", "m³"), { actualVolume: 18.5, enteredVolume: undefined, enteredVolumeUnit: undefined });
});

test("slide 6: an uploaded row weighed in tons is previewed in m³", () => {
  const row = uploadRowToSlfUnit({ actualVolume: 12.5, actualVolumeUnit: "tons", truckCapacity: 10 }, "m³");
  assert.equal(row.actualVolume, 25);
  assert.equal(row.actualVolumeUnit, "m³");
  assert.equal(row.enteredVolume, 12.5);
  assert.equal(row.enteredVolumeUnit, "tons");
});

// ── Slide 7 · Corrected data flows back to the portal ────────────────────────
test("slide 7: the portal marks EMB-verified clients and refreshes when EMB corrects them", () => {
  const mark = read("EmbVerifiedMark.jsx");
  assert.match(mark, /Verified by EMB/);
  assert.match(mark, /embVerified\?\.at/, "shown only when the server set the mark");
  const src = portalSource();
  assert.match(src, /data_verified_by_emb/, "the notification type the server sends is handled");
});

// ── Slide 8 · Accept small differences in names ──────────────────────────────
const same = (a, b) => normalizeComparableText(a) !== "" && normalizeComparableText(a) === normalizeComparableText(b);
const HAULERS = [
  {
    haulerName: "Northwind Sample Haulers",
    privateSectorClients: [
      { clientName: "Villa Muestra", clientType: "LGU" },
      { clientName: "Copperleaf Demo Transport", clientType: "Private" },
    ],
  },
];

test("slide 8: commas, periods, capitals and spaces are treated as the same", () => {
  assert.equal(same("Northgate Sample Logistics, Inc", "Northgate Sample Logistics Inc."), true);
  assert.equal(same("NORTHWIND SAMPLE HAULERS", "Northwind Sample Haulers"), true);
  assert.equal(same("Brgy.  Poblacion,Villa Muestra", "Brgy. Poblacion, Villa Muestra"), true);
});

test("slide 8: a different word, a missing letter or a missing word asks 'Did you mean'", () => {
  const [hauler] = findHaulerNearMisses(HAULERS, "Northwest Sample Haulers");
  assert.equal(hauler?.name, "Northwind Sample Haulers");
  assert.match(
    resolveDisposalIdentity({ hauler: "Northwest Sample Haulers", client: "Someone Else" }, HAULERS).reason,
    /Did you mean "Northwind Sample Haulers"\?/,
  );
  const [client] = findClientNearMisses(HAULERS[0], "Villa Muesta");
  assert.equal(client?.name, "Villa Muestra");
  assert.equal(
    resolveDisposalIdentity({ hauler: "Northwind Sample Haulers", client: "Villa Muesta" }, HAULERS).status,
    "mismatch",
    "the user confirms it — it is never applied silently",
  );
  assert.ok(findClientNearMisses(HAULERS[0], "Copperleaf Transport").some((s) => s.name === "Copperleaf Demo Transport"));
});
