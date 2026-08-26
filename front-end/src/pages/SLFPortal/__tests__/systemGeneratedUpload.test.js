/**
 * System-generated disposal files — detection and Hauler↔Client alignment.
 *
 * The fixtures are taken from a real Prime Waste Solution export (a Residual
 * Disposal Facility in Pampanga): every row repeats one party in BOTH the Hauler
 * and the Client column, and that party is variously a hauler, a client, or the
 * two joined with a dash. Before alignment existed the portal rejected all of it
 * with "Hauler … is not assigned under this SLF" — true, unhelpful, and identical
 * on every row.
 *
 * What these tests pin is the boundary, not the happy path: alignment must
 * resolve what is unambiguous and REFUSE what is not. A wrong guess here is
 * silently attributed volume — the worst outcome available — so "two haulers
 * serve this client, so it stays blocked" is a required behaviour, not a
 * limitation.
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  alignDisposalRow,
  detectSystemGeneratedFile,
  differsOnlyByQualifier,
  findClientNearMisses,
  isTripRow,
  resolveDisposalIdentity,
  summarizeAlignment,
} from "../systemGeneratedUpload.js";

// A baseline shaped the way the portal actually stores one: clients live on
// privateSectorClients, and the same client is also copied onto a vehicle's
// selectedClients — which is why the pool has to be de-duplicated before anything
// can be called ambiguous.
const HAULERS = [
  {
    haulerName: "GREEN RESCUE",
    officeAddress: "San Fernando, Pampanga",
    privateSectorClients: [
      { clientName: "MUNICIPALITY OF PULILAN, BULACAN", clientType: "LGU" },
      { clientName: "MUNICIPALITY OF BAUTISTA, PANGASINAN", clientType: "LGU" },
    ],
    vehicles: [
      {
        plateNumber: "ABJ 4635",
        selectedClients: [{ clientName: "MUNICIPALITY OF PULILAN, BULACAN", clientType: "LGU" }],
      },
    ],
  },
  {
    haulerName: "BGC HAULERS",
    privateSectorClients: [{ clientName: "BGC HAULERS", clientType: "Private" }],
  },
  {
    haulerName: "SERVO TREAT PHILIPPINES, INC.",
    privateSectorClients: [
      { clientName: "SERVO TREAT PHILIPPINES, INC.", clientType: "Private" },
    ],
  },
  {
    haulerName: "PAMPANGA HAULING SERVICES",
    privateSectorClients: [{ clientName: "MUNICIPALITY OF GUAGUA, PAMPANGA", clientType: "LGU" }],
  },
];

const row = (hauler, client, extra = {}) => ({
  _rowNumber: 2,
  hauler,
  client,
  ...extra,
});

// ── Detection ────────────────────────────────────────────────────────────────

test("a file carrying the full generated-template header set is detected", () => {
  const headers = [
    "Disposal Date", "Hauler", "Client", "Waste Type", "Waste Volume",
    "Unit of Measurement", "Cell or Disposal Area", "Disposal Ticket No",
    "Plate Number", "Truck Capacity", "Hazardous Waste Code",
  ];
  const detection = detectSystemGeneratedFile(headers, []);
  assert.equal(detection.matchesTemplate, true);
  assert.equal(detection.isSystemGenerated, true);
});

test("rows that repeat the same name in Hauler and Client are detected without the headers", () => {
  const rows = [
    row("BGC HAULERS", "BGC HAULERS"),
    row("SERVO TREAT PHILIPPINES, INC.", "SERVO TREAT PHILIPPINES, INC."),
    row("GREEN RESCUE - MUNICIPALITY OF PULILAN, BULACAN", "GREEN RESCUE - MUNICIPALITY OF PULILAN, BULACAN"),
  ];
  const detection = detectSystemGeneratedFile(["Hauler", "Client"], rows);
  assert.equal(detection.mirroredRows, 3);
  assert.equal(detection.mirrorsHaulerAndClient, true);
  assert.equal(detection.isSystemGenerated, true);
});

test("a hand-made file with a couple of self-hauling companies is NOT called system-generated", () => {
  const rows = [
    row("GREEN RESCUE", "MUNICIPALITY OF PULILAN, BULACAN"),
    row("GREEN RESCUE", "MUNICIPALITY OF BAUTISTA, PANGASINAN"),
    row("PAMPANGA HAULING SERVICES", "MUNICIPALITY OF GUAGUA, PAMPANGA"),
    // One genuine self-hauler out of four is normal, not a fingerprint.
    row("BGC HAULERS", "BGC HAULERS"),
  ];
  const detection = detectSystemGeneratedFile(["Hauler", "Client"], rows);
  assert.equal(detection.mirroredRows, 1);
  assert.equal(detection.isSystemGenerated, false);
});

// ── Resolution ───────────────────────────────────────────────────────────────

test("a correctly written row still resolves directly and is not rewritten", () => {
  const result = resolveDisposalIdentity(
    row("GREEN RESCUE", "MUNICIPALITY OF PULILAN, BULACAN"),
    HAULERS,
  );
  assert.equal(result.status, "direct");
  const aligned = alignDisposalRow(
    row("GREEN RESCUE", "MUNICIPALITY OF PULILAN, BULACAN"),
    HAULERS,
  );
  assert.equal(aligned._alignment, null);
  assert.deepEqual(aligned._alignmentErrors, []);
  assert.equal(aligned.hauler, "GREEN RESCUE");
});

test('a compound "HAULER - CLIENT" value is split against the baseline', () => {
  const value = "GREEN RESCUE - MUNICIPALITY OF PULILAN, BULACAN";
  const result = resolveDisposalIdentity(row(value, value), HAULERS);
  assert.equal(result.status, "aligned");
  assert.equal(result.method, "compound-split");
  assert.equal(result.hauler, "GREEN RESCUE");
  assert.equal(result.client, "MUNICIPALITY OF PULILAN, BULACAN");
});

test("the aligned row is rewritten to the baseline's own spelling and keeps the original on record", () => {
  const value = "GREEN RESCUE - MUNICIPALITY OF BAUTISTA, PANGASINAN";
  const aligned = alignDisposalRow(row(value, value), HAULERS);
  assert.equal(aligned.hauler, "GREEN RESCUE");
  assert.equal(aligned.client, "MUNICIPALITY OF BAUTISTA, PANGASINAN");
  assert.equal(aligned._alignment.status, "aligned");
  // The operator has to be able to see what the file actually said.
  assert.equal(aligned._alignment.originalHauler, value);
  assert.deepEqual(aligned._alignmentErrors, []);
});

test("a hauler that is its own client needs no inference — the ordinary lookup matches", () => {
  // The self-hauling case looks like it needs special handling and does not: the
  // baseline stores such a company as a hauler listing itself as a client, so the
  // repeated name in the export resolves directly. Pinned so the special case is
  // not reintroduced.
  const result = resolveDisposalIdentity(row("BGC HAULERS", "BGC HAULERS"), HAULERS);
  assert.equal(result.status, "direct");
  assert.equal(result.hauler, "BGC HAULERS");
  assert.equal(result.client, "BGC HAULERS");
});

test("a self-hauling company that does NOT list itself as a client is reported, not assumed", () => {
  const noSelfClient = [
    { haulerName: "BGC HAULERS", privateSectorClients: [{ clientName: "SOMEONE ELSE" }] },
  ];
  const aligned = alignDisposalRow(row("BGC HAULERS", "BGC HAULERS"), noSelfClient);
  assert.equal(aligned._alignment.status, "unresolved");
  assert.match(aligned._alignmentErrors[0], /is accredited, but "BGC HAULERS" is not one of its clients/);
});

test("a value that is only a CLIENT name resolves through the single hauler serving it", () => {
  const value = "MUNICIPALITY OF GUAGUA, PAMPANGA";
  const result = resolveDisposalIdentity(row(value, value), HAULERS);
  assert.equal(result.status, "aligned");
  assert.equal(result.method, "client-only");
  assert.equal(result.hauler, "PAMPANGA HAULING SERVICES");
  assert.equal(result.client, value);
});

test("a client served by TWO haulers is reported as ambiguous, never guessed", () => {
  const shared = [
    ...HAULERS,
    {
      haulerName: "SECOND HAULER",
      privateSectorClients: [{ clientName: "MUNICIPALITY OF GUAGUA, PAMPANGA", clientType: "LGU" }],
    },
  ];
  const value = "MUNICIPALITY OF GUAGUA, PAMPANGA";
  const result = resolveDisposalIdentity(row(value, value), shared);
  assert.equal(result.status, "ambiguous");
  assert.equal(result.candidates.length, 2);

  const aligned = alignDisposalRow(row(value, value), shared);
  // Blocked, and the row keeps the file's own values rather than one of the guesses.
  assert.equal(aligned.hauler, value);
  assert.equal(aligned._alignmentErrors.length, 1);
  assert.match(aligned._alignmentErrors[0], /2 accredited haulers/);
});

test("an accredited hauler with an unknown client says so, and lists the clients it does have", () => {
  const aligned = alignDisposalRow(
    row("GREEN RESCUE", "MUNICIPALITY OF NOWHERE, BULACAN"),
    HAULERS,
  );
  assert.equal(aligned._alignment.status, "unresolved");
  const message = aligned._alignmentErrors[0];
  assert.match(message, /GREEN RESCUE" is accredited/);
  assert.match(message, /MUNICIPALITY OF PULILAN, BULACAN/);
  assert.match(message, /Baseline \/ Accredited Haulers/);
});

test("a name on neither side of the baseline is reported as such", () => {
  const value = "UNKNOWN DISPOSAL SERVICES";
  const aligned = alignDisposalRow(row(value, value), HAULERS);
  assert.equal(aligned._alignment.status, "unresolved");
  assert.match(aligned._alignmentErrors[0], /matches an accredited hauler or a client/);
});

test("alignment never invents a client for a hauler that has none", () => {
  const emptyHauler = [{ haulerName: "NEW HAULER", privateSectorClients: [] }];
  const aligned = alignDisposalRow(row("NEW HAULER", "NEW HAULER"), emptyHauler);
  assert.equal(aligned._alignment.status, "unresolved");
  assert.match(aligned._alignmentErrors[0], /no clients on the baseline yet/);
});

// ── Client name mismatches ───────────────────────────────────────────────────
//
// The fixture is the live failure this was built from: the hauler is accredited
// under its full compound name, and the client it serves is stored WITHOUT the
// trailing province that the gate export includes.
const COMPOUND = "GREEN RESCUE - MUNICIPALITY OF PULILAN, BULACAN";
const MISMATCH_HAULERS = [
  {
    haulerName: COMPOUND,
    privateSectorClients: [
      { clientName: "LGU of Pulilan, BULACAN", clientType: "LGU" },
      { clientName: "GREEN RESCUE - MUNICIPALITY OF PULILAN", clientType: "LGU" },
      { clientName: "MUNICIPALITY OF BAUTISTA, PANGASINAN", clientType: "LGU" },
    ],
  },
];

test("a client stored without the file's trailing qualifier ADOPTS the stored spelling", () => {
  // Was reported as a mismatch for a person to resolve. It is now applied on the
  // operator's behalf, because this is the one shape where the answer is not a
  // judgement: exactly ONE stored client contains the file's name as whole words,
  // nothing else comes close, and the only difference is the descriptive
  // qualifier ", BULACAN". See differsOnlyByQualifier for what still blocks.
  const result = resolveDisposalIdentity(row(COMPOUND, COMPOUND), MISMATCH_HAULERS);
  assert.equal(result.status, "aligned");
  assert.equal(result.method, "client-spelling");
  assert.equal(result.hauler, COMPOUND);
  assert.equal(result.client, "GREEN RESCUE - MUNICIPALITY OF PULILAN");
});

test("an adopted spelling is written onto the row and reported, never silent", () => {
  const aligned = alignDisposalRow(row(COMPOUND, COMPOUND, { disposalTicketNo: "045730" }), MISMATCH_HAULERS);
  assert.equal(aligned._alignment.status, "aligned");
  assert.equal(aligned._alignment.method, "client-spelling");
  assert.equal(aligned.client, "GREEN RESCUE - MUNICIPALITY OF PULILAN", "the stored spelling is used");
  assert.equal(aligned._alignmentErrors.length, 0, "the row is no longer blocked");
  // The operator can see what was changed and what it was changed from.
  assert.equal(aligned._alignment.originalClient, COMPOUND);
  assert.match(aligned._alignment.note, /was recorded as/);
});

test("names separated by a NUMBER are never adopted, however similar", () => {
  // The measured failure mode. On live rosters "barangay 1" … "barangay 5" are
  // five different places scoring 90.0% against each other, and "brgy. 03 (rcb)"
  // vs "brgy. 04 (rcb)" scores 92.9%. A percentage threshold cannot tell them
  // apart; the differing-token rule can.
  const baler = {
    haulerName: "LGU BALER",
    privateSectorClients: [
      { clientName: "Barangay 1" },
      { clientName: "Barangay 2" },
      { clientName: "Barangay 3" },
    ],
  };
  for (const typed of ["Barangay 4", "Barangay 2"]) {
    const result = resolveDisposalIdentity(row("LGU BALER", typed), [baler]);
    assert.notEqual(result.method, "client-spelling", `"${typed}" must not adopt a sibling barangay`);
  }
  const rcb = {
    haulerName: "H",
    privateSectorClients: [{ clientName: "Brgy. 03 (RCB)" }],
  };
  const result = resolveDisposalIdentity(row("H", "Brgy. 04 (RCB)"), [rcb]);
  assert.notEqual(result.method, "client-spelling");
  assert.notEqual(result.client, "Brgy. 03 (RCB)");
});

test("the qualifier guard admits words and refuses identifiers", () => {
  assert.equal(differsOnlyByQualifier("Green Rescue - Municipality of Pulilan, Bulacan", "Green Rescue - Municipality of Pulilan"), true);
  assert.equal(differsOnlyByQualifier("ABC Corporation", "ABC Corporation Inc"), true);
  assert.equal(differsOnlyByQualifier("Barangay 1", "Barangay 2"), false);
  assert.equal(differsOnlyByQualifier("Brgy. 03 (RCB)", "Brgy. 04 (RCB)"), false);
  assert.equal(differsOnlyByQualifier("Cell 1 Client", "Cell 1 Client"), true);
});

test("two equally good candidates stay a MISMATCH — a choice is not a correction", () => {
  // BOTH stored names are contiguous runs of whole words inside the typed one, so
  // both reach the containment class. Picking either is a guess.
  const twoWays = {
    haulerName: "H",
    privateSectorClients: [
      { clientName: "Green Rescue Municipality of Pulilan" },
      { clientName: "Municipality of Pulilan Bulacan" },
    ],
  };
  const typed = "Green Rescue Municipality of Pulilan Bulacan";
  assert.equal(
    findClientNearMisses(twoWays, typed).filter((s) => s.score >= 0.95).length,
    2,
    "fixture must actually produce two containment-class candidates",
  );
  const result = resolveDisposalIdentity(row("H", typed), [twoWays]);
  assert.notEqual(result.method, "client-spelling", "ambiguity must never auto-resolve");
  assert.equal(result.status, "mismatch");
});

test("two different municipalities are NOT proposed as each other's mismatch", () => {
  // The reason this uses containment rather than a similarity score: as strings
  // these are ~85% identical, and proposing one for the other would attribute a
  // trip to the wrong LGU.
  const hauler = {
    haulerName: "H",
    privateSectorClients: [
      { clientName: "MUNICIPALITY OF PULILAN, BULACAN" },
      { clientName: "MUNICIPALITY OF BAUTISTA, PANGASINAN" },
    ],
  };
  assert.deepEqual(findClientNearMisses(hauler, "MUNICIPALITY OF NOWHERE, BULACAN"), []);
  const aligned = alignDisposalRow(row("H", "MUNICIPALITY OF NOWHERE, BULACAN"), [hauler]);
  assert.equal(aligned._alignment.status, "unresolved");
});

test("an abbreviation matches the word it shortens, but a different word never does", () => {
  const hauler = {
    haulerName: "H",
    privateSectorClients: [{ clientName: "ABC Manufacturing Corporation" }],
  };
  assert.equal(findClientNearMisses(hauler, "ABC Manufacturing Corp")[0]?.score, 0.85);
  // "Machining" is not "Manufacturing" abbreviated — neither prefixes the other.
  assert.deepEqual(findClientNearMisses(hauler, "ABC Machining Corp"), []);
  // A single shared word is not evidence of anything, even though "ABC" IS
  // literally contained in the stored name.
  assert.deepEqual(findClientNearMisses(hauler, "ABC"), []);
});

test("a short prefix is rejected however cleanly it is contained", () => {
  // The guard that stops containment from being useless: a real mismatch differs
  // by a qualifier, so the two names are nearly the same length.
  const hauler = {
    haulerName: "H",
    privateSectorClients: [{ clientName: "City of San Fernando, Pampanga" }],
  };
  assert.deepEqual(findClientNearMisses(hauler, "City of"), [], "35% of the stored name");
  assert.deepEqual(findClientNearMisses(hauler, "Pampanga"), []);
  // But the genuine qualifier case still matches.
  assert.equal(
    findClientNearMisses(hauler, "City of San Fernando")[0]?.score,
    0.98,
  );
});

test("mismatches are grouped per hauler+client, carrying every affected row", () => {
  // Uses the ABBREVIATION class (0.85), which is deliberately NOT auto-applied —
  // "corp" → "corporation" is an inference about what a shortening stands for.
  // The containment class is adopted instead, so it no longer reaches here.
  const ABBREV = [
    { haulerName: "H", privateSectorClients: [{ clientName: "ABC Manufacturing Corporation" }] },
  ];
  const typed = "ABC Manufacturing Corp";
  const rows = [
    alignDisposalRow(row("H", typed, { _rowNumber: 2, key: "r1", disposalTicketNo: "1" }), ABBREV),
    alignDisposalRow(row("H", typed, { _rowNumber: 3, key: "r2", disposalTicketNo: "2" }), ABBREV),
    alignDisposalRow(row("H", typed, { _rowNumber: 4, key: "r3", disposalTicketNo: "3" }), ABBREV),
  ];
  assert.equal(rows[0]._alignment.status, "mismatch");
  const summary = summarizeAlignment(rows);
  assert.equal(summary.mismatches.length, 1, "one decision, not three");
  assert.equal(summary.mismatches[0].rows, 3);
  assert.deepEqual(summary.mismatches[0].rowKeys, ["r1", "r2", "r3"]);
  assert.equal(summary.mismatchCount, 3);
  // A mismatch is NOT a record to encode — listing it there is what would make an
  // operator add a duplicate.
  assert.equal(summary.needsEncoding.length, 0);
});

test("taking the stored name clears the row", () => {
  // What the "Use the stored name" action does, then re-validated.
  const fixed = alignDisposalRow(
    row(COMPOUND, "GREEN RESCUE - MUNICIPALITY OF PULILAN", { disposalTicketNo: "045730" }),
    MISMATCH_HAULERS,
  );
  assert.equal(fixed._alignment, null, "resolves directly once the names agree");
  assert.deepEqual(fixed._alignmentErrors, []);
});

test("renaming the stored client to the file's spelling clears the row too", () => {
  // What "Rename it on the hauler" does: the same client record, renamed.
  const renamed = [
    {
      haulerName: COMPOUND,
      privateSectorClients: [
        { clientName: "LGU of Pulilan, BULACAN", clientType: "LGU" },
        { clientName: COMPOUND, clientType: "LGU" },
        { clientName: "MUNICIPALITY OF BAUTISTA, PANGASINAN", clientType: "LGU" },
      ],
    },
  ];
  const fixed = alignDisposalRow(row(COMPOUND, COMPOUND, { disposalTicketNo: "045730" }), renamed);
  assert.equal(fixed._alignment, null);
  assert.deepEqual(fixed._alignmentErrors, []);
});

// ── Spreadsheet remnants ─────────────────────────────────────────────────────

test("a trailing row holding only a stray value is not a trip", () => {
  // Exactly what the real Prime Waste Solution export ends with: three rows whose
  // only content is a bare number left in the Client column.
  assert.equal(isTripRow({ client: 6 }), false);
  assert.equal(isTripRow({ hauler: "", client: 1.5 }), false);
  assert.equal(isTripRow({}), false);
});

test("an INCOMPLETE trip is still a trip and must not be dropped", () => {
  // The remnant rule exists to remove noise, not to hide bad data: a row missing
  // most of its fields still has to reach the preview and be reported.
  assert.equal(isTripRow({ disposalTicketNo: "045730" }), true);
  assert.equal(isTripRow({ plateNumber: "ABJ 4635" }), true);
  assert.equal(isTripRow({ actualVolume: 6.3 }), true);
  assert.equal(isTripRow({ cellName: "Cell 4" }), true);
  assert.equal(isTripRow({ disposalDate: "2026-07-12" }), true);
});

test("remnants contribute no work item to the missing-records list", () => {
  const rows = [
    alignDisposalRow({ _rowNumber: 17, hauler: "", client: "6" }, HAULERS),
    alignDisposalRow({ _rowNumber: 18, hauler: "", client: "1.5" }, HAULERS),
    alignDisposalRow(
      { _rowNumber: 19, hauler: "GREEN RESCUE", client: "MUNICIPALITY OF NOWHERE", disposalTicketNo: "045999" },
      HAULERS,
    ),
  ];
  const summary = summarizeAlignment(rows);
  assert.equal(summary.needsEncoding.length, 1, "only the real trip counts as work");
  assert.match(summary.needsEncoding[0].label, /MUNICIPALITY OF NOWHERE/);
});

// ── Summary ──────────────────────────────────────────────────────────────────

test("the summary groups unencoded names into one item of work each, not one per trip", () => {
  const value = "MUNICIPALITY OF NOWHERE, BULACAN";
  // Ticket numbers make these real trips rather than remnants — see isTripRow.
  const rows = [
    alignDisposalRow(row("GREEN RESCUE", value, { _rowNumber: 2, disposalTicketNo: "045901" }), HAULERS),
    alignDisposalRow(row("GREEN RESCUE", value, { _rowNumber: 3, disposalTicketNo: "045902" }), HAULERS),
    alignDisposalRow(row("GREEN RESCUE", value, { _rowNumber: 4, disposalTicketNo: "045903" }), HAULERS),
    alignDisposalRow(
      row(
        "GREEN RESCUE - MUNICIPALITY OF PULILAN, BULACAN",
        "GREEN RESCUE - MUNICIPALITY OF PULILAN, BULACAN",
        { _rowNumber: 5, disposalTicketNo: "045904" },
      ),
      HAULERS,
    ),
  ];
  const summary = summarizeAlignment(rows);
  assert.equal(summary.alignedCount, 1);
  assert.equal(summary.needsEncoding.length, 1);
  assert.equal(summary.needsEncoding[0].rows, 3);
  assert.match(summary.needsEncoding[0].label, /MUNICIPALITY OF NOWHERE/);
});

test("a file of correctly written rows produces an empty summary", () => {
  const rows = [
    alignDisposalRow(row("GREEN RESCUE", "MUNICIPALITY OF PULILAN, BULACAN"), HAULERS),
    alignDisposalRow(row("PAMPANGA HAULING SERVICES", "MUNICIPALITY OF GUAGUA, PAMPANGA"), HAULERS),
  ];
  const summary = summarizeAlignment(rows);
  assert.equal(summary.alignedCount, 0);
  assert.equal(summary.ambiguousCount, 0);
  assert.equal(summary.needsEncoding.length, 0);
});
