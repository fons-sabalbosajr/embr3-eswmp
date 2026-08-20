// ── SLF Portal — pure helpers ──
// Formatting, baseline detection, admin-notice filtering, and cell-status
// predicates. All pure: no hooks, no component state.

export const normalizeUnit = (unit) => String(unit || "m³").replace("m3", "m³");

/**
 * Merge option groups into ONE Select-ready list, deduplicated by value
 * (case-insensitively), first occurrence winning.
 *
 * REGRESSION GUARD. This existed inline as `new Map([...groupA, ...groupB])`,
 * which looks right and is not: Map's constructor takes an iterable of
 * [key, value] PAIRS, so handed an array of option OBJECTS it reads index 0 and
 * 1 of each — both `undefined`. Every option collapsed into a single
 * `undefined → undefined` entry, `.values()` yielded `undefined`, and antd's
 * option reader threw "Cannot read properties of undefined (reading 'options')"
 * as soon as the upload preview had any stored client to offer.
 *
 * Blank and malformed entries are dropped rather than passed through: a Select
 * option with no value is unselectable and renders as an empty row.
 */
export const mergeSelectOptions = (...groups) => {
  const byValue = new Map();
  groups.flat().forEach((option) => {
    const value = String(option?.value ?? "").trim();
    if (!value) return;
    const identity = value.toLowerCase();
    if (byValue.has(identity)) return;
    const label = String(option?.label ?? "").trim();
    byValue.set(identity, { label: label || value, value });
  });
  return Array.from(byValue.values());
};

export const hasBaselinePayload = (data = {}) =>
  !!(
    data &&
    (data.totalVolumeAccepted != null ||
      data.activeCellResidualVolume != null ||
      data.activeCellInertVolume != null ||
      data.activeCellHazardousVolume != null ||
      data.closedCellResidualVolume != null ||
      data.closedCellInertVolume != null ||
      data.closedCellHazardousVolume != null ||
      data.activeCellEntries?.length ||
      data.closedCellEntries?.length ||
      data.accreditedHaulers?.length)
  );

export const formatEntryVolumeSummary = (entries = [], fallbackUnit = "m³") => {
  const totals = entries.reduce((acc, entry) => {
    const unit = normalizeUnit(entry.unit || fallbackUnit);
    acc[unit] = (acc[unit] || 0) + Number(entry.volume || 0);
    return acc;
  }, {});
  const summary = Object.entries(totals)
    .filter(([, volume]) => volume > 0)
    .map(([unit, volume]) => `${volume.toLocaleString()} ${unit}`)
    .join(", ");
  return summary || `0 ${normalizeUnit(fallbackUnit)}`;
};

export const isTestAdminNotice = (item = {}) => {
  const isAdminNotice =
    ["admin_message", "message_from_admin", "support_ticket_reply"].includes(
      item.type,
    ) ||
    item.source === "admin_message" ||
    /message from admin|admin sent you a message/i.test(
      `${item.title || ""} ${item.subject || ""} ${item.message || ""}`,
    );
  if (!isAdminNotice) return false;
  const content =
    `${item.subject || ""} ${item.title || ""} ${item.message || ""}`
      .replace(/admin (sent you a message|replied to .*?):/gi, "")
      .trim();
  return /^(test|testing|test message|test notification|sample message)(\s*\d*)?$/i.test(
    content,
  );
};

export const normalizeCellStatus = (status) => {
  const value = String(status || "").trim();
  if (/^operational$/i.test(value)) return "Active Cell";
  if (/^closed$/i.test(value)) return "Used/Completed";
  if (/^reserved cell$/i.test(value)) return "Reserved Area";
  return value || "Active Cell";
};

export const isActiveCellStatus = (status) =>
  ["Active Cell", "Operational", "Active"].includes(String(status || ""));

export const isCompletedCellStatus = (status) =>
  ["Used/Completed", "Closed"].includes(String(status || ""));

export const isUnavailableCellStatus = (status) =>
  [
    "Under Construction",
    "Reserved Area",
    "Reserved Cell",
    "Not Existed",
  ].includes(String(status || ""));
