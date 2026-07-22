// Centralized "does this submission still need Organize Cells?" rule.
//
// A submission requires Organize Cells completion when it still has waste not
// placed into a valid cell OR a historical truck missing its Truck Capacity.
// Both counts (`unplacedCount`, `missingCapacityCount`) and the `unplacedVolume`
// are computed SERVER-side (portalAuth#summarizeCellAssignment) so the browser
// never walks every truck/vehicle. Reverted/rejected entries are locked and
// re-encoded through the edit flow instead, so they never block here.
//
// This is the ONE predicate used by the load-time prompt, the "Add Transport
// Entry" guard, the pre-submit gate and the warning banner — keep the rule here,
// never inline it at a call site.

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// True when `sub` still needs organizing (unplaced waste or missing capacity)
// and is in a state that can be organized.
export function submissionNeedsOrganize(sub) {
  if (!sub) return false;
  if (sub.status === "reverted" || sub.status === "rejected") return false;
  return num(sub.unplacedCount) > 0 || num(sub.missingCapacityCount) > 0;
}

// Filter a submissions list down to the ones needing Organize Cells.
export function getUnplacedSubmissions(submissions) {
  return (Array.isArray(submissions) ? submissions : []).filter(
    submissionNeedsOrganize,
  );
}

// Structured, display-ready description of ONE submission's outstanding work.
export function describeOrganizeSubmission(sub) {
  return {
    ref: sub?.idNo || sub?.submissionId || "Submission",
    date: sub?.dateOfDisposal || sub?.disposalDate || null,
    status: sub?.status || "unknown",
    unplacedCount: num(sub?.unplacedCount),
    unplacedVolume: num(sub?.unplacedVolume),
    missingCapacityCount: num(sub?.missingCapacityCount),
  };
}

// Aggregate totals across all unresolved submissions (drives popup summaries).
export function summarizeOrganizeTotals(subs) {
  return (Array.isArray(subs) ? subs : []).reduce(
    (acc, s) => {
      const d = describeOrganizeSubmission(s);
      acc.submissions += 1;
      acc.unplacedCount += d.unplacedCount;
      acc.unplacedVolume += d.unplacedVolume;
      acc.missingCapacityCount += d.missingCapacityCount;
      return acc;
    },
    { submissions: 0, unplacedCount: 0, unplacedVolume: 0, missingCapacityCount: 0 },
  );
}

const fmtDate = (d) => {
  if (!d) return "—";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return String(d);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );

// Human-readable HTML block for the blocking dialog: identifies each submission's
// date/reference, approval status, unassigned waste volume, missing truck
// capacity and the required corrective action.
export function formatOrganizeWarningHtml(subs, unit = "m³", limit = 6) {
  const list = Array.isArray(subs) ? subs : [];
  const u = String(unit || "m³").replace("m3", "m³");
  const rows = list.slice(0, limit).map((s) => {
    const d = describeOrganizeSubmission(s);
    const parts = [];
    if (d.unplacedCount > 0) {
      const vol = d.unplacedVolume > 0
        ? `${d.unplacedVolume.toLocaleString()} ${u}`
        : `${d.unplacedCount} entr${d.unplacedCount === 1 ? "y" : "ies"}`;
      parts.push(`unassigned waste: <b>${escapeHtml(vol)}</b>`);
    }
    if (d.missingCapacityCount > 0) {
      parts.push(
        `missing truck capacity: <b>${d.missingCapacityCount} entr${d.missingCapacityCount === 1 ? "y" : "ies"}</b>`,
      );
    }
    return `<li style="margin-bottom:6px"><b>${escapeHtml(d.ref)}</b> · ${escapeHtml(
      fmtDate(d.date),
    )} · <span style="text-transform:capitalize">${escapeHtml(d.status)}</span><br/>${parts.join(" · ")}</li>`;
  });
  const more = list.length > limit ? `<li>…and ${list.length - limit} more.</li>` : "";
  return (
    `<div style="text-align:left">` +
    `<ul style="padding-left:18px;margin:8px 0">${rows.join("")}${more}</ul>` +
    `<div style="margin-top:8px"><b>Required action:</b> open <b>Organize Cells</b>, assign every unplaced entry to a disposal cell and complete any missing Truck Capacity, then save.</div>` +
    `</div>`
  );
}
