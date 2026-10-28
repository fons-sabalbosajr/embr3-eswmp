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

// The ONE definition of "this client has an address" — the same function the
// Accredited Haulers table's Client Address column renders with.
import { clientAddressOf } from "./columns/haulerFilters.js";

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
  // An address given through the Region / Province / City pickers IS an address.
  // Reading only the free-text box flagged every such client as having none —
  // while the hauler table beside this panel showed that very address (live:
  // 56 of Maria Aurora's clients, 29 of Limay's, all fully located).
  if (!clientAddressOf(client)) recommended.push("Client Address");
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

// ── Bulk completion: export the work list, fill it offline, upload it back ────
//
// The gaps are counted in the THOUSANDS on a real fleet (measured on live data:
// 24,874 client entries with no Client Address, 11,133 with no Province), and the
// on-screen editor fixes them one row at a time. That is the right tool for five
// rows and the wrong one for five hundred.
//
// The column headers ARE the contract: the file the operator uploads is the file
// this exported, so they must round-trip exactly.
export const COMPLETION_COLUMNS = [
  "Row ID",
  "Hauler",
  "Client",
  "Missing",
  "Client Type",
  "Client Address",
  "Province",
  "Municipality",
  "Office Address",
];

/**
 * The work list as plain rows, pre-filled with what IS stored.
 *
 * Pre-filling matters: an operator handed a sheet of blanks cannot tell a value
 * that is missing from one this tool simply did not show them, and would retype
 * data that is already correct.
 */
export const buildCompletionExportRows = (haulers = []) => {
  const list = Array.isArray(haulers) ? haulers : [];
  return summarizeBaselineCompleteness(list).rows.map((row) => {
    const hauler = list[row.haulerIndex] || {};
    const client =
      row.kind === "client" ? haulerClients(hauler)[row.clientIndex] || {} : {};
    return {
      "Row ID": row.id,
      Hauler: row.hauler,
      Client: row.client,
      // Read-only guidance; ignored on the way back in.
      Missing: [...row.required, ...row.recommended].join(", "),
      "Client Type": row.kind === "client" ? text(client.clientType) : "",
      "Client Address": row.kind === "client" ? text(client.clientAddress || client.address) : "",
      Province: row.kind === "client" ? text(client.provinceName) : "",
      Municipality: row.kind === "client" ? text(client.municipalityName) : "",
      "Office Address": row.kind === "hauler" ? text(hauler.officeAddress) : "",
    };
  });
};

const norm = (v) =>
  text(v)
    .normalize("NFKC")
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

// ── Resolving a place name typed into a spreadsheet ─────────────────────────
//
// Exact matching rejected most of a real filled sheet, and every rejection was a
// name a person would recognise instantly:
//
//   "Ecija"    → Nueva Ecija      (a multi-word province, half typed)
//   "Balanga"  → City of Balanga  (the PSGC name carries a "City of" prefix…
//                                  …and it is in BATAAN, not the Pampanga typed
//                                  beside it)
//   "Manila"   → Metro Manila     (an NCR city standing in for its region)
//   "Aurpra"   → Aurora           (a typo, 24 of them already stored)
//   "San"      → San Luis? San Simon?   ← genuinely ambiguous, stays rejected
//
// So this is a LOOKUP problem, not a judgement one: the answer is in the PSGC
// list, the typed value just does not equal it. Strategies below run in
// descending order of certainty and the first that yields exactly ONE answer
// wins; anything that yields two stops and reports them, because picking between
// San Luis and San Simon misfiles a client's waste in a different municipality.

// PSGC writes cities as "City of X"; operators write "X City" or plain "X".
const cityForms = (value) => {
  const n = norm(value);
  const stripped = n.replace(/^city of /, "").replace(/ city$/, "");
  return new Set([n, stripped, `city of ${stripped}`, `${stripped} city`]);
};

/** One normalized name contains the other as a run of WHOLE words. */
const containsWords = (haystack, needle) =>
  haystack === needle ||
  haystack.startsWith(`${needle} `) ||
  haystack.endsWith(` ${needle}`) ||
  haystack.includes(` ${needle} `);

/** Levenshtein distance, capped — used only for a single-character typo. */
const editDistance = (a, b) => {
  if (Math.abs(a.length - b.length) > 1) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
};

// A typo fix is only ever offered when nothing DISTINGUISHING differs. Same rule,
// and the same reason, as the client-name matcher: "Barangay 1" and "Barangay 2"
// are one character apart and are different places.
const typoSafe = (a, b) => !/\d/.test(a) && !/\d/.test(b);

/**
 * Resolve a typed place name against a reference list.
 *
 * @returns {{match:object}|{candidates:string[]}|{}} — a single match, the
 *   competing candidates when it is ambiguous, or nothing when unknown.
 */
export const resolvePlaceName = (typed, options = []) => {
  const target = norm(typed);
  if (!target || !options.length) return {};
  const forms = cityForms(target);

  // 1 — exact, including the City-of / -City spellings.
  const exact = options.filter((o) => {
    const n = norm(o.name);
    return n === target || forms.has(n) || cityForms(n).has(target);
  });
  if (exact.length === 1) return { match: exact[0] };
  if (exact.length > 1) return { candidates: exact.map((o) => o.name) };

  // 2 — one name contained in the other as whole words ("ecija" ⊂ "nueva ecija").
  const contained = options.filter((o) => {
    const n = norm(o.name);
    return containsWords(n, target) || containsWords(target, n);
  });
  if (contained.length === 1) return { match: contained[0] };
  if (contained.length > 1) return { candidates: contained.map((o) => o.name) };

  // 3 — a single-character typo, and only where nothing numeric differs.
  const typos = options.filter((o) => {
    const n = norm(o.name);
    return typoSafe(n, target) && editDistance(n, target) === 1;
  });
  if (typos.length === 1) return { match: typos[0] };
  if (typos.length > 1) return { candidates: typos.map((o) => o.name) };

  return {};
};

/**
 * Break an ambiguous tie using the client's ADDRESS.
 *
 * The evidence VERA would reach for, applied deterministically: when the sheet
 * says "San" and Pampanga offers San Luis and San Simon, the client's own address
 * usually names which. Accepted only when EXACTLY ONE candidate appears in the
 * address as whole words — two mentions is not a tie-break, it is a coin toss.
 */
export const disambiguateByAddress = (candidates = [], address = "") => {
  const haystack = norm(address);
  if (!haystack || candidates.length < 2) return null;
  const hits = candidates.filter((name) => containsWords(haystack, norm(name)));
  return hits.length === 1 ? hits[0] : null;
};

/**
 * Turn uploaded rows back into completion patches.
 *
 * IDENTITY IS RE-CHECKED, NOT TRUSTED. A Row ID is positional
 * (`client-<haulerIndex>-<clientIndex>`), which is a stable address only while
 * the fleet is unchanged — and between exporting a sheet and uploading it, a
 * hauler can be added, renamed or removed. So every row must still name the
 * hauler and client that live at that position; if they have moved, the row is
 * REJECTED rather than applied, because writing one client's address onto
 * another is worse than not filling it in.
 *
 * Province and Municipality arrive as NAMES and are stored as codes, so each is
 * resolved against the reference lists. A name that resolves to nothing is
 * rejected with a reason — never guessed at.
 *
 * @returns {{patches: object, applied: number, rejected: Array<{row:any, reason:string}>}}
 */
export const parseCompletionUpload = (
  uploadedRows = [],
  haulers = [],
  { provinces = [], municipalitiesByProvince = {} } = {},
) => {
  const list = Array.isArray(haulers) ? haulers : [];
  const rowsById = new Map(
    summarizeBaselineCompleteness(list).rows.map((row) => [row.id, row]),
  );
  const provinceByName = new Map(
    (provinces || []).map((p) => [norm(p.name), p]),
  );

  const patches = {};
  const rejected = [];
  // Rows that were accepted only after a name was corrected. Reported, never
  // silent: an operator has to be able to see that "Balanga" was filed under
  // Bataan rather than the Pampanga they typed.
  const corrections = [];
  let applied = 0;

  (Array.isArray(uploadedRows) ? uploadedRows : []).forEach((raw) => {
    const id = text(raw?.["Row ID"]);
    if (!id) return; // a blank trailing row, not an error
    const row = rowsById.get(id);
    if (!row) {
      rejected.push({ row: raw, reason: `Row ID "${id}" is not in the current work list.` });
      return;
    }
    // The identity re-check.
    if (norm(raw.Hauler) && norm(raw.Hauler) !== norm(row.hauler)) {
      rejected.push({
        row: raw,
        reason: `Row ID "${id}" now belongs to "${row.hauler}", not "${text(raw.Hauler)}" — re-export and fill the current list.`,
      });
      return;
    }
    if (row.kind === "client" && norm(raw.Client) && norm(raw.Client) !== norm(row.client)) {
      rejected.push({
        row: raw,
        reason: `Row ID "${id}" now belongs to client "${row.client}", not "${text(raw.Client)}" — re-export and fill the current list.`,
      });
      return;
    }

    const patch = {};
    if (row.kind === "hauler") {
      if (text(raw["Office Address"])) patch.officeAddress = text(raw["Office Address"]);
    } else {
      if (text(raw["Client Type"])) patch.clientType = text(raw["Client Type"]);
      if (text(raw["Client Address"])) patch.clientAddress = text(raw["Client Address"]);

      const provinceName = text(raw.Province);
      if (provinceName) {
        const exactProvince = provinceByName.get(norm(provinceName));
        const resolvedProvince = exactProvince
          ? { match: exactProvince }
          : resolvePlaceName(provinceName, provinces);
        if (resolvedProvince.candidates) {
          rejected.push({
            row: raw,
            reason: `Province "${provinceName}" could be ${resolvedProvince.candidates.join(" or ")} — write it in full.`,
          });
          return;
        }
        if (!resolvedProvince.match) {
          rejected.push({ row: raw, reason: `Province "${provinceName}" is not a known province.` });
          return;
        }
        let province = resolvedProvince.match;
        patch.province = String(province.code);
        patch.provinceName = province.name;

        const municipalityName = text(raw.Municipality);
        if (municipalityName) {
          const pool = municipalitiesByProvince[String(province.code)] || [];
          let resolvedMun = resolvePlaceName(municipalityName, pool);

          // ── The municipality is right and the PROVINCE is wrong ─────────────
          //
          // "Balanga" typed under Pampanga: Pampanga has no such LGU, Bataan has
          // exactly one. An LGU name is far more specific than the province
          // beside it, so when it resolves UNIQUELY across the provinces we hold,
          // the province is corrected to follow it rather than the row being
          // rejected. Unique across all of them or nothing — two provinces
          // offering the same name is exactly the case where guessing misfiles
          // the client.
          if (!resolvedMun.match && !resolvedMun.candidates) {
            const elsewhere = [];
            Object.entries(municipalitiesByProvince).forEach(([code, list]) => {
              if (String(code) === String(province.code)) return;
              const hit = resolvePlaceName(municipalityName, list || []);
              if (hit.match) elsewhere.push({ code, municipality: hit.match });
            });
            if (elsewhere.length === 1) {
              const owner = provinces.find(
                (p) => String(p.code) === String(elsewhere[0].code),
              );
              if (owner) {
                province = owner;
                patch.province = String(owner.code);
                patch.provinceName = owner.name;
                resolvedMun = { match: elsewhere[0].municipality };
                corrections.push(
                  `${text(raw["Row ID"])}: "${municipalityName}" is in ${owner.name}, not ${provinceName} — province corrected.`,
                );
              }
            } else if (elsewhere.length > 1) {
              rejected.push({
                row: raw,
                reason: `"${municipalityName}" exists in ${elsewhere.length} provinces — name the right one in the Province column.`,
              });
              return;
            }
          }

          // Last resort for a genuine tie: the client's own address usually names
          // which "San ..." it is. Deterministic, and only when ONE candidate
          // appears in it.
          if (!resolvedMun.match && resolvedMun.candidates) {
            const picked = disambiguateByAddress(
              resolvedMun.candidates,
              `${text(raw["Client Address"])} ${text(raw.Client)}`,
            );
            if (picked) {
              const hit = pool.find((mun) => mun.name === picked);
              if (hit) {
                resolvedMun = { match: hit };
                corrections.push(
                  `${text(raw["Row ID"])}: "${municipalityName}" read as "${hit.name}" from the client's address.`,
                );
              }
            }
          }

          if (resolvedMun.candidates && !resolvedMun.match) {
            rejected.push({
              row: raw,
              reason: `"${municipalityName}" could be ${resolvedMun.candidates.join(" or ")} in ${province.name} — write it in full.`,
            });
            return;
          }
          if (!resolvedMun.match) {
            rejected.push({
              row: raw,
              reason: `"${municipalityName}" is not a city/municipality of ${province.name}.`,
            });
            return;
          }
          patch.municipality = String(resolvedMun.match.code);
          patch.municipalityName = resolvedMun.match.name;
        }
      } else if (text(raw.Municipality)) {
        // A municipality without its province cannot be resolved: names repeat
        // across provinces, and picking one would misclassify the client.
        rejected.push({
          row: raw,
          reason: `"${text(raw.Municipality)}" needs its Province filled in too — municipality names repeat across provinces.`,
        });
        return;
      }
    }

    if (Object.keys(patch).length) {
      patches[id] = patch;
      applied += 1;
    }
  });

  return { patches, applied, rejected, corrections };
};

/**
 * Every province code whose city/municipality list is worth having loaded before
 * an uploaded sheet is parsed.
 *
 * TWO sources, and both are needed:
 *
 *   • the provinces the SHEET names — resolved TOLERANTLY, because a sheet that
 *     says "Ecija" must still cause Nueva Ecija's list to be fetched, or its
 *     municipalities are rejected for the accident of not being loaded;
 *   • the provinces the FLEET already uses — which is what makes the
 *     wrong-province rescue possible at all. "Balanga" typed under Pampanga is
 *     resolved by finding it in Bataan, and Bataan is only searchable if its list
 *     is in hand. A Bataan facility's clients are overwhelmingly in Bataan, so
 *     this is a small, targeted set rather than all 81 provinces.
 */
export const provinceCodesInUpload = (uploadedRows = [], provinces = [], haulers = []) => {
  const codes = new Set();
  const add = (value) => {
    if (!text(value)) return;
    const exact = (provinces || []).find((p) => norm(p.name) === norm(value));
    if (exact) {
      codes.add(String(exact.code));
      return;
    }
    const resolved = resolvePlaceName(value, provinces);
    if (resolved.match) codes.add(String(resolved.match.code));
  };

  (Array.isArray(uploadedRows) ? uploadedRows : []).forEach((raw) => add(raw?.Province));

  (Array.isArray(haulers) ? haulers : []).forEach((hauler) => {
    haulerClients(hauler).forEach((client) => {
      // A stored code is authoritative and needs no resolving.
      if (text(client.province)) codes.add(String(text(client.province)));
      else add(client.provinceName);
    });
  });

  return [...codes];
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
  COMPLETION_COLUMNS,
  buildCompletionExportRows,
  parseCompletionUpload,
  provinceCodesInUpload,
  resolvePlaceName,
  disambiguateByAddress,
};
