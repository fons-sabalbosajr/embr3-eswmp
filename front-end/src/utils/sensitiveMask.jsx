import { createContext, useContext, useMemo } from "react";

// ── SLF Portal sensitive-value masking — the ONE centralized privacy resolver ──
//
// A single global setting (`maskSensitiveSlfValues`, developer-controlled) turns
// masking on. When ON, sensitive SLF Portal values render as the placeholder
// below instead of the real number/text — on screen, in tooltips, in tables, in
// charts labels, in print, and in exports. This module is the ONLY place masking
// logic lives; every surface calls `displaySensitiveValue` / `<MaskedValue>` /
// `useSensitiveMask` rather than scattering `if (masked)` checks.
//
// Design rules honored here:
//   • CSS blur is insufficient — we replace the RENDERED value with the
//     placeholder, so the real value never reaches the DOM, a tooltip, a chart
//     payload, an export cell, or the print output.
//   • The underlying data is never altered — masking is a display concern only.
//     Calculations/aggregations keep using the real values; only the formatted
//     output is masked.

export const MASK_PLACEHOLDER = "*****";

// Categories that are considered sensitive when masking is enabled. Kept as a
// set so the classification is declarative and easy to extend. All are masked
// together under the single global toggle (per the configured scope: waste
// volumes/tonnage, cell capacity/fill, contact/account identifiers, financial).
export const SENSITIVE_CATEGORIES = Object.freeze({
  volume: "volume", // waste volume / tonnage
  capacity: "capacity", // cell/infrastructure capacity, remaining, fill %
  contact: "contact", // emails, phones, account identifiers, reference ids
  financial: "financial", // fees / monetary values
});

const SensitiveMaskContext = createContext({ masked: false });

/**
 * Provide the masking state to a subtree. `masked` comes from the global
 * `maskSensitiveSlfValues` setting the portal already loads.
 */
export function SensitiveMaskProvider({ masked, children }) {
  const value = useMemo(() => ({ masked: !!masked }), [masked]);
  return <SensitiveMaskContext.Provider value={value}>{children}</SensitiveMaskContext.Provider>;
}

/** Hook: `const { masked } = useSensitiveMask();` */
export function useSensitiveMask() {
  return useContext(SensitiveMaskContext);
}

/**
 * The core resolver. Returns the masked placeholder when masking is on, else the
 * formatted (or raw) value.
 *
 * @param {*} value                     the real value
 * @param {object} opts
 * @param {boolean} opts.masked         whether masking is active
 * @param {(v:any)=>any} [opts.format]  formatter applied to the real value
 * @param {string} [opts.placeholder]   override placeholder (default *****)
 * @param {*} [opts.empty]              value to show when `value` is null/"" (not masked)
 */
export function displaySensitiveValue(value, opts = {}) {
  const { masked, format, placeholder = MASK_PLACEHOLDER, empty } = opts;
  const isEmpty = value == null || value === "";
  if (isEmpty && empty !== undefined && !masked) return empty;
  if (masked) return placeholder;
  return typeof format === "function" ? format(value) : value;
}

/**
 * Component form — reads `masked` from context so callers don't have to thread
 * it. Use inside a `SensitiveMaskProvider`.
 *
 *   <MaskedValue value={row.totalVolumeTons} format={(v) => formatCompact(v)} />
 */
export function MaskedValue({ value, format, placeholder = MASK_PLACEHOLDER, empty = "—" }) {
  const { masked } = useSensitiveMask();
  const out = displaySensitiveValue(value, { masked, format, placeholder, empty });
  return <>{out == null || out === "" ? empty : out}</>;
}
