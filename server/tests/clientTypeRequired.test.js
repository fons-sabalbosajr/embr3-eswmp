/**
 * Client Type is required on the baseline.
 *
 * A client's type decides whether its waste counts as municipal waste (LGU) or
 * private sector waste. A blank type used to be stored as "Private" without the
 * operator choosing it (form default, upload fallback, schema default). These pin
 * the server side: the save refuses a typeless client, nothing defaults to Private,
 * and a trip copying a typeless client still saves (type left unset).
 *
 * Run: node --test tests/clientTypeRequired.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const DataSLF = require("../models/DataSLF");

test("the schema has no Private default and normalises the value", () => {
  const doc = new DataSLF({
    dateOfDisposal: new Date(), lguCompanyName: "X", companyType: "LGU",
    accreditedHaulers: [{ haulerName: "H", clients: [{ clientName: "A" }, { clientName: "B", clientType: "lgu" }, { clientName: "C", clientType: "" }] }],
    trucks: [{ selectedClients: [{ clientName: "A", clientType: "bogus" }] }],
  });
  const [a, b, c] = doc.accreditedHaulers[0].clients;
  assert.equal(a.clientType, undefined, "no silent Private");
  assert.equal(b.clientType, "LGU");
  assert.equal(c.clientType, undefined);
  assert.equal(doc.trucks[0].selectedClients[0].clientType, undefined);
  assert.equal(doc.validateSync(), undefined, "an unset type is not a validation error on a trip");
});

test("the baseline save refuses a client with no type (CLIENT_TYPE_REQUIRED)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "routes", "dataSLF.js"), "utf8");
  const start = src.indexOf("const CLIENT_TYPES =");
  const end = src.indexOf("function sanitizeClient(");
  const findClientsWithoutType = new Function(`${src.slice(start, end)}; return findClientsWithoutType;`)();
  const missing = findClientsWithoutType([
    { haulerName: "H1", privateSectorClients: [{ clientName: "City of A", clientType: "LGU" }, { clientName: "B Corp", clientType: "" }, "C Trading"] },
    { haulerName: "H2", privateSectorClients: [{ clientName: "D", clientType: "private" }, { clientName: "  " }] },
  ]);
  assert.deepEqual(missing, [{ hauler: "H1", client: "B Corp" }, { hauler: "H1", client: "C Trading" }]);
  assert.match(src, /code: "CLIENT_TYPE_REQUIRED"/);
  assert.doesNotMatch(src.slice(start, src.indexOf("function sanitizeVehicle(")), /clientType:\s*"Private"/, "sanitizeClient no longer defaults to Private");
});
