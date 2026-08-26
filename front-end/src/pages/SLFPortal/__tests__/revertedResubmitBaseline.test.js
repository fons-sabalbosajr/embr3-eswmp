/**
 * Edit & Resubmit — the reverted record's baseline SNAPSHOT must not clobber the
 * SLF's resolved baseline.
 *
 * The bug this pins
 * -----------------
 * A submission carries a COPY of the baseline columns as they stood when it was
 * created. `handleEditReverted` assigned those straight onto `baselineForm`, and
 * `setFieldsValue({ x: undefined })` CLEARS a control rather than leaving it
 * alone — so opening a reverted submission wiped the baseline this form had just
 * loaded from GET /data-slf/baseline/:slfName.
 *
 * For Total Volume Accepted that is a dead end, not a cosmetic loss:
 * `missingBaselineInfo` blocks Review & Submit until the field is a positive
 * number, while the same handler's `setBaselineSaved(true)` renders that input
 * `disabled`. The operator is told to fill in a field they cannot type into, and
 * the reverted submission can never go back.
 *
 * It was MASKED — never fixed — by the cell-entry auto-calculation, which refilled
 * the blank field with the sum of the record's own cell rows. That is a different
 * number: measured against live data, 19 of the 26 outstanding reverted
 * submissions would have resubmitted a substituted figure, e.g. Prime Waste
 * Solution's real baseline of 596,981.38 going back as 318,065.35. So the
 * auto-calculation is now scoped to an UNLOCKED baseline — the only state in
 * which the cell rows can actually be edited — and the hydration keeps whatever
 * the form already holds.
 *
 * These rules live inside index.jsx (10k lines of JSX, not importable by the
 * plain-node runner), so they are pinned at the source level — same approach as
 * permitNotIssued.test.js and the server's submissionIdentity.test.js.
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "..", "index.jsx"), "utf8");

/** Source of one function declaration/arrow, bounded at the next top-level one. */
const block = (needle, endNeedle) => {
  const start = src.indexOf(needle);
  assert.ok(start > -1, `${needle} should exist in index.jsx`);
  const end = src.indexOf(endNeedle, start + needle.length);
  assert.ok(end > -1, `${endNeedle} should follow ${needle}`);
  return src.slice(start, end);
};

const editReverted = block(
  "const handleEditReverted = (record) => {",
  "const handleResubmitReverted",
);

test("the reverted record's blank baseline does not clear the resolved one", () => {
  assert.match(
    editReverted,
    /const keepBaseline = \(incoming, field\) =>\s*incoming \?\? baselineForm\.getFieldValue\(field\)/,
    "each field falls back to what the form already holds",
  );
  // `??`, never `||` — 0 is a real volume and must not fall through.
  assert.doesNotMatch(
    editReverted,
    /incoming \|\| baselineForm\.getFieldValue/,
    "|| would discard a stored zero",
  );
});

test("every baseline VOLUME on the resubmit form is hydrated through the guard", () => {
  for (const field of [
    "activeCellResidualVolume",
    "activeCellInertVolume",
    "closedCellResidualVolume",
    "closedCellInertVolume",
  ]) {
    assert.match(
      editReverted,
      new RegExp(`${field}: keepBaseline\\(\\s*record\\.${field},`),
      `${field} must not be assigned straight from the record`,
    );
  }
});

test("Total Volume Accepted takes the FACILITY's figure over the record's snapshot", () => {
  // `??` was not enough for this one field. A submission can store a real 0 —
  // reverted SLF-LGU-PA-0016 does, against a live baseline of 596,981.38 — and 0
  // is not nullish, so the snapshot won. That put 0 into an input Edit & Resubmit
  // DISABLES, while `missingBaselineInfo` blocked submission until it was
  // positive: an unfixable dead end on the one screen meant to clear it.
  assert.match(
    editReverted,
    /totalVolumeAccepted:\s*baselineTotalVolume \?\?\s*keepBaseline\(record\.totalVolumeAccepted, "totalVolumeAccepted"\)/,
    "the server-resolved figure leads; the record's copy is only the fallback",
  );
});

test("the baseline LISTS are kept too — haulers and cell entries", () => {
  // Same defect, different shape. Cell entries and accredited haulers are
  // FACILITY-level baseline data; what a submission stores is a snapshot taken
  // when it was created. Loading the record over the top replaced the operator's
  // real baseline with an old, usually smaller, copy.
  //
  // Measured against live data: Prime Waste Solution's baseline lists 150
  // accredited haulers and its reverted submission carries 1 — so Edit & Resubmit
  // collapsed 150 to 1, and resubmitting would have written that back.
  assert.match(
    editReverted,
    /const keepList = \(incoming, current\) =>\s*current\?\.length \? current : Array\.isArray\(incoming\) \? incoming : \[\];/,
    "the loaded baseline wins; the record's snapshot is the fallback",
  );
  for (const setter of ["setActiveCellEntries", "setClosedCellEntries"]) {
    assert.match(
      editReverted,
      new RegExp(`${setter}\\(\\(current\\) =>\\s*keepList\\(record\\.`),
      `${setter} must not overwrite the loaded baseline`,
    );
  }
  assert.match(
    editReverted,
    /setHaulers\(\(current\) =>\s*mergeHaulersByName\(\s*keepList\(record\.accreditedHaulers, current\),/,
  );
  assert.doesNotMatch(
    editReverted,
    /setHaulers\(\s*mergeHaulersByName\(record\.accreditedHaulers \|\| \[\]/,
    "the old call replaced the baseline's haulers with the record's snapshot",
  );
});

test("the resubmission carries the record's OWN companyType", () => {
  // It was never written into companyForm, yet the resubmit payload reads it back
  // out of there — so the read fell through to a hardcoded "LGU" derived from
  // slfInfo.ownership while slfInfo was still loading. That rewrote companyType
  // on a PRIVATE facility and re-stamped its ID No. under the wrong TYPE segment:
  // SLF-PVT-PA-0006 came back as SLF-LGU-PA-0016 on Prime Waste Solution.
  assert.match(editReverted, /companyType: record\.companyType,/);
});

test("the cell-entry total only overrides while the baseline is UNLOCKED", () => {
  assert.match(
    src,
    /const cellVolumeTotalIsAuthoritative =\s*!baselineSaved && hasCellVolumeEntries && computedTotalVolumeAccepted > 0;/,
    "a locked baseline shows what is stored, not a recomputation of a snapshot",
  );
});

test("a locked Total Volume Accepted is still not editable by hand", () => {
  // Scoping the auto-calculation must not hand the operator an input the lock is
  // supposed to close: `baselineSaved` still disables it on its own.
  assert.match(src, /disabled=\{baselineSaved \|\| cellVolumeTotalIsAuthoritative\}/);
});

test("Review & Submit still requires a positive Total Volume Accepted", () => {
  // The RULE is unchanged — these fixes supply the value, they never relax the
  // gate the server enforces again on submit.
  assert.match(src, /const missingBaselineInfo = !\(Number\(effectiveTotalVolumeAccepted\) > 0\);/);
});

test("the gate reads the form first and the facility's figure second", () => {
  // Order matters: an operator editing an unlocked baseline must see their own
  // typing win, and a blank form must not report the facility as having no
  // baseline when the server resolved one.
  assert.match(
    src,
    /const effectiveTotalVolumeAccepted = \(\(\) => \{[\s\S]{0,400}if \(fromForm !== undefined && fromForm !== null && fromForm !== ""\) return fromForm;\s*return baselineTotalVolume;/,
  );
  // …and the save paths get the same last resort, so a resubmission cannot go
  // out carrying nothing while the facility has a figure on record.
  assert.equal(
    (src.match(/baselineValue: baselineTotalVolume,/g) || []).length,
    3,
    "all three payload builders must fall back to it",
  );
  assert.match(src, /return Number\(baselineValue\) > 0 \? baselineValue : undefined;/);
});

test("the entry being corrected does not count as an unresolved revert", () => {
  // The rule blocks a NEW submission while an old revert sits unresolved. It was
  // also counting the record just opened with Edit & Resubmit — the very act that
  // resolves it — so "Correct and resubmit your reverted submission first"
  // appeared as a blocker ON that resubmission. A closed loop.
  assert.match(
    src,
    /if \(editingRevertedId && String\(s\._id\) === String\(editingRevertedId\)\) return false;/,
  );
  // Excluded by id, not by status: the row stays `reverted` until the PUT lands.
  assert.match(src, /\}, \[submissions, editingRevertedId\]\);/);
});

test("the submit blockers NAME the fields that are failing", () => {
  // One sentence ending "(incl. a disposal cell for each entry)" is a single
  // example presented as the whole problem. On SLF-LGU-PA-0016 the failures were
  // Actual Volume and Waste Type, so the operator placed a cell and the blocker
  // did not move.
  assert.match(src, /formatWasteGenIssues\(wasteGenValidationIssues, 6\)\.forEach\(/);
  assert.doesNotMatch(
    src,
    /Complete every required Waste Generation Information field \(incl\. a disposal cell for each entry\)\./,
  );
});
