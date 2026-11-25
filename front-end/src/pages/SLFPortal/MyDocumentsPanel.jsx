import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Empty, Input, Segmented, Select, Space, Table, Tag, Tooltip, Typography } from "antd";
import {
  DownloadOutlined,
  FileImageOutlined,
  FileOutlined,
  FilePdfOutlined,
  FileWordOutlined,
  FileExcelOutlined,
  FolderOpenOutlined,
  LinkOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import Swal from "sweetalert2";
import api from "../../api";
import {
  DOCUMENT_TYPES,
  countByType,
  fileNameFromDisposition,
  filterDocuments,
  formatSize,
  placeOptions,
} from "./myDocuments";

const { Text } = Typography;
const MAX_PER_ZIP = 100;

function fileIcon(doc) {
  const type = String(doc.mimeType || "").toLowerCase();
  const name = String(doc.fileName || "").toLowerCase();
  if (type.includes("pdf") || name.endsWith(".pdf")) return <FilePdfOutlined style={{ color: "#cf1322" }} />;
  if (type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|tiff?)$/.test(name)) return <FileImageOutlined style={{ color: "#1677ff" }} />;
  if (type.includes("word") || /\.docx?$/.test(name)) return <FileWordOutlined style={{ color: "#2f54eb" }} />;
  if (type.includes("sheet") || type.includes("excel") || /\.(xlsx?|csv)$/.test(name)) return <FileExcelOutlined style={{ color: "#389e0d" }} />;
  return <FileOutlined />;
}

const TYPE_COLORS = { mov: "geekblue", letter: "purple", attachment: "cyan" };

// Read the server's JSON error out of a blob response.
async function blobErrorMessage(err) {
  const data = err?.response?.data;
  if (data instanceof Blob) {
    try {
      return JSON.parse(await data.text())?.message || "";
    } catch {
      return "";
    }
  }
  return data?.message || "";
}

// ── My Documents ──
// Every file the SLF has submitted through the portal — MOVs, Letters of Intent
// and support attachments — in one list, filterable by type, cell / section and
// Submission ID, with "Download selected" bundling the chosen files into one .zip.
export default function MyDocumentsPanel({ portalUser, isMobile }) {
  const email = portalUser?.email || "";
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(Boolean(email));
  const [loadError, setLoadError] = useState("");
  // Bumped by Refresh; the effect below refetches whenever it changes.
  const [reloadKey, setReloadKey] = useState(0);
  const [type, setType] = useState("all");
  const [place, setPlace] = useState(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState([]);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!email) return undefined;
    let cancelled = false;
    api
      .get("/portal-documents", { params: { email } })
      .then(({ data }) => {
        if (cancelled) return;
        const list = Array.isArray(data?.documents) ? data.documents : [];
        setDocuments(list);
        setLoadError("");
        // Keep only selections that still exist.
        const ids = new Set(list.map((d) => d.id));
        setSelected((current) => current.filter((id) => ids.has(id)));
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err.response?.data?.message || "Your documents could not be loaded. Please try again.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [email, reloadKey]);

  const load = useCallback(() => {
    setLoading(true);
    setReloadKey((k) => k + 1);
  }, []);

  const counts = useMemo(() => countByType(documents), [documents]);
  const places = useMemo(
    () => placeOptions(type === "all" ? documents : documents.filter((d) => d.type === type)),
    [documents, type],
  );
  const shown = useMemo(
    () => filterDocuments(documents, { type, place: place || "", search }),
    [documents, type, place, search],
  );

  const download = async () => {
    if (!selected.length) return;
    setDownloading(true);
    try {
      const response = await api.post(
        "/portal-documents/download",
        { ids: selected, email },
        { responseType: "blob", timeout: 10 * 60 * 1000 },
      );
      const name = fileNameFromDisposition(response.headers?.["content-disposition"]);
      const url = window.URL.createObjectURL(new Blob([response.data], { type: "application/zip" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      Swal.fire({
        icon: "error",
        title: "Download Failed",
        text: (await blobErrorMessage(err)) || "The files could not be bundled. Please try again.",
        confirmButtonColor: "#1a3353",
      });
    } finally {
      setDownloading(false);
    }
  };

  const columns = [
    {
      title: "File",
      key: "file",
      render: (_, doc) => (
        <Space align="start" size={8}>
          <span style={{ fontSize: 18, lineHeight: 1 }}>{fileIcon(doc)}</span>
          <Space direction="vertical" size={0} style={{ minWidth: 0 }}>
            <Text strong style={{ fontSize: 13, wordBreak: "break-word" }}>
              {doc.fileName}
            </Text>
            <Space size={4} wrap>
              <Tag color={TYPE_COLORS[doc.type]} style={{ marginInlineEnd: 0 }}>{doc.typeLabel}</Tag>
              {formatSize(doc.size) && <Text type="secondary" style={{ fontSize: 11 }}>{formatSize(doc.size)}</Text>}
            </Space>
          </Space>
        </Space>
      ),
    },
    {
      title: "Cell / Section",
      key: "place",
      responsive: ["md"],
      render: (_, doc) => (
        <Space direction="vertical" size={0}>
          <Text style={{ fontSize: 12.5 }}>{doc.cellName || doc.section || "—"}</Text>
          {doc.cellName && <Text type="secondary" style={{ fontSize: 11 }}>{doc.section}</Text>}
          {doc.reference && <Text type="secondary" style={{ fontSize: 11 }}>{doc.reference}</Text>}
        </Space>
      ),
    },
    {
      title: "Submission ID",
      key: "submissions",
      responsive: ["lg"],
      render: (_, doc) => {
        const ids = doc.submissionIds || [];
        if (!ids.length) return <Text type="secondary" style={{ fontSize: 12 }}>{doc.type === "mov" ? "Baseline" : "—"}</Text>;
        return (
          <Tooltip title={ids.length > 2 ? ids.join(", ") : ""}>
            <Space size={4} wrap>
              {ids.slice(0, 2).map((id) => <Tag key={id} style={{ marginInlineEnd: 0 }}>{id}</Tag>)}
              {ids.length > 2 && <Tag style={{ marginInlineEnd: 0 }}>+{ids.length - 2}</Tag>}
            </Space>
          </Tooltip>
        );
      },
    },
    {
      title: "Uploaded",
      dataIndex: "uploadedAt",
      key: "uploadedAt",
      width: isMobile ? 90 : 130,
      sorter: (a, b) => new Date(a.uploadedAt || 0) - new Date(b.uploadedAt || 0),
      defaultSortOrder: "descend",
      render: (v) => <Text type="secondary" style={{ fontSize: 12 }}>{v ? dayjs(v).format("MMM D, YYYY") : "—"}</Text>,
    },
    {
      title: "",
      key: "open",
      width: 56,
      render: (_, doc) =>
        doc.url ? (
          <Tooltip title="Open">
            <Button
              size="small"
              type="text"
              icon={<LinkOutlined />}
              href={doc.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${doc.fileName}`}
            />
          </Tooltip>
        ) : null,
    },
  ];

  const tooMany = selected.length > MAX_PER_ZIP;
  const shownDownloadable = shown.filter((d) => d.downloadable).map((d) => d.id);
  const allShownSelected = shownDownloadable.length > 0 && shownDownloadable.every((id) => selected.includes(id));

  return (
    <div style={{ maxWidth: 1680, margin: "0 auto" }}>
      <Card
        className="slf-section"
        title={
          <Space wrap>
            <FolderOpenOutlined style={{ color: "#1a3353" }} />
            <Text strong style={{ fontSize: 16, color: "#1a3353" }}>My Documents</Text>
            <Tag color="blue">{counts.all} file{counts.all === 1 ? "" : "s"}</Tag>
          </Space>
        }
        extra={
          <Space size={8} wrap>
            <Tooltip title={tooMany ? `Choose up to ${MAX_PER_ZIP} files per download.` : "Download the chosen files as one .zip file"}>
              <Button
                size="small"
                type="primary"
                className="slf-primary-btn"
                icon={<DownloadOutlined />}
                disabled={!selected.length || tooMany}
                loading={downloading}
                onClick={download}
              >
                {isMobile ? `Download (${selected.length})` : `Download selected (${selected.length})`}
              </Button>
            </Tooltip>
            <Button size="small" icon={<ReloadOutlined />} onClick={load} loading={loading} disabled={loading}>
              Refresh
            </Button>
          </Space>
        }
      >
        <Text type="secondary" style={{ display: "block", fontSize: 12.5, marginBottom: 12 }}>
          Every file your SLF has submitted through the portal: MOVs from your baseline, Letters of Intent
          and support ticket attachments. Tick the files you need and download them together as one .zip.
        </Text>

        <Space wrap size={8} style={{ marginBottom: 12, width: "100%" }}>
          <Segmented
            size="small"
            value={type}
            onChange={(value) => {
              setType(value);
              setPlace(null);
            }}
            options={DOCUMENT_TYPES.map((t) => ({ value: t.value, label: `${t.label} (${counts[t.value] || 0})` }))}
          />
          <Select
            allowClear
            size="small"
            placeholder="Cell / section"
            style={{ minWidth: 200 }}
            value={place}
            onChange={setPlace}
            options={places}
            disabled={!places.length}
          />
          <Input
            allowClear
            size="small"
            prefix={<SearchOutlined />}
            placeholder="File name or Submission ID"
            style={{ width: isMobile ? "100%" : 240 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {shownDownloadable.length > 0 && (
            <Button
              size="small"
              type="link"
              onClick={() =>
                setSelected((current) =>
                  allShownSelected
                    ? current.filter((id) => !shownDownloadable.includes(id))
                    : [...new Set([...current, ...shownDownloadable])],
                )
              }
            >
              {allShownSelected ? "Clear shown" : `Select all shown (${shownDownloadable.length})`}
            </Button>
          )}
        </Space>

        {loadError && <Alert type="error" showIcon message={loadError} style={{ marginBottom: 12 }} />}
        {tooMany && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message={`${selected.length} files are selected. One download can hold up to ${MAX_PER_ZIP}; clear some and download the rest separately.`}
          />
        )}

        <Table
          className="slf-documents-table"
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={shown}
          columns={columns}
          rowSelection={{
            selectedRowKeys: selected,
            preserveSelectedRowKeys: true,
            onChange: (keys) => setSelected(keys.map(String)),
            getCheckboxProps: (doc) => ({
              disabled: !doc.downloadable,
              title: doc.downloadable ? undefined : "This file can be opened but not bundled into a .zip.",
            }),
          }}
          pagination={{ pageSize: 20, size: "small", showSizeChanger: true, pageSizeOptions: [20, 50, 100], showTotal: (t) => `${t} file(s)` }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  documents.length
                    ? "No files match these filters."
                    : "No documents yet. MOVs you attach to your baseline, and files you send with requests or support tickets, will appear here."
                }
              />
            ),
          }}
          scroll={isMobile ? { x: 420 } : undefined}
        />
      </Card>
    </div>
  );
}
