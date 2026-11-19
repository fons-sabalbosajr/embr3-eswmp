// ── Accredited Haulers table: the filter logic ───────────────────────────────
//
// Split out of haulerColumns.jsx so it can be tested. The column file holds JSX
// and is therefore unreachable from the `node --test` suite; everything decidable
// about a filter — which options a column offers, and which rows a chosen option
// keeps — lives here as plain functions instead.
//
// The rule these all share: a filter list built only from the values that ARE
// present can never select the records MISSING them, and on this table those are
// the records that matter most — the haulers with no office address, no vehicle
// or no clients. Every list that can be empty therefore gets an explicit
// "(none)" option, keyed by the NONE sentinel.

// Spelled with a leading space so it cannot collide with a real hauler, vehicle
// type or client name — those are all trimmed before comparison.
export const NONE = " none";

export const text = (value) => String(value ?? "").trim();

// A PSGC identifier, not a place. The address cascade stores the CODE in
// `region` / `province` / `municipality` and the readable name alongside it in
// `regionName` / `provinceName` / `municipalityName`. Records saved before the
// name fields were resolved carry only the code, and "0354010000" where a
// municipality belongs reads as corrupted data rather than as missing data — so a
// bare code counts as ABSENT, both for display and for the completeness filter.
export const isCodeLikeValue = (value) => /^[0-9]{4,}$/.test(text(value));

export const placeName = (name, code) => {
  const resolved = text(name);
  if (resolved) return resolved;
  const raw = text(code);
  return isCodeLikeValue(raw) ? "" : raw;
};

/** The vehicles of a hauler, in whichever shape the record stores them. */
export const vehiclesOf = (hauler = {}) =>
  hauler.vehicles?.length > 0
    ? hauler.vehicles
    : hauler.plateNumber || hauler.vehicleType
      ? [
          {
            plateNumber: hauler.plateNumber,
            vehicleType: hauler.vehicleType,
            capacity: hauler.capacity,
            capacityUnit: hauler.capacityUnit,
          },
        ]
      : [];

/**
 * The clients of a hauler, normalized to objects.
 *
 * `privateSectorClients` ONLY — deliberately narrower than the pool the disposal
 * upload resolves against (which also folds in `clients` and each vehicle's
 * `selectedClients`). This is the list the Clients column renders, and a filter
 * must select exactly what the operator can see in the cell.
 */
export const clientsOf = (hauler = {}) => {
  const raw = Array.isArray(hauler.privateSectorClients)
    ? hauler.privateSectorClients
    : hauler.privateSectorClients
      ? [hauler.privateSectorClients]
      : [];
  return raw.map((client) =>
    typeof client === "string" ? { clientName: client } : client || {},
  );
};

export const clientTypesOf = (hauler) => [
  // A missing type is shown as such, not as "Private" (Client Type is required).
  ...new Set(clientsOf(hauler).map((client) => text(client.clientType) || "Not set")),
];

/** The address a client row displays, or "" when it has none. */
export const clientAddressOf = (client = {}) =>
  text(client.clientAddress || client.address) ||
  [
    placeName(client.municipalityName, client.municipality),
    placeName(client.provinceName, client.province),
    placeName(client.regionName, client.region),
  ]
    .filter(Boolean)
    .join(", ");

/**
 * Distinct values across the loaded haulers, as AntD filter options.
 *
 * Sorted alphabetically rather than by frequency — a filter list is read by
 * scanning for a name you already have in mind, not by importance. `noneLabel`
 * adds the "(none)" option, and only when some record actually lacks a value, so
 * a complete fleet is not offered a filter that would match nothing.
 */
export const distinctFilters = (haulers, extract, noneLabel) => {
  const values = new Set();
  let anyMissing = false;
  (haulers || []).forEach((hauler) => {
    const found = extract(hauler).map(text).filter(Boolean);
    if (found.length === 0) anyMissing = true;
    found.forEach((value) => values.add(value));
  });
  const options = [...values]
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ text: value, value }));
  return anyMissing && noneLabel
    ? [...options, { text: noneLabel, value: NONE }]
    : options;
};

/** Fleet-size bands. A numeric column is filtered by band, not by exact count. */
export const TRUCK_BUCKETS = [
  { text: "None encoded", value: "0", match: (n) => !n },
  { text: "1 – 5", value: "1-5", match: (n) => n >= 1 && n <= 5 },
  { text: "6 – 10", value: "6-10", match: (n) => n >= 6 && n <= 10 },
  { text: "More than 10", value: "10+", match: (n) => n > 10 },
];

/**
 * How many trucks a hauler has.
 *
 * The declared `numberOfTrucks` wins when it is a usable number, and the count of
 * encoded vehicles is the fallback — a hauler whose fleet was typed in vehicle by
 * vehicle without the count being set must not band as "None encoded".
 */
export const truckCount = (hauler) => {
  const declared = Number(hauler?.numberOfTrucks);
  return Number.isFinite(declared) && declared > 0 ? declared : vehiclesOf(hauler).length;
};

// ── The predicates, one per filterable column ────────────────────────────────
// Each takes the chosen filter value and a row, exactly as AntD's `onFilter`
// does. Several values chosen in one column are OR-ed by AntD; different columns
// AND together.

export const filterByHaulerName = (value, record) =>
  value === NONE ? !text(record?.haulerName) : text(record?.haulerName) === value;

export const filterByOfficeAddress = (value, record) =>
  value === "missing" ? !text(record?.officeAddress) : !!text(record?.officeAddress);

export const filterByTruckBucket = (value, record) =>
  TRUCK_BUCKETS.find((bucket) => bucket.value === value)?.match(truckCount(record)) ?? true;

export const filterByVehicleType = (value, record) => {
  const types = vehiclesOf(record).map((vehicle) => text(vehicle.vehicleType)).filter(Boolean);
  return value === NONE ? types.length === 0 : types.includes(value);
};

export const filterByClientName = (value, record) => {
  const names = clientsOf(record).map((client) => text(client.clientName)).filter(Boolean);
  return value === NONE ? names.length === 0 : names.includes(value);
};

// A hauler serving both types shows under BOTH filters, which is correct: the
// question is "does this hauler serve any LGU", not "is it LGU-only".
export const filterByClientType = (value, record) => {
  const types = clientTypesOf(record);
  return value === NONE ? types.length === 0 : types.includes(value);
};

export const filterByClientAddress = (value, record) => {
  const clients = clientsOf(record);
  if (value === NONE) return clients.length === 0;
  if (clients.length === 0) return false;
  const missing = clients.filter((client) => !clientAddressOf(client)).length;
  return value === "incomplete" ? missing > 0 : missing === 0;
};

export default {
  NONE,
  distinctFilters,
  TRUCK_BUCKETS,
  truckCount,
  vehiclesOf,
  clientsOf,
  clientTypesOf,
  clientAddressOf,
  placeName,
  filterByHaulerName,
  filterByOfficeAddress,
  filterByTruckBucket,
  filterByVehicleType,
  filterByClientName,
  filterByClientType,
  filterByClientAddress,
};
