// ── SLF Portal — hauler / vehicle / client normalization ──
// Pure record shaping: normalize incoming hauler payloads into the Portal's
// canonical shape, merge duplicates by name, and clean records for submit.
// No hooks, no component state.

// Explicit extension so this module also resolves under plain Node (the
// `node --test` suite in __tests__), not only through Vite's resolver.
import { normalizeUnit } from "./helpers.js";

export const normalizeVehicleRecord = (vehicle = {}, fallbackUnit = "m³") => ({
  plateNumber: vehicle.plateNumber || vehicle.plateNo || vehicle.plate || "",
  vehicleType: vehicle.vehicleType || vehicle.type || "",
  capacity: vehicle.capacity ?? vehicle.truckCapacity ?? null,
  capacityUnit: normalizeUnit(
    vehicle.capacityUnit || vehicle.truckCapacityUnit || fallbackUnit,
  ),
  selectedClients: Array.isArray(vehicle.selectedClients)
    ? vehicle.selectedClients
    : [],
});

export const normalizeClientRecord = (client, index = 0) => {
  if (typeof client === "string") {
    return {
      key: index,
      clientName: client,
      // Unknown, not "Private": Client Type is required and must be chosen.
      clientType: "",
      region: "",
      province: "",
      municipality: "",
    };
  }
  return { key: client?.key ?? client?._id ?? index, ...(client || {}) };
};

export const cleanClientForSubmit = (client, index = 0) => {
  const normalized = normalizeClientRecord(client, index);
  const { key, ...rest } = normalized;
  return {
    clientName: rest.clientName || "",
    // Sent as chosen. A blank is refused by the baseline save (CLIENT_TYPE_REQUIRED)
    // rather than silently stored as "Private".
    clientType: rest.clientType || "",
    // Kept in the submit payload — this whitelist used to strip it, so a Client
    // Address entered or bulk-uploaded never reached the server.
    clientAddress: rest.clientAddress || rest.address || "",
    region: rest.region || "",
    regionName: rest.regionName || "",
    province: rest.province || "",
    provinceName: rest.provinceName || "",
    municipality: rest.municipality || "",
    municipalityName: rest.municipalityName || "",
  };
};

export const normalizeHaulerRecord = (hauler = {}, index = 0, fallbackUnit = "m³") => {
  let vehicles = Array.isArray(hauler.vehicles)
    ? hauler.vehicles.map((vehicle) =>
        normalizeVehicleRecord(vehicle, fallbackUnit),
      )
    : [];
  if (
    vehicles.length === 0 &&
    (hauler.plateNumber ||
      hauler.plateNo ||
      hauler.vehicleType ||
      hauler.capacity != null)
  ) {
    vehicles = [normalizeVehicleRecord(hauler, fallbackUnit)];
  }
  const clients = Array.isArray(hauler.privateSectorClients)
    ? hauler.privateSectorClients
    : hauler.privateSectorClients
      ? [hauler.privateSectorClients]
      : Array.isArray(hauler.clients)
        ? hauler.clients
        : [];
  return {
    key: hauler.key || hauler._id || `${Date.now()}-${index}`,
    ...hauler,
    haulerName: hauler.haulerName || hauler.name || "",
    numberOfTrucks: hauler.numberOfTrucks || vehicles.length || null,
    vehicles,
    privateSectorClients: clients.map(normalizeClientRecord),
  };
};

// A value the incoming record does not actually carry. Used by mergeRecordFields
// so "not supplied" can never overwrite "already stored".
const isBlankValue = (value) =>
  value === undefined ||
  value === null ||
  value === "" ||
  (Array.isArray(value) && value.length === 0);

/**
 * Field-wise merge of two records describing the SAME entity — the same vehicle
 * (matched by plate) or the same client (matched by name).
 *
 * The later record supplies UPDATES; every field it does not carry leaves the
 * stored value intact. This is what makes a bulk upload of, say, only Truck
 * Capacity update the capacity without blanking the vehicle type, the client
 * details or anything else on that record.
 *
 * Previously a collision was resolved by KEEPING the first record and dropping the
 * second outright, so an uploaded capacity / client address for an already-known
 * plate or client name was silently discarded — the upload reported success and
 * the values were gone on the next load.
 */
const mergeRecordFields = (existing = {}, incoming = {}) => {
  const merged = { ...existing };
  Object.entries(incoming).forEach(([field, value]) => {
    if (!isBlankValue(value)) merged[field] = value;
  });
  // Keep the row identity the list already renders with.
  if (existing.key !== undefined) merged.key = existing.key;
  return merged;
};

export const mergeHaulersByName = (haulers = [], fallbackUnit = "m³") => {
  const merged = new Map();
  haulers.forEach((hauler, index) => {
    const normalized = normalizeHaulerRecord(hauler, index, fallbackUnit);
    const nameKey =
      normalized.haulerName.trim().toLowerCase() || `hauler-${index}`;
    const existing = merged.get(nameKey);
    if (!existing) {
      merged.set(nameKey, normalized);
      return;
    }
    const vehicleMap = new Map(
      (existing.vehicles || []).map((vehicle, vehicleIndex) => [
        (vehicle.plateNumber || `vehicle-${vehicleIndex}`).trim().toLowerCase(),
        vehicle,
      ]),
    );
    (normalized.vehicles || []).forEach((vehicle, vehicleIndex) => {
      const plateKey = (vehicle.plateNumber || `new-${vehicleIndex}`)
        .trim()
        .toLowerCase();
      vehicleMap.set(
        plateKey,
        vehicleMap.has(plateKey)
          ? mergeRecordFields(vehicleMap.get(plateKey), vehicle)
          : vehicle,
      );
    });
    const clientMap = new Map(
      (existing.privateSectorClients || []).map((client, clientIndex) => [
        (client.clientName || `client-${clientIndex}`).trim().toLowerCase(),
        client,
      ]),
    );
    (normalized.privateSectorClients || []).forEach((client, clientIndex) => {
      const clientKey = (client.clientName || `new-client-${clientIndex}`)
        .trim()
        .toLowerCase();
      clientMap.set(
        clientKey,
        clientMap.has(clientKey)
          ? mergeRecordFields(clientMap.get(clientKey), client)
          : client,
      );
    });
    const primaryVehicle = vehicleMap.values().next().value || {};
    merged.set(nameKey, {
      ...existing,
      ...normalized,
      key: existing.key,
      haulerName: normalized.haulerName || existing.haulerName || "",
      officeAddress: normalized.officeAddress || existing.officeAddress || "",
      plateNumber:
        normalized.plateNumber ||
        existing.plateNumber ||
        primaryVehicle.plateNumber ||
        "",
      vehicleType:
        normalized.vehicleType ||
        existing.vehicleType ||
        primaryVehicle.vehicleType ||
        "",
      capacity:
        normalized.capacity ?? existing.capacity ?? primaryVehicle.capacity ?? null,
      capacityUnit:
        normalized.capacityUnit ||
        existing.capacityUnit ||
        primaryVehicle.capacityUnit ||
        fallbackUnit,
      vehicles: Array.from(vehicleMap.values()),
      privateSectorClients: Array.from(clientMap.values()),
      // The LATER record supplies the update, so an upload that corrects a
      // hauler's fleet DOWNWARD (5 → 3) applies. Taking the max of both
      // records made the count a high-water mark that no re-upload could
      // lower. It is still floored at the number of distinct vehicles, which
      // is a fact about the merged record rather than a stale figure.
      numberOfTrucks: Math.max(
        Number(normalized.numberOfTrucks || existing.numberOfTrucks || 0),
        vehicleMap.size,
      ),
    });
  });
  return Array.from(merged.values());
};

/**
 * One stored hauler → the rows that describe it in the UPLOAD layout.
 *
 * Keys are HAULER_UPLOAD_COLUMNS field names, so "Export Hauler Data" can write
 * the export under the uploader's own headers and the file it produces is by
 * construction a file the uploader accepts — download, correct it in Excel,
 * upload it back.
 *
 * SAME SHAPE THE UPLOADER PARSES: one row = one vehicle, hauler-level fields
 * repeated on every row of that hauler (Number of Trucks is validated per row,
 * so a continuation row that left it blank would fail its own re-import), and
 * clients comma-separated in a single cell. Clients that share a type, address,
 * region, province and city/municipality travel together in one row; a hauler
 * with more distinct client groups than vehicles simply continues on further
 * rows, which the duplicate check recognizes as clients-only rows rather than
 * repeats (see haulerUploadRowIdentity).
 */
export const buildHaulerExportRows = (hauler = {}, fallbackUnit = "m³") => {
  const vehicles = hauler.vehicles?.length
    ? hauler.vehicles
    : hauler.plateNumber || hauler.vehicleType || hauler.capacity != null
      ? [
          {
            plateNumber: hauler.plateNumber,
            vehicleType: hauler.vehicleType,
            capacity: hauler.capacity,
            capacityUnit: hauler.capacityUnit,
          },
        ]
      : [];
  const storedClients = Array.isArray(hauler.privateSectorClients)
    ? hauler.privateSectorClients
    : hauler.privateSectorClients
      ? [hauler.privateSectorClients]
      : [];
  const groups = new Map();
  storedClients.forEach((entry) => {
    const client = typeof entry === "string" ? { clientName: entry } : entry || {};
    const clientName = String(client.clientName || "").trim();
    if (!clientName) return;
    const group = {
      clientType: client.clientType || "",
      clientAddress: client.clientAddress || client.address || "",
      // The *Name fields first: a PSGC code is an identifier, not a place, and
      // printing one into the sheet would upload back as a nonsense province.
      clientRegion: client.regionName || client.region || "",
      clientProvince: client.provinceName || client.province || "",
      clientMunicipality: client.municipalityName || client.municipality || "",
    };
    const groupKey = Object.values(group).join("||").toLowerCase();
    const existing = groups.get(groupKey);
    if (existing) existing.names.push(clientName);
    else groups.set(groupKey, { ...group, names: [clientName] });
  });
  const clientGroups = Array.from(groups.values());
  const rowCount = Math.max(vehicles.length, clientGroups.length, 1);
  return Array.from({ length: rowCount }, (_, index) => {
    const vehicle = vehicles[index] || {};
    const group = clientGroups[index] || null;
    return {
      haulerName: hauler.haulerName || "",
      numberOfTrucks: hauler.numberOfTrucks || vehicles.length || "",
      officeAddress: hauler.officeAddress || "",
      plateNumber: vehicle.plateNumber || "",
      vehicleType: vehicle.vehicleType || "",
      capacity: vehicle.capacity ?? "",
      capacityUnit:
        vehicle.capacity == null
          ? ""
          : normalizeUnit(vehicle.capacityUnit || fallbackUnit),
      privateSectorClients: group ? group.names.join(", ") : "",
      clientType: group ? group.clientType : "",
      clientAddress: group ? group.clientAddress : "",
      clientRegion: group ? group.clientRegion : "",
      clientProvince: group ? group.clientProvince : "",
      clientMunicipality: group ? group.clientMunicipality : "",
    };
  });
};

export const cleanVehicleForSubmit = (vehicle = {}, fallbackUnit = "m³") => {
  const normalized = normalizeVehicleRecord(vehicle, fallbackUnit);
  return {
    plateNumber: normalized.plateNumber || "",
    vehicleType: normalized.vehicleType || "",
    capacity:
      normalized.capacity == null || Number.isNaN(Number(normalized.capacity))
        ? null
        : Number(normalized.capacity),
    capacityUnit: normalizeUnit(normalized.capacityUnit || fallbackUnit),
    selectedClients: (normalized.selectedClients || []).map(
      cleanClientForSubmit,
    ),
  };
};

export const cleanHaulerForSubmit = (hauler = {}, index = 0, fallbackUnit = "m³") => {
  const normalized = normalizeHaulerRecord(hauler, index, fallbackUnit);
  const cleanedVehicles = (normalized.vehicles || [])
    .map((vehicle) => cleanVehicleForSubmit(vehicle, fallbackUnit))
    .filter(
      (vehicle) =>
        vehicle.plateNumber ||
        vehicle.vehicleType ||
        vehicle.capacity != null ||
        (vehicle.selectedClients || []).length > 0,
    );
  const cleanedClients = (normalized.privateSectorClients || []).map(
    cleanClientForSubmit,
  );
  const primaryVehicle = cleanedVehicles[0] || {};

  return {
    haulerName: normalized.haulerName || "",
    numberOfTrucks: Math.max(
      Number(normalized.numberOfTrucks || 0),
      cleanedVehicles.length,
    ) || null,
    officeAddress: normalized.officeAddress || "",
    plateNumber: primaryVehicle.plateNumber || "",
    vehicleType: primaryVehicle.vehicleType || "",
    capacity: primaryVehicle.capacity ?? null,
    capacityUnit: normalizeUnit(primaryVehicle.capacityUnit || fallbackUnit),
    vehicles: cleanedVehicles,
    privateSectorClients: cleanedClients,
  };
};
