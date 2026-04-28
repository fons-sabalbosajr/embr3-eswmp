import { useState, useEffect } from "react";
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Switch,
  InputNumber,
  Space,
  Typography,
  Card,
  Popconfirm,
  Tag,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  DatabaseOutlined,
} from "@ant-design/icons";
import Swal from "sweetalert2";
import api from "../../api";

const { Title, Text } = Typography;
const { Option } = Select;

const SECTION_LABELS = {
  "disposal-info": "Disposal Report",
  "company-info": "Waste Generator's Information",
  "transport-info": "Transport Entry (Per Truck)",
  "hazwaste-codes": "Hazardous Waste Codes",
  "baseline-info": "Baseline Data",
  "cell-info": "Cell Information",
  "facility-info": "Facility Information",
  "compliance-info": "Compliance & Permits",
};

export default function FieldSettings({canEdit = true, canDelete = true, isDark}) {
  const [fields, setFields] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filterSection, setFilterSection] = useState(null);
  const [form] = Form.useForm();

  useEffect(() => {
    fetchFields();
  }, []);

  const fetchFields = async () => {
    try {
      const { data } = await api.get("/settings/fields/all");
      setFields(data);
    } catch {
      Swal.fire("Error", "Could not load fields", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleSeed = async () => {
    try {
      const { data } = await api.post("/settings/fields/seed");
      if (data.seeded) {
        Swal.fire({ icon: "success", title: "Fields Seeded", text: "Default portal fields have been created.", timer: 1500, showConfirmButton: false });
        fetchFields();
      } else {
        Swal.fire("Info", "Fields already exist. Seed skipped.", "info");
      }
    } catch {
      Swal.fire("Error", "Could not seed fields", "error");
    }
  };

  const openAdd = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ required: true, isActive: true, order: fields.length + 1 });
    setModalOpen(true);
  };

  const openEdit = (record) => {
    setEditing(record);
    form.setFieldsValue({
      ...record,
      options: record.options?.join(", "),
    });
    setModalOpen(true);
  };

  const handleSave = async (values) => {
    const payload = {
      ...values,
      options: values.options
        ? values.options.split(",").map((o) => o.trim()).filter(Boolean)
        : [],
    };

    try {
      if (editing) {
        const { data } = await api.put(`/settings/fields/${editing._id}`, payload);
        const updated = data.data || data;
        setFields((prev) =>
          prev.map((f) => (f._id === editing._id ? updated : f))
        );
      } else {
        const { data } = await api.post("/settings/fields", payload);
        const created = data.data || data;
        setFields((prev) => [...prev, created]);
      }
      setModalOpen(false);
      Swal.fire({
        icon: "success",
        title: editing ? "Field Updated" : "Field Added",
        timer: 1000,
        showConfirmButton: false,
      });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Operation failed", "error");
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/settings/fields/${id}`);
      setFields((prev) => prev.filter((f) => f._id !== id));
      Swal.fire({ icon: "success", title: "Deleted", timer: 800, showConfirmButton: false });
    } catch {
      Swal.fire("Error", "Could not delete field", "error");
    }
  };

  const columns = [
    {
      title: "Order",
      dataIndex: "order",
      key: "order",
      width: 70,
      sorter: (a, b) => a.order - b.order,
    },
    {
      title: "Field Name",
      dataIndex: "fieldName",
      key: "fieldName",
      render: (text) => <Text strong>{text}</Text>,
    },
    {
      title: "Key",
      dataIndex: "fieldKey",
      key: "fieldKey",
      render: (text) => <Tag>{text}</Tag>,
    },
    {
      title: "Type",
      dataIndex: "fieldType",
      key: "fieldType",
      render: (text) => <Tag color="blue">{text}</Tag>,
    },
    {
      title: "Section",
      dataIndex: "section",
      key: "section",
      render: (v) => <Tag color="geekblue">{SECTION_LABELS[v] || v}</Tag>,
    },
    {
      title: "Required",
      dataIndex: "required",
      key: "required",
      render: (val) =>
        val ? <Tag color="red">Yes</Tag> : <Tag>No</Tag>,
    },
    {
      title: "Active",
      dataIndex: "isActive",
      key: "isActive",
      render: (val) =>
        val ? <Tag color="green">Active</Tag> : <Tag color="default">Inactive</Tag>,
    },
    {
      title: "Actions",
      key: "actions",
      render: (_, r) => (
        <Space>
          {canEdit && <Button
            type="text"
            icon={<EditOutlined />}
            onClick={() => openEdit(r)}
            size="small"
          />}
          {canDelete && <Popconfirm
            title="Delete this field?"
            onConfirm={() => handleDelete(r._id)}
          >
            <Button type="text" danger icon={<DeleteOutlined />} size="small" />
          </Popconfirm>}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, flexWrap: "wrap", gap: 12 }}>
        <div>
        </div>
        <Space>
          <Button
            icon={<DatabaseOutlined />}
            onClick={handleSeed}
          >
            Seed Defaults
          </Button>
          {canEdit && <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={openAdd}
            style={{ background: "#1a3353", borderColor: "#1a3353" }}
          >
            Add Field
          </Button>}
        </Space>
      </div>

      <Card style={{ marginTop: 16, borderRadius: 10 }}>
        <div style={{ marginBottom: 12 }}>
          <Select placeholder="Filter by Section" allowClear value={filterSection} onChange={setFilterSection} style={{ width: 260 }} options={Object.entries(SECTION_LABELS).map(([k, v]) => ({ label: v, value: k }))} />
        </div>
        <Table
          dataSource={filterSection ? fields.filter(f => f.section === filterSection) : fields}
          columns={columns}
          rowKey="_id"
          loading={loading}
          pagination={false}
          size="middle"
          scroll={{ x: 800 }}
        />
      </Card>

      <Modal
        title={editing ? "Edit Field" : "Add Field"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item
            name="fieldName"
            label="Field Name"
            rules={[{ required: true, message: "Required" }]}
          >
            <Input placeholder="e.g. Hauler Name" />
          </Form.Item>
          <Form.Item
            name="fieldKey"
            label="Field Key"
            rules={[{ required: true, message: "Required" }]}
          >
            <Input placeholder="e.g. hauler" />
          </Form.Item>
          <Form.Item
            name="fieldType"
            label="Field Type"
            rules={[{ required: true, message: "Required" }]}
          >
            <Select placeholder="Select type">
              <Option value="text">Text</Option>
              <Option value="number">Number</Option>
              <Option value="select">Select</Option>
              <Option value="date">Date</Option>
            </Select>
          </Form.Item>
          <Form.Item name="options" label="Options (comma-separated, for select type)">
            <Input placeholder="Option 1, Option 2, Option 3" />
          </Form.Item>
          <Form.Item name="section" label="Section" rules={[{ required: true, message: "Required" }]}>
            <Select placeholder="Select section">
              <Option value="disposal-info">Disposal Report (Date, General Info)</Option>
              <Option value="company-info">Waste Generator&apos;s Information</Option>
              <Option value="transport-info">Transport Entry (Per Truck)</Option>
              <Option value="hazwaste-codes">Hazardous Waste Codes</Option>
              <Option value="baseline-info">Baseline Data</Option>
              <Option value="cell-info">Cell Information</Option>
              <Option value="facility-info">Facility Information</Option>
              <Option value="compliance-info">Compliance &amp; Permits</Option>
            </Select>
          </Form.Item>
          <Form.Item name="order" label="Order">
            <InputNumber min={1} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="required" label="Required" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="isActive" label="Active" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block style={{ background: "#1a3353" }}>
              {editing ? "Update" : "Create"}
            </Button>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
