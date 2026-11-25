/**
 * EMB-verified client data flows back to the portal (utils/clientCorrection.js).
 *
 * Run: node --test tests/clientCorrection.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
delete process.env.REDIS_URL;
delete process.env.REDIS_HOST;

const SlfClient = require("../models/SlfClient");
const { verifiedValues, correctRoster, annotateVerifiedClients } = require("../utils/clientCorrection");

const EMB_CLIENT = {
  name: "Villa Muestra",
  type: "LGU",
  address: "Brgy. Poblacion, Villa Muestra, Bulacan",
  province: "Bulacan",
  municipalityCity: "Villa Muestra",
  region: "",
};

const roster = () => [
  {
    haulerName: "Northwind Sample Hauler",
    privateSectorClients: [
      { clientName: "villa  muestra", clientType: "LGU", clientAddress: "N/A" },
      { clientName: "Other Client", clientType: "Private", clientAddress: "Somewhere" },
    ],
  },
  { haulerName: "Copperleaf Demo Transport", privateSectorClients: ["Villa Muestra"] },
];

test("verified values use the roster's field names and skip blanks", () => {
  assert.deepEqual(verifiedValues({ ...EMB_CLIENT, type: "Private Sector" }), {
    clientName: "Villa Muestra",
    clientType: "Private",
    clientAddress: "Brgy. Poblacion, Villa Muestra, Bulacan",
    provinceName: "Bulacan",
    municipalityName: "Villa Muestra",
  });
});

test("a correction updates the matching client and nothing else", () => {
  const before = roster();
  const { haulers, changes } = correctRoster(before, {
    names: ["Villa Muestra"],
    haulerNames: ["Northwind Sample Hauler"],
    values: verifiedValues(EMB_CLIENT),
  });
  assert.equal(haulers[0].privateSectorClients[0].clientName, "Villa Muestra");
  assert.equal(haulers[0].privateSectorClients[0].clientAddress, "Brgy. Poblacion, Villa Muestra, Bulacan");
  assert.equal(haulers[0].privateSectorClients[1].clientAddress, "Somewhere", "other clients untouched");
  assert.equal(haulers[1].privateSectorClients[0], "Villa Muestra", "a hauler outside the relationship is untouched");
  assert.equal(before[0].privateSectorClients[0].clientAddress, "N/A", "the input is not mutated");
  const fields = changes.find((c) => c.kind === "client").fields.map((f) => f.field);
  assert.deepEqual(fields.sort(), ["clientAddress", "clientName", "municipalityName", "provinceName"]);
});

test("a hauler rename is applied, but never onto a hauler already on the roster", () => {
  const renamed = correctRoster(roster(), {
    names: ["Villa Muestra"],
    haulerNames: ["Northwind Sample Hauler"],
    values: verifiedValues(EMB_CLIENT),
    renameHauler: { from: "Northwind Sample Hauler", to: "Northwind Sample Haulers" },
  });
  assert.equal(renamed.haulers[0].haulerName, "Northwind Sample Haulers");
  assert.equal(renamed.haulers[0].privateSectorClients[0].clientAddress, EMB_CLIENT.address, "the renamed hauler's client is still corrected");

  const blocked = correctRoster(roster(), {
    names: ["Villa Muestra"],
    values: verifiedValues(EMB_CLIENT),
    renameHauler: { from: "Northwind Sample Hauler", to: "Copperleaf Demo Transport" },
  });
  assert.equal(blocked.haulers[0].haulerName, "Northwind Sample Hauler");
  assert.ok(blocked.changes.some((c) => c.kind === "hauler-rename-skipped"));
});

test("Verified by EMB shows only while the portal copy equals what EMB verified", async () => {
  const realFind = SlfClient.find;
  SlfClient.find = () => ({
    select() { return this; },
    maxTimeMS() { return this; },
    lean: async () => [{
      normalizedName: "villa muestra",
      type: "LGU",
      embVerification: { verifiedAt: new Date("2026-11-20"), values: verifiedValues(EMB_CLIENT) },
    }],
  });
  try {
    const corrected = correctRoster(roster(), { names: ["Villa Muestra"], values: verifiedValues(EMB_CLIENT) }).haulers;
    const marked = await annotateVerifiedClients(corrected);
    assert.ok(marked[0].privateSectorClients[0].embVerified?.at, "matching copy is marked");
    assert.equal(marked[0].privateSectorClients[1].embVerified, undefined);

    const edited = await annotateVerifiedClients(roster()); // address still "N/A"
    assert.equal(edited[0].privateSectorClients[0].embVerified, undefined, "a copy that differs is not marked");
  } finally {
    SlfClient.find = realFind;
  }
});

test("a portal save cannot persist the mark, and admin edits trigger the sync", () => {
  const dataSLF = fs.readFileSync(path.join(__dirname, "..", "routes", "dataSLF.js"), "utf8");
  const at = dataSLF.indexOf("function sanitizeClient");
  assert.doesNotMatch(dataSLF.slice(at, at + 2500), /embVerified/);
  assert.match(dataSLF, /accreditedHaulers: await annotateVerifiedClients\(/);
  const routes = fs.readFileSync(path.join(__dirname, "..", "routes", "slfClients.js"), "utf8");
  assert.match(routes, /router\.post\("\/:id\/verify"/);
  assert.match(routes, /if \(portalDataChanged\) stampEmbVerification\(record, req\);/);
});
