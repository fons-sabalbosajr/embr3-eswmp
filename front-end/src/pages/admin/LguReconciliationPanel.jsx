// Admin LGU reconciliation — review municipality-level LGU clients that don't
// deterministically link to the official masterlist, and act on deterministic +
// fuzzy suggestions (all sourced ONLY from the encoded masterlist). Nothing is
// auto-applied: every accept/reject is an explicit, audited admin decision.
import { useCallback, useEffect, useState } from "react";
import { Modal, Table, Tag, Button, Space, Typography, Alert, Spin, Empty, Popconfirm, Statistic, Row, Col, Tooltip, message } from "antd";
import { LinkOutlined, WarningOutlined, InfoCircleOutlined } from "@ant-design/icons";
import api from "../../api";

const { Text } = Typography;

const CONF_COLOR = { high: "green", medium: "gold", low: "orange" };
const CLASS_LABEL = {
  exact: "Exact match", high: "High-confidence", medium: "Probable", multiple: "Multiple possible",
  none: "No reliable match", invalid: "Invalid value",
};
const CLASS_COLOR = { high: "blue", medium: "gold", multiple: "orange", none: "red", invalid: "volcano" };

export default function LguReconciliationPanel({ open, onClose, onChanged }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const { data: d } = await api.get("/slf-clients/lgu-reconciliation");
      setData(d || null);
    } catch (e) {
      setError(e?.response?.data?.message || "Could not load reconciliation data.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (open) load(); else setData(null); }, [open, load]);

  const accept = useCallback(async (row, sug) => {
    setBusyId(row.clientId);
    try {
      await api.post(`/slf-clients/${row.clientId}/link-lgu`, {
        masterId: sug.masterId, addAlias: true, correctClient: false,
        confidence: sug.confidence, method: sug.method,
      });
      message.success(`Linked "${row.original}" → ${sug.name}`);
      await load();
      onChanged?.();
    } catch (e) {
      message.error(e?.response?.data?.message || "Could not link the record.");
    } finally { setBusyId(""); }
  }, [load, onChanged]);

  const flagManual = useCallback(async (row) => {
    setBusyId(row.clientId);
    try {
      await api.post(`/slf-clients/${row.clientId}/flag-manual-review`, {});
      message.success("Flagged for manual review.");
      await load();
    } catch (e) {
      message.error(e?.response?.data?.message || "Could not flag the record.");
    } finally { setBusyId(""); }
  }, [load]);

  const s = data?.summary;
  const columns = [
    { title: "Unlinked Value", dataIndex: "original", width: 170, render: (v, r) => <span><Text strong style={{ fontSize: 12 }}>{v || "—"}</Text>{r.province ? <div style={{ fontSize: 11, color: "#8c8c8c" }}>{r.province}{r.barangay ? ` · Brgy. ${r.barangay}` : ""}</div> : <Tag color="red" style={{ fontSize: 10 }}>no province</Tag>}</span> },
    { title: "Finding", dataIndex: "classification", width: 130, render: (v) => <Tag color={CLASS_COLOR[v] || "default"}>{CLASS_LABEL[v] || v}</Tag> },
    {
      title: "Masterlist Suggestion(s)", key: "sug", render: (_, r) => (
        r.suggestions?.length ? (
          <Space direction="vertical" size={4} style={{ width: "100%" }}>
            {r.suggestions.map((sug) => (
              <div key={sug.masterId} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Tag color={CONF_COLOR[sug.confidence] || "default"} style={{ margin: 0 }}>{sug.confidence}</Tag>
                <Text style={{ fontSize: 12 }}>{sug.name}{sug.province ? `, ${sug.province}` : ""}</Text>
                {sug.psgc && <Text type="secondary" style={{ fontSize: 10 }}>PSGC {sug.psgc}</Text>}
                <Tooltip title={sug.reason}><InfoCircleOutlined style={{ color: "#8c8c8c", fontSize: 11 }} /></Tooltip>
                <Popconfirm
                  title={`Link "${r.original}" to ${sug.name}?`}
                  description="Adds an approved alias to the masterlist entry (non-destructive) and records an audit entry."
                  okText="Accept & link"
                  onConfirm={() => accept(r, sug)}
                >
                  <Button size="small" type="primary" icon={<LinkOutlined />} loading={busyId === r.clientId}>Accept</Button>
                </Popconfirm>
              </div>
            ))}
          </Space>
        ) : <Text type="secondary" style={{ fontSize: 12 }}>{r.reason || "No masterlist suggestion."}</Text>
      ),
    },
    { title: "", key: "actions", width: 120, render: (_, r) => <Button size="small" icon={<WarningOutlined />} loading={busyId === r.clientId} onClick={() => flagManual(r)}>Manual review</Button> },
  ];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={<Button onClick={onClose}>Close</Button>}
      width="min(920px, 96vw)"
      centered
      title={<Space><LinkOutlined /> LGU Reconciliation — unlinked municipality records</Space>}
      styles={{ body: { maxHeight: "74vh", overflowY: "auto" } }}
      destroyOnHidden
    >
      {loading ? (
        <div style={{ textAlign: "center", padding: 40 }}><Spin /></div>
      ) : error ? (
        <Alert type="error" showIcon message={error} />
      ) : (
        <>
          <Alert
            type="info" showIcon style={{ marginBottom: 12 }}
            message="Suggestions come only from the encoded LGU masterlist and are never auto-applied."
            description="Verified served counts use deterministically-linked municipalities only; unlinked records are excluded from official counts until reviewed."
          />
          {s && (
            <Row gutter={[10, 10]} style={{ marginBottom: 12 }}>
              <Col xs={12} md={6}><Statistic title="Verified served LGUs" value={s.verifiedServedMunicipalities ?? 0} valueStyle={{ color: "#52c41a" }} /></Col>
              <Col xs={12} md={6}><Statistic title="Unlinked records" value={s.unlinkedCount ?? 0} valueStyle={{ color: "#ff4d4f" }} /></Col>
              <Col xs={12} md={6}><Statistic title="Unverified (has hauler)" value={s.unverifiedRecords ?? 0} valueStyle={{ color: "#fa8c16" }} /></Col>
              <Col xs={12} md={6}><Statistic title="Need manual review" value={s.manualReview ?? 0} valueStyle={{ color: "#faad14" }} /></Col>
            </Row>
          )}
          {data && data.unlinked?.length === 0 ? (
            <Empty description="All LGU clients are linked to the masterlist. 🎉" />
          ) : (
            <Table
              size="small"
              rowKey="clientId"
              dataSource={data?.unlinked || []}
              columns={columns}
              pagination={{ pageSize: 8, size: "small" }}
              scroll={{ x: 720 }}
            />
          )}
        </>
      )}
    </Modal>
  );
}
