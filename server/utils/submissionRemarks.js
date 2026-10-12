/**
 * Admin review remarks for a submission — the FORMAT / COMPLETENESS half.
 *
 * `computeSubmissionRemarks` (routes/dataSLF.js) already derives the truck-
 * capacity and cell-placement flags. This adds the checks an admin otherwise
 * finds by opening every submission: missing or malformed ticket numbers and
 * plate numbers, loads with no volume, hazardous loads without an HW code,
 * non-standard waste types and disposal dates in the future.
 *
 * Every remark is { text, level, detail? }. `text` is a stable label — the admin
 * table merges remarks across grouped entries BY TEXT, so counts and examples go
 * in `detail` (shown in a tooltip), never in the label.
 *
 * Pure functions of the submission document: derived on read, never stored.
 */
const {
  WASTE_CATEGORY_ENUM,
  TREATED_HAZARDOUS,
  normalizeWasteType,
} = require("./wasteCategories");
const { isBlank } = require("./wasteGenerationValidation");

// Values operators type when they do not have the real number.
const PLACEHOLDER_RE = /^(n\/?a|none|nil|null|tba|tbd|unknown|-+|0+|x+|\.+)$/i;

const text = (value) => String(value ?? "").trim();

/**
 * Philippine plates in every form seen in submissions: "ABC 1234", "ABC-1234",
 * "AB 1234", "SFP 123", the older "1234 AB" and conduction-sticker style codes.
 * Lenient on purpose — only a value that cannot be a plate is flagged.
 */
function isWellFormedPlate(value) {
  const raw = text(value);
  if (!raw || PLACEHOLDER_RE.test(raw)) return false;
  const compact = raw.toUpperCase().replace(/[\s-]+/g, "");
  return /^[A-Z0-9]{4,8}$/.test(compact) && /[A-Z]/.test(compact) && /\d/.test(compact);
}

function isWellFormedTicket(value) {
  const raw = text(value);
  if (!raw || PLACEHOLDER_RE.test(raw)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9\-/#. ]{0,39}$/.test(raw) && /\d/.test(raw);
}

const hasHazCode = (codes) =>
  (Array.isArray(codes) ? codes : [codes]).some((code) => text(code));

/**
 * The loads a truck entry reports — the SAME level rule the submit validator
 * uses (wasteGenerationValidation: `vehicleCarriesLoad`). A vehicle is a load
 * only when it carries a VOLUME or a WASTE TYPE; a stub vehicle holding just a
 * plate is not, and then the truck itself is the one load.
 *
 * Selecting vehicles by "has a plate" (as the capacity remark used to) treated
 * such a stub as the load: its blank volume read as "Missing load volume", and
 * the truck's real volume was never compared with its capacity, so an exceeded
 * load on a record like SLF-LGU-PA-0016 went unflagged.
 *
 * Shared by the format checks, the capacity remark and the VERA prompt so all
 * three judge the same rows.
 */
const vehicleCarriesLoad = (v) => !isBlank(v?.actualVolume) || !isBlank(v?.wasteType);

const namesAClient = (list) =>
  (Array.isArray(list) ? list : []).some((c) => text(typeof c === "string" ? c : c?.clientName || c?.name));

// Did this read include client data? A list projection that leaves
// `selectedClients` out returns no such key at all, which is different from an
// empty selection.
const clientsProjected = (truck) =>
  Array.isArray(truck?.selectedClients) ||
  (Array.isArray(truck?.vehicles) && truck.vehicles.some((v) => Array.isArray(v?.selectedClients)));

function truckLoadRows(truck) {
  const vehicles = (Array.isArray(truck?.vehicles) ? truck.vehicles : []).filter(vehicleCarriesLoad);
  const truckHasClient = namesAClient(truck?.selectedClients);
  if (vehicles.length) {
    return vehicles.map((v) => ({
      hasClient: namesAClient(v.selectedClients) || truckHasClient,
      plate: v.plateNumber || truck?.plateNumber,
      volume: v.actualVolume,
      volumeUnit: v.actualVolumeUnit || truck?.actualVolumeUnit,
      capacity: v.capacity ?? truck?.truckCapacity,
      capacityUnit: v.capacityUnit || truck?.truckCapacityUnit,
      wasteType: v.wasteType ?? truck?.wasteType,
      hazWasteCode: hasHazCode(v.hazWasteCode) ? v.hazWasteCode : truck?.hazWasteCode,
      cellName: v.cellName || truck?.cellName,
    }));
  }
  return [
    {
      hasClient: truckHasClient,
      plate: truck?.plateNumber,
      volume: truck?.actualVolume,
      volumeUnit: truck?.actualVolumeUnit,
      capacity: truck?.truckCapacity,
      capacityUnit: truck?.truckCapacityUnit,
      wasteType: truck?.wasteType,
      hazWasteCode: truck?.hazWasteCode,
      cellName: truck?.cellName,
    },
  ];
}

// The submit validator requires an HW code for TREATED hazardous waste only;
// untreated hazardous loads are accepted without one, so they are not flagged.
const needsHazCode = (wasteType) => normalizeWasteType(wasteType) === TREATED_HAZARDOUS;

const examples = (list) => {
  const shown = list.slice(0, 3).join(", ");
  return list.length > 3 ? `${shown} +${list.length - 3} more` : shown;
};
const ofLoads = (count, total, noun = "load") =>
  `${count} of ${total} ${noun}${total === 1 ? "" : "s"}`;

/**
 * @param {object} entry  a submission (lean doc or row) — reads trucks + dateOfDisposal
 * @param {object} [opts]
 * @param {Date}   [opts.now]  injectable clock for tests
 * @returns {{text:string, level:"error"|"warning"|"info", detail?:string}[]}
 */
function computeFormatRemarks(entry, { now = new Date() } = {}) {
  const remarks = [];
  const trucks = Array.isArray(entry?.trucks) ? entry.trucks : [];
  // The light list projection may omit trucks entirely (truckCount only) — then
  // there is nothing to judge, and saying nothing beats a false alarm.
  if (!trucks.length) return remarks;

  const missingTicket = [];
  const badTicket = [];
  const ticketSeen = new Map();
  const missingHauler = [];
  const noVolume = [];
  const missingPlate = [];
  const badPlate = [];
  const missingWaste = [];
  const oddWaste = new Set();
  const hazNoCode = [];
  const emptyRows = [];
  const noClient = [];
  let loadCount = 0;

  trucks.forEach((truck, index) => {
    const label = `#${index + 1}`;
    // A transport row with nothing in it — no hauler, ticket, plate or volume.
    // Nineteen Porac submissions consist entirely of these (2,337 rows), and two
    // of them were acknowledged: the per-field flags below did fire, but as a
    // wall of "missing" tags that never said the submission was simply empty.
    const rowsForEmpty = truckLoadRows(truck);
    if (
      !text(truck?.hauler) && !text(truck?.disposalTicketNo) && !text(truck?.plateNumber) &&
      !rowsForEmpty.some((row) => Number(row.volume || 0) > 0)
    ) {
      emptyRows.push(label);
    }
    const ticket = text(truck?.disposalTicketNo);
    if (!ticket) missingTicket.push(label);
    else if (!isWellFormedTicket(ticket)) badTicket.push(`"${ticket}"`);
    else {
      const key = ticket.toUpperCase().replace(/\s+/g, "");
      ticketSeen.set(key, [...(ticketSeen.get(key) || []), ticket]);
    }
    if (!text(truck?.hauler)) missingHauler.push(label);

    const rows = truckLoadRows(truck);
    if (!rows.some((row) => Number(row.volume || 0) > 0)) noVolume.push(label);
    rows.forEach((row) => {
      loadCount += 1;
      const plate = text(row.plate);
      if (!plate) missingPlate.push(label);
      else if (!isWellFormedPlate(plate)) badPlate.push(`"${plate}"`);
      const waste = text(row.wasteType);
      if (!waste) missingWaste.push(label);
      else if (!WASTE_CATEGORY_ENUM.includes(waste)) oddWaste.add(`"${waste}"`);
      if (needsHazCode(waste) && !hasHazCode(row.hazWasteCode)) {
        hazNoCode.push(plate || label);
      }
      // A load that carries waste but names no client cannot be attributed to
      // a generator; only the hauler's roster can stand in for it.
      if (Number(row.volume || 0) > 0 && !row.hasClient) noClient.push(plate || label);
    });
  });

  const duplicateTickets = [...ticketSeen.values()].filter((list) => list.length > 1).map((list) => `"${list[0]}" ×${list.length}`);
  const total = trucks.length;

  // An entirely empty submission is ONE error that says so, not eight
  // per-field flags that each describe a symptom of it.
  if (emptyRows.length === total) {
    remarks.push({
      text: "No transport data",
      level: "error",
      detail: `All ${total} transport row${total === 1 ? " is" : "s are"} empty — no hauler, ticket, plate or volume`,
    });
    return remarks;
  }
  if (emptyRows.length) {
    remarks.push({ text: "Empty transport rows", level: "warning", detail: `${ofLoads(emptyRows.length, total, "transport row")}: ${examples(emptyRows)}` });
  }

  if (noVolume.length) {
    remarks.push({ text: "Missing load volume", level: "error", detail: `${ofLoads(noVolume.length, total, "truck entry")} have no volume: ${examples(noVolume)}` });
  }
  if (entry?.dateOfDisposal) {
    const disposal = new Date(entry.dateOfDisposal);
    // One day of slack absorbs the UTC/Manila offset on a same-day entry.
    if (!Number.isNaN(disposal.getTime()) && disposal.getTime() > now.getTime() + 24 * 60 * 60 * 1000) {
      remarks.push({ text: "Disposal date in the future", level: "error", detail: `Dated ${disposal.toISOString().slice(0, 10)}` });
    }
  }
  if (missingTicket.length) {
    remarks.push({ text: "Missing ticket no.", level: "warning", detail: `${ofLoads(missingTicket.length, total, "truck entry")}: ${examples(missingTicket)}` });
  }
  if (badTicket.length) {
    remarks.push({ text: "Improper ticket no. format", level: "warning", detail: examples(badTicket) });
  }
  if (duplicateTickets.length) {
    remarks.push({ text: "Duplicate ticket no.", level: "warning", detail: examples(duplicateTickets) });
  }
  if (missingPlate.length) {
    remarks.push({ text: "Missing plate no.", level: "warning", detail: `${ofLoads(missingPlate.length, loadCount)}: ${examples(missingPlate)}` });
  }
  if (badPlate.length) {
    remarks.push({ text: "Improper plate no. format", level: "warning", detail: examples(badPlate) });
  }
  if (missingHauler.length) {
    remarks.push({ text: "Missing hauler", level: "warning", detail: `${ofLoads(missingHauler.length, total, "truck entry")}: ${examples(missingHauler)}` });
  }
  if (hazNoCode.length) {
    remarks.push({ text: "Treated hazardous waste without HW code", level: "warning", detail: examples(hazNoCode) });
  }
  if (missingWaste.length) {
    remarks.push({ text: "Missing waste type", level: "warning", detail: `${ofLoads(missingWaste.length, loadCount)}: ${examples(missingWaste)}` });
  }
  if (oddWaste.size) {
    remarks.push({ text: "Non-standard waste type", level: "info", detail: examples([...oddWaste]) });
  }
  // Only judged when the read carried client data at all (clientsProjected):
  // a projection without it must not report every load as client-less.
  if (noClient.length && trucks.some(clientsProjected)) {
    remarks.push({ text: "No client on trip", level: "info", detail: `${ofLoads(noClient.length, loadCount)}: ${examples(noClient)}` });
  }
  return remarks;
}

// ── VERA-generated remark ────────────────────────────────────────────────────

const VERA_REMARK_MAX_CHARS = 600;
const VERA_REMARK_MAX_ROWS = 40;

const VERA_REMARK_SYSTEM = [
  "You are VERA, the review assistant for the EMB Region III Sanitary Landfill (SLF) submission portal.",
  "Write ONE admin review remark for the submission described by the user message.",
  "Use ONLY the facts given — never invent figures, plates, tickets or causes.",
  "Lead with the most serious issue. For exceeded values quote the exact figures with units (load volume vs truck capacity and the allowance).",
  "Name the specific missing or improperly formatted fields and which loads they affect.",
  "End with the concrete action the admin should ask the operator to take.",
  "If no issues are listed, say the submission is consistent and ready for acknowledgement.",
  "Plain text only: no markdown, no bullet points, no greeting. At most 3 sentences and 450 characters.",
].join(" ");

const fmtNum = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "—";
};

/**
 * The fact sheet VERA reasons over. Deliberately omits the submitter's email and
 * any account data — only what is printed on the submission itself.
 */
function buildVeraRemarkPrompt(entries = [], remarks = [], { allowancePct = 10 } = {}) {
  const first = entries[0] || {};
  const lines = [
    `Submission: ${entries.map((e) => e.idNo || e.submissionId || String(e._id || "")).filter(Boolean).join(", ") || "—"}`,
    `Facility: ${first.slfName || first.slfGenerator?.lgu || "—"}`,
    `LGU/Company: ${first.lguCompanyName || "—"} (${first.companyType || "—"})`,
    `Disposal date: ${first.dateOfDisposal ? new Date(first.dateOfDisposal).toISOString().slice(0, 10) : "—"}`,
    `Status: ${first.status || "—"}`,
    `Truck capacity allowance: ${allowancePct}%`,
    "",
    "Loads:",
  ];
  let row = 0;
  for (const entry of entries) {
    for (const truck of Array.isArray(entry?.trucks) ? entry.trucks : []) {
      for (const p of truckLoadRows(truck)) {
        row += 1;
        if (row > VERA_REMARK_MAX_ROWS) continue;
        lines.push(
          `#${row} ticket=${text(truck.disposalTicketNo) || "(none)"} hauler=${text(truck.hauler) || "(none)"} plate=${text(p.plate) || "(none)"} ` +
            `volume=${fmtNum(p.volume)} ${p.volumeUnit || ""} capacity=${p.capacity == null ? "(none)" : `${fmtNum(p.capacity)} ${p.capacityUnit || ""}`} ` +
            `waste=${text(p.wasteType) || "(none)"} cell=${text(p.cellName) || "(unassigned)"}`,
        );
      }
    }
  }
  if (row > VERA_REMARK_MAX_ROWS) lines.push(`(+${row - VERA_REMARK_MAX_ROWS} more loads not listed)`);
  lines.push("", "Issues detected by the validation rules:");
  if (remarks.length) {
    remarks.forEach((r) => lines.push(`- [${r.level}] ${r.text}${r.detail ? ` — ${r.detail}` : ""}`));
  } else {
    lines.push("- none");
  }
  return lines.join("\n");
}

/** Rule-based remark used when no AI model is configured or the call fails. */
function fallbackVeraRemark(remarks = []) {
  const issues = remarks.filter((r) => r.level === "error" || r.level === "warning");
  if (!issues.length) {
    return "No issues detected: load volumes are within truck capacity and the required fields are present and properly formatted. Ready for acknowledgement.";
  }
  const body = issues.map((r) => (r.detail ? `${r.text} (${r.detail})` : r.text)).join("; ");
  return clampRemark(`Review needed: ${body}. Ask the operator to correct these before acknowledgement.`);
}

function clampRemark(value) {
  const clean = String(value || "")
    .replace(/[*_`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > VERA_REMARK_MAX_CHARS ? `${clean.slice(0, VERA_REMARK_MAX_CHARS - 1)}…` : clean;
}

module.exports = {
  computeFormatRemarks,
  truckLoadRows,
  isWellFormedPlate,
  isWellFormedTicket,
  buildVeraRemarkPrompt,
  fallbackVeraRemark,
  clampRemark,
  VERA_REMARK_SYSTEM,
  VERA_REMARK_MAX_CHARS,
};
