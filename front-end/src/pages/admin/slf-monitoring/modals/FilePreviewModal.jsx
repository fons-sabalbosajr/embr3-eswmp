import { getMediaKind, resolveMediaOpenUrl, resolveMediaPreviewUrl, resolveMediaUrl } from "../../slf-monitoring/helpers.jsx";
import { FilePdfOutlined, LinkOutlined } from "@ant-design/icons";
import { Button, Image, Modal, Space } from "antd";

// Inline preview for an uploaded facility document or image.
export default function FilePreviewModal({
  filePreview,
  setFilePreview,
}) {
  return (
    <Modal
      title={
        <Space>
          <FilePdfOutlined style={{ color: "#cf1322" }} />
          <span style={{ maxWidth: 520, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {filePreview.name || "File Preview"}
          </span>
        </Space>
      }
      open={filePreview.open}
      onCancel={() => setFilePreview({ open: false, url: "", name: "" })}
      footer={[
        <Button
          key="open"
          icon={<LinkOutlined />}
          onClick={() => window.open(resolveMediaOpenUrl(filePreview.url), "_blank", "noopener,noreferrer")}
        >
          Open in new tab
        </Button>,
        <Button key="close" type="primary" onClick={() => setFilePreview({ open: false, url: "", name: "" })}>
          Close
        </Button>,
      ]}
      width={920}
      zIndex={1900}
      styles={{ body: { padding: 0, height: "72vh", background: "#525659" } }}
      destroyOnHidden
    >
      {(() => {
        if (!filePreview.url) return null;
        const kind = getMediaKind(filePreview.url);
        if (kind === "image") {
          return (
            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", overflow: "auto" }}>
              <Image
                src={resolveMediaUrl(filePreview.url)}
                style={{ maxHeight: "72vh", objectFit: "contain" }}
                preview={false}
              />
            </div>
          );
        }
        if (kind === "video") {
          return (
            <video
              src={filePreview.url}
              controls
              style={{ width: "100%", height: "100%", background: "#000" }}
            />
          );
        }
        // pdf / doc / drive (extension-less) — embed the viewer inline.
        return (
          <iframe
            title={filePreview.name || "File preview"}
            src={resolveMediaPreviewUrl(filePreview.url)}
            style={{ width: "100%", height: "100%", border: "none" }}
            allow="autoplay"
          />
        );
      })()}
    </Modal>
  );
}
