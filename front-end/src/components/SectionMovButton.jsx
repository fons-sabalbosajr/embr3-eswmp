import { useState } from "react";
import { Badge, Button, Modal, Typography, Upload } from "antd";
import { PaperClipOutlined, UploadOutlined } from "@ant-design/icons";
import api from "../api";
import MovAttachmentList from "./MovAttachmentList";

const { Text } = Typography;

const MOV_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,image/*";
const MOV_MAX_MB = 25;
const MOV_MAX_FILES = 20;

/**
 * "Upload MOV" for one baseline SECTION (Active Cells, Closed Cells, Accredited
 * Haulers). Sits in the right side of the section card's title; opens a small
 * manager to attach or remove Means-of-Verification files. Files go to Google
 * Drive (documents folder › "Baseline MOV") through POST /upload; only the
 * returned links are kept and saved with the baseline.
 *
 * `editable` is false while the baseline is locked: the button then only lets
 * the operator VIEW what is on file.
 */
export default function SectionMovButton({ title, attachments, onChange, editable = true, uploaderEmail = "" }) {
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const list = Array.isArray(attachments) ? attachments : [];
  const full = list.length >= MOV_MAX_FILES;

  const customRequest = async ({ file, onSuccess, onError }) => {
    if (file.size > MOV_MAX_MB * 1024 * 1024) {
      const err = new Error(`${file.name} is larger than ${MOV_MAX_MB} MB.`);
      Modal.warning({ title: "File too large", content: err.message });
      onError(err);
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("folder", "baseline-mov");
      fd.append("file", file);
      const { data } = await api.post("/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      onChange((prev) => [
        ...(Array.isArray(prev) ? prev : []),
        {
          url: data.url,
          fileName: data.name || file.name,
          mimeType: data.mimeType || file.type,
          size: data.size || file.size,
          uploadedAt: new Date().toISOString(),
          uploadedBy: uploaderEmail || "",
        },
      ]);
      onSuccess(data);
    } catch (err) {
      Modal.error({
        title: "Upload failed",
        content: err.response?.data?.message || `Could not upload ${file.name}. Please try again.`,
      });
      onError(err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <Badge count={list.length} size="small" offset={[-4, 2]} color="#1a3353">
        <Button
          size="small"
          icon={editable ? <UploadOutlined /> : <PaperClipOutlined />}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          disabled={!editable && list.length === 0}
          title={editable ? "Attach Means of Verification for this section" : "View Means of Verification"}
        >
          {editable ? "Upload MOV" : "MOV"}
        </Button>
      </Badge>
      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        footer={<Button onClick={() => setOpen(false)}>Done</Button>}
        title={`MOV — ${title}`}
        width={480}
        destroyOnHidden
      >
        <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 10 }}>
          Means of Verification for this section: PDF, Word, Excel or photos, up to {MOV_MAX_MB} MB each.
          Files are stored in the EMB Google Drive and saved with your baseline.
        </Text>
        {editable && (
          <Upload accept={MOV_ACCEPT} multiple showUploadList={false} customRequest={customRequest} disabled={uploading || full}>
            <Button type="primary" icon={<UploadOutlined />} loading={uploading} disabled={full} style={{ background: "#1a3353" }}>
              {uploading ? "Uploading…" : full ? `Limit of ${MOV_MAX_FILES} files reached` : "Choose files"}
            </Button>
          </Upload>
        )}
        <div style={{ marginTop: 12 }}>
          <MovAttachmentList
            attachments={list}
            emptyText="No MOV attached yet."
            onRemove={editable ? (index) => onChange((prev) => (prev || []).filter((_, i) => i !== index)) : undefined}
          />
        </div>
        {editable && list.length > 0 && (
          <Text type="secondary" style={{ fontSize: 11, display: "block", marginTop: 10 }}>
            Remember to save the baseline to keep these attachments.
          </Text>
        )}
      </Modal>
    </>
  );
}
