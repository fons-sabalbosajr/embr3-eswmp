/**
 * Bulk baseline upload AT SCALE.
 *
 * The rest of the bulk-upload suite proves correctness on small fixtures. This
 * one proves the resolution path does not degrade on a realistic large import.
 * It exists because the spec explicitly says not to test only with 5-10 rows:
 * the risk in this path is not a wrong answer, it is a quadratic scan — every
 * uploaded row searching every known hauler, and every hauler searching its own
 * client pool — which stays invisible until somebody uploads a real workbook.
 *
 * The largest real facility today carries 74 haulers. These sizes are far past
 * that on purpose, so the headroom is measured rather than assumed.
 *
 * Timings are asserted against deliberately loose ceilings — this is a guard
 * against an order-of-magnitude regression, NOT a benchmark. A machine 10x
 * slower than CI still passes.
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";

import { mergeHaulersByName } from "../haulerNormalization.js";
import { findUploadHauler, findUploadClientForHauler } from "../uploadHelpers.js";

const HAULERS = 1200;
const CLIENTS_PER_HAULER = 12;
const UPLOAD_ROWS = 5000;

const buildHaulers = () =>
  Array.from({ length: HAULERS }, (_, h) => ({
    haulerName: `Hauler ${h} Waste Services Inc.`,
    unit: "m³",
    clients: Array.from({ length: CLIENTS_PER_HAULER }, (_, c) => ({
      clientName: `Client ${h}-${c} Corporation`,
      clientAddress: `Brgy ${c}, Municipality ${h % 130}`,
      wasteType: "Residual",
    })),
    trucks: [{ plateNo: `ABC ${h}`, capacity: 10 }],
  }));

const elapsed = (fn) => {
  const started = performance.now();
  const result = fn();
  return { ms: performance.now() - started, result };
};

test(`mergeHaulersByName collapses ${HAULERS} haulers without degrading`, () => {
  const haulers = buildHaulers();
  // Every hauler duplicated — the worst realistic case, where an operator
  // re-uploads a workbook over a baseline that already holds the same fleet.
  const withDuplicates = [...haulers, ...haulers];

  const { ms, result } = elapsed(() => mergeHaulersByName(withDuplicates));

  assert.equal(result.length, HAULERS, "duplicates must collapse, not accumulate");
  assert.equal(
    result[0].clients.length,
    CLIENTS_PER_HAULER,
    "a hauler's client pool must not double when its copy is merged in",
  );
  assert.ok(ms < 4000, `merge of ${withDuplicates.length} haulers took ${ms.toFixed(0)}ms`);
});

test(`resolving ${UPLOAD_ROWS} uploaded rows stays within budget`, () => {
  const haulers = mergeHaulersByName(buildHaulers());

  // Rows are drawn across the WHOLE fleet, not the first few — a lookup that
  // got lucky on early hits would not prove anything.
  const rows = Array.from({ length: UPLOAD_ROWS }, (_, i) => {
    const h = (i * 7) % HAULERS;
    const c = i % CLIENTS_PER_HAULER;
    return {
      haulerName: `Hauler ${h} Waste Services Inc.`,
      clientName: `Client ${h}-${c} Corporation`,
    };
  });

  let resolved = 0;
  const { ms } = elapsed(() => {
    for (const row of rows) {
      const hauler = findUploadHauler(haulers, row.haulerName);
      if (!hauler) continue;
      if (findUploadClientForHauler(hauler, row.clientName)) resolved += 1;
    }
  });

  assert.equal(resolved, UPLOAD_ROWS, "every row targets a real hauler+client and must resolve");
  assert.ok(ms < 8000, `resolving ${UPLOAD_ROWS} rows took ${ms.toFixed(0)}ms`);
});

test("an unknown hauler in a large fleet is reported, never guessed into a neighbour", () => {
  const haulers = mergeHaulersByName(buildHaulers());

  // Scale must not turn "no match" into "closest match" — a wrong hauler here
  // writes one operator's tonnage onto another's client.
  assert.equal(findUploadHauler(haulers, "Hauler 99999 Waste Services Inc."), null);
  assert.equal(findUploadHauler(haulers, ""), null);

  const hauler = findUploadHauler(haulers, "Hauler 5 Waste Services Inc.");
  assert.ok(hauler, "an exact name still resolves");
  assert.equal(findUploadClientForHauler(hauler, "Client 6-0 Corporation"), null,
    "another hauler's client must not resolve against this hauler");
});
