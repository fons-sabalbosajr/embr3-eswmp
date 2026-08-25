/**
 * Baseline completeness — what is missing, and applying the fixes.
 *
 * The completion modal edits records by POSITION, because a name is exactly the
 * thing that may be blank or about to change. These tests pin that addressing
 * and the one contract every import and editor in this portal shares: a blank
 * field means "leave what is stored", and nothing is ever removed.
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  applyBaselineCompletionPatches,
  countCompletionEdits,
  haulerClients,
  summarizeBaselineCompleteness,
} from "../baselineCompleteness.js";

const FLEET = [
  {
    key: "h1",
    haulerName: "GREEN RESCUE",
    officeAddress: "San Fernando, Pampanga",
    vehicles: [{ plateNumber: "ABJ 4635", vehicleType: "Dump Truck" }],
    privateSectorClients: [
      // Complete — must not appear in the work list at all.
      {
        clientName: "MUNICIPALITY OF PULILAN",
        clientType: "LGU",
        provinceName: "Bulacan",
        municipalityName: "Pulilan",
        clientAddress: "Poblacion, Pulilan",
      },
      // Missing everything a client needs.
      { clientName: "MUNICIPALITY OF BAUTISTA" },
    ],
  },
  {
    key: "h2",
    haulerName: "BGC HAULERS",
    // No office address, no vehicle.
    privateSectorClients: [
      { clientName: "BGC HAULERS", clientType: "Private", provinceName: "Metro Manila", municipalityName: "Taguig" },
    ],
  },
  {
    key: "h3",
    haulerName: "NEW HAULER",
    officeAddress: "Angeles City",
    vehicles: [{ plateNumber: "XYZ 111" }],
    privateSectorClients: [],
  },
];

const rowsById = (fleet) =>
  Object.fromEntries(summarizeBaselineCompleteness(fleet).rows.map((row) => [row.id, row]));

// ── What the work list contains ──────────────────────────────────────────────

test("a complete client contributes no row", () => {
  const ids = summarizeBaselineCompleteness(FLEET).rows.map((r) => r.id);
  // GREEN RESCUE's first client is complete; its second is not.
  assert.ok(!ids.includes("client-0-0"));
  assert.ok(ids.includes("client-0-1"));
});

test("the hauler itself is assessed, not only its clients", () => {
  const rows = rowsById(FLEET);
  // BGC HAULERS: no office address and no vehicle, but its client is fine.
  assert.deepEqual(rows["hauler-1"].recommended, ["Office Address", "Vehicle / Plate Number"]);
  assert.deepEqual(rows["hauler-1"].required, []);
  // GREEN RESCUE is complete as a hauler, so it has no hauler row.
  assert.equal(rows["hauler-0"], undefined);
});

test("a hauler with no clients is a REQUIRED gap, not a cosmetic one", () => {
  const rows = rowsById(FLEET);
  assert.ok(rows["hauler-2"].required.includes("Clients"));
  const summary = summarizeBaselineCompleteness(FLEET);
  assert.equal(summary.haulersWithoutClients, 1);
  assert.equal(summary.haulersMissingAddress, 1);
});

test("rows are addressed by position, so a blank name is still reachable", () => {
  const unnamed = [{ haulerName: "H", privateSectorClients: [{ clientName: "" }] }];
  const [row] = summarizeBaselineCompleteness(unnamed).rows.filter((r) => r.kind === "client");
  assert.equal(row.id, "client-0-0");
  assert.equal(row.clientIndex, 0);
  assert.ok(row.required.includes("Client Name"));
});

test("required gaps sort above cosmetic ones", () => {
  const rows = summarizeBaselineCompleteness(FLEET).rows;
  const firstCosmetic = rows.findIndex((r) => r.required.length === 0);
  const lastRequired = rows.map((r) => r.required.length > 0).lastIndexOf(true);
  assert.ok(firstCosmetic === -1 || lastRequired < firstCosmetic);
});

// ── Applying the fixes ───────────────────────────────────────────────────────

test("a client patch lands on the right record and leaves its siblings alone", () => {
  const next = applyBaselineCompletionPatches(FLEET, {
    "client-0-1": {
      clientType: "LGU",
      province: "013300000",
      provinceName: "Pangasinan",
      municipality: "013304000",
      municipalityName: "Bautista",
    },
  });
  const fixed = haulerClients(next[0])[1];
  assert.equal(fixed.clientName, "MUNICIPALITY OF BAUTISTA", "the name it already had survives");
  assert.equal(fixed.provinceName, "Pangasinan");
  assert.equal(fixed.municipalityName, "Bautista");
  assert.equal(fixed.province, "013300000", "the PSGC code is kept alongside the name");
  // The complete sibling is untouched.
  assert.deepEqual(haulerClients(next[0])[0], haulerClients(FLEET[0])[0]);
});

test("a hauler patch writes the office address without touching its clients", () => {
  const next = applyBaselineCompletionPatches(FLEET, {
    "hauler-1": { officeAddress: "Taguig City" },
  });
  assert.equal(next[1].officeAddress, "Taguig City");
  assert.deepEqual(next[1].privateSectorClients, FLEET[1].privateSectorClients);
});

test("a blank field keeps what is stored — it never clears a value", () => {
  const next = applyBaselineCompletionPatches(FLEET, {
    "client-0-1": { clientType: "LGU", provinceName: "   ", municipalityName: "" },
  });
  const fixed = haulerClients(next[0])[1];
  assert.equal(fixed.clientType, "LGU");
  assert.equal(fixed.provinceName, undefined, "an all-whitespace value is not written");
  // And a patch that would blank an EXISTING value leaves it in place.
  const kept = applyBaselineCompletionPatches(FLEET, { "client-0-0": { provinceName: "" } });
  assert.equal(haulerClients(kept[0])[0].provinceName, "Bulacan");
});

test("nothing is mutated in place", () => {
  const before = JSON.stringify(FLEET);
  applyBaselineCompletionPatches(FLEET, { "hauler-1": { officeAddress: "X" } });
  assert.equal(JSON.stringify(FLEET), before);
});

test("only whitelisted fields are written", () => {
  const next = applyBaselineCompletionPatches(FLEET, {
    "client-0-1": { clientType: "LGU", _uiOnly: "junk", status: "Deleted" },
  });
  const fixed = haulerClients(next[0])[1];
  assert.equal(fixed.clientType, "LGU");
  assert.equal(fixed._uiOnly, undefined);
  assert.equal(fixed.status, undefined, "an unlisted field cannot be smuggled through");
});

test("a patch whose record no longer exists is skipped, not thrown on", () => {
  // The fleet can change under an open modal.
  const next = applyBaselineCompletionPatches(FLEET, {
    "client-9-9": { clientType: "LGU" },
    "hauler-1": { officeAddress: "Taguig City" },
  });
  assert.equal(next[1].officeAddress, "Taguig City", "the valid patch still applies");
});

test("no client is ever removed by a completion save", () => {
  const next = applyBaselineCompletionPatches(FLEET, { "client-0-1": { clientType: "LGU" } });
  next.forEach((hauler, index) => {
    assert.equal(
      haulerClients(hauler).length,
      haulerClients(FLEET[index]).length,
      `${hauler.haulerName} lost a client`,
    );
  });
});

test("the edit count ignores rows that were only opened, not filled", () => {
  assert.equal(countCompletionEdits({}), 0);
  assert.equal(countCompletionEdits({ a: {}, b: { clientType: "" } }), 0);
  assert.equal(countCompletionEdits({ a: { clientType: "LGU" }, b: { officeAddress: "  " } }), 1);
});
