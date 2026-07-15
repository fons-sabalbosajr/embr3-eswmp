// ── SLF Portal — Excel/CSV upload parsing & validation ──
// Header matching, value coercion, and per-column / per-row validation for
// the disposal-truck and hauler upload flows. All pure: no hooks, no state.

export const uploadHeaderKey = (header) =>
  String(header || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const compactUploadHeaderKey = (header) =>
  uploadHeaderKey(header).replace(/[^a-z0-9]/g, "");

export const isHaulerNameHeader = (header) => {
  const key = uploadHeaderKey(header);
  const compact = compactUploadHeaderKey(header);
  return (
    compact === "haulername" ||
    compact === "accreditedhauler" ||
    compact === "accreditedhaulername" ||
    (key.includes("hauler") && key.includes("name")) ||
    (key.includes("hauler") && !key.includes("truck"))
  );
};

export const isNumberOfTrucksHeader = (header) => {
  const key = uploadHeaderKey(header);
  const compact = compactUploadHeaderKey(header);
  return (
    compact === "numberoftrucks" ||
    compact === "nooftrucks" ||
    compact === "truckcount" ||
    compact === "totaltrucks" ||
    compact === "numbertrucks" ||
    (key.includes("truck") && (key.includes("number") || key.includes("no.") || key.includes("no ") || key.includes("count") || key.includes("total")))
  );
};

export const isClientsHeader = (header) => {
  const compact = compactUploadHeaderKey(header);
  const key = uploadHeaderKey(header);
  return (
    compact === "clients" ||
    compact === "privatesectorclients" ||
    compact === "client" ||
    (key.includes("client") && !key.includes("hauler"))
  );
};

export const UPLOAD_REQUIRED_FIELDS = {
  truck: [
    {
      field: "disposalTicketNo",
      label: "Ticket No.",
      matches: (key) => key.includes("ticket") || key.includes("disposal"),
    },
    {
      field: "hauler",
      label: "Hauler",
      matches: (key) => key.includes("hauler"),
    },
    {
      field: "plateNumber",
      label: "Plate No.",
      matches: (key) => key.includes("plate"),
    },
    {
      // Truck Capacity is REQUIRED for a final submission (see wasteGenValidation),
      // so a disposal upload missing it can never be submitted. Reject it at upload
      // time — both the column and every row's value — instead of letting the user
      // import rows that will be blocked later.
      field: "truckCapacity",
      label: "Truck Capacity",
      matches: (key) =>
        key.includes("capacity") && !key.includes("unit") && !key.includes("vehicle"),
    },
    {
      field: "actualVolume",
      label: "Actual Volume",
      matches: (key) => key.includes("volume") && !key.includes("unit"),
    },
    {
      field: "wasteType",
      label: "Waste Type",
      matches: (key) => key.includes("waste") && key.includes("type"),
    },
  ],
  hauler: [
    {
      field: "haulerName",
      label: "Hauler Name",
      matches: isHaulerNameHeader,
    },
    {
      field: "numberOfTrucks",
      label: "Number of Trucks",
      matches: isNumberOfTrucksHeader,
    },
  ],
};

export const isEmptyUploadValue = (value) =>
  value === undefined ||
  value === null ||
  (typeof value === "string" && value.trim() === "");

export const cleanUploadText = (value) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

export const parseUploadNumber = (value) => {
  if (isEmptyUploadValue(value)) return null;
  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

export const normalizeUploadHeaders = (headers) =>
  headers.map(uploadHeaderKey);

export const getUploadMissingColumns = (headers, type) => {
  const normalizedHeaders = normalizeUploadHeaders(headers);
  return (UPLOAD_REQUIRED_FIELDS[type] || [])
    .filter(
      (field) => !normalizedHeaders.some((header) => field.matches(header)),
    )
    .map((field) => field.label);
};

export const getUploadRowErrors = (row, type) => {
  const errors = (UPLOAD_REQUIRED_FIELDS[type] || [])
    .filter((field) => isEmptyUploadValue(row[field.field]))
    .map((field) => field.label);
  const actualVolume = parseUploadNumber(row.actualVolume);
  const truckCapacity = parseUploadNumber(row.truckCapacity);
  const numberOfTrucks = parseUploadNumber(row.numberOfTrucks);
  const capacity = parseUploadNumber(row.capacity);

  if (type === "truck") {
    if (actualVolume == null || Number.isNaN(actualVolume) || actualVolume <= 0) {
      errors.push("Actual Volume must be greater than 0");
    }
    // Required now — a blank capacity is caught by the required-field check above,
    // so this only has to reject a present-but-invalid value.
    if (!isEmptyUploadValue(row.truckCapacity) && (truckCapacity == null || Number.isNaN(truckCapacity) || truckCapacity <= 0)) {
      errors.push("Truck Capacity must be greater than 0");
    }
  }

  if (type === "hauler") {
    if (numberOfTrucks == null || Number.isNaN(numberOfTrucks) || numberOfTrucks <= 0) {
      errors.push("Number of Trucks must be greater than 0");
    }
    if (!isEmptyUploadValue(row.capacity) && (Number.isNaN(capacity) || capacity <= 0)) {
      errors.push("Capacity must be greater than 0");
    }
  }

  return [...new Set(errors)];
};
