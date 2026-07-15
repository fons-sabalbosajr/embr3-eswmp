// ── SLF Portal — hauler / vehicle / client normalization ──
// Pure record shaping: normalize incoming hauler payloads into the Portal's
// canonical shape, merge duplicates by name, and clean records for submit.
// No hooks, no component state.

import { normalizeUnit } from "./helpers";

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
      clientType: "Private",
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
    clientType: rest.clientType || "Private",
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
      if (!vehicleMap.has(plateKey)) vehicleMap.set(plateKey, vehicle);
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
      if (!clientMap.has(clientKey)) clientMap.set(clientKey, client);
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
      numberOfTrucks: Math.max(
        Number(existing.numberOfTrucks || 0),
        Number(normalized.numberOfTrucks || 0),
        vehicleMap.size,
      ),
    });
  });
  return Array.from(merged.values());
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
