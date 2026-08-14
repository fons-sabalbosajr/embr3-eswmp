/**
 * Clients Served counts every accredited client, not the roster of one record.
 *
 * An SLF's `accreditedHaulers` array is duplicated onto every one of its
 * documents, but the copies differ: `PATCH /portal-save-baseline` writes the
 * hauler list to its baseline container WITHOUT the per-hauler client arrays,
 * while the submissions carry the full roster. The old resolver preferred the
 * container — newest AND baseline-only, so it won both tie-breaks — and got
 * haulers with no clients at all.
 *
 * Measured on production for Prime Waste Solution: the container holds 141
 * haulers / 0 client rows, each of its 22 submissions holds 141 haulers / 212
 * client rows. The card showed 1 (the fallback company) instead of 158 distinct
 * clients; driving the real route against the live database after this fix
 * returns 161 rows — 41 LGU + 120 Private.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
delete process.env.REDIS_URL;
delete process.env.REDIS_HOST;
mongoose.set("bufferCommands", false);

const DataSLF = require("../models/DataSLF");
const { resolveWasteSummaryHaulers } = require("../routes/dataSLF");

let pipeline;
const stubAggregate = (rows) => {
  DataSLF.aggregate = (p) => {
    pipeline = p;
    const chain = {
      option: () => chain,
      allowDiskUse: () => chain,
      then: (res, rej) => Promise.resolve(rows).then(res, rej),
    };
    return chain;
  };
};

test("every distinct (hauler, client) pair is returned, whichever record holds it", async () => {
  // What the database returns after the $group: one row per distinct pair.
  stubAggregate([
    { _id: { hauler: "green rescue", client: "lgu pilar" }, haulerName: "GREEN RESCUE", client: { clientName: "LGU PILAR", clientType: "LGU" } },
    { _id: { hauler: "green rescue", client: "lgu abucay" }, haulerName: "GREEN RESCUE", client: { clientName: "LGU ABUCAY", clientType: "LGU" } },
    { _id: { hauler: "lito junk shop", client: "lito junk shop" }, haulerName: "LITO JUNK SHOP", client: { clientName: "LITO JUNK SHOP", clientType: "Private" } },
  ]);

  const haulers = await resolveWasteSummaryHaulers({ slfGenerator: new mongoose.Types.ObjectId() });
  assert.equal(haulers.length, 3, "one entry per distinct pair, not one record's list");
  // Shaped the way the summary route already walks a hauler.
  haulers.forEach((h) => {
    assert.ok(h.haulerName);
    assert.equal(h.clients.length, 1);
    assert.deepEqual(h.privateSectorClients, []);
  });
  const names = haulers.map((h) => h.clients[0].clientName);
  assert.deepEqual(names, ["LGU PILAR", "LGU ABUCAY", "LITO JUNK SHOP"]);
});

test("the union is scoped to the caller's facility and needs no record to win", async () => {
  const match = { slfGenerator: new mongoose.Types.ObjectId(), deletedAt: null };
  stubAggregate([]);
  await resolveWasteSummaryHaulers(match);

  const [matchStage, sortStage, projectStage] = pipeline;
  assert.deepEqual(matchStage.$match.$and[0], match, "the caller's scope is preserved");
  assert.deepEqual(matchStage.$match.$and[1], { "accreditedHaulers.0": { $exists: true } });
  assert.deepEqual(sortStage.$sort, { createdAt: -1 }, "newest copy of a pair wins");
  assert.deepEqual(projectStage.$project, { accreditedHaulers: 1 }, "the vehicles graph is never read");

  // Both roster shapes are unioned before the collapse.
  const json = JSON.stringify(pipeline);
  assert.match(json, /privateSectorClients/);
  assert.match(json, /accreditedHaulers\.clients/);
  // A blank client name is dropped rather than counted.
  assert.ok(pipeline.some((s) => JSON.stringify(s.$match || {}).includes('"_id.client"')));
});

test("an SLF with no roster anywhere yields none — never a fabricated client", async () => {
  stubAggregate([]);
  assert.deepEqual(await resolveWasteSummaryHaulers({ slfGenerator: new mongoose.Types.ObjectId() }), []);
});

test("a string client (legacy shape) survives the union", async () => {
  stubAggregate([
    { _id: { hauler: "h", client: "acme" }, haulerName: "H", client: "ACME" },
  ]);
  const haulers = await resolveWasteSummaryHaulers({});
  assert.equal(haulers[0].clients[0], "ACME", "normalizeClient handles the string form downstream");
});
