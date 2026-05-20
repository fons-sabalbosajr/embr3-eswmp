export const normalizeUnitLabel = (unit) => String(unit || "m³").replace("m3", "m³");

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
