import { useCallback, useRef, useState } from "react";
import {
  Alert, Button, Input, Modal, Select, Space, Spin, Table, Tag, Tooltip, Typography,
} from "antd";
import {
  DownloadOutlined, FileExcelOutlined, InfoCircleOutlined, UploadOutlined,
} from "@ant-design/icons";
import * as XLSX from "xlsx";

import api from "../../api";
import VeraFlameIcon from "../../components/VeraFlameIcon";
import {
  CLIENT_UPLOAD_COLUMNS,
  annotateClientUploadRows,
  buildClientExportRows,
  getClientUploadMissingColumns,
  getClientUploadRowErrors,
  mergeClientListUpload,
  parseClientUploadRow,
  summarizeClientUpload,
  clientIdentity,
} from "./clientListUpload";
import {
  CLIENT_VERA_ASSESSMENT_PROMPT,
  buildClientListVeraContext,
} from "./clientListVeraContext";
import { cleanUploadText } from "./uploadHelpers";

const { Text } = Typography;

// ── Per-hauler client list: export / template / upload ──────────────────────
//
// Lives inside Edit Accredited Hauler, so the hauler is a given rather than
// something the file asserts — there is no Hauler Name column at all. That is
// the point of the feature: a portal user maintaining one hauler's clients in
// bulk cannot, on this path, misspell a hauler name and silently create a
// second hauler.
//
// Everything it applies goes into the hauler DRAFT, exactly as if the clients
// had been typed through Add Client. It is not saved until the modal's Update
// is clicked, and then not persisted until Save Baseline Update — the same two
// gates every other edit in this modal passes through.

const STATUS_META = {
  new: { color: "green", label: "Add" },
  update: { color: "blue", label: "Update" },
  duplicate: { color: "orange", label: "Duplicate" },
  invalid: { color: "red", label: "Fix row" },
};

export default function HaulerClientListPanel({
  haulerDraft,
  updateHaulerDraft,
  disabled = false,
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [missingColumns, setMissingColumns] = useState([]);
  const [parseError, setParseError] = useState("");
  const [fileName, setFileName] = useState("");

  // VERA stage is deliberately separate from the validation outcome: "the
  // preview is valid but VERA could not answer" has to be sayable without
  // reading as a validation failure.
  const [veraStage, setVeraStage] = useState("idle");
  const [veraComment, setVeraComment] = useState("");
  const [veraError, setVeraError] = useState(null);
  const [veraSource, setVeraSource] = useState(null);
  const veraCycleRef = useRef(0);

  const haulerName = haulerDraft?.haulerName || "";
  const existingClients = Array.isArray(haulerDraft?.privateSectorClients)
    ? haulerDraft.privateSectorClients
    : [];

  // Re-derived on every render from the rows and the hauler's CURRENT clients,
  // never stored on the rows — so the classification stays correct after an
  // inline edit or a row deletion, with no re-annotation step to forget.
  const annotated = annotateClientUploadRows(rows, existingClients);
  const summary = summarizeClientUpload(annotated);
  const blocked = missingColumns.length > 0 || annotated.some((r) => r._errors.length);

  const safeName = String(haulerName || "hauler").replace(/[^a-z0-9]+/gi, "_");

  const exportClientList = () => {
    const exported = buildClientExportRows(haulerDraft);
    const sheet = [
      CLIENT_UPLOAD_COLUMNS.map((column) => column.label),
      ...exported.map((row) => CLIENT_UPLOAD_COLUMNS.map((column) => row[column.field] ?? "")),
    ];
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(sheet);
    worksheet["!cols"] = CLIENT_UPLOAD_COLUMNS.map((column) => ({
      wch: Math.max(18, column.label.length + 2),
    }));
    XLSX.utils.book_append_sheet(workbook, worksheet, "Clients");
    XLSX.writeFile(workbook, `client-list_${safeName}.xlsx`);
  };

  // The template is generated FROM the same column definitions the parser reads,
  // so a file downloaded here always imports.
  const downloadClientTemplate = () => {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([
      CLIENT_UPLOAD_COLUMNS.map((column) => column.label),
      CLIENT_UPLOAD_COLUMNS.map((column) => column.sample || ""),
      CLIENT_UPLOAD_COLUMNS.map((column) =>
        column.field === "clientName"
          ? "Baliuag LGU"
          : column.field === "clientType"
            ? "LGU"
            : column.field === "provinceName"
              ? "Bulacan"
              : column.field === "municipalityName"
                ? "Baliuag"
                : column.field === "regionName"
                  ? "Region III (Central Luzon)"
                  : "",
      ),
    ]);
    worksheet["!cols"] = CLIENT_UPLOAD_COLUMNS.map((column) => ({
      wch: Math.max(18, column.label.length + 2),
    }));
    worksheet["!dataValidation"] = [
      { sqref: "B2:B200", type: "list", formula1: '"Private,LGU"' },
    ];
    XLSX.utils.book_append_sheet(workbook, worksheet, "Clients");
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        [`Client List Upload — ${haulerName || "Accredited Hauler"}`],
        ["Scope", "This file updates the clients of THIS hauler only. There is no Hauler Name column."],
        ["Matching key", "Client Name. A name already on this hauler UPDATES that client; a new name ADDS one. Case-insensitive."],
        ["Nothing is deleted", "This upload only adds and updates. A client left out of the file is kept. Remove a client from the Clients table instead."],
        ["Blank cells keep stored values", 'An empty optional cell means "leave what is already saved". It never clears a field.'],
        ["New clients", "A client being ADDED needs a Client Type and a Province — the same details the Add Client form asks for. The province is what classifies the client within or outside Region 3."],
        ["Saving", 'Applying updates this modal only. Click Update, then "Save Baseline Update" to persist.'],
        [],
        ["Column", "Required", "Accepted format", "Sample", "Notes"],
        ...CLIENT_UPLOAD_COLUMNS.map((column) => [
          column.label,
          column.required ? "Required" : "Optional",
          column.format || "Text",
          column.sample || "",
          column.description || "",
        ]),
      ]),
      "Instructions",
    );
    XLSX.writeFile(workbook, `client-list-template_${safeName}.xlsx`);
  };

  const runVeraAssessment = useCallback(async (previewRows, sum, hauler) => {
    const cycle = veraCycleRef.current;
    setVeraStage("assessing");
    setVeraComment("");
    setVeraError(null);
    try {
      const { data } = await api.post("/vera/chat", {
        message: CLIENT_VERA_ASSESSMENT_PROMPT,
        history: [],
        page: "data-entry",
        pageContext: buildClientListVeraContext(previewRows, sum, hauler),
      });
      // A newer file was uploaded while this was in flight — its answer
      // describes rows that are no longer on screen.
      if (veraCycleRef.current !== cycle) return;
      if (data?.ok && data.answer) {
        setVeraComment(String(data.answer));
        setVeraSource(data.source || null);
        setVeraStage("done");
      } else {
        // The server explains WHY (disabled / rate limited / duplicate). Show
        // its reason rather than inventing one.
        setVeraError(data?.message || "VERA could not assess this client list right now.");
        setVeraStage("failed");
      }
    } catch (err) {
      if (veraCycleRef.current !== cycle) return;
      setVeraError(
        err.response?.data?.message ||
          "VERA could not be reached. Your previewed data is unaffected.",
      );
      setVeraStage("failed");
    }
  }, []);

  const reassess = useCallback(() => {
    veraCycleRef.current += 1;
    runVeraAssessment(annotated, summary, haulerDraft);
  }, [runVeraAssessment, annotated, summary, haulerDraft]);

  const readFile = (file) => {
    setParseError("");
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const workbook = XLSX.read(event.target.result, { type: "array" });
        // Sheet 1 only, the same rule every other upload in the portal follows.
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const raw = XLSX.utils
          .sheet_to_json(sheet, { defval: "" })
          .filter((row) => Object.values(row || {}).some((v) => cleanUploadText(v) !== ""));
        if (raw.length === 0) {
          setParseError("That file has no data rows on its first sheet.");
          return;
        }
        const missing = getClientUploadMissingColumns(Object.keys(raw[0]));
        setMissingColumns(missing);
        const parsed = raw.map((row, index) => ({
          key: `client-row-${index}`,
          _rowNumber: index + 2,
          ...parseClientUploadRow(row),
        }));
        setRows(parsed);
        setPreviewOpen(true);

        // VERA assesses only a CLEAN preview — decided here from the
        // just-parsed rows, never from state that has not re-rendered yet.
        veraCycleRef.current += 1;
        const names = new Set(existingClients.map(clientIdentity).filter(Boolean));
        const clean =
          missing.length === 0 &&
          parsed.every((row) => getClientUploadRowErrors(row, names).length === 0);
        if (clean) {
          const ready = annotateClientUploadRows(parsed, existingClients);
          runVeraAssessment(ready, summarizeClientUpload(ready), haulerDraft);
        } else {
          setVeraStage("idle");
          setVeraComment("");
          setVeraError(null);
          setVeraSource(null);
        }
      } catch {
        setParseError("Could not read that file. Please upload the provided .xlsx/.csv template.");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const pickFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx,.xls,.csv";
    input.onchange = (event) => {
      if (event.target.files[0]) readFile(event.target.files[0]);
    };
    input.click();
  };

  const updateCell = (key, field, value) =>
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, [field]: value } : row)));

  const closePreview = () => {
    setPreviewOpen(false);
    setRows([]);
    setMissingColumns([]);
    setFileName("");
    veraCycleRef.current += 1;
    setVeraStage("idle");
    setVeraComment("");
    setVeraError(null);
    setVeraSource(null);
  };

  const applyClientList = () => {
    if (blocked || annotated.length === 0) return;
    updateHaulerDraft(
      "privateSectorClients",
      mergeClientListUpload(existingClients, annotated),
    );
    closePreview();
  };

  const previewColumns = [
    { title: "#", dataIndex: "_rowNumber", key: "_rowNumber", width: 44 },
    {
      title: "Action",
      key: "_status",
      width: 96,
      render: (_, row) => {
        const meta = STATUS_META[row._status] || STATUS_META.new;
        return row._errors.length ? (
          <Tooltip title={row._errors.join(" · ")}>
            <Tag color={meta.color} style={{ marginInlineEnd: 0 }}>{meta.label}</Tag>
          </Tooltip>
        ) : row._duplicateOfRow != null ? (
          <Tooltip title={`Merged into row ${row._duplicateOfRow}`}>
            <Tag color={meta.color} style={{ marginInlineEnd: 0 }}>{meta.label}</Tag>
          </Tooltip>
        ) : (
          <Tag color={meta.color} style={{ marginInlineEnd: 0 }}>{meta.label}</Tag>
        );
      },
    },
    ...CLIENT_UPLOAD_COLUMNS.map((column) => ({
      title: column.label,
      dataIndex: column.field,
      key: column.field,
      onCell: () => ({
        style: {
          whiteSpace: "normal",
          overflowWrap: "anywhere",
          wordBreak: "break-word",
          verticalAlign: "top",
        },
      }),
      render: (value, row) =>
        column.field === "clientType" ? (
          // A picker, not free text: the stored type is enum-constrained, so an
          // unusable value from the file is corrected in one click instead of
          // sending the user back to the spreadsheet.
          <Select
            size="small"
            value={value || undefined}
            placeholder="Type"
            style={{ width: "100%" }}
            status={value && !["Private", "LGU"].includes(value) ? "error" : ""}
            options={[
              { label: "Private", value: "Private" },
              { label: "LGU", value: "LGU" },
            ]}
            onChange={(next) => updateCell(row.key, column.field, next || "")}
          />
        ) : (
          <Input
            size="small"
            value={value ?? ""}
            onChange={(event) => updateCell(row.key, column.field, event.target.value)}
            style={{ border: "none", background: "transparent", padding: "2px 4px", fontSize: 11 }}
          />
        ),
    })),
    {
      title: "",
      key: "actions",
      width: 40,
      render: (_, row) => (
        <Button
          type="text"
          danger
          size="small"
          icon={<FileExcelOutlined />}
          title="Remove this row from the import"
          onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
        />
      ),
    },
  ];

  return (
    <>
      <Space size="small" wrap style={{ marginBottom: 8 }}>
        <Tooltip title={existingClients.length ? "" : "This hauler has no clients to export yet"}>
          <Button
            size="small"
            icon={<DownloadOutlined />}
            onClick={exportClientList}
            disabled={disabled || existingClients.length === 0}
          >
            Export Client List ({existingClients.length})
          </Button>
        </Tooltip>
        <Button size="small" icon={<UploadOutlined />} onClick={pickFile} disabled={disabled}>
          Upload Client List
        </Button>
        <Button size="small" type="link" icon={<DownloadOutlined />} onClick={downloadClientTemplate}>
          Template
        </Button>
      </Space>

      {parseError && (
        <Alert type="error" showIcon style={{ marginBottom: 8 }} message={parseError} />
      )}

      <Modal
        title={
          <Space>
            <UploadOutlined />
            <Text strong>Client List — {haulerName || "Accredited Hauler"}</Text>
          </Space>
        }
        open={previewOpen}
        onCancel={closePreview}
        onOk={applyClientList}
        okText={`Apply ${annotated.length} client row(s)`}
        okButtonProps={{ className: "slf-primary-btn", disabled: blocked || annotated.length === 0 }}
        width="min(1080px, 100%)"
        style={{ top: 24 }}
        className="slf-upload-modal"
        destroyOnHidden
      >
        <div style={{ marginBottom: 10 }}>
          <Space wrap size={[6, 6]}>
            {fileName && <Tag>{fileName}</Tag>}
            <Tag color="blue">{summary.total} row(s)</Tag>
            <Tag color="green">{summary.newClients} to add</Tag>
            <Tag color="blue">{summary.updatedClients} to update</Tag>
            {summary.duplicates > 0 && (
              <Tag color="orange">{summary.duplicates} duplicate row(s)</Tag>
            )}
            <Tag color={blocked ? "red" : "default"}>
              {missingColumns.length + summary.invalid} issue(s)
            </Tag>
          </Space>
        </div>

        {blocked && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 10 }}
            message="Apply is disabled until the preview is valid."
            description={
              missingColumns.length > 0
                ? `Missing columns: ${missingColumns.join(", ")}.`
                : "Edit the highlighted rows below. A client being added needs a Client Type and a Province."
            }
          />
        )}

        {!blocked && annotated.length > 0 && (
          <Alert
            type="info"
            showIcon
            icon={<InfoCircleOutlined />}
            style={{ marginBottom: 10 }}
            message="Nothing is saved yet."
            description={
              <span style={{ fontSize: 12.5 }}>
                Applying updates this hauler&apos;s Clients list in the form only — no client is
                removed. Click <b>Update</b> on the hauler, then <b>Save Baseline Update</b> to
                persist it.
              </span>
            }
          />
        )}

        {/* VERA: a SECOND OPINION on a list that already passed validation,
            never a gate. Apply's disabled state above does not reference
            veraStage, and must not start to. */}
        {veraStage !== "idle" && (
          <div className="slf-hauler-vera-panel">
            <div className="slf-hauler-vera-head">
              <VeraFlameIcon size={18} anime={veraStage === "assessing"} />
              <Text strong style={{ fontSize: 12.5 }}>VERA Assessment</Text>
              {veraStage === "assessing" && <Spin size="small" />}
              {veraStage === "done" && (
                <Tag color="success" style={{ fontSize: 10, marginInlineEnd: 0 }}>Assessed</Tag>
              )}
              {veraStage === "failed" && (
                <Tag color="warning" style={{ fontSize: 10, marginInlineEnd: 0 }}>Not available</Tag>
              )}
              {veraSource === "guard" && (
                <Tag style={{ fontSize: 10, marginInlineEnd: 0 }}>from your data</Tag>
              )}
              <span style={{ flex: 1 }} />
              {veraStage !== "assessing" && (
                <Button size="small" type="text" onClick={reassess}>
                  {veraStage === "failed" ? "Retry assessment" : "Re-assess edited rows"}
                </Button>
              )}
            </div>

            {veraStage === "assessing" && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                VERA is reviewing the {annotated.length} validated client row(s) before you apply
                them…
              </Text>
            )}

            {/* A VERA failure is NOT a validation failure. */}
            {veraStage === "failed" && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 0 }}
                message="VERA assessment could not be completed"
                description={
                  <span style={{ fontSize: 12 }}>
                    {veraError} Your client list is still <b>valid</b> and can be applied.
                  </span>
                }
              />
            )}

            {veraStage === "done" && (
              <div className="slf-hauler-vera-comment">{veraComment}</div>
            )}
          </div>
        )}

        <Table
          className="slf-upload-preview-table slf-slim-scroll"
          size="small"
          rowKey="key"
          dataSource={annotated}
          columns={previewColumns}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          scroll={{ y: "clamp(180px, 44vh, 380px)" }}
          rowClassName={(row) =>
            row._errors.length
              ? "slf-upload-row-error"
              : row._duplicateOfRow != null
                ? "slf-upload-row-duplicate"
                : ""
          }
        />
      </Modal>
    </>
  );
}
