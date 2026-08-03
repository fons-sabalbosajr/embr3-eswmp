import { useState, useEffect, useMemo } from "react";
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Switch,
  Space,
  Typography,
  Card,
  Popconfirm,
  Tag,
  Row,
  Col,
  Tooltip,
  Badge,
  Collapse,
  Empty,
  Alert,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  DatabaseOutlined,
  SearchOutlined,
  TagsOutlined,
  AppstoreOutlined,
  ReloadOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import Swal from "sweetalert2";
import api from "../../api";
import { matchesFilter, rowMatchesSearch } from "./shared/tableFilters";

const { Title, Text } = Typography;
const { TextArea } = Input;

const ACCENT = "#2f54eb";

const MODULE_COLORS = {
  General: "blue",
  Personnel: "purple",
  MRF: "green",
  SLF: "geekblue",
  Equipment: "orange",
  "Trash Trap": "cyan",
  "10-Year SWM Plan": "magenta",
  "Open Dump Sites": "red",
  PDS: "lime",
  "Transfer Station": "gold",
  RCA: "volcano",
  Support: "magenta",
  Notifications: "cyan",
  "Portal Users": "geekblue",
  Accounts: "purple",
  Transactions: "blue",
};

const APP_DEFAULT_REFERENCES = [
  {
    category: "cell-status",
    label: "Cell Status",
    module: "SLF",
    description: "Cell infrastructure status options used in SLF Data Table.",
    values: ["Active Cell", "Used/Completed", "Under Construction", "Reserved Area", "Not Existed"],
  },
  {
    category: "cell-type",
    label: "Cell Type",
    module: "SLF",
    description: "Cell infrastructure type options.",
    values: ["Residual", "Treated Haz Waste"],
  },
  {
    category: "support-ticket-category",
    label: "Support Ticket Category",
    module: "Support",
    description: "Categories used when portal users or admins create support conversations.",
    values: ["Technical Issue", "Data Correction", "Account Access", "Submission Concern", "Requirements / Compliance", "General Inquiry", "Feature Request", "Other"],
  },
  {
    category: "support-ticket-priority",
    label: "Support Ticket Priority",
    module: "Support",
    description: "Priority values used in support ticket workflows.",
    values: ["Low", "Medium", "High", "Urgent"],
  },
  {
    category: "portal-user-status",
    label: "Portal User Status",
    module: "Portal Users",
    description: "Portal registration and approval states.",
    values: ["pending", "approved", "rejected"],
  },
  {
    category: "portal-verification-status",
    label: "Portal Verification Status",
    module: "Portal Users",
    description: "Verification states shown in Portal User Management filters.",
    values: ["Held", "Docs Submitted", "Needs Docs", "Reviewed"],
  },
  {
    category: "notification-type",
    label: "Notification Type",
    module: "Notifications",
    description: "Notification event types shown in Notification Management.",
    values: ["new_submission", "resubmission", "status_change", "reverted", "new_portal_user", "baseline_update_request", "baseline_update_approved", "support_ticket", "support_ticket_reply", "submission_edit_request", "submission_edit_approved", "submission_edit_rejected"],
  },
  {
    category: "permission-module",
    label: "Permission Module",
    module: "Accounts",
    description: "Modules controlled by Accounts and Roles access switches.",
    values: ["dashboard", "submissions", "slfMonitoring", "messaging", "reports", "tenYearSwm", "fundedMrf", "lguInitiatedMrf", "trashTraps", "swmEquipment", "technicalAssistance", "transferStations", "openDumpsites", "projectDescScoping", "residualContainment", "lguAssistDiversion", "accountSettings", "portalUsers", "portalFields", "dataReferences", "orgChart", "baselineData", "supportTickets"],
  },
  {
    category: "transaction-type",
    label: "Transaction Type",
    module: "Transactions",
    description: "Transaction history event types used by Reports.",
    values: ["submission", "email_ack_sent", "email_ack_failed", "status_change", "deleted", "resubmission", "revert_requested", "revert_approved", "baseline_update_request", "baseline_update", "baseline_delete", "support_ticket", "support_ticket_reply", "hauler_delete_request", "hauler_delete_approved", "hauler_delete_rejected"],
  },
  {
    category: "hauler-request-status",
    label: "Hauler Request Status",
    module: "SLF",
    description: "Status values for portal hauler deletion requests.",
    values: ["pending", "approved", "rejected"],
  },
];

export default function DataReferences({canEdit = true, canDelete = true, isDark}) {
  const [refs, setRefs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [filterModule, setFilterModule] = useState(null);
  const [syncingDefaults, setSyncingDefaults] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    fetchRefs();
  }, []);

  const fetchRefs = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/data-references/all");
      setRefs(data);
    } catch {
      Swal.fire("Error", "Could not load data references", "error");
    } finally {
      setLoading(false);
    }
  };

  // Derived data
  const modules = useMemo(
    () => [...new Set(refs.map((r) => r.module))].sort(),
    [refs],
  );

  const filtered = useMemo(() => {
    let list = refs;
    if (filterModule) list = list.filter((r) => matchesFilter(r.module, filterModule));
    if (search) {
      list = list.filter((r) => rowMatchesSearch(r, search));
    }
    return list;
  }, [refs, filterModule, search]);

  // Group by module for Collapse view
  const grouped = useMemo(() => {
    const map = {};
    for (const r of filtered) {
      if (!map[r.module]) map[r.module] = [];
      map[r.module].push(r);
    }
    return map;
  }, [filtered]);

  const defaultSyncStats = useMemo(() => {
    const byCategory = new Map(refs.map((ref) => [ref.category, ref]));
    const missing = [];
    const needsUpdate = [];
    APP_DEFAULT_REFERENCES.forEach((defaults) => {
      const existing = byCategory.get(defaults.category);
      if (!existing) {
        missing.push(defaults);
        return;
      }
      const existingValues = new Set(existing.values || []);
      const hasMissingValues = defaults.values.some((value) => !existingValues.has(value));
      if (
        existing.label !== defaults.label ||
        existing.module !== defaults.module ||
        existing.description !== defaults.description ||
        hasMissingValues
      ) {
        needsUpdate.push(defaults);
      }
    });
    return { missing, needsUpdate };
  }, [refs]);

  // CRUD handlers
  const openAdd = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ isActive: true, values: "" });
    setModalOpen(true);
  };

  const openEdit = (record) => {
    setEditing(record);
    form.setFieldsValue({
      ...record,
      values: record.values.join("\n"),
    });
    setModalOpen(true);
  };

  const handleSave = async (formValues) => {
    const payload = {
      ...formValues,
      values: formValues.values
        ? formValues.values
            .split("\n")
            .map((v) => v.trim())
            .filter(Boolean)
        : [],
    };

    try {
      if (editing) {
        const { data } = await api.put(
          `/data-references/${editing._id}`,
          payload,
        );
        setRefs((prev) => prev.map((r) => (r._id === editing._id ? data : r)));
      } else {
        const { data } = await api.post("/data-references", payload);
        setRefs((prev) => [...prev, data]);
      }
      setModalOpen(false);
      Swal.fire({
        icon: "success",
        title: editing ? "Updated" : "Created",
        timer: 1000,
        showConfirmButton: false,
      });
    } catch (err) {
      Swal.fire(
        "Error",
        err.response?.data?.message || "Operation failed",
        "error",
      );
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/data-references/${id}`);
      setRefs((prev) => prev.filter((r) => r._id !== id));
      Swal.fire({
        icon: "success",
        title: "Deleted",
        timer: 800,
        showConfirmButton: false,
      });
    } catch {
      Swal.fire("Error", "Could not delete", "error");
    }
  };

  const handleToggleActive = async (record) => {
    try {
      const { data } = await api.put(`/data-references/${record._id}`, {
        isActive: !record.isActive,
      });
      setRefs((prev) => prev.map((r) => (r._id === record._id ? data : r)));
    } catch {
      Swal.fire("Error", "Could not update status", "error");
    }
  };

  const handleSyncAppDefaults = async () => {
    setSyncingDefaults(true);
    try {
      const byCategory = new Map(refs.map((ref) => [ref.category, ref]));
      let created = 0;
      let updated = 0;
      const nextRefs = [...refs];
      for (const defaults of APP_DEFAULT_REFERENCES) {
        const existing = byCategory.get(defaults.category);
        if (existing) {
          const mergedValues = Array.from(new Set([...(existing.values || []), ...defaults.values]));
          const payload = {
            category: existing.category,
            label: defaults.label,
            module: defaults.module,
            description: defaults.description,
            values: mergedValues,
            isActive: true,
          };
          const { data } = await api.put(`/data-references/${existing._id}`, payload);
          const index = nextRefs.findIndex((ref) => ref._id === existing._id);
          if (index >= 0) nextRefs[index] = data;
          updated += 1;
        } else {
          const { data } = await api.post("/data-references", { ...defaults, isActive: true });
          nextRefs.push(data);
          byCategory.set(defaults.category, data);
          created += 1;
        }
      }
      setRefs(nextRefs);
      Swal.fire({
        icon: "success",
        title: "App References Synced",
        text: `${created} created, ${updated} updated.`,
        timer: 1600,
        showConfirmButton: false,
      });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Could not sync app defaults", "error");
    } finally {
      setSyncingDefaults(false);
    }
  };

  // Render a single reference card within the collapse
  const renderRefCard = (ref) => (
    <Card
      key={ref._id}
      size="small"
      hoverable
      style={{
        marginBottom: 10,
        borderRadius: 8,
        borderLeft: `3px solid ${ref.isActive ? ACCENT : (isDark ? "#434343" : "#d9d9d9")}`,
        opacity: ref.isActive ? 1 : 0.6,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 4,
            }}
          >
            <Text strong>{ref.label}</Text>
            <Tag
              color={MODULE_COLORS[ref.module] || "default"}
              bordered={false}
            >
              {ref.module}
            </Tag>
            {!ref.isActive && (
              <Tag color="default" bordered={false}>
                Inactive
              </Tag>
            )}
          </div>
          <Text type="secondary" style={{ fontSize: 11 }}>
            <Tag style={{ fontSize: 10 }}>{ref.category}</Tag>
            {ref.description && ` — ${ref.description}`}
          </Text>
          <div
            style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4 }}
          >
            {ref.values.map((v, i) => (
              <Tag key={i} bordered={false} color="processing">
                {v}
              </Tag>
            ))}
            {ref.values.length === 0 && (
              <Text type="secondary" italic style={{ fontSize: 11 }}>
                No values
              </Text>
            )}
          </div>
        </div>
        <Space size={4}>
          {canEdit && <Tooltip title={ref.isActive ? "Deactivate" : "Activate"}>
            <Switch
              size="small"
              checked={ref.isActive}
              onChange={() => handleToggleActive(ref)}
            />
          </Tooltip>}
          {canEdit && <Tooltip title="Edit">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => openEdit(ref)}
            />
          </Tooltip>}
          {canDelete && <Popconfirm
            title="Delete this reference?"
            description="Pages using this reference will lose their dropdown values."
            onConfirm={() => handleDelete(ref._id)}
          >
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>}
        </Space>
      </div>
    </Card>
  );

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 4,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <Title level={4} style={{ margin: 0 }}>
            <DatabaseOutlined style={{ color: ACCENT, marginRight: 8 }} />
            Data References
          </Title>
          <Text type="secondary">
            Manage dropdown values & data lookups used across the application
          </Text>
        </div>
        <Space>
          <Tag color="blue">
            {filtered.length} / {refs.length} categories
          </Tag>
          <Button icon={<ReloadOutlined />} onClick={fetchRefs} loading={loading} disabled={loading}>
            Refresh
          </Button>
          {canEdit && <Button icon={<SyncOutlined />} loading={syncingDefaults} onClick={handleSyncAppDefaults}>
            Sync App Defaults
          </Button>}
          {canEdit && <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={openAdd}
            style={{ background: ACCENT, borderColor: ACCENT }}
          >
            Add Reference
          </Button>}
        </Space>
      </div>

      {canEdit && (defaultSyncStats.missing.length > 0 || defaultSyncStats.needsUpdate.length > 0) && (
        <Alert
          type="info"
          showIcon
          style={{ marginTop: 12, borderRadius: 8 }}
          message="New app reference defaults are available"
          description={`${defaultSyncStats.missing.length} missing and ${defaultSyncStats.needsUpdate.length} needing updates. Use Sync App Defaults to add current support ticket, notification, portal user, permission, transaction, and SLF cell options.`}
          action={<Button size="small" type="primary" loading={syncingDefaults} onClick={handleSyncAppDefaults}>Sync</Button>}
        />
      )}

      {/* Filters */}
      <Card
        size="small"
        style={{ marginTop: 12, marginBottom: 16, borderRadius: 10 }}
      >
        <Row gutter={12} align="middle">
          <Col xs={24} sm={12} md={8}>
            <Input
              prefix={<SearchOutlined />}
              placeholder="Search label, category, or values…"
              allowClear
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Col>
          <Col xs={24} sm={12} md={8}>
            <Select
              placeholder="Filter by module"
              allowClear
              style={{ width: "100%" }}
              value={filterModule}
              onChange={setFilterModule}
              options={modules.map((m) => ({ label: m, value: m }))}
            />
          </Col>
        </Row>
      </Card>

      {/* Grouped content */}
      {loading ? (
        <Card loading style={{ borderRadius: 10 }} />
      ) : Object.keys(grouped).length === 0 ? (
        <Card style={{ borderRadius: 10, textAlign: "center", padding: 40 }}>
          <Empty description="No data references found" />
        </Card>
      ) : (
        <Collapse
          defaultActiveKey={[]}
          ghost
          items={Object.entries(grouped).map(([mod, items]) => ({
            key: mod,
            label: (
              <span>
                <AppstoreOutlined style={{ marginRight: 6 }} />
                <Text strong>{mod}</Text>
                <Badge
                  count={items.length}
                  style={{
                    backgroundColor: ACCENT,
                    marginLeft: 8,
                    fontSize: 11,
                  }}
                />
              </span>
            ),
            children: items.map(renderRefCard),
          }))}
        />
      )}

      {/* Add / Edit Modal */}
      <Modal
        title={
          editing ? (
            <>
              <EditOutlined /> Edit Reference
            </>
          ) : (
            <>
              <PlusOutlined /> Add Reference
            </>
          )
        }
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        footer={null}
        destroyOnHidden
        width={520}
      >
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                name="category"
                label="Category Key"
                rules={[{ required: true, message: "Required" }]}
                tooltip="Unique slug (e.g. province, slf-status)"
              >
                <Input placeholder="e.g. province" disabled={!!editing} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="label"
                label="Display Label"
                rules={[{ required: true, message: "Required" }]}
              >
                <Input placeholder="e.g. Province" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                name="module"
                label="Module"
                rules={[{ required: true, message: "Required" }]}
              >
                <Select
                  placeholder="Select module"
                  showSearch
                  options={[
                    "General",
                    "Personnel",
                    "MRF",
                    "SLF",
                    "Equipment",
                    "Trash Trap",
                    "10-Year SWM Plan",
                    "Open Dump Sites",
                    "PDS",
                    "Transfer Station",
                    "RCA",
                  ].map((m) => ({ label: m, value: m }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="isActive" label="Active" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="description" label="Description">
            <Input placeholder="Brief description of this reference" />
          </Form.Item>
          <Form.Item
            name="values"
            label="Values (one per line)"
            rules={[
              { required: true, message: "At least one value is required" },
            ]}
            tooltip="Enter each dropdown option on a separate line"
          >
            <TextArea
              rows={8}
              placeholder={"Option 1\nOption 2\nOption 3"}
              style={{ fontFamily: "monospace", fontSize: 12 }}
            />
          </Form.Item>
          <Space style={{ width: "100%", justifyContent: "flex-end" }}>
            <Button onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button
              type="primary"
              htmlType="submit"
              style={{ background: ACCENT, borderColor: ACCENT }}
            >
              {editing ? "Update" : "Create"}
            </Button>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
