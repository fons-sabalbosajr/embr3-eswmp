// Group Submission History rows the way the ADMIN side already groups them.
//
// The canonical grouping rules were traced from the existing model, not invented:
//
//  1. `submissionId` — a single portal submit creates a BATCH of DataSLF entries
//     that all share one submissionId (see submitEntries + PortalSubmissionQueue,
//     whose own comment calls it "the created DataSLF batch"). This is the real
//     group identifier, so it wins whenever it is present.
//
//  2. Otherwise the admin's grouped list view (routes/dataSLF.js `rowKeyExpr`)
//     keys a group on submittedBy + lguCompanyName, and forces anything that is
//     `reverted` — or missing an email/company — into its OWN row. Legacy records
//     with no submissionId are grouped by that same rule so the Portal and the
//     admin never disagree about what belongs together.
//
//  3. Anything that matches neither stays an individual record. No artificial
//     groups are created.
//
// Grouping is done here, over the list the history table already fetched, rather
// than as a separate server round-trip: the payload is one portal user's own
// submissions (tens of rows), so there is nothing to paginate away. If that ever
// grows, move this to an aggregation — do NOT start fetching more than the table
// already needs.

import { isResubmissionRecord } from "../../utils/resubmission.js";

const norm = (v) => String(v || "").trim().toLowerCase();

// A resubmission: a reverted entry corrected and sent back (see utils/resubmission).
const isResub = isResubmissionRecord;

// Latest RELEVANT activity for sorting: resubmittedAt (updatedAt) for a
// resubmission, otherwise submittedAt (createdAt). Missing/invalid → 0 (oldest).
const latestActivityOf = (s) => {
  const raw = isResub(s) ? s.updatedAt || s.createdAt : s.createdAt || s.updatedAt;
  const t = new Date(raw || 0).getTime();
  return Number.isFinite(t) ? t : 0;
};

// Mirrors the admin's rowKeyExpr singleton conditions.
function groupKeyFor(sub) {
  const id = String(sub?.submissionId || "").trim();
  if (id) return `sid:${id}`;

  const by = norm(sub?.submittedBy);
  const company = norm(sub?.lguCompanyName);
  const status = norm(sub?.status);
  // reverted rows, and rows missing an identity, are never grouped (admin rule).
  if (!by || !company || !by.includes("@") || status === "reverted") {
    return `singleton:${sub?._id}`;
  }
  return `identity:${by}::${company}`;
}

/**
 * @returns {Array} rows for the history table. A group row carries
 *   `{ isGroup: true, children: [...] }`; an ungrouped submission is returned as
 *   the submission itself so existing row rendering keeps working.
 */
export function groupSubmissions(submissions = []) {
  const buckets = new Map();
  for (const sub of submissions) {
    const key = groupKeyFor(sub);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(sub);
  }

  const rows = [];
  for (const [key, children] of buckets) {
    // A "group" of one is just that submission — do not wrap it in a parent row.
    if (children.length === 1) {
      rows.push({ ...children[0], isGroup: false, latestActivityAt: latestActivityOf(children[0]) });
      continue;
    }

    // Status summary — a group is NOT "Submitted" just because some children are.
    const statusCounts = {};
    for (const c of children) {
      const s = c.status || "pending";
      statusCounts[s] = (statusCounts[s] || 0) + 1;
    }
    const statuses = Object.keys(statusCounts);

    const dates = children
      .map((c) => c.dateOfDisposal || c.createdAt)
      .filter(Boolean)
      .map((d) => new Date(d).getTime())
      .filter((n) => Number.isFinite(n));

    rows.push({
      isGroup: true,
      key,
      _id: key,
      groupId: children[0].submissionId || null,
      children,
      count: children.length,
      // Existing, already-normalized denormalized metrics — no invented maths.
      totalVolumeM3: children.reduce((n, c) => n + Number(c.totalVolumeM3 || 0), 0),
      totalVolumeTons: children.reduce((n, c) => n + Number(c.totalVolumeTons || 0), 0),
      // Item #3: never silently add tons + m³. When a batch mixes both, keep the
      // per-unit totals separate (above) and flag the inconsistency so the UI can
      // show them apart with a warning.
      mixedUnits:
        children.some((c) => Number(c.totalVolumeTons || 0) > 0) &&
        children.some((c) => Number(c.totalVolumeM3 || 0) > 0),
      // Latest relevant activity across the batch (resubmittedAt/updatedAt for
      // resubmissions, else submittedAt/createdAt) — drives descending sort.
      latestActivityAt: Math.max(...children.map(latestActivityOf), 0),
      truckCount: children.reduce((n, c) => n + Number(c.truckCount || 0), 0),
      // Union of the cells the group's submissions were placed into (counts summed),
      // plus any waste still unassigned across the group.
      cellsAssigned: Object.values(
        children.reduce((acc, c) => {
          (c.cellsAssigned || []).forEach((cell) => {
            if (acc[cell.cellName]) acc[cell.cellName].count += cell.count;
            else acc[cell.cellName] = { ...cell };
          });
          return acc;
        }, {}),
      ),
      unplacedCount: children.reduce((n, c) => n + Number(c.unplacedCount || 0), 0),
      lguCompanyName: children[0].lguCompanyName,
      slfName: children[0].slfName,
      submittedBy: children[0].submittedBy,
      // Reporting period: the span the batch's disposal dates actually cover.
      periodStart: dates.length ? new Date(Math.min(...dates)) : null,
      periodEnd: dates.length ? new Date(Math.max(...dates)) : null,
      createdAt: children[0].createdAt,
      statusCounts,
      // A single shared status only when every child agrees; otherwise "mixed".
      status: statuses.length === 1 ? statuses[0] : "mixed",
      isMixedStatus: statuses.length > 1,
    });
  }

  // Item #3: sort by the latest relevant activity (resubmittedAt else submittedAt),
  // descending — groups and individual rows use the same key.
  return rows.sort(
    (a, b) => (b.latestActivityAt || 0) - (a.latestActivityAt || 0),
  );
}

// "3 acknowledged · 1 pending" — for the group row's status cell.
export function formatStatusSummary(statusCounts = {}) {
  return Object.entries(statusCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([status, n]) => `${n} ${String(status).replace(/_/g, " ")}`);
}
