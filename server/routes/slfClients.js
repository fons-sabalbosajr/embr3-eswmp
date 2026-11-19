const express = require("express");
const mongoose = require("mongoose");
const SlfClient = require("../models/SlfClient");
const { writeLog } = require("../utils/logger");
// Shared name normalizer (trim/lowercase/collapse) — used by the VERA issue
// suggestion below as well as the relationship map further down.
const { normalizeName } = require("../utils/region3");
// The project's municipality normalizer — handles "City of X" / "X City" and
// punctuation, so a client's free-text town matches the masterlist's form.
const { normMuni } = require("../utils/lguMatch");
const { refreshAdmin } = require("../utils/socketEmit");
const { authMiddleware, adminOnly, requirePermission } = require("../middleware/auth");
const { getRegion3ProvinceSet } = require("../utils/region3");
const { buildLocationIndex, inferClientLocation } = require("../utils/clientLocation");

const router = express.Router();

// All routes are admin data-management, gated by the granular `slfClients`
// permission (view/edit/delete) enforced on the backend so direct API calls can
// never bypass the UI gates. Developer/super-admin bypasses inside requirePermission.
router.use(authMiddleware, adminOnly);

const PERM = "slfClients";

// Short-TTL in-memory cache for the relationship map. The Region III master list +
// canonical clients change infrequently, so a 60s cache absorbs repeated modal
// opens / tab switches without re-running the join. Invalidated on any client write
// (see clearRelMapCache) so edits show immediately. Override TTL via env if needed.
const REL_MAP_TTL_MS = Number(process.env.REL_MAP_CACHE_TTL_MS ?? 60_000);
const _relMapCache = new Map(); // type -> { data, expires }
function clearRelMapCache() { _relMapCache.clear(); }

// ── Dashboard client-count cache ──
// GET /summary re-runs recalcCounts() — a dedup aggregation over the whole client
// collection — on every dashboard poll, for a three-number tile that only moves
// when a client or a baseline changes. 60s TTL; every write on this router
// invalidates it, and baseline saves invalidate it through refreshAdmin (see
// staleKeysFor in utils/socketEmit.js), which is what re-derives the roster.
const { cacheJson, invalidateOnWrite } = require("../middleware/cacheRoute");
const { MODULE_STATS } = require("../utils/cacheKeys");
const CLIENT_SUMMARY_KEY = MODULE_STATS.slfClients;
const CLIENT_SUMMARY_TTL_MS = 60000;
router.use(invalidateOnWrite(CLIENT_SUMMARY_KEY));
const actor = (req) => req.headers["x-user-name"] || req.headers["x-user-email"] || "admin";

// Canonical duplicate: one profile per (normalizedName + type). Manual adds may
// not create a second canonical row for the same client identity.
async function findDuplicate({ name, type, excludeId }) {
  const query = {
    canonicalKey: SlfClient.buildCanonicalKey({ name, type }),
    isCanonical: true,
    mergedInto: null,
    deletedAt: null,
  };
  if (excludeId) query._id = { $ne: excludeId };
  return SlfClient.findOne(query).lean();
}

// Sanitize the incoming body to the known fields only.
function pickBody(body = {}) {
  const out = {};
  [
    "name", "type", "portalUser", "portalUserName", "hauler", "location",
    "province", "municipalityCity", "region",
    "address", "contactPerson", "contactNumber", "contactEmail", "status", "notes",
  ].forEach((k) => {
    if (body[k] !== undefined) out[k] = body[k];
  });
  if (out.portalUser === "" || out.portalUser === undefined) out.portalUser = null;
  return out;
}

// Classify a client Within / Outside Region 3 from every location field it has
// (province, region, city/municipality, address, then the name), not the province
// alone: a client saved as "Tanza" + no province is still Outside R3 (Cavite).
// Recomputed whenever any of those change. Returns the full inference so the
// caller can fill a province the evidence established.
async function inferRecordLocation(record) {
  const Region3Lgu = require("../models/Region3Lgu");
  const [set, masters] = await Promise.all([
    getRegion3ProvinceSet(),
    Region3Lgu.find({ status: "Active", lguType: { $in: Region3Lgu.MUNI_TYPES } })
      .select("name normalizedName province normalizedProvince aliases lguType").lean()
      .catch(() => []),
  ]);
  return inferClientLocation(
    {
      province: record.province, region: record.region, municipalityCity: record.municipalityCity,
      address: record.address || record.location, name: record.name, isLgu: record.type === "LGU",
    },
    buildLocationIndex(set, masters),
  );
}
async function applyRegionClass(record) {
  const loc = await inferRecordLocation(record);
  record.regionClass = loc.regionClass;
  if (!record.province && loc.province) record.province = loc.province;
  return loc;
}

// Keep a canonical record's single portalUserRelationship in sync with the
// legacy single-value fields on manual create/edit, so multi-portal detection
// and the relationship detail view work for admin-managed clients too.
function syncSingleRelationship(record) {
  if (record.portalUser || record.portalUserName || record.hauler) {
    const existing = (record.portalUserRelationships || [])[0] || {};
    record.portalUserRelationships = [{
      portalUser: record.portalUser || null,
      portalUserEmail: record.portalUserEmail || existing.portalUserEmail || "",
      portalUserName: record.portalUserName || "",
      hauler: record.hauler || "",
      normalizedHauler: SlfClient.normalize(record.hauler || ""),
      baselineRef: null,
      status: "active",
      firstSyncedAt: existing.firstSyncedAt || new Date(),
      lastSyncedAt: new Date(),
    }];
    if (record.hauler) {
      record.haulerRelationships = [{ hauler: record.hauler, normalizedHauler: SlfClient.normalize(record.hauler), lastSyncedAt: new Date() }];
    }
  }
}

function validate(body, { partial = false } = {}) {
  const errors = [];
  if (!partial || body.name !== undefined) {
    if (!String(body.name || "").trim()) errors.push("Client name is required");
  }
  if (!partial || body.type !== undefined) {
    if (!["LGU", "Private Sector"].includes(body.type)) errors.push("Client type must be LGU or Private Sector");
  }
  if (body.status !== undefined && !["Active", "Inactive"].includes(body.status)) {
    errors.push("Status must be Active or Inactive");
  }
  if (body.portalUser && !mongoose.isValidObjectId(body.portalUser)) {
    errors.push("Invalid portal user reference");
  }
  return errors;
}

// ── List all (non-deleted). Frontend handles filter/sort/pagination client-side,
//    matching the other admin management tables. ──
router.get("/", requirePermission(PERM, "view"), async (req, res) => {
  try {
    // Canonical clients only — merged/archived/deleted duplicates are excluded so
    // the table shows exactly one row per unique client.
    const records = await SlfClient.find({ deletedAt: null, isCanonical: true, mergedInto: null })
      .sort({ createdAt: -1 })
      .lean();
    res.json(records);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Hauler Clients for ONE facility (SLF Data Table → Edit Modal → Hauler Clients).
//
// Replaces the removed "Reconcile Unlinked" module with a scoped, server-paginated
// CRUD surface. A client is associated with an SLF through the portal accounts
// assigned to that facility (UserPortal.assignedSlf), which is exactly how
// syncBaselineClients builds portalUserRelationships in the first place — so this
// stays consistent with the relationship map rather than inventing a second rule.
//
// Server-side search + pagination on purpose: GET / returns every canonical client
// as a full document, and this modal must not pay that cost per facility.
router.get("/by-slf/:slfId", requirePermission(PERM, "view"), async (req, res) => {
  try {
    const { slfId } = req.params;
    if (!mongoose.isValidObjectId(slfId)) {
      return res.status(400).json({ message: "A valid SLF id is required." });
    }
    const UserPortal = require("../models/UserPortal");
    const assigned = await UserPortal.find({ assignedSlf: slfId }).select("_id email").lean();
    const userIds = assigned.map((u) => u._id);
    const emails = assigned.map((u) => String(u.email || "").trim().toLowerCase()).filter(Boolean);

    const filter = {
      deletedAt: null,
      isCanonical: true,
      mergedInto: null,
      $or: [
        { portalUserRelationships: { $elemMatch: { portalUser: { $in: userIds } } } },
        { portalUserRelationships: { $elemMatch: { portalUserEmail: { $in: emails } } } },
        { portalUser: { $in: userIds } },
      ],
    };

    const search = String(req.query.search || "").trim();
    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      // $and so the search clause cannot clobber the association $or above.
      filter.$and = [{ $or: [{ name: rx }, { hauler: rx }, { municipalityCity: rx }, { province: rx }, { location: rx }] }];
    }
    const type = String(req.query.type || "").trim();
    if (type === "LGU" || type === "Private Sector") filter.type = type;

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 10));
    const [rows, total] = await Promise.all([
      SlfClient.find(filter)
        .select("name type hauler province municipalityCity location status source multiPortalStatus updatedAt")
        .sort({ name: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      SlfClient.countDocuments(filter),
    ]);
    res.json({ rows, total, page, limit, portalUsers: assigned.length });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Deduped unique-client counts for the SLF dashboard tiles + the four
//    Region 3 breakdown tiles. Single authoritative source (recalcCounts reads
//    the PERSISTED collection, deduped by normalized name+type). ──
router.get("/summary", requirePermission(PERM, "view"), cacheJson(() => CLIENT_SUMMARY_KEY, CLIENT_SUMMARY_TTL_MS), async (req, res) => {
  try {
    const { recalcCounts } = require("../services/syncBaselineClients");
    const counts = await recalcCounts();
    res.json(counts);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Relationship map (Item #2): canonical Active clients of one type, deduped by
//    client _id, with their DISTINCT hauler + SLF relationships, multiple-hauler /
//    multiple-SLF detection, and missing-assignment flags. For LGUs, the Region III
//    master list (region3_lgus) is the authoritative universe, so unserved LGUs are
//    derived from the master list — never only from existing clients/submissions. ──
router.get("/relationship-map", requirePermission(PERM, "view"), async (req, res) => {
  try {
    const Region3Lgu = require("../models/Region3Lgu");
    const { normalizeName } = require("../utils/region3");
    const type = /priv/i.test(String(req.query.type || "")) ? "Private Sector" : "LGU";

    const cached = _relMapCache.get(type);
    if (cached && cached.expires > Date.now()) return res.json(cached.data);

    // `portalUserRelationships` is ~92% of a client document and this route only
    // ever collapses it to a DISTINCT set of haulers/SLFs. Pulling the raw array
    // moved ~4.9MB over the wire to produce ~25KB of usable data — and because the
    // sync appends one entry per baseline (see relKeyOf in syncBaselineClients),
    // that array is ~63x larger than the distinct data it represents.
    //
    // So do the DISTINCT in the database and ship only the collapsed values. The
    // JS helpers below still run, over tiny arrays, so the final semantics are
    // unchanged: $setUnion is equivalent to their Map-keyed dedupe here because no
    // hauler name has two casings and no portal user has two name spellings (both
    // verified against the live collection).
    const clients = await SlfClient.aggregate([
      {
        $match: {
          deletedAt: null, isCanonical: true, mergedInto: null, status: "Active",
          isDummy: { $ne: true }, type,
        },
      },
      {
        $project: {
          name: 1, normalizedName: 1, clientTypeLabel: 1, province: 1,
          municipalityCity: 1, address: 1, hauler: 1, portalUser: 1, portalUserName: 1,
          haulerRelationships: {
            $map: {
              input: {
                $setUnion: [
                  { $map: { input: { $ifNull: ["$haulerRelationships", []] }, as: "r", in: "$$r.hauler" } },
                  { $map: { input: { $ifNull: ["$portalUserRelationships", []] }, as: "r", in: "$$r.hauler" } },
                ],
              },
              as: "h",
              in: { hauler: "$$h" },
            },
          },
          portalUserRelationships: {
            $setUnion: [
              {
                $map: {
                  input: { $ifNull: ["$portalUserRelationships", []] },
                  as: "r",
                  in: { portalUser: "$$r.portalUser", portalUserName: "$$r.portalUserName" },
                },
              },
              [],
            ],
          },
        },
      },
    ]);

    // Distinct by NORMALIZED value (ids where available) so the same hauler/SLF is
    // never double-counted across relationship entries.
    const distinctHaulers = (c) => {
      const m = new Map();
      const add = (h) => { const d = String(h || "").trim(); if (d) m.set(d.toLowerCase(), d); };
      add(c.hauler);
      (c.haulerRelationships || []).forEach((r) => add(r.hauler));
      (c.portalUserRelationships || []).forEach((r) => add(r.hauler));
      return [...m.values()];
    };
    // This module identifies a client's service provider by SLF FACILITY, not by
    // the person who holds the portal login. `portalUserName` is a human
    // name, so using it here made every "SLF" label in the dashboard (SLF cards,
    // the SLF filter, "Top SLFs by Clients Served") read as a person's name.
    //
    // Resolve the account's ASSIGNED SLF instead. One batched query keyed by
    // portal-user id — doing it per client would be a query per row.
    const portalUserIds = [
      ...new Set(
        clients.flatMap((c) => [
          c.portalUser,
          ...(c.portalUserRelationships || []).map((r) => r.portalUser),
        ]),
      ),
    ]
      .map((id) => (id ? String(id) : ""))
      .filter(Boolean);

    const slfNameByPortalUser = new Map();
    if (portalUserIds.length) {
      // Required here rather than at module scope, matching this file's existing
      // convention for the portal model.
      const UserPortal = require("../models/UserPortal");
      const accounts = await UserPortal.find({ _id: { $in: portalUserIds } })
        .select("assignedSlfName companyName")
        .lean();
      accounts.forEach((account) => {
        const names = Array.isArray(account.assignedSlfName)
          ? account.assignedSlfName.filter(Boolean)
          : [account.assignedSlfName].filter(Boolean);
        // An account with several assigned facilities contributes all of them,
        // so a client serving two SLFs still shows under both.
        if (names.length) slfNameByPortalUser.set(String(account._id), names);
        else if (account.companyName) slfNameByPortalUser.set(String(account._id), [account.companyName]);
      });
    }

    const distinctSlfs = (c) => {
      const m = new Map();
      const add = (id, fallbackName) => {
        const mapped = slfNameByPortalUser.get(String(id || "").trim());
        // Fall back to the stored name only when the account has no assigned
        // facility, so a legacy/admin-created client is still attributable.
        const names = mapped?.length ? mapped : [String(fallbackName || "").trim()];
        names.filter(Boolean).forEach((name) => m.set(name.toLowerCase(), name));
      };
      add(c.portalUser, c.portalUserName);
      (c.portalUserRelationships || []).forEach((r) => add(r.portalUser, r.portalUserName));
      return [...m.values()].filter(Boolean);
    };

    // ── Municipality resolver (LGU only) ─────────────────────────────────────
    // Resolve each LGU client to a STABLE masterlist municipality id so counts are
    // by unique municipality — never by client name, barangay, hauler, SLF, or
    // duplicate record. Municipality-level = lguType ∈ {Municipality, City} (the
    // user-confirmed definition; Provinces are excluded). Match by normalized
    // name + province (with aliases) against the master list.
    //
    // Special Zones are DELIBERATELY excluded here even though the address pickers
    // and utils/lguMatch accept them: Clark Freeport Zone is a valid address but it
    // is not a local government unit, so counting it would inflate "LGUs Served"
    // with something no LGU is accountable for. This is the one place the narrower
    // definition applies — hence the local constant rather than Region3Lgu.MUNI_TYPES.
    const MUNI_TYPES = ["Municipality", "City"];
    let masterMunis = [];
    let resolveMunicipality = () => null;
    if (type === "LGU") {
      masterMunis = await Region3Lgu.find({ status: "Active", lguType: { $in: MUNI_TYPES } })
        .select("name normalizedName province normalizedProvince municipalityCity psgcCode lguType aliases")
        .lean();
      const byKey = new Map();       // "normName|normProv" → master
      const byNameOnly = new Map();  // "normName" → master (only kept when unambiguous)
      const nameDupes = new Set();
      masterMunis.forEach((m) => {
        const prov = m.normalizedProvince || normalizeName(m.province);
        const names = [m.normalizedName || normalizeName(m.name), ...(m.aliases || []).map(normalizeName)].filter(Boolean);
        names.forEach((n) => {
          byKey.set(`${n}|${prov}`, m);
          if (byNameOnly.has(n) && byNameOnly.get(n)._id.toString() !== m._id.toString()) nameDupes.add(n);
          else byNameOnly.set(n, m);
        });
      });
      resolveMunicipality = (c) => {
        const prov = normalizeName(c.province);
        const candidates = [c.municipalityCity, c.name].map(normalizeName).filter(Boolean);
        for (const n of candidates) {
          const hit = byKey.get(`${n}|${prov}`);
          if (hit) return hit;
        }
        // Name-only fallback ONLY when that name maps to exactly one municipality.
        for (const n of candidates) {
          if (!nameDupes.has(n) && byNameOnly.has(n)) return byNameOnly.get(n);
        }
        return null;
      };
    }

    // Best-effort barangay extraction from a free-text address ("Brgy. X, ...").
    const deriveBarangay = (address) => {
      const s = String(address || "");
      const m = s.match(/(?:brgy\.?|barangay)\s+([^,;]+)/i);
      return m ? m[1].trim() : "";
    };

    const rows = clients
      .map((c) => {
        const haulers = distinctHaulers(c);
        const slfs = distinctSlfs(c);
        const missingHauler = haulers.length === 0;
        const missingSlf = slfs.length === 0;
        const master = type === "LGU" ? resolveMunicipality(c) : null;
        const municipalityId = master ? String(master._id) : "";
        const remarksList = [];
        if (type === "Private Sector") remarksList.push("Private-sector record");
        if (missingHauler || missingSlf) remarksList.push("Incomplete assignment");
        if (haulers.length > 1) remarksList.push("Multiple haulers");
        if (slfs.length > 1) remarksList.push("Multiple SLFs");
        if (type === "LGU" && !municipalityId) remarksList.push("Missing masterlist link");
        if (!missingHauler && !missingSlf && remarksList.length === 0) remarksList.push("Active");
        return {
          _id: String(c._id),
          name: c.name,
          clientType: c.clientTypeLabel || "",
          province: (master && master.province) || c.province || "",
          municipalityCity: (master && (master.municipalityCity || master.name)) || c.municipalityCity || c.address || "",
          municipalityId,
          psgc: master ? master.psgcCode || "" : "",
          barangay: deriveBarangay(c.address),
          haulers, slfs,
          haulerCount: haulers.length,
          slfCount: slfs.length,
          multiHauler: haulers.length > 1,
          multiSlf: slfs.length > 1,
          missingHauler, missingSlf,
          serviceStatus: missingHauler || missingSlf ? "Incomplete" : "Served",
          remarksList,
          remarks: remarksList.join(" · "),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const summary = {
      type,
      clients: rows.length,
      served: rows.filter((r) => r.serviceStatus === "Served").length,
      incomplete: rows.filter((r) => r.serviceStatus === "Incomplete").length,
      multiHauler: rows.filter((r) => r.multiHauler).length,
      multiSlf: rows.filter((r) => r.multiSlf).length,
      missingAssignments: rows.filter((r) => r.missingHauler || r.missingSlf).length,
    };

    // Private-sector clients served (counted separately, never mixed with LGUs).
    summary.privateClientsServed = await SlfClient.countDocuments({
      deletedAt: null, isCanonical: true, mergedInto: null, status: "Active",
      isDummy: { $ne: true }, type: "Private Sector",
    }).catch(() => 0);

    if (type === "LGU") {
      // Served = distinct masterlist municipality ids among clients that have a
      // hauler (multi-hauler / multi-SLF / duplicates / barangays collapse to one).
      const servedIds = new Set(
        rows.filter((r) => r.municipalityId && r.haulerCount > 0).map((r) => r.municipalityId),
      );
      const total = masterMunis.length;
      const unserved = masterMunis
        .filter((m) => !servedIds.has(String(m._id)))
        .map((m) => ({ _id: String(m._id), name: m.name, province: m.province || "", municipalityCity: m.municipalityCity || "", lguType: m.lguType }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const served = servedIds.size;
      summary.totalMasterMunicipalities = total;
      summary.servedMunicipalities = served;
      summary.unservedMunicipalities = unserved.length;
      summary.coveragePercent = total > 0 ? Math.round((served / total) * 1000) / 10 : 0;
      summary.municipalityBasis = "Municipality + City (Provinces excluded)";
      summary.unlinkedClients = rows.filter((r) => !r.municipalityId).length;
      // Back-compat aliases (older UI keys).
      summary.totalMasterLgus = total;
      summary.servedCount = served;
      summary.unservedCount = unserved.length;
      const payload = { rows, summary, unserved };
      _relMapCache.set(type, { data: payload, expires: Date.now() + REL_MAP_TTL_MS });
      res.json(payload);
      return;
    }

    const payload = { rows, summary, unserved: [] };
    _relMapCache.set(type, { data: payload, expires: Date.now() + REL_MAP_TTL_MS });
    res.json(payload);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Baseline hauler options for the client hauler dropdown. Sources distinct
//    hauler names from every non-deleted baseline's accreditedHaulers, plus any
//    haulers already stored on client records, deduped by normalized value
//    (casing/whitespace collapsed) so the same hauler never appears twice. ──
router.get("/hauler-options", requirePermission(PERM, "view"), async (req, res) => {
  try {
    const DataSLF = require("../models/DataSLF");
    const [baselines, clientHaulers] = await Promise.all([
      DataSLF.find({ deletedAt: null, "accreditedHaulers.0": { $exists: true } })
        .select("accreditedHaulers.haulerName")
        .lean(),
      SlfClient.find({ deletedAt: null, hauler: { $ne: "" } }).select("hauler").lean(),
    ]);
    const byNorm = new Map(); // normalized → first-seen display
    const add = (name) => {
      const display = String(name || "").trim();
      if (!display) return;
      const norm = SlfClient.normalize(display);
      if (!byNorm.has(norm)) byNorm.set(norm, display);
    };
    baselines.forEach((b) => (b.accreditedHaulers || []).forEach((h) => add(h?.haulerName)));
    clientHaulers.forEach((c) => add(c.hauler));
    const options = [...byNorm.values()].sort((a, b) => a.localeCompare(b));
    res.json(options);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Data issues (flagged records that could not be synced safely). ──
router.get("/issues", requirePermission(PERM, "view"), async (req, res) => {
  try {
    const SlfDataIssue = require("../models/SlfDataIssue");
    const filter = {};
    if (req.query.status && ["open", "resolved", "ignored"].includes(req.query.status)) {
      filter.status = req.query.status;
    }
    if (req.query.flagType) filter.flagType = req.query.flagType;
    // Lets VERA (and the admin table) ask for only the authorized set.
    if (req.query.veraResolvable === "true") filter.veraResolvable = true;
    else if (req.query.veraResolvable === "false") filter.veraResolvable = { $ne: true };

    // PAGINATED. This returned every matching document — 28,547 of them on
    // production, each carrying its own `meta` object. The response never
    // finished arriving, the client's catch swallowed it, and the modal showed
    // its "No data issues" empty state: the data was there all along.
    //
    // Only the fields the table renders are projected; `meta`/`resolutionNotes`
    // are the bulk of each document and nothing in the list reads them.
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);

    const [data, total, byStatus, veraResolvableCount] = await Promise.all([
      SlfDataIssue.find(filter)
        // veraResolvable is projected so the table can render the CURRENT
        // authorization straight from the database — that is what makes the
        // selection survive pagination and a page refresh.
        .select("flagType description portalUserEmail hauler clientName status updatedAt veraResolvable")
        .sort({ status: 1, updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      SlfDataIssue.countDocuments(filter),
      // Counts for the whole set, so the UI can show what is out there without
      // fetching it.
      SlfDataIssue.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
      // How many of the CURRENT filter are authorized. Counted in the database so
      // the UI can say "N of M selected" across the whole result set rather than
      // across the page it happens to be showing.
      SlfDataIssue.countDocuments({ ...filter, veraResolvable: true }),
    ]);

    res.json({
      data,
      total,
      page,
      limit,
      counts: byStatus.reduce((acc, row) => ({ ...acc, [row._id]: row.n }), {}),
      veraResolvableCount,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Authoritative open-issue count for the Issues badge. Single source of truth
//    (countDocuments) — never a client-side length of a fetched list. Counts only
//    OPEN issues; resolved/ignored are excluded, and SlfDataIssue's unique
//    `signature` already prevents duplicate open rows. ──
router.get("/issues/count", requirePermission(PERM, "view"), async (req, res) => {
  try {
    const SlfDataIssue = require("../models/SlfDataIssue");
    const status = ["open", "resolved", "ignored"].includes(req.query.status) ? req.query.status : "open";
    const filter = { status };
    if (req.query.flagType) filter.flagType = req.query.flagType;
    const count = await SlfDataIssue.countDocuments(filter);
    res.json({ count });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

/**
 * ── Mark issues as VERA-resolvable (admin authorization) ────────────────────
 *
 * This records PERMISSION for VERA to resolve an issue. It does not resolve
 * anything — `status` is untouched — because "VERA may fix this" and "this is
 * fixed" are different states (see the model).
 *
 * SELECTION IS DATASET-WIDE, NOT PAGE-WIDE.
 *
 * The Issues table is paginated (25–100 rows of 28,000+ on production), so a
 * selection built from the rows on screen could never express "authorize every
 * unclassified-region issue". Shipping all matching ids to the browser to work
 * around that is not an option either — it is the very payload that made
 * GET /issues time out before it was paginated.
 *
 * So the selection is applied WHERE THE DATA IS. Two mutually exclusive modes:
 *
 *   { ids: [...] }                explicit rows the admin ticked (any pages).
 *   { all: true, status, flagType }  every document matching the SAME filter the
 *                                    table is showing — resolved by the database
 *                                    via updateMany, never enumerated client-side.
 *                                    `excludeIds` supports "select all except…".
 *
 * Idempotent: re-authorizing an already-authorized issue is a no-op.
 */
router.patch("/issues/vera-resolvable", requirePermission(PERM, "edit"), async (req, res) => {
  try {
    const SlfDataIssue = require("../models/SlfDataIssue");
    const { ids, all, status, flagType, excludeIds } = req.body || {};
    const veraResolvable = req.body?.veraResolvable !== false; // default: authorize

    let filter;
    if (all) {
      // Rebuild the LIST filter exactly, so "select all" can never authorize a
      // wider set than the admin is looking at.
      filter = {};
      if (status && ["open", "resolved", "ignored"].includes(status)) filter.status = status;
      if (flagType) filter.flagType = flagType;
      const skip = (Array.isArray(excludeIds) ? excludeIds : [])
        .filter((id) => mongoose.isValidObjectId(id));
      if (skip.length) filter._id = { $nin: skip };
    } else {
      const list = (Array.isArray(ids) ? ids : []).filter((id) => mongoose.isValidObjectId(id));
      if (!list.length) {
        return res.status(400).json({ message: "No issues selected." });
      }
      filter = { _id: { $in: list } };
    }

    const who = actor(req);
    const update = veraResolvable
      ? { $set: { veraResolvable: true, veraResolvableAt: new Date(), veraResolvableBy: who } }
      : { $set: { veraResolvable: false, veraResolvableAt: null, veraResolvableBy: "" } };

    const result = await SlfDataIssue.updateMany(filter, update);
    const veraResolvableCount = await SlfDataIssue.countDocuments({ veraResolvable: true });

    writeLog("info", "slf-issue.vera-resolvable", {
      message: `${veraResolvable ? "Marked" : "Cleared"} ${result.modifiedCount} issue(s) as VERA-resolvable`,
      user: who,
      ip: req.ip,
      meta: { mode: all ? "all-matching-filter" : "explicit-ids", status, flagType, modified: result.modifiedCount },
    });

    res.json({
      message: `${result.modifiedCount} issue(s) updated`,
      matched: result.matchedCount,
      modified: result.modifiedCount,
      veraResolvable,
      veraResolvableCount,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Resolve / reopen a data issue (edit permission). ──
/**
 * ── VERA-assisted issue repair ──────────────────────────────────────────────
 *
 * VERA PROPOSES; the admin DECIDES. Nothing here writes on its own: the suggest
 * endpoint is read-only and returns the exact field changes it would make, and
 * the apply endpoint runs only when an admin sends the proposal back.
 *
 * The proposal is DETERMINISTIC — it is resolved against the Region 3 masterlist
 * (Region3Lgu), never generated text. A fabricated province on a compliance
 * record would be far worse than an unresolved flag, so when the masterlist
 * cannot answer confidently the endpoint says so and proposes nothing.
 */
const stripLguPrefix = (value) =>
  String(value || "")
    .replace(/^\s*(lgu|municipality|city|mun\.?|brgy\.?|barangay)\s*[-–—:]?\s*/i, "")
    .trim();

// Client names arrive as "LGU - BAGAC BATAAN" / "LGU ANGELES": the town, and
// often its province, in one free-text field. Compare against every masterlist
// name and keep the longest match, so "STA. ANA PAMPANGA" prefers "Sta. Ana"
// over a shorter incidental substring.
function proposeMunicipalityMatch(rawName, masters) {
  // normMuni (utils/lguMatch) is the project's own municipality normalizer: it
  // strips the "City of …" / "… City" forms the masterlist uses, plus punctuation.
  // A plain lowercase compare missed every city — "PRIVATE - ANGELES PAMPANGA"
  // failed against the masterlist's "City of Angeles" — so the same normalizer
  // is used on both sides here.
  const haystack = normMuni(stripLguPrefix(rawName));
  if (!haystack) return [];
  const hits = masters.filter((m) => {
    const muni = normMuni(m.name || m.municipalityCity || "");
    // Two-letter fragments match far too much to be evidence of anything.
    if (!muni || muni.length < 4) return false;
    return haystack === muni || haystack.startsWith(`${muni} `) || haystack.includes(` ${muni} `) || haystack.endsWith(` ${muni}`);
  });
  // Ranking, in order:
  //
  // 1. A municipality whose name is ALSO its province's name ("City of Tarlac"
  //    in Tarlac, "City of Bulacan"-style pairs) loses to any other candidate.
  //    Client addresses end with the province, so that province word was being
  //    matched as the town: "SITIO KAWILIWILI, CUTCUT II, CAPAS TARLAC" resolved
  //    to City of Tarlac when the town is plainly Capas.
  // 2. Then longest match, so "STA. ANA PAMPANGA" prefers "Sta. Ana" over a
  //    shorter incidental hit.
  const echoesProvince = (m) => normMuni(m.name || "") === normMuni(m.province || "");
  return hits.sort((a, b) => {
    const aEcho = echoesProvince(a);
    const bEcho = echoesProvince(b);
    if (aEcho !== bEcho) return aEcho ? 1 : -1;
    return normMuni(b.name || "").length - normMuni(a.name || "").length;
  });
}

/**
 * Compute the proposal for ONE issue. Pure apart from the reads it is handed —
 * masters and the client are passed in so a batch resolves them once instead of
 * per row. Single and batch share this, so a proposal can never differ between
 * the two paths.
 */
function buildIssueSuggestion(issue, client, masters) {
  const noFix = (reason) => ({ canFix: false, reason, flagType: issue.flagType });

  if (issue.flagType !== "region_unclassified") {
    return noFix(
      issue.flagType === "duplicate_client"
        ? "Merging duplicate clients changes which records the coverage figures count, and the right survivor is a judgement call. Use Merge on the Clients page."
        : issue.flagType === "missing_hauler"
          ? "Assigning a hauler is an operational decision — it must come from the SLF's accredited hauler list, not be inferred."
          : "No automatic repair is defined for this issue type.",
    );
  }
  if (!client) return noFix(`No client record named "${issue.clientName}" was found — it may have been merged or removed.`);
  if (client.province) return noFix("This client already has a province — re-run Sync from Baseline to clear the flag.");

  const candidates =
    proposeMunicipalityMatch(client.municipalityCity, masters).length
      ? proposeMunicipalityMatch(client.municipalityCity, masters)
      : proposeMunicipalityMatch(client.name, masters).length
        ? proposeMunicipalityMatch(client.name, masters)
        : proposeMunicipalityMatch(client.address, masters);

  if (candidates.length === 0) {
    return noFix(`"${client.name}" does not match any Region 3 municipality or city. It may be outside Region 3 — set the province by hand, or ignore the issue.`);
  }

  const distinctProvinces = [...new Set(candidates.map((c) => c.province).filter(Boolean))];
  const best = candidates[0];
  return {
    canFix: true,
    flagType: issue.flagType,
    confidence: distinctProvinces.length === 1 ? "high" : "ambiguous",
    client: { _id: String(client._id), name: client.name, municipalityCity: client.municipalityCity || "" },
    proposal: {
      province: best.province || "",
      municipalityCity: best.municipalityCity || best.name || "",
      regionClass: "within-region-3",
    },
    alternatives: candidates.slice(0, 6).map((c) => ({
      province: c.province || "",
      municipalityCity: c.municipalityCity || c.name || "",
      regionClass: "within-region-3",
    })),
    rationale:
      distinctProvinces.length === 1
        ? `"${client.name}" matches the Region 3 masterlist entry ${best.name} (${best.province}).`
        : `"${client.name}" matches ${candidates.length} masterlist entries across ${distinctProvinces.join(", ")}. Confirm which one is correct.`,
  };
}

/** Resolve the client an issue refers to — these flags key on clientName. */
function findIssueClient(issue, clientsByKey) {
  return (
    clientsByKey.get(`${issue.clientName}|${issue.clientType || ""}`) ||
    clientsByKey.get(`${issue.clientName}|`) ||
    null
  );
}

/**
 * Batch proposals — one pass for a whole page of issues.
 *
 * The UI needs to know which rows are even fixable BEFORE the admin picks any,
 * so the checkboxes can be limited to those. Doing that one request per row
 * would be dozens of round-trips per page; here the masterlist and the clients
 * are each read once.
 */
router.post("/issues/suggest-batch", requirePermission(PERM, "view"), async (req, res) => {
  try {
    const SlfDataIssue = require("../models/SlfDataIssue");
    const Region3Lgu = require("../models/Region3Lgu");
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : [])
      .filter((id) => mongoose.isValidObjectId(id))
      .slice(0, 200);
    if (!ids.length) return res.json({ suggestions: {} });

    const issues = await SlfDataIssue.find({ _id: { $in: ids } })
      .select("flagType clientName clientType client").lean();

    const [masters, clients] = await Promise.all([
      Region3Lgu.find({ status: "Active", lguType: { $in: Region3Lgu.MUNI_TYPES } })
        .select("name municipalityCity province").lean(),
      SlfClient.find({ name: { $in: [...new Set(issues.map((i) => i.clientName).filter(Boolean))] }, deletedAt: null })
        .select("name type province municipalityCity address").lean(),
    ]);
    const clientsByKey = new Map();
    clients.forEach((c) => clientsByKey.set(`${c.name}|${c.type || ""}`, c));

    const suggestions = {};
    issues.forEach((issue) => {
      suggestions[String(issue._id)] = buildIssueSuggestion(issue, findIssueClient(issue, clientsByKey), masters);
    });
    res.json({ suggestions });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

/**
 * Apply many approved proposals in one request.
 *
 * Only HIGH-confidence proposals are accepted without an explicit province:
 * an ambiguous match must be decided by a person, so a bulk run can never guess
 * one. Every row is applied independently and reported on — one bad record never
 * aborts the rest.
 */
router.post("/issues/apply-batch", requirePermission(PERM, "edit"), async (req, res) => {
  try {
    const SlfDataIssue = require("../models/SlfDataIssue");
    const Region3Lgu = require("../models/Region3Lgu");
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : [])
      .filter((id) => mongoose.isValidObjectId(id))
      .slice(0, 200);
    if (!ids.length) return res.status(400).json({ message: "No issues selected." });

    const issues = await SlfDataIssue.find({ _id: { $in: ids }, status: "open" });
    const [masters, clients] = await Promise.all([
      Region3Lgu.find({ status: "Active", lguType: { $in: Region3Lgu.MUNI_TYPES } })
        .select("name municipalityCity province").lean(),
      SlfClient.find({ name: { $in: [...new Set(issues.map((i) => i.clientName).filter(Boolean))] }, deletedAt: null })
        .select("name type").lean(),
    ]);
    const clientsByKey = new Map();
    clients.forEach((c) => clientsByKey.set(`${c.name}|${c.type || ""}`, c));

    const who = actor(req);
    const results = { applied: 0, skipped: 0, rows: [] };

    for (const issue of issues) {
      // Re-derive rather than trust the client: the proposal is recomputed here
      // from the masterlist, so a tampered payload cannot write an arbitrary
      // province.
      const lean = clientsByKey.get(`${issue.clientName}|${issue.clientType || ""}`) || clientsByKey.get(`${issue.clientName}|`);
      const full = lean ? await SlfClient.findById(lean._id) : null;
      const suggestion = buildIssueSuggestion(issue, full, masters);

      if (!suggestion.canFix || suggestion.confidence !== "high") {
        results.skipped += 1;
        results.rows.push({
          _id: String(issue._id), clientName: issue.clientName, status: "skipped",
          reason: suggestion.canFix ? "Ambiguous — needs a province chosen by hand." : suggestion.reason,
        });
        continue;
      }

      const { province, municipalityCity } = suggestion.proposal;
      const before = { province: full.province || "", municipalityCity: full.municipalityCity || "" };
      full.province = province;
      if (municipalityCity) full.municipalityCity = municipalityCity;
      full.regionClass = "within-region-3";
      full.updatedBy = who;
      await full.save();

      issue.status = "resolved";
      issue.resolvedAt = new Date();
      issue.resolvedBy = who;
      issue.resolutionNotes = `Resolved via VERA bulk repair (approved by ${who}): province set to "${province}".`;
      await issue.save();

      results.applied += 1;
      results.rows.push({
        _id: String(issue._id), clientName: issue.clientName, status: "applied",
        province, municipalityCity, before,
      });
    }

    writeLog("info", "slf-client.vera_bulk_fix", {
      message: `VERA bulk repair: ${results.applied} applied, ${results.skipped} skipped`,
      user: who,
      ip: req.ip,
      meta: { requested: ids.length, applied: results.applied, skipped: results.skipped },
    });

    res.json(results);
    clearRelMapCache();
    refreshAdmin(req, "slf-clients");
    refreshAdmin(req, "clients");
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

/**
 * "Let VERA fix" — VERA resolves every open issue it safely can, in one run.
 * See services/veraIssueAutofix.js for exactly what it does and does not touch.
 * Edit permission: it writes client locations and closes issues.
 */
let veraAutofixRunning = false;
router.post("/issues/vera-autofix", requirePermission(PERM, "edit"), async (req, res) => {
  if (veraAutofixRunning) return res.status(409).json({ message: "VERA is already fixing issues. Try again in a moment." });
  veraAutofixRunning = true;
  try {
    const Region3Lgu = require("../models/Region3Lgu");
    const { runVeraIssueAutofix } = require("../services/veraIssueAutofix");
    const summary = await runVeraIssueAutofix({
      actor: actor(req),
      buildIssueSuggestion,
      loadMasters: () =>
        Region3Lgu.find({ status: "Active", lguType: { $in: Region3Lgu.MUNI_TYPES } })
          .select("name municipalityCity province").lean(),
    });
    writeLog("info", "slf-client.vera_autofix", {
      message:
        `VERA fixed client issues: ${summary.resolved} resolved (${summary.duplicateCopies} duplicate copies, ` +
        `${summary.repaired} locations repaired), ${summary.leftOpen} left for review`,
      user: actor(req),
      ip: req.ip,
      meta: { ...summary, repairedClients: undefined },
    });
    res.json(summary);
    clearRelMapCache();
    refreshAdmin(req, "slf-clients");
    refreshAdmin(req, "clients");
  } catch (error) {
    res.status(500).json({ message: "VERA could not finish fixing the issues.", error: error.message });
  } finally {
    veraAutofixRunning = false;
  }
});

router.get("/issues/:id/suggestion", requirePermission(PERM, "view"), async (req, res) => {
  try {
    const SlfDataIssue = require("../models/SlfDataIssue");
    const Region3Lgu = require("../models/Region3Lgu");
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Issue not found" });
    const issue = await SlfDataIssue.findById(req.params.id).lean();
    if (!issue) return res.status(404).json({ message: "Issue not found" });

    // Shares buildIssueSuggestion with the batch endpoint, so a single-row
    // proposal and a bulk one can never disagree.
    const [masters, client] = await Promise.all([
      Region3Lgu.find({ status: "Active", lguType: { $in: Region3Lgu.MUNI_TYPES } })
        .select("name municipalityCity province").lean(),
      issue.client
        ? SlfClient.findById(issue.client).lean()
        : SlfClient.findOne({
            name: issue.clientName,
            ...(issue.clientType ? { type: issue.clientType } : {}),
            deletedAt: null,
          }).lean(),
    ]);

    res.json(buildIssueSuggestion(issue, client, masters));
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

router.post("/issues/:id/apply-suggestion", requirePermission(PERM, "edit"), async (req, res) => {
  try {
    const SlfDataIssue = require("../models/SlfDataIssue");
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Issue not found" });
    const issue = await SlfDataIssue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: "Issue not found" });
    if (issue.flagType !== "region_unclassified") {
      return res.status(400).json({ message: "No automatic repair is defined for this issue type." });
    }

    // The admin sends back the proposal they approved. Only these three fields
    // are ever written — an approved suggestion can never turn into a broader edit.
    const province = String(req.body?.province || "").trim();
    const municipalityCity = String(req.body?.municipalityCity || "").trim();
    if (!province) return res.status(400).json({ message: "A province is required to apply this fix." });

    // Same resolution as the suggest endpoint — these issues key on clientName.
    const client = issue.client
      ? await SlfClient.findById(issue.client)
      : await SlfClient.findOne({
          name: issue.clientName,
          ...(issue.clientType ? { type: issue.clientType } : {}),
          deletedAt: null,
        });
    if (!client) return res.status(404).json({ message: "The client record no longer exists." });

    const before = { province: client.province || "", municipalityCity: client.municipalityCity || "", regionClass: client.regionClass || "" };
    client.province = province;
    if (municipalityCity) client.municipalityCity = municipalityCity;
    client.regionClass = "within-region-3";
    client.updatedBy = actor(req);
    await client.save();

    issue.status = "resolved";
    issue.resolvedAt = new Date();
    issue.resolvedBy = actor(req);
    issue.resolutionNotes = `Resolved via VERA (approved by ${actor(req)}): province set to "${province}"${municipalityCity ? `, municipality "${municipalityCity}"` : ""}.`;
    await issue.save();

    writeLog("info", "slf-client.vera_fix_applied", {
      message: `VERA fix applied to client "${client.name}" — province "${before.province || "(blank)"}" → "${province}"`,
      user: actor(req),
      ip: req.ip,
      meta: { issueId: String(issue._id), clientId: String(client._id), before, after: { province, municipalityCity, regionClass: "within-region-3" } },
    });

    res.json({ message: "Fix applied", issue, client: { _id: String(client._id), province: client.province, municipalityCity: client.municipalityCity } });
    clearRelMapCache();
    refreshAdmin(req, "slf-clients");
    refreshAdmin(req, "clients");
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

router.patch("/issues/:id/resolve", requirePermission(PERM, "edit"), async (req, res) => {
  try {
    const SlfDataIssue = require("../models/SlfDataIssue");
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Issue not found" });
    const { status = "resolved", resolutionNotes = "" } = req.body;
    if (!["open", "resolved", "ignored"].includes(status)) return res.status(400).json({ message: "Invalid status" });
    const issue = await SlfDataIssue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: "Issue not found" });
    issue.status = status;
    issue.resolutionNotes = resolutionNotes;
    issue.resolvedAt = status === "open" ? null : new Date();
    issue.resolvedBy = status === "open" ? "" : actor(req);
    await issue.save();
    res.json(issue);
    clearRelMapCache();
    refreshAdmin(req, "slf-clients");
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Start the baseline → SlfClient sync as a tracked job (edit permission).
//    Returns immediately with a jobId; progress streams over the socket and is
//    also pollable via GET /sync/:jobId. One running job per scope. Idempotent. ──
router.post("/sync", requirePermission(PERM, "edit"), async (req, res) => {
  try {
    const { startSyncJob } = require("../services/slfSyncRunner");
    const io = req.app.get("io");
    const emit = (event, payload) => { try { if (io) io.to("admin-room").emit(event, payload); } catch { /* ignore */ } };
    const { job, alreadyRunning } = await startSyncJob({ actor: actor(req), emit });
    if (alreadyRunning) {
      return res.status(409).json({ message: "A synchronization job is already running", jobId: String(job._id), status: job.status });
    }
    res.status(202).json({ jobId: String(job._id), status: job.status });
    writeLog("info", "slf-clients.sync.start", { message: `Baseline client sync started (job ${job._id})`, req });
  } catch (error) {
    writeLog("error", "slf-clients.sync.error", { message: `Baseline client sync failed to start: ${error.message}`, req });
    res.status(500).json({ message: "Sync failed to start", error: error.message });
  }
});

// ── Controlled duplicate cleanup migration (edit permission). Idempotent. ──
router.post("/cleanup-duplicates", requirePermission(PERM, "edit"), async (req, res) => {
  try {
    const { runDuplicateCleanup } = require("../services/cleanupDuplicateClients");
    const summary = await runDuplicateCleanup({ actor: actor(req) });
    res.json(summary);
    clearRelMapCache();
    refreshAdmin(req, "slf-clients");
    writeLog("info", "slf-clients.cleanup", { message: `Duplicate cleanup: ${summary.duplicatesRemoved} archived across ${summary.canonicalsAffected} canonicals`, req });
  } catch (error) {
    writeLog("error", "slf-clients.cleanup.error", { message: `Duplicate cleanup failed: ${error.message}`, req });
    res.status(500).json({ message: "Cleanup failed", error: error.message });
  }
});

// ── Latest sync job (must precede /sync/:jobId). ──
router.get("/sync/latest", requirePermission(PERM, "view"), async (req, res) => {
  try {
    const SlfSyncJob = require("../models/SlfSyncJob");
    const job = await SlfSyncJob.findOne({ scope: "baseline-clients" }).sort({ createdAt: -1 }).lean();
    res.json(job || null);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Poll a sync job's status/progress (SSE fallback). ──
router.get("/sync/:jobId", requirePermission(PERM, "view"), async (req, res) => {
  try {
    const SlfSyncJob = require("../models/SlfSyncJob");
    if (!mongoose.isValidObjectId(req.params.jobId)) return res.status(404).json({ message: "Job not found" });
    const job = await SlfSyncJob.findById(req.params.jobId).lean();
    if (!job) return res.status(404).json({ message: "Job not found" });
    res.json(job);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Single record ──
// ── LGU reconciliation (admin) ───────────────────────────────────────────────
// Detect municipality-level LGU clients that don't deterministically resolve to
// the official masterlist, and propose masterlist matches (deterministic first,
// fuzzy within-province last). Read-only detection — no production record is
// changed here; linking happens only via the explicit /link-lgu action below.
async function loadMuniMasters() {
  const Region3Lgu = require("../models/Region3Lgu");
  return Region3Lgu.find({ status: "Active", lguType: { $in: Region3Lgu.MUNI_TYPES } })
    .select("name normalizedName province normalizedProvince municipalityCity psgcCode lguType aliases")
    .lean();
}

router.get("/lgu-reconciliation", requirePermission(PERM, "view"), async (req, res) => {
  try {
    const { matchClient } = require("../utils/lguMatch");
    const masters = await loadMuniMasters();
    const clients = await SlfClient.find({
      deletedAt: null, isCanonical: true, mergedInto: null, status: "Active",
      isDummy: { $ne: true }, type: "LGU",
      // Same reasoning as /relationship-map: hasHauler() only ever tests `.hauler`
      // on these two arrays, so projecting that one sub-field avoids dragging the
      // full relationship history across the wire for a boolean.
    }).select("name municipalityCity province address hauler haulerRelationships.hauler portalUserRelationships.hauler").lean();

    const deriveBarangay = (address) => {
      const m = String(address || "").match(/(?:brgy\.?|barangay)\s+([^,;]+)/i);
      return m ? m[1].trim() : "";
    };
    const hasHauler = (c) => !!String(c.hauler || "").trim() || (c.haulerRelationships || []).some((r) => r.hauler) || (c.portalUserRelationships || []).some((r) => r.hauler);

    const byClass = { exact: 0, high: 0, medium: 0, multiple: 0, none: 0, invalid: 0 };
    const linkedMasterIds = new Set();
    const unlinked = [];
    clients.forEach((c) => {
      const r = matchClient({ municipality: c.municipalityCity, province: c.province, name: c.name }, masters);
      byClass[r.classification] = (byClass[r.classification] || 0) + 1;
      const deterministic = r.classification === "exact" || (r.suggestions[0] && r.suggestions[0].method === "alias");
      if (deterministic) {
        if (r.suggestions[0]) linkedMasterIds.add(r.suggestions[0].masterId);
        return; // already linked — not shown for review
      }
      unlinked.push({
        clientId: String(c._id),
        original: c.municipalityCity || c.name || "",
        province: c.province || "",
        barangay: deriveBarangay(c.address),
        hasHauler: hasHauler(c),
        classification: r.classification,
        reason: r.reason || "",
        suggestions: r.suggestions,
      });
    });

    const summary = {
      totalLguClients: clients.length,
      linked: clients.length - unlinked.length,
      unlinkedCount: unlinked.length,
      byClass,
      // Official (verified) served = unique masters linked deterministically.
      verifiedServedMunicipalities: linkedMasterIds.size,
      // Unverified = unlinked records that have a hauler (would count once linked).
      unverifiedRecords: unlinked.filter((u) => u.hasHauler).length,
      manualReview: byClass.multiple + byClass.none + byClass.invalid,
    };
    res.json({ unlinked, summary });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Link an unlinked client to a chosen masterlist municipality — NON-destructively.
// Adds the client's original value as an approved alias on the master (so the
// resolver links it and future variants), optionally corrects the client's
// municipality/province to the canonical value, and records an immutable audit
// row that preserves the original value. Recalculates coverage (cache clear).
router.post("/:id/link-lgu", requirePermission(PERM, "edit"), async (req, res) => {
  try {
    const Region3Lgu = require("../models/Region3Lgu");
    const LguLinkAudit = require("../models/LguLinkAudit");
    const { normMuni } = require("../utils/lguMatch");
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Client not found" });
    const { masterId, addAlias = true, correctClient = false, confidence = "", method = "manual" } = req.body || {};
    if (!mongoose.isValidObjectId(masterId)) return res.status(400).json({ message: "A valid masterId is required" });

    const client = await SlfClient.findById(req.params.id);
    if (!client) return res.status(404).json({ message: "Client not found" });
    if (client.type !== "LGU") return res.status(400).json({ message: "Only LGU clients can be linked" });
    const master = await Region3Lgu.findById(masterId);
    if (!master || master.status !== "Active" || !Region3Lgu.MUNI_TYPES.includes(master.lguType)) {
      return res.status(400).json({ message: "Selected masterlist municipality is not valid" });
    }

    const originalValue = client.municipalityCity || client.name || "";
    const aliasValue = normMuni(originalValue);
    let decision = "corrected";

    if (addAlias && aliasValue) {
      const existing = (master.aliases || []).map((a) => normMuni(a));
      if (!existing.includes(aliasValue)) {
        master.aliases = [...(master.aliases || []), aliasValue];
        master.updatedBy = req.headers["x-user-name"] || req.headers["x-user-email"] || "admin";
        await master.save();
        decision = "alias-added";
      } else {
        decision = "accepted";
      }
    }
    if (correctClient) {
      client.municipalityCity = master.municipalityCity || master.name;
      client.province = master.province || client.province;
      await client.save();
      decision = "corrected";
    }

    await LguLinkAudit.create({
      client: client._id,
      originalValue,
      originalProvince: client.province || "",
      suggestedMasterId: master._id,
      suggestedName: master.name,
      confidence,
      method,
      decision,
      reviewer: req.headers["x-user-name"] || req.headers["x-user-email"] || "admin",
      previousLink: "",
      newLink: `${master._id} · ${master.name}`,
    });

    clearRelMapCache();
    try { require("../utils/veraFindings").clearFindingsCache(); } catch { /* optional */ }
    res.json({ ok: true, decision, master: { _id: String(master._id), name: master.name, province: master.province } });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Flag an unlinked client for manual review (records the decision; no data change).
router.post("/:id/flag-manual-review", requirePermission(PERM, "edit"), async (req, res) => {
  try {
    const LguLinkAudit = require("../models/LguLinkAudit");
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Client not found" });
    const client = await SlfClient.findById(req.params.id).select("name municipalityCity province type").lean();
    if (!client) return res.status(404).json({ message: "Client not found" });
    await LguLinkAudit.create({
      client: req.params.id,
      originalValue: client.municipalityCity || client.name || "",
      originalProvince: client.province || "",
      decision: "manual-review",
      method: "manual",
      reviewer: req.headers["x-user-name"] || req.headers["x-user-email"] || "admin",
      notes: String(req.body?.notes || "").slice(0, 500),
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});
router.get("/:id", requirePermission(PERM, "view"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Client not found" });
    const record = await SlfClient.findOne({ _id: req.params.id, deletedAt: null }).lean();
    if (!record) return res.status(404).json({ message: "Client not found" });
    res.json(record);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Create ──
router.post("/", requirePermission(PERM, "edit"), async (req, res) => {
  try {
    const body = pickBody(req.body);
    const errors = validate(body);
    if (errors.length) return res.status(400).json({ message: errors.join(", ") });

    const dup = await findDuplicate({ name: body.name, type: body.type });
    if (dup) return res.status(409).json({ message: "A client with this name and type already exists" });

    const record = new SlfClient({ ...body, createdBy: actor(req), updatedBy: actor(req) });
    await applyRegionClass(record);
    syncSingleRelationship(record);
    await record.save();
    res.status(201).json(record);
    clearRelMapCache();
    refreshAdmin(req, "slf-clients");
    writeLog("info", "slf-clients.create", { message: `SLF client created: ${record.name} (${record.type})`, req });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Update ──
router.put("/:id", requirePermission(PERM, "edit"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Client not found" });
    const record = await SlfClient.findOne({ _id: req.params.id, deletedAt: null });
    if (!record) return res.status(404).json({ message: "Client not found" });

    const body = pickBody(req.body);
    const errors = validate(body, { partial: true });
    if (errors.length) return res.status(400).json({ message: errors.join(", ") });

    const nextName = body.name !== undefined ? body.name : record.name;
    const nextType = body.type !== undefined ? body.type : record.type;
    const dup = await findDuplicate({ name: nextName, type: nextType, excludeId: record._id });
    if (dup) return res.status(409).json({ message: "A client with this name and type already exists" });

    const locationChanged = ["province", "region", "municipalityCity", "address", "location", "name", "type"]
      .some((k) => body[k] !== undefined && body[k] !== record[k]);
    Object.assign(record, body);
    if (locationChanged || record.regionClass === "unclassified") {
      await applyRegionClass(record);
    }
    syncSingleRelationship(record);
    record.updatedBy = actor(req);
    await record.save();
    res.json(record);
    clearRelMapCache();
    refreshAdmin(req, "slf-clients");
    writeLog("info", "slf-clients.update", { message: `SLF client updated: ${record.name}`, req });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Activate / deactivate (non-destructive) — requires delete permission ──
router.patch("/:id/status", requirePermission(PERM, "delete"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Client not found" });
    const { status } = req.body;
    if (!["Active", "Inactive"].includes(status)) return res.status(400).json({ message: "Status must be Active or Inactive" });
    const record = await SlfClient.findOne({ _id: req.params.id, deletedAt: null });
    if (!record) return res.status(404).json({ message: "Client not found" });
    record.status = status;
    record.updatedBy = actor(req);
    await record.save();
    res.json(record);
    clearRelMapCache();
    refreshAdmin(req, "slf-clients");
    writeLog("warn", "slf-clients.status", { message: `SLF client ${status === "Active" ? "activated" : "deactivated"}: ${record.name}`, req });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Soft delete — requires delete permission ──
router.delete("/:id", requirePermission(PERM, "delete"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Client not found" });
    const record = await SlfClient.findOne({ _id: req.params.id, deletedAt: null });
    if (!record) return res.status(404).json({ message: "Client not found" });
    record.deletedAt = new Date();
    record.deletedBy = actor(req);
    await record.save();
    res.json({ message: "Client deleted" });
    clearRelMapCache();
    refreshAdmin(req, "slf-clients");
    writeLog("warn", "slf-clients.delete", { message: `SLF client deleted: ${record.name}`, req });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
// Exposed so the LGU masterlist route can invalidate the served/unserved counts
// immediately when masterlist entries change (add/edit/delete/import).
module.exports.clearRelMapCache = clearRelMapCache;
// Pure helpers behind the VERA issue repair, exposed for tests — these decide a
// value that gets WRITTEN to a client record, so their ranking rules are pinned.
module.exports.proposeMunicipalityMatch = proposeMunicipalityMatch;
module.exports.buildIssueSuggestion = buildIssueSuggestion;
