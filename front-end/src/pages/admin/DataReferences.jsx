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
} from "@ant-design/icons";
import Swal from "sweetalert2";
import api from "../../api";

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
};

export default function DataReferences() {
  const [refs, setRefs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [filterModule, setFilterModule] = useState(null);
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
    if (filterModule) list = list.filter((r) => r.module === filterModule);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.label.toLowerCase().includes(q) ||
          r.category.toLowerCase().includes(q) ||
          r.values.some((v) => v.toLowerCase().includes(q)),
      );
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

  // Render a single reference card within the collapse
  const renderRefCard = (ref) => (
    <Card
      key={ref._id}
      size="small"
      hoverable
      style={{
        marginBottom: 10,
        borderRadius: 8,
        borderLeft: `3px solid ${ref.isActive ? ACCENT : "#d9d9d9"}`,
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
          <Tooltip title={ref.isActive ? "Deactivate" : "Activate"}>
            <Switch
              size="small"
              checked={ref.isActive}
              onChange={() => handleToggleActive(ref)}
            />
          </Tooltip>
          <Tooltip title="Edit">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => openEdit(ref)}
            />
          </Tooltip>
          <Popconfirm
            title="Delete this reference?"
            description="Pages using this reference will lose their dropdown values."
            onConfirm={() => handleDelete(ref._id)}
          >
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
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
          <Button icon={<ReloadOutlined />} onClick={fetchRefs}>
            Refresh
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={openAdd}
            style={{ background: ACCENT, borderColor: ACCENT }}
          >
            Add Reference
          </Button>
        </Space>
      </div>

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
          defaultActiveKey={Object.keys(grouped)}
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
