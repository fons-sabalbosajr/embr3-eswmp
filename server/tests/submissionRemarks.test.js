/**
 * Admin Submissions → Remarks: format / completeness flags and the VERA remark.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
delete process.env.REDIS_URL;
delete process.env.REDIS_HOST;

const {
  computeFormatRemarks,
  truckLoadRows,
  isWellFormedPlate,
  isWellFormedTicket,
  buildVeraRemarkPrompt,
  fallbackVeraRemark,
  clampRemark,
} = require("../utils/submissionRemarks");
const { computeSubmissionRemarks } = require("../routes/dataSLF");

const NOW = new Date("2026-10-07T04:00:00Z");
const texts = (remarks) => remarks.map((r) => r.text);

const cleanTruck = (overrides = {}) => ({
  disposalTicketNo: "DT-2026-0001",
  hauler: "Green Rescue",
  plateNumber: "ABC 1234",
  truckCapacity: 10,
  truckCapacityUnit: "m³",
  actualVolume: 8,
  actualVolumeUnit: "m³",
  wasteType: "Residual",
  cellName: "Cell 1",
  ...overrides,
});

test("plate formats: real Philippine plates pass, placeholders do not", () => {
  // Includes the plates seen in the app's real-data fixtures (ABJ 4635, CAY 8658 …).
  ["ABC 1234", "ABC-1234", "AB 1234", "SFP 123", "1234 AB", "NBC1234", "ABJ 4635", "CAY 8658", "NGL 8726", "abc 1234"].forEach((p) =>
    assert.ok(isWellFormedPlate(p), `${p} should be accepted`),
  );
  ["", "N/A", "none", "TBA", "1234", "ABCDEFG", "ABC@123", "AB12345678"].forEach((p) =>
    assert.equal(isWellFormedPlate(p), false, `${p} should be flagged`),
  );
});

test("ticket formats: needs a digit, rejects placeholders and stray symbols", () => {
  ["DT-2026-0001", "12345", "OR#5521", "T 001/26"].forEach((t) => assert.ok(isWellFormedTicket(t), t));
  ["N/A", "-", "none", "ABC", "12<script>"].forEach((t) => assert.equal(isWellFormedTicket(t), false, t));
});

test("a clean submission carries no format remarks", () => {
  assert.deepEqual(computeFormatRemarks({ dateOfDisposal: NOW, trucks: [cleanTruck()] }, { now: NOW }), []);
});

test("missing / improper / duplicate fields are each flagged once with detail", () => {
  const remarks = computeFormatRemarks(
    {
      dateOfDisposal: NOW,
      trucks: [
        cleanTruck({ disposalTicketNo: "", plateNumber: "N/A" }),
        cleanTruck({ disposalTicketNo: "DT-9", hauler: "" }),
        cleanTruck({ disposalTicketNo: "dt-9", plateNumber: "" }),
        cleanTruck({ actualVolume: 0 }),
      ],
    },
    { now: NOW },
  );
  const t = texts(remarks);
  for (const label of [
    "Missing load volume",
    "Missing ticket no.",
    "Duplicate ticket no.",
    "Missing plate no.",
    "Improper plate no. format",
    "Missing hauler",
  ]) {
    assert.ok(t.includes(label), `expected "${label}" in ${t.join(" | ")}`);
  }
  assert.equal(new Set(t).size, t.length, "labels are unique — counts live in detail");
  assert.match(remarks.find((r) => r.text === "Improper plate no. format").detail, /"N\/A"/);
  assert.equal(remarks.find((r) => r.text === "Missing load volume").level, "error");
});

test("treated hazardous waste without an HW code, and non-standard waste types", () => {
  const remarks = computeFormatRemarks(
    {
      dateOfDisposal: NOW,
      trucks: [
        cleanTruck({
          vehicles: [
            { plateNumber: "XYZ 999", actualVolume: 2, wasteType: "Treated Hazardous Waste", hazWasteCode: [] },
            { plateNumber: "XYZ 998", actualVolume: 2, wasteType: "hazardous", hazWasteCode: ["A101"] },
          ],
        }),
      ],
    },
    { now: NOW },
  );
  const t = texts(remarks);
  const label = "Treated hazardous waste without HW code";
  assert.ok(t.includes(label));
  assert.match(remarks.find((r) => r.text === label).detail, /XYZ 999/);
  assert.ok(t.includes("Non-standard waste type"), "free-text 'hazardous' is not a canonical category");
});

test("untreated hazardous waste needs no HW code — the submit validator accepts it", () => {
  const remarks = computeFormatRemarks(
    { dateOfDisposal: NOW, trucks: [cleanTruck({ wasteType: "Hazardous Waste", hazWasteCode: [] })] },
    { now: NOW },
  );
  assert.deepEqual(texts(remarks), []);
});

// SLF-LGU-PA-0016 shape: the load is on the truck, the only vehicle is a stub
// holding a plate. Same level rule as wasteGenerationValidation.
const stubVehicleTruck = (overrides = {}) =>
  cleanTruck({ vehicles: [{ plateNumber: "ABC 1234" }], ...overrides });

test("a stub vehicle row is not a load: no false 'Missing load volume'", () => {
  assert.deepEqual(computeFormatRemarks({ dateOfDisposal: NOW, trucks: [stubVehicleTruck()] }, { now: NOW }), []);
  assert.equal(truckLoadRows(stubVehicleTruck()).length, 1);
  assert.equal(truckLoadRows(stubVehicleTruck())[0].volume, 8, "the truck-level volume is the load");
});

test("a stub vehicle row no longer hides an exceeded truck-level load", () => {
  const remarks = computeSubmissionRemarks(
    { trucks: [stubVehicleTruck({ actualVolume: 14, truckCapacity: 10 })] },
    10,
  );
  assert.ok(texts(remarks).includes("Exceeded truck capacity"));
});

test("a disposal date in the future is an error; same-day is not", () => {
  const future = computeFormatRemarks({ dateOfDisposal: "2026-10-20", trucks: [cleanTruck()] }, { now: NOW });
  assert.ok(texts(future).includes("Disposal date in the future"));
  const today = computeFormatRemarks({ dateOfDisposal: "2026-10-07", trucks: [cleanTruck()] }, { now: NOW });
  assert.ok(!texts(today).includes("Disposal date in the future"));
});

test("a row without trucks loaded (light projection) raises no false alarms", () => {
  assert.deepEqual(computeFormatRemarks({ truckCount: 4, trucks: [] }, { now: NOW }), []);
});

test("exceeded truck capacity names the load and the figures", () => {
  const remarks = computeSubmissionRemarks(
    { trucks: [cleanTruck({ plateNumber: "ABC 1234", actualVolume: 12, truckCapacity: 10 })] },
    10,
  );
  const exceeded = remarks.find((r) => r.text === "Exceeded truck capacity");
  assert.ok(exceeded, "12 m³ on a 10 m³ truck exceeds the 10% allowance");
  assert.equal(exceeded.level, "error");
  assert.match(exceeded.detail, /ABC 1234: 12 m³ vs 10 m³ capacity/);
  assert.match(exceeded.detail, /\+10% allowance/);
});

test("within the allowance is not flagged", () => {
  const remarks = computeSubmissionRemarks({ trucks: [cleanTruck({ actualVolume: 10.9, truckCapacity: 10 })] }, 10);
  assert.ok(!texts(remarks).includes("Exceeded truck capacity"));
});

test("VERA prompt carries the figures and the detected issues, never the submitter", () => {
  const entry = {
    idNo: "SLF-LGU-NE-0042",
    slfName: "Sta. Rosa",
    lguCompanyName: "LGU Sta. Rosa",
    companyType: "LGU",
    submittedBy: "operator@example.com",
    dateOfDisposal: NOW,
    status: "pending",
    trucks: [cleanTruck({ actualVolume: 12 })],
  };
  const remarks = computeSubmissionRemarks(entry, 10);
  const prompt = buildVeraRemarkPrompt([entry], remarks, { allowancePct: 10 });
  assert.match(prompt, /SLF-LGU-NE-0042/);
  assert.match(prompt, /volume=12 m³ capacity=10 m³/);
  assert.match(prompt, /\[error\] Exceeded truck capacity/);
  assert.doesNotMatch(prompt, /operator@example\.com/);
});

test("fallback remark: clean vs. issues", () => {
  assert.match(fallbackVeraRemark([]), /No issues detected/);
  const text = fallbackVeraRemark([
    { text: "Exceeded truck capacity", level: "error", detail: "ABC 1234: 12 m³ vs 10 m³ capacity" },
    { text: "Cell used for waste placement", level: "info" },
  ]);
  assert.match(text, /^Review needed: Exceeded truck capacity \(ABC 1234/);
  assert.doesNotMatch(text, /Cell used/, "info flags are not issues");
});

test("model output is stripped of markdown and clamped", () => {
  assert.equal(clampRemark("**Exceeded** capacity  on\n`ABC`"), "Exceeded capacity on ABC");
  assert.ok(clampRemark("x".repeat(2000)).length <= 600);
});

// ── Ticket no. reused in another submission ───────────────────────────────────
const DataSLF = require("../models/DataSLF");
const { findTicketReuse, ticketReuseRemarks, enrichSubmissionRow } = require("../routes/dataSLF");

const FACILITY = "64b000000000000000000001";
const OTHER_FACILITY = "64b000000000000000000002";
let lastFilter;
const stubFind = (docs) => {
  DataSLF.find = (filter) => {
    lastFilter = filter;
    const chain = {
      setOptions: () => chain,
      select: () => chain,
      limit: () => chain,
      maxTimeMS: () => chain,
      lean: () => Promise.resolve(docs),
    };
    return chain;
  };
};
const live = (id, tickets, extra = {}) => ({
  _id: id,
  idNo: `SLF-LGU-NE-${id.slice(-4)}`,
  status: "pending",
  slfGenerator: { _id: FACILITY },
  trucks: tickets.map((t) => ({ disposalTicketNo: t })),
  ...extra,
});

test("a ticket on another live submission of the same facility is flagged", async () => {
  stubFind([
    { _id: "a1", idNo: "SLF-LGU-NE-0001", slfGenerator: FACILITY, trucks: [{ disposalTicketNo: "045730" }] },
    { _id: "b2", idNo: "SLF-LGU-NE-0002", slfGenerator: FACILITY, trucks: [{ disposalTicketNo: "045730" }] },
  ]);
  const reuse = await findTicketReuse([live("b2", ["045730", "045731"])]);
  assert.deepEqual(reuse.get("b2"), [{ ticket: "045730", usedIn: ["SLF-LGU-NE-0001"] }]);
  // Scoped to the facility, only live statuses, never the row itself.
  assert.deepEqual(lastFilter.status, { $in: ["pending", "acknowledged", "revert_requested"] });
  assert.equal(String(lastFilter.$or[0].slfGenerator), FACILITY);

  const [remark] = ticketReuseRemarks(reuse.get("b2"));
  assert.equal(remark.text, "Ticket no. used in another submission");
  assert.equal(remark.level, "error");
  assert.match(remark.detail, /"045730" also in SLF-LGU-NE-0001/);
});

test("ticket matching ignores case and spacing; other facilities never match", async () => {
  stubFind([
    { _id: "a1", idNo: "SLF-PVT-PA-0009", slfGenerator: OTHER_FACILITY, trucks: [{ disposalTicketNo: "DT-9" }] },
    { _id: "a2", idNo: "SLF-LGU-NE-0003", slfGenerator: FACILITY, trucks: [{ disposalTicketNo: "dt-9" }] },
  ]);
  const reuse = await findTicketReuse([live("b2", ["DT-9"])]);
  assert.deepEqual(reuse.get("b2"), [{ ticket: "DT-9", usedIn: ["SLF-LGU-NE-0003"] }]);
});

test("rejected / reverted rows and placeholder tickets are not checked", async () => {
  let called = false;
  DataSLF.find = () => { called = true; throw new Error("should not query"); };
  const reuse = await findTicketReuse([
    live("c3", ["045730"], { status: "reverted" }),
    live("c4", ["N/A", "-"]),
  ]);
  assert.equal(reuse.size, 0);
  assert.equal(called, false, "nothing worth looking up → no query");
});

test("a failed lookup drops the flag, never the page", async () => {
  DataSLF.find = () => ({
    setOptions() { return this; }, select() { return this; }, limit() { return this; }, maxTimeMS() { return this; },
    lean: () => Promise.reject(new Error("operation exceeded time limit")),
  });
  const reuse = await findTicketReuse([live("d5", ["045730"])]);
  assert.equal(reuse.size, 0);
});

test("the table row carries the reuse remark", () => {
  const row = enrichSubmissionRow(
    { _id: "e6", trucks: [cleanTruck({ disposalTicketNo: "045730" })] },
    { ticketReuse: new Map([["e6", [{ ticket: "045730", usedIn: ["SLF-LGU-NE-0001"] }]]]) },
  );
  assert.ok(row.remarks.some((r) => r.text === "Ticket no. used in another submission"));
});
