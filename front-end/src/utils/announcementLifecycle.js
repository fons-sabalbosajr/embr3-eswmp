// ── Announcement lifecycle: the pure rules ──────────────────────────────────
//
// Split out of announcementStatus.jsx, which also exports icon ELEMENTS and so
// cannot be imported by the `node --test` suite. Everything decidable about an
// announcement — what status it is in, and which one to present as current —
// lives here as plain functions; the .jsx re-exports them, so every existing
// import keeps working unchanged.
//
// This is the ONE place the lifecycle is defined. Status conditions are never
// duplicated: a surface that needs to know whether an announcement is live asks
// resolveAnnouncementStatus rather than testing `enabled` itself.
//
//   enabled  window vs now                  → status
//   ───────  ────────────────────────────     ─────────────
//   true     now < startAt                  → scheduled
//   true     endAt && now > endAt           → expired
//   true     otherwise                      → active
//   false    endAt && now > endAt           → expired
//   false    startAt && now >= startAt      → unpublished (window reached, toggled off)
//   false    otherwise                      → draft
//
// All comparisons use epoch milliseconds (UTC-consistent), so stored ISO dates
// and `Date.now()` compare correctly regardless of the viewer's timezone.

export const ANNOUNCEMENT_STATUSES = ["draft", "scheduled", "active", "unpublished", "expired"];

export function resolveAnnouncementStatus(a, now = Date.now()) {
  const start = a?.startAt ? new Date(a.startAt).getTime() : null;
  const end = a?.endAt ? new Date(a.endAt).getTime() : null;
  const hasStart = start != null && !Number.isNaN(start);
  const hasEnd = end != null && !Number.isNaN(end);
  const expired = hasEnd && now > end;

  if (a?.enabled) {
    if (hasStart && now < start) return "scheduled";
    if (expired) return "expired";
    return "active";
  }
  if (expired) return "expired";
  if (hasStart && now >= start) return "unpublished";
  return "draft";
}

/**
 * THE announcement to present as current — one, not a list.
 *
 * A report is a statement of record, and a stack of six announcements in it reads
 * as history rather than as the notice actually in force. This picks the single
 * one to show, ranked by the status defined above rather than by re-deriving
 * "enabled":
 *
 *   active → scheduled → unpublished → draft → expired
 *
 * and, within a rank, the most recent by start date, falling back to when it was
 * last touched. `expired` ranks last so a stale notice only ever appears when
 * there is nothing else at all.
 *
 * Returns null when there is nothing worth showing, which callers render as
 * "no active announcement" rather than an empty bullet.
 */
const PRESENTATION_RANK = ["active", "scheduled", "unpublished", "draft", "expired"];

export function selectLatestAnnouncement(announcements, now = Date.now()) {
  const list = (Array.isArray(announcements) ? announcements : []).filter(
    (item) => item && (item.title || item.message),
  );
  if (!list.length) return null;
  const rankOf = (item) => {
    const index = PRESENTATION_RANK.indexOf(resolveAnnouncementStatus(item, now));
    return index === -1 ? PRESENTATION_RANK.length : index;
  };
  const timeOf = (item) =>
    new Date(item.startAt || item.updatedAt || item.createdAt || 0).getTime() || 0;
  return list.reduce((best, item) => {
    const byRank = rankOf(item) - rankOf(best);
    if (byRank !== 0) return byRank < 0 ? item : best;
    return timeOf(item) > timeOf(best) ? item : best;
  }, list[0]);
}
