const mongoose = require("mongoose");
const { normalizeName } = require("../utils/region3");

// Region 3 (Central Luzon) LGU master data — the official province/city/
// municipality list used to classify clients as within/outside Region 3.
// Managed under Developer → App Settings → Region 3 LGU Data.
// "Special Zone" covers freeports and special economic zones (Clark Freeport
// Zone, Subic Bay Freeport Zone, Freeport Area of Bataan …). They are real
// addresses that PSGC does not list as subdivisions, so they cannot arrive via
// the PSGC import — utils/specialZones ships the nationally chartered ones as
// built-ins, and this type is how an admin encodes any that are missing.
const LGU_TYPES = ["Province", "City", "Municipality", "Special Zone"];
const MUNI_TYPES = ["Municipality", "City", "Special Zone"];

const region3LguSchema = new mongoose.Schema(
  {
    psgcCode: { type: String, trim: true, default: "" },
    name: { type: String, required: true, trim: true },
    normalizedName: { type: String, trim: true, default: "", index: true },
    lguType: { type: String, enum: LGU_TYPES, default: "Municipality", index: true },
    province: { type: String, trim: true, default: "", index: true },
    normalizedProvince: { type: String, trim: true, default: "" },
    municipalityCity: { type: String, trim: true, default: "" },
    region: { type: String, trim: true, default: "Region III" },
    status: { type: String, enum: ["Active", "Inactive"], default: "Active", index: true },
    aliases: [{ type: String, trim: true }],
    notes: { type: String, trim: true, default: "" },
    source: { type: String, trim: true, default: "manual" }, // manual | import
    createdBy: { type: String, trim: true, default: "" },
    updatedBy: { type: String, trim: true, default: "" },
  },
  { timestamps: true, collection: "region3_lgus" }
);

region3LguSchema.pre("save", function () {
  if (this.isModified("name")) this.normalizedName = normalizeName(this.name);
  if (this.isModified("province")) this.normalizedProvince = normalizeName(this.province);
});

// Non-unique indexes only — the data may arrive unclean, so no unique constraint
// is added here (duplicate prevention is handled in the route/import logic).
region3LguSchema.index({ psgcCode: 1 });
region3LguSchema.index({ normalizedName: 1, normalizedProvince: 1, lguType: 1 });
// Backs the masterlist query used on every reconciliation / relationship-map load:
// { status: "Active", lguType: { $in: ["Municipality", "City"] } }.
region3LguSchema.index({ status: 1, lguType: 1 });

region3LguSchema.statics.LGU_TYPES = LGU_TYPES;
// The types that can be a client's City/Municipality value — i.e. everything a
// municipality-level matcher may resolve to. Exported rather than re-spelled at
// each call site: it was already duplicated across seven queries, which is how
// "Special Zone" would otherwise have been added to some of them and not others.
region3LguSchema.statics.MUNI_TYPES = MUNI_TYPES;
region3LguSchema.statics.normalize = normalizeName;

module.exports = mongoose.model("Region3Lgu", region3LguSchema);
