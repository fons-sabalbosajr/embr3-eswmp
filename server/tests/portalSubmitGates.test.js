/**
 * Server-side twins of the two portal submit gates, plus the drafts queue's
 * retry path.
 *
 * The portal's copies of these rules are a convenience — THESE decide whether a
 * submission is accepted — so any drift reintroduces the exact bug shape the
 * fixes address: the preview passes and the submit rejects, or the reverse.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const { portalJsxSource } = require("./helpers/portalSource");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { validateWasteGeneration } = require("../utils/wasteGenerationValidation");

const readSource = (...parts) =>
  fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");

// ── Entry → vehicle cell inheritance ────────────────────────────────────────

const truckWith = (over = {}) => ({
  disposalTicketNo: "DT-1",
  hauler: "MUNICIPAL",
  plateNumber: "ABC-123",
  truckCapacity: 10,
  ...over,
});
const cellErrors = (trucks) =>
  validateWasteGeneration(trucks).filter((i) => i.field === "cellName");

test("a vehicle inherits the ENTRY's disposal cell", () => {
  assert.deepEqual(
    cellErrors([
      truckWith({
        cellName: "Cell 1",
        cellIndex: 0,
        vehicles: [
          { plateNumber: "A", actualVolume: 5, wasteType: "Residual" },
          { plateNumber: "B", actualVolume: 6, wasteType: "Residual" },
        ],
      }),
    ]),
    [],
  );
});

// ── A STUB vehicle does not move the load to the vehicle level ──────────────
//
// The live shape of reverted SLF-LGU-PA-0016: the truck records 3.1 m³ of
// Residual and its single vehicle row carries a plate and nothing else. Because a
// vehicle ROW existed, this validator took the per-vehicle branch and demanded
// volume, waste type and a cell from the stub — three failures on an entry that
// was complete. It also disagreed with the rest of the server: hasTruckVolume(),
// computeSlfMetrics() and the occupancy walk all read the truck level when the
// vehicles carry nothing, so that 3.1 m³ was counted everywhere and rejected here.
test("a truck whose only vehicle is a stub validates at the TRUCK level", () => {
  const record = truckWith({
    actualVolume: 3.1,
    wasteType: "Residual",
    cellName: "Cell 2",
    cellIndex: 1,
    vehicles: [{ plateNumber: "CAY 8658" }],
  });
  assert.deepEqual(validateWasteGeneration([record]), []);
});

test("a vehicle carrying a real load is still validated in full", () => {
  const real = truckWith({
    vehicles: [
      { plateNumber: "A", actualVolume: 5, wasteType: "Residual", cellName: "Cell 1" },
      { plateNumber: "B", actualVolume: 6 },
    ],
  });
  const issues = validateWasteGeneration([real]);
  assert.deepEqual(issues.map((i) => i.field).sort(), ["cellName", "wasteType"]);
  assert.equal(issues.every((i) => i.vehicleIndex === 1), true);
});

test("a stub vehicle never excuses a truck that carries nothing", () => {
  const empty = truckWith({ vehicles: [{ plateNumber: "A" }] });
  assert.deepEqual(
    validateWasteGeneration([empty]).map((i) => i.field).sort(),
    ["actualVolume", "cellName", "wasteType"],
  );
});

test("both runtimes decide the reporting LEVEL the same way", () => {
  const rule = /const vehicleCarriesLoad = \(v\) => !isBlank\(v\?\.actualVolume\) \|\| !isBlank\(v\?\.wasteType\);/;
  assert.match(readSource("utils", "wasteGenerationValidation.js"), rule);
  assert.match(
    fs.readFileSync(
      path.join(__dirname, "..", "..", "front-end", "src", "pages", "SLFPortal", "wasteGenValidation.js"),
      "utf8",
    ),
    rule,
  );
});

test("waste with no cell anywhere is still rejected", () => {
  const errs = cellErrors([
    truckWith({ vehicles: [{ plateNumber: "A", actualVolume: 5, wasteType: "Residual" }] }),
  ]);
  assert.equal(errs.length, 1);
  assert.match(errs[0].message, /Disposal Cell is required/);
});

test("the two runtimes agree on the inheritance rule", () => {
  // Same predicate name and same call shape on both sides — the portal gates its
  // Review & Submit button on its copy and the server re-enforces this one.
  const serverSrc = readSource("utils", "wasteGenerationValidation.js");
  const portalSrc = fs.readFileSync(
    path.join(__dirname, "..", "..", "front-end", "src", "pages", "SLFPortal", "wasteGenValidation.js"),
    "utf8",
  );
  const rule = /if \(!hasCellPlacement\(v\) && !hasCellPlacement\(truck\)\) \{/;
  assert.match(serverSrc, rule);
  assert.match(portalSrc, rule);
});

test("the inheritance is MATERIALISED on save, not merely assumed", () => {
  // Placement is read from each VEHICLE (portalAuth#summarizeCellAssignment), so
  // relaxing the check without writing the cell onto the vehicle would store the
  // entry as unplaced waste and send the operator to Organize Cells for an entry
  // they had already placed.
  const dataSlf = readSource("routes", "dataSLF.js");
  const sanitizer = dataSlf.slice(
    dataSlf.indexOf("function sanitizeTrucksForSave("),
    dataSlf.indexOf("const ENTRY_UNIT_FIELDS"),
  );
  assert.ok(sanitizer.length > 0);
  assert.match(sanitizer, /const entryHasCell =/);
  assert.match(sanitizer, /if \(!vehicleHasCell && entryHasCell\) \{/);
  assert.match(sanitizer, /cv\.cellIndex = typeof cleaned\.cellIndex === "number" \? cleaned\.cellIndex : null;/);
  // Only the CELL travels — copying volume/waste type would double-count.
  assert.doesNotMatch(sanitizer, /cv\.actualVolume = cleaned\.actualVolume/);
});

// ── One trip, several clients ───────────────────────────────────────────────

test("a Client cell naming several clients is split, but only as a FALLBACK", () => {
  const dataSlf = readSource("routes", "dataSLF.js");
  const validator = dataSlf.slice(
    dataSlf.indexOf("async function validateUploadedClientRelationships("),
    dataSlf.indexOf("function sanitizeVehicle("),
  );
  assert.ok(validator.length > 0);
  // The whole value is matched first — a client name may contain a comma.
  assert.match(
    validator,
    /const activeCandidates = activeMatchesFor\(client\);[\s\S]{0,80}if \(activeCandidates\.length === 0\) \{/,
    "splitting must only be reached after the whole value fails",
  );
  // …and every part must resolve, or the row is still rejected.
  assert.match(
    validator,
    /parts\.length > 1 && parts\.every\(\(part\) => activeMatchesFor\(part\)\.length === 1\)/,
  );
  assert.match(validator, /if \(!everyPartResolves\) \{/);
});

test("the portal binds EVERY matched client to the uploaded row", () => {
  const portal = portalJsxSource();
  assert.match(portal, /selectedClients: d\._matchedClients \|\| \[\],/);
  assert.doesNotMatch(
    portal,
    /selectedClients: d\._matchedClient \? \[d\._matchedClient\] : \[\]/,
    "the single-client binding dropped every client after the first",
  );
});

// ── Drafts & Scheduled: a failed submission is not a dead end ───────────────

test("a FAILED queue record can still be edited, retried and cancelled", () => {
  const queue = readSource("routes", "portalQueue.js");
  assert.match(queue, /const EDITABLE_STATUSES = \[\.\.\.ACTIVE_STATUSES, "failed"\];/);
  // Edit + cancel both gate on the widened set…
  assert.equal(
    (queue.match(/!EDITABLE_STATUSES\.includes\(record\.status\)/g) || []).length,
    2,
    "both the edit and the cancel gate must accept a failed record",
  );
  // …and submit refuses only the genuinely terminal states.
  const submit = queue.slice(queue.indexOf('router.post("/:id/submit"'));
  assert.match(submit, /record\.status === "submitted"/);
  assert.match(submit, /record\.status === "cancelled"/);
  assert.doesNotMatch(submit, /record\.status === "failed"/);
});

test("editing a failed record clears the stale failure reason", () => {
  const queue = readSource("routes", "portalQueue.js");
  const editRoute = queue.slice(queue.indexOf('router.put("/:id"'), queue.indexOf('router.patch("/:id/cancel"'));

  // ORDERING, not just presence. `record.status` is reassigned by the `type`
  // block, so a `record.status === "failed"` test placed after it can never be
  // true — the row returned to "draft" while still reporting the failure that
  // had just been fixed. An end-to-end run caught it; this source shape did not,
  // which is why the assertion is now about WHERE the answer is read.
  assert.match(editRoute, /const wasFailed = record\.status === "failed";/);
  assert.ok(
    editRoute.indexOf("const wasFailed") < editRoute.indexOf("record.status = type;"),
    "the failed state must be captured BEFORE anything reassigns status",
  );
  assert.match(
    editRoute,
    /if \(wasFailed\) \{\s*record\.status = record\.type === "scheduled" \? "scheduled" : "draft";\s*record\.failureReason = "";/,
  );
  // retryCount is history, not state — it must survive the edit.
  assert.doesNotMatch(editRoute, /record\.retryCount = 0/);
});

test("a scheduled submission that gives up TELLS the operator", () => {
  // It used to end in silence: the record was stamped `failed`, a line went into
  // the server log, and nothing reached the person whose data it was. The only
  // way to find out was to open Drafts & Scheduled and read the Status column, so
  // a submission the operator believed was filed could sit unfiled indefinitely.
  const worker = readSource("utils", "scheduledSubmissionWorker.js");
  assert.match(
    worker,
    /if \(record\.status === "failed" && record\.portalUserEmail\) \{/,
    "notify on the FINAL failure only — the intermediate retries are transient",
  );
  assert.match(worker, /type: "scheduled_submission_failed"/);
  // The type must be in the model's enum or create() throws and the notice is
  // silently lost inside the guard around it.
  assert.match(
    readSource("models", "Notification.js"),
    /"scheduled_submission_failed"/,
    "the enum must accept the type the worker writes",
  );
  // The sweep must drain even if the notice cannot be written.
  const failureBlock = worker.slice(worker.indexOf('if (record.status === "failed"'));
  assert.match(failureBlock, /\} catch \{/);
});

test("the Drafts & Scheduled MENU carries a failed-count badge", () => {
  const portal = portalJsxSource();
  // Counted in the parent, not in the panel: the panel is unmounted on every
  // other menu, which is exactly where the badge has to be right.
  // …asked for as a COUNT. The badge needs one number; fetching the failed
  // records themselves pulled a whole submission payload per row on every
  // socket event that touched the account.
  assert.match(portal, /params: \{ email: portalEmail, status: "failed", countOnly: 1 \}/);
  assert.match(portal, /count=\{queueAttentionCount\}/);
  assert.doesNotMatch(
    portal,
    /label: "Drafts & Scheduled",/,
    "the plain-text label carried no badge",
  );
  // …and refreshed by the always-on badge feed, not only on mount.
  assert.match(portal, /fetchPortalNotifications\(\);\s*fetchQueueAttention\(\);/);
});

test("the portal offers the retry the server accepts", () => {
  const panel = fs.readFileSync(
    path.join(__dirname, "..", "..", "front-end", "src", "pages", "SLFPortal", "DraftsScheduledPanel.jsx"),
    "utf8",
  );
  assert.match(panel, /const retryable = \["draft", "scheduled", "failed"\]\.includes\(record\.status\)/);
  assert.doesNotMatch(
    panel,
    /const editable = record\.status === "draft" \|\| record\.status === "scheduled"/,
    "the old gate hid the only control that could retry a failed draft",
  );
});
