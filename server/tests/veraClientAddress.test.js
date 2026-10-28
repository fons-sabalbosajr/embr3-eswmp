/**
 * VERA's baseline facts and the portal agree on what "no address" means.
 *
 * A client located through the Region / Province / City pickers has an address
 * — the portal's hauler table shows it — even with the free-text Client Address
 * box empty. VERA used to list every such client as having "no address".
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { summarizeBaselineGaps } = require("../utils/veraPortalFacts");

test("a located client is not reported as having no address", () => {
  const gaps = summarizeBaselineGaps([
    {
      accreditedHaulers: [
        {
          haulerName: "ALANGAN",
          officeAddress: "Alangan, Limay, Bataan",
          privateSectorClients: [
            {
              clientName: "Alangan",
              clientType: "LGU",
              clientAddress: "",
              regionName: "Central Luzon",
              provinceName: "Bataan",
              municipalityName: "Limay",
            },
            { clientName: "Unplaced", clientType: "Private", clientAddress: "" },
            { clientName: "Street Only", clientType: "Private", clientAddress: "Brgy. Wawa" },
          ],
        },
      ],
    },
  ]);
  assert.deepEqual(gaps.clientsMissingAddress, ["ALANGAN → Unplaced"]);
});

test("a bare PSGC code is not an address", () => {
  const gaps = summarizeBaselineGaps([
    { accreditedHaulers: [{ haulerName: "H", privateSectorClients: [{ clientName: "C", province: "037700000", municipality: "037707000" }] }] },
  ]);
  assert.deepEqual(gaps.clientsMissingAddress, ["H → C"]);
});
