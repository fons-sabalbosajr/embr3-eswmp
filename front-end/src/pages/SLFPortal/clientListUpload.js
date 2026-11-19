// ── Per-hauler client list — export, parse, validate, merge ─────────────────
//
// A SECOND, NARROWER import than the baseline-wide Accredited Haulers upload.
// The difference is scope, and scope is what buys the extra rigour:
//
//   · The baseline upload carries whole haulers. It cannot know whether a
//     client named on a row is new or already stored, because the row's hauler
//     may itself be new — so its client rules have to stay lenient.
//   · This one runs INSIDE Edit Accredited Hauler. The hauler is already known
//     and its current client list is on screen, so every uploaded row can be
//     resolved against that list before anything is applied. A row that adds a
//     NEW client can therefore be held to exactly what the Add Client form
//     requires — a name, a type, and a province — while a row that merely
//     updates an existing client stays free to fill one field and leave the
//     rest blank.
//
// There is no Hauler Name column for the same reason: the hauler is the modal
// you are standing in, not something the file gets to assert. That removes the
// single biggest failure of the wide import (a misspelled hauler name silently
// creating a second hauler) from this path entirely.
//
// Pure: no hooks, no component state, no XLSX. The sheet-building and file
// reading live in the component; everything decidable lives here so it can be
// tested directly.

import {
  uploadHeaderKey,
  compactUploadHeaderKey,
  cleanUploadText,
  isEmptyUploadValue,
  isClientTypeHeader,
  isClientAddressHeader,
  isClientRegionHeader,
  isClientProvinceHeader,
  isClientMunicipalityHeader,
  normalizeHaulerClientType,
  HAULER_CLIENT_TYPES,
} from "./uploadHelpers.js";

export const isClientNameHeader = (header) => {
  const key = uploadHeaderKey(header);
  const compact = compactUploadHeaderKey(header);
  // Claimed by more specific rules first — "Client Type" and "Client Address"
  // both contain "client".
  if (isClientTypeHeader(key) || isClientAddressHeader(key)) return false;
  return (
    compact === "clientname" ||
    compact === "client" ||
    compact === "name" ||
    compact === "companyname" ||
    compact === "lguname" ||
    (key.includes("client") && key.includes("name")) ||
    key.includes("client")
  );
};

export const CLIENT_UPLOAD_COLUMNS = [
  {
    field: "clientName",
    label: "Client Name",
    required: true,
    format: "Text; the client's registered name",
    description:
      "Name of the LGU or company served by this hauler. This is the MATCHING KEY: a name already on this hauler updates that client, a new name adds one. Case-insensitive.",
    sample: "ABC Manufacturing",
    matches: isClientNameHeader,
  },
  {
    field: "clientType",
    label: "Client Type",
    required: true,
    format: "LGU or Private",
    description: "Whether the client is a local government unit or a private company.",
    sample: "Private",
    matches: isClientTypeHeader,
  },
  {
    field: "clientAddress",
    label: "Client Address",
    required: false,
    format: "Text",
    description:
      "Street or service address. Leave blank to keep the address already stored.",
    sample: "San Fernando, Pampanga",
    matches: isClientAddressHeader,
  },
  {
    field: "regionName",
    label: "Region",
    required: false,
    format: "Text; the region name",
    description: "Region the client is located in.",
    sample: "Region III (Central Luzon)",
    matches: isClientRegionHeader,
  },
  {
    field: "provinceName",
    label: "Province",
    required: false,
    format: "Text; the province name",
    description:
      "Province the client is located in. REQUIRED for a client being added — it is what classifies the client within or outside Region 3. Optional when updating a client that already has one.",
    sample: "Pampanga",
    matches: isClientProvinceHeader,
  },
  {
    field: "municipalityName",
    label: "City/Municipality",
    required: false,
    format: "Text; the city or municipality name",
    description: "City or municipality the client is located in.",
    sample: "San Fernando",
    matches: isClientMunicipalityHeader,
  },
];

/**
 * Header → field resolution order. MOST SPECIFIC FIRST, for the same reason the
 * hauler import needs one: "Client Name", "Client Type" and "Client Address" all
 * satisfy the loose client rule, so the order below — not the order of the
 * columns in the file — decides the mapping.
 */
export const CLIENT_UPLOAD_FIELD_PRIORITY = [
  "clientType",
  "clientAddress",
  "regionName",
  "provinceName",
  "municipalityName",
  "clientName",
];

export const resolveClientUploadField = (header) => {
  const key = uploadHeaderKey(header);
  if (!key) return null;
  for (const field of CLIENT_UPLOAD_FIELD_PRIORITY) {
    const column = CLIENT_UPLOAD_COLUMNS.find((item) => item.field === field);
    if (column?.matches?.(key)) return field;
  }
  return null;
};

/** One raw spreadsheet row → the client shape the hauler draft stores. */
export const parseClientUploadRow = (row = {}) => {
  const parsed = {};
  for (const [header, value] of Object.entries(row || {})) {
    const field = resolveClientUploadField(header);
    if (!field) continue;
    parsed[field] =
      field === "clientType"
        ? normalizeHaulerClientType(value)
        : cleanUploadText(value);
  }
  return parsed;
};

export const clientIdentity = (client) =>
  cleanUploadText(
    typeof client === "string" ? client : client?.clientName || client?.name,
  ).toLowerCase();

export const getClientUploadMissingColumns = (headers = []) => {
  const normalized = headers.map(uploadHeaderKey);
  return CLIENT_UPLOAD_COLUMNS.filter((column) => column.required)
    .filter((column) => !normalized.some((header) => column.matches(header)))
    .map((column) => column.label);
};

/**
 * Validate one parsed row against the hauler's CURRENT client list.
 *
 * `existingNames` is what makes the new-client province rule possible: the same
 * bar the Add Client form sets, applied only where that form would apply it.
 */
export const getClientUploadRowErrors = (row = {}, existingNames = new Set()) => {
  const errors = [];
  if (isEmptyUploadValue(row.clientName)) {
    errors.push("Client Name is required");
  }
  if (isEmptyUploadValue(row.clientType)) {
    errors.push("Client Type is required");
  } else if (!HAULER_CLIENT_TYPES.includes(normalizeHaulerClientType(row.clientType))) {
    errors.push("Client Type must be LGU or Private");
  }
  const identity = clientIdentity(row);
  const isNewClient = !!identity && !existingNames.has(identity);
  if (isNewClient && isEmptyUploadValue(row.provinceName)) {
    // Exactly the Add Client rule. An UPDATE is exempt: blank means "keep what
    // is stored", and the stored client already has its province.
    errors.push("Province is required for a new client");
  }
  return [...new Set(errors)];
};

/**
 * Classify every previewed row against the hauler's current clients, so the
 * portal user sees what the import will do before it touches the draft.
 *
 *   new       — this client is not on the hauler yet → it will be added
 *   update    — the name is already on the hauler → that client is updated
 *   duplicate — the same name appeared on an earlier row of this file; the rows
 *               are MERGED (later non-blank values win), never imported twice
 *   invalid   — the row failed validation and blocks the import
 */
export const annotateClientUploadRows = (rows = [], existingClients = []) => {
  const existingNames = new Set(
    (existingClients || []).map(clientIdentity).filter(Boolean),
  );
  const firstSeenRow = new Map();
  return (rows || []).map((row, index) => {
    const identity = clientIdentity(row);
    const rowNumber = row?._rowNumber ?? index + 2;
    const duplicateOfRow =
      identity && firstSeenRow.has(identity) ? firstSeenRow.get(identity) : null;
    if (identity && !firstSeenRow.has(identity)) firstSeenRow.set(identity, rowNumber);
    const errors = getClientUploadRowErrors(row, existingNames);
    const status = errors.length
      ? "invalid"
      : duplicateOfRow != null
        ? "duplicate"
        : existingNames.has(identity)
          ? "update"
          : "new";
    return {
      ...row,
      _rowNumber: rowNumber,
      _duplicateOfRow: duplicateOfRow,
      _errors: errors,
      _status: status,
    };
  });
};

export const summarizeClientUpload = (rows = []) => {
  const added = new Set();
  const updated = new Set();
  let invalid = 0;
  let duplicates = 0;
  (rows || []).forEach((row) => {
    if (row?._errors?.length) {
      invalid += 1;
      return;
    }
    if (row?._duplicateOfRow != null) duplicates += 1;
    const identity = clientIdentity(row);
    if (!identity) return;
    if (row._status === "update") updated.add(identity);
    else if (row._status === "new") added.add(identity);
  });
  return {
    total: (rows || []).length,
    valid: (rows || []).length - invalid,
    invalid,
    duplicates,
    newClients: added.size,
    updatedClients: updated.size,
  };
};

const CLIENT_FIELDS = CLIENT_UPLOAD_COLUMNS.map((column) => column.field);

/**
 * Merge validated rows into the hauler's client list.
 *
 * Field-wise and additive, the same contract as the wide import: a blank cell
 * leaves the stored value intact, a client absent from the file is untouched,
 * and nothing is ever removed. Removal stays a deliberate act in the Clients
 * table, where it can be seen.
 *
 * The stored `key` is preserved on an update so the table does not re-key and
 * lose its row identity mid-edit.
 */
export const mergeClientListUpload = (existingClients = [], rows = []) => {
  const merged = (existingClients || []).map((client) =>
    typeof client === "string" ? { clientName: client, clientType: "" } : { ...client },
  );
  const indexByName = new Map();
  merged.forEach((client, index) => {
    const identity = clientIdentity(client);
    if (identity && !indexByName.has(identity)) indexByName.set(identity, index);
  });

  (rows || []).forEach((row, rowIndex) => {
    const identity = clientIdentity(row);
    if (!identity) return;
    const patch = {};
    CLIENT_FIELDS.forEach((field) => {
      const value = field === "clientType" ? normalizeHaulerClientType(row[field]) : row[field];
      if (!isEmptyUploadValue(value)) patch[field] = value;
    });
    const existingIndex = indexByName.get(identity);
    if (existingIndex != null) {
      // The STORED spelling of the name wins on an update. Matching is
      // case/space-insensitive, so the only "renames" reachable here are casing
      // and whitespace drift in a spreadsheet — a real correction like
      // "ABC Manufacturng" → "ABC Manufacturing" does not match at all and
      // arrives as a new client. Letting the uploaded spelling overwrite the
      // stored one would therefore only ever churn the key nothing else asked
      // to change. Renaming stays a deliberate act in the Clients table.
      const { clientName: _uploadedName, ...rest } = patch;
      merged[existingIndex] = { ...merged[existingIndex], ...rest };
      return;
    }
    // Rows are validated first ("Client Type is required"), so `patch` carries
    // the chosen type; no default is supplied.
    const created = {
      key: `client-upload-${Date.now()}-${rowIndex}`,
      ...patch,
    };
    indexByName.set(identity, merged.length);
    merged.push(created);
  });

  return merged;
};

/**
 * One hauler → the client rows that describe it, keyed by CLIENT_UPLOAD_COLUMNS
 * field names.
 *
 * The export and the uploader are the same format by construction, so a portal
 * user can export this hauler's clients, correct them in Excel, and upload the
 * file straight back.
 */
export const buildClientExportRows = (hauler = {}) => {
  const stored = Array.isArray(hauler.privateSectorClients)
    ? hauler.privateSectorClients
    : hauler.privateSectorClients
      ? [hauler.privateSectorClients]
      : [];
  return stored
    .map((entry) => (typeof entry === "string" ? { clientName: entry } : entry || {}))
    .filter((client) => String(client.clientName || "").trim())
    .map((client) => ({
      clientName: String(client.clientName || "").trim(),
      clientType: client.clientType || "",
      clientAddress: client.clientAddress || client.address || "",
      // The *Name fields first: a PSGC code is an identifier, not a place, and
      // writing one into the sheet would upload back as a nonsense province.
      regionName: client.regionName || client.region || "",
      provinceName: client.provinceName || client.province || "",
      municipalityName: client.municipalityName || client.municipality || "",
    }));
};

export default {
  CLIENT_UPLOAD_COLUMNS,
  parseClientUploadRow,
  annotateClientUploadRows,
  summarizeClientUpload,
  mergeClientListUpload,
  buildClientExportRows,
  getClientUploadMissingColumns,
  getClientUploadRowErrors,
};
