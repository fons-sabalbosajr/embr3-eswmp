import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert, Button, DatePicker, Empty, Modal, Space, Spin, Table, Tag, Typography,
} from "antd";
import { FilePdfOutlined, FileWordOutlined, PrinterOutlined, ReloadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";

import api from "../../api";
import { getSocket } from "../../utils/socket";
import {
  buildReportDocument,
  wrapPrintable,
  wrapWord,
} from "./portalReportDocument";

const { Text, Title } = Typography;
const { RangePicker } = DatePicker;

// ── The portal user's own disposal report ───────────────────────────────────
//
// EMB admins have had a report of every facility since day one; an operator had
// no way to produce one for their own, and was reduced to reading figures off
// the screen. This is that report.
//
// SCOPE. Everything here comes from GET /portal-auth/my-report, which resolves
// the caller from their token and filters on that email — so the document can
// only ever contain this operator's own submissions, and the payload states that
// in `scope` so the printed page says it too. Nothing on this screen widens it,
// and there is no facility or user selector for that reason.
//
// FIGURES. Volumes count only the statuses where the waste still stands (the
// server applies the same rule the admin summary does), which is why the header
// prints "N of M submissions carry volume" rather than leaving a reader to
// wonder why reverted entries contributed nothing.

const PRINT_STYLE_ID = "slf-portal-report-print-styles";

/**
 * Print rules, injected once.
 *
 * `@page` margins and `-webkit-print-color-adjust` are what stop the browser
 * dropping the section tints and re-flowing the tables — without them the printed
 * PDF looks nothing like the screen, which is the usual reason a "print to PDF"
 * report is judged unusable.
 */
function ensurePrintStyles() {
  if (typeof document === "undefined" || document.getElementById(PRINT_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = PRINT_STYLE_ID;
  style.innerHTML = `
    @media print {
      body * { visibility: hidden; }
      #slf-portal-report, #slf-portal-report * { visibility: visible; }
      #slf-portal-report {
        position: absolute; left: 0; top: 0; width: 100%;
        padding: 0 8mm;
      }
      .slf-portal-report-nonprint { display: none !important; }
      .slf-portal-report-break { break-before: page; page-break-before: always; }
      /* A table split across a page boundary loses its header, so the reader
         cannot tell what column they are looking at. */
      #slf-portal-report table { break-inside: auto; }
      #slf-portal-report tr { break-inside: avoid; page-break-inside: avoid; }
      #slf-portal-report thead { display: table-header-group; }
    }
    @page { size: A4 portrait; margin: 12mm 0; }
    #slf-portal-report { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  `;
  document.head.appendChild(style);
}

const NAVY = "#1a3353";
const num = (v) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const dt = (v, f = "MMM D, YYYY") => (v && dayjs(v).isValid() ? dayjs(v).format(f) : "—");

function Section({ title, subtitle, children, breakBefore = false }) {
  return (
    <div className={breakBefore ? "slf-portal-report-break" : ""} style={{ marginBottom: 18 }}>
      <div style={{ borderBottom: `2px solid ${NAVY}`, paddingBottom: 4, marginBottom: 10 }}>
        <Text strong style={{ fontSize: 14, color: NAVY }}>{title}</Text>
        {subtitle && (
          <div><Text type="secondary" style={{ fontSize: 11.5 }}>{subtitle}</Text></div>
        )}
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value, hint }) {
  return (
    <div style={{ minWidth: 130 }}>
      <Text type="secondary" style={{ fontSize: 11, display: "block" }}>{label}</Text>
      <div style={{ fontSize: 18, fontWeight: 700, color: NAVY, lineHeight: 1.3 }}>{value}</div>
      {hint && <Text type="secondary" style={{ fontSize: 10.5 }}>{hint}</Text>}
    </div>
  );
}

const rankColumns = (unitLabel) => [
  { title: "#", key: "i", width: 40, render: (_, __, i) => i + 1 },
  { title: "Name", dataIndex: "name", key: "name", ellipsis: true },
  { title: "Trips", dataIndex: "trips", key: "trips", width: 70, align: "right" },
  {
    title: `Volume (${unitLabel})`,
    dataIndex: "tons",
    key: "tons",
    width: 120,
    align: "right",
    render: (v) => num(v),
  },
];

export default function PortalReportModal({ open, onClose }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [range, setRange] = useState(null);
  const printRef = useRef(null);

  const [refreshing, setRefreshing] = useState(false);
  const [liveUpdatedAt, setLiveUpdatedAt] = useState(null);
  const load = useCallback(async (nextRange, { silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const params = {};
      if (nextRange?.[0]) params.from = nextRange[0].startOf("day").toISOString();
      if (nextRange?.[1]) params.to = nextRange[1].endOf("day").toISOString();
      const { data } = await api.get("/portal-auth/my-report", { params });
      setReport(data);
      setLiveUpdatedAt(dayjs());
    } catch (err) {
      // A failed BACKGROUND refresh keeps the report already on screen.
      if (!silent) {
        setReport(null);
        setError(
          err.response?.data?.message ||
            "Your report could not be generated right now. Please try again.",
        );
      }
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  }, []);

  // REAL-TIME while open. The report used to be read once when it opened, so an
  // approval, a revert or a new submission while it was on screen never reached
  // it. The portal's socket already carries those events ("data-refresh" with
  // target submissions/baselines/facility, and status notifications); a burst of
  // them collapses into one silent re-read for the same reporting period.
  const rangeRef = useRef(range);
  useEffect(() => {
    rangeRef.current = range;
  }, [range]);
  useEffect(() => {
    if (!open) return undefined;
    const socket = getSocket();
    if (!socket) return undefined;
    let timer = null;
    const handler = (payload = {}) => {
      const target = payload?.target;
      if (target && !["submissions", "baselines", "facility"].includes(target)) return;
      clearTimeout(timer);
      timer = setTimeout(() => load(rangeRef.current, { silent: true }), 600);
    };
    socket.on("data-refresh", handler);
    socket.on("notification", handler);
    return () => {
      clearTimeout(timer);
      socket.off("data-refresh", handler);
      socket.off("notification", handler);
    };
  }, [open, load]);

  // Fetched on the modal's own open EVENT, and re-fetched every time it opens, so
  // a report is always built from a fresh read rather than whatever was cached
  // the last time it was viewed.
  const onOpenChange = (isOpen) => {
    if (!isOpen) return;
    ensurePrintStyles();
    load(range);
  };

  const unitLabel = "tons";
  const t = report?.totals;

  const statusRows = useMemo(
    () =>
      Object.entries(report?.statuses || {})
        .map(([status, count]) => ({ key: status, status, count }))
        .sort((a, b) => b.count - a.count),
    [report],
  );

  // ONE document, built from the report DATA, behind both buttons. See
  // portalReportDocument.js for why neither may serialise the live modal.
  const documentBody = () =>
    buildReportDocument(report, { unitLabel, statusRows, formatDate: dt });

  const fileStem = () =>
    `SLF-Disposal-Report-${(report?.facility?.name || "Facility")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60)}-${dayjs().format("YYYYMMDD")}`;

  /**
   * Print / Save as PDF.
   *
   * Printed from its OWN window rather than by hiding the app around it. The old
   * approach set `body * { visibility: hidden }` and revealed `#slf-portal-report`
   * at `position:absolute; top:0` — but that element lives inside antd's Modal,
   * which is `position:fixed` inside a scrolled `.ant-modal-wrap`. An absolutely
   * positioned child of a fixed, clipped, scrolled ancestor is laid out against
   * THAT box, so anything past the first viewport was cut off: a long report
   * printed as one page with the rest missing.
   *
   * A clean window has no such ancestor, gets only the report's own stylesheet,
   * and prints what it shows. Falls back to the in-page path when a popup blocker
   * refuses the window, so the button always does something.
   */
  const handlePrint = () => {
    const html = wrapPrintable(documentBody(), fileStem());
    let win = null;
    try {
      win = window.open("", "_blank", "width=980,height=1200");
    } catch {
      win = null;
    }
    if (!win) {
      ensurePrintStyles();
      window.print();
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    // Give the new document a frame to lay out (and its fonts to settle) before
    // printing; printing an unlaid-out document yields blank pages in Safari.
    win.onload = () => {
      win.focus();
      win.print();
    };
    setTimeout(() => {
      try {
        if (!win.closed) {
          win.focus();
          win.print();
        }
      } catch {
        /* the window may already have been closed by the user */
      }
    }, 400);
  };

  /**
   * Word export. Same document, wrapped in the Office envelope so Word opens it
   * in Print view with A4 margins rather than as a web page.
   */
  const handleWordExport = () => {
    if (!report) return;
    const blob = new Blob(["﻿", wrapWord(documentBody(), fileStem())], {
      type: "application/msword",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileStem()}.doc`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <Modal
      title={
        <Space>
          <FilePdfOutlined style={{ color: NAVY }} />
          <Text strong>My Disposal Report</Text>
        </Space>
      }
      open={open}
      afterOpenChange={onOpenChange}
      onCancel={onClose}
      width="min(1100px, 100%)"
      style={{ top: 20 }}
      footer={
        <Space wrap className="slf-portal-report-nonprint">
          <RangePicker
            value={range}
            onChange={(next) => {
              setRange(next);
              load(next);
            }}
            allowClear
            format="MM/DD/YYYY"
          />
          <Button icon={<ReloadOutlined />} onClick={() => load(range)} loading={loading}>
            Refresh
          </Button>
          <Button icon={<FileWordOutlined />} onClick={handleWordExport} disabled={!report}>
            Export (.doc)
          </Button>
          <Button
            type="primary"
            className="slf-primary-btn"
            icon={<PrinterOutlined />}
            onClick={handlePrint}
            disabled={!report}
          >
            Print / Save as PDF
          </Button>
        </Space>
      }
    >
      {loading && (
        <div style={{ textAlign: "center", padding: "48px 0" }}>
          <Spin />
          <div style={{ marginTop: 10 }}>
            <Text type="secondary">Building your report…</Text>
          </div>
        </div>
      )}

      {!loading && error && <Alert type="error" showIcon message={error} />}

      {!loading && !error && report && (
        <div id="slf-portal-report" ref={printRef} style={{ fontSize: 12.5 }}>
          {/* ── Cover ── */}
          <div style={{ textAlign: "center", marginBottom: 16 }}>
            <Title level={4} style={{ margin: 0, color: NAVY }}>
              Sanitary Landfill Disposal Report
            </Title>
            <Text strong style={{ fontSize: 13 }}>
              {report.facility?.name || report.preparedFor?.facility || "Assigned Facility"}
            </Text>
            <div>
              <Text type="secondary" style={{ fontSize: 11.5 }}>
                {[report.facility?.barangay, report.facility?.province].filter(Boolean).join(", ")}
              </Text>
            </div>
            <div style={{ marginTop: 6 }}>
              <Text type="secondary" style={{ fontSize: 11.5 }}>
                Reporting period: {dt(report.scope?.from)} — {dt(report.scope?.to)} ·
                Generated {dt(report.generatedAt, "MMM D, YYYY h:mm A")}
              </Text>
              <Tag
                className="no-print"
                color={refreshing ? "processing" : "green"}
                style={{ marginInlineStart: 8, fontSize: 10.5 }}
              >
                {refreshing
                  ? "Updating…"
                  : `Live${liveUpdatedAt ? ` · updated ${liveUpdatedAt.format("h:mm:ss A")}` : ""}`}
              </Tag>
            </div>
            {/* The scope is PRINTED, not just enforced. A reader of the paper copy
                has to know whose submissions it covers. */}
            <div style={{ marginTop: 4 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>
                Prepared for {report.preparedFor?.name || report.preparedFor?.email} ·{" "}
                {report.scope?.description}
              </Text>
            </div>
          </div>

          <Section
            title="Summary"
            subtitle={`Volumes count only submissions whose waste still stands — ${num(
              t?.volumeBearingSubmissions,
            )} of ${num(t?.submissions)} submissions.`}
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
              <Stat label="Submissions" value={num(t?.submissions)} />
              <Stat label="Transport entries" value={num(t?.trucks)} />
              <Stat label={`Total waste (${unitLabel})`} value={num(t?.totalTons)} />
              <Stat label={`Residual (${unitLabel})`} value={num(t?.residualTons)} />
              <Stat label={`Hazardous (${unitLabel})`} value={num(t?.hazardousTons)} />
              <Stat
                label="Disposal activity"
                value={dt(t?.firstDisposal, "MMM D, YYYY")}
                hint={`through ${dt(t?.lastDisposal, "MMM D, YYYY")}`}
              />
            </div>
          </Section>

          <Section title="Facility & Permits">
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {[
                  ["Facility", report.facility?.name],
                  ["Province / Barangay", [report.facility?.province, report.facility?.barangay].filter(Boolean).join(" / ")],
                  ["Category / Ownership", [report.facility?.category, report.facility?.ownership].filter(Boolean).join(" / ")],
                  ["Operational status", report.facility?.status],
                  ["Permit to Operate", `${report.facility?.permitToOperate || "—"}${report.facility?.permitToOperateValidity ? ` (valid to ${dt(report.facility.permitToOperateValidity)})` : ""}`],
                  ["Discharge Permit", `${report.facility?.dischargePermit || "—"}${report.facility?.dischargePermitValidity ? ` (valid to ${dt(report.facility.dischargePermitValidity)})` : ""}`],
                  ["ECC No.", report.facility?.eccNo],
                ].map(([label, value]) => (
                  <tr key={label}>
                    <td style={{ padding: "3px 8px 3px 0", width: 190 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>{label}</Text>
                    </td>
                    <td style={{ padding: "3px 0" }}>{value || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Submission Status">
            <Table
              size="small"
              pagination={false}
              dataSource={statusRows}
              columns={[
                { title: "Status", dataIndex: "status", key: "status", render: (v) => <Tag>{String(v).replace(/_/g, " ")}</Tag> },
                { title: "Submissions", dataIndex: "count", key: "count", width: 130, align: "right" },
              ]}
              locale={{ emptyText: <Empty description="No submissions in this period" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
            />
            {report.outstanding?.revertedSubmissions > 0 && (
              <Alert
                type="warning"
                showIcon
                style={{ marginTop: 8 }}
                message={`${report.outstanding.revertedSubmissions} reverted submission(s) need correction`}
                description="Their volumes are excluded from the totals above until they are corrected and resubmitted."
              />
            )}
          </Section>

          <Section title="Monthly Disposal" breakBefore>
            <Table
              size="small"
              pagination={false}
              rowKey="month"
              dataSource={report.monthly || []}
              columns={[
                { title: "Month", dataIndex: "month", key: "month", render: (v) => (v === "undated" ? "Undated" : dayjs(`${v}-01`).format("MMM YYYY")) },
                { title: "Submissions", dataIndex: "submissions", key: "submissions", width: 110, align: "right" },
                { title: "Entries", dataIndex: "trucks", key: "trucks", width: 90, align: "right" },
                { title: `Residual (${unitLabel})`, dataIndex: "residualTons", key: "residualTons", width: 130, align: "right", render: num },
                { title: `Hazardous (${unitLabel})`, dataIndex: "hazardousTons", key: "hazardousTons", width: 130, align: "right", render: num },
                { title: `Total (${unitLabel})`, dataIndex: "tons", key: "tons", width: 120, align: "right", render: num },
              ]}
              locale={{ emptyText: <Empty description="No disposal recorded" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
            />
          </Section>

          <Section title="Disposal Cells" subtitle="Capacity and remaining space at the facility as of this report.">
            <Table
              size="small"
              pagination={false}
              rowKey="name"
              dataSource={report.cells || []}
              columns={[
                { title: "Cell", dataIndex: "name", key: "name" },
                { title: "Type", dataIndex: "type", key: "type", width: 170 },
                { title: "Status", dataIndex: "status", key: "status", width: 130 },
                // The unit is in the HEADER, like rankColumns and like the exported
                // document — not repeated on every figure from a per-row `r.unit`.
                // The server now normalises cells to the report's unit, so that
                // per-row spelling was the last thing on screen implying this table
                // might be in a different one than the rest of the report.
                { title: `Capacity (${unitLabel})`, dataIndex: "capacity", key: "capacity", width: 110, align: "right", render: (v) => num(v) },
                { title: `Used (${unitLabel})`, dataIndex: "fill", key: "fill", width: 110, align: "right", render: (v) => num(v) },
                { title: `Remaining (${unitLabel})`, dataIndex: "remaining", key: "remaining", width: 110, align: "right", render: (v) => num(v) },
                { title: "Used %", dataIndex: "utilization", key: "utilization", width: 90, align: "right", render: (v) => (v == null ? "—" : `${v}%`) },
              ]}
              locale={{ emptyText: <Empty description="No cells encoded" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
            />
          </Section>

          <Section title="Waste by Type" breakBefore>
            <Table size="small" pagination={false} rowKey="name" dataSource={report.byWasteType || []} columns={rankColumns(unitLabel)}
              locale={{ emptyText: <Empty description="No data" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }} />
          </Section>

          <Section title="Disposal by Hauler">
            <Table size="small" pagination={false} rowKey="name" dataSource={report.byHauler || []} columns={rankColumns(unitLabel)}
              locale={{ emptyText: <Empty description="No haulers recorded" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }} />
          </Section>

          <Section title="Disposal by Client">
            <Table size="small" pagination={false} rowKey="name" dataSource={report.byClient || []} columns={rankColumns(unitLabel)}
              locale={{ emptyText: <Empty description="No clients recorded" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }} />
          </Section>

          <Section
            title="Disposal by Cell"
            subtitle="Waste from this account's submissions in the reporting period, by the cell it was placed in. Disposal Cells above is the facility's full standing (baseline, all submissions and EMB adjustments), so the two are not expected to match."
          >
            <Table size="small" pagination={false} rowKey="name" dataSource={report.byCell || []} columns={rankColumns(unitLabel)}
              locale={{ emptyText: <Empty description="No placements recorded" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }} />
          </Section>

          {(report.outstanding?.unplacedEntries > 0 ||
            report.outstanding?.missingCapacityEntries > 0) && (
            <Section title="Outstanding Items" subtitle="Records in this period that still need attention.">
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {report.outstanding.unplacedEntries > 0 && (
                  <li>{num(report.outstanding.unplacedEntries)} transport entry(ies) with waste but no disposal cell — complete these in Organize Cells.</li>
                )}
                {report.outstanding.missingCapacityEntries > 0 && (
                  <li>{num(report.outstanding.missingCapacityEntries)} entry(ies) with no truck capacity recorded.</li>
                )}
              </ul>
            </Section>
          )}

          <div style={{ marginTop: 20, borderTop: "1px solid #e8e8e8", paddingTop: 8 }}>
            <Text type="secondary" style={{ fontSize: 10.5 }}>
              Generated from the SLF Portal on {dt(report.generatedAt, "MMMM D, YYYY [at] h:mm A")}.
              Figures reflect the data recorded at that moment. EMB Region III holds the
              authoritative record.
            </Text>
          </div>
        </div>
      )}

      {!loading && !error && !report && (
        <Empty description="No report yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}
    </Modal>
  );
}
