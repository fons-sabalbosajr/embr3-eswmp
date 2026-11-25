import { useState, useRef, useMemo } from "react";
import { Space, Tag, Tooltip, Button } from "antd";
import { Text } from "../portalShared";
import { logClientError } from "../../../api";
import * as XLSX from "xlsx";
import {
  cleanUploadText,
  getUploadMissingColumns,
  parseHaulerUploadRow,
  uploadHeaderKey,
  UPLOAD_COLUMNS,
  parseUploadNumber,
  normalizeUploadUnit,
  getUploadRelationshipErrors,
  findUploadHauler,
  findUploadClientsForHauler,
  getUploadRowErrors,
  annotateHaulerUploadRows,
  summarizeHaulerUpload,
} from "../uploadHelpers";
import dayjs from "dayjs";
import { isTripRow, detectSystemGeneratedFile, alignDisposalRow, summarizeAlignment } from "../systemGeneratedUpload";
import { uploadRowToSlfUnit, describeConversion, factorText } from "../enteredVolume";
import { DeleteOutlined } from "@ant-design/icons";
import { HAULER_VERA_ASSESSMENT_PROMPT, buildHaulerVeraContext } from "../haulerVeraContext";
import { DISPOSAL_VERA_ASSESSMENT_PROMPT, buildDisposalVeraContext } from "../disposalVeraContext";
import Swal from "sweetalert2";
import { applyBacklogRules } from "../backlogUpload";

export default function useExcelUpload({
  activeCellOptions, baselineUnit, haulers, portalUser, resolveUploadCellValue, slfUnit, late,
}) {
  // Excel/CSV upload states
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadType, setUploadType] = useState("truck"); // "truck" or "hauler"
  const [uploadGuideOpen, setUploadGuideOpen] = useState(false);
  const [uploadGuideType, setUploadGuideType] = useState(null); // pending type for guide → pick
  const [uploadPreviewData, setUploadPreviewData] = useState([]);
  const [uploadPreviewColumns, setUploadPreviewColumns] = useState([]);
  const [uploadMissingColumns, setUploadMissingColumns] = useState([]);
  // What detectSystemGeneratedFile made of the file that is currently previewed
  // (disposal uploads only; null for a hauler upload). Advisory — it changes what
  // the preview explains, never whether a row is valid.
  const [uploadDetection, setUploadDetection] = useState(null);
  // ── VERA assessment of an upload ──
  // Deliberately separate from the validation outcome: "the preview is valid but
  // VERA could not answer" must be sayable without reading as a validation
  // failure. The cycle ref discards a late answer that describes a file the user
  // has already replaced. Named for the hauler upload it was built for; it now
  // also carries the disposal upload's assessment, which asks a different
  // question of a different snapshot but needs exactly this state machine.
  const [haulerVeraStage, setHaulerVeraStage] = useState("idle"); // idle | assessing | done | failed
  const [haulerVeraComment, setHaulerVeraComment] = useState("");
  const [haulerVeraError, setHaulerVeraError] = useState(null);
  const [haulerVeraSource, setHaulerVeraSource] = useState(null);
  const haulerVeraCycleRef = useRef(0);
  // Excel upload progress UX
  const [uploadProgressOpen, setUploadProgressOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatusText, setUploadStatusText] = useState("");
  const [uploadProgressError, setUploadProgressError] = useState(false);

  // ── Accredited-hauler upload: what the import will DO with each row ──
  // One cell carries both the operation and, when the row cannot be imported,
  // the reason — so an administrator never has to reconcile the uploaded file
  // against the baseline table by hand.
  const HAULER_UPLOAD_STATUS_META = {
    new: { color: "green", label: "New", hint: "Will be added" },
    update: { color: "blue", label: "Update", hint: "Existing hauler — will be updated" },
    duplicate: { color: "orange", label: "Duplicate", hint: "Merged into an earlier row" },
    invalid: { color: "red", label: "Invalid", hint: "Fix before importing" },
  };
  const renderHaulerUploadStatus = (row = {}) => {
    const meta = HAULER_UPLOAD_STATUS_META[row._status] || HAULER_UPLOAD_STATUS_META.new;
    return (
      <Space direction="vertical" size={2} style={{ width: "100%" }}>
        <Tag color={meta.color} style={{ marginInlineEnd: 0 }}>
          {meta.label}
        </Tag>
        {row._errors?.length ? (
          <Text type="danger" style={{ fontSize: 10, lineHeight: 1.3 }}>
            {row._errors.join("; ")}
          </Text>
        ) : row._duplicateOfRow != null ? (
          <Text type="warning" style={{ fontSize: 10, lineHeight: 1.3 }}>
            Same hauler and plate as row {row._duplicateOfRow} — merged into it.
          </Text>
        ) : (
          <Text type="secondary" style={{ fontSize: 10, lineHeight: 1.3 }}>
            {meta.hint}
          </Text>
        )}
      </Space>
    );
  };

  // ── Excel/CSV Upload Handlers ──
  // The workbook is parsed entirely in the browser, on the main thread. A file
  // past this size is not a disposal log — it is an export with pictures or a
  // decade of sheets — and parsing it froze the tab with the progress bar
  // stuck at "Reading file…", which read as an upload that hung. Refuse it
  // with the reason instead. The submission itself carries only the parsed
  // rows, so this bounds browser work, not what the server accepts.
  const MAX_UPLOAD_FILE_MB = 20;
  const handleExcelUpload = (file, type) => {
    const effectiveType = type || uploadType || "truck";
    setUploadType(effectiveType);
    setUploadProgressError(false);
    setUploadProgress(8);
    setUploadStatusText("Reading file…");
    setUploadProgressOpen(true);
    if (file && file.size > MAX_UPLOAD_FILE_MB * 1024 * 1024) {
      setUploadProgressError(true);
      setUploadStatusText(
        `This file is ${(file.size / 1024 / 1024).toFixed(1)} MB; uploads are limited to ${MAX_UPLOAD_FILE_MB} MB. Remove images or extra sheets, or split it into smaller files.`,
      );
      logClientError({
        message: "Upload rejected: file too large",
        meta: { stage: "excel-upload", sizeBytes: file.size, name: file.name, type: effectiveType },
      });
      return false;
    }
    const reader = new FileReader();
    reader.onerror = () => {
      setUploadProgressError(true);
      setUploadStatusText("Could not read the file. Please try again.");
      logClientError({
        message: "Upload failed: file could not be read",
        meta: { stage: "excel-upload", name: file?.name, type: effectiveType },
      });
    };
    reader.onload = (e) => {
      try {
        setUploadProgress(30);
        setUploadStatusText("Parsing spreadsheet…");
        const wb = XLSX.read(e.target.result, { type: "array" });
        const sheetName = (wb.SheetNames || [])[0];
        const ws = sheetName ? wb.Sheets[sheetName] : null;
        if (!ws) {
          setUploadProgressError(true);
          setUploadStatusText("No worksheet found in the uploaded file.");
          return;
        }
        const jsonData = XLSX.utils
          .sheet_to_json(ws, { defval: "" })
          .filter((row) =>
            Object.values(row || {}).some((value) => cleanUploadText(value) !== ""),
          );
        if (jsonData.length === 0) {
          setUploadProgressError(true);
          setUploadStatusText("No data rows found in the uploaded file.");
          return;
        }
        setUploadProgress(55);
        setUploadStatusText(`Validating ${jsonData.length} row(s)…`);
        const headers = Object.keys(jsonData[0] || {});
        const missingColumns = getUploadMissingColumns(headers, effectiveType);
        setUploadMissingColumns(missingColumns);
        // Normalize column names
        const normalizeUploadDate = (value) => {
          if (value instanceof Date) return dayjs(value).isValid() ? dayjs(value).format("YYYY-MM-DD") : "";
          if (typeof value === "number") {
            const parsed = XLSX.SSF.parse_date_code(value);
            if (parsed) return dayjs(new Date(parsed.y, parsed.m - 1, parsed.d)).format("YYYY-MM-DD");
          }
          const text = cleanUploadText(value);
          if (!text) return "";
          const parsed = dayjs(text, ["YYYY-MM-DD", "MM/DD/YYYY", "M/D/YYYY", "YYYY/MM/DD"], true);
          return parsed.isValid() ? parsed.format("YYYY-MM-DD") : text;
        };
        // PASS 1 — file values → the Portal's row shape. No validation and no
        // baseline lookups yet: the alignment pass below has to see the raw
        // Hauler / Client the file actually wrote, and the detector has to see
        // them before anything rewrites them.
        const parsedRows = jsonData.map((row, i) => {
          const normalized = { key: `upload-${i}-${Date.now()}`, _rowNumber: i + 2 };
          // Haulers are mapped by the shared schema (uploadHelpers) rather than
          // an inline header chain, so the sample template and the parser can
          // never drift apart.
          if (effectiveType !== "truck") {
            Object.assign(
              normalized,
              parseHaulerUploadRow(row, { fallbackUnit: baselineUnit || slfUnit }),
            );
          }
          for (const [key, value] of Object.entries(row)) {
            const k = uploadHeaderKey(key);
            if (effectiveType === "truck") {
              if (UPLOAD_COLUMNS.truck.find((column) => column.field === "disposalDate")?.matches(k))
                normalized.disposalDate = normalizeUploadDate(value);
              else if (UPLOAD_COLUMNS.truck.find((column) => column.field === "disposalTicketNo")?.matches(k))
                normalized.disposalTicketNo = cleanUploadText(value);
              else if (UPLOAD_COLUMNS.truck.find((column) => column.field === "hauler")?.matches(k)) normalized.hauler = cleanUploadText(value);
              else if (UPLOAD_COLUMNS.truck.find((column) => column.field === "client")?.matches(k)) normalized.client = cleanUploadText(value);
              else if (k.includes("plate"))
                normalized.plateNumber = cleanUploadText(value);
              else if (k.includes("capacity") && !k.includes("unit"))
                normalized.truckCapacity = parseUploadNumber(value);
              else if (UPLOAD_COLUMNS.truck.find((column) => column.field === "actualVolume")?.matches(k))
                normalized.actualVolume = parseUploadNumber(value);
              else if (UPLOAD_COLUMNS.truck.find((column) => column.field === "actualVolumeUnit")?.matches(k))
                // Canonical, not cosmetic: helpers#normalizeUnit only rewrites
                // "m3" → "m³", so "Tons"/"TONS"/"M3"/"t" reached the submit gate
                // as-is and were rejected as a unit mismatch against an identical
                // baseline unit. normalizeUploadUnit folds those onto the one
                // spelling the app converts with, and leaves a genuinely unknown
                // unit alone for getUploadRowErrors to reject by name.
                normalized.actualVolumeUnit = normalizeUploadUnit(value, baselineUnit || slfUnit);
              else if (UPLOAD_COLUMNS.truck.find((column) => column.field === "cellName")?.matches(k))
                Object.assign(normalized, resolveUploadCellValue(value));
              else if (k.includes("waste") && k.includes("type"))
                normalized.wasteType = cleanUploadText(value);
              else if (k.includes("haz") || k.includes("code"))
                normalized.hazWasteCode = cleanUploadText(value)
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean);
            }
          }
          return normalized;
        });

        // PASS 2 — drop spreadsheet remnants, then work out whether this is a
        // machine export rather than a hand-made file.
        //
        // A remnant is a row carrying no date, ticket, plate, cell, waste type or
        // volume — nothing a trip is made of — typically a stray number an
        // operator left in a cell below the data. The real Prime Waste Solution
        // export ends with three of them. They could only ever fail validation,
        // and while they were in the batch they appeared in the list of clients
        // missing from the baseline as bare numbers. The count is reported rather
        // than the removal being silent.
        //
        // Detection itself is advisory: it changes what the preview SAYS and what
        // VERA is shown, never whether a row is valid. See systemGeneratedUpload
        // for why a gate system writes one party into both columns.
        const tripRows =
          effectiveType === "truck" ? parsedRows.filter(isTripRow) : parsedRows;
        const skippedStrayRows = parsedRows.length - tripRows.length;
        const detection =
          effectiveType === "truck"
            ? { ...detectSystemGeneratedFile(headers, tripRows), skippedStrayRows }
            : { isSystemGenerated: false, skippedStrayRows: 0 };
        setUploadDetection(effectiveType === "truck" ? detection : null);
        if (effectiveType === "truck" && tripRows.length === 0) {
          setUploadProgressError(true);
          setUploadStatusText(
            "No disposal entries found. Every row is missing a date, ticket number, plate, cell, waste type and volume — check that the first sheet holds the disposal data.",
          );
          return;
        }

        // PASS 3 — resolve each row against the baseline, then validate.
        //
        // Alignment runs BEFORE validation deliberately: where it succeeds it has
        // rewritten Hauler / Client to the baseline's own spelling, so the ordinary
        // relationship check then passes — and, because those are the canonical
        // names, so does the server's identical check at submit time. Where it
        // fails it contributes an error naming the record that is actually
        // missing, in place of the relationship check's "hauler is not assigned",
        // which was true but pointed at the wrong thing.
        const normalized = tripRows.map((parsed) => {
          const row = effectiveType === "truck" ? alignDisposalRow(parsed, haulers) : parsed;
          const alignmentErrors = row._alignmentErrors || [];
          const relationshipErrors =
            effectiveType === "truck" && alignmentErrors.length === 0
              ? getUploadRelationshipErrors(row, haulers)
              : [];
          if (effectiveType === "truck" && alignmentErrors.length === 0 && relationshipErrors.length === 0) {
            const matchedHauler = findUploadHauler(haulers, row.hauler);
            // Plural: a single Client cell may name several clients served on the
            // same trip. All of them are bound to the row, so the submission
            // records every client the waste actually came from.
            const matchedClients = findUploadClientsForHauler(matchedHauler, row.client).clients;
            if (matchedClients.length) row._matchedClients = matchedClients;
          }
          const cellKnown = effectiveType !== "truck" || !row.cellName || row.cellIndex != null || activeCellOptions.length === 0;
          return {
            ...row,
            _errors: [
              ...getUploadRowErrors(row, effectiveType),
              ...alignmentErrors,
              ...relationshipErrors,
              ...(cellKnown ? [] : [`Row ${row._rowNumber} — Cell or Disposal Area "${row.cellName}" is not an available cell under this SLF.`]),
            ],
          };
        });
        setUploadPreviewData(normalized);

        setUploadProgress(80);
        setUploadStatusText("Preparing preview…");
        // Build editable columns
        if (effectiveType === "truck") {
          setUploadPreviewColumns([
            { title: "#", width: 44, render: (_, __, i) => i + 1 },
            {
              title: "Ticket No.",
              dataIndex: "disposalTicketNo",
              key: "disposalTicketNo",
              width: 100,
            },
            { title: "Disposal Date", dataIndex: "disposalDate", key: "disposalDate", width: 130 },
            {
              // Merged: these two are ONE fact — a trip is attributed through
              // Hauler → Client, they are validated as a pair, and every alignment
              // and mismatch message names both. Side by side they cost 340px of a
              // grid that already scrolls sideways; stacked in one cell they cost
              // 260 and read as the relationship they are. `stackedFields` keeps
              // each of them individually editable (see the preview modal's
              // column mapper).
              title: "Hauler → Client",
              key: "haulerClient",
              width: 300,
              stackedFields: [
                { field: "hauler", label: "Hauler" },
                { field: "client", label: "Client" },
              ],
            },
            {
              // What the file said versus what it was resolved to. A row the
              // alignment pass rewrote MUST show that it was rewritten: the
              // operator is about to import a trip attributed to a hauler/client
              // pair the file did not literally name, and they have to be able to
              // see — and reject — that before it is saved.
              title: "Match",
              key: "alignment",
              width: 100,
              render: (_, row) => {
                const alignment = row._alignment;
                if (!alignment) {
                  return <Tag color="green">Exact</Tag>;
                }
                if (alignment.status === "aligned") {
                  return (
                    <Tooltip
                      title={`${alignment.note} Written in the file as: "${alignment.originalHauler}" / "${alignment.originalClient}".`}
                    >
                      <Tag color="gold">Matched · {alignment.method}</Tag>
                    </Tooltip>
                  );
                }
                if (alignment.status === "mismatch") {
                  return (
                    <Tooltip
                      title={`${alignment.note} Resolve it in the panel above the table.`}
                    >
                      <Tag color="volcano">Name mismatch</Tag>
                    </Tooltip>
                  );
                }
                return (
                  <Tooltip title={alignment.note}>
                    <Tag color="red">
                      {alignment.status === "ambiguous" ? "Ambiguous" : "Not on baseline"}
                    </Tag>
                  </Tooltip>
                );
              },
            },
            {
              title: "Plate No.",
              dataIndex: "plateNumber",
              key: "plateNumber",
              width: 120,
            },
            {
              // Merged: three numbers that are only meaningful together. The unit
              // applies to BOTH the capacity and the volume, and the one check an
              // operator makes here — is the load plausible against the truck's
              // registered capacity? — needs all three in the same glance. Three
              // separate columns put the unit two columns away from the figures it
              // qualifies, and cost 310px instead of 170.
              title: "Capacity / Volume",
              key: "capacityVolume",
              width: 150,
              stackedFields: [
                { field: "truckCapacity", label: "Truck capacity" },
                { field: "actualVolume", label: "Volume disposed" },
                { field: "actualVolumeUnit", label: "Unit" },
              ],
            },
            {
              // What the row will be saved as. A row weighed in the OTHER unit
              // (tons at an m³ SLF) is converted on import with the system
              // factor, and the original is kept — shown here first so the
              // operator can check it before importing.
              title: "Saved as",
              key: "savedAs",
              width: 120,
              render: (_, record) => {
                const unit = baselineUnit || slfUnit;
                const converted = uploadRowToSlfUnit(record, unit);
                const volume = converted.actualVolume;
                if (volume === null || volume === undefined || volume === "") return <Text type="secondary">—</Text>;
                const label = `${Number(volume).toLocaleString(undefined, { maximumFractionDigits: 3 })} ${unit}`;
                if (converted === record) return <Text style={{ fontSize: 12 }}>{label}</Text>;
                return (
                  <Tooltip title={`${describeConversion(converted, unit)} (${factorText(unit)}). The weighed value is kept with the record.`}>
                    <Space direction="vertical" size={0}>
                      <Text strong style={{ fontSize: 12 }}>{label}</Text>
                      <Tag color="gold" style={{ marginInlineEnd: 0, fontSize: 10.5 }}>
                        from {converted.enteredVolume} {converted.enteredVolumeUnit}
                      </Tag>
                    </Space>
                  </Tooltip>
                );
              },
            },
            {
              // Narrow on purpose, and only viable because the picker now shows
              // the cell's VALUE once chosen ("Cell 4" — see optionLabelProp in
              // the preview modal) rather than its descriptive label. The full
              // "Cell 4 - Treated Hazardous Waste" still appears in the dropdown,
              // where it is what you actually read while choosing; at this width
              // it would otherwise have wrapped onto three or four lines in every
              // row. A value from the file that is not a cell at all is the one
              // exception — it wraps, and is flagged in red.
              title: "Cell",
              dataIndex: "cellName",
              key: "cellName",
              width: 100,
            },
            { title: "Waste Type", dataIndex: "wasteType", key: "wasteType", width: 190 },
            {
              // The messages are TEXT, not a tag.
              //
              // They used to be joined into one `<Tag color="red">`, and a Tag is
              // an inline-block with `white-space: nowrap` — so a row's errors
              // became a single unbreakable box wider than the column, which the
              // table then widened the whole column to fit, pushing every other
              // column off to the side. The td already wraps (see
              // .slf-upload-preview-table in SLFPortal.css); only the Tag did not.
              // The relationship and alignment messages are full sentences, so this
              // was guaranteed to distort the grid on any file with a problem.
              //
              // A short Tag now carries the COUNT — which is what the eye scans
              // for — and the messages sit under it in a wrapping block, one per
              // line rather than comma-joined, so several issues on one row stay
              // readable.
              title: "Validation",
              key: "validation",
              // The widest column in the grid, and deliberately so: it is the only
              // one holding sentences rather than values. The relationship and
              // alignment messages name a hauler AND a client AND the fix, so at
              // anything narrower they wrapped into a tall, thin ribbon that was
              // harder to read than the error it described. The table scrolls
              // sideways under a pinned header, so the extra width costs nothing
              // the operator cannot scroll to.
              width: 380,
              onCell: () => ({
                style: {
                  whiteSpace: "normal",
                  overflowWrap: "anywhere",
                  wordBreak: "break-word",
                  verticalAlign: "top",
                },
              }),
              render: (_, row) => {
                const errors = row._errors || [];
                if (errors.length === 0) return <Tag color="green">Ready</Tag>;
                return (
                  <div style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>
                    <Tag color="red" style={{ marginInlineEnd: 0, marginBottom: 4 }}>
                      {errors.length} issue{errors.length === 1 ? "" : "s"}
                    </Tag>
                    <div style={{ color: "#a8071a", fontSize: 12.5, lineHeight: 1.4 }}>
                      {errors.map((message, index) => (
                        <div key={index} style={{ marginTop: index === 0 ? 0 : 3 }}>
                          {message}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              },
            },
            {
              title: "Actions",
              key: "actions",
              width: 80,
              render: (_, r) => (
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={() =>
                    setUploadPreviewData((prev) =>
                      prev.filter((p) => p.key !== r.key),
                    )
                  }
                />
              ),
            },
          ]);
        } else {
          setUploadPreviewColumns([
            { title: "#", key: "index", width: 40, render: (_, __, i) => i + 1 },
            {
              title: "Action",
              key: "status",
              width: 140,
              render: (_, row) => renderHaulerUploadStatus(row),
            },
            {
              title: "Hauler Name",
              dataIndex: "haulerName",
              key: "haulerName",
              width: 160,
            },
            {
              title: "Trucks",
              dataIndex: "numberOfTrucks",
              key: "numberOfTrucks",
              width: 62,
            },
            {
              title: "Office Address",
              dataIndex: "officeAddress",
              key: "officeAddress",
              width: 140,
            },
            {
              title: "Plate No.",
              dataIndex: "plateNumber",
              key: "plateNumber",
              width: 92,
            },
            {
              title: "Vehicle Type",
              dataIndex: "vehicleType",
              key: "vehicleType",
              width: 100,
            },
            { title: "Capacity", dataIndex: "capacity", key: "capacity", width: 72 },
            // Editable because it is VALIDATED (the stored unit is enum-constrained):
            // an unusable unit in the file must be fixable here rather than sending
            // the user back to the spreadsheet.
            { title: "Unit", dataIndex: "capacityUnit", key: "capacityUnit", width: 74 },
            {
              title: "Clients",
              dataIndex: "privateSectorClients",
              key: "privateSectorClients",
              width: 146,
              render: (val) =>
                Array.isArray(val) && val.length > 0
                  ? val.join(", ")
                  : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>,
            },
            { title: "Client Type", dataIndex: "clientType", key: "clientType", width: 86 },
            { title: "Client Address", dataIndex: "clientAddress", key: "clientAddress", width: 120 },
            { title: "Client Region", dataIndex: "clientRegion", key: "clientRegion", width: 110 },
            { title: "Client Province", dataIndex: "clientProvince", key: "clientProvince", width: 104 },
            {
              title: "Client City/Municipality",
              dataIndex: "clientMunicipality",
              key: "clientMunicipality",
              width: 120,
            },
            {
              title: "",
              key: "actions",
              width: 60,
              render: (_, r) => (
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={() =>
                    setUploadPreviewData((prev) =>
                      prev.filter((p) => p.key !== r.key),
                    )
                  }
                />
              ),
            },
          ]);
        }
        setUploadProgress(100);
        setUploadStatusText("Done! Opening preview…");
        setTimeout(() => {
          setUploadProgressOpen(false);
          setUploadModalOpen(true);
        }, 400);

        // VERA assesses only a CLEAN hauler preview — decided here from the
        // just-parsed rows and the missing-column result, never from state that
        // has not re-rendered yet. A file with any failing row goes back to the
        // user to correct instead; there is nothing to second-guess until the
        // rows are at least valid.
        if (effectiveType === "hauler") {
          haulerVeraCycleRef.current += 1;
          const cleanPreview =
            missingColumns.length === 0 &&
            normalized.length > 0 &&
            normalized.every((row) => !row._errors?.length);
          if (cleanPreview) {
            const annotated = annotateHaulerUploadRows(normalized, haulers);
            late.runUploadVeraAssessment({
              message: HAULER_VERA_ASSESSMENT_PROMPT,
              pageContext: buildHaulerVeraContext(
                annotated,
                summarizeHaulerUpload(annotated),
                haulers,
              ),
            });
          } else {
            setHaulerVeraStage("idle");
            setHaulerVeraComment("");
            setHaulerVeraError(null);
            setHaulerVeraSource(null);
          }
        }

        // A disposal upload asks VERA when there is something it can usefully
        // explain: rows the alignment pass matched for the operator (which they
        // should confirm before importing), rows it could not (which name the
        // baseline records to encode), or a file that looks machine-generated. A
        // clean, ordinary file needs no commentary and gets none.
        if (effectiveType === "truck") {
          haulerVeraCycleRef.current += 1;
          const alignment = summarizeAlignment(normalized);
          const worthExplaining =
            normalized.length > 0 &&
            (detection.isSystemGenerated ||
              alignment.alignedCount > 0 ||
              alignment.ambiguousCount > 0 ||
              alignment.mismatches.length > 0 ||
              alignment.needsEncoding.length > 0);
          if (worthExplaining) {
            late.runUploadVeraAssessment({
              message: DISPOSAL_VERA_ASSESSMENT_PROMPT,
              pageContext: buildDisposalVeraContext(normalized, alignment, detection),
            });
          } else {
            setHaulerVeraStage("idle");
            setHaulerVeraComment("");
            setHaulerVeraError(null);
            setHaulerVeraSource(null);
          }
        }
      } catch (err) {
        setUploadProgressError(true);
        setUploadStatusText(
          "Could not parse the uploaded file. Please check the format and try again.",
        );
        // Was silent: a file the parser rejects left no trace for an admin to
        // act on when the operator reported "the upload doesn't work".
        logClientError({
          message: `Upload failed: ${err?.message || "could not parse workbook"}`,
          meta: { stage: "excel-upload", name: file?.name, sizeBytes: file?.size, type: effectiveType },
        });
      }
    };
    // Build columns / normalize were tracked via progress; defer parsing a tick so the
    // progress modal can paint before heavy work begins.
    setTimeout(() => reader.readAsArrayBuffer(file), 50);
    return false; // prevent auto upload
  };

  // ── Open upload guide modal first, then trigger file picker on proceed ──
  const openUploadGuide = (type) => {
    if (portalUser?.portalAccess?.canUploadExcel === false) {
      Swal.fire(
        "Excel Upload Disabled",
        "Your account is not permitted to upload Excel/CSV files. Please contact EMB Region III.",
        "warning",
      );
      return;
    }
    setUploadGuideType(type);
    setUploadGuideOpen(true);
  };
  const proceedToFilePicker = () => {
    setUploadGuideOpen(false);
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx,.xls,.csv";
    input.onchange = (e) => {
      if (e.target.files[0])
        handleExcelUpload(e.target.files[0], uploadGuideType);
    };
    input.click();
  };

  // The preview rows the modal actually renders, and the ones the import reads.
  //
  // The new/update/duplicate classification is DERIVED from the parsed rows and
  // the haulers currently on the baseline, never stored on the rows — so it
  // stays correct after an inline edit, after a row is deleted from the preview,
  // and after a baseline refresh, with no re-annotation step to forget.
  const uploadPreviewRows = useMemo(
    () =>
      uploadType === "hauler"
        ? annotateHaulerUploadRows(uploadPreviewData, haulers)
        : // A file spanning several dates is a backlog: dates outside the
          // one-month window are row errors (see backlogUpload.js).
          applyBacklogRules(uploadPreviewData),
    [uploadPreviewData, haulers, uploadType],
  );
  const uploadPreviewSummary = useMemo(
    () =>
      uploadType === "hauler"
        ? summarizeHaulerUpload(uploadPreviewRows)
        : {
            total: uploadPreviewRows.length,
            invalid: uploadPreviewRows.filter((row) => row._errors?.length).length,
            valid: uploadPreviewRows.filter((row) => !row._errors?.length).length,
          },
    [uploadPreviewRows, uploadType],
  );

  return {
    haulerVeraComment, haulerVeraCycleRef, haulerVeraError, haulerVeraSource, haulerVeraStage,
    openUploadGuide, proceedToFilePicker, setHaulerVeraComment, setHaulerVeraError,
    setHaulerVeraSource, setHaulerVeraStage, setUploadDetection, setUploadGuideOpen,
    setUploadGuideType, setUploadMissingColumns, setUploadModalOpen, setUploadPreviewColumns,
    setUploadPreviewData, setUploadProgressOpen, setUploadType, uploadDetection, uploadGuideOpen,
    uploadGuideType, uploadMissingColumns, uploadModalOpen, uploadPreviewColumns, uploadPreviewData,
    uploadPreviewRows, uploadPreviewSummary, uploadProgress, uploadProgressError,
    uploadProgressOpen, uploadStatusText, uploadType,
  };
}
