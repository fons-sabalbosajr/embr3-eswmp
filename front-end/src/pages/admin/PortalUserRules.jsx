// Developer-only Portal User Rules (App Settings › Security & Access).
// Assign per-portal-user rules enforced centrally by the backend policy service
// (utils/portalPolicy.js). The backend developerOnly-gates every endpoint used
// here, so this UI is a convenience layer — enforcement never depends on it.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Card, Space, Typography, Input, Button, Table, Tag, Modal, Switch,
  message, Empty, Tooltip, Timeline, Divider,
} from "antd";
import {
  SafetyOutlined, SearchOutlined, ReloadOutlined, HistoryOutlined, UndoOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import api from "../../api";

const { Text, Paragraph } = Typography;

export default function PortalUserRules() {
  const [catalog, setCatalog] = useState([]);
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null); // { user, rules }
  const [draftRules, setDraftRules] = useState({});
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [audit, setAudit] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const labelFor = useMemo(() => {
    const m = {};
    catalog.forEach((r) => { m[r.key] = r.label; });
    return m;
  }, [catalog]);

  const loadCatalog = useCallback(async () => {
    try {
      const { data } = await api.get("/portal-user-rules/catalog");
      setCatalog(Array.isArray(data?.rules) ? data.rules : []);
    } catch { /* non-blocking */ }
  }, []);

  const loadUsers = useCallback(async (q = "") => {
    setLoading(true);
    try {
      const { data } = await api.get("/portal-user-rules/users", { params: { search: q } });
      setUsers(Array.isArray(data?.users) ? data.users : []);
    } catch (e) {
      message.error(e?.response?.data?.message || "Failed to load portal users");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadCatalog(); loadUsers(); }, [loadCatalog, loadUsers]);

  const openEditor = (user) => {
    setEditing(user);
    setDraftRules({ ...user.rules });
    setReason("");
  };

  const saveRules = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const { data } = await api.put(`/portal-user-rules/${editing._id}`, { rules: draftRules, reason });
      message.success(data?.changed ? `Saved ${data.changed} rule change(s)` : "No changes");
      setUsers((prev) => prev.map((u) => (u._id === editing._id ? { ...u, rules: data.rules } : u)));
      setEditing(null);
    } catch (e) {
      message.error(e?.response?.data?.message || "Save failed");
    } finally { setSaving(false); }
  };

  const resetRules = async () => {
    if (!editing) return;
    Modal.confirm({
      title: "Reset to default rules?",
      content: `This removes all custom rule assignments for ${editing.email} and restores default behavior.`,
      okText: "Reset",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const { data } = await api.delete(`/portal-user-rules/${editing._id}`, { data: { reason: reason || "Reset to defaults" } });
          message.success("Rules reset to defaults");
          setUsers((prev) => prev.map((u) => (u._id === editing._id ? { ...u, rules: data.rules } : u)));
          setDraftRules({ ...data.rules });
        } catch (e) {
          message.error(e?.response?.data?.message || "Reset failed");
        }
      },
    });
  };

  const openAudit = async (user) => {
    setAuditOpen(true);
    setAuditLoading(true);
    setAudit([]);
    try {
      const { data } = await api.get(`/portal-user-rules/${user._id}/audit`);
      setAudit(Array.isArray(data?.items) ? data.items : []);
    } catch { /* non-blocking */ } finally { setAuditLoading(false); }
  };

  const columns = [
    { title: "Portal User", dataIndex: "name", render: (v, r) => (
      <Space direction="vertical" size={0}>
        <Text strong>{v || "—"}</Text>
        <Text type="secondary" style={{ fontSize: 12 }}>{r.email}</Text>
      </Space>
    ) },
    { title: "Company", dataIndex: "companyName", responsive: ["md"], render: (v) => v || "—" },
    { title: "Enabled rules", key: "rules", render: (_v, r) => {
      const on = Object.keys(r.rules || {}).filter((k) => r.rules[k]);
      return <Tag color="blue">{on.length}/{catalog.length || Object.keys(r.rules || {}).length} enabled</Tag>;
    } },
    { title: "Actions", key: "actions", render: (_v, r) => (
      <Space>
        <Button size="small" type="primary" ghost onClick={() => openEditor(r)}>Configure</Button>
        <Tooltip title="Rule change history"><Button size="small" icon={<HistoryOutlined />} onClick={() => openAudit(r)} /></Tooltip>
      </Space>
    ) },
  ];

  return (
    <Card
      style={{ borderRadius: 10 }}
      title={<Space><SafetyOutlined style={{ color: "#722ed1" }} /><Text strong>Portal User Rules</Text><Tag color="purple">Developer only</Tag></Space>}
      extra={
        <Space wrap>
          <Input
            size="small" allowClear prefix={<SearchOutlined />} placeholder="Search portal users"
            value={search} onChange={(e) => setSearch(e.target.value)}
            onPressEnter={() => loadUsers(search)} style={{ width: 220 }}
          />
          <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => loadUsers(search)}>Refresh</Button>
        </Space>
      }
    >
      <Paragraph type="secondary" style={{ marginBottom: 12 }}>
        Assign portal-specific rules to individual portal users. Rules are enforced on the
        backend by the central policy service — disabling a rule here blocks the action even
        if the user calls the API directly. Users without custom assignments keep default behavior.
      </Paragraph>
      <Table
        rowKey="_id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={users}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        locale={{ emptyText: <Empty description="No portal users" /> }}
      />

      <Modal
        open={!!editing}
        title={editing ? `Rules — ${editing.name || editing.email}` : "Rules"}
        onCancel={() => setEditing(null)}
        onOk={saveRules}
        okText="Save rules"
        confirmLoading={saving}
        width={520}
        footer={[
          <Button key="reset" icon={<UndoOutlined />} onClick={resetRules}>Reset to defaults</Button>,
          <Button key="cancel" onClick={() => setEditing(null)}>Cancel</Button>,
          <Button key="save" type="primary" loading={saving} onClick={saveRules}>Save rules</Button>,
        ]}
      >
        {editing && (
          <Space direction="vertical" style={{ width: "100%" }} size={10}>
            {(catalog.length ? catalog : Object.keys(draftRules).map((k) => ({ key: k, label: labelFor[k] || k }))).map((r) => (
              <div key={r.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <Text>{r.label}</Text>
                <Switch
                  checked={!!draftRules[r.key]}
                  onChange={(v) => setDraftRules((prev) => ({ ...prev, [r.key]: v }))}
                />
              </div>
            ))}
            <Divider style={{ margin: "8px 0" }} />
            <Input.TextArea
              rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for this change (optional — recorded in the audit trail)"
            />
          </Space>
        )}
      </Modal>

      <Modal open={auditOpen} title="Rule change history" onCancel={() => setAuditOpen(false)} footer={null} width={560}>
        {auditLoading ? <Text type="secondary">Loading…</Text> : audit.length === 0 ? (
          <Empty description="No rule changes recorded" />
        ) : (
          <Timeline
            items={audit.map((a) => ({
              children: (
                <Space direction="vertical" size={0}>
                  <Text strong>{labelFor[a.ruleKey] || a.ruleKey}: {String(a.previousValue)} → {String(a.newValue)}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    by {a.changedBy} · {a.createdAt ? dayjs(a.createdAt).format("YYYY-MM-DD HH:mm") : ""}
                    {a.reason ? ` · ${a.reason}` : ""}
                  </Text>
                </Space>
              ),
            }))}
          />
        )}
      </Modal>
    </Card>
  );
}
