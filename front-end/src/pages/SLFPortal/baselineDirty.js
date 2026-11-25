// ── Unsaved baseline changes (pure, unit-tested) ──
//
// Baseline edits go live only through Save Baseline Update — they are never
// autosaved (a half-typed volume would reach EMB's views and the next
// submission). What the portal does instead is NOTICE unsaved edits and keep
// them from being lost: a warning before the page is closed / the user logs out
// / switches SLF, and no silent reload over them when EMB changes the baseline.
//
// "Unsaved" = the baseline as it stands now differs from the snapshot taken
// when it was last loaded or saved. The snapshot is a signature string.

/** JSON with every `key` dropped — row keys are UI identity, not data. */
export function baselineSignature({ baseline, company, activeCells, closedCells, haulers, mov, acceptsHazardous }) {
  return JSON.stringify(
    {
      baseline: baseline || {},
      company: company || {},
      activeCells: activeCells || [],
      closedCells: closedCells || [],
      haulers: haulers || [],
      mov: mov || {},
      acceptsHazardous: Boolean(acceptsHazardous),
    },
    function replacer(name, value) {
      if (name === "key") return undefined;
      // dayjs values (dates in the forms) compare by the day they hold. Read
      // from the holder: by the time `value` arrives here, toJSON has already
      // turned it into a full timestamp.
      const raw = this[name];
      if (raw && typeof raw === "object" && typeof raw.format === "function" && typeof raw.isValid === "function") {
        return raw.isValid() ? raw.format("YYYY-MM-DD") : null;
      }
      return value;
    },
  );
}

/** Are there unsaved edits? false until a snapshot exists. */
export function isBaselineDirty(snapshot, current) {
  return snapshot != null && current != null && snapshot !== current;
}
