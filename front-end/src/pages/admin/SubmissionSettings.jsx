import { useState, useEffect } from "react";
import {
  Table, Button, Tag, Space, Typography, Card, Select, Input,
  Modal, Popconfirm, Divider, Tabs, InputNumber, DatePicker, Row, Col,
  Form, Collapse, Tooltip,
} from "antd";
import {
  CheckOutlined, CloseOutlined, EyeOutlined, DeleteOutlined,
  SearchOutlined, DownloadOutlined, EditOutlined, FileTextOutlined,
  CarOutlined, EnvironmentOutlined, UserOutlined, CalendarOutlined,
  DatabaseOutlined, TeamOutlined, IdcardOutlined, InboxOutlined,
  BankOutlined, ReloadOutlined,
} from "@ant-design/icons";
import { exportToExcel } from "../../utils/exportExcel";
import Swal from "sweetalert2";
import api from "../../api";
import secureStorage from "../../utils/secureStorage";
import dayjs from "dayjs";

const { Title, Text } = Typography;
const { Option } = Select;
const ACCENT = "#2f54eb";
const CACHE_KEY = "submissions-cache";
const CACHE_TTL = 5 * 60 * 1000;

export default function SubmissionSettings() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [viewRecord, setViewRecord] = useState(null);
  const [editRecord, setEditRecord] = useState(null);
  const [editLoading, setEditLoading] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const [editForm] = Form.useForm();

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 8000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = async (skipCache = false) => {
    try {
      if (!skipCache) {
        const cached = secureStorage.getJSON(CACHE_KEY);
        if (cached && Date.now() - cached.ts < CACHE_TTL) {
          setData(cached.data);
          setLoading(false);
          return;
        }
      }
      const { data: result } = await api.get("/data-slf");
      setData(result);
      secureStorage.setJSON(CACHE_KEY, { data: result, ts: Date.now() });
    } catch {
      Swal.fire("Error", "Could not load submissions", "error");
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (id, status) => {
    try {
      const { data: updated } = await api.patch(`/data-slf/${id}/status`, {
        status,
      });
      setData((prev) => prev.map((d) => (d._id === id ? updated : d)));
      secureStorage.remove(CACHE_KEY);
      secureStorage.invalidateDashboard();
      Swal.fire({
        icon: "success",
        title: `Submission ${status}`,
        timer: 1000,
        showConfirmButton: false,
      });
    } catch {
      Swal.fire("Error", "Could not update status", "error");
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/data-slf/${id}`);
      setData((prev) => prev.filter((d) => d._id !== id));
      secureStorage.remove(CACHE_KEY);
      secureStorage.invalidateDashboard();
      Swal.fire({
        icon: "success",
        title: "Deleted",
        timer: 800,
        showConfirmButton: false,
      });
    } catch {
      Swal.fire("Error", "Could not delete submission", "error");
    }
  };

  const handleBulkAcknowledge = async () => {
    const pendingIds = selectedRowKeys.filter((id) => {
      const entry = data.find((d) => d._id === id);
      return entry?.status === "pending";
    });
    if (pendingIds.length === 0) {
      Swal.fire("Info", "No pending entries selected.", "info");
      return;
    }
    const confirmed = await Swal.fire({
      title: `Acknowledge ${pendingIds.length} entry(ies)?`,
      text: "This will send an acknowledgement email to the submitters.",
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Acknowledge All",
      confirmButtonColor: "#52c41a",
    });
    if (!confirmed.isConfirmed) return;
    try {
      const { data: result } = await api.patch("/data-slf/bulk-status", {
        ids: pendingIds,
        status: "acknowledged",
      });
      setData((prev) =>
        prev.map((d) => {
          const updated = result.data.find((u) => u._id === d._id);
          return updated || d;
        })
      );
      secureStorage.remove(CACHE_KEY);
      secureStorage.invalidateDashboard();
      setSelectedRowKeys([]);;
      Swal.fire({
        icon: "success",
        title: `${result.data.length} entries acknowledged`,
        timer: 1500,
        showConfirmButton: false,
      });
    } catch {
      Swal.fire("Error", "Could not acknowledge entries", "error");
    }
  };

  const openEdit = (record) => {
    setEditRecord(record);
    editForm.setFieldsValue({
      dateOfDisposal: record.dateOfDisposal ? dayjs(record.dateOfDisposal) : null,
      lguCompanyName: record.lguCompanyName,
      companyType: record.companyType,
      address: record.address,
      trucks: record.trucks || [],
    });
  };

  const handleEditSave = async () => {
    try {
      const values = await editForm.validateFields();
      setEditLoading(true);
      const payload = {
        ...values,
        dateOfDisposal: values.dateOfDisposal?.toISOString(),
      };
      const { data: updated } = await api.put(`/data-slf/${editRecord._id}`, payload);
      setData((prev) => prev.map((d) => (d._id === editRecord._id ? updated : d)));
      secureStorage.remove(CACHE_KEY);
      secureStorage.invalidateDashboard();
      setEditRecord(null);
      Swal.fire({ icon: "success", title: "Updated", text: "Submission updated successfully", timer: 1200, showConfirmButton: false });
    } catch (err) {
      if (err.response) Swal.fire("Error", err.response.data?.message || "Update failed", "error");
    } finally {
      setEditLoading(false);
    }
  };

  const filtered = data.filter((d) => {
    const matchSearch =
      d.idNo?.toLowerCase().includes(search.toLowerCase()) ||
      d.lguCompanyName?.toLowerCase().includes(search.toLowerCase()) ||
      d.submittedBy?.toLowerCase().includes(search.toLowerCase());
    const matchStatus =
      statusFilter === "all" || d.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const statusColors = { pending: "orange", acknowledged: "green", rejected: "red" };

  const columns = [
    {
      title: <><IdcardOutlined /> ID No.</>,
      dataIndex: "idNo",
      key: "idNo",
      width: 170,
      render: (text) => <Text strong style={{ fontSize: 12 }}>{text}</Text>,
    },
    {
      title: <><BankOutlined /> LGU/Company</>,
      dataIndex: "lguCompanyName",
      key: "lguCompanyName",
      ellipsis: true,
    },
    {
      title: "Type",
      dataIndex: "companyType",
      key: "companyType",
      width: 80,
      render: (v) => <Tag color={v === "LGU" ? "blue" : "purple"} bordered={false}>{v}</Tag>,
    },
    {
      title: <><CalendarOutlined /> Disposal Date</>,
      dataIndex: "dateOfDisposal",
      key: "dateOfDisposal",
      width: 130,
      render: (val) => (val ? dayjs(val).format("MMM DD, YYYY") : "—"),
    },
    {
      title: <><CarOutlined /> Trucks</>,
      key: "trucks",
      width: 70,
      render: (_, r) => r.trucks?.length || 0,
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 120,
      render: (val) => (
        <Tag color={statusColors[val] || "default"}>
          {val?.charAt(0).toUpperCase() + val?.slice(1)}
        </Tag>
      ),
    },
    {
      title: "Actions",
      key: "actions",
      width: 160,
      render: (_, r) => (
        <Space>
          <Tooltip title="View">
            <Button type="text" icon={<EyeOutlined />} onClick={() => setViewRecord(r)} size="small" />
          </Tooltip>
          {r.status === "pending" && (
            <>
              <Tooltip title="Edit">
                <Button type="text" icon={<EditOutlined />} style={{ color: ACCENT }} onClick={() => openEdit(r)} size="small" />
              </Tooltip>
              <Tooltip title="Acknowledge">
                <Button type="text" icon={<CheckOutlined />} style={{ color: "#52c41a" }} onClick={() => updateStatus(r._id, "acknowledged")} size="small" />
              </Tooltip>
              <Tooltip title="Reject">
                <Button type="text" icon={<CloseOutlined />} style={{ color: "#ff4d4f" }} onClick={() => updateStatus(r._id, "rejected")} size="small" />
              </Tooltip>
            </>
          )}
          <Popconfirm title="Delete this submission?" onConfirm={() => handleDelete(r._id)}>
            <Button type="text" danger icon={<DeleteOutlined />} size="small" />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div>
          <Title level={4} style={{ marginBottom: 4 }}><InboxOutlined /> Submission Management</Title>
          <Text type="secondary">View, edit, acknowledge, or reject client portal submissions</Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => fetchData(true)} loading={loading} size="small">Refresh</Button>
      </div>

      <Card style={{ marginTop: 16, borderRadius: 10 }}>
        <Space style={{ marginBottom: 16, flexWrap: "wrap" }}>
          <Button
            icon={<DownloadOutlined />}
            onClick={() => {
              const rows = filtered.map((d) => ({
                "ID No.": d.idNo,
                "LGU/Company": d.lguCompanyName,
                "Company Type": d.companyType,
                "Date of Disposal": d.dateOfDisposal ? dayjs(d.dateOfDisposal).format("YYYY-MM-DD") : "",
                Status: d.status,
                Trucks: d.trucks?.length || 0,
                "Submitted By": d.submittedBy || "",
                "Submitted At": d.createdAt ? dayjs(d.createdAt).format("YYYY-MM-DD HH:mm") : "",
              }));
              exportToExcel(rows, "Submissions");
            }}
          >
            Export Excel
          </Button>
          <Input
            placeholder="Search by ID, company, or email..."
            prefix={<SearchOutlined />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%", maxWidth: 300 }}
            allowClear
          />
          <Select value={statusFilter} onChange={setStatusFilter} style={{ width: "100%", maxWidth: 160 }}>
            <Option value="all">All Statuses</Option>
            <Option value="pending">Pending</Option>
            <Option value="acknowledged">Acknowledged</Option>
            <Option value="rejected">Rejected</Option>
          </Select>
          {selectedRowKeys.length > 0 && (
            <Button
              type="primary"
              icon={<CheckOutlined />}
              style={{ background: "#52c41a", borderColor: "#52c41a" }}
              onClick={handleBulkAcknowledge}
            >
              Acknowledge Selected ({selectedRowKeys.length})
            </Button>
          )}
        </Space>

        <Table
          dataSource={filtered}
          columns={columns}
          rowKey="_id"
          loading={loading}
          pagination={{ pageSize: 15 }}
          size="middle"
          scroll={{ x: 900 }}
          rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
        />
      </Card>

      {/* ── View Modal ── */}
      <Modal
        title={
          <Space>
            <FileTextOutlined style={{ color: ACCENT }} />
            <span>Submission — {viewRecord?.idNo || ""}</span>
            {viewRecord?.status && (
              <Tag color={statusColors[viewRecord.status]}>{viewRecord.status?.charAt(0).toUpperCase() + viewRecord.status?.slice(1)}</Tag>
            )}
          </Space>
        }
        open={!!viewRecord}
        onCancel={() => setViewRecord(null)}
        footer={
          viewRecord?.status === "pending" ? (
            <Space>
              <Button icon={<EditOutlined />} onClick={() => { setViewRecord(null); openEdit(viewRecord); }}>Edit</Button>
              <Button
                type="primary"
                icon={<CheckOutlined />}
                style={{ background: "#52c41a", borderColor: "#52c41a" }}
                onClick={() => { updateStatus(viewRecord._id, "acknowledged"); setViewRecord(null); }}
              >
                Acknowledge
              </Button>
              <Button
                danger
                icon={<CloseOutlined />}
                onClick={() => { updateStatus(viewRecord._id, "rejected"); setViewRecord(null); }}
              >
                Reject
              </Button>
            </Space>
          ) : (
            <Button onClick={() => setViewRecord(null)}>Close</Button>
          )
        }
        width={760}
        style={{ maxWidth: "95vw" }}
      >
        {viewRecord && (() => {
          const r = viewRecord;
          const totalVolume = (r.trucks || []).reduce((s, t) => s + (t.actualVolume || 0), 0);
          const fieldStyle = { display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f0f0f0" };
          const labelStyle = { color: "#8c8c8c", fontSize: 13 };
          const valueStyle = { fontWeight: 600, fontSize: 13, textAlign: "right" };
          return (
            <Tabs
              defaultActiveKey="general"
              size="small"
              items={[
                {
                  key: "general",
                  label: <><FileTextOutlined /> General Info</>,
                  children: (
                    <Collapse
                      defaultActiveKey={["submission", "company", "baseline"]}
                      bordered={false}
                      size="small"
                      items={[
                        {
                          key: "submission",
                          label: <Text strong><IdcardOutlined style={{ color: ACCENT, marginRight: 6 }} />Submission Details</Text>,
                          children: (
                            <div>
                              <div style={fieldStyle}><span style={labelStyle}><IdcardOutlined /> ID No.</span><span style={valueStyle}>{r.idNo}</span></div>
                              <div style={fieldStyle}><span style={labelStyle}>Status</span><Tag color={statusColors[r.status]} style={{ margin: 0 }}>{r.status?.charAt(0).toUpperCase() + r.status?.slice(1)}</Tag></div>
                              <div style={fieldStyle}><span style={labelStyle}><BankOutlined /> SLF Facility</span><span style={valueStyle}>{r.slfGenerator?.slfName || "—"}</span></div>
                              <div style={fieldStyle}><span style={labelStyle}><CalendarOutlined /> Date of Disposal</span><span style={valueStyle}>{r.dateOfDisposal ? dayjs(r.dateOfDisposal).format("MMM DD, YYYY") : "—"}</span></div>
                              <div style={fieldStyle}><span style={labelStyle}><UserOutlined /> Submitted By</span><span style={valueStyle}>{r.submittedBy || "—"}</span></div>
                              <div style={fieldStyle}><span style={labelStyle}><CalendarOutlined /> Submitted At</span><span style={valueStyle}>{r.createdAt ? dayjs(r.createdAt).format("MMM DD, YYYY hh:mm A") : "—"}</span></div>
                              {r.submissionId && <div style={fieldStyle}><span style={labelStyle}>Submission ID</span><span style={valueStyle}>{r.submissionId}</span></div>}
                            </div>
                          ),
                        },
                        {
                          key: "company",
                          label: <Text strong><TeamOutlined style={{ color: "#52c41a", marginRight: 6 }} />Company Information</Text>,
                          children: (
                            <div>
                              <div style={fieldStyle}><span style={labelStyle}><BankOutlined /> LGU/Company</span><span style={valueStyle}>{r.lguCompanyName}</span></div>
                              <div style={fieldStyle}><span style={labelStyle}>Company Type</span><Tag color={r.companyType === "LGU" ? "blue" : "purple"} bordered={false} style={{ margin: 0 }}>{r.companyType}</Tag></div>
                              <div style={fieldStyle}><span style={labelStyle}><EnvironmentOutlined /> Address</span><span style={valueStyle}>{r.address || "—"}</span></div>
                            </div>
                          ),
                        },
                        {
                          key: "baseline",
                          label: <Text strong><DatabaseOutlined style={{ color: "#722ed1", marginRight: 6 }} />Baseline Information</Text>,
                          children: (
                            <div>
                              <div style={fieldStyle}><span style={labelStyle}>Total Volume Accepted</span><span style={valueStyle}>{r.totalVolumeAccepted != null ? `${r.totalVolumeAccepted.toLocaleString()} ${r.totalVolumeAcceptedUnit || "m³"}` : "—"}</span></div>
                              <div style={fieldStyle}><span style={labelStyle}>Active Cell (Residual)</span><span style={valueStyle}>{r.activeCellResidualVolume != null ? `${r.activeCellResidualVolume.toLocaleString()} ${r.activeCellResidualUnit || "m³"}` : "—"}</span></div>
                              <div style={fieldStyle}><span style={labelStyle}>Active Cell (Inert)</span><span style={valueStyle}>{r.activeCellInertVolume != null ? `${r.activeCellInertVolume.toLocaleString()} ${r.activeCellInertUnit || "m³"}` : "—"}</span></div>
                              <div style={fieldStyle}><span style={labelStyle}>Closed Cell (Residual)</span><span style={valueStyle}>{r.closedCellResidualVolume != null ? `${r.closedCellResidualVolume.toLocaleString()} ${r.closedCellResidualUnit || "m³"}` : "—"}</span></div>
                              <div style={{ ...fieldStyle, borderBottom: "none" }}><span style={labelStyle}>Closed Cell (Inert)</span><span style={valueStyle}>{r.closedCellInertVolume != null ? `${r.closedCellInertVolume.toLocaleString()} ${r.closedCellInertUnit || "m³"}` : "—"}</span></div>
                              {r.accreditedHaulers?.length > 0 && (
                                <>
                                  <Divider titlePlacement="left" style={{ fontSize: 13, fontWeight: 600, margin: "12px 0 8px" }}>
                                    <TeamOutlined /> Accredited Haulers ({r.accreditedHaulers.length})
                                  </Divider>
                                  <Table
                                    dataSource={r.accreditedHaulers}
                                    rowKey={(_, i) => i}
                                    size="small"
                                    pagination={false}
                                    columns={[
                                      { title: "Hauler Name", dataIndex: "haulerName", key: "haulerName" },
                                      { title: "No. of Trucks", dataIndex: "numberOfTrucks", key: "numberOfTrucks", render: (v) => v ?? "—" },
                                      { title: "Private Sector Clients", dataIndex: "privateSectorClients", key: "privateSectorClients", render: (v) => v || "—" },
                                    ]}
                                  />
                                </>
                              )}
                            </div>
                          ),
                        },
                      ]}
                    />
                  ),
                },
                {
                  key: "trucks",
                  label: <><CarOutlined /> Trucks ({r.trucks?.length || 0})</>,
                  children: (
                    <>
                      {totalVolume > 0 && (
                        <div style={{ display: "flex", gap: 24, marginBottom: 12, padding: "10px 14px", background: "#f6ffed", borderRadius: 8, border: "1px solid #b7eb8f" }}>
                          <div><Text type="secondary" style={{ fontSize: 12 }}>Total Trucks</Text><div><Text strong style={{ fontSize: 18 }}>{r.trucks?.length || 0}</Text></div></div>
                          <div><Text type="secondary" style={{ fontSize: 12 }}>Total Volume</Text><div><Text strong style={{ fontSize: 18, color: "#52c41a" }}>{totalVolume.toLocaleString()}</Text> <Text type="secondary">tons</Text></div></div>
                        </div>
                      )}
                      {r.trucks?.length > 0 ? (
                        <Table
                          dataSource={r.trucks}
                          rowKey={(_, i) => i}
                          size="small"
                          pagination={false}
                          columns={[
                            { title: "Ticket No.", dataIndex: "disposalTicketNo", key: "disposalTicketNo", render: (v) => v || "—" },
                            { title: "Hauler", dataIndex: "hauler", key: "hauler" },
                            { title: "Plate No.", dataIndex: "plateNumber", key: "plateNumber" },
                            {
                              title: "Capacity",
                              key: "cap",
                              render: (_, t) => t.truckCapacity ? `${t.truckCapacity} ${t.truckCapacityUnit || "m³"}` : "—",
                            },
                            {
                              title: "Volume",
                              key: "vol",
                              render: (_, t) => t.actualVolume != null ? <Text strong>{t.actualVolume} {t.actualVolumeUnit || "tons"}</Text> : "—",
                            },
                            {
                              title: "Waste Type",
                              dataIndex: "wasteType",
                              key: "wasteType",
                              render: (v) => v ? <Tag color={v === "Residual" ? "blue" : "volcano"} bordered={false}>{v}</Tag> : "—",
                            },
                          ]}
                        />
                      ) : (
                        <Text type="secondary">No trucks recorded</Text>
                      )}
                    </>
                  ),
                },
              ]}
            />
          );
        })()}
      </Modal>

      {/* ── Edit Modal ── */}
      <Modal
        title={
          <Space>
            <EditOutlined style={{ color: ACCENT }} />
            <span>Edit Submission — {editRecord?.idNo || ""}</span>
          </Space>
        }
        open={!!editRecord}
        onCancel={() => setEditRecord(null)}
        onOk={handleEditSave}
        okText="Save Changes"
        okButtonProps={{ loading: editLoading, style: { background: ACCENT, borderColor: ACCENT } }}
        width={760}
        style={{ maxWidth: "95vw" }}
        destroyOnHidden
      >
        <Form form={editForm} layout="vertical" size="small">
          <Collapse
            defaultActiveKey={["disposal", "trucks"]}
            bordered={false}
            size="small"
            items={[
              {
                key: "disposal",
                label: <Text strong><CalendarOutlined style={{ color: ACCENT, marginRight: 6 }} />Disposal Information</Text>,
                children: (
                  <Row gutter={12}>
                    <Col xs={24} sm={12}>
                      <Form.Item name="dateOfDisposal" label={<><CalendarOutlined /> Date of Disposal</>} rules={[{ required: true }]}>
                        <DatePicker style={{ width: "100%" }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item name="lguCompanyName" label={<><BankOutlined /> LGU/Company Name</>} rules={[{ required: true }]}>
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item name="companyType" label="Company Type" rules={[{ required: true }]}>
                        <Select>
                          <Option value="LGU">LGU</Option>
                          <Option value="Private">Private</Option>
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item name="address" label={<><EnvironmentOutlined /> Address</>}>
                        <Input />
                      </Form.Item>
                    </Col>
                  </Row>
                ),
              },
              {
                key: "trucks",
                label: <Text strong><CarOutlined style={{ color: "#fa8c16", marginRight: 6 }} />Trucks</Text>,
                children: (
                  <Form.List name="trucks">
                    {(fields, { add, remove }) => (
                      <>
                        {fields.map(({ key, name, ...rest }) => (
                          <Card
                            key={key}
                            size="small"
                            style={{ marginBottom: 8, borderRadius: 8 }}
                            title={<Text style={{ fontSize: 12 }}><CarOutlined /> Truck #{name + 1}</Text>}
                            extra={
                              <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => remove(name)}>Remove</Button>
                            }
                          >
                            <Row gutter={8}>
                              <Col xs={12} sm={8}>
                                <Form.Item {...rest} name={[name, "disposalTicketNo"]} label="Ticket No.">
                                  <Input />
                                </Form.Item>
                              </Col>
                              <Col xs={12} sm={8}>
                                <Form.Item {...rest} name={[name, "hauler"]} label="Hauler">
                                  <Input />
                                </Form.Item>
                              </Col>
                              <Col xs={12} sm={8}>
                                <Form.Item {...rest} name={[name, "plateNumber"]} label="Plate No.">
                                  <Input />
                                </Form.Item>
                              </Col>
                              <Col xs={12} sm={6}>
                                <Form.Item {...rest} name={[name, "truckCapacity"]} label="Capacity">
                                  <InputNumber min={0} style={{ width: "100%" }} />
                                </Form.Item>
                              </Col>
                              <Col xs={12} sm={6}>
                                <Form.Item {...rest} name={[name, "truckCapacityUnit"]} label="Cap. Unit">
                                  <Select>
                                    <Option value="m³">m³</Option>
                                    <Option value="tons">Tons</Option>
                                  </Select>
                                </Form.Item>
                              </Col>
                              <Col xs={12} sm={6}>
                                <Form.Item {...rest} name={[name, "actualVolume"]} label="Volume">
                                  <InputNumber min={0} style={{ width: "100%" }} />
                                </Form.Item>
                              </Col>
                              <Col xs={12} sm={6}>
                                <Form.Item {...rest} name={[name, "actualVolumeUnit"]} label="Vol. Unit">
                                  <Select>
                                    <Option value="tons">Tons</Option>
                                    <Option value="m³">m³</Option>
                                  </Select>
                                </Form.Item>
                              </Col>
                              <Col xs={24} sm={8}>
                                <Form.Item {...rest} name={[name, "wasteType"]} label="Waste Type">
                                  <Select allowClear>
                                    <Option value="Residual">Residual</Option>
                                    <Option value="Hazardous Waste">Hazardous Waste</Option>
                                  </Select>
                                </Form.Item>
                              </Col>
                            </Row>
                          </Card>
                        ))}
                        <Button type="dashed" onClick={() => add()} block icon={<CarOutlined />}>
                          Add Truck
                        </Button>
                      </>
                    )}
                  </Form.List>
                ),
              },
            ]}
          />
        </Form>
      </Modal>
    </div>
  );
}
