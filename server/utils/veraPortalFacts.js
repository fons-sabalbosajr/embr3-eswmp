/**
 * VERA portal facts — a grounded, permission-scoped snapshot of the CALLER'S OWN
 * facility, so VERA can answer "is my discharge permit still valid?" or "how full
 * is my active cell?" from any page.
 *
 * Why this exists
 * ---------------
 * VERA could already read the table the user happens to be looking at
 * (veraPageData) and their submission readiness (portalReadiness). Everything
 * else — permits, cell utilization, ticket status, notifications, hauler/client
 * counts — was invisible unless the user was standing on that exact screen, so
 * VERA fell back to generic help articles for questions it had the data to
 * answer precisely.
 *
 * Boundaries (all enforced here, not by the prompt)
 * ------------------------------------------------
 *   • ONLY the caller's assigned SLF. Never another operator's facility.
 *   • Aggregates and status only — never raw submission rows or client records.
 *   • Demo sessions get confidential volumes masked. This block goes into the
 *     PROMPT, which never passes through the res.json masking middleware, so the
 *     masking has to be applied here or a demo session could read real figures
 *     back out of VERA.
 *   • Fetched only when the question is actually about these topics, and cached
 *     per user for a short window so a follow-up question costs nothing.
 */

const { isDemoRequest, MASK } = require("./demoMode");

/** Topics this provider can ground. Deliberately narrow — a miss just means
 *  VERA answers from the knowledge base, which is the old behaviour. */
const FACTS_QUESTION_RE =
  /\b(permit|permits|pto|ecc|discharge|hazwaste|hazardous waste id|valid(ity|ity date)?|expir\w*|cell|cells|capacity|utili[sz]ation|full|remaining|baseline|submission|submissions|submitted|pending|approved|rejected|reverted|ticket|tickets|support|notification|notifications|hauler|haulers|client|clients|dashboard|summary|status)\b/i;

function wantsPortalFacts(message) {
  return FACTS_QUESTION_RE.test(String(message || ""));
}

// Short TTL: long enough that a multi-question conversation reuses one fetch,
// short enough that VERA never quotes a stale figure after the user acts.
const TTL_MS = 60 * 1000;
const cache = new Map();

function readCache(key) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.data;
  if (hit) cache.delete(key);
  return null;
}

function writeCache(key, data) {
  cache.set(key, { data, expires: Date.now() + TTL_MS });
  // Bound the map so a long-lived process cannot accumulate stale user entries.
  if (cache.size > 200) {
    const now = Date.now();
    for (const [k, v] of cache) if (v.expires <= now) cache.delete(k);
  }
}

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** Volumes/capacities are confidential; counts, statuses and dates are not. */
const vol = (value, masked) =>
  masked ? MASK : Number(num(value).toFixed(2)).toLocaleString();

function permitRow(label, number, validity, status) {
  const hasAny = number || validity || String(status || "").trim();
  if (!hasAny) return `${label}: not encoded`;
  if (/^(not[\s_-]*required|n\/?a)$/i.test(String(status || "").trim())) {
    return `${label}: Not Required for this facility`;
  }
  const parts = [];
  if (number) parts.push(String(number));
  if (validity) {
    const d = new Date(validity);
    if (!Number.isNaN(d.getTime())) {
      const days = Math.ceil((d - new Date()) / 86400000);
      const state = days < 0 ? "EXPIRED" : days <= 30 ? `expires in ${days} day(s)` : "valid";
      parts.push(`valid to ${d.toISOString().slice(0, 10)} — ${state}`);
    }
  }
  if (status) parts.push(`status ${status}`);
  return `${label}: ${parts.join(", ")}`;
}

/**
 * Build the fact snapshot for one portal account.
 *
 * @param {object} portalUser lean UserPortal doc (must include assignedSlf)
 * @returns {Promise<object|null>}
 */
async function getPortalFacts(portalUser) {
  if (!portalUser?._id) return null;
  const masked = isDemoRequest();
  const cacheKey = `${portalUser._id}|${masked ? "masked" : "plain"}`;
  const cached = readCache(cacheKey);
  if (cached) return cached;

  const SlfFacility = require("../models/SlfFacility");
  const DataSLF = require("../models/DataSLF");
  const SupportTicket = require("../models/SupportTicket");
  const Notification = require("../models/Notification");

  const slfIds = Array.isArray(portalUser.assignedSlf) ? portalUser.assignedSlf : [];
  if (!slfIds.length) return null;

  // One round trip for all four sources rather than four sequential awaits.
  const [facility, submissions, tickets, unreadNotifications] = await Promise.all([
    SlfFacility.findById(slfIds[0])
      .select(
        "lgu province barangay statusOfSLF numberOfCell cellNames cellStatuses cellCapacities cellFillValues cellTypes cellCapacityUnits " +
          "permitToOperate permitToOperateValidity permitToOperateStatus dischargePermit dischargePermitValidity dischargePermitStatus eccNo hazwasteGenerationId",
      )
      .lean(),
    DataSLF.find({ slfGenerator: { $in: slfIds }, deletedAt: null })
      .select("status")
      .lean(),
    SupportTicket.find({ portalUserEmail: portalUser.email })
      .select("status")
      .lean()
      .catch(() => []),
    // Notification.recipient is a plain string keyed by e-mail.
    Notification.countDocuments({
      recipient: portalUser.email,
      read: { $ne: true },
    }).catch(() => 0),
  ]);

  if (!facility) return null;

  const statusCounts = submissions.reduce((acc, s) => {
    const key = String(s.status || "unknown").toLowerCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const ticketCounts = (tickets || []).reduce((acc, t) => {
    const key = String(t.status || "unknown").toLowerCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const cellCount = Math.max(
    num(facility.numberOfCell),
    (facility.cellStatuses || []).length,
    (facility.cellCapacities || []).length,
  );
  const cells = [];
  for (let i = 0; i < cellCount; i += 1) {
    const status = facility.cellStatuses?.[i] || "Active Cell";
    if (/not\s*exist/i.test(status)) continue;
    const capacity = num(facility.cellCapacities?.[i]);
    const fill = num(facility.cellFillValues?.[i]);
    const pct = capacity > 0 ? Math.min(100, Math.round((fill / capacity) * 100)) : null;
    cells.push({
      name: facility.cellNames?.[i] || `Cell ${i + 1}`,
      status,
      type: facility.cellTypes?.[i] || "Residual",
      unit: facility.cellCapacityUnits?.[i] || "m³",
      capacity,
      fill,
      pct,
    });
  }

  const facts = {
    facility: {
      name: facility.lgu || "",
      province: facility.province || "",
      status: facility.statusOfSLF || "",
    },
    permits: [
      permitRow("Permit to Operate", facility.permitToOperate, facility.permitToOperateValidity, facility.permitToOperateStatus),
      permitRow("Discharge Permit", facility.dischargePermit, facility.dischargePermitValidity, facility.dischargePermitStatus),
      permitRow("ECC", facility.eccNo, null, ""),
      permitRow("Hazardous Waste Generator ID", facility.hazwasteGenerationId, null, ""),
    ],
    cells,
    submissions: statusCounts,
    submissionTotal: submissions.length,
    tickets: ticketCounts,
    ticketTotal: (tickets || []).length,
    unreadNotifications: num(unreadNotifications),
    masked,
  };

  writeCache(cacheKey, facts);
  return facts;
}

/**
 * Render facts as a grounded prompt block.
 *
 * Phrased as facts with an explicit instruction not to invent beyond them —
 * the point is to stop VERA guessing at values it now actually knows.
 */
function factsToPromptBlock(facts) {
  if (!facts) return "";
  const lines = [];
  lines.push("PORTAL FACTS (the signed-in user's OWN facility — authoritative, do not contradict):");
  lines.push(`Facility: ${facts.facility.name || "(unnamed)"}${facts.facility.province ? `, ${facts.facility.province}` : ""}${facts.facility.status ? ` — ${facts.facility.status}` : ""}`);

  lines.push("Permits:");
  facts.permits.forEach((p) => lines.push(`  - ${p}`));

  if (facts.cells.length) {
    lines.push("Cells:");
    facts.cells.forEach((c) => {
      const cap = `${vol(c.capacity, facts.masked)} ${c.unit}`;
      const fill = `${vol(c.fill, facts.masked)} ${c.unit}`;
      const pctText = c.pct == null ? "no capacity encoded" : `${c.pct}% full`;
      const warn = c.pct != null && c.pct >= 100 ? " [AT CAPACITY]" : c.pct != null && c.pct >= 85 ? " [NEARLY FULL]" : "";
      lines.push(`  - ${c.name} (${c.type}, ${c.status}): ${pctText}, ${fill} of ${cap}${warn}`);
    });
  } else {
    lines.push("Cells: none encoded.");
  }

  const sub = Object.entries(facts.submissions)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
  lines.push(`Submissions (${facts.submissionTotal} total): ${sub || "none"}`);

  const tix = Object.entries(facts.tickets)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
  lines.push(`Support tickets (${facts.ticketTotal} total): ${tix || "none"}`);
  lines.push(`Unread notifications: ${facts.unreadNotifications}`);

  if (facts.masked) {
    lines.push(
      "NOTE: this is a DEMONSTRATION account — volume and capacity figures are masked. " +
        "State that they are hidden for the demo; never estimate or reconstruct them.",
    );
  }
  lines.push(
    "Use these facts to answer directly and to recommend the next action. If the question needs a figure that is not listed above, say what is missing rather than guessing.",
  );
  return lines.join("\n");
}

module.exports = {
  wantsPortalFacts,
  getPortalFacts,
  factsToPromptBlock,
  FACTS_QUESTION_RE,
};
