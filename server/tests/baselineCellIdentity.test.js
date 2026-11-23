/**
 * Baseline cell IDENTITY — the Admin cell ↔ Portal Data Entry mapping.
 *
 * ── The bug this pins ───────────────────────────────────────────────────────
 * `cellIndex` is the stable relationship to the admin's cell configuration;
 * `cellName` is only a snapshot of the label at save time. Two halves were
 * missing:
 *
 *   • PATCH /portal-save-baseline stored `activeCellEntries`/`closedCellEntries`
 *     verbatim from the request body, and the body usually carried a name and no
 *     index. In the live database 1052 of 1112 baseline cell entries (94.6%) have
 *     no cellIndex at all.
 *   • GET /baseline/:slfName — the ONLY read that feeds Data Entry — returned
 *     those rows raw, while every other endpoint resolves names at the API
 *     boundary through applyResolvedCellNames.
 *
 * So Data Entry showed the frozen snapshot ("Cell 1", "CELL IA", and at one
 * facility the SLF's own name used as a cell name) while the admin table, the
 * submission lists and the reports all showed the admin's current name. Real
 * examples from the live data, both of which these tests reproduce:
 *   • BESLF — facility cells are named "Cell Area Phase 1/2/3"; the baseline row
 *     says "Cell 1" with no index, so the portal showed "Cell 1".
 *   • Olongapo — facility cell 2 is unnamed; the closed-cell row says "CELL IA",
 *     so the portal showed "CELL IA" where the admin shows "Cell 2".
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  resolveCellIndex,
  resolveBaselineCellEntries,
  facilityCellCount,
  resolveCellName,
} = require("../utils/cellNaming");

// Shapes taken from the live facilities named in the header.
const BESLF = {
  numberOfCell: 3,
  cellNames: ["Cell Area Phase 1", "Cell Area Phase 2", "Cell Area Phase 3"],
  cellTypes: ["Residual", "Residual", "Residual"],
  cellStatuses: ["Active Cell", "Reserved Area", "Reserved Area"],
};
const OLONGAPO = {
  numberOfCell: 2,
  cellNames: ["Cell 1B", ""],
  cellTypes: ["Residual", "Residual"],
  cellStatuses: ["Active Cell", "Used/Completed"],
};
const PRIME_WASTE = {
  numberOfCell: 6,
  cellNames: ["", "", "", "", "", "Cell for Treated Hazardous Waste"],
  cellTypes: ["Residual", "Residual", "Residual", "Residual", "Residual", "Treated Haz Waste"],
  cellStatuses: ["Reserved Area", "Used/Completed", "Used/Completed", "Active Cell", "Active Cell", "Active Cell"],
};

test("facilityCellCount agrees with the admin even when numberOfCell lags", () => {
  assert.equal(facilityCellCount(BESLF), 3);
  // An admin added a 4th cell's status/type without numberOfCell catching up.
  assert.equal(
    facilityCellCount({ numberOfCell: 3, cellStatuses: ["a", "b", "c", "d"], cellTypes: ["", "", "", ""] }),
    4,
    "the tail of the cell list must not be truncated",
  );
  assert.equal(facilityCellCount({}), 0);
  assert.equal(facilityCellCount(null), 0);
});

test("an existing in-range cellIndex is authoritative and is never overridden", () => {
  // The stored name disagrees with the facility; the INDEX still wins.
  assert.equal(resolveCellIndex(BESLF, { cellIndex: 2, cellName: "something else" }), 2);
  assert.equal(resolveCellIndex(BESLF, { cellIndex: 0, cellName: "Cell 3" }), 0);
});

test("an out-of-range index falls back to the name rather than pointing at nothing", () => {
  assert.equal(
    resolveCellIndex(BESLF, { cellIndex: 9, cellName: "Cell Area Phase 2" }),
    1,
    "an index past the facility's cells cannot identify a cell",
  );
});

test("a row with only a name binds to the admin cell of that name", () => {
  assert.equal(resolveCellIndex(BESLF, { cellName: "Cell Area Phase 2" }), 1);
  assert.equal(resolveCellIndex(BESLF, { cellName: "  cell area phase 3  " }), 2, "case and padding must not matter");
  assert.equal(resolveCellIndex(OLONGAPO, { cellName: "Cell 1B" }), 0);
});

test('the positional "Cell N" convention resolves, but only within the facility', () => {
  assert.equal(resolveCellIndex(BESLF, { cellName: "Cell 1" }), 0);
  assert.equal(resolveCellIndex(BESLF, { cellName: "Cell 3" }), 2);
  assert.equal(resolveCellIndex(BESLF, { cellName: "Cell 4" }), null, "the facility has only 3 cells");
  assert.equal(resolveCellIndex(BESLF, { cellName: "Cell 0" }), null, "cells are 1-based in the label");
});

test("an unrecognisable name binds to NOTHING rather than to a guessed cell", () => {
  // Live example: a facility name stored in the cellName field.
  assert.equal(resolveCellIndex(BESLF, { cellName: "GENERAL TINIO SANITARY LANDFILL" }), null);
  assert.equal(resolveCellIndex(BESLF, { cellName: "" }), null);
  assert.equal(resolveCellIndex(BESLF, {}), null);
  // A facility with no cell configuration cannot identify anything.
  assert.equal(resolveCellIndex({}, { cellName: "Cell 1" }), null);
});

test("REGRESSION — BESLF: the portal now shows the admin's cell name, not the snapshot", () => {
  const stored = [{ cellName: "Cell 1", wasteType: "Residual", volume: 28611.47, unit: "m³" }];
  const [row] = resolveBaselineCellEntries(stored, BESLF);

  assert.equal(row.cellIndex, 0, "the row must be bound to a real admin cell");
  assert.equal(row.cellName, "Cell Area Phase 1", "before the fix this stayed 'Cell 1'");
  assert.equal(row.cellType, "Residual");
  assert.equal(row.volume, 28611.47, "the encoded value must survive resolution untouched");
  assert.equal(row.unit, "m³");
});

test("REGRESSION — Olongapo: an unnamed admin cell wins over a stale snapshot", () => {
  const [row] = resolveBaselineCellEntries([{ cellName: "CELL IA", volume: 96000 }], OLONGAPO);
  // "CELL IA" matches no configured name and is not positional, so it stays
  // unbound — the safe answer. Binding it to cell 2 would be a guess.
  assert.equal(row.cellIndex, null);
  assert.equal(row.cellName, "CELL IA", "an unbound row keeps what the operator typed");

  // Once it DOES carry the index, the admin's label is what renders.
  const [bound] = resolveBaselineCellEntries([{ cellIndex: 1, cellName: "CELL IA", volume: 96000 }], OLONGAPO);
  assert.equal(bound.cellName, "Cell 2", "an unnamed admin cell renders positionally, matching the admin view");
});

test("the admin's cell TYPE wins for a bound row", () => {
  // Cell 6 is Treated Haz Waste in the admin config; the row claims Residual.
  const [row] = resolveBaselineCellEntries(
    [{ cellName: "Cell for Treated Hazardous Waste", cellType: "Residual", volume: 45195.39 }],
    PRIME_WASTE,
  );
  assert.equal(row.cellIndex, 5);
  assert.equal(row.cellType, "Treated Haz Waste", "a cell the admin reclassified must not keep the old type");
});

test("every Prime Waste row binds to its own distinct admin cell", () => {
  const stored = [1, 2, 3, 4, 5, 6].map((n) => ({ cellName: `Cell ${n}`, volume: n * 100 }));
  const rows = resolveBaselineCellEntries(stored, PRIME_WASTE);
  assert.deepEqual(rows.map((r) => r.cellIndex), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(rows.map((r) => r.volume), [100, 200, 300, 400, 500, 600], "volumes stay with their own cell");
  // Cell 6 is the hazardous one; the first five are residual.
  assert.deepEqual(rows.map((r) => r.cellType), Array(5).fill("Residual").concat("Treated Haz Waste"));
});

test("resolution is PURE — the stored rows are never mutated", () => {
  const stored = [{ cellName: "Cell 1", volume: 5 }];
  const snapshot = JSON.parse(JSON.stringify(stored));
  resolveBaselineCellEntries(stored, BESLF);
  assert.deepEqual(stored, snapshot, "the document in MongoDB must be left exactly as it was");
});

test("no facility (or a legacy generator ref) leaves the rows untouched", () => {
  const stored = [{ cellName: "Cell 1", volume: 5 }];
  assert.equal(resolveBaselineCellEntries(stored, null), stored, "never worse than before the fix");
  assert.equal(resolveBaselineCellEntries(undefined, BESLF), undefined);
  assert.equal(resolveBaselineCellEntries(null, BESLF), null);
});

test("an already-correct row keeps its object identity (no pointless copying)", () => {
  const row = { cellIndex: 0, cellName: "Cell Area Phase 1", cellType: "Residual", volume: 1 };
  const [out] = resolveBaselineCellEntries([row], BESLF);
  assert.equal(out, row);
});

test("resolveCellName still refuses to read cellIndex null as cell 0", () => {
  // Guards the pre-existing contract this fix depends on.
  assert.equal(resolveCellName(BESLF.cellNames, null, "typed name"), "typed name");
  assert.equal(resolveCellName(BESLF.cellNames, 0, "typed name"), "Cell Area Phase 1");
});

// ── Wiring: the two routes that must use the resolver ───────────────────────
const dataSlfSource = fs.readFileSync(path.join(__dirname, "..", "routes", "dataSLF.js"), "utf8");

const sliceRoute = (startMarker, endMarker) => {
  const from = dataSlfSource.indexOf(startMarker);
  assert.ok(from > -1, `${startMarker} not found`);
  const to = dataSlfSource.indexOf(endMarker, from);
  assert.ok(to > from, `end of ${startMarker} not found`);
  return dataSlfSource.slice(from, to);
};

test("GET /baseline/:slfName resolves BOTH cell lists before responding", () => {
  const route = sliceRoute('router.get("/baseline/:slfName"', 'router.get("/baselines"');
  // resolveBaselineCellEntriesForRead = resolveBaselineCellEntries + the cell's
  // declared unit (utils/baselineCellEntries.js).
  assert.match(
    route,
    /activeCellEntries: resolveBaselineCellEntriesForRead\(/,
    "the read that feeds Data Entry must bind rows to the admin's cells",
  );
  assert.match(route, /closedCellEntries: resolveBaselineCellEntriesForRead\(/);
  assert.match(route, /SlfFacility\.findById\(slfObjectId\)/, "the facility must be loaded to resolve against");
});

test("the baseline read fetches the facility in PARALLEL with the baseline rows", () => {
  const route = sliceRoute('router.get("/baseline/:slfName"', 'router.get("/baselines"');
  const parallel = route.indexOf("const [containers, recent, facilityById] = await Promise.all([");
  assert.ok(parallel > -1, "the facility lookup must not add a serial round trip to Data Entry loading");
});

test("PATCH /portal-save-baseline persists the resolved cellIndex", () => {
  const route = sliceRoute('router.patch("/portal-save-baseline/:slfName"', "module.exports");
  // prepareBaselineCellEntriesForSave = resolveBaselineCellEntries + declared
  // unit + whitelisted extras (utils/baselineCellEntries.js).
  assert.match(
    route,
    /activeCellEntries: prepareBaselineCellEntriesForSave\(activeCellEntries, saveFacility/,
    "new saves must store the stable index, not just a display name",
  );
  assert.match(route, /closedCellEntries: prepareBaselineCellEntriesForSave\(closedCellEntries, saveFacility/);
  assert.match(
    route,
    /select\(`isDummy \$\{FACILITY_CELL_UNIT_SELECT\}`\)/,
    "the save path needs the cell arrays, and gets them from a query it already makes",
  );
});
