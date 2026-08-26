// ── The portal disposal report, as a DOCUMENT ───────────────────────────────
//
// One clean HTML document built from the report DATA, used by both exports.
//
// WHY NOT SCRAPE THE SCREEN. Both exports used to serialise the live modal
// (`printRef.current.innerHTML`). That markup is antd's, and antd's `<Table>` is
// not a table: it is `div.ant-table-wrapper > div.ant-table > div.ant-table-container`
// wrapping SEPARATE header and body `<table>` elements, each with a `<colgroup>`
// of pixel widths, plus a hidden measurement row. Word's HTML importer flattens
// that into duplicated headers and column-less bodies, and every layout on the
// page is a React inline `display:flex`, which Word ignores outright — so the
// summary row stacked into a single column. The `<style>` block that was supposed
// to rescue it targeted `h2`/`h3`/`th`/`td`, and the report renders none of those
// tags: its headings are `<Text strong>` inside `<div>`s. So the rules matched
// nothing and the export came out as an unstyled dump.
//
// Building from data instead makes both outputs deterministic, identical to each
// other, and testable without a browser — this module is pure.
//
// FORMAT NOTE: this produces HTML-in-Word (.doc), not OOXML (.docx). A true .docx
// is a ZIP of XML parts and needs a library the app does not carry. Word opens
// this natively and it is the same approach the admin report uses, so the two
// behave identically.

const NAVY = "#1a3353";

/** HTML-escape a value that came from user data. Never optional. */
export const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export const fmtNumber = (v) =>
  Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

const DASH = "—";

/**
 * @param {(v:any, fallback?:string)=>string} formatDate injected so the document
 *   uses the SAME date formatting the screen does, without importing dayjs here.
 */
export function buildReportDocument(report, { unitLabel = "m³", statusRows = [], formatDate } = {}) {
  if (!report) return "";
  const dt = formatDate || ((v) => (v ? String(v) : DASH));
  const t = report.totals || {};
  const f = report.facility || {};

  const out = [];
  const push = (s) => out.push(s);

  // ── Table helper. Real <table>/<th>/<td>, which is the one construct every
  // Word version and every print engine renders the same way.
  const table = (headers, rows, { align = [] } = {}) => {
    if (!rows.length) {
      return `<p class="empty">No records in this period.</p>`;
    }
    const head = headers.map((h) => `<th>${esc(h)}</th>`).join("");
    const body = rows
      .map(
        (cells) =>
          `<tr>${cells
            .map((c, i) => `<td${align[i] === "right" ? ' class="r"' : ""}>${c}</td>`)
            .join("")}</tr>`,
      )
      .join("");
    return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  };

  const section = (title, subtitle, inner, breakBefore = false) =>
    `<div class="sec${breakBefore ? " brk" : ""}">` +
    `<h2>${esc(title)}</h2>` +
    (subtitle ? `<p class="sub">${esc(subtitle)}</p>` : "") +
    inner +
    `</div>`;

  // A ranked breakdown: #, Name, Trips, Volume.
  const rankTable = (rows) =>
    table(
      ["#", "Name", "Trips", `Volume (${unitLabel})`],
      (rows || []).map((r, i) => [
        String(i + 1),
        esc(r.name),
        fmtNumber(r.trips),
        fmtNumber(r.tons),
      ]),
      { align: ["", "", "right", "right"] },
    );

  // ── Cover ────────────────────────────────────────────────────────────────
  push(`<div class="cover">
    <h1>Sanitary Landfill Disposal Report</h1>
    <p class="fac">${esc(f.name || report.preparedFor?.facility || "Assigned Facility")}</p>
    <p class="sub">${esc([f.barangay, f.province].filter(Boolean).join(", "))}</p>
    <p class="sub">Reporting period: ${esc(dt(report.scope?.from))} ${DASH} ${esc(dt(report.scope?.to))}
      &middot; Generated ${esc(dt(report.generatedAt, "MMM D, YYYY h:mm A"))}</p>
    <p class="sub">Prepared for ${esc(report.preparedFor?.name || report.preparedFor?.email || "")}
      &middot; ${esc(report.scope?.description || "")}</p>
  </div>`);

  // ── Summary. A TABLE, not a flex row: Word drops flex and stacks the tiles.
  push(
    section(
      "Summary",
      `Volumes count only submissions whose waste still stands — ${fmtNumber(
        t.volumeBearingSubmissions,
      )} of ${fmtNumber(t.submissions)} submissions.`,
      table(
        ["Measure", "Value"],
        [
          ["Submissions", fmtNumber(t.submissions)],
          ["Transport entries", fmtNumber(t.trucks)],
          [`Total waste (${esc(unitLabel)})`, fmtNumber(t.totalTons)],
          [`Residual (${esc(unitLabel)})`, fmtNumber(t.residualTons)],
          [`Hazardous (${esc(unitLabel)})`, fmtNumber(t.hazardousTons)],
          [
            "Disposal activity",
            `${esc(dt(t.firstDisposal, "MMM D, YYYY"))} ${DASH} ${esc(dt(t.lastDisposal, "MMM D, YYYY"))}`,
          ],
        ],
        { align: ["", "right"] },
      ),
    ),
  );

  // ── Facility & permits ───────────────────────────────────────────────────
  push(
    section(
      "Facility & Permits",
      "",
      table(
        ["Field", "Detail"],
        [
          ["Facility", esc(f.name || DASH)],
          ["Province / Barangay", esc([f.province, f.barangay].filter(Boolean).join(" / ") || DASH)],
          ["Category / Ownership", esc([f.category, f.ownership].filter(Boolean).join(" / ") || DASH)],
          ["Operational status", esc(f.status || DASH)],
          [
            "Permit to Operate",
            esc(
              `${f.permitToOperate || DASH}${
                f.permitToOperateValidity ? ` (valid to ${dt(f.permitToOperateValidity)})` : ""
              }`,
            ),
          ],
          [
            "Discharge Permit",
            esc(
              `${f.dischargePermit || DASH}${
                f.dischargePermitValidity ? ` (valid to ${dt(f.dischargePermitValidity)})` : ""
              }`,
            ),
          ],
          ["ECC No.", esc(f.eccNo || DASH)],
        ],
      ),
    ),
  );

  // ── Submission status ────────────────────────────────────────────────────
  let statusInner = table(
    ["Status", "Submissions"],
    (statusRows || []).map((r) => [esc(String(r.status).replace(/_/g, " ")), fmtNumber(r.count)]),
    { align: ["", "right"] },
  );
  if (report.outstanding?.revertedSubmissions > 0) {
    statusInner += `<p class="warn"><strong>${fmtNumber(
      report.outstanding.revertedSubmissions,
    )} reverted submission(s) need correction.</strong> Their volumes are excluded from the totals above until they are corrected and resubmitted.</p>`;
  }
  push(section("Submission Status", "", statusInner));

  // ── Monthly ──────────────────────────────────────────────────────────────
  push(
    section(
      "Monthly Disposal",
      "",
      table(
        [
          "Month",
          "Submissions",
          "Entries",
          `Residual (${unitLabel})`,
          `Hazardous (${unitLabel})`,
          `Total (${unitLabel})`,
        ],
        (report.monthly || []).map((m) => [
          esc(m.month === "undated" ? "Undated" : dt(`${m.month}-01`, "MMM YYYY")),
          fmtNumber(m.submissions),
          fmtNumber(m.trucks),
          fmtNumber(m.residualTons),
          fmtNumber(m.hazardousTons),
          fmtNumber(m.tons),
        ]),
        { align: ["", "right", "right", "right", "right", "right"] },
      ),
      true,
    ),
  );

  // ── Cells ────────────────────────────────────────────────────────────────
  push(
    section(
      "Disposal Cells",
      "Capacity and remaining space at the facility as of this report.",
      table(
        ["Cell", "Type", "Status", "Capacity", "Used", "Remaining", "Used %"],
        (report.cells || []).map((c) => [
          esc(c.name),
          esc(c.type || DASH),
          esc(c.status || DASH),
          `${fmtNumber(c.capacity)} ${esc(c.unit || "")}`,
          `${fmtNumber(c.fill)} ${esc(c.unit || "")}`,
          `${fmtNumber(c.remaining)} ${esc(c.unit || "")}`,
          c.utilization == null ? DASH : `${esc(c.utilization)}%`,
        ]),
        { align: ["", "", "", "right", "right", "right", "right"] },
      ),
    ),
  );

  push(section("Waste by Type", "", rankTable(report.byWasteType), true));
  push(section("Disposal by Hauler", "", rankTable(report.byHauler)));
  push(section("Disposal by Client", "", rankTable(report.byClient)));
  push(section("Disposal by Cell", "", rankTable(report.byCell)));

  const unplaced = report.outstanding?.unplacedEntries || 0;
  const missingCap = report.outstanding?.missingCapacityEntries || 0;
  if (unplaced > 0 || missingCap > 0) {
    const items = [];
    if (unplaced > 0) {
      items.push(
        `<li>${fmtNumber(unplaced)} transport entry(ies) with waste but no disposal cell — complete these in Organize Cells.</li>`,
      );
    }
    if (missingCap > 0) {
      items.push(`<li>${fmtNumber(missingCap)} entry(ies) with no truck capacity recorded.</li>`);
    }
    push(
      section(
        "Outstanding Items",
        "Records in this period that still need attention.",
        `<ul>${items.join("")}</ul>`,
      ),
    );
  }

  push(`<div class="foot"><p>Generated from the SLF Portal on ${esc(
    dt(report.generatedAt, "MMMM D, YYYY [at] h:mm A"),
  )}. Figures reflect the data recorded at that moment. EMB Region III holds the authoritative record.</p></div>`);

  return out.join("\n");
}

/**
 * Print/Word CSS.
 *
 * Deliberately plain: element selectors, no flex, no grid, no CSS variables.
 * Word's HTML engine supports roughly CSS 2.1, and every rule here is chosen to
 * survive it AND to print correctly from a browser.
 */
export const REPORT_STYLES = `
  body { font-family: "Segoe UI", Arial, sans-serif; font-size: 11pt; color: #222; margin: 0; }
  h1 { font-size: 17pt; color: ${NAVY}; margin: 0 0 4px; text-align: center; }
  h2 { font-size: 12.5pt; color: ${NAVY}; margin: 0 0 6px; padding-bottom: 3px;
       border-bottom: 2px solid ${NAVY}; }
  .cover { text-align: center; margin-bottom: 18px; }
  .cover .fac { font-size: 12pt; font-weight: bold; margin: 2px 0; }
  .sub { color: #666; font-size: 9.5pt; margin: 2px 0; }
  .sec { margin-bottom: 16px; }
  table { border-collapse: collapse; width: 100%; margin: 6px 0 0; }
  th, td { border: 1px solid #d9d9d9; padding: 4px 6px; font-size: 9.5pt;
           text-align: left; vertical-align: top; }
  th { background: #f2f4f7; color: ${NAVY}; font-weight: bold; }
  td.r, th.r { text-align: right; }
  .r { text-align: right; }
  .empty { color: #888; font-size: 9.5pt; font-style: italic; margin: 6px 0 0; }
  .warn { border: 1px solid #ffe58f; background: #fffbe6; padding: 6px 8px;
          font-size: 9.5pt; margin: 8px 0 0; }
  ul { margin: 6px 0 0; padding-left: 18px; font-size: 9.5pt; }
  .foot { margin-top: 18px; border-top: 1px solid #e8e8e8; padding-top: 6px;
          color: #666; font-size: 8.5pt; }
  /* A table split across a page loses its header, so the reader cannot tell what
     column they are looking at. Repeat it, and never split a row. */
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  .brk { page-break-before: always; }
`;

/** A complete standalone HTML document, for printing in a clean window. */
export const wrapPrintable = (bodyHtml, title = "SLF Disposal Report") =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>` +
  `<style>@page { size: A4 portrait; margin: 14mm; }${REPORT_STYLES}</style>` +
  `</head><body>${bodyHtml}</body></html>`;

/**
 * The Word envelope. The `xmlns:w` namespace and the `WordDocument` block are
 * what make Word treat this as a document (page size, margins, print view)
 * instead of a web page pasted into one.
 */
export const wrapWord = (bodyHtml, title = "SLF Disposal Report") =>
  `<html xmlns:o="urn:schemas-microsoft-com:office:office" ` +
  `xmlns:w="urn:schemas-microsoft-com:office:word" ` +
  `xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8">` +
  `<title>${esc(title)}</title>` +
  `<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View>` +
  `<w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->` +
  `<style>@page WordSection1 { size: 21cm 29.7cm; margin: 1.6cm 1.6cm; }` +
  `div.WordSection1 { page: WordSection1; }${REPORT_STYLES}</style>` +
  `</head><body><div class="WordSection1">${bodyHtml}</div></body></html>`;

export default { buildReportDocument, wrapPrintable, wrapWord, REPORT_STYLES, esc, fmtNumber };
