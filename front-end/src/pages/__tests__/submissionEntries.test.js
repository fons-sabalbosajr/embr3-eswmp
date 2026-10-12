/**
 * Clients on the Submissions export (Admin → Portal Submission → Export All
 * Filtered Excel).
 *
 * 15,166 of 32,672 recorded loads carry no `selectedClients` — almost all of
 * Porac and Floridablanca — so the export printed "No client recorded" for
 * nearly every row of those facilities, although for 13,565 of them the hauler's
 * clients are on file. GET /data-slf now ships that roster as `haulerRoster`;
 * these pin how the row builder uses it, and that the source is always stated.
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";

import { buildSubmissionWasteEntries } from "../../utils/submissionEntries.js";

const record = (truck, extra = {}) => ({
  _id: "r1",
  idNo: "SLF-PVT-PA-0001",
  status: "acknowledged",
  dateOfDisposal: "2026-09-01T00:00:00.000Z",
  baselineUnit: "tons",
  trucks: [truck],
  ...extra,
});

test("a client recorded on the load wins, and is marked as recorded on the trip", () => {
  const [entry] = buildSubmissionWasteEntries(
    record(
      { hauler: "H", vehicles: [{ actualVolume: 5, selectedClients: [{ clientName: "City of Balanga" }] }] },
      { haulerRoster: [{ haulerName: "H", clients: [{ clientName: "Someone Else" }] }] },
    ),
  );
  assert.deepEqual(entry.clients.map((c) => c.name), ["City of Balanga"]);
  assert.equal(entry.clientSource, "trip");
});

test("REGRESSION — a load with no client falls back to its hauler's roster, labelled as such", () => {
  const [entry] = buildSubmissionWasteEntries(
    record(
      { hauler: "  Green  Rescue ", vehicles: [{ actualVolume: 5, selectedClients: [] }], selectedClients: [] },
      { haulerRoster: [{ haulerName: "GREEN RESCUE", clients: [{ clientName: "LGU of Pulilan" }] }] },
    ),
  );
  assert.deepEqual(entry.clients.map((c) => c.name), ["LGU of Pulilan"]);
  assert.equal(entry.clientSource, "hauler", "never presented as recorded on the trip");
});

test("roster clients kept on the hauler's VEHICLES are read too, de-duplicated", () => {
  const [entry] = buildSubmissionWasteEntries(
    record(
      { hauler: "H", actualVolume: 3, selectedClients: [] },
      {
        accreditedHaulers: [{
          haulerName: "H",
          clients: [{ clientName: "A Corp" }],
          vehicles: [{ selectedClients: [{ clientName: "B Corp" }, { clientName: "a corp" }] }],
        }],
      },
    ),
  );
  assert.deepEqual(entry.clients.map((c) => c.name), ["A Corp", "B Corp"]);
  assert.equal(entry.clientSource, "hauler");
});

test("nothing on file anywhere — empty list and empty source", () => {
  const [entry] = buildSubmissionWasteEntries(record({ hauler: "Unknown", actualVolume: 3 }));
  assert.deepEqual(entry.clients, []);
  assert.equal(entry.clientSource, "");
});

test("REGRESSION — a vehicle's EMPTY HW code list does not hide the truck's codes", () => {
  const [entry] = buildSubmissionWasteEntries(
    record({
      hauler: "H",
      hazWasteCode: ["M501"],
      vehicles: [{ actualVolume: 2, wasteType: "Treated Hazardous Waste", hazWasteCode: [] }],
    }),
  );
  assert.deepEqual(entry.hazWasteCodes, ["M501"]);
});
