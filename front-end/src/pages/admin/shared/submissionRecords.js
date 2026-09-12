import api from "../../../api";

export const normalizeUnitLabel = (unit) => String(unit || "m³").replace("m3", "m³");

// The server caps `limit` at 100, so asking for more silently returns 100 and a
// loop keyed to the requested size would never advance.
export const SUBMISSION_PAGE_SIZE = 100;

/**
 * Every submission matching `params`, fetched one page at a time.
 *
 * Reading this endpoint without a `limit` returns the whole matched set in one
 * response. With `includeTrucks` each record is ~36 KB, so the unscoped read ran
 * to tens of MB, overran the MongoDB socket timeout, and failed with a 500 —
 * no partial result, just a dead panel. The server now caps unpaginated reads
 * for exactly that reason, which means any caller that genuinely needs the full
 * set has to page through it rather than ask for it whole.
 *
 * Pass the same scoping params you would have sent otherwise (`search`,
 * `slfGenerator`, `includeDummy`, …); `mode: "list"` is implied and `page`/
 * `limit` are supplied here.
 *
 * @param {object} params  extra query params for /data-slf
 * @param {{signal?: AbortSignal}} [options]  forwarded to axios, so an unmounting
 *   caller can cancel mid-loop instead of finishing every remaining page
 * @returns {Promise<object[]>} the raw records, in server order
 */
// How many page requests are allowed in flight at once.
//
// The loop used to be strictly sequential: every page waited for the one before
// it, so the wall time was `pages × round-trip` even though page 3 never depends
// on page 2. The first response carries `total`, which is all that is needed to
// know how many pages remain — so the rest are fetched together.
//
// Bounded rather than unbounded: firing 50 requests at once would queue behind
// the browser's per-host connection limit anyway while burying every other
// request on the page (and hitting the API rate limiter). Six keeps the pipe
// full without monopolising it.
const PAGE_CONCURRENCY = 6;

export async function fetchAllSubmissions(params = {}, options = {}) {
  // Bounded so a server that keeps reporting a larger `total` than it returns
  // can never spin this forever.
  const maxPages = 200;
  const query = (page) =>
    api.get("/data-slf", {
      params: { mode: "list", page, limit: SUBMISSION_PAGE_SIZE, ...params },
      ...options,
    });
  const batchOf = (data) =>
    Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];

  const first = await query(1);
  const firstBatch = batchOf(first.data);
  const total = Number(first.data?.total || 0);
  // A short first page means there is nothing after it; an absent `total` means
  // the endpoint is not reporting one, so fall back to walking until a short page.
  if (firstBatch.length < SUBMISSION_PAGE_SIZE) return firstBatch;

  if (total > 0) {
    const lastPage = Math.min(maxPages, Math.ceil(total / SUBMISSION_PAGE_SIZE));
    // Indexed by page so the result keeps the server's order regardless of which
    // request settles first — callers rely on this list being chronological.
    const pages = new Array(lastPage);
    pages[0] = firstBatch;
    const remaining = [];
    for (let page = 2; page <= lastPage; page += 1) remaining.push(page);
    for (let i = 0; i < remaining.length; i += PAGE_CONCURRENCY) {
      const slice = remaining.slice(i, i + PAGE_CONCURRENCY);
      const responses = await Promise.all(slice.map((page) => query(page)));
      responses.forEach((res, j) => {
        pages[slice[j] - 1] = batchOf(res.data);
      });
    }
    return pages.flatMap((batch) => batch || []);
  }

  // No `total` reported — walk sequentially, as before.
  const rows = [...firstBatch];
  for (let page = 2; page <= maxPages; page += 1) {
    const { data } = await query(page);
    const batch = batchOf(data);
    rows.push(...batch);
    if (batch.length < SUBMISSION_PAGE_SIZE) break;
  }
  return rows;
}

export const getTruckVehicles = (truck) =>
  truck?.vehicles?.length
    ? truck.vehicles
    : truck?.plateNumber || truck?.truckCapacity != null
      ? [
          {
            plateNumber: truck.plateNumber,
            capacity: truck.truckCapacity,
            capacityUnit: truck.truckCapacityUnit,
          },
        ]
      : [];

export const normalizeSubmissionRecord = (record) => ({
  ...record,
  trucks: (record.trucks || []).map((truck) => {
    const vehicles = getTruckVehicles(truck);
    const first = vehicles[0] || {};
    return {
      ...truck,
      hauler: truck.hauler || truck.haulerName || "",
      plateNumber: truck.plateNumber || first.plateNumber || "",
      truckCapacity: truck.truckCapacity ?? first.capacity ?? null,
      truckCapacityUnit:
        truck.truckCapacityUnit ||
        first.capacityUnit ||
        truck.actualVolumeUnit ||
        "m³",
    };
  }),
});

export const getTruckPlateText = (truck) => {
  const plates = getTruckVehicles(truck)
    .map((vehicle) => vehicle.plateNumber)
    .filter(Boolean);
  return plates.length ? plates.join(", ") : "—";
};

export const getTruckCapacityText = (truck) => {
  const vehicles = getTruckVehicles(truck);
  if (vehicles.length > 1) {
    return vehicles
      .map((vehicle) => {
        const capacity = vehicle.capacity ?? vehicle.truckCapacity;
        if (capacity == null) return null;
        return `${capacity} ${normalizeUnitLabel(vehicle.capacityUnit || truck.truckCapacityUnit || "m³")}`;
      })
      .filter(Boolean)
      .join(", ") || "—";
  }
  const first = vehicles[0] || {};
  const capacity = first.capacity ?? truck.truckCapacity;
  return capacity != null
    ? `${capacity} ${normalizeUnitLabel(first.capacityUnit || truck.truckCapacityUnit || "m³")}`
    : "—";
};

export const getSubmissionVolumeSummary = (record) => {
  const volumeByUnit = (record.trucks || []).reduce((acc, truck) => {
    if (truck.actualVolume == null) return acc;
    const unit = normalizeUnitLabel(truck.actualVolumeUnit || "tons");
    acc[unit] = (acc[unit] || 0) + Number(truck.actualVolume || 0);
    return acc;
  }, {});
  return Object.entries(volumeByUnit)
    .map(([unit, volume]) => `${volume.toLocaleString()} ${unit}`)
    .join(", ");
};
