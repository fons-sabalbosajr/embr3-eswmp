/**
 * SLF Overview → Clients Served / Accredited Haulers drill-downs.
 *
 * THE PROPERTY THAT MATTERS. A card says "24 clients" and the list it opens must
 * contain 24 rows. The tempting way to build these lists is to re-walk the raw
 * baseline/submission rows beside the modal — which quietly reimplements the
 * deduplication the counts already do, and the two drift the first time an
 * operator records the same client twice with different capitalisation. Then the
 * badge and the list disagree, and neither is obviously wrong.
 *
 * So the directories are derived INSIDE the same memo that produces the counts,
 * from the same deduplicated sets (`combinedClients`, and the hauler-name Map).
 * These tests pin that, plus the behaviour of the modals themselves.
 *
 * The panel is a 1200-line component with charts and antd, so this reads the
 * source — the same approach the cell-volume invariants use for front-end rules.
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

// ── The lists cannot disagree with the counts ───────────────────────────────
test("the client list is built from the SAME deduplicated set as the count", () => {
  const directory = slice(panel, "const clientDirectory =", "const haulerDirectory =");

  // `combinedClients` is what lguClientCount / privateClientCount are filtered
  // from. Building the list from anything else is how a badge and its list drift.
  assert.match(directory, /^\s*const clientDirectory = combinedClients/m);
  assert.match(directory, /clientIdentityKey\(row\)/, "rows keep the identity key that deduplicated them");

  // The same LGU test the counts use, not a second spelling of it.
  const counts = slice(panel, "const lguClientCount", "// ── Dashboard chart series ──");
  assert.match(counts, /\/lgu\/i\.test/, "the count classifies with this rule");
  assert.match(directory, /isLguRow\(row\) \? "LGU" : "Private"/, "…and so does the list");
  assert.match(panel, /const isLguRow = \(row = \{\}\) => \/lgu\/i\.test/, "one shared classifier");
});

test("the hauler list uses the same identity rule as the hauler count", () => {
  // haulerCount is `new Set(names.map(trim().toLowerCase()))`.size — one row per
  // DISTINCT name. The directory must collapse duplicates the same way.
  const count = slice(panel, "const haulerCount = new Set(", "const lguClientCount");
  assert.match(count, /\.trim\(\)\.toLowerCase\(\)/);

  const directory = slice(panel, "const haulerDirectory =", "const wasteFilledM3");
  assert.match(directory, /const key = name\.toLowerCase\(\);/, "same case-insensitive identity");
  assert.match(directory, /if \(!byName\.has\(key\)\)/, "duplicates merge rather than repeat");
  // A hauler listed twice must not show its fleet twice.
  assert.match(directory, /entry\.plates\.set\(/, "plates are keyed, so a repeated vehicle counts once");
});

test("fleet size follows the same rule the chart bar uses", () => {
  // The bar is Math.max(vehicles, declared, 1); the row must not quietly report a
  // different number for the same hauler.
  const chart = slice(panel, "const haulerChartData =", "const clientChartData =");
  assert.match(chart, /Math\.max\(byName\.get\(name\) \|\| 0, vehicles, declared, 1\)/);
  const directory = slice(panel, "const haulerDirectory =", "const wasteFilledM3");
  assert.match(directory, /Math\.max\(vehicles\.length, entry\.declared, 1\)/);
});

test("legacy single-vehicle haulers still contribute their plate", () => {
  // Older records kept plate/capacity on the hauler itself rather than in
  // vehicles[]. Dropping them would under-report a real fleet.
  const directory = slice(panel, "const haulerDirectory =", "const wasteFilledM3");
  assert.match(directory, /const legacyPlate = String\(hauler\?\.plateNumber \|\| ""\)/);
  assert.match(directory, /!entry\.plates\.has\(/, "and it is not double-counted when vehicles[] has it too");
});

// ── The modals ──────────────────────────────────────────────────────────────
test("both cards offer the drill-down, and only when there is one to show", () => {
  // An enabled "View list" that opens an empty modal is worse than no affordance.
  assert.match(panel, /clientDirectory\.length \? \(\s*\n?\s*<Button/, "Clients Served");
  assert.match(panel, /haulerDirectory\.length \? \(\s*\n?\s*<Button/, "Accredited Haulers");
  assert.equal((panel.match(/View list/g) || []).length, 2, "one on each card");
});

test("clicking a bar opens the list already filtered to that type", () => {
  const bar = slice(panel, 'name="Clients"', "</Bar>");
  assert.match(bar, /cursor="pointer"/, "the bar looks clickable");
  assert.match(bar, /setClientTypeFilter\(entry\?\.name === "LGU" \? "LGU" : "Private"\)/);
  assert.match(bar, /setClientsOpen\(true\)/);
});

test("the client modal segments by LGU and Private with live counts", () => {
  const modal = slice(panel, "Clients Served drill-down", "Accredited Haulers drill-down");
  assert.match(modal, /label: `All \(\$\{clientDirectory\.length\}\)`/);
  assert.match(modal, /label: `LGU \(\$\{lguClientCount\}\)`/, "the segment shows the card's own count");
  assert.match(modal, /label: `Private \(\$\{privateClientCount\}\)`/);
  assert.match(modal, /dataSource=\{filteredClients\}/);
});

test("the hauler modal expands to the plates behind the fleet number", () => {
  const modal = slice(panel, "Accredited Haulers drill-down", "export default memo");
  assert.match(modal, /dataSource=\{filteredHaulers\}/);
  assert.match(modal, /rowExpandable: \(row\) => row\.vehicles\.length > 0/, "no empty drawers");
  assert.match(modal, /expandedRowRender/);
  // A declared fleet with no plates recorded must say so, not render a blank.
  assert.match(modal, /Fleet size is declared, but no plate numbers have been recorded/);
});

test("filtering is memoized, not recomputed on every render", () => {
  // This panel re-renders on every socket event; re-filtering the whole directory
  // each time is exactly the cost the chart memo above exists to avoid.
  assert.match(panel, /const filteredClients = useMemo\(/);
  assert.match(panel, /\}, \[clientDirectory, clientTypeFilter, clientSearch\]\);/);
  assert.match(panel, /const filteredHaulers = useMemo\(/);
  assert.match(panel, /\}, \[haulerDirectory, haulerSearch\]\);/);
});

test("search covers what the operator can actually see", () => {
  const clients = slice(panel, "const filteredClients = useMemo(", "const filteredHaulers");
  assert.match(clients, /row\.name\.toLowerCase\(\)\.includes\(needle\)/);
  assert.match(clients, /row\.location\.toLowerCase\(\)\.includes\(needle\)/);

  const haulers = slice(panel, "const filteredHaulers = useMemo(", "const categoryColors");
  assert.match(haulers, /vehicle\.plate\.toLowerCase\(\)\.includes\(needle\)/, "plates are searchable");
});

// ── A PSGC code is not a place name ─────────────────────────────────────────
test("a location stored as a PSGC code is never printed as the location", () => {
  const directory = slice(panel, "const placeName = ", "const clientDirectory =");
  // `municipality`/`province` hold EITHER a name or the numeric PSGC code
  // depending on how the record was encoded, so falling back to them blindly put
  // "035400000, 034900000" on the card.
  assert.ok(
    directory.includes("!/^\\d+$/.test(value)"),
    "an all-digits value is a PSGC code, not a name — it must be skipped",
  );
  assert.match(panel, /placeName\(row\.municipalityName, row\.municipality, row\.companyMunicipality\)/);
  assert.match(panel, /placeName\(row\.provinceName, row\.province, row\.companyProvince\)/);
  // Resolved *Name fields are preferred, matching what the admin's client table
  // displays and what the server resolves against the Region III masterlist.
  const order = slice(panel, "const clientDirectory =", "const haulerDirectory =");
  assert.ok(
    order.indexOf("row.municipalityName") < order.indexOf("row.municipality,"),
    "the resolved name is tried before the raw field",
  );
});

test("a client with no usable location says so rather than showing a dash", () => {
  const modal = slice(panel, "Clients Served drill-down", "Accredited Haulers drill-down");
  assert.match(modal, /No municipality or province recorded for this client/);
  assert.match(modal, /Not recorded/);
});

// ── The fleet list ──────────────────────────────────────────────────────────
test("vehicles render as an aligned table, not a wrapped row of tags", () => {
  const modal = slice(panel, "Accredited Haulers drill-down", "export default memo");
  const expanded = modal.slice(modal.indexOf("expandedRowRender"));
  // Columns let plates read down one edge and capacities down another; a wrapped
  // tag list made the eye re-parse "plate · type · capacity" per vehicle.
  assert.match(expanded, /<Table/, "the fleet is a table");
  ["Plate No.", "Vehicle Type", "Capacity"].forEach((title) =>
    assert.ok(expanded.includes(`title: "${title}"`), `${title} column`),
  );
  assert.match(expanded, /fontVariantNumeric: "tabular-nums"/, "capacities align digit-for-digit");
  assert.match(expanded, /pagination=\{row\.vehicles\.length > 6/, "a large fleet paginates");
});

test("a vehicle with no capacity is flagged as actionable, not left blank", () => {
  const modal = slice(panel, "Accredited Haulers drill-down", "export default memo");
  // Capacity is required before a trip using the vehicle can be submitted, so a
  // blank is something to fix — not missing decoration.
  assert.match(modal, /Trips using this vehicle cannot be submitted until it is set/);
  assert.match(modal, /<Tag color="warning"[^>]*>Not set<\/Tag>/);
});
