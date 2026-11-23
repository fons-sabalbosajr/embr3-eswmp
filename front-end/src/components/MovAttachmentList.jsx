import { Space, Tooltip, Typography } from "antd";
import { PaperClipOutlined, DeleteOutlined } from "@ant-design/icons";

const { Text } = Typography;

// Means-of-Verification files attached to a baseline cell entry. Shared by the
// portal baseline editor and the admin Baseline Data view so both list the same
// files the same way. Links open in a new tab (Drive view page or the app's own
// local-upload fallback).
export default function MovAttachmentList({ attachments, onRemove, compact = false, emptyText = "—" }) {
  const list = Array.isArray(attachments) ? attachments.filter((a) => a?.url) : [];
  if (!list.length) {
    return emptyText ? <Text type="secondary" style={{ fontSize: 11 }}>{emptyText}</Text> : null;
  }
  if (compact) {
    return (
      <Tooltip
        title={
          <div>
            {list.map((a, i) => (
              <div key={a.url + i}>{a.fileName || `File ${i + 1}`}</div>
            ))}
          </div>
        }
      >
        <a href={list[0].url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12 }}>
          <PaperClipOutlined /> {list.length} file{list.length === 1 ? "" : "s"}
        </a>
      </Tooltip>
    );
  }
  return (
    <Space direction="vertical" size={2} style={{ width: "100%" }}>
      {list.map((a, i) => (
        <div key={a.url + i} style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <PaperClipOutlined style={{ color: "#8c8c8c", flex: "none" }} />
          <a
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}
            title={a.fileName || a.url}
          >
            {a.fileName || `File ${i + 1}`}
          </a>
          {onRemove && (
            <DeleteOutlined
              role="button"
              aria-label={`Remove ${a.fileName || "file"}`}
              style={{ color: "#ff4d4f", cursor: "pointer", flex: "none" }}
              onClick={() => onRemove(i)}
            />
          )}
        </div>
      ))}
    </Space>
  );
}
