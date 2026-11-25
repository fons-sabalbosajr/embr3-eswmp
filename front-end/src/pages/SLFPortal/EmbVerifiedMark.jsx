import { Tag, Tooltip } from "antd";
import { SafetyCertificateOutlined } from "@ant-design/icons";

// "Verified by EMB" on a hauler client whose details EMB Region III verified or
// corrected. The server sets `embVerified` when the portal's copy still equals
// what EMB verified (server/utils/clientCorrection.js); nothing to show otherwise.
export default function EmbVerifiedMark({ client, compact = false }) {
  const at = client && typeof client === "object" ? client.embVerified?.at : null;
  if (!at) return null;
  const date = new Date(at);
  const when = Number.isNaN(date.getTime())
    ? ""
    : ` on ${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
  return (
    <Tooltip title={`EMB Region III verified this client's name and address${when}. If you change them, they will need to be verified again.`}>
      <Tag
        color="green"
        icon={<SafetyCertificateOutlined />}
        style={{ marginInlineStart: 6, marginInlineEnd: 0, fontSize: compact ? 10 : 11, lineHeight: compact ? "16px" : "18px" }}
      >
        {compact ? "EMB" : "Verified by EMB"}
      </Tag>
    </Tooltip>
  );
}
