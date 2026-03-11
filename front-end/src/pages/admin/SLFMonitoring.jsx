import { useState, useEffect } from "react";
import {
  Card,
  Table,
  Button,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Tag,
  Divider,
  Row,
  Col,
  Typography,
  Popconfirm,
  Switch,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  EnvironmentOutlined,
  MinusCircleOutlined,
  DownloadOutlined,
} from "@ant-design/icons";
import Swal from "sweetalert2";
import api from "../../api";
import { exportToExcel } from "../../utils/exportExcel";

const { Title, Text } = Typography;

const unitOptions = [
  { label: "Tons", value: "tons" },
  { label: "m³", value: "m3" },
];

export default function SLFMonitoring() {
  const [facilities, setFacilities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form] = Form.useForm();

  const fetchFacilities = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/slf-generators");
      setFacilities(data);
    } catch {
      Swal.fire("Error", "Failed to load facilities", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFacilities();
    const interval = setInterval(fetchFacilities, 8000);
    return () => clearInterval(interval);
  }, []);

  const openAdd = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      existingBaselineUnit: "tons",
      totalVolumeSinceOperationUnit: "tons",
      totalVolumeActiveCellsUnit: "tons",
      totalVolumeClosedCellsUnit: "tons",
      isActive: true,
      accreditedHaulers: [],
    });
    setModalOpen(true);
  };

  const openEdit = (record) => {
    setEditing(record);
    form.setFieldsValue({
      ...record,
      accreditedHaulers: record.accreditedHaulers || [],
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      if (editing) {
        await api.put(`/slf-generators/${editing._id}`, values);
        Swal.fire("Updated", "Facility updated successfully", "success");
      } else {
        await api.post("/slf-generators", values);
        Swal.fire("Created", "Facility added successfully", "success");
      }
      setModalOpen(false);
      fetchFacilities();
    } catch (err) {
      if (err.response) {
        Swal.fire("Error", err.response.data?.message || "Save failed", "error");
      }
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/slf-generators/${id}`);
      Swal.fire("Deleted", "Facility removed", "success");
      fetchFacilities();
    } catch {
      Swal.fire("Error", "Delete failed", "error");
    }
  };

  const columns = [
    {
      title: "SLF Name",
      dataIndex: "slfName",
      key: "slfName",
      render: (text) => <Text strong>{text}</Text>,
    },
    {
      title: "Baseline Volume",
      key: "baseline",
      render: (_, r) =>
        `${(r.existingBaselineVolume ?? 0).toLocaleString()} ${r.existingBaselineUnit || "tons"}`,
    },
    {
      title: "Total Since Operation",
      key: "totalOp",
      render: (_, r) =>
        `${(r.totalVolumeSinceOperation ?? 0).toLocaleString()} ${r.totalVolumeSinceOperationUnit || "tons"}`,
    },
    {
      title: "Active Cells",
      key: "active",
      render: (_, r) =>
        `${(r.totalVolumeActiveCells ?? 0).toLocaleString()} ${r.totalVolumeActiveCellsUnit || "tons"}`,
    },
    {
      title: "Closed Cells",
      key: "closed",
      render: (_, r) =>
        `${(r.totalVolumeClosedCells ?? 0).toLocaleString()} ${r.totalVolumeClosedCellsUnit || "tons"}`,
    },
    {
      title: "Haulers",
      key: "haulers",
      render: (_, r) => (r.accreditedHaulers?.length || 0),
    },
    {
      title: "Status",
      dataIndex: "isActive",
      key: "isActive",
      render: (v) =>
        v ? <Tag color="green">Active</Tag> : <Tag color="red">Inactive</Tag>,
    },
    {
      title: "Actions",
      key: "actions",
      width: 120,
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => openEdit(record)}
          />
          <Popconfirm
            title="Delete this facility?"
            onConfirm={() => handleDelete(record._id)}
          >
            <Button type="link" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  /* ── Volume field helper ── */
  const VolumeRow = ({ label, nameVal, nameUnit }) => (
    <Row gutter={8}>
      <Col span={16}>
        <Form.Item label={label} name={nameVal}>
          <InputNumber min={0} style={{ width: "100%" }} />
        </Form.Item>
      </Col>
      <Col span={8}>
        <Form.Item label="Unit" name={nameUnit}>
          <Select options={unitOptions} />
        </Form.Item>
      </Col>
    </Row>
  );

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <Title level={4} style={{ margin: 0 }}>
          <EnvironmentOutlined /> SLF Monitoring
        </Title>
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
            Add Facility
          </Button>
          <Button
            icon={<DownloadOutlined />}
            onClick={() => {
              const rows = facilities.map((f) => ({
                "SLF Name": f.slfName,
                "Baseline Volume": f.existingBaselineVolume ?? 0,
                "Baseline Unit": f.existingBaselineUnit || "tons",
                "Total Since Operation": f.totalVolumeSinceOperation ?? 0,
                "Active Cells": f.totalVolumeActiveCells ?? 0,
                "Closed Cells": f.totalVolumeClosedCells ?? 0,
                Haulers: f.accreditedHaulers?.length || 0,
                Status: f.isActive ? "Active" : "Inactive",
              }));
              exportToExcel(rows, "SLF_Facilities");
            }}
          >
            Export Excel
          </Button>
        </Space>
      </div>

      <Card>
        <Table
          dataSource={facilities}
          columns={columns}
          rowKey="_id"
          loading={loading}
          scroll={{ x: 900 }}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      {/* ── Add / Edit Modal ── */}
      <Modal
        title={editing ? "Edit SLF Facility" : "Add SLF Facility"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        width={720}
        okText={editing ? "Update" : "Create"}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label="SLF Name"
            name="slfName"
            rules={[{ required: true, message: "Required" }]}
          >
            <Input placeholder="Sanitary Landfill Facility name" />
          </Form.Item>

          <Form.Item label="Active" name="isActive" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Divider titlePlacement="left" plain>
            Volume / Baseline Info
          </Divider>

          <VolumeRow
            label="Existing Baseline Volume"
            nameVal="existingBaselineVolume"
            nameUnit="existingBaselineUnit"
          />
          <VolumeRow
            label="Total Volume Since Start of Operation"
            nameVal="totalVolumeSinceOperation"
            nameUnit="totalVolumeSinceOperationUnit"
          />
          <VolumeRow
            label="Total Volume in Active Cells (Residual & Inert)"
            nameVal="totalVolumeActiveCells"
            nameUnit="totalVolumeActiveCellsUnit"
          />
          <VolumeRow
            label="Total Volume in Closed Cells (Residual & Inert)"
            nameVal="totalVolumeClosedCells"
            nameUnit="totalVolumeClosedCellsUnit"
          />

          <Divider titlePlacement="left" plain>
            Accredited Haulers
          </Divider>

          <Form.List name="accreditedHaulers">
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, name, ...rest }) => (
                  <Card
                    key={key}
                    size="small"
                    style={{ marginBottom: 12 }}
                    extra={
                      <MinusCircleOutlined
                        style={{ color: "red" }}
                        onClick={() => remove(name)}
                      />
                    }
                  >
                    <Row gutter={12}>
                      <Col span={10}>
                        <Form.Item
                          {...rest}
                          name={[name, "haulerName"]}
                          label="Hauler Name"
                          rules={[{ required: true, message: "Required" }]}
                        >
                          <Input />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item
                          {...rest}
                          name={[name, "numberOfTrucks"]}
                          label="No. of Trucks"
                        >
                          <InputNumber min={0} style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item
                          {...rest}
                          name={[name, "privateSectorClients"]}
                          label="Private Sector Clients"
                        >
                          <Input />
                        </Form.Item>
                      </Col>
                    </Row>
                  </Card>
                ))}
                <Button
                  type="dashed"
                  onClick={() => add()}
                  block
                  icon={<PlusOutlined />}
                >
                  Add Hauler
                </Button>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>
    </div>
  );
}
