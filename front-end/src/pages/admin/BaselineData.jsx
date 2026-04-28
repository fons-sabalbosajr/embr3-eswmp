import { useState, useEffect } from "react";
import {
  Table,
  Tag,
  Typography,
  Space,
  Spin,
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
  Collapse,
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
  LockOutlined,
  ReloadOutlined,
  AppstoreOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import Swal from "sweetalert2";
import api from "../../api";
import dayjs from "dayjs";

const { Text } = Typography;
const UNIT_OPTIONS = ["m³", "tons"];
const WASTE_TYPES = ["Residual", "Inert", "Hazardous"];
const WASTE_TAG_COLOR = { Residual: "blue", Inert: "green", Hazardous: "red" };
const PURPLE = "#722ed1";
const GREEN = "#52c41a";
const ORANGE = "#fa8c16";
const BLUE = "#1677ff";

function StatCard({ label, value, color, bg, border }) {
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 8, padding: "10px 14px", height: "100%" }}>
      <Text type="secondary" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, display: "block", marginBottom: 3 }}>
        {label}
      </Text>
      <Text strong style={{ fontSize: 14, color }}>{value}</Text>
    </div>
  );
}

function CellEntriesTable({ entries }) {
  if (!entries?.length)
    return <Empty description="No cell entries" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ margin: "8px 0" }} />;
  return (
    <Table
      dataSource={entries}
      rowKey={(_, i) => i}
      size="small"
      pagination={false}
      columns={[
        { title: "#", key: "i", width: 40, render: (_, __, i) => <Text type="secondary">{i + 1}</Text> },
        { title: "Cell Name", dataIndex: "cellName", render: (v) => <Text strong>{v || "—"}</Text> },
        {
          title: "Waste Type",
          dataIndex: "wasteType",
          render: (v) => v ? <Tag color={WASTE_TAG_COLOR[v] || "default"} variant="filled">{v}</Tag> : "—",
        },
        {
          title: "Volume",
          dataIndex: "volume",
          align: "right",
          render: (v) => v != null ? <Text strong>{Number(v).toLocaleString()}</Text> : "—",
        },
      ]}
    />
  );
}

function CellEntriesEditor({ cells, onChange }) {
  const add = () =>
    onChange([...cells, { key: `c_${Date.now()}`, cellName: "", wasteType: "", volume: 0 }]);
  const remove = (key) => onChange(cells.filter((c) => c.key !== key));
  const update = (key, field, value) =>
    onChange(cells.map((c) => (c.key === key ? { ...c, [field]: value } : c)));

  return (
    <div>
      {cells.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <Row gutter={6} style={{ marginBottom: 4 }}>
            <Col span={9}><Text type="secondary" style={{ fontSize: 11 }}>Cell Name</Text></Col>
            <Col span={8}><Text type="secondary" style={{ fontSize: 11 }}>Waste Type</Text></Col>
            <Col span={5}><Text type="secondary" style={{ fontSize: 11 }}>Volume</Text></Col>
            <Col span={2} />
          </Row>
          {cells.map((c) => (
            <Row key={c.key} gutter={6} align="middle" style={{ marginBottom: 6 }}>
              <Col span={9}>
                <Input size="small" placeholder="e.g. Cell 1" value={c.cellName}
                  onChange={(e) => update(c.key, "cellName", e.target.value)} />
              </Col>
              <Col span={8}>
                <Select size="small" style={{ width: "100%" }} value={c.wasteType || undefined}
                  placeholder="Waste type" onChange={(v) => update(c.key, "wasteType", v)}>
                  {WASTE_TYPES.map((t) => <Select.Option key={t} value={t}>{t}</Select.Option>)}
                </Select>
              </Col>
              <Col span={5}>
                <InputNumber size="small" min={0} style={{ width: "100%" }} value={c.volume}
                  onChange={(v) => update(c.key, "volume", v)} />
              </Col>
              <Col span={2} style={{ textAlign: "right" }}>
                <Popconfirm title="Remove this entry?" onConfirm={() => remove(c.key)}>
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Col>
            </Row>
          ))}
        </div>
      )}
      <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={add}>Add Cell Entry</Button>
    </div>
  );
}

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
  const [activeCells, setActiveCells] = useState([]);
  const [closedCells, setClosedCells] = useState([]);

  useEffect(() => { fetchBaselines(); }, []);

  const fetchBaselines = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/data-slf/baselines");
      setBaselines(data);
    } catch { /* silent */ }
    finally { setLoading(false); }
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
    setActiveCells(
      (record.activeCellEntries || []).map((c, i) => ({
        key: `ac_${i}`,
        cellName: c.cellName || "",
        wasteType: c.wasteType || "",
        volume: c.volume ?? 0,
      }))
    );
    setClosedCells(
      (record.closedCellEntries || []).map((c, i) => ({
        key: `cc_${i}`,
        cellName: c.cellName || "",
        wasteType: c.wasteType || "",
        volume: c.volume ?? 0,
      }))
    );
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
        activeCellEntries: activeCells.map(({ key, ...c }) => c),
        closedCellEntries: closedCells.map(({ key, ...c }) => c),
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

  // ── Table columns ──
  const tableColumns = [
    {
      title: "SLF Name",
      dataIndex: "slfName",
      key: "slfName",
      render: (v, r) => (
        <div>
          <Text strong style={{ fontSize: 13 }}>{v}</Text>
          <Text type="secondary" style={{ fontSize: 11, display: "block" }}>
            {r.submittedBy ? `By ${r.submittedBy}` : "No submitter"}
          </Text>
        </div>
      ),
    },
    {
      title: "Last Updated",
      dataIndex: "lastUpdated",
      key: "lastUpdated",
      width: 120,
      render: (v) => v ? dayjs(v).format("MMM D, YYYY") : "—",
    },
    {
      title: "Total Volume",
      key: "volume",
      width: 130,
      render: (_, r) => <Text strong>{fmtVol(r.totalVolumeAccepted, r.totalVolumeAcceptedUnit)}</Text>,
    },
    {
      title: "Active Cells",
      key: "active",
      width: 110,
      render: (_, r) => {
        const has = (r.activeCellEntries || []).length > 0;
        return <Tag color="green">{has ? `${r.activeCellEntries.length} cell(s)` : fmtVol(r.activeCellResidualVolume, r.activeCellResidualUnit)}</Tag>;
      },
    },
    {
      title: "Closed Cells",
      key: "closed",
      width: 110,
      render: (_, r) => {
        const has = (r.closedCellEntries || []).length > 0;
        return <Tag color="orange">{has ? `${r.closedCellEntries.length} cell(s)` : fmtVol(r.closedCellResidualVolume, r.closedCellResidualUnit)}</Tag>;
      },
    },
    {
      title: "Status",
      key: "status",
      width: 160,
      render: (_, r) => (
        <Space size={4} wrap>
          {r.baselineUpdateRequested && <Tag color="processing" style={{ fontSize: 11 }}>Update Requested</Tag>}
          {r.baselineUpdateApproved && <Tag color="success" style={{ fontSize: 11 }}>Edit Unlocked</Tag>}
          {!r.baselineUpdateRequested && !r.baselineUpdateApproved && <Tag color="default" style={{ fontSize: 11 }}>Locked</Tag>}
        </Space>
      ),
    },
    {
      title: "Actions",
      key: "actions",
      width: 180,
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title="View Details">
            <Button size="small" type="text" icon={<EyeOutlined />} style={{ color: BLUE }}
              onClick={() => { setSelectedRecord(r); setDetailOpen(true); }} />
          </Tooltip>
          {r.baselineUpdateRequested && (
            <>
              <Tooltip title="Approve Update Request">
                <Button size="small" type="text" icon={<CheckCircleOutlined />} style={{ color: GREEN }}
                  onClick={() => handleApproveBaselineUpdate(r.slfName)} />
              </Tooltip>
              <Tooltip title="Reject Update Request">
                <Button size="small" type="text" danger icon={<CloseCircleOutlined />}
                  onClick={() => handleRejectBaselineUpdate(r.slfName)} />
              </Tooltip>
            </>
          )}
          {r.baselineUpdateApproved && (
            <Tooltip title="Re-lock Baseline">
              <Button size="small" type="text" icon={<LockOutlined />} style={{ color: ORANGE }}
                onClick={() => handleLockBaseline(r.slfName)} />
            </Tooltip>
          )}
          {canEdit && (
            <Tooltip title="Edit Baseline">
              <Button size="small" type="text" icon={<EditOutlined />} style={{ color: PURPLE }}
                onClick={() => openEdit(r)} />
            </Tooltip>
          )}
          {canDelete && (
            <Popconfirm title="Delete this baseline record?" onConfirm={() => handleDelete(r._id)}>
              <Tooltip title="Delete Baseline">
                <Button size="small" type="text" danger icon={<DeleteOutlined />} />
              </Tooltip>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const expandedRowRender = (r) => {
    const hasActiveCells = (r.activeCellEntries || []).length > 0;
    const hasClosedCells = (r.closedCellEntries || []).length > 0;
    return (
      <div style={{ padding: "8px 0" }}>
        <Row gutter={8} style={{ marginBottom: 12 }}>
          <Col xs={24} sm={8} style={{ marginBottom: 8 }}>
            <StatCard label="Total Volume Accepted" value={fmtVol(r.totalVolumeAccepted, r.totalVolumeAcceptedUnit)}
              color={BLUE} bg={isDark ? "rgba(22,119,255,0.08)" : "#f0f5ff"} border={isDark ? "rgba(22,119,255,0.2)" : "#d6e4ff"} />
          </Col>
          <Col xs={24} sm={8} style={{ marginBottom: 8 }}>
            <StatCard
              label="Active Cell Entries"
              value={hasActiveCells ? `${r.activeCellEntries.length} cell(s)` : fmtVol(r.activeCellResidualVolume, r.activeCellResidualUnit)}
              color={GREEN} bg={isDark ? "rgba(82,196,26,0.08)" : "#f6ffed"} border={isDark ? "rgba(82,196,26,0.2)" : "#d9f7be"} />
          </Col>
          <Col xs={24} sm={8} style={{ marginBottom: 8 }}>
            <StatCard
              label="Closed Cell Entries"
              value={hasClosedCells ? `${r.closedCellEntries.length} cell(s)` : fmtVol(r.closedCellResidualVolume, r.closedCellResidualUnit)}
              color={ORANGE} bg={isDark ? "rgba(250,140,22,0.08)" : "#fff7e6"} border={isDark ? "rgba(250,140,22,0.2)" : "#ffe7ba"} />
          </Col>
        </Row>
        {hasActiveCells && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <div style={{ width: 3, height: 14, background: GREEN, borderRadius: 2 }} />
              <Text strong style={{ fontSize: 12, color: GREEN }}>Active Cell Entries ({r.activeCellEntries.length})</Text>
            </div>
            <CellEntriesTable entries={r.activeCellEntries} />
          </div>
        )}
        {hasClosedCells && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <div style={{ width: 3, height: 14, background: ORANGE, borderRadius: 2 }} />
              <Text strong style={{ fontSize: 12, color: ORANGE }}>Closed Cell Entries ({r.closedCellEntries.length})</Text>
            </div>
            <CellEntriesTable entries={r.closedCellEntries} />
          </div>
        )}
        {!hasActiveCells && !hasClosedCells && (
          <Row gutter={8} style={{ marginBottom: 14 }}>
            {[
              ["Active (Residual)", r.activeCellResidualVolume, r.activeCellResidualUnit, GREEN],
              ["Active (Inert)", r.activeCellInertVolume, r.activeCellInertUnit, "#13c2c2"],
              ["Closed (Residual)", r.closedCellResidualVolume, r.closedCellResidualUnit, ORANGE],
              ["Closed (Inert)", r.closedCellInertVolume, r.closedCellInertUnit, PURPLE],
            ].map(([label, val, unit, color]) => (
              <Col key={label} xs={12} sm={6} style={{ marginBottom: 8 }}>
                <Text type="secondary" style={{ fontSize: 11, display: "block" }}>{label}</Text>
                <Text strong style={{ color }}>{fmtVol(val, unit)}</Text>
              </Col>
            ))}
          </Row>
        )}
        {(r.accreditedHaulers || []).length > 0 && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <div style={{ width: 3, height: 14, background: PURPLE, borderRadius: 2 }} />
              <Text strong style={{ fontSize: 12, color: PURPLE }}>Accredited Haulers ({r.accreditedHaulers.length})</Text>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {r.accreditedHaulers.map((h, i) => (
                <Tag key={i} color="purple" variant="filled">
                  {h.haulerName} · {(h.vehicles || []).length || h.numberOfTrucks || 0} trucks
                </Tag>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

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
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Space align="center">
          <DatabaseOutlined style={{ color: PURPLE, fontSize: 16 }} />
          <Text strong style={{ fontSize: 15 }}>Company Baseline Data</Text>
          <Badge count={baselines.length} style={{ backgroundColor: PURPLE }} />
        </Space>
        <Button type="text" size="small" icon={<ReloadOutlined spin={loading} />} onClick={fetchBaselines}>
          Refresh
        </Button>
      </div>

      {baselines.length === 0 && !loading ? (
        <Empty description="No baseline data available yet." image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Table
          dataSource={baselines}
          rowKey="_id"
          columns={tableColumns}
          size="small"
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `${t} records` }}
          scroll={{ x: 900 }}
          expandable={{
            expandedRowRender,
            rowExpandable: () => true,
          }}
        />
      )}

      {/* ── View Details Modal ── */}
      <Modal
        title={null}
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={<Button onClick={() => setDetailOpen(false)}>Close</Button>}
        width={720}
        styles={{ body: { padding: 0 } }}
        destroyOnHidden
      >
        {selectedRecord && (() => {
          const r = selectedRecord;
          const hasAC = (r.activeCellEntries || []).length > 0;
          const hasCC = (r.closedCellEntries || []).length > 0;
          return (
            <div>
              <div style={{ background: `linear-gradient(135deg, ${PURPLE} 0%, #531dab 100%)`, padding: "20px 24px 16px", borderRadius: "8px 8px 0 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>Baseline Data</Text>
                    <div style={{ marginTop: 2 }}>
                      <Text style={{ color: "#fff", fontSize: 20, fontWeight: 700 }}>{r.slfName}</Text>
                    </div>
                    <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 12 }}>Submitted by: {r.submittedBy || "—"}</Text>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    {r.baselineUpdateRequested && <Tag color="processing" style={{ marginBottom: 4, display: "block" }}>Update Requested</Tag>}
                    {r.baselineUpdateApproved && <Tag color="success" style={{ display: "block" }}>Edit Unlocked</Tag>}
                    <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, display: "block", marginTop: 4 }}>
                      {r.lastUpdated ? dayjs(r.lastUpdated).format("MMM D, YYYY") : "—"}
                    </Text>
                  </div>
                </div>
              </div>
              <div style={{ padding: "20px 24px" }}>
                <Row gutter={8} style={{ marginBottom: 20 }}>
                  <Col xs={8}>
                    <StatCard label="Total Vol. Accepted" value={fmtVol(r.totalVolumeAccepted, r.totalVolumeAcceptedUnit)}
                      color={PURPLE} bg={isDark ? "rgba(114,46,209,0.1)" : "#f9f0ff"} border={isDark ? "rgba(114,46,209,0.25)" : "#d3adf7"} />
                  </Col>
                  <Col xs={8}>
                    <StatCard label="Active Cells"
                      value={hasAC ? `${r.activeCellEntries.length} entr${r.activeCellEntries.length === 1 ? "y" : "ies"}` : fmtVol(r.activeCellResidualVolume, r.activeCellResidualUnit)}
                      color={GREEN} bg={isDark ? "rgba(82,196,26,0.1)" : "#f6ffed"} border={isDark ? "rgba(82,196,26,0.25)" : "#d9f7be"} />
                  </Col>
                  <Col xs={8}>
                    <StatCard label="Closed Cells"
                      value={hasCC ? `${r.closedCellEntries.length} entr${r.closedCellEntries.length === 1 ? "y" : "ies"}` : fmtVol(r.closedCellResidualVolume, r.closedCellResidualUnit)}
                      color={ORANGE} bg={isDark ? "rgba(250,140,22,0.1)" : "#fff7e6"} border={isDark ? "rgba(250,140,22,0.25)" : "#ffe7ba"} />
                  </Col>
                </Row>
                <Collapse
                  defaultActiveKey={["active", "closed", "haulers"]}
                  bordered={false} size="small" style={{ background: "transparent" }}
                  items={[
                    {
                      key: "active",
                      label: <Text strong style={{ fontSize: 13 }}><AppstoreOutlined style={{ color: GREEN, marginRight: 6 }} />Active Cell Entries ({hasAC ? r.activeCellEntries.length : "legacy"})</Text>,
                      children: hasAC ? <CellEntriesTable entries={r.activeCellEntries} /> : (
                        <Row gutter={8}>
                          {[["Residual", r.activeCellResidualVolume, r.activeCellResidualUnit, "blue"], ["Inert", r.activeCellInertVolume, r.activeCellInertUnit, "green"], r.acceptsHazardousWaste && ["Hazardous", r.activeCellHazardousVolume, r.activeCellHazardousUnit, "red"]].filter(Boolean).map(([type, val, unit, color]) => (
                            <Col key={type} xs={12} sm={8} style={{ marginBottom: 8 }}>
                              <Tag color={color} variant="filled" style={{ marginBottom: 4 }}>{type}</Tag>
                              <Text strong style={{ display: "block" }}>{fmtVol(val, unit)}</Text>
                            </Col>
                          ))}
                        </Row>
                      ),
                    },
                    {
                      key: "closed",
                      label: <Text strong style={{ fontSize: 13 }}><AppstoreOutlined style={{ color: ORANGE, marginRight: 6 }} />Closed Cell Entries ({hasCC ? r.closedCellEntries.length : "legacy"})</Text>,
                      children: hasCC ? <CellEntriesTable entries={r.closedCellEntries} /> : (
                        <Row gutter={8}>
                          {[["Residual", r.closedCellResidualVolume, r.closedCellResidualUnit, "orange"], ["Inert", r.closedCellInertVolume, r.closedCellInertUnit, "volcano"], r.acceptsHazardousWaste && ["Hazardous", r.closedCellHazardousVolume, r.closedCellHazardousUnit, "red"]].filter(Boolean).map(([type, val, unit, color]) => (
                            <Col key={type} xs={12} sm={8} style={{ marginBottom: 8 }}>
                              <Tag color={color} variant="filled" style={{ marginBottom: 4 }}>{type}</Tag>
                              <Text strong style={{ display: "block" }}>{fmtVol(val, unit)}</Text>
                            </Col>
                          ))}
                        </Row>
                      ),
                    },
                    {
                      key: "haulers",
                      label: <Text strong style={{ fontSize: 13 }}><TeamOutlined style={{ color: PURPLE, marginRight: 6 }} />Accredited Haulers ({(r.accreditedHaulers || []).length})</Text>,
                      children: (r.accreditedHaulers || []).length === 0 ? (
                        <Empty description="No accredited haulers" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                      ) : (
                        <Table
                          dataSource={r.accreditedHaulers}
                          rowKey={(h, i) => `${h.haulerName}-${i}`}
                          size="small" pagination={false}
                          expandable={{
                            expandedRowRender: (h) => {
                              const vehicles = h.vehicles?.length > 0 ? h.vehicles
                                : (h.plateNumber || h.vehicleType) ? [{ plateNumber: h.plateNumber, vehicleType: h.vehicleType, capacity: h.capacity, capacityUnit: h.capacityUnit }]
                                : [];
                              return vehicles.length > 0 ? (
                                <Table dataSource={vehicles} rowKey={(_, vi) => vi} size="small" pagination={false}
                                  columns={[
                                    { title: "#", key: "i", width: 40, render: (_, __, vi) => vi + 1 },
                                    { title: "Plate No.", dataIndex: "plateNumber", render: (v) => v || "—" },
                                    { title: "Vehicle Type", dataIndex: "vehicleType", render: (v) => v || "—" },
                                    { title: "Capacity", key: "cap", render: (_, v) => v.capacity != null ? `${v.capacity} ${(v.capacityUnit || "m³").replace("m3", "m³")}` : "—" },
                                  ]} />
                              ) : <Text type="secondary">No vehicle details</Text>;
                            },
                            rowExpandable: () => true,
                          }}
                          columns={[
                            { title: "Hauler Name", dataIndex: "haulerName", render: (v) => <Text strong>{v || "—"}</Text> },
                            { title: "No. of Trucks", dataIndex: "numberOfTrucks", width: 110, align: "center", render: (v) => v ?? "—" },
                            { title: "Office Address", dataIndex: "officeAddress", render: (v) => v || "—" },
                            { title: "Private Clients", key: "clients", render: (_, h) => { const c = h.privateSectorClients || []; return c.length > 0 ? c.map(x => typeof x === "string" ? x : x.clientName || "—").join(", ") : "—"; } },
                          ]}
                        />
                      ),
                    },
                  ]}
                />
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* ── Edit Baseline Modal ── */}
      <Modal
        title={<Space><EditOutlined style={{ color: PURPLE }} /><span>Edit Baseline — {editRecord?.slfName}</span></Space>}
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={handleSave}
        okText="Save"
        okButtonProps={{ icon: <SaveOutlined />, loading: saving }}
        width={760}
        forceRender
        destroyOnHidden
      >
        <Form form={form} layout="vertical" size="small" style={{ marginTop: 8 }}>
          <Collapse
            defaultActiveKey={["volume", "active", "closed", "haulers"]}
            bordered={false} size="small" style={{ background: "transparent" }}
            items={[
              {
                key: "volume",
                label: <Text strong><DatabaseOutlined style={{ color: PURPLE, marginRight: 6 }} />Total Volume</Text>,
                children: <VolumeRow label="Total Volume Accepted" nameVal="totalVolumeAccepted" nameUnit="totalVolumeAcceptedUnit" />,
              },
              {
                key: "active",
                label: <Text strong><span style={{ color: GREEN, marginRight: 6 }}>●</span>Active Cell Entries ({activeCells.length})</Text>,
                children: <CellEntriesEditor cells={activeCells} onChange={setActiveCells} />,
              },
              {
                key: "closed",
                label: <Text strong><span style={{ color: ORANGE, marginRight: 6 }}>●</span>Closed Cell Entries ({closedCells.length})</Text>,
                children: <CellEntriesEditor cells={closedCells} onChange={setClosedCells} />,
              },
              {
                key: "legacy",
                label: <Text strong style={{ fontSize: 12, color: isDark ? "#8c8c8c" : "#595959" }}>Legacy Volume Fields (optional fallback)</Text>,
                children: (
                  <div>
                    <Divider plain style={{ margin: "4px 0 8px", fontSize: 12 }}>Active Cell</Divider>
                    <VolumeRow label="Residual Volume" nameVal="activeCellResidualVolume" nameUnit="activeCellResidualUnit" />
                    <VolumeRow label="Inert Volume" nameVal="activeCellInertVolume" nameUnit="activeCellInertUnit" />
                    <Divider plain style={{ margin: "4px 0 8px", fontSize: 12 }}>Closed Cell</Divider>
                    <VolumeRow label="Residual Volume" nameVal="closedCellResidualVolume" nameUnit="closedCellResidualUnit" />
                    <VolumeRow label="Inert Volume" nameVal="closedCellInertVolume" nameUnit="closedCellInertUnit" />
                  </div>
                ),
              },
              {
                key: "haulers",
                label: <Text strong><TeamOutlined style={{ color: PURPLE, marginRight: 6 }} />Accredited Haulers ({haulers.length})</Text>,
                children: (
                  <div>
                    {haulers.map((h, idx) => (
                      <div key={h.key} style={{ marginBottom: 10, padding: "10px 12px", background: isDark ? "#1f1f1f" : "#fafafa", borderRadius: 8, border: isDark ? "1px solid #303030" : "1px solid #f0f0f0" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                          <Text strong style={{ fontSize: 12 }}>Hauler #{idx + 1}</Text>
                          <Space size={4}>
                            <Tooltip title="Add Truck">
                              <Button size="small" type="text" icon={<PlusOutlined />} onClick={() => addVehicle(h.key)} />
                            </Tooltip>
                            <Popconfirm title="Remove hauler?" onConfirm={() => removeHauler(h.key)}>
                              <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                            </Popconfirm>
                          </Space>
                        </div>
                        <Row gutter={8} style={{ marginBottom: 4 }}>
                          <Col span={10}>
                            <Text type="secondary" style={{ fontSize: 11, display: "block", marginBottom: 2 }}>Hauler Name</Text>
                            <Input size="small" placeholder="Hauler name" value={h.haulerName} onChange={(e) => updateHauler(h.key, "haulerName", e.target.value)} />
                          </Col>
                          <Col span={4}>
                            <Text type="secondary" style={{ fontSize: 11, display: "block", marginBottom: 2 }}>Trucks</Text>
                            <InputNumber size="small" min={0} value={h.numberOfTrucks} onChange={(v) => updateHauler(h.key, "numberOfTrucks", v)} style={{ width: "100%" }} />
                          </Col>
                          <Col span={10}>
                            <Text type="secondary" style={{ fontSize: 11, display: "block", marginBottom: 2 }}>Office Address</Text>
                            <Input size="small" placeholder="Office address" value={h.officeAddress} onChange={(e) => updateHauler(h.key, "officeAddress", e.target.value)} />
                          </Col>
                        </Row>
                        {(h.vehicles || []).length > 0 && (
                          <div style={{ marginTop: 8, paddingTop: 8, borderTop: isDark ? "1px solid #303030" : "1px solid #f0f0f0" }}>
                            <Text type="secondary" style={{ fontSize: 11, display: "block", marginBottom: 6 }}>Trucks / Vehicles ({h.vehicles.length})</Text>
                            {h.vehicles.map((v) => (
                              <Row key={v.key} gutter={6} align="middle" style={{ marginBottom: 6 }}>
                                <Col span={7}><Input size="small" placeholder="Plate No." value={v.plateNumber} onChange={(e) => updateVehicle(h.key, v.key, "plateNumber", e.target.value)} /></Col>
                                <Col span={6}><Input size="small" placeholder="Vehicle type" value={v.vehicleType} onChange={(e) => updateVehicle(h.key, v.key, "vehicleType", e.target.value)} /></Col>
                                <Col span={5}><InputNumber size="small" min={0} placeholder="Capacity" value={v.capacity} onChange={(val) => updateVehicle(h.key, v.key, "capacity", val)} style={{ width: "100%" }} /></Col>
                                <Col span={4}>
                                  <Select size="small" value={v.capacityUnit} onChange={(val) => updateVehicle(h.key, v.key, "capacityUnit", val)} style={{ width: "100%" }}>
                                    {UNIT_OPTIONS.map((u) => <Select.Option key={u} value={u}>{u}</Select.Option>)}
                                  </Select>
                                </Col>
                                <Col span={2} style={{ textAlign: "right" }}>
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
                  </div>
                ),
              },
            ]}
          />
        </Form>
      </Modal>
    </Spin>
  );
}

