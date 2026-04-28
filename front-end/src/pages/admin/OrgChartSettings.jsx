import { useState, useEffect } from "react";
import {
  Card,
  Typography,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Select,
  Row,
  Col,
  Avatar,
  Empty,
  Tooltip,
  Popconfirm,
  Spin,
} from "antd";
import {
  ApartmentOutlined,
  PlusOutlined,
  SaveOutlined,
  EditOutlined,
  DeleteOutlined,
  UserOutlined,
} from "@ant-design/icons";
import Swal from "sweetalert2";
import api from "../../api";

const { Text, Title } = Typography;

// ── Org Chart visual node component ──
function OrgNode({ node, onAdd, onEdit, onDelete, isDark, canEdit = true, canDelete = true, depth = 0 }) {
  return (
    <div style={{ marginLeft: depth > 0 ? 32 : 0, marginBottom: 4 }}>
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 10,
        padding: "8px 14px", borderRadius: 8,
        border: `2px solid ${node.color || "#1677ff"}`,
        background: `${node.color || "#1677ff"}10`,
        marginBottom: 4, position: "relative",
      }}>
        {depth > 0 && (
          <div style={{
            position: "absolute", left: -20, top: "50%", width: 18, height: 2,
            background: isDark ? "#434343" : "#d9d9d9",
          }} />
        )}
        <Avatar size={32} src={node.avatar || undefined} style={{ background: node.color || "#1677ff" }}>
          {node.name?.charAt(0)?.toUpperCase()}
        </Avatar>
        <div>
          <div style={{ fontWeight: 600, fontSize: 13, lineHeight: "16px" }}>{node.name}</div>
          {node.title && <div style={{ fontSize: 11, color: "#8c8c8c" }}>{node.title}</div>}
        </div>
        {(canEdit || canDelete) && (
          <Space size={2} style={{ marginLeft: 8 }}>
            {canEdit && (
              <Tooltip title="Add sub-position">
                <Button size="small" type="text" icon={<PlusOutlined />} onClick={() => onAdd(node.id)} />
              </Tooltip>
            )}
            {canEdit && (
              <Tooltip title="Edit">
                <Button size="small" type="text" icon={<EditOutlined />} onClick={() => onEdit(node)} />
              </Tooltip>
            )}
            {canDelete && (
              <Popconfirm title="Delete this position and all sub-positions?" onConfirm={() => onDelete(node.id)}>
                <Tooltip title="Delete">
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                </Tooltip>
              </Popconfirm>
            )}
          </Space>
        )}
      </div>
      {node.children?.length > 0 && (
        <div style={{ borderLeft: isDark ? "2px solid #434343" : "2px solid #d9d9d9", marginLeft: 16, paddingLeft: 0 }}>
          {node.children.map(child => (
            <OrgNode key={child.id} node={child} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} isDark={isDark} canEdit={canEdit} canDelete={canDelete} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function OrgChartSettings({ isDark, canEdit = true, canDelete = true }) {
  const [orgChart, setOrgChart] = useState([]);
  const [loading, setLoading] = useState(true);
  const [orgSaving, setOrgSaving] = useState(false);
  const [orgModalOpen, setOrgModalOpen] = useState(false);
  const [orgEditing, setOrgEditing] = useState(null);
  const [orgForm] = Form.useForm();

  useEffect(() => {
    fetchOrgChart();
  }, []);

  const fetchOrgChart = async () => {
    try {
      const { data } = await api.get("/settings/app");
      if (data.orgChart) setOrgChart(data.orgChart);
    } catch {
      Swal.fire("Error", "Could not load org chart", "error");
    } finally {
      setLoading(false);
    }
  };

  const saveOrgChart = async () => {
    setOrgSaving(true);
    try {
      await api.put("/settings/org-chart", { orgChart });
      Swal.fire({ icon: "success", title: "Org chart saved", timer: 1000, showConfirmButton: false });
    } catch {
      Swal.fire("Error", "Could not save org chart", "error");
    } finally {
      setOrgSaving(false);
    }
  };

  const openOrgAdd = (parentId = null) => {
    setOrgEditing(null);
    orgForm.resetFields();
    orgForm.setFieldsValue({ parentId, color: "#1677ff" });
    setOrgModalOpen(true);
  };

  const openOrgEdit = (node) => {
    setOrgEditing(node.id);
    orgForm.setFieldsValue(node);
    setOrgModalOpen(true);
  };

  const handleOrgSave = () => {
    orgForm.validateFields().then(vals => {
      if (orgEditing) {
        setOrgChart(prev => prev.map(n => n.id === orgEditing ? { ...n, ...vals } : n));
      } else {
        const id = `node_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        setOrgChart(prev => [...prev, { id, ...vals }]);
      }
      setOrgModalOpen(false);
    });
  };

  const deleteOrgNode = (nodeId) => {
    const getDescendants = (id) => {
      const children = orgChart.filter(n => n.parentId === id);
      return [id, ...children.flatMap(c => getDescendants(c.id))];
    };
    const toRemove = new Set(getDescendants(nodeId));
    setOrgChart(prev => prev.filter(n => !toRemove.has(n.id)));
  };

  const buildOrgTree = (nodes, parentId = null) => {
    return nodes.filter(n => (n.parentId || null) === parentId).map(n => ({
      ...n,
      children: buildOrgTree(nodes, n.id),
    }));
  };

  const orgTreeData = buildOrgTree(orgChart);

  if (loading) {
    return <div style={{ display: "flex", justifyContent: "center", padding: 80 }}><Spin size="large" /></div>;
  }

  return (
    <div>
      <Card
        style={{ borderRadius: 10 }}
        title={<Space><ApartmentOutlined style={{ color: "#722ed1" }} /><Text strong>Organizational Chart Maker</Text></Space>}
        extra={
          canEdit ? (
            <Space>
              <Button icon={<PlusOutlined />} type="primary" onClick={() => openOrgAdd(null)}>Add Root Position</Button>
              <Button icon={<SaveOutlined />} loading={orgSaving} onClick={saveOrgChart}>Save Chart</Button>
            </Space>
          ) : null
        }
      >
        {orgChart.length === 0 ? (
          <Empty description="No positions added yet. Click 'Add Root Position' to start building your org chart." image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <div style={{ overflowX: "auto" }}>
            {orgTreeData.map(root => (
              <OrgNode key={root.id} node={root} onAdd={openOrgAdd} onEdit={openOrgEdit} onDelete={deleteOrgNode} isDark={isDark} canEdit={canEdit} canDelete={canDelete} />
            ))}
          </div>
        )}
      </Card>

      <Modal
        title={orgEditing ? "Edit Position" : "Add Position"}
        open={orgModalOpen}
        onCancel={() => setOrgModalOpen(false)}
        onOk={handleOrgSave}
        okText={orgEditing ? "Update" : "Add"}
        width={480}
      >
        <Form form={orgForm} layout="vertical" size="small">
          <Form.Item name="name" label="Full Name" rules={[{ required: true, message: "Name is required" }]}>
            <Input placeholder="e.g. Juan Dela Cruz" prefix={<UserOutlined />} />
          </Form.Item>
          <Form.Item name="title" label="Position / Title">
            <Input placeholder="e.g. Director, Chief SWM Officer" />
          </Form.Item>
          <Form.Item name="parentId" label="Reports To">
            <Select allowClear placeholder="Select parent (leave empty for root)">
              {orgChart.filter(n => n.id !== orgEditing).map(n => (
                <Select.Option key={n.id} value={n.id}>{n.name} — {n.title || "(no title)"}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="color" label="Node Color">
                <Input type="color" style={{ width: 60, height: 32, padding: 2, cursor: "pointer" }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="avatar" label="Avatar URL (optional)">
                <Input placeholder="https://..." />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
}
