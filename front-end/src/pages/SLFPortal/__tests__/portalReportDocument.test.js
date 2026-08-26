/**
 * The disposal report as a DOCUMENT — what Word and the printer actually receive.
 *
 * The bug this pins
 * -----------------
 * Both exports serialised the live modal (`printRef.current.innerHTML`). That
 * markup is antd's, and antd's `<Table>` is not a table: it is
 * `div.ant-table-wrapper > div.ant-table > div.ant-table-container` wrapping
 * SEPARATE header and body `<table>` elements, each with a `<colgroup>` of pixel
 * widths and a hidden measurement row. Word's importer flattens that into
 * duplicated headers over column-less bodies. Every layout on the page is an
 * inline `display:flex`, which Word ignores, so the summary tiles stacked. And
 * the `<style>` meant to rescue it targeted `h2`/`h3`/`th`/`td` — tags the report
 * never emitted, because its headings are `<Text strong>` inside `<div>`s.
 *
 * Building the document from the report DATA makes both outputs deterministic and
 * checkable without a browser, which is what these tests do.
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildReportDocument,
  wrapPrintable,
  wrapWord,
  REPORT_STYLES,
  esc,
} from "../portalReportDocument.js";

const formatDate = (v, f) => (v ? `${v}${f ? "" : ""}` : "—");

const REPORT = {
  generatedAt: "2026-08-26T01:00:00Z",
  scope: { from: "2026-01-01", to: "2026-08-26", description: "Your own submissions" },
  preparedFor: { name: "R. Tabella", email: "rtabella@piwsi.ph" },
  facility: {
    name: "Prime Waste Solution (PWS)",
    province: "Pampanga",
    barangay: "Sta. Cruz",
    category: "Cat 4",
    ownership: "Private",
    status: "Operational",
    permitToOperate: "PTO-123",
    eccNo: "ECC-9",
  },
  totals: {
    submissions: 23, volumeBearingSubmissions: 22, trucks: 140,
    totalTons: 596981.38, residualTons: 500000, hazardousTons: 45195.39,
    firstDisposal: "2026-01-04", lastDisposal: "2026-08-25",
  },
  monthly: [{ month: "2026-01", submissions: 3, trucks: 12, residualTons: 10, hazardousTons: 1, tons: 11 }],
  cells: [{ name: "Cell 2", type: "Active", status: "Operational", capacity: 240854, fill: 100000, remaining: 140854, unit: "tons", utilization: 41 }],
  byWasteType: [{ name: "Residual", trips: 100, tons: 500000 }],
  byHauler: [{ name: "ABC Hauling", trips: 40, tons: 1200 }],
  byClient: [{ name: "Client A", trips: 10, tons: 300 }],
  byCell: [{ name: "Cell 2", trips: 90, tons: 400000 }],
  outstanding: { revertedSubmissions: 1, unplacedEntries: 2, missingCapacityEntries: 0 },
};

const build = (over = {}) =>
  buildReportDocument({ ...REPORT, ...over }, {
    unitLabel: "tons",
    statusRows: [{ status: "acknowledged", count: 20 }, { status: "reverted", count: 1 }],
    formatDate,
  });

test("the document is real tables, not antd's wrappers", () => {
  const html = build();
  assert.match(html, /<table><thead><tr><th>/, "a genuine table head");
  assert.doesNotMatch(html, /ant-table/, "no antd markup may reach Word");
  assert.doesNotMatch(html, /<colgroup/, "pixel colgroups are what broke the columns");
  assert.doesNotMatch(html, /display\s*:\s*flex/, "Word ignores flex — the summary must be a table");
});

test("every section the screen shows is in the document", () => {
  const html = build();
  for (const heading of [
    "Summary", "Facility &amp; Permits", "Submission Status", "Monthly Disposal",
    "Disposal Cells", "Waste by Type", "Disposal by Hauler", "Disposal by Client",
    "Disposal by Cell", "Outstanding Items",
  ]) {
    assert.match(html, new RegExp(`<h2>${heading}</h2>`), `missing section: ${heading}`);
  }
});

test("the summary is a table so Word cannot stack it", () => {
  const html = build();
  const summary = html.slice(html.indexOf("<h2>Summary</h2>"), html.indexOf("<h2>Facility"));
  assert.match(summary, /<th>Measure<\/th><th>Value<\/th>/);
  assert.match(summary, /Transport entries/);
  assert.match(summary, /596,981\.38/, "figures are formatted, not raw");
});

test("the scope is printed, so a paper copy says whose data it is", () => {
  const html = build();
  assert.match(html, /Prepared for R\. Tabella/);
  assert.match(html, /Your own submissions/);
});

test("user-supplied names are escaped", () => {
  // A client or hauler name is operator-entered text landing straight in markup.
  const html = build({
    byClient: [{ name: '<script>alert("x")</script> & Co', trips: 1, tons: 1 }],
  });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&amp; Co/);
  assert.equal(esc('a<b>&"c"'), "a&lt;b&gt;&amp;&quot;c&quot;");
});

test("an empty breakdown says so instead of rendering a headless table", () => {
  const html = build({ byHauler: [], byClient: [], byCell: [], byWasteType: [] });
  assert.match(html, /No records in this period\./);
});

test("outstanding items are omitted entirely when there are none", () => {
  const html = build({ outstanding: { revertedSubmissions: 0, unplacedEntries: 0, missingCapacityEntries: 0 } });
  assert.doesNotMatch(html, /<h2>Outstanding Items<\/h2>/);
  assert.doesNotMatch(html, /reverted submission\(s\) need correction/);
});

test("reverted submissions are called out where the totals are", () => {
  const html = build();
  const status = html.slice(html.indexOf("<h2>Submission Status</h2>"), html.indexOf("<h2>Monthly"));
  assert.match(status, /1 reverted submission\(s\) need correction/);
  assert.match(status, /excluded from the totals/);
});

test("no report at all yields no document, never a broken one", () => {
  assert.equal(buildReportDocument(null, {}), "");
});

// ── The two envelopes ───────────────────────────────────────────────────────

test("print CSS repeats table headers and avoids splitting rows", () => {
  assert.match(REPORT_STYLES, /thead \{ display: table-header-group; \}/);
  assert.match(REPORT_STYLES, /tr \{ page-break-inside: avoid; \}/);
  assert.match(REPORT_STYLES, /\.brk \{ page-break-before: always; \}/);
});

test("the printable wrapper is a standalone A4 document", () => {
  const html = wrapPrintable(build(), "Report");
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /@page \{ size: A4 portrait; margin: 14mm; \}/);
  assert.match(html, /<title>Report<\/title>/);
  // It carries its own styles: it is printed in a clean window with no app CSS.
  assert.match(html, /border-collapse: collapse/);
});

test("the Word wrapper opens in Print view on A4", () => {
  const html = wrapWord(build(), "Report");
  assert.match(html, /xmlns:w="urn:schemas-microsoft-com:office:word"/);
  assert.match(html, /<w:View>Print<\/w:View>/);
  assert.match(html, /@page WordSection1 \{ size: 21cm 29\.7cm/);
  assert.match(html, /<div class="WordSection1">/);
});

test("a title containing markup cannot escape either wrapper", () => {
  assert.doesNotMatch(wrapPrintable("<p>x</p>", '"><script>'), /<script>/);
  assert.doesNotMatch(wrapWord("<p>x</p>", '"><script>'), /<script>/);
});
