/**
 * Client location / type inference (utils/clientLocation).
 *
 * Client Data Issues listed 172 clients as "No province (Region 3 unknown)" and the
 * Region tiles showed nobody served Outside Region 3, although operators had
 * entered "Tanza, Cavite" and the like in the SLF Portal. These pin the rules that
 * turn that evidence into Within / Outside R3 and LGU / Private Sector.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { buildLocationIndex, inferClientLocation, inferClientType, placeKey } = require("../utils/clientLocation");
const { classifyType } = require("../services/syncBaselineClients");

const R3 = new Set(["aurora", "bataan", "bulacan", "nueva ecija", "pampanga", "tarlac", "zambales"]);
// A slice of the Region 3 masterlist in its real shapes ("City of X", aliases).
const MASTERS = [
  { name: "City of Angeles", province: "Pampanga", aliases: ["Angeles City"] },
  { name: "City of San Fernando", province: "Pampanga" },
  { name: "Mabalacat", province: "Pampanga" },
  { name: "Pilar", province: "Bataan" },
  { name: "Hermosa", province: "Bataan" },
  { name: "Capas", province: "Tarlac" },
  { name: "Santa Maria", province: "Bulacan" },
  { name: "Santo Tomas", province: "Pampanga" },
  { name: "Quezon", province: "Nueva Ecija" },
  { name: "Iba", province: "Zambales" },
];
const idx = buildLocationIndex(R3, MASTERS);
const loc = (c) => inferClientLocation(c, idx);

test("province field decides first: Region 3 within, any other province outside", () => {
  assert.equal(loc({ province: "Bataan" }).regionClass, "within-region-3");
  assert.equal(loc({ province: "Cavite" }).regionClass, "outside-region-3");
  assert.equal(loc({ province: "Batangas" }).regionClass, "outside-region-3");
  assert.equal(loc({ province: "Metro Manila" }).regionClass, "outside-region-3");
  // A misspelt Region 3 province is still Region 3, not "outside".
  assert.equal(loc({ province: "PAMPNGA" }).regionClass, "within-region-3");
});

test("PSGC codes classify by their region prefix", () => {
  assert.equal(loc({ province: "036900000" }).regionClass, "within-region-3");
  assert.equal(loc({ province: "042100000" }).regionClass, "outside-region-3");
  assert.equal(loc({ region: "040000000" }).regionClass, "outside-region-3");
});

test("region text: Central Luzon within, other regions outside", () => {
  assert.equal(loc({ region: "Region III (Central Luzon)" }).regionClass, "within-region-3");
  assert.equal(loc({ region: "Region IV-A" }).regionClass, "outside-region-3");
  assert.equal(loc({ region: "NCR" }).regionClass, "outside-region-3");
});

test("city/municipality alone places the client and fills its province", () => {
  const angeles = loc({ municipalityCity: "Angeles City" });
  assert.equal(angeles.regionClass, "within-region-3");
  assert.equal(angeles.province, "Pampanga");
  assert.equal(loc({ municipalityCity: "San Fernando City" }).province, "Pampanga");
  assert.equal(loc({ municipalityCity: "Pilar" }).province, "Bataan");
  const tanza = loc({ municipalityCity: "Tanza" });
  assert.equal(tanza.regionClass, "outside-region-3");
  assert.equal(tanza.province, "Cavite");
  // A list of towns: the first recognisable one decides.
  assert.equal(loc({ municipalityCity: "Imus City & Tanza" }).regionClass, "outside-region-3");
});

test("Quezon City is NCR, not Quezon, Nueva Ecija", () => {
  assert.equal(placeKey("Quezon City"), "quezon city");
  assert.equal(loc({ municipalityCity: "Quezon City" }).regionClass, "outside-region-3");
  assert.equal(loc({ municipalityCity: "Quezon" }).regionClass, "within-region-3");
});

test("a town Region 3 also has is never read as outside", () => {
  // Santa Maria and Santo Tomas exist in Pangasinan too; the masterlist wins.
  assert.equal(loc({ municipalityCity: "Sta. Maria" }).regionClass, "within-region-3");
  assert.equal(loc({ municipalityCity: "Sto. Tomas" }).regionClass, "within-region-3");
});

test("address and name text are used when the fields are empty", () => {
  assert.equal(loc({ address: "009 San Jose Street, Brgy. Poblacion 1, Tanza, Cavite" }).regionClass, "outside-region-3");
  assert.equal(loc({ name: "PRIVATE - TRECE CAVITE" }).regionClass, "outside-region-3");
  assert.equal(loc({ name: "PRIVATE - TAGUIG CITY, METRO MANILA" }).regionClass, "outside-region-3");
  // The province in the name beats the Region 3 town spelled the same.
  assert.equal(loc({ name: "LGU - STA. MARIA PANGASINAN", isLgu: true }).regionClass, "outside-region-3");
  // An LGU's name is a place.
  assert.equal(loc({ name: "LGU UMINGAN", isLgu: true }).regionClass, "outside-region-3");
  assert.equal(loc({ name: "LGU STA. MARIA", isLgu: true }).province, "Bulacan");
});

test("a Region 3 town inside a company name is not evidence", () => {
  assert.equal(loc({ name: "Yamaha Iba" }).regionClass, "unclassified");
  assert.equal(loc({ name: "Highlands Camp" }).regionClass, "unclassified");
});

test("nothing usable stays unclassified", () => {
  assert.equal(loc({}).regionClass, "unclassified");
  assert.equal(loc({ name: "PRIVATE" }).regionClass, "unclassified");
});

const type = (c) => inferClientType(c, idx, (raw) => classifyType(raw)).type;

test("client type: an LGU by its own name, whatever was declared", () => {
  assert.equal(type({ name: "LGU UMINGAN", rawType: "Private" }), "LGU");
  assert.equal(type({ name: "City of Balanga", rawType: "Private" }), "LGU");
  assert.equal(type({ name: "BRGY. BASA", rawType: "Private" }), "LGU");
  assert.equal(type({ name: "Angeles", rawType: "" }), "LGU");
  assert.equal(type({ name: "San Fernando City", rawType: "" }), "LGU");
  assert.equal(type({ name: "Pilar", rawType: "" }), "LGU");
  assert.equal(type({ name: "Paranaque City", rawType: "" }), "LGU");
});

test("client type: declared type stands otherwise; business suffix fills a blank", () => {
  assert.equal(type({ name: "ABC Hauling Services", rawType: "Private" }), "Private Sector");
  assert.equal(type({ name: "XYZ Trading", rawType: "" }), "Private Sector");
  assert.equal(type({ name: "Some Client", rawType: "LGU" }), "LGU");
  assert.equal(type({ name: "Some Client", rawType: "" }), null);
  // A bare province name is a fragment, not the provincial government.
  assert.equal(type({ name: "BULACAN", rawType: "Private" }), "Private Sector");
  // The client is the municipality it names.
  assert.equal(type({ name: "Hermosa", rawType: "", municipalityCity: "Hermosa" }), "LGU");
});
