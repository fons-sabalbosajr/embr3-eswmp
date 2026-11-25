// ── Draft autosave: when to save ──
//
// Pure timing rules for Data Entry's autosave, kept free of React so they can
// be unit-tested. The hook (useDraftAutosave.js) polls the entry, turns it into
// a signature string, and asks `autosaveDecision` what to do on each tick.
//
// A signature of `null` means the entry is empty (no trucks and no Date of
// Disposal) — the same "nothing to save" rule manual Save as Draft applies, so
// autosave never files a blank draft.

// Save once the entry has been unchanged for this long, so a burst of typing
// becomes one save instead of one per keystroke.
export const AUTOSAVE_IDLE_MS = 4000;
// How often the entry is checked for changes.
export const AUTOSAVE_POLL_MS = 1500;
// After a failed save, wait this long before retrying the SAME content. A new
// edit retries straight away (after the idle delay), since it may be what fixes it.
export const AUTOSAVE_RETRY_MS = 30000;

/**
 * Decide what the autosave poller does on one tick.
 *
 * @param {object} s
 * @param {string|null} s.signature  current entry signature (null = empty)
 * @param {string|null} s.savedSignature  signature of the last successful save
 * @param {string|null} s.seenSignature  signature seen on the previous tick
 * @param {number} s.changedAt  when `seenSignature` was first seen (ms)
 * @param {string|null} s.failedSignature  signature whose save last failed
 * @param {number} s.failedAt  when that save failed (ms)
 * @param {number} s.now  current time (ms)
 * @returns {{ action: "empty"|"clean"|"changed"|"wait"|"save" }}
 *   empty   — nothing to save; status goes idle
 *   clean   — matches the last save; nothing to do
 *   changed — a new edit; remember it and restart the idle timer
 *   wait    — edited, but still inside the idle (or retry) delay
 *   save    — save now
 */
export function autosaveDecision({
  signature,
  savedSignature,
  seenSignature,
  changedAt,
  failedSignature = null,
  failedAt = 0,
  now,
  idleMs = AUTOSAVE_IDLE_MS,
  retryMs = AUTOSAVE_RETRY_MS,
}) {
  if (signature == null) return { action: "empty" };
  if (signature === savedSignature) return { action: "clean" };
  if (signature !== seenSignature) return { action: "changed" };
  if (now - changedAt < idleMs) return { action: "wait" };
  if (signature === failedSignature && now - failedAt < retryMs) return { action: "wait" };
  return { action: "save" };
}
