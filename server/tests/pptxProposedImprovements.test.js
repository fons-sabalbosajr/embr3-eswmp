/**
 * Acceptance checks for docs/files/Proposed_SLF_Portal_Improvements.pptx —
 * the server half. One block per slide, using the deck's own examples (the
 * fictional demo facility "Demonstration Valley Sanitary Landfill"), against
 * the functions that implement each improvement. No database: models are
 * stubbed, so nothing here reads or writes real data.
 *
 * The portal half lives in
 * front-end/src/pages/SLFPortal/__tests__/pptxProposedImprovements.test.js.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { expandBacklogEntries, backlogWindow } = require("../utils/backlogEntries");
const { applyEnteredVolumesToTruck } = require("../utils/enteredVolume");
const { sameName } = require("../utils/nameMatch");
const { correctRoster, syncClientCorrection } = require("../utils/clientCorrection");
const { zipPathFor, ZIP_MAX_FILES } = require("../utils/portalDocuments");
const fs = require("node:fs");
const path = require("node:path");
const DataSLF = require("../models/DataSLF");
const UserPortal = require("../models/UserPortal");
const Notification = require("../models/Notification");
const AppLog = require("../models/AppLog");

// The deck's "today": Nov 24, 2026, mid-morning in Manila.
const NOW = new Date("2026-11-24T02:00:00Z");

const day = (offset) => {
  const d = new Date(Date.UTC(2026, 9, 24 + offset)); // Oct 24 + offset
  return d.toISOString().slice(0, 10);
};

// ── Slide 3 · Autosave entries to Drafts ─────────────────────────────────────
test("slide 3: an autosave is told apart from a manual save and stamped with its time", () => {
  // The route behaviour is covered in detail by draftAutosave.test.js; this pins
  // the slide's claim: drafts save on their own and show when they were saved.
  const queue = fs.readFileSync(path.join(__dirname, "..", "routes", "portalQueue.js"), "utf8");
  assert.match(queue, /body\?\.autosave === true/, "only an explicit autosave counts");
  assert.match(
    queue,
    /record\.autosavedAt = isAutosave\(body\) \? new Date\(\) : undefined/,
    "the last-saved time is stamped on an autosave and cleared by a manual save",
  );
});

// ── Slide 4 · Multiple MOV downloads + My Documents ──────────────────────────
test("slide 4: selected documents are bundled into one zip, MOVs grouped by section and cell", () => {
  const mov = { type: "mov", section: "Active Cells", cellName: "Cell 2", fileName: "MOV - Active Cells (Cell 2).pdf" };
  const closed = { type: "mov", section: "Closed Cells", fileName: "MOV - Closed Cells.pdf" };
  const attachment = { type: "attachment", reference: "SLF-2026-0342", fileName: "trip tickets.pdf" };
  assert.equal(zipPathFor(mov), "MOV/Active Cells - Cell 2/MOV - Active Cells (Cell 2).pdf");
  assert.equal(zipPathFor(closed), "MOV/Closed Cells/MOV - Closed Cells.pdf");
  assert.equal(zipPathFor(attachment), "Support Attachments/SLF-2026-0342 - trip tickets.pdf");
  assert.ok(ZIP_MAX_FILES >= 3, "the deck's three-file example fits in one download");
});

// ── Slide 5 · Upload up to one month of backlog at once ──────────────────────
test("slide 5: the accepted window runs from one month back to today", () => {
  assert.deepEqual(backlogWindow(NOW), { from: "2026-10-24", to: "2026-11-24" });
});

test("slide 5: one file covering Oct 24 – Nov 23 becomes one submission per day", () => {
  const days = Array.from({ length: 31 }, (_, i) => day(i)); // Oct 24 … Nov 23
  const upload = {
    slfName: "Demonstration Valley Sanitary Landfill",
    dateOfDisposal: days[0],
    trucks: days.map((d, i) => ({
      disposalDate: d,
      hauler: i % 2 ? "Copperleaf Demo" : "Northwind Sample",
      actualVolume: 20,
      actualVolumeUnit: "m³",
    })),
  };
  const { items: entries, errors } = expandBacklogEntries([upload], { now: NOW });
  assert.deepEqual(errors, []);
  assert.equal(entries.length, 31, "every disposal date is its own submission");
  assert.deepEqual(
    entries.map((e) => String(e.dateOfDisposal).slice(0, 10)),
    days,
    "each keeps its own Disposal Date, oldest first",
  );
  assert.ok(entries.every((e) => e.trucks.length === 1), "each day carries only its own trucks");
});

test("slide 5: dates older than one month, or in the future, are refused", () => {
  const upload = {
    dateOfDisposal: "2026-11-20",
    trucks: [
      { disposalDate: "2026-10-23", actualVolume: 5 }, // one day too old
      { disposalDate: "2026-11-20", actualVolume: 5 },
      { disposalDate: "2026-11-25", actualVolume: 5 }, // tomorrow
    ],
  };
  const { errors } = expandBacklogEntries([upload], { now: NOW });
  assert.ok(errors.some((e) => /Future disposal dates/.test(e) && /Nov 25, 2026/.test(e)), errors.join(" | "));
  assert.ok(errors.some((e) => /go back one month/.test(e) && /Oct 23, 2026/.test(e)), errors.join(" | "));
});

// ── Slide 6 · Tons converted to m³ ───────────────────────────────────────────
test("slide 6: 12.5 tons at an m³ SLF is saved as 25 m³, the tons kept", () => {
  const truck = {
    hauler: "Northwind Sample Haulers",
    actualVolumeUnit: "m³",
    enteredVolume: 12.5,
    enteredVolumeUnit: "tons",
    // Whatever the browser sent is recomputed — the server is the authority.
    actualVolume: 99,
  };
  applyEnteredVolumesToTruck(truck);
  assert.equal(truck.actualVolume, 25, "m³ = tons ÷ 0.5");
  assert.equal(truck.enteredVolume, 12.5, "the weighed value stays with the record");
  assert.equal(truck.enteredVolumeUnit, "tons");
});

// ── Slide 7 · Corrected data flows back to the portal ────────────────────────
test("slide 7: an EMB correction rewrites the client and the hauler name on the roster", () => {
  const haulers = [
    {
      haulerName: "Northwind Sample Hauler",
      privateSectorClients: [{ clientName: "Villa Muestra", clientAddress: "N/A" }],
    },
  ];
  const { haulers: next, changes } = correctRoster(haulers, {
    names: ["Villa Muestra"],
    values: { clientName: "Villa Muestra", clientAddress: "Brgy. Poblacion, Villa Muestra, Bulacan" },
    renameHauler: { from: "Northwind Sample Hauler", to: "Northwind Sample Haulers" },
  });
  assert.equal(next[0].haulerName, "Northwind Sample Haulers");
  assert.equal(next[0].privateSectorClients[0].clientAddress, "Brgy. Poblacion, Villa Muestra, Bulacan");
  // What changed is recorded field by field — the "who changed what" log.
  assert.ok(changes.some((c) => c.kind === "hauler" && c.to === "Northwind Sample Haulers"));
  const clientChange = changes.find((c) => c.kind === "client");
  assert.deepEqual(clientChange.fields, [
    { field: "clientAddress", from: "N/A", to: "Brgy. Poblacion, Villa Muestra, Bulacan" },
  ]);
});

test("slide 7: the correction is saved to the SLF's baseline, logged, and the portal user is notified", async (t) => {
  const real = {
    find: DataSLF.find,
    findOne: DataSLF.findOne,
    updateOne: DataSLF.updateOne,
    userFind: UserPortal.find,
    notify: Notification.create,
    log: AppLog.create,
  };
  t.after(() => {
    DataSLF.find = real.find;
    DataSLF.findOne = real.findOne;
    DataSLF.updateOne = real.updateOne;
    UserPortal.find = real.userFind;
    Notification.create = real.notify;
    AppLog.create = real.log;
  });
  const chain = (rows) => {
    const q = { setOptions: () => q, select: () => q, sort: () => q, lean: async () => rows };
    return q;
  };
  const baseline = {
    _id: "base1",
    slfName: "Demonstration Valley Sanitary Landfill",
    submittedBy: "operator@demo.invalid",
    accreditedHaulers: [
      { haulerName: "Northwind Sample Haulers", privateSectorClients: [{ clientName: "Villa Muestra", clientAddress: "N/A" }] },
    ],
  };
  let call = 0;
  DataSLF.find = () => chain(call++ === 0 ? [{ _id: "base1", slfName: baseline.slfName }] : [baseline]);
  DataSLF.findOne = () => chain(null);
  const updates = [];
  DataSLF.updateOne = async (filter, update) => {
    updates.push({ filter, update });
    return { modifiedCount: 1 };
  };
  UserPortal.find = () => chain([]);
  const notices = [];
  Notification.create = async (doc) => {
    notices.push(doc);
    return doc;
  };
  const logs = [];
  AppLog.create = async (doc) => {
    logs.push(doc);
    return doc;
  };

  const result = await syncClientCorrection({
    client: {
      _id: "client1",
      name: "Villa Muestra",
      address: "Brgy. Poblacion, Villa Muestra, Bulacan",
      baselineRef: "base1",
      portalUserEmail: "operator@demo.invalid",
    },
    before: { name: "Villa Muestra" },
    actor: "emb.admin",
  });

  assert.equal(result.recordsUpdated, 1, "the SLF's baseline is updated");
  const saved = updates[0].update.$set.accreditedHaulers[0].privateSectorClients[0];
  assert.equal(saved.clientAddress, "Brgy. Poblacion, Villa Muestra, Bulacan");
  assert.equal(notices.length, 1, "the portal user gets one notification");
  assert.equal(notices[0].recipient, "operator@demo.invalid");
  assert.equal(notices[0].type, "data_verified_by_emb");
  assert.match(notices[0].message, /Verified by EMB/);
  // writeLog persists asynchronously; give it a tick.
  await new Promise((r) => setImmediate(r));
  const log = logs.find((l) => /emb_correction_synced/.test(l.action || l.event || l.type || JSON.stringify(l)));
  assert.ok(log, "the correction is logged");
  assert.match(JSON.stringify(log), /emb\.admin/, "with who made it");
});

// ── Slide 8 · Accept small differences in names ──────────────────────────────
test("slide 8: punctuation, capitals and spacing are ignored", () => {
  assert.equal(sameName("Northgate Sample Logistics, Inc", "Northgate Sample Logistics Inc."), true);
  assert.equal(sameName("NORTHWIND SAMPLE HAULERS", "Northwind Sample Haulers"), true);
  assert.equal(sameName("Brgy.  Poblacion,Villa Muestra", "Brgy. Poblacion, Villa Muestra"), true);
});

test("slide 8: a different word, a missing letter or a missing word is still caught", () => {
  assert.equal(sameName("Northwest Sample Haulers", "Northwind Sample Haulers"), false);
  assert.equal(sameName("Villa Muesta", "Villa Muestra"), false);
  assert.equal(sameName("Copperleaf Transport", "Copperleaf Demo Transport"), false);
});
