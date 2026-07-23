// Admin Prevention-Measures panel — official narrative + secure document
// summaries for ONE SLF facility. Clearly separates the manually-entered
// "Official Prevention Measures Narrative" from the "VERA-Generated Document
// Summary" (labeled, with a source-document reference and low-confidence
// warnings). Summaries are generated on demand via the backend, which extracts
// text from the source document (PDF/DOCX/TXT) and refuses unreadable files.

import { useEffect, useState, useCallback } from "react";
import { Modal, Card, Button, Tag, Alert, Spin, Empty, Typography, Space, Tooltip } from "antd";
import {
  FileTextOutlined, RobotOutlined, ReloadOutlined, WarningOutlined,
  SafetyCertificateOutlined, FireOutlined,
} from "@ant-design/icons";
import api from "../../api";

const { Text, Paragraph } = Typography;

const DOC_ICON = (docType) =>
  /fire/i.test(docType) ? <FireOutlined style={{ color: "#ff4d4f" }} />
    : /trash/i.test(docType) ? <WarningOutlined style={{ color: "#fa8c16" }} />
      : <SafetyCertificateOutlined style={{ color: "#fa541c" }} />;

export default function PreventionMeasuresPanel({ open, facilityId, slfName, onClose }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null); // { narratives, documents, summaries, aiAvailable, slfName }
  const [error, setError] = useState("");
  const [busyUrl, setBusyUrl] = useState(""); // fileUrl currently generating
  const [genError, setGenError] = useState("");

  const load = useCallback(async () => {
    if (!facilityId) return;
    setLoading(true);
    setError("");
    try {
      const res = await api.get(`/slf-facilities/${facilityId}/prevention-measures`);
      setData(res.data || null);
    } catch (e) {
      setError(e?.response?.data?.message || "Could not load prevention measures.");
    } finally {
      setLoading(false);
    }
  }, [facilityId]);

  useEffect(() => {
    if (open && facilityId) load();
    if (!open) { setData(null); setError(""); setGenError(""); }
  }, [open, facilityId, load]);

  // Cached summary for a given document url.
  const summaryFor = (url) => (data?.summaries || []).find((s) => s.fileUrl === url);

  const generate = useCallback(async (fileUrl) => {
    setBusyUrl(fileUrl);
    setGenError("");
    try {
      const res = await api.post(`/slf-facilities/${facilityId}/prevention-summary`, { fileUrl });
      const body = res.data || {};
      if (body.ok === false) {
        setGenError(body.message || "The summary could not be generated.");
      }
      // Refresh cached summaries either way (a warning may have been cached).
      await load();
    } catch (e) {
      setGenError(e?.response?.data?.message || "The summary request failed. Please try again.");
    } finally {
      setBusyUrl("");
    }
  }, [facilityId, load]);

  const documents = data?.documents || [];
  const narratives = data?.narratives || [];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={<Button onClick={onClose}>Close</Button>}
      width="min(820px, 96vw)"
      title={<Space><SafetyCertificateOutlined style={{ color: "#fa541c" }} /> Prevention Measures — {data?.slfName || slfName || "SLF"}</Space>}
      styles={{ body: { maxHeight: "74vh", overflowY: "auto" } }}
      destroyOnHidden
    >
      {loading ? (
        <div style={{ textAlign: "center", padding: 40 }}><Spin /></div>
      ) : error ? (
        <Alert type="error" showIcon message={error} />
      ) : (
        <>
          {/* ── Official narrative ── */}
          <div style={{ marginBottom: 8, fontWeight: 700, fontSize: 13 }}>
            <FileTextOutlined /> Official Prevention Measures Narrative
          </div>
          {narratives.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No narrative entered for this SLF." style={{ padding: "12px 0" }} />
          ) : (
            <Space direction="vertical" size={8} style={{ width: "100%", marginBottom: 16 }}>
              {narratives.map((n, i) => (
                <Card key={i} size="small" style={{ borderRadius: 8 }}>
                  <Space size={6} style={{ marginBottom: 4 }}>
                    {DOC_ICON(n.docType)}
                    <Text strong>{n.measure || n.docType}</Text>
                    {n.status && <Tag color={n.status === "Implemented" ? "green" : "orange"}>{n.status}</Tag>}
                    <Tag>{n.docType}</Tag>
                  </Space>
                  {n.description && <Paragraph style={{ margin: 0, fontSize: 13 }}>{n.description}</Paragraph>}
                </Card>
              ))}
            </Space>
          )}

          {/* ── Documents + VERA summaries ── */}
          <div style={{ margin: "8px 0", fontWeight: 700, fontSize: 13 }}>
            <RobotOutlined /> Source Documents &amp; VERA-Generated Summaries
          </div>
          {!data?.aiAvailable && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 10 }}
              message="AI summaries are currently unavailable"
              description="Document metadata and the official narrative are shown below. Configure the Automation Agent to enable VERA document summaries."
            />
          )}
          {genError && <Alert type="warning" showIcon style={{ marginBottom: 10 }} message={genError} />}
          {documents.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No prevention documents uploaded for this SLF." style={{ padding: "12px 0" }} />
          ) : (
            <Space direction="vertical" size={10} style={{ width: "100%" }}>
              {documents.map((doc) => {
                const s = summaryFor(doc.url);
                const busy = busyUrl === doc.url;
                return (
                  <Card key={doc.url} size="small" style={{ borderRadius: 8 }}>
                    {/* Document metadata */}
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <Space size={6} style={{ minWidth: 0 }}>
                        {DOC_ICON(doc.docType)}
                        <Tooltip title={doc.fileName}>
                          <a href={doc.url} target="_blank" rel="noreferrer" style={{ fontWeight: 600, maxWidth: 340, display: "inline-block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom" }}>
                            {doc.fileName}
                          </a>
                        </Tooltip>
                        <Tag>{doc.docType}</Tag>
                      </Space>
                      {data?.aiAvailable && (
                        <Button
                          size="small"
                          type="primary"
                          icon={busy ? <Spin size="small" /> : <ReloadOutlined />}
                          loading={busy}
                          onClick={() => generate(doc.url)}
                        >
                          {s ? "Regenerate summary" : "Generate summary"}
                        </Button>
                      )}
                    </div>
                    {doc.narrative && (
                      <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 4 }}>
                        Related narrative: {doc.narrative}
                      </Text>
                    )}

                    {/* VERA summary (clearly labeled + source reference) */}
                    {s && (
                      <div style={{ marginTop: 10, borderTop: "1px dashed #e4ebf2", paddingTop: 8 }}>
                        <Space size={6} style={{ marginBottom: 4 }}>
                          <RobotOutlined style={{ color: "#1677ff" }} />
                          <Text strong style={{ fontSize: 12 }}>VERA-Generated Document Summary</Text>
                          {s.confidence === "low" && <Tag color="orange">low confidence</Tag>}
                        </Space>
                        {s.warning && !s.summary ? (
                          <Alert type="warning" showIcon icon={<WarningOutlined />} message={s.warning} style={{ marginTop: 4 }} />
                        ) : (
                          <>
                            {s.warning && <Alert type="warning" showIcon message={s.warning} style={{ marginBottom: 6 }} />}
                            <Paragraph style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 13 }}>{s.summary}</Paragraph>
                          </>
                        )}
                        <Text type="secondary" style={{ fontSize: 11, display: "block", marginTop: 6 }}>
                          Source: {s.fileName || doc.fileName}
                          {s.generatedAt ? ` · generated ${new Date(s.generatedAt).toLocaleString()}` : ""}
                          {s.model ? ` · ${s.model}` : ""}
                        </Text>
                        <Text type="secondary" style={{ fontSize: 11, fontStyle: "italic" }}>
                          Guidance from an AI reading of the document — verify against the official narrative and source file.
                        </Text>
                      </div>
                    )}
                  </Card>
                );
              })}
            </Space>
          )}
        </>
      )}
    </Modal>
  );
}
