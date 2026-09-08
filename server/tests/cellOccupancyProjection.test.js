/**
 * OCCUPANCY_ENTRY_PROJECTION must stay equivalent to OCCUPANCY_ENTRY_FIELDS.
 *
 * The all-facilities occupancy read (GET /cell-occupancy) pulls every submission
 * ever recorded — 830 entries / 24,699 trucks / 22,557 vehicles on production —
 * to answer a 31 KB rollup. 62% of those vehicles record no volume and cannot
 * affect any figure, so the projection drops them in the database rather than
 * shipping them.
 *
 * That optimisation is only safe while the projection selects EXACTLY the paths
 * the calculation reads. A field quietly dropped here does not fail loudly: it
 * arrives as `undefined`, the arithmetic treats it as zero, and a cell reports a
 * smaller fill than it holds. These tests pin the equivalence, and pin the two
 * asymmetries that are deliberate.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  OCCUPANCY_ENTRY_FIELDS,
  OCCUPANCY_ENTRY_PROJECTION,
} = require("../utils/cellOccupancy");

/** The paths a `.select("a b c.d")` string selects. */
function pathsFromSelect(select) {
  return new Set(select.trim().split(/\s+/).filter(Boolean));
}

/** The paths a find-projection object selects, flattened to dotted form. */
function pathsFromProjection(projection) {
  const out = new Set();
  for (const [field, value] of Object.entries(projection)) {
    if (value === 1) {
      out.add(field);
      continue;
    }
    // The only computed field is `trucks`, a $map whose `in` rebuilds each truck.
    const truckShape = value?.$map?.in;
    assert.ok(truckShape, `${field} is neither an inclusion nor a $map`);
    for (const [sub, expr] of Object.entries(truckShape)) {
      const vehicleShape = expr?.$map?.in;
      if (!vehicleShape) {
        out.add(`${field}.${sub}`);
        continue;
      }
      for (const nested of Object.keys(vehicleShape)) {
        out.add(`${field}.${sub}.${nested}`);
      }
    }
  }
  return out;
}

test("the projection selects exactly the paths the field list does", () => {
  const expected = pathsFromSelect(OCCUPANCY_ENTRY_FIELDS);
  const actual = pathsFromProjection(OCCUPANCY_ENTRY_PROJECTION);

  const missing = [...expected].filter((p) => !actual.has(p));
  const extra = [...actual].filter((p) => !expected.has(p));

  assert.deepEqual(missing, [], `projection is MISSING paths the calculation reads: ${missing}`);
  assert.deepEqual(extra, [], `projection selects paths the field list does not: ${extra}`);
});

test("every truck survives — only its vehicle list is filtered", () => {
  // chooseBaselineEntry identifies the baseline container by `trucks.length === 0`.
  // Filtering trucks would let a submission whose trucks all read zero pass for
  // the baseline, which both loses that submission's waste and dates the
  // pre-baseline cutoff from the wrong record.
  const trucks = OCCUPANCY_ENTRY_PROJECTION.trucks;
  assert.ok(trucks.$map, "trucks must be a $map (every element kept), never a $filter");
  assert.equal(trucks.$filter, undefined, "trucks must not be filtered");

  const vehicles = trucks.$map.in.vehicles;
  assert.ok(vehicles.$map.input.$filter, "vehicles must be filtered before being mapped");
});

test("the vehicle filter drops exactly the rows that carry no volume", () => {
  const cond = OCCUPANCY_ENTRY_PROJECTION.trucks.$map.in.vehicles.$map.input.$filter.cond;
  // Must match the `Number(v?.actualVolume || 0) > 0` test that computeCellOccupancy
  // and hasTruckVolume both apply in Node — a looser filter here would drop a row
  // those two would have counted.
  assert.deepEqual(cond, { $gt: [{ $ifNull: ["$$v.actualVolume", 0] }, 0] });
});

test("a missing trucks array projects as empty, not null", () => {
  // A baseline container has no `trucks` at all. `$map` over a missing path
  // returns null, which `(entry.trucks || [])` tolerates but `trucks.length`
  // in chooseBaselineEntry does not — hence the $ifNull.
  assert.deepEqual(OCCUPANCY_ENTRY_PROJECTION.trucks.$map.input, { $ifNull: ["$trucks", []] });
});
