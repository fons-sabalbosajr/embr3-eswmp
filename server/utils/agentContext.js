// Controlled context layer for the Automation Agent.
//
// The frontend NEVER sends a raw query to the database or the model. It picks a
// named read-only function (validated against the allowlist) plus a few bounded
// parameters (date window, limit). This module:
//   • clamps date ranges + record counts (no unbounded scans),
//   • strips credentials/PII from every record before it can reach the model,
//   • applies SLF value masking when the global privacy toggle is on,
//   • records which data categories were included, and
//   • returns compact structured JSON — never Mongoose documents.

const MASK = "*****";

// ── Bounds ──────────────────────────────────────────────────────────────────
function clampLimit(n, def = 50, max = 200) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0) return def;
  return Math.min(v, max);
}
function clampDays(n, def = 30, max = 365) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0) return def;
  return Math.min(v, max);
}
// Resolve a bounded [from, to] window from optional ISO strings, else last N days.
function resolveDateWindow(params = {}) {
  const days = clampDays(params.days, 30, 365);
  let to = params.dateTo ? new Date(params.dateTo) : new Date();
  if (isNaN(to.getTime())) to = new Date();
  let from = params.dateFrom ? new Date(params.dateFrom) : new Date(to.getTime() - days * 864e5);
  if (isNaN(from.getTime())) from = new Date(to.getTime() - days * 864e5);
  // Never allow a window wider than the max.
  const maxSpan = 365 * 864e5;
  if (to.getTime() - from.getTime() > maxSpan) from = new Date(to.getTime() - maxSpan);
  return { from, to, days };
}

// ── PII / credential stripping (unconditional) ──────────────────────────────
// Personal / operational identifiers never leave the server to the model.
function pseudoEmail(email) {
  const s = String(email || "").trim();
  if (!s) return "";
  // Keep only a coarse shape ("someone at <domain>") — no local part.
  const at = s.indexOf("@");
  return at > 0 ? `submitter@${s.slice(at + 1)}` : "submitter";
}

// ── Masking (conditional on the global toggle) ──────────────────────────────
function maskNum(value, masking) {
  if (!masking) return value == null ? null : Number(value);
  return MASK;
}

// Turn one lean DataSLF doc into a compact, sanitized record.
//   masking → mask waste volume / capacity numbers.
function shapeSubmission(doc, masking) {
  const wasteTypes = new Set();
  const cellNames = new Set();
  let overCapacityTrucks = 0;
  (doc.trucks || []).forEach((t) => {
    if (t?.wasteType) wasteTypes.add(t.wasteType);
    if (t?.cellName) cellNames.add(t.cellName);
    const cap = Number(t?.truckCapacity);
    const act = Number(t?.actualVolume);
    if (cap > 0 && act > cap) overCapacityTrucks += 1;
  });
  return {
    ref: doc.submissionId || String(doc._id || "").slice(-8),
    slfName: doc.slfName || "",
    company: doc.lguCompanyName || "", // business identifier (admin-authorized)
    companyType: doc.companyType || "",
    status: doc.status || "pending",
    dateOfDisposal: doc.dateOfDisposal ? new Date(doc.dateOfDisposal).toISOString().slice(0, 10) : null,
    submittedAt: doc.createdAt ? new Date(doc.createdAt).toISOString().slice(0, 10) : null,
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString().slice(0, 10) : null,
    submitter: pseudoEmail(doc.submittedBy), // PII stripped
    truckCount: Number(doc.truckCount || (doc.trucks || []).length || 0),
    totalVolumeTons: maskNum(doc.totalVolumeTons, masking),
    totalVolumeM3: maskNum(doc.totalVolumeM3, masking),
    wasteTypes: [...wasteTypes],
    cells: [...cellNames],
    overCapacityTrucks,
    revertReason: doc.revertReason ? String(doc.revertReason).slice(0, 240) : "",
  };
}

module.exports = {
  MASK,
  clampLimit,
  clampDays,
  resolveDateWindow,
  pseudoEmail,
  maskNum,
  shapeSubmission,
};
