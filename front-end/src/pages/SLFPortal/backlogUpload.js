// ── Backlog upload (pure, unit-tested) ──
//
// A disposal upload whose rows carry MORE THAN ONE Disposal Date is a backlog:
// up to one month of missed days in one file. The server splits it into one
// submission per date (server/utils/backlogEntries.js) and enforces the window;
// these helpers show the same rules in the upload preview and in Data Entry, so
// the operator sees a bad date before submitting rather than after.
//
// Days are "YYYY-MM-DD" strings throughout — the format the upload parser
// produces — so comparing them as strings compares them as dates.

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n) => String(n).padStart(2, "0");

/** Today as "YYYY-MM-DD" in the browser's calendar. */
export function todayKey(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The same calendar day one month earlier (Mar 31 → Feb 28/29). */
export function oneMonthBefore(day) {
  if (!DAY_RE.test(day)) return day;
  let [year, month, date] = day.split("-").map(Number);
  month -= 1;
  if (month === 0) {
    month = 12;
    year -= 1;
  }
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${pad(month)}-${pad(Math.min(date, lastDay))}`;
}

export function backlogWindow(now = new Date()) {
  const to = todayKey(now);
  return { from: oneMonthBefore(to), to };
}

export function formatDay(day) {
  if (!DAY_RE.test(String(day || ""))) return String(day || "");
  const [y, m, d] = day.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

const rowDay = (row) => {
  const value = String(row?.disposalDate || "").trim();
  return DAY_RE.test(value) ? value : "";
};

/** Distinct, sorted disposal dates across rows / trucks. */
export function distinctDays(rows, fallbackDay = "") {
  const set = new Set();
  for (const row of rows || []) {
    const day = rowDay(row) || fallbackDay;
    if (day) set.add(day);
  }
  return [...set].sort();
}

/** Why one day is outside the backlog window, or "" when it is fine. */
export function backlogDateIssue(day, window) {
  if (!day) return "";
  if (day > window.to) return `Disposal Date ${formatDay(day)} is in the future`;
  if (day < window.from) {
    return `Disposal Date ${formatDay(day)} is more than one month ago — a backlog upload can go back to ${formatDay(window.from)}`;
  }
  return "";
}

/**
 * Preview rows with the backlog-window rule applied: when the file spans more
 * than one date, a row dated in the future or more than a month back gets an
 * error (added to its `_errors`, never stored). Single-date files are returned
 * unchanged — the window applies only to backlogs, as on the server.
 */
export function applyBacklogRules(rows, { now = new Date() } = {}) {
  if (distinctDays(rows).length <= 1) return rows;
  const window = backlogWindow(now);
  return rows.map((row) => {
    const issue = backlogDateIssue(rowDay(row), window);
    if (!issue) return row;
    return { ...row, _errors: [...(row._errors || []), issue] };
  });
}

/**
 * What Data Entry is about to submit when its trucks span several dates:
 * one line per day. null for an ordinary single-day entry.
 * @returns {null | { days: { day, trucks, volume }[], from, to, outOfWindow: string[] }}
 */
export function summarizeBacklog(trucks, fallbackDay = "", { now = new Date() } = {}) {
  const days = distinctDays(trucks, fallbackDay);
  if (days.length <= 1) return null;
  const byDay = new Map(days.map((day) => [day, { day, trucks: 0, volume: 0 }]));
  for (const truck of trucks || []) {
    const bucket = byDay.get(rowDay(truck) || fallbackDay);
    if (!bucket) continue;
    bucket.trucks += 1;
    const vehicles = Array.isArray(truck.vehicles) && truck.vehicles.length ? truck.vehicles : [truck];
    bucket.volume += vehicles.reduce((sum, v) => sum + (Number(v?.actualVolume) || 0), 0);
  }
  const window = backlogWindow(now);
  return {
    days: [...byDay.values()],
    from: days[0],
    to: days[days.length - 1],
    outOfWindow: days.filter((day) => backlogDateIssue(day, window)),
  };
}
