import { useMemo, useState, useCallback } from "react";
import {
  Modal,
  Button,
  Upload,
  Table,
  Tag,
  Alert,
  Typography,
  Space,
  Steps,
  Tooltip,
} from "antd";
import {
  DownloadOutlined,
  UploadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  WarningOutlined,
  FileExcelOutlined,
  ThunderboltOutlined,
  QuestionCircleOutlined,
} from "@ant-design/icons";
import * as XLSX from "xlsx";
import dayjs from "dayjs";
import api from "../../api";
import { newClientRequestId } from "./constants";

const { Text, Paragraph } = Typography;

// Stable per-placement key shared between the template, the parsed upload and the
// batch payload, so a row always maps back to the exact truck/vehicle slot even if
// the user reorders the file.
const rowIdOf = (subId, truckIndex, vehicleIndex) =>
  `${subId}|${truckIndex}|${vehicleIndex == null ? "t" : vehicleIndex}`;

// Only what Organize Cell Placement needs: the keys that identify the placement
// (Row ID is authoritative; Submission Ticket No / Reference No / Plate No are
// the human-readable ones the operator recognises), the waste being placed, and
// the two columns the user fills in. Nothing about baseline, capacity, clients or
// company details belongs here — this file organizes cells, and the extra columns
// only invited edits that the upload cannot and must not act on.
const TEMPLATE_HEADERS = [
  "Row ID",
  "Submission Ticket No",
  "Submission ID",
  "Reference No",
  "Disposal Date",
  "Hauler",
  "Plate No",
  "Waste Type",
  "Volume",
  "Unit",
  // Truck Capacity travels with the row so the operator can SEE which trips are
  // still missing one — and, where the plate's capacity is already declared on
  // the baseline, it arrives filled in rather than blank.
  "Truck Capacity",
  "Current Cell",
  "Target Cell",
  "Remarks",
];

const STATUS_META = {
  valid: { color: "success", icon: <CheckCircleOutlined />, label: "Valid" },
  warning: { color: "warning", icon: <WarningOutlined />, label: "Warning" },
  invalid: { color: "error", icon: <CloseCircleOutlined />, label: "Invalid" },
};

const CODE_LABEL = {
  reassigned: "Already Assigned",
  capacity: "Capacity Exceeded",
  unavailable: "Cell Unavailable",
  not_found: "Unknown Submission",
  locked: "Locked",
  duplicate: "Duplicate",
  no_cell: "No Target Cell",
  bad_truck: "Bad Reference",
  bad_vehicle: "Bad Reference",
  bad_ticket: "Ticket Mismatch",
  bad_capacity: "Bad Truck Capacity",
};

/**
 * File-based bulk cell organization. Reuses the ALREADY-LOADED unplaced placements
 * (no extra fetch), lets the user download a pre-filled template, upload it back
 * with a Target Cell per row, preview server-validated results, then apply the
 * whole batch through the transactional /portal-cell-assignments/bulk endpoint.
 *
 * The manual organizer is untouched — this is an additional, faster workflow.
 */
export default function BulkOrganizeCells({
  open,
  onClose,
  data = [],
  cellOptions = [],
  portalUser,
  onApplied,
}) {
  const [parsedRows, setParsedRows] = useState([]); // rows resolved from the upload
  const [previewRows, setPreviewRows] = useState([]); // server dry-run results
  const [summary, setSummary] = useState(null);
  const [validating, setValidating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [parseError, setParseError] = useState(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [batchId] = useState(() => newClientRequestId());

  // Flatten the loaded submissions into one row per placement that still needs a
  // cell. This is the template AND the lookup used to resolve an uploaded Row ID.
  const placementRows = useMemo(() => {
    const rows = [];
    (data || []).forEach((sub) => {
      (sub.placements || []).forEach((p) => {
        // The shared payload also carries placements that only need a Truck
        // Capacity — they already sit in a valid cell and are nothing to do with
        // organizing cells. Including them put rows in the template that the
        // user had no reason to fill in.
        if (p.needsCell === false) return;
        // Capacity already on file wins; otherwise the plate's declared capacity
        // from the baseline (resolved server-side). A trip with neither is left
        // blank so the operator can see exactly which ones still need entering.
        const capacity =
          Number(p.capacity) > 0
            ? Number(p.capacity)
            : Number(p.suggestedCapacity) > 0
              ? Number(p.suggestedCapacity)
              : "";
        rows.push({
          rowId: rowIdOf(sub._id, p.truckIndex, p.vehicleIndex),
          _id: sub._id,
          ticketNo: p.disposalTicketNo || "",
          capacity,
          capacityFromBaseline:
            !(Number(p.capacity) > 0) && Number(p.suggestedCapacity) > 0,
          needsCapacity: !!p.needsCapacity,
          submissionId: sub.submissionId || "",
          idNo: sub.idNo || "",
          status: sub.status || "",
          date: sub.dateOfDisposal ? dayjs(sub.dateOfDisposal).format("YYYY-MM-DD") : "",
          hauler: p.hauler || "",
          plateNumber: p.plateNumber || "",
          wasteType: p.wasteType || "",
          volume: p.actualVolume ?? "",
          unit: p.actualVolumeUnit || "",
          currentCell: p.cellName || "",
          truckIndex: p.truckIndex,
          vehicleIndex: p.vehicleIndex == null ? null : p.vehicleIndex,
        });
      });
    });
    return rows;
  }, [data]);

  const placementByRowId = useMemo(() => {
    const m = new Map();
    placementRows.forEach((r) => m.set(r.rowId, r));
    return m;
  }, [placementRows]);

  // Case-insensitive resolver: an uploaded Target Cell name → the canonical cell
  // option (value/label), so a slightly different capitalization still matches.
  const resolveCell = useCallback(
    (name) => {
      const key = String(name || "").trim().toLowerCase();
      if (!key) return null;
      return (
        cellOptions.find(
          (o) =>
            String(o.value || "").trim().toLowerCase() === key ||
            String(o.label || "").trim().toLowerCase() === key,
        ) || null
      );
    },
    [cellOptions],
  );

  const resetPreview = () => {
    setPreviewRows([]);
    setSummary(null);
  };

  const downloadTemplate = () => {
    const aoa = [
      TEMPLATE_HEADERS,
      ...placementRows.map((r) => [
        r.rowId,
        r.ticketNo,
        r.submissionId,
        r.idNo,
        r.date,
        r.hauler,
        r.plateNumber,
        r.wasteType,
        r.volume,
        r.unit,
        r.capacity,
        r.currentCell,
        "", // Target Cell — user fills this
        "", // Remarks
      ]),
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = TEMPLATE_HEADERS.map((h) => ({ wch: Math.max(12, h.length + 2) }));
    XLSX.utils.book_append_sheet(wb, ws, "Assignments");

    // Reference sheet: the cells the user may type into "Target Cell".
    const cellAoa = [
      ["Available Target Cells", "Type", "Note"],
      ...cellOptions.map((o) => [o.value, o.cellType || "", "Open for disposal"]),
    ];
    const cellWs = XLSX.utils.aoa_to_sheet(cellAoa);
    cellWs["!cols"] = [{ wch: 28 }, { wch: 16 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, cellWs, "Available Cells");

    XLSX.writeFile(wb, `cell-assignments-template-${dayjs().format("YYYYMMDD-HHmm")}.xlsx`);
  };

  const parseFile = (file) => {
    resetPreview();
    setParseError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        if (!json.length) {
          setParseError("The uploaded file has no rows.");
          setParsedRows([]);
          return;
        }
        const rows = [];
        const seen = new Set();
        json.forEach((raw, i) => {
          // Tolerate header variants by trimming keys.
          const get = (k) => {
            const hit = Object.keys(raw).find(
              (kk) => kk.trim().toLowerCase() === k.toLowerCase(),
            );
            return hit ? raw[hit] : "";
          };
          const rowId = String(get("Row ID") || "").trim();
          const targetCellName = String(get("Target Cell") || "").trim();
          const remarks = String(get("Remarks") || "").trim();
          const ticketNo = String(get("Submission Ticket No") || "").trim();
          const capacityRaw = String(get("Truck Capacity") ?? "").trim();
          // Blank Target Cell → nothing to assign for that row; skip silently.
          if (!targetCellName) return;

          const placement = rowId ? placementByRowId.get(rowId) : null;
          const fileLine = i + 2; // + header row
          if (!placement) {
            rows.push({
              key: `x-${i}`,
              fileLine,
              rowId,
              submissionId: String(get("Submission ID") || get("Reference No") || ""),
              targetCell: targetCellName,
              clientStatus: "invalid",
              clientMessage: "Row ID not found among your unorganized placements.",
            });
            return;
          }
          if (seen.has(rowId)) {
            rows.push({
              key: `d-${i}`,
              fileLine,
              rowId,
              submissionId: placement.submissionId,
              targetCell: targetCellName,
              clientStatus: "invalid",
              clientMessage: "Duplicate Row ID in the file.",
            });
            return;
          }
          seen.add(rowId);
          // The Row ID is what resolves the placement, so a ticket number that
          // disagrees with it means the row was edited or pasted from elsewhere —
          // reject rather than organize a trip the user did not mean to touch.
          if (
            ticketNo &&
            placement.ticketNo &&
            ticketNo.toLowerCase() !== String(placement.ticketNo).toLowerCase()
          ) {
            rows.push({
              key: `t-${i}`,
              fileLine,
              rowId,
              ticketNo,
              submissionId: placement.submissionId,
              targetCell: targetCellName,
              clientStatus: "invalid",
              clientMessage: `Submission Ticket No does not match this Row ID (expected ${placement.ticketNo}).`,
            });
            return;
          }
          // A trip that is missing its Truck Capacity cannot be completed by a
          // cell alone — the submission would stay blocked. Catch it here rather
          // than letting the operator discover it after applying the batch.
          const capacity = capacityRaw === "" ? null : Number(capacityRaw);
          if (capacityRaw !== "" && (!Number.isFinite(capacity) || capacity <= 0)) {
            rows.push({
              key: `cap-${i}`,
              fileLine,
              rowId,
              ticketNo,
              submissionId: placement.submissionId,
              targetCell: targetCellName,
              clientStatus: "invalid",
              clientMessage: "Truck Capacity must be a number greater than 0.",
            });
            return;
          }
          if (placement.needsCapacity && !(capacity > 0)) {
            rows.push({
              key: `cap-${i}`,
              fileLine,
              rowId,
              ticketNo,
              submissionId: placement.submissionId,
              targetCell: targetCellName,
              clientStatus: "invalid",
              clientMessage:
                "This trip is missing its Truck Capacity — fill the Truck Capacity column for this row.",
            });
            return;
          }
          const opt = resolveCell(targetCellName);
          if (!opt) {
            rows.push({
              key: `c-${i}`,
              fileLine,
              rowId,
              submissionId: placement.submissionId,
              targetCell: targetCellName,
              clientStatus: "invalid",
              clientMessage: "Target Cell is not an open/available cell.",
            });
            return;
          }
          rows.push({
            key: rowId,
            fileLine,
            rowId,
            _id: placement._id,
            ticketNo: placement.ticketNo,
            submissionId: placement.submissionId,
            idNo: placement.idNo,
            truckIndex: placement.truckIndex,
            vehicleIndex: placement.vehicleIndex,
            wasteType: placement.wasteType,
            volume: placement.volume,
            capacity,
            needsCapacity: placement.needsCapacity,
            currentCell: placement.currentCell,
            targetCell: opt.value,
            cellIndex: opt.cellIndex,
            cellName: opt.value,
            cellType: opt.cellType || "",
            remarks,
            clientStatus: "valid",
          });
        });
        setParsedRows(rows);
        if (!rows.length) {
          setParseError("No rows had a Target Cell filled in.");
        }
      } catch {
        setParseError("Could not read the file. Please upload the provided .xlsx/.csv template.");
        setParsedRows([]);
      }
    };
    reader.readAsArrayBuffer(file);
    return false; // prevent antd auto-upload
  };

  // Assignments that are structurally OK on the client and worth sending to the
  // server for authoritative validation.
  const sendableAssignments = useMemo(
    () =>
      parsedRows
        .filter((r) => r.clientStatus === "valid")
        .map((r) => ({
          _id: r._id,
          submissionId: r.submissionId,
          idNo: r.idNo,
          // Re-checked server-side against the resolved truck, so a file that
          // reaches the API without going through this parser is validated too.
          disposalTicketNo: r.ticketNo || undefined,
          truckIndex: r.truckIndex,
          vehicleIndex: r.vehicleIndex,
          cellIndex: r.cellIndex,
          cellName: r.cellName,
          cellType: r.cellType,
          // Sent only when the row actually supplies one, so a bulk upload can
          // complete a missing Truck Capacity exactly like the manual organizer
          // — otherwise the cell would be set and the submission stay blocked.
          ...(Number(r.capacity) > 0 ? { truckCapacity: Number(r.capacity) } : {}),
        })),
    [parsedRows],
  );

  const runValidate = async () => {
    if (!sendableAssignments.length) return;
    setValidating(true);
    try {
      const { data: res } = await api.post("/data-slf/portal-cell-assignments/bulk", {
        submittedBy: portalUser?.email,
        assignments: sendableAssignments,
        dryRun: true,
        source: "file",
      });
      setSummary(res.summary || null);
      setPreviewRows(Array.isArray(res.rows) ? res.rows : []);
    } catch (err) {
      setParseError(
        err.response?.data?.message || "Validation failed. Please try again.",
      );
    } finally {
      setValidating(false);
    }
  };

  const runApply = async () => {
    setApplying(true);
    try {
      const { data: res } = await api.post("/data-slf/portal-cell-assignments/bulk", {
        submittedBy: portalUser?.email,
        assignments: sendableAssignments,
        dryRun: false,
        batchId,
        source: "file",
      });
      onApplied?.(res);
    } catch (err) {
      // Server returns per-row failures on an all-or-nothing rejection.
      const body = err.response?.data;
      if (body?.rows) {
        setSummary(body.summary || null);
        setPreviewRows(body.rows);
      }
      setParseError(body?.message || "Apply failed. No changes were made.");
    } finally {
      setApplying(false);
    }
  };

  // Merge client-side rejects (never reached the server) with server results so the
  // preview + error report show EVERY problem row.
  const mergedPreview = useMemo(() => {
    const clientInvalid = parsedRows
      .filter((r) => r.clientStatus === "invalid")
      .map((r) => ({
        row: r.fileLine,
        submissionId: r.submissionId,
        targetCell: r.targetCell,
        status: "invalid",
        code: "client",
        message: r.clientMessage,
      }));
    return [...clientInvalid, ...previewRows];
  }, [parsedRows, previewRows]);

  const invalidRows = mergedPreview.filter((r) => r.status === "invalid");

  const downloadErrorReport = () => {
    const aoa = [
      ["File Line", "Submission ID", "Target Cell", "Status", "Issue", "Message"],
      ...invalidRows.map((r) => [
        r.row ?? "",
        r.submissionId || "",
        r.targetCell || "",
        STATUS_META[r.status]?.label || r.status,
        CODE_LABEL[r.code] || r.code || "",
        r.message || "",
      ]),
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 10 }, { wch: 18 }, { wch: 20 }, { wch: 12 }, { wch: 18 }, { wch: 48 }];
    XLSX.utils.book_append_sheet(wb, ws, "Errors");
    XLSX.writeFile(wb, `cell-assignments-errors-${dayjs().format("YYYYMMDD-HHmm")}.xlsx`);
  };

  const hasParsed = parsedRows.length > 0;
  const hasPreview = mergedPreview.length > 0;
  const canApply =
    hasPreview && summary && summary.invalid === 0 && sendableAssignments.length > 0 && !invalidRows.length;

  const currentStep = applying || (summary && canApply) ? 2 : hasPreview ? 1 : hasParsed ? 1 : 0;

  const previewColumns = [
    { title: "Line", dataIndex: "row", width: 60 },
    { title: "Ticket No", dataIndex: "disposalTicketNo", width: 120, ellipsis: true, render: (v) => v || "—" },
    {
      title: "Capacity",
      dataIndex: "truckCapacity",
      width: 100,
      align: "right",
      render: (v) => (Number(v) > 0 ? Number(v).toLocaleString() : "—"),
    },
    { title: "Submission", dataIndex: "submissionId", width: 130, ellipsis: true, render: (v) => v || "—" },
    { title: "Target Cell", dataIndex: "targetCell", width: 130, ellipsis: true, render: (v) => v || "—" },
    {
      title: "Remaining",
      dataIndex: "remaining",
      width: 100,
      render: (v) => (v == null ? "—" : `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })} m³`),
    },
    {
      title: "Status",
      dataIndex: "status",
      width: 150,
      render: (v, r) => {
        const meta = STATUS_META[v] || STATUS_META.invalid;
        return (
          <Tag color={meta.color} icon={meta.icon}>
            {r.code && CODE_LABEL[r.code] ? CODE_LABEL[r.code] : meta.label}
          </Tag>
        );
      },
    },
    { title: "Message", dataIndex: "message", ellipsis: true, render: (v) => v || "" },
  ];

  return (
    <Modal
      title={
        <Space>
          <ThunderboltOutlined style={{ color: "#722ed1" }} />
          <span>Bulk Organize Cells (File Upload)</span>
          <Tooltip title="What does Bulk Organize do?">
            <Button
              type="text"
              size="small"
              icon={<QuestionCircleOutlined />}
              onClick={() => setHelpOpen(true)}
            />
          </Tooltip>
        </Space>
      }
      open={open}
      onCancel={onClose}
      width={900}
      destroyOnHidden
      footer={[
        <Button key="close" onClick={onClose}>
          Close
        </Button>,
        <Button
          key="validate"
          icon={<CheckCircleOutlined />}
          onClick={runValidate}
          loading={validating}
          disabled={!sendableAssignments.length}
        >
          Validate ({sendableAssignments.length})
        </Button>,
        <Button
          key="apply"
          type="primary"
          icon={<CheckCircleOutlined />}
          onClick={runApply}
          loading={applying}
          disabled={!canApply}
        >
          Apply Assignments
        </Button>,
      ]}
      styles={{ body: { maxHeight: "70vh", overflowY: "auto" } }}
    >
      <Steps
        size="small"
        current={currentStep}
        style={{ marginBottom: 16 }}
        items={[
          { title: "Download & Fill" },
          { title: "Upload & Validate" },
          { title: "Apply" },
        ]}
      />

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="How bulk organization works"
        description={
          <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
            <li>Download the template — it is pre-filled with every transaction that still needs a cell, identified by its <b>Row ID</b> and <b>Submission Ticket No</b>.</li>
            <li>Fill the <b>Target Cell</b> column using a cell name from the <b>Available Cells</b> sheet. Leave rows blank to skip them. Do not change <b>Row ID</b> or <b>Submission Ticket No</b> — they identify the trip being organized.</li>
            <li>Check the <b>Truck Capacity</b> column. It is already filled in where that plate&apos;s capacity is on your <b>Baseline Data</b>; a <b>blank</b> means that trip has no capacity on record and you must enter one, or the row will be rejected.</li>
            <li>Upload the completed file, then <b>Validate</b>. Invalid rows are flagged and can be exported.</li>
            <li>When every row is valid, click <b>Apply Assignments</b> — all rows are saved together (all-or-nothing).</li>
          </ol>
        }
      />

      <Space wrap style={{ marginBottom: 12 }}>
        <Button icon={<DownloadOutlined />} onClick={downloadTemplate} disabled={!placementRows.length}>
          Download Template ({placementRows.length})
        </Button>
        <Upload accept=".xlsx,.xls,.csv" showUploadList={false} beforeUpload={parseFile} maxCount={1}>
          <Button icon={<UploadOutlined />}>Upload Completed File</Button>
        </Upload>
        {invalidRows.length > 0 && (
          <Tooltip title="Export only the rows that failed, with their error messages">
            <Button icon={<FileExcelOutlined />} danger onClick={downloadErrorReport}>
              Download Error Report ({invalidRows.length})
            </Button>
          </Tooltip>
        )}
      </Space>

      {parseError && (
        <Alert type="error" showIcon style={{ marginBottom: 12 }} message={parseError} />
      )}

      {hasParsed && (
        <Paragraph type="secondary" style={{ marginBottom: 8 }}>
          <Text strong>{sendableAssignments.length}</Text> row(s) ready to validate
          {parsedRows.length - sendableAssignments.length > 0 && (
            <>
              , <Text type="danger">{parsedRows.length - sendableAssignments.length}</Text> row(s) rejected before sending
            </>
          )}
          .
        </Paragraph>
      )}

      {summary && (
        <Space wrap style={{ marginBottom: 10 }}>
          <Tag>Total selected: {sendableAssignments.length + (parsedRows.length - sendableAssignments.length)}</Tag>
          <Tag color="success">{summary.valid} ready</Tag>
          {summary.warning > 0 && <Tag color="warning">{summary.warning} skipped</Tag>}
          <Tag color={(summary.invalid + invalidRows.filter((r) => r.code === "client").length) ? "error" : "default"}>
            {summary.invalid + invalidRows.filter((r) => r.code === "client").length} failed
          </Tag>
          {canApply ? (
            <Text type="success">All rows passed — ready to apply.</Text>
          ) : (
            <Text type="warning">Resolve failed rows before applying (see reasons below).</Text>
          )}
        </Space>
      )}

      {hasPreview && (
        <Table
          size="small"
          rowKey={(r, i) => `${r.row}-${r.submissionId}-${i}`}
          columns={previewColumns}
          dataSource={mergedPreview}
          pagination={{ pageSize: 10, size: "small", showSizeChanger: false }}
          scroll={{ x: 720 }}
        />
      )}

      {/* Help — describes the ACTUAL behavior of the function (no unsupported claims). */}
      <Modal
        open={helpOpen}
        onCancel={() => setHelpOpen(false)}
        title={<Space><QuestionCircleOutlined style={{ color: "#722ed1" }} /> About Bulk Organize</Space>}
        footer={[<Button key="ok" type="primary" onClick={() => setHelpOpen(false)}>Got it</Button>]}
      >
        <Paragraph style={{ marginBottom: 8 }}>
          <Text strong>What it does:</Text> assigns a target landfill cell to many
          unorganized truck/vehicle placements at once, using a spreadsheet instead of
          the one-by-one organizer.
        </Paragraph>
        <Paragraph style={{ marginBottom: 8 }}>
          <Text strong>Which records are eligible:</Text> only your submissions that
          still have a placement without a cell. Rows you leave blank are skipped.
          Records that are locked (e.g. reverted, rejected, or already finalized) are
          rejected by the server and reported as failed — they are never changed here.
        </Paragraph>
        <Paragraph style={{ marginBottom: 8 }}>
          <Text strong>What changes:</Text> each selected placement is assigned to the
          Target Cell you specify, and its volume then counts toward that cell&apos;s fill.
          Nothing else on the submission is modified — not its volume, not its
          reference, not its status.
        </Paragraph>
        <Paragraph style={{ marginBottom: 8 }}>
          <Text strong>Moving waste that is already placed:</Text> if a placement
          already sits in a cell — including one on an <b>acknowledged</b> submission —
          setting a different Target Cell <b>moves</b> that same volume. It is taken out
          of the old cell and put into the new one; your total submitted volume does not
          change, only which cell holds it. The move is recorded against the submission.
        </Paragraph>
        <Paragraph style={{ marginBottom: 8 }}>
          <Text strong>Reverted / rejected:</Text> these must be corrected and
          resubmitted first — those rows are flagged as failed, not applied. Waste can
          only be placed into a cell that is currently operational and has room.
        </Paragraph>
        <Paragraph style={{ marginBottom: 0 }}>
          <Text strong>Partial failures &amp; reversal:</Text> the apply is
          all-or-nothing — if any row fails validation, no changes are saved and you can
          download an error report. Applied cell assignments are not destructive: you
          can re-organize a placement later through the normal organizer.
        </Paragraph>
      </Modal>
    </Modal>
  );
}
