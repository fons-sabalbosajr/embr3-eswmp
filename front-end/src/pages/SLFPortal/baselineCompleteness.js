// ── Baseline completeness: what is missing, and applying the fixes ───────────
//
// WHY THIS IS ITS OWN MODULE
// --------------------------
// The Portal already warned about incomplete hauler CLIENTS, computed inline in
// the Data Entry pane. It never looked at the hauler itself, so a hauler with no
// office address — and, after a bulk baseline update, that is most of them, since
// Office Address is an optional upload column whose blank cells mean "keep what is
// stored" and there was nothing stored — was invisible. The record read as
// complete because nothing had been asked of it.
//
// The rule now lives in one pure function so the warning panel, the completion
// modal and the server's VERA facts (server/utils/veraPortalFacts, which derives
// the same picture from the database) cannot drift into disagreeing about what
// "incomplete" means.
//
// REQUIRED vs RECOMMENDED
// -----------------------
// Required — data something downstream actually consumes and reports wrong
//   without: a client's Province classifies it within / outside Region 3, its
//   Municipality feeds served-LGU counts, its Type splits LGU from private.
// Recommended — real gaps that break nothing today: the hauler's office address
//   and the client's street address are contact detail EMB asks for but no
//   aggregate is computed from.
//
// Kept apart so the panel can be honest about which is which. Rolling them
// together would either overstate the urgency of an address or bury a missing
// province among fifty of them.
//
// ADDRESSABILITY
// --------------
// Every row carries the INDEX of the record it describes, because the completion
// modal writes fixes straight back into the hauler draft. A row is identified by
// position, not by name: a name is exactly the thing that may be blank or about
// to change, so keying on it would lose the record it was meant to fix.
//
// Pure: no hooks, no component state.

const text = (value) => String(value ?? "").trim();

/**
 * One hauler's clients, normalized to objects, IN STORED ORDER.
 *
 * `privateSectorClients` only. That is the canonical list in the portal draft —
 * normalizeHaulerRecord folds a record's `clients` into it on load, and each
 * vehicle's `selectedClients` is a selection FROM this list rather than a
 * separate source — so it is both the complete set and the one an edit can be
 * written back to. (The server's copy of this rule pools all three, because a
 * raw DataSLF document straight out of Mongo has not been through that
 * normalization.)
 *
 * Not de-duplicated, deliberately: the index is the address of the record, and
 * two clients of one hauler sharing a name is itself a problem worth showing.
 */
export const haulerClients = (hauler = {}) => {
  const raw = Array.isArray(hauler.privateSectorClients)
    ? hauler.privateSectorClients
    : hauler.privateSectorClients
      ? [hauler.privateSectorClients]
      : [];
  return raw.map((client) =>
    typeof client === "string" ? { clientName: client } : client || {},
  );
};

/**
 * What one CLIENT record is missing.
 * `province` / `municipality` accept either the PSGC code or the resolved name —
 * a record that carries only the code is still located, just not yet readable.
 */
export const clientGaps = (client = {}) => {
  const required = [];
  const recommended = [];
  if (!text(client.clientName || client.name)) required.push("Client Name");
  if (!text(client.clientType)) required.push("Client Type");
  if (!text(client.provinceName || client.province)) required.push("Province");
  if (!text(client.municipalityName || client.municipality)) required.push("Municipality");
  if (!text(client.clientAddress || client.address)) recommended.push("Client Address");
  return { required, recommended };
};

/**
 * What one HAULER record is missing, itself and through its clients.
 *
 * "No clients" is required rather than recommended: the disposal upload resolves
 * every trip through Hauler → Client, so a hauler with an empty client list
 * cannot have a single disposal entry attributed to it — the upload will reject
 * all of them, which is exactly the failure a system-generated file runs into.
 */
export const haulerGaps = (hauler = {}) => {
  const required = [];
  const recommended = [];
  const name = text(hauler.haulerName || hauler.name);
  if (!name) required.push("Hauler Name");
  const clients = haulerClients(hauler);
  if (clients.length === 0) required.push("Clients");
  if (!text(hauler.officeAddress)) recommended.push("Office Address");
  const vehicles = Array.isArray(hauler.vehicles) ? hauler.vehicles : [];
  if (vehicles.length === 0 && !text(hauler.plateNumber)) recommended.push("Vehicle / Plate Number");
  return { name, required, recommended, clients };
};

/**
 * The whole baseline's gaps, flattened into rows a panel or an editor can render
 * directly.
 *
 * One row per record that is missing something — the hauler itself, then each of
 * its incomplete clients — so the operator reads a work list rather than a count.
 */
export const summarizeBaselineCompleteness = (haulers = []) => {
  const rows = [];
  let haulersMissingAddress = 0;
  let haulersWithoutClients = 0;
  let clientsMissingLocation = 0;
  let clientsMissingAddress = 0;

  (Array.isArray(haulers) ? haulers : []).forEach((hauler, haulerIndex) => {
    const gaps = haulerGaps(hauler);
    const label = gaps.name || "(unnamed hauler)";
    if (gaps.recommended.includes("Office Address")) haulersMissingAddress += 1;
    if (gaps.required.includes("Clients")) haulersWithoutClients += 1;
    if (gaps.required.length || gaps.recommended.length) {
      rows.push({
        id: `hauler-${haulerIndex}`,
        kind: "hauler",
        haulerIndex,
        clientIndex: null,
        hauler: label,
        client: "",
        required: gaps.required,
        recommended: gaps.recommended,
      });
    }
    gaps.clients.forEach((client, clientIndex) => {
      const clientGap = clientGaps(client);
      if (clientGap.required.some((field) => field === "Province" || field === "Municipality")) {
        clientsMissingLocation += 1;
      }
      if (clientGap.recommended.includes("Client Address")) clientsMissingAddress += 1;
      if (clientGap.required.length || clientGap.recommended.length) {
        rows.push({
          id: `client-${haulerIndex}-${clientIndex}`,
          kind: "client",
          haulerIndex,
          clientIndex,
          hauler: label,
          client: text(client.clientName || client.name) || "(unnamed client)",
          required: clientGap.required,
          recommended: clientGap.recommended,
        });
      }
    });
  });

  // Required first: a missing province misreports a figure, a missing address
  // does not, and the list is read from the top.
  rows.sort((a, b) => b.required.length - a.required.length);

  return {
    rows,
    total: rows.length,
    requiredCount: rows.filter((row) => row.required.length).length,
    recommendedOnlyCount: rows.filter((row) => !row.required.length && row.recommended.length).length,
    haulersMissingAddress,
    haulersWithoutClients,
    clientsMissingLocation,
    clientsMissingAddress,
  };
};

// The fields the completion editor may write, per row kind. A whitelist rather
// than a spread: the editor's own draft state carries UI keys alongside the
// record's, and none of those belong on a saved hauler or client.
const HAULER_PATCH_FIELDS = ["officeAddress"];
const CLIENT_PATCH_FIELDS = [
  "clientName",
  "clientType",
  "clientAddress",
  "region",
  "regionName",
  "province",
  "provinceName",
  "municipality",
  "municipalityName",
];

const pickPatch = (patch = {}, fields) => {
  const out = {};
  fields.forEach((field) => {
    const value = patch[field];
    // Blank means "leave what is stored" — the same contract every import in the
    // portal follows. An editor row the operator skipped must not wipe the one
    // field that record already had.
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      out[field] = typeof value === "string" ? value.trim() : value;
    }
  });
  return out;
};

/**
 * Apply the completion editor's patches to a hauler list.
 *
 * Returns a NEW list; nothing is mutated in place. Patches are keyed by the row
 * `id` from summarizeBaselineCompleteness, and a row whose indices no longer
 * resolve is skipped rather than throwing — the fleet can change under a modal
 * that is open, and a stale patch must not take a save down with it.
 */
export const applyBaselineCompletionPatches = (haulers = [], patches = {}) => {
  const list = (Array.isArray(haulers) ? haulers : []).map((hauler) => ({ ...hauler }));
  const rowsById = new Map(
    summarizeBaselineCompleteness(list).rows.map((row) => [row.id, row]),
  );

  Object.entries(patches || {}).forEach(([id, patch]) => {
    const row = rowsById.get(id);
    if (!row) return;
    const hauler = list[row.haulerIndex];
    if (!hauler) return;

    if (row.kind === "hauler") {
      const applied = pickPatch(patch, HAULER_PATCH_FIELDS);
      if (Object.keys(applied).length) list[row.haulerIndex] = { ...hauler, ...applied };
      return;
    }

    const applied = pickPatch(patch, CLIENT_PATCH_FIELDS);
    if (!Object.keys(applied).length) return;
    const clients = haulerClients(hauler);
    const target = clients[row.clientIndex];
    if (!target) return;
    const next = clients.map((client, index) =>
      index === row.clientIndex ? { ...client, ...applied } : client,
    );
    list[row.haulerIndex] = { ...hauler, privateSectorClients: next };
  });

  return list;
};

/** How many of the editor's rows the operator has actually filled anything into. */
export const countCompletionEdits = (patches = {}) =>
  Object.values(patches || {}).filter((patch) =>
    Object.values(patch || {}).some((value) => String(value ?? "").trim() !== ""),
  ).length;

export default {
  haulerClients,
  clientGaps,
  haulerGaps,
  summarizeBaselineCompleteness,
  applyBaselineCompletionPatches,
  countCompletionEdits,
};
