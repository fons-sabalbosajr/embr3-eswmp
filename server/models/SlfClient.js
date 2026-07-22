const mongoose = require("mongoose");

// Managed Sanitary Landfill client — the LGU / Private-sector entity a portal user
// and its accredited hauler dispose waste on behalf of. Persisted (unlike the
// baseline-derived Hauler→Clients view) so admins can add/edit/deactivate clients
// and the SLF dashboard "LGUs Served" / "Private Sectors Served" tiles can count
// unique, active, non-deleted client records.
const slfClientSchema = new mongoose.Schema(
  {
    // Display name of the client entity.
    name: { type: String, required: true, trim: true },
    // Case/space-normalized name — used for duplicate detection and unique counts.
    normalizedName: { type: String, trim: true, index: true },

    // LGU vs Private-sector classification.
    type: {
      type: String,
      enum: ["LGU", "Private Sector"],
      required: true,
      index: true,
    },

    // Assigned portal user (SLF facility account). Optional — a client may be
    // recorded before assignment.
    portalUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserPortal",
      default: null,
      index: true,
    },
    // Denormalized display cache so the table renders without a populate round-trip
    // and history survives portal-user deletion.
    portalUserName: { type: String, trim: true, default: "" },

    // Assigned hauler. Haulers are declared inside portal baselines (no standalone
    // Hauler model). The display name is stored here; `normalizedHauler` (lower/
    // trim/space-collapsed) is the stable value used for dedupe + matching, so
    // casing/whitespace variants of the same hauler never diverge.
    hauler: { type: String, trim: true, default: "" },
    normalizedHauler: { type: String, trim: true, default: "", index: true },

    // Provenance: "baseline" records are synced from portal baseline
    // accreditedHaulers→clients; "admin-managed" records are created/edited by
    // hand in the Clients page. The sync only ever writes/updates "baseline"
    // records, so admin-managed data is never overwritten.
    source: {
      type: String,
      enum: ["baseline", "admin-managed"],
      default: "admin-managed",
      index: true,
    },
    // Baseline (DataSLF) record this client was last synced from.
    baselineRef: { type: mongoose.Schema.Types.ObjectId, ref: "DataSLF", default: null },
    // Portal account email that declared the client in its baseline (baselines
    // carry `submittedBy` email, which may predate a resolvable portalUser id).
    portalUserEmail: { type: String, trim: true, lowercase: true, default: "", index: true },
    // Stable identity for baseline-sourced records — sparse-unique so re-running
    // the sync upserts instead of duplicating. Unset on admin-managed records.
    syncKey: { type: String, trim: true, default: undefined },

    // ── Canonical-client model ──
    // Exactly ONE canonical profile per unique client (normalizedName + type),
    // regardless of how many haulers / portal users / baselines list it. The
    // canonicalKey is the match key; isCanonical=false + mergedInto point a merged
    // duplicate at its survivor. Only canonical, non-merged, non-deleted rows are
    // shown and counted.
    canonicalKey: { type: String, trim: true, default: "", index: true },
    isCanonical: { type: Boolean, default: true, index: true },
    mergedInto: { type: mongoose.Schema.Types.ObjectId, ref: "SlfClient", default: null },
    // "Single Portal User" | "Multiple Portal Users" | "Unassigned" — derived from
    // the distinct portal users in portalUserRelationships (kept in sync on save).
    multiPortalStatus: { type: String, default: "Unassigned", index: true },

    // Per-portal-user relationship (a valid client may belong to several portal
    // users; that is NOT a duplicate). De-duplicated by (portalUser|hauler|baseline).
    portalUserRelationships: [{
      portalUser: { type: mongoose.Schema.Types.ObjectId, ref: "UserPortal", default: null },
      portalUserEmail: { type: String, trim: true, lowercase: true, default: "" },
      portalUserName: { type: String, trim: true, default: "" },
      hauler: { type: String, trim: true, default: "" },
      normalizedHauler: { type: String, trim: true, default: "" },
      baselineRef: { type: mongoose.Schema.Types.ObjectId, ref: "DataSLF", default: null },
      status: { type: String, trim: true, default: "active" },
      firstSyncedAt: { type: Date, default: Date.now },
      lastSyncedAt: { type: Date, default: Date.now },
    }],
    // Distinct haulers this client is served by (across all relationships).
    haulerRelationships: [{
      hauler: { type: String, trim: true, default: "" },
      normalizedHauler: { type: String, trim: true, default: "" },
      lastSyncedAt: { type: Date, default: Date.now },
    }],
    // Distinct baseline (DataSLF) records that declared this client.
    baselineReferences: [{ type: mongoose.Schema.Types.ObjectId, ref: "DataSLF" }],

    // ── Synchronization metadata ──
    lastSyncedAt: { type: Date, default: null },
    syncJobId: { type: mongoose.Schema.Types.ObjectId, ref: "SlfSyncJob", default: null },
    // What the last sync did with this record: created | updated | merged | skipped.
    syncAction: { type: String, trim: true, default: "" },
    // Audit trail of records merged into this canonical record (dedupe).
    mergedFrom: [{
      clientId: { type: mongoose.Schema.Types.ObjectId },
      name: { type: String, trim: true },
      source: { type: String, trim: true },
      mergedAt: { type: Date, default: Date.now },
    }],

    // Location / contact — all optional ("when available").
    location: { type: String, trim: true, default: "" },
    province: { type: String, trim: true, default: "", index: true },
    municipalityCity: { type: String, trim: true, default: "" },
    region: { type: String, trim: true, default: "" },
    // within-region-3 | outside-region-3 | unclassified (see utils/region3).
    regionClass: { type: String, trim: true, default: "unclassified", index: true },
    address: { type: String, trim: true, default: "" },
    contactPerson: { type: String, trim: true, default: "" },
    contactNumber: { type: String, trim: true, default: "" },
    contactEmail: { type: String, trim: true, lowercase: true, default: "" },

    // Active / Inactive. Deactivating is the non-destructive alternative to delete.
    status: {
      type: String,
      enum: ["Active", "Inactive"],
      default: "Active",
      index: true,
    },

    notes: { type: String, trim: true, default: "" },

    // Marks demo/test records created via Dummy Data tooling so they can be filtered
    // out of real reporting — mirrors the other SLF models.
    isDummy: { type: Boolean, default: false, index: true },

    createdBy: { type: String, trim: true, default: "" },
    updatedBy: { type: String, trim: true, default: "" },

    // Soft delete — same convention as SlfFacility.
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String, trim: true, default: null },
  },
  { timestamps: true, collection: "slf_clients" }
);

// Shared normalizer for names + haulers: trim, lowercase, collapse whitespace.
// This is what makes "  ABC  Hauler " and "abc hauler" the SAME value, so casing
// and stray spaces can never create duplicate haulers or clients.
function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}
slfClientSchema.pre("save", function () {
  if (this.isModified("name")) this.normalizedName = normalize(this.name);
  if (this.isModified("hauler")) this.normalizedHauler = normalize(this.hauler);
  // Keep canonicalKey + multiPortalStatus derived so they never drift.
  this.canonicalKey = `${normalize(this.name)}|${this.type || ""}`;
  const rels = Array.isArray(this.portalUserRelationships) ? this.portalUserRelationships : [];
  const distinct = new Set(rels.map((r) => String(r.portalUser || r.portalUserEmail || "")).filter(Boolean));
  this.multiPortalStatus = distinct.size > 1 ? "Multiple Portal Users" : distinct.size === 1 ? "Single Portal User" : "Unassigned";
});
slfClientSchema.statics.normalize = normalize;

// Canonical identity: one profile per normalized name + type.
slfClientSchema.statics.buildCanonicalKey = function buildCanonicalKey({ name, type }) {
  return `${normalize(name)}|${type || ""}`;
};

// Stable identity for a baseline-sourced client. Same inputs → same key across
// re-runs, so the sync upserts rather than duplicating. Excludes free-form
// contact/location so those can be refreshed without minting a new record.
slfClientSchema.statics.buildSyncKey = function buildSyncKey({ name, type, hauler, portalUserEmail }) {
  return [
    normalize(name),
    String(type || "").toLowerCase(),
    normalize(hauler),
    String(portalUserEmail || "").trim().toLowerCase(),
  ].join("|");
};

// Sparse + unique: enforced only for baseline records that set `syncKey`.
// Admin-managed records leave it unset and are unaffected — safe on existing data.
slfClientSchema.index({ syncKey: 1 }, { unique: true, sparse: true });
// Canonical lookup (non-unique — pre-existing unclean data may still have dups
// until the cleanup migration runs; the sync/cleanup collapse them safely).
slfClientSchema.index({ canonicalKey: 1, isCanonical: 1, deletedAt: 1 });

module.exports = mongoose.model("SlfClient", slfClientSchema);
