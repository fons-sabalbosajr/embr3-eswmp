/**
 * Canonical waste-category definitions for the front-end. Mirror of
 * server/utils/wasteCategories.js — keep the two in sync so the portal, backend and
 * admin agree on how a load is classified.
 *
 * Only three values are ever persisted on truck/vehicle `wasteType`. Everything the
 * UI classifies (badges, filters, breakdowns) goes through `isHazardousWasteType`,
 * and any value written to the API is passed through `normalizeWasteType`.
 */

export const RESIDUAL = "Residual";
export const HAZARDOUS = "Hazardous Waste";
export const TREATED_HAZARDOUS = "Treated Hazardous Waste";

export const WASTE_CATEGORY_ENUM = [RESIDUAL, HAZARDOUS, TREATED_HAZARDOUS];

/**
 * Map any free-text / legacy / abbreviated waste-type value to a canonical category.
 * Returns `undefined` for empty input; unrecognized values fall back to "Residual".
 */
export function normalizeWasteType(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  if (WASTE_CATEGORY_ENUM.includes(raw)) return raw;
  const low = raw.toLowerCase().replace(/[_-]+/g, " ").trim();
  if (low.includes("treated")) return TREATED_HAZARDOUS;
  if (low === "hw" || /\bhw\b/.test(low) || low.includes("haz") || low.includes("inert")) {
    return HAZARDOUS;
  }
  if (low.includes("residual")) return RESIDUAL;
  return RESIDUAL;
}

/** True when a waste-type value classifies as hazardous (treated or untreated). */
export function isHazardousWasteType(value) {
  const normalized = normalizeWasteType(value);
  return normalized === HAZARDOUS || normalized === TREATED_HAZARDOUS;
}
