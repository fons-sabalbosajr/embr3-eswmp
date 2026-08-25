/**
 * Preview Uploaded Data — the disposal grid's column layout.
 *
 * Merging columns saves width, and the way it goes wrong is that a field stops
 * being shown at all: the preview is the LAST place an operator can correct a
 * value before it is imported, so a field that loses its column silently loses
 * its editor too. These tests read the column definitions and the modal's editor
 * chain from source and pin the two contracts that keeps intact:
 *
 *   1. every field the parser writes still reaches the grid, whether in a column
 *      of its own or inside a merged one;
 *   2. every field named by a merged column is one the editor chain actually has
 *      a control for — otherwise it silently degrades to a plain text box.
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { WASTE_CATEGORY_ENUM } from "../../../utils/wasteCategories.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const portal = fs.readFileSync(path.join(here, "..", "index.jsx"), "utf8");
const modals = fs.readFileSync(path.join(here, "..", "SLFPortalModals.jsx"), "utf8");

// The truck branch of the column builder, from `if (effectiveType === "truck") {`
// to the `} else {` that starts the hauler branch.
const truckColumnsBlock = (() => {
  const start = portal.indexOf('if (effectiveType === "truck") {');
  assert.ok(start > 0, "the truck column builder moved");
  const end = portal.indexOf("        } else {", start);
  assert.ok(end > start, "could not find the end of the truck column builder");
  return portal.slice(start, end);
})();

const fieldsInGrid = new Set([
  ...[...truckColumnsBlock.matchAll(/dataIndex: "([a-zA-Z]+)"/g)].map((m) => m[1]),
  ...[...truckColumnsBlock.matchAll(/field: "([a-zA-Z]+)"/g)].map((m) => m[1]),
]);

test("every value the disposal parser writes still reaches the preview grid", () => {
  // If a column is merged away, its field has to reappear under `stackedFields`.
  for (const field of [
    "disposalTicketNo",
    "disposalDate",
    "hauler",
    "client",
    "plateNumber",
    "truckCapacity",
    "actualVolume",
    "actualVolumeUnit",
    "cellName",
    "wasteType",
  ]) {
    assert.ok(fieldsInGrid.has(field), `"${field}" has no column and no stackedFields entry`);
  }
});

test("the merged columns carry exactly the fields they replaced", () => {
  assert.match(
    truckColumnsBlock,
    /key: "haulerClient",[\s\S]*?stackedFields: \[\s*\{ field: "hauler"[\s\S]*?\{ field: "client"/,
    "Hauler → Client must stack both, in that order",
  );
  assert.match(
    truckColumnsBlock,
    /key: "capacityVolume",[\s\S]*?stackedFields: \[\s*\{ field: "truckCapacity"[\s\S]*?\{ field: "actualVolume"[\s\S]*?\{ field: "actualVolumeUnit"/,
    "Capacity / Volume must stack all three, in that order",
  );
  // And they must NOT also exist as columns of their own, which would render the
  // same editor twice against one value.
  ["hauler", "client", "truckCapacity", "actualVolume", "actualVolumeUnit"].forEach((field) => {
    assert.doesNotMatch(
      truckColumnsBlock,
      new RegExp(`dataIndex: "${field}"`),
      `"${field}" is both a column and a stacked field`,
    );
  });
});

test("every stacked field has a real editor, not the plain-text fallback", () => {
  // The editor chain branches on the FIELD name. A stacked field the chain does
  // not name still renders — as a bare Input — so a capacity would lose its
  // numeric control and a unit its picker without anything failing.
  const stacked = [...truckColumnsBlock.matchAll(/field: "([a-zA-Z]+)"/g)].map((m) => m[1]);
  const numeric = /\["truckCapacity", "actualVolume", "numberOfTrucks", "capacity"\]\.includes\(field\)/;
  const named = new Set([...modals.matchAll(/field === "([a-zA-Z]+)"/g)].map((m) => m[1]));
  const longText = /UPLOAD_PREVIEW_LONG_TEXT_FIELDS/;

  assert.match(modals, numeric, "the numeric branch keys on the field name");
  assert.match(modals, longText);
  for (const field of stacked) {
    const handled =
      ["truckCapacity", "actualVolume"].includes(field) ||
      named.has(field) ||
      // hauler / client are covered by the long-text list, checked below.
      ["hauler", "client"].includes(field);
    assert.ok(handled, `"${field}" falls through to the plain-text editor`);
  }
  // The long-text list is what gives hauler and client their wrapping TextArea.
  const longTextList = modals.slice(
    modals.indexOf("UPLOAD_PREVIEW_LONG_TEXT_FIELDS = ["),
    modals.indexOf("];", modals.indexOf("UPLOAD_PREVIEW_LONG_TEXT_FIELDS = [")),
  );
  assert.match(longTextList, /"hauler"/);
  assert.match(longTextList, /"client"/);
});

test("the disposal upload's unit gets the picker, not a text box", () => {
  // `capacityUnit` (hauler rows) and `actualVolumeUnit` (disposal rows) are the
  // same enum under two names, and only the first used to be handled.
  assert.match(
    modals,
    /field === "capacityUnit" \|\| field === "actualVolumeUnit"/,
    "both spellings must reach the unit picker",
  );
});

test("waste type uses the app's shared category colours, not its own", () => {
  // One colour system across the portal, the cell gauges and the admin tables:
  // a hardcoded palette here is how they drift apart.
  assert.match(modals, /import \{ getCellTypeConfig \} from "\.\.\/\.\.\/utils\/cellVisuals"/);
  assert.match(modals, /import \{ WASTE_CATEGORY_ENUM \} from "\.\.\/\.\.\/utils\/wasteCategories"/);
  assert.match(
    modals,
    /WASTE_CATEGORY_ENUM\.map\(\(type\) => \(\{[\s\S]*?color=\{getCellTypeConfig\(type\)\.tag\}/,
    "the options must colour themselves from the shared map",
  );
});

test("a waste type the file supplied but the enum does not allow is kept visible", () => {
  // It would fail the server's enum on submit, so hiding it would leave the
  // operator with an error and no way to see what caused it.
  assert.match(modals, /not a valid waste type/);
  assert.equal(WASTE_CATEGORY_ENUM.length, 3, "the picker offers exactly the stored enum");
});
