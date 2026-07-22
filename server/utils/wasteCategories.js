/**
 * Canonical waste-category definitions — the single source of truth shared by the
 * portal submission flow, the DataSLF model metrics, the admin aggregations and any
 * report/export. Keep this in sync with front-end/src/utils/wasteCategories.js.
 *
 * The truck-level `wasteType` field is a strict Mongoose enum. Portal dropdowns send
 * a valid value, but Excel-imported rows, legacy records and per-vehicle entries can
 * carry free text or abbreviations ("Hazardous", "HW", "hazardous_waste", …). Every
 * write path normalizes through `normalizeWasteType`, and every classifier uses
 * `isHazardousWasteType`, so the portal, backend and admin never disagree on whether
 * a load counts as hazardous.
 */

// The only values ever persisted on truck/vehicle `wasteType`.
const RESIDUAL = "Residual";
const HAZARDOUS = "Hazardous Waste";
const TREATED_HAZARDOUS = "Treated Hazardous Waste";

const WASTE_CATEGORY_ENUM = [RESIDUAL, HAZARDOUS, TREATED_HAZARDOUS];

/**
 * Map any free-text / legacy / abbreviated waste-type value to a canonical category.
 * Returns `undefined` for empty input (the schema allows an absent value; an empty
 * string would fail the enum). Anything unrecognized falls back to "Residual" so a
 * save never throws an enum ValidationError.
 */
function normalizeWasteType(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  if (WASTE_CATEGORY_ENUM.includes(raw)) return raw;
  const low = raw.toLowerCase().replace(/[_-]+/g, " ").trim();
  if (low.includes("treated")) return TREATED_HAZARDOUS;
  // "hw" abbreviation, or anything containing "haz"/"inert".
  if (low === "hw" || /\bhw\b/.test(low) || low.includes("haz") || low.includes("inert")) {
    return HAZARDOUS;
  }
  if (low.includes("residual")) return RESIDUAL;
  return RESIDUAL;
}

/**
 * True when a waste-type value classifies as hazardous (treated or untreated).
 * Backward-compatible with every legacy variant via `normalizeWasteType`.
 */
function isHazardousWasteType(value) {
  const normalized = normalizeWasteType(value);
  return normalized === HAZARDOUS || normalized === TREATED_HAZARDOUS;
}

module.exports = {
  RESIDUAL,
  HAZARDOUS,
  TREATED_HAZARDOUS,
  WASTE_CATEGORY_ENUM,
  normalizeWasteType,
  isHazardousWasteType,
};
