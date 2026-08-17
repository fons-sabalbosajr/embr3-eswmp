/**
 * SLF Overview → a permit that is NOT REQUIRED must not also claim compliance.
 *
 * THE DEFECT THIS PINS. The card read the not-required marking from the permit's
 * `status` field only. But there is no "Not Required" number to type, so an
 * operator recording a non-applicable permit writes the words into the permit
 * NUMBER — which is exactly the text the card then displays. The guard missed it,
 * fell through to `statusText || "New / Complied"`, and the card rendered:
 *
 *     Permit to Operate
 *     Not Required          ← the operator's own words, from the number field
 *     New / Complied        ← a blue badge asserting compliance anyway
 *
 * Two contradictory claims about the same permit, the second of which is a
 * compliance statement about a permit the facility does not need. That is worse
 * than a cosmetic bug: it is the card asserting something untrue about regulatory
 * status.
 *
 * The status logic is inline in the panel, so these are source assertions — the
 * same approach the cell-volume invariants use for front-end rules.
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const panel = fs.readFileSync(path.join(here, "..", "OverviewPanel.jsx"), "utf8");

const slice = (source, start, end) => {
  const a = source.indexOf(start);
  assert.ok(a > -1, `not found: ${start}`);
  const b = source.indexOf(end, a);
  assert.ok(b > a, `end not found after ${start}`);
  return source.slice(a, b);
};

test("the not-required marking is read from the NUMBER as well as the status", () => {
  const guard = slice(panel, "const permitNotRequired =", "const resolvePermitStatus");

  // The flat legacy field and every array entry, on BOTH fields.
  assert.match(guard, /isPermitNotRequired\(legacyStatus\)/, "the legacy status");
  assert.match(guard, /isPermitNotRequired\(legacyNo\)/, "the legacy number — this was the gap");
  assert.match(guard, /isPermitNotRequired\(item\?\.status\)/, "each entry's status");
  assert.match(guard, /isPermitNotRequired\(item\?\.permitNo\)/, "each entry's number");
});

test("both permit cards actually pass their number to the guard", () => {
  // A guard that accepts `legacyNo` but is never given one is the same bug with
  // more code, so the call sites are pinned too.
  const cards = slice(panel, "const permitCards = [", "// #4: on-slice label");
  assert.match(cards, /ptoReferences,\s*\n\s*slfInfo\?\.permitToOperate,/, "Permit to Operate");
  assert.match(cards, /dpReferences,\s*\n\s*slfInfo\?\.dischargePermit,/, "Discharge Permit");
});

test("a not-required permit short-circuits BEFORE any status is computed", () => {
  const resolve = slice(panel, "const resolvePermitStatus =", "The city/municipality of the FACILITY");

  // Order matters: the guard has to return before permitStatus() can reach its
  // `statusText || "New / Complied"` fallback.
  const guardAt = resolve.indexOf("permitNotRequired(list, legacyStatus, legacyNo)");
  const statusAt = resolve.indexOf("return permitStatus(");
  assert.ok(guardAt > -1, "the guard runs inside resolvePermitStatus");
  assert.ok(statusAt > -1, "…and the normal path is still there for permits that ARE required");
  assert.ok(guardAt < statusAt, "the guard must come first");

  assert.match(
    resolve,
    /hideStatus: true, notRequired: true/,
    "it suppresses the badge and marks the value line",
  );
});

test("the card shows one neutral line and no compliance badge", () => {
  const render = slice(panel, "{permitCards.map(", "Landfill Cells Infra");

  // The value line: a single "Not Required", not the stored reference rows (which
  // would repeat the same words straight back at the user).
  assert.match(render, /\{status\.notRequired \? \(/, "the not-required case is handled first");
  assert.match(render, /Not Required\s*\n\s*<\/div>/, "rendered as a plain line");

  // The badge: suppressed.
  assert.match(render, /\{!status\.hideStatus && \(/, "the tag is conditional");
  const tagAt = render.indexOf("{!status.hideStatus && (");
  const notRequiredAt = render.indexOf("{status.notRequired ? (");
  assert.ok(notRequiredAt < tagAt, "the value line is decided before the badge");
});

test("'New / Complied' is still available for permits that ARE required", () => {
  // The fix must not have blanked the normal path — a real, current permit still
  // reports as complied.
  assert.match(panel, /return \{ label: "New \/ Complied", color: "blue" \};/);
  assert.match(panel, /if \(days < 0\) return \{ label: "Expired", color: "red" \};/);
  assert.match(panel, /return \{ label: "Expiring Within 30 Days", color: "orange" \};/);
});

test("'Not encoded' still means genuinely nothing recorded", () => {
  // Three distinct states that must not collapse into each other:
  //   Not Required  → does not apply here
  //   Not encoded   → applies, but nothing has been entered
  //   a badge       → applies, and this is its standing
  const render = slice(panel, "{permitCards.map(", "Landfill Cells Infra");
  assert.match(render, /references\.length === 0 \? \(/, "the empty case is still distinguished");
  assert.match(render, /Not encoded<\/div>/);
});
