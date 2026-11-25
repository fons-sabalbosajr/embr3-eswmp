// ── Backlog upload: one file, many disposal dates, one submission per day ──
//
// A Data Entry bulk upload carries a Disposal Date on every row (truck). When an
// entry's trucks span MORE THAN ONE date it is a backlog — days the operator
// missed — and it is split here into one entry per disposal date, so each day
// becomes its own record with its own ID No. and date, exactly as if it had been
// entered day by day. Reports and capacity gauges then count each day correctly.
//
// The split runs inside submitEntries, so a direct submit, a draft submitted
// later from Drafts & Scheduled and a scheduled run are all split the same way.
//
// Backlog window: every date must be within the last month (Manila time) and not
// in the future. A single-date entry is untouched by this module — the window
// applies only to backlogs.
const { APP_UTC_OFFSET_MINUTES } = require("./appTime");

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})/;

/** "YYYY-MM-DD" for a date value, in Manila time; "" when it is not a date. */
function dayKey(value) {
  if (value === null || value === undefined || value === "") return "";
  const text = String(value).trim();
  // A bare calendar day is already the day the operator meant.
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = value instanceof Date ? value : new Date(text);
  if (Number.isNaN(date.getTime())) return DAY_RE.test(text) ? text.slice(0, 10) : "";
  const shifted = new Date(date.getTime() + APP_UTC_OFFSET_MINUTES * 60000);
  return shifted.toISOString().slice(0, 10);
}

function manilaToday(now = new Date()) {
  return dayKey(now);
}

/** The same calendar day one month earlier (Mar 31 → Feb 28/29). */
function oneMonthBefore(day) {
  const m = DAY_RE.exec(day);
  if (!m) return day;
  let year = Number(m[1]);
  let month = Number(m[2]) - 1; // 1-based → previous month, 1-based
  if (month === 0) {
    month = 12;
    year -= 1;
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const date = Math.min(Number(m[3]), lastDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
}

function formatDay(day) {
  const m = DAY_RE.exec(day);
  if (!m) return day;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** The accepted backlog window for `now`: { from, to } as "YYYY-MM-DD". */
function backlogWindow(now = new Date()) {
  const to = manilaToday(now);
  return { from: oneMonthBefore(to), to };
}

/**
 * Split one entry by its trucks' disposal dates.
 * A truck without its own date belongs to the entry's Date of Disposal.
 * @returns {{ entries: object[], days: string[], backlog: boolean }}
 */
function splitEntryByDisposalDate(entry) {
  const trucks = Array.isArray(entry?.trucks) ? entry.trucks : [];
  const fallback = dayKey(entry?.dateOfDisposal);
  const groups = new Map();
  for (const truck of trucks) {
    const day = dayKey(truck?.disposalDate) || fallback;
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(truck);
  }
  const days = [...groups.keys()].filter(Boolean).sort();
  if (groups.size <= 1) return { entries: [entry], days, backlog: false };
  const entries = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, dayTrucks]) => ({ ...entry, dateOfDisposal: day || entry.dateOfDisposal, trucks: dayTrucks }));
  return { entries, days, backlog: true };
}

/**
 * Expand every backlog entry in a submission into per-day entries and check
 * the window. Entries that are not backlogs pass through unchanged.
 * @returns {{ items: object[], errors: string[], backlogDays: number }}
 */
function expandBacklogEntries(items, { now = new Date() } = {}) {
  const { from, to } = backlogWindow(now);
  const errors = [];
  const out = [];
  let backlogDays = 0;
  for (const item of Array.isArray(items) ? items : []) {
    const { entries, days, backlog } = splitEntryByDisposalDate(item);
    if (!backlog) {
      out.push(item);
      continue;
    }
    backlogDays += entries.length;
    if (entries.some((e) => !dayKey(e.dateOfDisposal))) {
      errors.push("Every row of a backlog upload needs a Disposal Date.");
    }
    const future = days.filter((d) => d > to);
    const tooOld = days.filter((d) => d < from);
    if (future.length) {
      errors.push(`Future disposal dates cannot be submitted: ${future.map(formatDay).join(", ")}.`);
    }
    if (tooOld.length) {
      errors.push(
        `A backlog upload can go back one month (to ${formatDay(from)}). ` +
          `These dates are older: ${tooOld.slice(0, 5).map(formatDay).join(", ")}${tooOld.length > 5 ? ` and ${tooOld.length - 5} more` : ""}.`,
      );
    }
    out.push(...entries);
  }
  return { items: out, errors, backlogDays };
}

module.exports = {
  dayKey,
  manilaToday,
  oneMonthBefore,
  backlogWindow,
  splitEntryByDisposalDate,
  expandBacklogEntries,
  formatDay,
};
