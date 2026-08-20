// ── SLF Portal — Excel/CSV upload parsing & validation ──
// Header matching, value coercion, and per-column / per-row validation for
// the disposal-truck and hauler upload flows. All pure: no hooks, no state.
//
// UPLOAD_COLUMNS is the SINGLE SOURCE OF TRUTH for both halves of an import:
// the downloadable sample template is generated from it, and the uploaded file
// is parsed and validated against the very same definitions. Nothing about the
// accepted columns may be declared anywhere else.

// Explicit extension so this module also resolves under plain Node (the
// `node --test` suite in __tests__), not only through Vite's resolver.
import { normalizeUnit } from "./helpers.js";

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

export const isClientTypeHeader = (header) => {
  const key = uploadHeaderKey(header);
  return key.includes("client") && key.includes("type");
};

export const isClientAddressHeader = (header) => {
  const key = uploadHeaderKey(header);
  return key.includes("client") && key.includes("address");
};

// ── Client location ──────────────────────────────────────────────────────────
// The three fields the Add Client form captures alongside the name and the type.
// They are not decoration: the server classifies a client within / outside
// Region 3 from its PROVINCE NAME and reports a client with no province or
// municipality as incomplete, so the bulk path has to be able to carry them or
// it can only ever produce records the form itself would refuse.
//
// The old hauler EXPORT already emitted "Region" / "Province" /
// "City/Municipality" columns, which is why these matchers accept the bare
// labels as well as the "Client …" ones.
export const isClientRegionHeader = (header) => {
  const key = uploadHeaderKey(header);
  return /\bregion\b/.test(key);
};

export const isClientProvinceHeader = (header) => {
  const key = uploadHeaderKey(header);
  return key.includes("province");
};

// `\bcity\b`, never a plain substring test: "Capacity" ENDS in "city", so a
// substring match would resolve the Capacity column to the municipality. The
// explicit capacity guard keeps that true even if the word boundary is lost to
// a header like "Truck-Capacity".
export const isClientMunicipalityHeader = (header) => {
  const key = uploadHeaderKey(header);
  if (key.includes("capacity")) return false;
  return key.includes("municipal") || /\bcity\b/.test(key);
};

// "Office Address" AND the hauler export's "Hauler Office Address" — matched
// BEFORE the hauler-name rule, which claims any header containing "hauler".
export const isOfficeAddressHeader = (header) => {
  const key = uploadHeaderKey(header);
  if (isClientAddressHeader(key)) return false;
  return key.includes("office") || key.includes("address");
};

export const isCapacityUnitHeader = (header) => {
  const key = uploadHeaderKey(header);
  return key.includes("capacity") && key.includes("unit");
};

export const isCapacityHeader = (header) => {
  const key = uploadHeaderKey(header);
  return key.includes("capacity") && !key.includes("unit");
};

export const HAULER_CLIENT_TYPES = ["Private", "LGU"];

/** "private" / "lgu" / "LGU " → the exact enum value the client record stores. */
export const normalizeHaulerClientType = (value) => {
  const text = cleanUploadText(value);
  if (!text) return "";
  const match = HAULER_CLIENT_TYPES.find(
    (type) => type.toLowerCase() === text.toLowerCase(),
  );
  return match || text;
};

export const HAULER_UPLOAD_COLUMNS = [
  {
    field: "haulerName",
    label: "Hauler Name",
    required: true,
    format: "Text; the accredited hauler's registered name",
    description:
      "Full name of the accredited hauler. This is the MATCHING KEY: a name already on the baseline updates that hauler, a new name adds one. Case-insensitive.",
    sample: "XYZ Hauling Services",
    matches: isHaulerNameHeader,
  },
  {
    field: "numberOfTrucks",
    label: "Number of Trucks",
    required: true,
    format: "Whole number greater than 0",
    description: "Total number of registered trucks for this hauler.",
    sample: "2",
    matches: isNumberOfTrucksHeader,
  },
  {
    field: "officeAddress",
    label: "Office Address",
    required: false,
    format: "Text",
    description: "Office address of the hauler. Leave blank to keep the stored address.",
    sample: "San Fernando, Pampanga",
    matches: isOfficeAddressHeader,
  },
  {
    field: "plateNumber",
    label: "Plate Number",
    required: false,
    format: "Registered vehicle plate number",
    description:
      "Plate number of ONE vehicle. Repeat the Hauler Name on another row to add a second vehicle; the plate is what identifies the vehicle on an update.",
    sample: "ABC-1234",
    matches: (key) => uploadHeaderKey(key).includes("plate"),
  },
  {
    field: "vehicleType",
    label: "Vehicle Type",
    required: false,
    format: "Text, e.g. Dump Truck / Compactor",
    description: "Vehicle type for the plate number on this row.",
    sample: "Dump Truck",
    matches: (key) => {
      const normalized = uploadHeaderKey(key);
      return normalized.includes("vehicle") || normalized.includes("type");
    },
  },
  {
    field: "capacity",
    label: "Capacity",
    required: false,
    format: "Positive number; commas are allowed",
    description: "Vehicle capacity for the plate number on this row.",
    sample: "15",
    matches: isCapacityHeader,
  },
  {
    field: "capacityUnit",
    label: "Capacity Unit",
    required: false,
    format: "tons, m3, or m³",
    description: "Unit of the Capacity value. Defaults to the SLF's baseline unit when blank.",
    sample: "tons",
    matches: isCapacityUnitHeader,
  },
  {
    field: "privateSectorClients",
    label: "Clients",
    required: false,
    format: "Comma-separated client names",
    description: "Client names served by this hauler. Existing clients are matched by name and updated.",
    sample: "ABC Manufacturing, DEF Foods",
    matches: isClientsHeader,
  },
  {
    field: "clientType",
    label: "Client Type",
    required: false,
    format: "LGU or Private",
    description: "Applies to the clients listed on this row.",
    sample: "Private",
    matches: isClientTypeHeader,
  },
  {
    field: "clientAddress",
    label: "Client Address",
    required: false,
    format: "Text",
    description: "Address or service location of the clients listed on this row.",
    sample: "San Fernando, Pampanga",
    matches: isClientAddressHeader,
  },
  {
    field: "clientRegion",
    label: "Client Region",
    required: false,
    format: "Text; the region name",
    description: "Region of the clients listed on this row.",
    sample: "Region III (Central Luzon)",
    matches: isClientRegionHeader,
  },
  {
    field: "clientProvince",
    label: "Client Province",
    required: false,
    format: "Text; the province name",
    description:
      "Province of the clients listed on this row. The Add Client form requires it — it is what classifies a client within or outside Region 3 — so supply it for every NEW client. Leave it blank to keep the province already stored.",
    sample: "Pampanga",
    matches: isClientProvinceHeader,
  },
  {
    field: "clientMunicipality",
    label: "Client City/Municipality",
    required: false,
    format: "Text; the city or municipality name",
    description: "City or municipality of the clients listed on this row.",
    sample: "San Fernando",
    matches: isClientMunicipalityHeader,
  },
];

/**
 * Header → field resolution order for the hauler import.
 *
 * MOST SPECIFIC FIRST. Several headers legitimately satisfy more than one
 * matcher — "Hauler Office Address" matches both the office-address and the
 * hauler-name rule, "Client Type" matches both the client and the vehicle-type
 * rule, and every "Client <location>" header also satisfies the bare Clients
 * rule — so the order below, not the order of the columns in the file, is what
 * decides the mapping. Reading it any other way is how an uploaded office
 * address used to land in Hauler Name and a Client Type in Vehicle Type.
 */
export const HAULER_UPLOAD_FIELD_PRIORITY = [
  "numberOfTrucks",
  "clientType",
  "clientAddress",
  "clientRegion",
  "clientProvince",
  "clientMunicipality",
  "officeAddress",
  "haulerName",
  "privateSectorClients",
  "plateNumber",
  "vehicleType",
  "capacityUnit",
  "capacity",
];

export const resolveHaulerUploadField = (header) => {
  const key = uploadHeaderKey(header);
  if (!key) return null;
  for (const field of HAULER_UPLOAD_FIELD_PRIORITY) {
    const column = HAULER_UPLOAD_COLUMNS.find((item) => item.field === field);
    if (column?.matches?.(key)) return field;
  }
  return null;
};

/**
 * One raw spreadsheet row → the Portal's hauler-upload shape.
 *
 * The ONLY hauler header→field mapping in the app. The preview, the row
 * validators and the sample template all read the same HAULER_UPLOAD_COLUMNS,
 * so a column can never mean one thing in the template and another in the
 * parser.
 */
export const parseHaulerUploadRow = (row = {}, { fallbackUnit = "m³" } = {}) => {
  const parsed = {};
  for (const [header, value] of Object.entries(row || {})) {
    const field = resolveHaulerUploadField(header);
    if (!field) continue;
    if (field === "numberOfTrucks" || field === "capacity") {
      parsed[field] = parseUploadNumber(value);
    } else if (field === "capacityUnit") {
      parsed[field] = normalizeUnit(value || fallbackUnit);
    } else if (field === "clientType") {
      parsed[field] = normalizeHaulerClientType(value);
    } else if (field === "privateSectorClients") {
      parsed[field] = cleanUploadText(value)
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    } else {
      parsed[field] = cleanUploadText(value);
    }
  }
  return parsed;
};

export const UPLOAD_COLUMNS = {
  truck: DISPOSAL_UPLOAD_COLUMNS,
  hauler: HAULER_UPLOAD_COLUMNS,
};

export const UPLOAD_REQUIRED_FIELDS = {
  truck: DISPOSAL_UPLOAD_COLUMNS.filter((column) => column.required),
  hauler: HAULER_UPLOAD_COLUMNS.filter((column) => column.required),
};

/**
 * Resolve an uploaded / preview-edited cell label to the facility's canonical
 * cell. Accepts the option's value, its configured cell name, or its display
 * label, all case/whitespace-insensitively.
 *
 * `cellIndex` is the canonical reference the import writes; `null` means "not an
 * available cell under this SLF", which is what both the parser and the preview
 * editor use to flag the row. Kept here — with the rest of the pure upload
 * logic — so a cell typed into the preview is resolved by exactly the same rule
 * as one that arrived in the file.
 */
export const resolveUploadCell = (activeCellOptions = [], value) => {
  const comparable = cleanUploadText(value).toLowerCase();
  const match = (activeCellOptions || []).find((option) =>
    [option?.value, option?.cellName, option?.label]
      .filter(Boolean)
      .map((candidate) => cleanUploadText(candidate).toLowerCase())
      .includes(comparable),
  );
  return {
    cellName: match?.value || cleanUploadText(value),
    cellIndex: typeof match?.cellIndex === "number" ? match.cellIndex : null,
    cellType: match?.cellType || "",
  };
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
    // Both are enum-constrained on the stored record. Catching them here keeps a
    // typo in the file from reaching the baseline save as an unusable value.
    if (
      !isEmptyUploadValue(row.capacityUnit) &&
      !["tons", "m3", "m³"].includes(cleanUploadText(row.capacityUnit).toLowerCase())
    ) {
      errors.push("Capacity Unit must be tons, m3, or m³");
    }
    // Client Type and Client Province are what the Add Client form REQUIRES, but
    // they are validated here only when the row actually supplies them.
    //
    // An upload is an upsert whose blank cells mean "keep what is stored", so a
    // partial update that re-lists an existing client to correct one field must
    // not be forced to restate that client's whole location. A genuinely new
    // client uploaded without a province is reported on the admin side as an
    // incomplete client instead — see GET /hauler-clients.
    if (
      (row.privateSectorClients || []).length > 0 &&
      !isEmptyUploadValue(row.clientType) &&
      !HAULER_CLIENT_TYPES.includes(normalizeHaulerClientType(row.clientType))
    ) {
      errors.push("Client Type must be LGU or Private");
    }
  }

  return [...new Set(errors)];
};

/**
 * Hauler identity — the ONE key this workflow matches on.
 *
 * `accreditedHaulers` is an embedded array with `_id: false` (see
 * server/models/DataSLF.js), so the hauler NAME is the authoritative
 * identifier, exactly as `mergeHaulersByName` and the server-side relationship
 * checks already treat it. Normalized here so casing/spacing can never split
 * one hauler into two.
 */
export const haulerUploadIdentity = (hauler = {}) =>
  cleanUploadText(hauler?.haulerName || hauler?.name).toLowerCase();

// A row describes ONE vehicle under a hauler, so two rows are the same record
// only when both the hauler and the plate repeat.
//
// A row with NO plate carries no vehicle at all — it is a clients-only
// continuation row, the shape Export Hauler Data writes when a hauler has more
// client groups than vehicles — so those are told apart by their client list
// instead. Keying them on the empty plate alone reported every clients-only row
// after the first as a duplicate of it.
const haulerUploadRowIdentity = (row = {}) => {
  const plate = cleanUploadText(row?.plateNumber).toLowerCase();
  if (plate) return `${haulerUploadIdentity(row)}||plate:${plate}`;
  const clients = (Array.isArray(row?.privateSectorClients) ? row.privateSectorClients : [])
    .map((client) => cleanUploadText(client).toLowerCase())
    .filter(Boolean)
    .sort()
    .join(",");
  return `${haulerUploadIdentity(row)}||clients:${clients}`;
};

/**
 * Classify every previewed hauler row against the baseline haulers ALREADY
 * loaded in the portal, so the admin sees what the import will do before it
 * touches anything:
 *
 *   new       — hauler name is not on the baseline yet → it will be added
 *   update    — hauler name is on the baseline → that record is updated in place
 *   duplicate — the same hauler+plate appeared on an earlier row in this file;
 *               the rows are MERGED (later non-blank values win), never imported
 *               twice — this only reports it so an unintended repeat is visible
 *   invalid   — the row failed validation and blocks the import
 *
 * Pure and derived: it never mutates the preview rows, so re-running it after
 * an inline edit or a row deletion always yields the current truth.
 */
export const annotateHaulerUploadRows = (rows = [], existingHaulers = []) => {
  const existingNames = new Set(
    (existingHaulers || []).map(haulerUploadIdentity).filter(Boolean),
  );
  const firstSeenRow = new Map();
  return (rows || []).map((row, index) => {
    const name = haulerUploadIdentity(row);
    const identity = haulerUploadRowIdentity(row);
    const rowNumber = row?._rowNumber ?? index + 2;
    const duplicateOfRow =
      name && firstSeenRow.has(identity) ? firstSeenRow.get(identity) : null;
    if (name && !firstSeenRow.has(identity)) firstSeenRow.set(identity, rowNumber);
    const status = row?._errors?.length
      ? "invalid"
      : duplicateOfRow != null
        ? "duplicate"
        : existingNames.has(name)
          ? "update"
          : "new";
    return { ...row, _rowNumber: rowNumber, _duplicateOfRow: duplicateOfRow, _status: status };
  });
};

/**
 * Counts for the preview header. New/updated are counted per HAULER, not per
 * row — several rows can describe several vehicles of the same hauler — which
 * is what makes "3 new haulers" mean the same thing as the baseline table will
 * show after the import.
 */
export const summarizeHaulerUpload = (rows = []) => {
  const newHaulers = new Set();
  const updatedHaulers = new Set();
  let invalid = 0;
  let duplicates = 0;
  (rows || []).forEach((row) => {
    if (row?._errors?.length) {
      invalid += 1;
      return;
    }
    if (row?._duplicateOfRow != null) duplicates += 1;
    const name = haulerUploadIdentity(row);
    if (!name) return;
    if (row?._status === "update") updatedHaulers.add(name);
    else if (row?._status === "new") newHaulers.add(name);
  });
  return {
    total: (rows || []).length,
    valid: (rows || []).length - invalid,
    invalid,
    duplicates,
    newHaulers: newHaulers.size,
    updatedHaulers: updatedHaulers.size,
  };
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
  // NOTHING matched → null, so getUploadRelationshipErrors reports "not assigned
  // under this SLF". Returning the `{ ambiguous: false, matches: [] }` stub made
  // that object truthy, so an unknown hauler passed the upload preview and only
  // failed later at submit.
  if (matches.length === 0) return null;
  return matches.length === 1 ? matches[0] : { ambiguous: true, matches };
};

export const findUploadClientForHauler = (hauler, clientValue) => {
  const target = normalizeComparableText(clientValue);
  if (!target || !hauler || hauler.ambiguous) return null;
  // One client is routinely stored in THREE places on the same hauler:
  // privateSectorClients, clients, and each vehicle's selectedClients. Counting
  // those copies as separate records made every uploaded row report "Client is
  // duplicated or ambiguous" and blocked the whole import. Collapse the pool by
  // normalized client name first — the same identity key the server-side
  // relationship check and GET /hauler-clients already use — so only genuinely
  // different clients can be ambiguous.
  const clientPools = [];
  const seenClients = new Set();
  [
    ...(Array.isArray(hauler.privateSectorClients) ? hauler.privateSectorClients : []),
    ...(Array.isArray(hauler.clients) ? hauler.clients : []),
    ...(Array.isArray(hauler.vehicles)
      ? hauler.vehicles.flatMap((vehicle) => vehicle.selectedClients || [])
      : []),
  ].forEach((client) => {
    const identity = normalizeComparableText(
      typeof client === "string" ? client : client?.clientName || client?.name,
    );
    if (!identity || seenClients.has(identity)) return;
    seenClients.add(identity);
    clientPools.push(client);
  });
  const matches = clientPools.filter((client) =>
    clientLookupValues(client).some((value) => normalizeComparableText(value) === target),
  );
  // Same rule as findUploadHauler: an unknown client must be null (→ "not
  // assigned to hauler"), not a truthy stub that silently passes validation and
  // is then stored as the row's selectedClient.
  if (matches.length === 0) return null;
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
