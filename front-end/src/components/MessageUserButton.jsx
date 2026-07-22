import { useState } from "react";
import { Button, Modal, Input, Typography, Tooltip } from "antd";
import { MessageOutlined } from "@ant-design/icons";
import api from "../api";

const { Text } = Typography;

// Shared "Message User" control (Item #5). One implementation of the admin →
// portal-user messaging UI, reused by the Portal Submissions Summary AND Baseline
// tabs. It targets the SLF's assigned portal user(s) via slfGenerator/slfName and
// posts to the SAME endpoint/model/real-time flow — no duplicate messaging code.
//
// Props:
//   slfGenerator, slfName  — target SLF (backend resolves the assigned portal user)
//   disabled, disabledReason — disable + explain when no valid portal user is assigned
//   size, type, block      — button styling passthrough
export default function MessageUserButton({
  slfGenerator,
  slfName,
  disabled = false,
  disabledReason = "",
  size = "small",
  type = "default",
  block = false,
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const genId = slfGenerator && typeof slfGenerator === "object" ? slfGenerator._id : slfGenerator;

  const send = async () => {
    const body = text.trim();
    if (!body) {
      Modal.error({ title: "Message required", content: "Please enter a message before sending." });
      return;
    }
    setSending(true);
    try {
      const { data } = await api.post("/portal-messages", {
        slfGenerator: genId || undefined,
        slfName: slfName || undefined,
        message: body,
      });
      setOpen(false);
      setText("");
      Modal.success({
        title: "Message Sent",
        content: `Your message was delivered to ${data?.count || 1} portal user${(data?.count || 1) === 1 ? "" : "s"} assigned to ${slfName || "this SLF"}.`,
      });
    } catch (err) {
      Modal.error({
        title: "Could Not Send Message",
        content: err.response?.data?.message || "Something went wrong while sending the message.",
      });
    } finally {
      setSending(false);
    }
  };

  const btn = (
    <Button
      size={size}
      type={type}
      block={block}
      icon={<MessageOutlined />}
      disabled={disabled}
      onClick={() => { setText(""); setOpen(true); }}
    >
      Message User
    </Button>
  );

  return (
    <>
      {disabled && disabledReason ? <Tooltip title={disabledReason}>{btn}</Tooltip> : btn}
      <Modal
        title={<span><MessageOutlined /> Message Portal User</span>}
        open={open}
        onCancel={() => { setOpen(false); setText(""); }}
        onOk={send}
        okText="Send"
        confirmLoading={sending}
        okButtonProps={{ disabled: !text.trim() }}
        destroyOnClose
      >
        <div style={{ marginBottom: 10 }}>
          <Text type="secondary">To (assigned portal user of):</Text>{" "}
          <Text strong>{slfName || "—"}</Text>
        </div>
        <Input.TextArea
          rows={5}
          maxLength={4000}
          showCount
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write your message to the portal user…"
          onPressEnter={(e) => { if (e.ctrlKey || e.metaKey) send(); }}
        />
        <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 8 }}>
          The user will see this after logging in to the SLF Portal. Delivered in real time.
        </Text>
      </Modal>
    </>
  );
}
