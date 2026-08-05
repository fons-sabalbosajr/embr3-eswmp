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

export const isDisposalDateHeader = (header) => {
  const key = uploadHeaderKey(header);
  const compact = compactUploadHeaderKey(header);
  return compact === "disposaldate" || (key.includes("disposal") && key.includes("date"));
};

export const isWasteVolumeHeader = (header) => {
  const key = uploadHeaderKey(header);
  const compact = compactUploadHeaderKey(header);
  return (
    compact === "wastevolume" ||
    compact === "actualvolume" ||
    (key.includes("volume") && !key.includes("unit") && !key.includes("capacity"))
  );
};

export const isUnitOfMeasurementHeader = (header) => {
  const key = uploadHeaderKey(header);
  const compact = compactUploadHeaderKey(header);
  return (
    compact === "unitofmeasurement" ||
    compact === "uom" ||
    compact === "volumeunit" ||
    (key.includes("unit") && !key.includes("capacity"))
  );
};

export const isCellOrDisposalAreaHeader = (header) => {
  const key = uploadHeaderKey(header);
  const compact = compactUploadHeaderKey(header);
  return (
    compact === "cellordisposalarea" ||
    compact === "disposalcell" ||
    compact === "cellname" ||
    compact === "cell" ||
    key.includes("disposal area") ||
    (key.includes("cell") && !key.includes("capacity") && !key.includes("unit"))
  );
};

export const DISPOSAL_UPLOAD_COLUMNS = [
  {
    field: "disposalDate",
    label: "Disposal Date",
    required: true,
    format: "YYYY-MM-DD, MM/DD/YYYY, or an Excel date value",
    sample: "2026-07-24",
    description: "Date of the disposal trip. All rows in one import must use one disposal date.",
    matches: isDisposalDateHeader,
  },
  {
    field: "hauler",
    label: "Hauler",
    required: true,
    format: "Exact accredited hauler name, case-insensitive",
    sample: "XYZ Hauling Services",
    description: "Hauler must be accredited under the selected SLF.",
    matches: (key) => isHaulerNameHeader(key) || uploadHeaderKey(key) === "hauler",
  },
  {
    field: "client",
    label: "Client",
    required: true,
    format: "Exact client name, ID, or code when supported; case-insensitive",
    sample: "ABC Manufacturing",
    description: "Required client of the hauler. The client must be assigned to this hauler under the selected SLF.",
    matches: isClientsHeader,
  },
  {
    field: "wasteType",
    label: "Waste Type",
    required: true,
    format: "Residual, Hazardous Waste, or Treated Hazardous Waste",
    sample: "Residual",
    description: "Waste classification for this disposal trip.",
    matches: (key) => key.includes("waste") && key.includes("type"),
  },
  {
    field: "actualVolume",
    label: "Waste Volume",
    required: true,
    format: "Positive number; commas are allowed",
    sample: "12.5",
    description: "Actual volume or weight disposed for this trip.",
    matches: isWasteVolumeHeader,
  },
  {
    field: "actualVolumeUnit",
    label: "Unit of Measurement",
    required: true,
    format: "tons, m3, or m³",
    sample: "tons",
    description: "Must match the selected SLF's declared baseline unit.",
    matches: isUnitOfMeasurementHeader,
  },
  {
    field: "cellName",
    label: "Cell or Disposal Area",
    required: true,
    format: "Current operational cell label for the selected SLF",
    sample: "Cell 1",
    description: "Must match an available disposal cell under the selected SLF.",
    matches: isCellOrDisposalAreaHeader,
  },
  {
    field: "disposalTicketNo",
    label: "Ticket Number",
    required: true,
    format: "Unique text or number",
    sample: "DT-2026-0001",
    description: "Unique ticket/reference number for this disposal trip.",
    matches: (key) => key.includes("ticket") || key.includes("disposal ticket"),
  },
  {
    field: "plateNumber",
    label: "Plate Number",
    required: true,
    format: "Registered vehicle plate number",
    sample: "ABC-1234",
    description: "Plate number of the truck used for this trip.",
    matches: (key) => key.includes("plate"),
  },
  {
    field: "truckCapacity",
    label: "Truck Capacity",
    required: true,
    format: "Positive number; same unit as Unit of Measurement",
    sample: "15",
    description: "Registered capacity of the truck for upload-sourced rows.",
    matches: (key) =>
      key.includes("capacity") && !key.includes("unit") && !key.includes("vehicle"),
  },
  {
    field: "hazWasteCode",
    label: "Hazardous Waste Code",
    required: false,
    format: "Comma-separated codes; required for Treated Hazardous Waste",
    sample: "K301",
    description: "Use only when the waste type requires hazardous waste codes.",
    matches: (key) => key.includes("haz") || key.includes("code"),
  },
];

export const HAULER_UPLOAD_COLUMNS = [
  {
    field: "haulerName",
    label: "Hauler Name",
    required: true,
    description: "Full name of the accredited hauler.",
    sample: "XYZ Hauling Services",
    matches: isHaulerNameHeader,
  },
  {
    field: "numberOfTrucks",
    label: "Number of Trucks",
    required: true,
    description: "Total number of registered trucks.",
    sample: "2",
    matches: isNumberOfTrucksHeader,
  },
  { field: "officeAddress", label: "Office Address", required: false, description: "Office address of the hauler.", sample: "San Fernando, Pampanga" },
  { field: "plateNumber", label: "Plate Number", required: false, description: "Plate number of the vehicle.", sample: "ABC-1234" },
  { field: "vehicleType", label: "Vehicle Type", required: false, description: "Vehicle type.", sample: "Dump Truck" },
  { field: "capacity", label: "Capacity", required: false, description: "Vehicle capacity in the selected unit.", sample: "15" },
  { field: "capacityUnit", label: "Capacity Unit", required: false, description: "tons, m3, or m³.", sample: "tons" },
  { field: "privateSectorClients", label: "Clients", required: false, description: "Comma-separated client names served by this hauler.", sample: "ABC Manufacturing, DEF Foods", matches: isClientsHeader },
  { field: "clientType", label: "Client Type", required: false, description: "LGU or Private for the listed client.", sample: "Private" },
  { field: "clientAddress", label: "Client Address", required: false, description: "Client address or service location.", sample: "San Fernando, Pampanga" },
];

export const UPLOAD_COLUMNS = {
  truck: DISPOSAL_UPLOAD_COLUMNS,
  hauler: HAULER_UPLOAD_COLUMNS,
};

export const UPLOAD_REQUIRED_FIELDS = {
  truck: DISPOSAL_UPLOAD_COLUMNS.filter((column) => column.required),
  hauler: HAULER_UPLOAD_COLUMNS.filter((column) => column.required),
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
      errors.push("Waste Volume must be greater than 0");
    }
    // Required — the missing/blank case is flagged by the required-column check;
    // this rejects a present-but-invalid value (null/zero/negative/NaN).
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

const normalizeComparableText = (value) =>
  cleanUploadText(value).toLowerCase();

const clientLookupValues = (client) => {
  if (typeof client === "string") return [client];
  if (!client || typeof client !== "object") return [];
  return [
    client.clientName,
    client.name,
    client.clientCode,
    client.code,
    client.clientId,
    client.id,
    client._id,
    client.key,
  ];
};

export const findUploadHauler = (haulers = [], haulerName) => {
  const target = normalizeComparableText(haulerName);
  if (!target) return null;
  const matches = (haulers || []).filter(
    (hauler) => normalizeComparableText(hauler?.haulerName || hauler?.name) === target,
  );
  return matches.length === 1 ? matches[0] : { ambiguous: matches.length > 1, matches };
};

export const findUploadClientForHauler = (hauler, clientValue) => {
  const target = normalizeComparableText(clientValue);
  if (!target || !hauler || hauler.ambiguous) return null;
  const clientPools = [
    ...(Array.isArray(hauler.privateSectorClients) ? hauler.privateSectorClients : []),
    ...(Array.isArray(hauler.clients) ? hauler.clients : []),
    ...(Array.isArray(hauler.vehicles)
      ? hauler.vehicles.flatMap((vehicle) => vehicle.selectedClients || [])
      : []),
  ];
  const matches = clientPools.filter((client) =>
    clientLookupValues(client).some((value) => normalizeComparableText(value) === target),
  );
  const activeMatches = matches.filter(
    (client) => String(client?.status || client?.active || "active").toLowerCase() !== "inactive" && client?.isActive !== false,
  );
  if (activeMatches.length !== 1) {
    return { ambiguous: activeMatches.length > 1, inactiveOnly: matches.length > 0 && activeMatches.length === 0, matches: activeMatches };
  }
  return activeMatches[0];
};

export const getUploadRelationshipErrors = (row, haulers = []) => {
  if (!row || typeof row !== "object") return [];
  const rowLabel = row._rowNumber ? `Row ${row._rowNumber}` : "Row";
  const errors = [];
  const hauler = findUploadHauler(haulers, row.hauler);
  if (!hauler) {
    errors.push(`${rowLabel} — Hauler "${row.hauler || ""}" is not assigned under this SLF.`);
    return errors;
  }
  if (hauler.ambiguous) {
    errors.push(`${rowLabel} — Hauler "${row.hauler || ""}" is duplicated or ambiguous under this SLF.`);
    return errors;
  }
  const client = findUploadClientForHauler(hauler, row.client);
  if (!client) {
    errors.push(`${rowLabel} — Client "${row.client || ""}" is not assigned to hauler "${row.hauler || ""}" under this SLF.`);
    return errors;
  }
  if (client.ambiguous) {
    errors.push(`${rowLabel} — Client "${row.client || ""}" is duplicated or ambiguous for hauler "${row.hauler || ""}" under this SLF.`);
    return errors;
  }
  if (client.inactiveOnly) {
    errors.push(`${rowLabel} — Client "${row.client || ""}" is inactive for hauler "${row.hauler || ""}" under this SLF.`);
    return errors;
  }
  return [];
};
