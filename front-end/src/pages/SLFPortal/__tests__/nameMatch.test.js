/**
 * Smart name matching in the upload (uploadHelpers#normalizeComparableText and
 * systemGeneratedUpload's "Did you mean" suggestions).
 *
 * The equal / not-equal cases are SHARED with the server
 * (server/tests/fixtures/nameMatchCases.json), so the preview and the
 * server's submit check always reach the same decision.
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeComparableText } from "../uploadHelpers.js";
import { findClientNearMisses, findHaulerNearMisses, resolveDisposalIdentity } from "../systemGeneratedUpload.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(
  fs.readFileSync(path.join(here, "..", "..", "..", "..", "..", "server", "tests", "fixtures", "nameMatchCases.json"), "utf8"),
);
const same = (a, b) => normalizeComparableText(a) !== "" && normalizeComparableText(a) === normalizeComparableText(b);

test("formatting differences compare equal (shared with the server)", () => {
  for (const [a, b] of cases.same) assert.equal(same(a, b), true, `${a} = ${b}`);
});

test("real differences do not (shared with the server)", () => {
  for (const [a, b] of cases.different) assert.equal(same(a, b), false, `${a} ≠ ${b}`);
});

const HAULERS = [
  {
    haulerName: "Northwind Sample Haulers",
    privateSectorClients: [
      { clientName: "Villa Muestra", clientType: "LGU" },
      { clientName: "Copperleaf Demo Transport", clientType: "Private" },
      { clientName: "Barangay 2", clientType: "LGU" },
    ],
  },
];

test("a missing letter is a 'Did you mean' suggestion, never applied on its own", () => {
  const [best] = findClientNearMisses(HAULERS[0], "Villa Muesta");
  assert.equal(best?.name, "Villa Muestra");
  assert.ok(best.score < 0.95, "below the auto-apply threshold");
  const resolved = resolveDisposalIdentity({ hauler: "Northwind Sample Haulers", client: "Villa Muesta" }, HAULERS);
  assert.equal(resolved.status, "mismatch", "the user confirms it");
});

test("a missing word is suggested", () => {
  const names = findClientNearMisses(HAULERS[0], "Copperleaf Transport").map((s) => s.name);
  assert.ok(names.includes("Copperleaf Demo Transport"));
});

test("a different number is never suggested as a typo", () => {
  const names = findClientNearMisses(HAULERS[0], "Barangay 3").map((s) => s.name);
  assert.equal(names.includes("Barangay 2"), false);
});

test("a hauler spelled with a different word gets a 'Did you mean'", () => {
  const [best] = findHaulerNearMisses(HAULERS, "Northwest Sample Haulers");
  assert.equal(best?.name, "Northwind Sample Haulers");
  // A client that does not itself identify a hauler (one that does is aligned by
  // the existing client-only strategy, before any suggestion is needed).
  const resolved = resolveDisposalIdentity({ hauler: "Northwest Sample Haulers", client: "Someone Else" }, HAULERS);
  assert.equal(resolved.status, "unresolved");
  assert.match(resolved.reason, /Did you mean "Northwind Sample Haulers"\?/);
});

test("formatting-only differences match directly, with no prompt", () => {
  const resolved = resolveDisposalIdentity({ hauler: "NORTHWIND SAMPLE HAULERS.", client: "villa  muestra" }, HAULERS);
  assert.equal(resolved.status, "direct");
});

test("the preview summary carries the hauler suggestion for its one-click fix", async () => {
  const { alignDisposalRow, summarizeAlignment } = await import("../systemGeneratedUpload.js");
  const row = alignDisposalRow(
    { key: "r1", _rowNumber: 2, hauler: "Northwest Sample Haulers", client: "Someone Else", actualVolume: 5, disposalTicketNo: "T1" },
    HAULERS,
  );
  const summary = summarizeAlignment([row]);
  const item = summary.needsEncoding[0];
  assert.equal(item?.haulerSuggestions?.[0]?.name, "Northwind Sample Haulers");
  assert.deepEqual(item.rowKeys, ["r1"]);
});
