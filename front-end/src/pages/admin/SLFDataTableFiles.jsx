import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Card,
  Button,
  Space,
  Tag,
  Input,
  Select,
  Typography,
  Tooltip,
  Popconfirm,
  Modal,
  Descriptions,
  Alert,
  Spin,
  Upload,
} from "antd";
import {
  FolderOpenOutlined,
  ReloadOutlined,
  EyeOutlined,
  DownloadOutlined,
  DeleteOutlined,
  FileOutlined,
  FileImageOutlined,
  FilePdfOutlined,
  SearchOutlined,
  LinkOutlined,
  WarningOutlined,
  CheckCircleOutlined,
  SafetyCertificateOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import Swal from "sweetalert2";
import LazyDocumentFrame from "../../components/LazyDocumentFrame";
import api from "../../api";
import ResponsiveTable from "./shared/ResponsiveTable";

const { Text } = Typography;

const REASON_TAG = {
  ok: { color: "success", text: "Accessible" },
  not_found: { color: "error", text: "File Not Found" },
  no_permission: { color: "error", text: "Permission Denied" },
  trashed: { color: "warning", text: "Trashed" },
  auth_error: { color: "warning", text: "Needs Repair" },
  not_configured: { color: "default", text: "Drive Not Configured" },
  not_linked: { color: "warning", text: "Not Linked" },
  non_drive: { color: "blue", text: "Local File" },
  missing: { color: "default", text: "No File" },
  invalid_id: { color: "volcano", text: "Invalid File ID" },
  old_drive: { color: "gold", text: "Old Drive Account" },
  server_error: { color: "default", text: "Unknown Error" },
};

// Derive a display status from a validation result + the file descriptor.
function deriveFileStatus(file, status) {
  if (!status) return null;
  if (status.accessible) return { reason: "ok", accessible: true, message: status.message };
  // A drive-hosted file with no extractable ID is malformed.
  if (file.storage === "drive" && !file.driveFileId) {
    return { reason: "invalid_id", accessible: false, message: "The stored link has no valid Drive file ID." };
  }
  // not_found on a drive file often means it lives on the old (now inaccessible) account.
  if (status.reason === "not_found" && file.storage === "drive") {
    return { reason: "old_drive", accessible: false, message: "File not found — likely owned by the old Google Drive account. Use Replace to upload it to the new account." };
  }
  return status;
}

function fileIcon(url = "", docType = "") {
  const lower = `${url} ${docType}`.toLowerCase();
  if (/\.pdf|pdf/.test(lower)) return <FilePdfOutlined style={{ color: "#ff4d4f" }} />;
  if (/image|\.png|\.jpe?g|\.gif|\.webp/.test(lower)) return <FileImageOutlined style={{ color: "#1677ff" }} />;
  return <FileOutlined style={{ color: "#8c8c8c" }} />;
}

export default function SLFDataTableFiles({ isDark }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");

  const [preview, setPreview] = useState({ open: false, file: null, status: null, checking: false });
  const [statusMap, setStatusMap] = useState({});
  const [verifyingAll, setVerifyingAll] = useState(false);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/slf-data-files");
      setFiles(Array.isArray(data?.files) ? data.files : []);
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Failed to load SLF files", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const sources = useMemo(() => {
    const set = new Set(files.map((f) => f.source).filter(Boolean));
    return Array.from(set).sort();
  }, [files]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return files.filter((f) => {
      if (sourceFilter !== "all" && f.source !== sourceFilter) return false;
      if (!q) return true;
      return (
        (f.facilityName || "").toLowerCase().includes(q) ||
        (f.title || "").toLowerCase().includes(q) ||
        (f.source || "").toLowerCase().includes(q)
      );
    });
  }, [files, search, sourceFilter]);

  const validateFile = useCallback(async (file) => {
    try {
      const { data } = await api.get("/slf-data-files/validate", {
        params: { url: file.url, fileId: file.driveFileId || undefined, facilityId: file.facilityId },
      });
      return data;
    } catch (err) {
      return {
        accessible: false,
        reason: "server_error",
        message: err.response?.data?.message || "Could not validate this file.",
      };
    }
  }, []);

  const openPreview = useCallback(
    async (file) => {
      setPreview({ open: true, file, status: null, checking: true });
      const status = await validateFile(file);
      setPreview({ open: true, file, status, checking: false });
    },
    [validateFile]
  );

  const handleOpen = useCallback(
    async (file) => {
      const status = await validateFile(file);
      if (status.accessible) {
        // Prefer the canonical Drive link the backend resolved (webViewLink);
        // the stored url may be a non-openable form (thumbnail / uc?export).
        window.open(status.webViewLink || file.url, "_blank", "noopener,noreferrer");
      } else {
        Swal.fire({ icon: "warning", title: "Cannot open file", text: status.message });
      }
    },
    [validateFile]
  );

  const handleDelete = useCallback(
    async (file) => {
      try {
        await api.delete("/slf-data-files", { data: { facilityId: file.facilityId, url: file.url } });
        setFiles((prev) => prev.filter((f) => !(f.facilityId === file.facilityId && f.url === file.url)));
        Swal.fire({ icon: "success", title: "File unlinked", timer: 1400, showConfirmButton: false });
      } catch (err) {
        Swal.fire("Error", err.response?.data?.message || "Could not remove file", "error");
      }
    },
    []
  );

  const fileKey = (f) => `${f.facilityId}::${f.url}`;

  const handleVerifyAll = useCallback(async () => {
    setVerifyingAll(true);
    try {
      const payload = filtered.map((f) => ({ facilityId: f.facilityId, url: f.url, fileId: f.driveFileId }));
      const { data } = await api.post("/slf-data-files/verify-all", { files: payload });
      const map = {};
      (data?.results || []).forEach((r) => {
        const f = filtered.find((x) => x.url === r.url && x.facilityId === r.facilityId) || filtered.find((x) => x.url === r.url);
        if (f) map[fileKey(f)] = deriveFileStatus(f, r);
      });
      setStatusMap((prev) => ({ ...prev, ...map }));
      const bad = Object.values(map).filter((s) => s && !s.accessible).length;
      Swal.fire({
        icon: bad === 0 ? "success" : "warning",
        title: "Verification Complete",
        text: bad === 0 ? "All checked files are accessible." : `${bad} file(s) are inaccessible or need repair.`,
        timer: 2200, showConfirmButton: false,
      });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Could not verify files", "error");
    } finally {
      setVerifyingAll(false);
    }
  }, [filtered]);

  const handleVerifyOne = useCallback(async (file) => {
    const raw = await validateFile(file);
    setStatusMap((prev) => ({ ...prev, [fileKey(file)]: deriveFileStatus(file, raw) }));
  }, [validateFile]);

  const handleMarkLegacy = useCallback(async (file) => {
    try {
      await api.post("/slf-data-files/mark-legacy", { facilityId: file.facilityId, url: file.url, reason: statusMap[fileKey(file)]?.reason });
      setFiles((prev) => prev.filter((f) => !(f.facilityId === file.facilityId && f.url === file.url)));
      Swal.fire({ icon: "success", title: "Marked as Legacy", text: "Old metadata was saved to audit logs.", timer: 1600, showConfirmButton: false });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Could not mark as legacy", "error");
    }
  }, [statusMap]);

  const handleReplace = useCallback(async (file, uploadFile) => {
    const form = new FormData();
    form.append("file", uploadFile);
    form.append("facilityId", file.facilityId);
    form.append("oldUrl", file.url);
    try {
      const { data } = await api.post("/slf-data-files/replace", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setFiles((prev) => prev.map((f) =>
        f.facilityId === file.facilityId && f.url === file.url
          ? { ...f, url: data.url, storage: data.storage, driveFileId: undefined }
          : f
      ));
      setStatusMap((prev) => {
        const next = { ...prev };
        delete next[fileKey(file)];
        return next;
      });
      Swal.fire({ icon: "success", title: "File Replaced", text: "The SLF record now links to the new file.", timer: 1800, showConfirmButton: false });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Could not replace file", "error");
    }
    return false; // prevent antd auto-upload
  }, []);

  const columns = [
    {
      title: "File",
      key: "file",
      render: (_, r) => (
        <Space>
          {fileIcon(r.url, r.docType)}
          <span>
            <Text strong style={{ fontSize: 13 }}>{r.title || r.url?.split("/").pop() || "Untitled"}</Text>
            <br />
            <Tag color={r.storage === "drive" ? "geekblue" : "default"} style={{ fontSize: 10 }}>
              {r.storage === "drive" ? "Google Drive" : "Local"}
            </Tag>
          </span>
        </Space>
      ),
    },
    {
      title: "Linked SLF Record",
      key: "facility",
      render: (_, r) => (
        <span>
          <Text strong>{r.facilityName || "—"}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {r.province || ""} {r.dataYear ? `· ${r.dataYear}` : ""}
          </Text>
        </span>
      ),
    },
    { title: "Source", dataIndex: "source", key: "source", width: 130, render: (v) => (v ? <Tag>{v}</Tag> : "—") },
    {
      title: "Access Status",
      key: "status",
      width: 150,
      render: (_, r) => {
        const s = statusMap[fileKey(r)];
        if (!s) return <Tag color="default" style={{ fontSize: 10 }}>Not checked</Tag>;
        const meta = REASON_TAG[s.reason] || { color: "default", text: s.reason };
        return (
          <Tooltip title={s.message}>
            <Tag color={meta.color} style={{ fontSize: 10 }}>{meta.text}</Tag>
          </Tooltip>
        );
      },
    },
    {
      title: "Actions",
      key: "actions",
      width: 250,
      render: (_, r) => {
        const s = statusMap[fileKey(r)];
        const inaccessible = s && !s.accessible;
        return (
          <Space size={2} wrap>
            <Tooltip title="Verify access">
              <Button size="small" icon={<SafetyCertificateOutlined />} onClick={() => handleVerifyOne(r)} />
            </Tooltip>
            <Tooltip title="Preview / check access">
              <Button size="small" icon={<EyeOutlined />} onClick={() => openPreview(r)} />
            </Tooltip>
            <Tooltip title={inaccessible ? "File is not accessible" : "Open / download"}>
              <Button size="small" icon={<DownloadOutlined />} disabled={inaccessible} onClick={() => handleOpen(r)} />
            </Tooltip>
            <Tooltip title="Replace with a new file (uploads to the new Drive account)">
              <Upload beforeUpload={(file) => handleReplace(r, file)} showUploadList={false} maxCount={1}>
                <Button size="small" icon={<SwapOutlined />} style={{ color: "#722ed1" }} />
              </Upload>
            </Tooltip>
            {inaccessible && (
              <Popconfirm
                title="Mark as legacy / inaccessible?"
                description="Unlinks the file and preserves its old metadata in audit logs."
                onConfirm={() => handleMarkLegacy(r)}
                okText="Mark Legacy"
              >
                <Tooltip title="Mark as legacy/inaccessible">
                  <Button size="small" icon={<WarningOutlined />} style={{ color: "#faad14" }} />
                </Tooltip>
              </Popconfirm>
            )}
            <Popconfirm
              title="Unlink this file?"
              description="Removes the file reference from the SLF record. The file itself stays in Drive."
              onConfirm={() => handleDelete(r)}
              okText="Unlink"
              okButtonProps={{ danger: true }}
            >
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  const status = preview.status;
  const reasonTag = status ? REASON_TAG[status.reason] || { color: "default", text: status.reason } : null;
  const isImage = /image|\.png|\.jpe?g|\.gif|\.webp/i.test(
    `${preview.file?.url || ""} ${preview.file?.docType || ""}`
  );
  const isPdf = /\.pdf|pdf/i.test(`${preview.file?.url || ""} ${preview.file?.docType || ""}`);

  return (
    <div>
      <Card
        style={{ borderRadius: 10 }}
        title={
          <Space>
            <FolderOpenOutlined style={{ color: "#13c2c2" }} />
            <span>SLF Data Table Files</span>
            <Tag>{filtered.length}</Tag>
          </Space>
        }
        extra={
          <Space>
            <Button size="small" icon={<SafetyCertificateOutlined />} onClick={handleVerifyAll} loading={verifyingAll} disabled={filtered.length === 0}>
              Verify All
            </Button>
            <Button size="small" icon={<ReloadOutlined />} onClick={fetchFiles} loading={loading}>
              Refresh
            </Button>
          </Space>
        }
      >
        <Space style={{ marginBottom: 12, flexWrap: "wrap" }}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Search by SLF, title, source"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 260 }}
          />
          <Select
            value={sourceFilter}
            onChange={setSourceFilter}
            style={{ width: 180 }}
            options={[{ value: "all", label: "All sources" }, ...sources.map((s) => ({ value: s, label: s }))]}
          />
        </Space>
        <ResponsiveTable
          dataSource={filtered}
          columns={columns}
          rowKey={(r) => `${r.facilityId}-${r.url}`}
          size="small"
          loading={loading}
          pagination={{ pageSize: 12, size: "small" }}
          scroll={{ x: 800 }}
          locale={{ emptyText: "No files linked to SLF records." }}
        />
      </Card>

      <Modal
        title={
          <Space>
            {fileIcon(preview.file?.url, preview.file?.docType)}
            <span>{preview.file?.title || "File Preview"}</span>
          </Space>
        }
        open={preview.open}
        onCancel={() => setPreview({ open: false, file: null, status: null, checking: false })}
        footer={
          <Space>
            <Button onClick={() => setPreview({ open: false, file: null, status: null, checking: false })}>
              Close
            </Button>
            {status?.accessible && (
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                onClick={() => window.open(preview.status?.webViewLink || preview.file.url, "_blank", "noopener,noreferrer")}
              >
                Open / Download
              </Button>
            )}
          </Space>
        }
        width={720}
        destroyOnHidden
      >
        {preview.checking ? (
          <div style={{ textAlign: "center", padding: 40 }}>
            <Spin tip="Checking file access…" />
          </div>
        ) : (
          <>
            {status && (
              <Alert
                type={status.accessible ? "success" : status.reason === "non_drive" ? "info" : "warning"}
                showIcon
                icon={status.accessible ? <CheckCircleOutlined /> : <WarningOutlined />}
                style={{ marginBottom: 12, borderRadius: 8 }}
                message={
                  <Space>
                    {reasonTag && <Tag color={reasonTag.color}>{reasonTag.text}</Tag>}
                    {status.message}
                  </Space>
                }
              />
            )}
            <Descriptions size="small" column={1} bordered style={{ marginBottom: 12 }}>
              <Descriptions.Item label="Linked SLF">{preview.file?.facilityName || "—"}</Descriptions.Item>
              <Descriptions.Item label="Source">{preview.file?.source || "—"}</Descriptions.Item>
              <Descriptions.Item label="Storage">
                {preview.file?.storage === "drive" ? "Google Drive" : "Local server"}
              </Descriptions.Item>
              {status?.meta?.size != null && (
                <Descriptions.Item label="Size">{(status.meta.size / 1024).toFixed(1)} KB</Descriptions.Item>
              )}
              {status?.meta?.mimeType && (
                <Descriptions.Item label="Type">{status.meta.mimeType}</Descriptions.Item>
              )}
              <Descriptions.Item label="Link">
                <a href={preview.file?.url} target="_blank" rel="noopener noreferrer">
                  <LinkOutlined /> {preview.file?.url}
                </a>
              </Descriptions.Item>
            </Descriptions>

            {status?.accessible && isImage && (
              <div style={{ textAlign: "center" }}>
                <img
                  src={preview.file.url}
                  alt={preview.file.title || "preview"}
                  style={{ maxWidth: "100%", maxHeight: 380, borderRadius: 8 }}
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              </div>
            )}
            {status?.accessible && isPdf && preview.file?.driveFileId && (
              <div style={{ height: 420 }}>
                <LazyDocumentFrame
                  title="pdf-preview"
                  src={`https://drive.google.com/file/d/${preview.file.driveFileId}/preview`}
                  style={{ borderRadius: 8, overflow: "hidden" }}
                />
              </div>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
