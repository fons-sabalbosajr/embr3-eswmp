// ── SLF Portal — Constants & Utilities ──

export const EMPTY_TRUCK = {
  disposalTicketNo: "",
  hauler: "",
  plateNumber: "",
  truckCapacity: null,
  truckCapacityUnit: "m³",
  vehicles: [],
  actualVolume: null,
  actualVolumeUnit: "m³",
  wasteType: undefined,
  hazWasteCode: [],
};

export const KNOWN_TRANSPORT_KEYS = new Set([
  "disposalTicketNo",
  "hauler",
  "plateNumber",
  "truckCapacity",
  "actualVolume",
  "wasteType",
  "hazWasteCode",
]);

export const EMPTY_VEHICLE = {
  plateNumber: "",
  vehicleType: "",
  capacity: null,
  capacityUnit: "m³",
};

export const EMPTY_HAULER = {
  haulerName: "",
  numberOfTrucks: null,
  officeAddress: "",
  officeRegion: "",
  officeProvince: "",
  officeCity: "",
  officeBarangay: "",
  vehicles: [],
  privateSectorClients: [],
};

/**
 * Retry helper: calls fn up to `retries` times with exponential backoff.
 * Skips retries when browser is offline. Respects AbortSignal.
 */
export function withRetry(fn, { retries = 3, baseDelay = 1000, signal } = {}) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      if (signal?.aborted)
        return reject(new DOMException("Aborted", "AbortError"));
      fn()
        .then(resolve)
        .catch((err) => {
          if (err?.name === "AbortError" || err?.code === "ERR_CANCELED")
            return reject(err);
          if (n >= retries || !navigator.onLine) return reject(err);
          setTimeout(() => attempt(n + 1), baseDelay * 2 ** n);
        });
    };
    attempt(0);
  });
}
