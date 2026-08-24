/**
 * The admin colour palette.
 *
 * Why this file exists
 * --------------------
 * The SLF admin screens had grown to 15 distinct hex values, several of which
 * were doing the same job: three blues barely distinguishable from one another
 * (#1677ff, #1890ff, #2f54eb) and two purples (#722ed1, #9254de). Because every
 * value was written inline at its point of use, nothing stopped the next tile
 * from inventing a sixteenth.
 *
 * The set below is deliberately small. Import from here rather than typing a hex
 * literal — that is the whole point of the module.
 *
 * Semantic vs categorical
 * -----------------------
 * STATUS colours carry meaning and must not be reused for decoration: green is
 * "this is fine", amber is "this needs attention", red is "this is wrong". If a
 * tile is not reporting a state, it should not be green, amber or red.
 *
 * Everything else — LGU vs Private, one data domain vs another — is CATEGORICAL:
 * it only has to be told apart, not interpreted. Those draw from the brand
 * family (navy → mid → blue → light blue), which reads as one system instead of
 * a bag of unrelated hues.
 */

// ── Brand family (categorical) ──────────────────────────────────────────────
/** Primary brand navy. Headings, totals, primary actions. */
export const NAVY = "#1a3353";
/** Mid navy. Already used in the app's gradients; the second categorical slot. */
export const NAVY_MID = "#2d5f8a";
/** Informational blue. LGU throughout admin and portal. */
export const BLUE = "#1677ff";
/** Light blue. A fourth categorical slot inside the blue family. */
export const BLUE_LIGHT = "#69b1ff";

// ── Status (semantic — do not use decoratively) ─────────────────────────────
/** Active, complete, healthy. */
export const GREEN = "#52c41a";
/** Pending, nearing a limit, needs attention. */
export const AMBER = "#fa8c16";
/** Failed, rejected, over capacity, destructive. */
export const RED = "#ff4d4f";

// ── Neutral ─────────────────────────────────────────────────────────────────
/** Secondary text and muted icons. */
export const MUTED = "#8c8c8c";

/**
 * Avatar tints, cycled by hash to tell one client from another.
 *
 * This is a categorical encoding whose only job is contrast between adjacent
 * rows, so the two status colours that read as alarming (amber, red) are left
 * out — a client is not "a warning" because of where its name hashed.
 */
export const AVATAR_COLORS = [NAVY, BLUE, NAVY_MID, BLUE_LIGHT, GREEN];

/** The two dimensions the Region 3 tiles encode: hue = type, tint = region. */
export const REGION_TILE = {
  lguWithin: BLUE,
  lguOutside: BLUE_LIGHT,
  privateWithin: NAVY,
  privateOutside: NAVY_MID,
};
