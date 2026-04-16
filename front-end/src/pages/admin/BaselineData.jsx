import { useState, useEffect } from "react";
import {
  Card,
  Table,
  Tag,
  Typography,
  Space,
  Spin,
  Descriptions,
  Modal,
  Badge,
  Empty,
  Tooltip,
  Button,
  Form,
  InputNumber,
  Select,
  Input,
  Row,
  Col,
  Divider,
  Popconfirm,
} from "antd";
import {
  DatabaseOutlined,
  EyeOutlined,
  EditOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SaveOutlined,
  PlusOutlined,
  DeleteOutlined,
  UnlockOutlined,
  LockOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import Swal from "sweetalert2";
import api from "../../api";

const { Text, Title } = Typography;
const UNIT_OPTIONS = ["m³", "tons"];

export default function BaselineData({ isDark, canEdit = false, canDelete = false }) {
  const [baselines, setBaselines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editRecord, setEditRecord] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [haulers, setHaulers] = useState([]);
  const [expandedHaulers, setExpandedHaulers] = useState({});

  useEffect(() => {
    fetchBaselines();
  }, []);

  const fetchBaselines = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/data-slf/baselines");
      setBaselines(data);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  };

  const fmtVol = (val, unit) =>
    val != null ? `${Number(val).toLocaleString()} ${unit || "m³"}` : "—";

  const openEdit = (record) => {
    setEditRecord(record);
    form.setFieldsValue({
      totalVolumeAccepted: record.totalVolumeAccepted,
      totalVolumeAcceptedUnit: record.totalVolumeAcceptedUnit || "m³",
      activeCellResidualVolume: record.activeCellResidualVolume,
      activeCellResidualUnit: record.activeCellResidualUnit || "m³",
      activeCellInertVolume: record.activeCellInertVolume,
      activeCellInertUnit: record.activeCellInertUnit || "m³",
      closedCellResidualVolume: record.closedCellResidualVolume,
      closedCellResidualUnit: record.closedCellResidualUnit || "m³",
      closedCellInertVolume: record.closedCellInertVolume,
      closedCellInertUnit: record.closedCellInertUnit || "m³",
    });
    setHaulers(
      (record.accreditedHaulers || []).map((h, i) => ({
        key: `h_${i}`,
        haulerName: h.haulerName || "",
        numberOfTrucks: h.numberOfTrucks ?? 0,
        officeAddress: h.officeAddress || "",
        vehicles: (h.vehicles || []).map((v, j) => ({
          key: `v_${i}_${j}`,
          plateNumber: v.plateNumber || "",
          vehicleType: v.vehicleType || "",
          capacity: v.capacity ?? 0,
          capacityUnit: v.capacityUnit || "m³",
        })),
      }))
    );
    setExpandedHaulers({});
    setEditOpen(true);
  };

  const handleSave = async () => {
    try {
      await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const vals = form.getFieldsValue();
      await api.put(`/data-slf/baselines/${editRecord._id}`, {
        ...vals,
        accreditedHaulers: haulers.map(({ key, vehicles, ...rest }) => ({
          ...rest,
          vehicles: (vehicles || []).map(({ key: vk, ...vrest }) => vrest),
        })),
      });
      Swal.fire({ icon: "success", title: "Baseline Updated", timer: 1200, showConfirmButton: false });
      setEditOpen(false);
      fetchBaselines();
    } catch {
      Swal.fire("Error", "Could not update baseline", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/data-slf/baselines/${id}`);
      Swal.fire({ icon: "success", title: "Baseline Deleted", timer: 1200, showConfirmButton: false });
      fetchBaselines();
    } catch {
      Swal.fire("Error", "Could not delete baseline record", "error");
    }
  };

  const handleApproveBaselineUpdate = async (slfName) => {
    const result = await Swal.fire({
      title: "Approve Baseline Update?",
      text: `This will unlock baseline data for "${slfName}" so the portal user can make changes.`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Approve",
      confirmButtonColor: "#52c41a",
    });
    if (!result.isConfirmed) return;
    try {
      await api.patch(`/data-slf/baseline-update-approve/${encodeURIComponent(slfName)}`, {});
      Swal.fire({ icon: "success", title: "Update Approved", text: "The portal user can now edit their baseline data.", timer: 2000, showConfirmButton: false });
      fetchBaselines();
    } catch (err) {
      Swal.fire("Error", err?.response?.data?.message || "Could not approve baseline update", "error");
    }
  };

  const handleLockBaseline = async (slfName) => {
    const result = await Swal.fire({
      title: "Lock Baseline?",
      text: `This will re-lock baseline data for "${slfName}".`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Lock",
      confirmButtonColor: "#fa8c16",
    });
    if (!result.isConfirmed) return;
    try {
      await api.patch(`/data-slf/baseline-update-lock/${encodeURIComponent(slfName)}`, {});
      Swal.fire({ icon: "success", title: "Baseline Locked", timer: 1500, showConfirmButton: false });
      fetchBaselines();
    } catch (err) {
      Swal.fire("Error", err?.response?.data?.message || "Could not lock baseline", "error");
    }
  };

  const handleRejectBaselineUpdate = async (slfName) => {
    const { value: reason } = await Swal.fire({
      title: "Reject Baseline Update?",
      text: `This will deny the update request for "${slfName}".`,
      icon: "warning",
      input: "text",
      inputPlaceholder: "Reason for rejection (optional)",
      showCancelButton: true,
      confirmButtonText: "Reject",
      confirmButtonColor: "#ff4d4f",
    });
    if (reason === undefined) return; // cancelled
    try {
      await api.patch(`/data-slf/baseline-update-reject/${encodeURIComponent(slfName)}`, { reason });
      Swal.fire({ icon: "success", title: "Request Rejected", timer: 1500, showConfirmButton: false });
      fetchBaselines();
    } catch (err) {
      Swal.fire("Error", err?.response?.data?.message || "Could not reject baseline update", "error");
    }
  };

  const addHauler = () => {
    setHaulers((prev) => [
      ...prev,
      { key: `h_${Date.now()}`, haulerName: "", numberOfTrucks: 0, officeAddress: "", vehicles: [] },
    ]);
  };

  const removeHauler = (key) => {
    setHaulers((prev) => prev.filter((h) => h.key !== key));
  };

  const updateHauler = (key, field, value) => {
    setHaulers((prev) =>
      prev.map((h) => (h.key === key ? { ...h, [field]: value } : h))
    );
  };

  const addVehicle = (haulerKey) => {
    setHaulers((prev) =>
      prev.map((h) =>
        h.key === haulerKey
          ? { ...h, vehicles: [...(h.vehicles || []), { key: `v_${Date.now()}`, plateNumber: "", vehicleType: "", capacity: 0, capacityUnit: "m³" }] }
          : h
      )
    );
  };

  const removeVehicle = (haulerKey, vehicleKey) => {
    setHaulers((prev) =>
      prev.map((h) =>
        h.key === haulerKey
          ? { ...h, vehicles: (h.vehicles || []).filter((v) => v.key !== vehicleKey) }
          : h
      )
    );
  };

  const updateVehicle = (haulerKey, vehicleKey, field, value) => {
    setHaulers((prev) =>
      prev.map((h) =>
        h.key === haulerKey
          ? {
              ...h,
              vehicles: (h.vehicles || []).map((v) =>
                v.key === vehicleKey ? { ...v, [field]: value } : v
              ),
            }
          : h
      )
    );
  };

  const columns = [
    {
      title: "SLF Facility",
      dataIndex: "slfName",
      key: "slfName",
      sorter: (a, b) => (a.slfName || "").localeCompare(b.slfName || ""),
      render: (v) => <Text strong>{v}</Text>,
    },
    {
      title: "Total Volume Accepted",
      key: "totalVolume",
      render: (_, r) => fmtVol(r.totalVolumeAccepted, r.totalVolumeAcceptedUnit),
      sorter: (a, b) => (a.totalVolumeAccepted || 0) - (b.totalVolumeAccepted || 0),
    },
    {
      title: "Active Cell (Residual)",
      key: "activeRes",
      render: (_, r) => fmtVol(r.activeCellResidualVolume, r.activeCellResidualUnit),
    },
    {
      title: "Active Cell (Inert)",
      key: "activeInert",
      render: (_, r) => fmtVol(r.activeCellInertVolume, r.activeCellInertUnit),
    },
    {
      title: "Active Cell (Hazardous)",
      key: "activeHaz",
      render: (_, r) => r.acceptsHazardousWaste ? fmtVol(r.activeCellHazardousVolume, r.activeCellHazardousUnit) : "—",
    },
    {
      title: "Closed Cell (Residual)",
      key: "closedRes",
      render: (_, r) => fmtVol(r.closedCellResidualVolume, r.closedCellResidualUnit),
    },
    {
      title: "Closed Cell (Inert)",
      key: "closedInert",
      render: (_, r) => fmtVol(r.closedCellInertVolume, r.closedCellInertUnit),
    },
    {
      title: "Closed Cell (Hazardous)",
      key: "closedHaz",
      render: (_, r) => r.acceptsHazardousWaste ? fmtVol(r.closedCellHazardousVolume, r.closedCellHazardousUnit) : "—",
    },
    {
      title: "Haulers",
      key: "haulers",
      render: (_, r) => (r.accreditedHaulers || []).length || "—",
      align: "center",
    },
    {
      title: "Trucks",
      key: "trucks",
      render: (_, r) => {
        const total = (r.accreditedHaulers || []).reduce((sum, h) => sum + (h.vehicles || []).length, 0);
        return total || "—";
      },
      align: "center",
    },
    {
      title: "Submitted By",
      dataIndex: "submittedBy",
      key: "submittedBy",
      render: (v) => v || "—",
    },
    {
      title: "Last Updated",
      dataIndex: "lastUpdated",
      key: "lastUpdated",
      sorter: (a, b) => new Date(a.lastUpdated) - new Date(b.lastUpdated),
      render: (v) => (v ? new Date(v).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }) : "—"),
    },
    {
      title: "Action",
      key: "action",
      align: "center",
      render: (_, r) => (
        <Space>
          <Tooltip title="View Details">
            <EyeOutlined
              style={{ fontSize: 16, cursor: "pointer", color: "#1677ff" }}
              onClick={() => { setSelectedRecord(r); setDetailOpen(true); }}
            />
          </Tooltip>
          {r.baselineUpdateRequested ? (
            <span style={{ display: "inline-flex", gap: 4 }}>
              <Tooltip title="Approve Baseline Update Request">
                <CheckCircleOutlined
                  style={{ fontSize: 16, cursor: "pointer", color: "#52c41a" }}
                  onClick={() => handleApproveBaselineUpdate(r.slfName)}
                />
              </Tooltip>
              <Tooltip title="Reject Baseline Update Request">
                <CloseCircleOutlined
                  style={{ fontSize: 16, cursor: "pointer", color: "#ff4d4f" }}
                  onClick={() => handleRejectBaselineUpdate(r.slfName)}
                />
              </Tooltip>
            </span>
          ) : r.baselineUpdateApproved ? (
            <Tooltip title="Lock Baseline (re-lock after update)">
              <LockOutlined
                style={{ fontSize: 16, cursor: "pointer", color: "#fa8c16" }}
                onClick={() => handleLockBaseline(r.slfName)}
              />
            </Tooltip>
          ) : null}
          {canEdit && (
            <Tooltip title="Edit Baseline">
              <EditOutlined
                style={{ fontSize: 16, cursor: "pointer", color: "#722ed1" }}
                onClick={() => openEdit(r)}
              />
            </Tooltip>
          )}
          {canDelete && (
            <Popconfirm title="Delete this baseline record?" onConfirm={() => handleDelete(r._id)}>
              <Tooltip title="Delete Baseline">
                <DeleteOutlined
                  style={{ fontSize: 16, cursor: "pointer", color: "#ff4d4f" }}
                />
              </Tooltip>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const VolumeRow = ({ label, nameVal, nameUnit }) => (
    <Row gutter={8} style={{ marginBottom: 0 }}>
      <Col span={16}>
        <Form.Item name={nameVal} label={label}>
          <InputNumber style={{ width: "100%" }} min={0} />
        </Form.Item>
      </Col>
      <Col span={8}>
        <Form.Item name={nameUnit} label="Unit">
          <Select>
            {UNIT_OPTIONS.map((u) => (
              <Select.Option key={u} value={u}>{u}</Select.Option>
            ))}
          </Select>
        </Form.Item>
      </Col>
    </Row>
  );

  return (
    <Spin spinning={loading}>
      <Card
        style={{ borderRadius: 10 }}
        title={
          <Space>
            <DatabaseOutlined style={{ color: "#722ed1" }} />
            <Text strong>Company Baseline Data</Text>
            <Badge count={baselines.length} style={{ backgroundColor: "#722ed1" }} />
          </Space>
        }
        extra={
          <Tooltip title="Refresh">
            <Button type="text" icon={<ReloadOutlined spin={loading} />} onClick={fetchBaselines} />
          </Tooltip>
        }
      >
        {baselines.length === 0 && !loading ? (
          <Empty description="No baseline data available yet." image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Table
            dataSource={baselines}
            columns={columns}
            rowKey="_id"
            size="small"
            pagination={{ pageSize: 15, showSizeChanger: true, showTotal: (t) => `${t} records` }}
            scroll={{ x: 1200 }}
          />
        )}
      </Card>

      {/* View Detail Modal */}
      <Modal
        title={
          <Space>
            <DatabaseOutlined style={{ color: "#722ed1" }} />
            <span>Baseline Details — {selectedRecord?.slfName}</span>
          </Space>
        }
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={700}
      >
        {selectedRecord && (
          <>
            <Descriptions bordered size="small" column={2} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="SLF Facility" span={2}>
                <Text strong>{selectedRecord.slfName}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Total Volume Accepted">
                {fmtVol(selectedRecord.totalVolumeAccepted, selectedRecord.totalVolumeAcceptedUnit)}
              </Descriptions.Item>
              <Descriptions.Item label="Submitted By">
                {selectedRecord.submittedBy || "—"}
              </Descriptions.Item>
              <Descriptions.Item label="Active Cell — Residual">
                {fmtVol(selectedRecord.activeCellResidualVolume, selectedRecord.activeCellResidualUnit)}
              </Descriptions.Item>
              <Descriptions.Item label="Active Cell — Inert">
                {fmtVol(selectedRecord.activeCellInertVolume, selectedRecord.activeCellInertUnit)}
              </Descriptions.Item>
              <Descriptions.Item label="Closed Cell — Residual">
                {fmtVol(selectedRecord.closedCellResidualVolume, selectedRecord.closedCellResidualUnit)}
              </Descriptions.Item>
              <Descriptions.Item label="Closed Cell — Inert">
                {fmtVol(selectedRecord.closedCellInertVolume, selectedRecord.closedCellInertUnit)}
              </Descriptions.Item>
              <Descriptions.Item label="Last Updated" span={2}>
                {selectedRecord.lastUpdated
                  ? new Date(selectedRecord.lastUpdated).toLocaleString("en-PH", {
                      year: "numeric", month: "long", day: "numeric",
                      hour: "2-digit", minute: "2-digit",
                    })
                  : "—"}
              </Descriptions.Item>
            </Descriptions>

            <Title level={5} style={{ marginTop: 8 }}>
              Accredited Haulers ({(selectedRecord.accreditedHaulers || []).length})
            </Title>
            {(selectedRecord.accreditedHaulers || []).length === 0 ? (
              <Empty description="No accredited haulers" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <Table
                dataSource={selectedRecord.accreditedHaulers}
                rowKey={(r, i) => `${r.haulerName}-${i}`}
                size="small"
                pagination={false}
                columns={[
                  { title: "Hauler Name", dataIndex: "haulerName", key: "haulerName" },
                  { title: "# of Trucks", dataIndex: "numberOfTrucks", key: "trucks", align: "center", render: (v) => v ?? "—" },
                  { title: "Office Address", dataIndex: "officeAddress", key: "address", render: (v) => v || "—" },
                  {
                    title: "Vehicles",
                    key: "vehicles",
                    render: (_, h) => {
                      const vehicles = h.vehicles || [];
                      if (vehicles.length === 0) {
                        return h.plateNumber ? `${h.plateNumber} (${h.vehicleType || "N/A"})` : "—";
                      }
                      return vehicles.map((v, i) => (
                        <Tag key={i} bordered={false}>
                          {v.plateNumber} — {v.vehicleType || "N/A"} ({v.capacity} {v.capacityUnit || "m³"})
                        </Tag>
                      ));
                    },
                  },
                  {
                    title: "Private Clients",
                    key: "clients",
                    render: (_, h) => {
                      const clients = h.privateSectorClients || [];
                      return clients.length > 0 ? clients.join(", ") : "—";
                    },
                  },
                ]}
              />
            )}
          </>
        )}
      </Modal>

      {/* Edit Baseline Modal */}
      <Modal
        title={
          <Space>
            <EditOutlined style={{ color: "#722ed1" }} />
            <span>Edit Baseline — {editRecord?.slfName}</span>
          </Space>
        }
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={handleSave}
        okText="Save"
        okButtonProps={{ icon: <SaveOutlined />, loading: saving }}
        width={720}
        destroyOnClose
      >
        <Form form={form} layout="vertical" size="small" style={{ marginTop: 12 }}>
          <VolumeRow label="Total Volume Accepted" nameVal="totalVolumeAccepted" nameUnit="totalVolumeAcceptedUnit" />
          <Divider plain style={{ margin: "8px 0" }}>Active Cell</Divider>
          <VolumeRow label="Residual Volume" nameVal="activeCellResidualVolume" nameUnit="activeCellResidualUnit" />
          <VolumeRow label="Inert Volume" nameVal="activeCellInertVolume" nameUnit="activeCellInertUnit" />
          <Divider plain style={{ margin: "8px 0" }}>Closed Cell</Divider>
          <VolumeRow label="Residual Volume" nameVal="closedCellResidualVolume" nameUnit="closedCellResidualUnit" />
          <VolumeRow label="Inert Volume" nameVal="closedCellInertVolume" nameUnit="closedCellInertUnit" />
        </Form>

        <Divider plain style={{ margin: "12px 0" }}>
          Accredited Haulers ({haulers.length})
        </Divider>
        {haulers.map((h, idx) => (
          <div key={h.key} style={{ marginBottom: 10, padding: "8px 10px", background: isDark ? "#1f1f1f" : "#fafafa", borderRadius: 8 }}>
            <Row gutter={8} align="middle" style={{ marginBottom: 6 }}>
              <Col span={8}>
                <Input
                  size="small"
                  placeholder="Hauler name"
                  value={h.haulerName}
                  onChange={(e) => updateHauler(h.key, "haulerName", e.target.value)}
                />
              </Col>
              <Col span={4}>
                <InputNumber
                  size="small"
                  min={0}
                  placeholder="Trucks"
                  value={h.numberOfTrucks}
                  onChange={(v) => updateHauler(h.key, "numberOfTrucks", v)}
                  style={{ width: "100%" }}
                />
              </Col>
              <Col span={9}>
                <Input
                  size="small"
                  placeholder="Office address"
                  value={h.officeAddress}
                  onChange={(e) => updateHauler(h.key, "officeAddress", e.target.value)}
                />
              </Col>
              <Col span={3} style={{ textAlign: "right" }}>
                <Space size={4}>
                  <Tooltip title="Add Truck">
                    <Button size="small" type="text" icon={<PlusOutlined />} onClick={() => { addVehicle(h.key); setExpandedHaulers((prev) => ({ ...prev, [h.key]: true })); }} />
                  </Tooltip>
                  <Popconfirm title="Remove hauler?" onConfirm={() => removeHauler(h.key)}>
                    <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              </Col>
            </Row>
            {(h.vehicles || []).length > 0 && (
              <div style={{ marginLeft: 16, marginTop: 4 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>Trucks / Vehicles ({h.vehicles.length})</Text>
                {h.vehicles.map((v) => (
                  <Row key={v.key} gutter={6} align="middle" style={{ marginTop: 4 }}>
                    <Col span={6}>
                      <Input size="small" placeholder="Plate No." value={v.plateNumber} onChange={(e) => updateVehicle(h.key, v.key, "plateNumber", e.target.value)} />
                    </Col>
                    <Col span={6}>
                      <Input size="small" placeholder="Vehicle type" value={v.vehicleType} onChange={(e) => updateVehicle(h.key, v.key, "vehicleType", e.target.value)} />
                    </Col>
                    <Col span={5}>
                      <InputNumber size="small" min={0} placeholder="Capacity" value={v.capacity} onChange={(val) => updateVehicle(h.key, v.key, "capacity", val)} style={{ width: "100%" }} />
                    </Col>
                    <Col span={4}>
                      <Select size="small" value={v.capacityUnit} onChange={(val) => updateVehicle(h.key, v.key, "capacityUnit", val)} style={{ width: "100%" }}>
                        {UNIT_OPTIONS.map((u) => <Select.Option key={u} value={u}>{u}</Select.Option>)}
                      </Select>
                    </Col>
                    <Col span={3} style={{ textAlign: "right" }}>
                      <Popconfirm title="Remove truck?" onConfirm={() => removeVehicle(h.key, v.key)}>
                        <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    </Col>
                  </Row>
                ))}
              </div>
            )}
          </div>
        ))}
        <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={addHauler} style={{ marginTop: 4 }}>
          Add Hauler
        </Button>
      </Modal>
    </Spin>
  );
}
