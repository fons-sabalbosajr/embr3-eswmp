// ── EMB-verified client data flows back to the portal ──
//
// When EMB Region III corrects or verifies a client in the admin SLF Clients
// page, the SLF's own baseline is updated to match: the client's name, type
// and address (and, when EMB corrects it, its hauler's name) are written into
// the hauler roster the portal reads, and every change is logged and announced
// to the portal user.
//
// "Verified by EMB" is NOT stored on the baseline — the portal re-saves its
// whole roster, so a flag there would be dropped on the next save, and a portal
// user could set it themselves. EMB's verification lives on the SlfClient
// (`embVerification`: who, when and the exact values verified) and is matched
// against the roster when the portal reads it (`annotateVerifiedClients`). The
// mark therefore shows only while the portal's copy still equals what EMB
// verified; a later change on either side clears it by itself.
const SlfClient = require("../models/SlfClient");
const { writeLog } = require("./logger");
const { comparableText } = require("./nameMatch");

// SlfClient types → the baseline roster's client types.
const PORTAL_CLIENT_TYPE = { LGU: "LGU", "Private Sector": "Private" };

function norm(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

const clientNameOf = (client) => (typeof client === "string" ? client : client?.clientName || client?.name || "");

/** The values EMB verified, in the roster's field names. Blank fields are left out. */
function verifiedValues(client) {
  const values = {
    clientName: client?.name,
    clientType: PORTAL_CLIENT_TYPE[client?.type] || "",
    clientAddress: client?.address,
    provinceName: client?.province,
    municipalityName: client?.municipalityCity,
    regionName: client?.region,
  };
  return Object.fromEntries(
    Object.entries(values)
      .map(([k, v]) => [k, String(v ?? "").trim()])
      .filter(([, v]) => v !== ""),
  );
}

/**
 * Correct one hauler roster (pure). Returns a NEW roster and the list of changes.
 *
 * @param {object[]} haulers                 accreditedHaulers as stored
 * @param {object}   o
 * @param {string[]} o.names                 client names to match (before and after)
 * @param {string[]} [o.haulerNames]         limit to these haulers (empty = all)
 * @param {object}   o.values                verifiedValues(...)
 * @param {{from: string, to: string}} [o.renameHauler]
 */
function correctRoster(haulers, { names, haulerNames = [], values, renameHauler = null }) {
  const nameSet = new Set((names || []).map(norm).filter(Boolean));
  const haulerSet = new Set((haulerNames || []).map(norm).filter(Boolean));
  const changes = [];
  const list = Array.isArray(haulers) ? haulers : [];
  const rename =
    renameHauler && norm(renameHauler.from) && norm(renameHauler.to) && norm(renameHauler.from) !== norm(renameHauler.to)
      ? renameHauler
      : null;
  // Never rename onto a hauler that is already on the roster — that would merge
  // two haulers silently. Reported instead.
  const renameBlocked = rename && list.some((h) => norm(h?.haulerName) === norm(rename.to));
  if (renameBlocked) {
    changes.push({ kind: "hauler-rename-skipped", from: rename.from, to: rename.to });
  }

  const next = list.map((hauler) => {
    if (!hauler || typeof hauler !== "object") return hauler;
    const h = { ...hauler };
    const wasHauler = norm(h.haulerName);
    if (rename && !renameBlocked && wasHauler === norm(rename.from)) {
      changes.push({ kind: "hauler", from: h.haulerName, to: rename.to });
      h.haulerName = rename.to;
    }
    const inScope =
      haulerSet.size === 0 ||
      haulerSet.has(wasHauler) ||
      (rename && haulerSet.has(norm(rename.from)) && norm(h.haulerName) === norm(rename.to));
    if (!inScope || !Array.isArray(h.privateSectorClients)) return h;
    h.privateSectorClients = h.privateSectorClients.map((client) => {
      if (!nameSet.has(norm(clientNameOf(client)))) return client;
      const current = typeof client === "string" ? { clientName: client } : { ...client };
      const fields = Object.keys(values).filter((k) => String(current[k] ?? "").trim() !== values[k]);
      if (!fields.length) return client;
      changes.push({
        kind: "client",
        hauler: h.haulerName,
        client: values.clientName || clientNameOf(client),
        fields: fields.map((k) => ({ field: k, from: String(current[k] ?? ""), to: values[k] })),
      });
      return { ...current, ...values };
    });
    return h;
  });
  return { haulers: next, changes };
}

// ── Reading: the "Verified by EMB" mark ──

const MARK_FIELDS = ["clientName", "clientAddress", "provinceName", "municipalityName"];

/**
 * Add `embVerified: { at }` to each roster client whose current values equal
 * what EMB verified. Returns a new roster; never throws (no mark on failure).
 */
async function annotateVerifiedClients(haulers) {
  const list = Array.isArray(haulers) ? haulers : [];
  const names = [
    ...new Set(list.flatMap((h) => (h?.privateSectorClients || []).map((c) => norm(clientNameOf(c)))).filter(Boolean)),
  ];
  if (!names.length) return list;
  let verified;
  try {
    verified = await SlfClient.find({
      normalizedName: { $in: names },
      deletedAt: null,
      "embVerification.verifiedAt": { $ne: null },
    })
      .select("normalizedName type embVerification")
      .maxTimeMS(5000)
      .lean();
  } catch {
    return list;
  }
  if (!verified.length) return list;
  const byName = new Map();
  for (const v of verified) {
    if (!byName.has(v.normalizedName)) byName.set(v.normalizedName, []);
    byName.get(v.normalizedName).push(v);
  }
  // Formatting (case, periods, commas, spacing) does not undo a verification —
  // the same rule as every other name comparison (utils/nameMatch.js).
  const matches = (client, record) => {
    const values = record.embVerification?.values || {};
    if (values.clientType && client.clientType && norm(values.clientType) !== norm(client.clientType)) return false;
    return MARK_FIELDS.every((field) => !values[field] || comparableText(values[field]) === comparableText(client[field]));
  };
  return list.map((hauler) => {
    if (!hauler || !Array.isArray(hauler.privateSectorClients)) return hauler;
    return {
      ...hauler,
      privateSectorClients: hauler.privateSectorClients.map((client) => {
        const obj = typeof client === "string" ? { clientName: client } : client;
        const record = (byName.get(norm(clientNameOf(obj))) || []).find((r) => matches(obj, r));
        return record ? { ...obj, embVerified: { at: record.embVerification.verifiedAt } } : client;
      }),
    };
  });
}

// ── Writing: push a correction into the SLF baselines ──

/**
 * Write an EMB correction / verification of `client` into the baselines of
 * every SLF that lists it, log it, and notify the portal users.
 *
 * @param {object} o
 * @param {object} o.client   the SlfClient AFTER the edit (a document or lean)
 * @param {object} o.before   { name, hauler } as they were before the edit
 * @param {string} o.actor
 * @param {object} [o.req]    for socket notices
 * @returns {Promise<{ recordsUpdated: number, changes: object[], portalUsers: string[] }>}
 */
async function syncClientCorrection({ client, before = {}, actor = "", req = null }) {
  const DataSLF = require("../models/DataSLF");
  const UserPortal = require("../models/UserPortal");
  const Notification = require("../models/Notification");
  const { notifyPortal, refreshPortal, refreshAdmin } = require("./socketEmit");

  const rels = Array.isArray(client.portalUserRelationships) ? client.portalUserRelationships : [];
  const emails = new Set(
    [client.portalUserEmail, ...rels.map((r) => r?.portalUserEmail)].map((e) => String(e || "").trim().toLowerCase()).filter(Boolean),
  );
  const missingIds = rels.filter((r) => r?.portalUser && !r?.portalUserEmail).map((r) => r.portalUser);
  if (missingIds.length) {
    const users = await UserPortal.find({ _id: { $in: missingIds } }).select("email").lean();
    users.forEach((u) => u?.email && emails.add(String(u.email).toLowerCase()));
  }

  // The SLFs: from the baselines the client was synced from.
  const refIds = [
    client.baselineRef,
    ...(client.baselineReferences || []),
    ...rels.map((r) => r?.baselineRef),
  ].filter(Boolean);
  const refs = refIds.length
    ? await DataSLF.find({ _id: { $in: refIds } })
        .setOptions({ includeHiddenYears: true })
        .select("slfGenerator slfName")
        .lean()
    : [];
  const genIds = [...new Set(refs.map((r) => String(r.slfGenerator || "")).filter(Boolean))];
  const slfNames = [...new Set(refs.filter((r) => !r.slfGenerator).map((r) => r.slfName).filter(Boolean))];
  const facilityOr = [
    ...(genIds.length ? [{ slfGenerator: { $in: genIds } }] : []),
    ...(slfNames.length ? [{ slfName: { $in: slfNames } }] : []),
  ];
  const scope = facilityOr.length
    ? { $or: facilityOr }
    : emails.size
      ? { submittedBy: { $in: [...emails] } }
      : null;
  if (!scope) return { recordsUpdated: 0, changes: [], portalUsers: [] };

  // The records the portal reads its roster from: the SLF's baseline-only
  // containers, or — for a legacy SLF with none — its newest record with haulers.
  const base = { deletedAt: null, "accreditedHaulers.0": { $exists: true } };
  let targets = await DataSLF.find({ $and: [base, scope, { $or: [{ trucks: { $exists: false } }, { trucks: { $size: 0 } }] }] })
    .setOptions({ includeHiddenYears: true })
    .select("_id slfName submittedBy accreditedHaulers")
    .lean();
  if (!targets.length) {
    const newest = await DataSLF.findOne({ $and: [base, scope] })
      .setOptions({ includeHiddenYears: true })
      .sort({ createdAt: -1 })
      .select("_id slfName submittedBy accreditedHaulers")
      .lean();
    targets = newest ? [newest] : [];
  }

  const values = verifiedValues(client);
  const names = [before.name, client.name];
  const haulerNames = [
    before.hauler,
    client.hauler,
    ...rels.map((r) => r?.hauler),
    ...(client.haulerRelationships || []).map((r) => r?.hauler),
  ];
  const renameHauler = before.hauler && client.hauler ? { from: before.hauler, to: client.hauler } : null;

  const allChanges = [];
  const touchedSlfs = new Set();
  let recordsUpdated = 0;
  for (const target of targets) {
    const { haulers, changes } = correctRoster(target.accreditedHaulers, { names, haulerNames, values, renameHauler });
    const real = changes.filter((c) => c.kind !== "hauler-rename-skipped");
    allChanges.push(...changes.map((c) => ({ ...c, record: String(target._id), slfName: target.slfName })));
    if (!real.length) continue;
    // eslint-disable-next-line no-await-in-loop -- a handful of containers
    await DataSLF.updateOne({ _id: target._id }, { $set: { accreditedHaulers: haulers } });
    recordsUpdated += 1;
    touchedSlfs.add(target.slfName || "");
    if (target.submittedBy && String(target.submittedBy).includes("@")) emails.add(String(target.submittedBy).toLowerCase());
  }

  writeLog("info", "slf-client.emb_correction_synced", {
    message:
      `EMB ${recordsUpdated ? "correction" : "verification"} of client "${client.name}" — ` +
      `${recordsUpdated} baseline record(s) updated`,
    user: actor,
    ip: req?.ip,
    meta: {
      clientId: String(client._id || ""),
      before,
      verified: values,
      records: targets.map((t) => String(t._id)),
      changes: allChanges,
    },
  });

  const portalUsers = [...emails];
  const changedSomething = allChanges.some((c) => c.kind === "client" || c.kind === "hauler");
  for (const email of portalUsers) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await Notification.create({
        recipient: email,
        type: "data_verified_by_emb",
        title: changedSomething ? "Client Data Corrected by EMB" : "Client Data Verified by EMB",
        message: changedSomething
          ? `EMB Region III verified and corrected "${client.name}" in your hauler client list. The corrected details are now in your baseline, marked Verified by EMB.`
          : `EMB Region III verified "${client.name}" in your hauler client list. It is now marked Verified by EMB.`,
        meta: { clientName: client.name, slfNames: [...touchedSlfs].filter(Boolean), corrected: changedSomething },
      });
    } catch {
      /* a missed notice must not undo the correction */
    }
    if (req) {
      notifyPortal(req, email, { type: "data_verified_by_emb", title: "Client data verified by EMB" });
      refreshPortal(req, email, "baselines");
    }
  }
  if (req) refreshAdmin(req, "baselines");

  return { recordsUpdated, changes: allChanges, portalUsers };
}

module.exports = {
  PORTAL_CLIENT_TYPE,
  verifiedValues,
  correctRoster,
  annotateVerifiedClients,
  syncClientCorrection,
};
