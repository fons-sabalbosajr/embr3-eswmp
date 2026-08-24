/**
 * SLF Overview → a permit that has not been ISSUED must not claim compliance.
 *
 * The bug this pins
 * -----------------
 * Operators record two things in the permit-number field when the facility holds
 * no permit: the word "None", or the application they have filed. Both are
 * non-empty strings, so `resolvePermitStatus` treated them as a real reference,
 * and because neither carries a validity date `permitStatus` fell through to
 *
 *     if (!validity) return { label: statusText || "New / Complied", color: "blue" };
 *
 * stamping a confident blue "New / Complied" badge underneath a line that read
 * "On going application with application No. 347672".
 *
 * Sibling of permitNotRequired.test.js — that one covers a permit that does not
 * APPLY, this one covers a permit that applies and has not been granted. The two
 * render differently on purpose, so they are guarded separately.
 *
 * The strings below are the actual distinct values held in the SlfFacility
 * collection for dischargePermit / permitToOperate / hazwasteGenerationId, not
 * invented examples.
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const helpersSrc = fs.readFileSync(
  path.join(here, "..", "..", "admin", "slf-monitoring", "helpers.jsx"),
  "utf8",
);
const panelSrc = fs.readFileSync(path.join(here, "..", "OverviewPanel.jsx"), "utf8");

/**
 * Pull the predicate out of the shared helpers module and evaluate it.
 * helpers.jsx imports antd, so it cannot be `require`d from a plain node test —
 * but the function is a self-contained arrow over a string, so lifting just that
 * declaration runs the REAL implementation rather than a copy of it.
 */
function loadIsPermitNotIssued() {
  const start = helpersSrc.indexOf("const isPermitNotIssued =");
  assert.ok(start > -1, "isPermitNotIssued should exist in slf-monitoring/helpers.jsx");
  const end = helpersSrc.indexOf("\n};", start);
  assert.ok(end > start, "isPermitNotIssued should be a brace-bodied arrow function");
  const decl = helpersSrc.slice(start, end + 3);
  // eslint-disable-next-line no-new-func
  return new Function(`${decl}; return isPermitNotIssued;`)();
}

const isPermitNotIssued = loadIsPermitNotIssued();

test("the real 'no permit' values in the database are recognised", () => {
  const notIssued = [
    "None",
    "none",
    "On going application with application No. 347672",
    "On going application with application No. 413246",
    "On going application with application No. 472323",
    "Application No: 214898",
    "Ongoing application",
  ];
  for (const value of notIssued) {
    assert.equal(isPermitNotIssued(value), true, `${JSON.stringify(value)} means no permit was issued`);
  }
});

test("real issued permit numbers are NOT suppressed", () => {
  // Suppressing one of these would hide a permit the facility genuinely holds —
  // a worse failure than the bug being fixed.
  const issued = [
    "DP-R03-26-01501",
    "DP-R03-25-09433",
    "PTO-OL-R03-2024-09086",
    "PTO-OL-R03-2023-04394",
    "OL-GR-R3-49-030610",
    "OL-GR-R3-77-065040",
    "ECC-OL-R03-2025-0558",
  ];
  for (const value of issued) {
    assert.equal(isPermitNotIssued(value), false, `${JSON.stringify(value)} is a real permit number`);
  }
});

test("'Not Required' stays a separate concept", () => {
  // "Not Required" has its own wording and its own guard. If this predicate
  // swallowed it, the card would silently stop saying the permit does not apply.
  assert.equal(isPermitNotIssued("Not Required"), false);
  assert.equal(isPermitNotIssued("N/A"), false);
});

test("empty values are left to the existing no-data path", () => {
  // Blank/absent is already handled by `hasAnyData`, which renders "Not encoded".
  // Claiming those here would just duplicate that branch.
  for (const value of ["", "   ", null, undefined]) {
    assert.equal(isPermitNotIssued(value), false);
  }
});

/** The panel's `permitNotIssued`, lifted and executed like its sibling above. */
function loadPermitNotIssued() {
  const start = panelSrc.indexOf("const permitNotIssued = (");
  assert.ok(start > -1, "permitNotIssued should exist in OverviewPanel.jsx");
  const end = panelSrc.indexOf("\n  };", start);
  assert.ok(end > start, "permitNotIssued should be a brace-bodied arrow function");
  const decl = panelSrc.slice(start, end + 5).replace(/^\s*const/, "const");
  // eslint-disable-next-line no-new-func
  return new Function("isPermitNotIssued", `${decl}; return permitNotIssued;`)(isPermitNotIssued);
}

const permitNotIssued = loadPermitNotIssued();

test("a real permit in the array is not suppressed by a stale flat 'None'", () => {
  // The bug this pins was mine, found in review. Structuring the check like
  // `permitNotRequired` — ORing the flat number in separately — meant a facility
  // holding a genuine permit in `permitToOperatePermits` while an old flat
  // `permitToOperate` still read "None" had its badge suppressed, hiding a
  // permit it actually holds. Judging the DISPLAYED references is what fixes it.
  const references = [{ permitNo: "PTO-OL-R03-2024-09086", validity: "2026-01-01" }];
  assert.equal(
    permitNotIssued("None", references),
    false,
    "a displayed real permit number must win over a stale flat placeholder",
  );
});

test("a mixed reference list counts as issued", () => {
  const references = [
    { permitNo: "DP-R03-26-01501", validity: "2026-01-01" },
    { permitNo: "None", validity: "" },
  ];
  assert.equal(permitNotIssued("", references), false, "one real permit is enough to be issued");
});

test("an all-placeholder reference list counts as not issued", () => {
  const references = [{ permitNo: "On going application with application No. 347672", validity: "" }];
  assert.equal(permitNotIssued("", references), true);
});

test("with no references it falls back to the status field", () => {
  assert.equal(permitNotIssued("None", []), true);
  assert.equal(permitNotIssued("", []), false);
});

test("the not-issued guard runs before the compliance fallback", () => {
  // Ordering is the whole fix: an ongoing application IS data, so if the check
  // sat after `hasAnyData` it would sail past and reach "New / Complied".
  const resolve = panelSrc.slice(panelSrc.indexOf("const resolvePermitStatus ="));
  const guardAt = resolve.indexOf("permitNotIssued(legacyStatus, references)");
  const hasAnyDataAt = resolve.indexOf("const hasAnyData");
  assert.ok(guardAt > -1, "resolvePermitStatus should consult permitNotIssued");
  assert.ok(hasAnyDataAt > -1, "resolvePermitStatus should still have its no-data branch");
  assert.ok(
    guardAt < hasAnyDataAt,
    "the not-issued guard must run BEFORE the has-any-data check, or it never fires",
  );
});

test("the not-issued badge is hidden, not relabelled", () => {
  const resolve = panelSrc.slice(panelSrc.indexOf("const resolvePermitStatus ="));
  const branch = resolve.slice(resolve.indexOf("permitNotIssued(legacyStatus, references)"));
  assert.match(
    branch.slice(0, 260),
    /hideStatus: true/,
    "an unissued permit must suppress the badge",
  );
  // The reference the operator typed still renders; only the badge goes.
  assert.doesNotMatch(
    branch.slice(0, 260),
    /notRequired: true/,
    "an unissued permit must not be relabelled as Not Required — different meaning",
  );
});

test("the Hazardous Waste Generator ID tile uses the same rule", () => {
  // Haz has no badge, so "hide the status" there means not presenting "None" as
  // though it were an issued ID.
  const idx = panelSrc.indexOf('"Hazardous Waste Generator ID"');
  assert.ok(idx > -1, "the Haz tile should exist in the SLF Overview grid");
  assert.match(
    panelSrc.slice(idx, idx + 320),
    /isPermitNotIssued\(slfInfo\?\.hazwasteGenerationId\)/,
    "the Haz tile must apply the same not-issued rule",
  );
});
