import { useState, useEffect, useCallback, useMemo } from "react";
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
  DatePicker,
  Tooltip,
  Tabs,
  Collapse,
  Statistic,
  Badge,
  Popconfirm,
  Switch,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  DownloadOutlined,
  SearchOutlined,
  EyeOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  EnvironmentOutlined,
  FileTextOutlined,
  ReloadOutlined,
  TeamOutlined,
  CalendarOutlined,
  BarChartOutlined,
  FilterOutlined,
  ClearOutlined,
  SafetyCertificateOutlined,
  BankOutlined,
  MinusCircleOutlined,
  LinkOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  AlertOutlined,
  UserOutlined,
  SolutionOutlined,
} from "@ant-design/icons";
import Swal from "sweetalert2";
import api from "../../api";
import { exportToExcel } from "../../utils/exportExcel";
import secureStorage from "../../utils/secureStorage";
import { useDataRef } from "../../utils/dataRef";
import dayjs from "dayjs";

const { Title, Text } = Typography;
const ACCENT = "#2f54eb";

const CACHE_KEY = "slf-facility-cache";
const CACHE_TTL = 5 * 60 * 1000;

function buildFilters(records, key) {
  const vals = [...new Set(records.map((r) => r[key]).filter(Boolean))].sort();
  return vals.map((v) => ({ text: v, value: v }));
}

function networkDays(startDate, endDate) {
  if (!startDate || !endDate) return null;
  const s = dayjs(startDate).startOf("day");
  const e = dayjs(endDate).startOf("day");
  if (!s.isValid() || !e.isValid()) return null;
  let count = 0,
    cur = s;
  const dir = e.isAfter(s) ? 1 : -1;
  while (dir > 0 ? !cur.isAfter(e) : !cur.isBefore(e)) {
    const dow = cur.day();
    if (dow !== 0 && dow !== 6) count++;
    cur = cur.add(dir, "day");
  }
  return Math.max(1, count > 1 ? count - 1 : count);
}

function computeFields(rec) {
  return {
    totalDaysReportPrepared: networkDays(
      rec.dateOfMonitoring,
      rec.dateReportPrepared,
    ),
    totalDaysReviewedStaff: networkDays(
      rec.dateReportPrepared,
      rec.dateReportReviewedStaff,
    ),
    totalDaysReviewedFocal: networkDays(
      rec.dateReportReviewedStaff || rec.dateReportPrepared,
      rec.dateReportReviewedFocal,
    ),
    totalDaysApproved: networkDays(
      rec.dateReportReviewedFocal,
      rec.dateReportApproved,
    ),
  };
}

function getStatusTag(v) {
  if (!v) return <Tag color="default">—</Tag>;
  if (/operational/i.test(v) && !/non/i.test(v))
    return (
      <Tag color="green" bordered={false}>
        <CheckCircleOutlined /> Operational
      </Tag>
    );
  if (/non/i.test(v))
    return (
      <Tag color="red" bordered={false}>
        <CloseCircleOutlined /> Non-Operational
      </Tag>
    );
  return <Tag bordered={false}>{v}</Tag>;
}

// ── Portal Generators Sub-Tab ──
function PortalGenerators({
  generators,
  loadingGen,
  fetchGenerators,
  slfRecords,
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form] = Form.useForm();
  const unitOptions = [
    { label: "Tons", value: "tons" },
    { label: "m³", value: "m3" },
  ];

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
  const openEdit = (r) => {
    setEditing(r);
    form.setFieldsValue({ ...r, accreditedHaulers: r.accreditedHaulers || [] });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      if (editing) {
        await api.put(`/slf-generators/${editing._id}`, values);
        Swal.fire("Updated", "Generator updated", "success");
      } else {
        await api.post("/slf-generators", values);
        Swal.fire("Created", "Generator added", "success");
      }
      setModalOpen(false);
      fetchGenerators();
    } catch (err) {
      if (err.response)
        Swal.fire(
          "Error",
          err.response.data?.message || "Save failed",
          "error",
        );
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/slf-generators/${id}`);
      Swal.fire("Deleted", "Generator removed", "success");
      fetchGenerators();
    } catch {
      Swal.fire("Error", "Delete failed", "error");
    }
  };

  const linkedFacilities = useMemo(() => {
    const map = {};
    slfRecords.forEach((r) => {
      if (r.slfGenerator) {
        const gid =
          typeof r.slfGenerator === "object"
            ? r.slfGenerator._id
            : r.slfGenerator;
        map[gid] = (map[gid] || 0) + 1;
      }
    });
    return map;
  }, [slfRecords]);

  const genColumns = [
    {
      title: "SLF Name",
      dataIndex: "slfName",
      render: (t) => <Text strong>{t}</Text>,
    },
    {
      title: "Baseline Volume",
      render: (_, r) =>
        `${(r.existingBaselineVolume ?? 0).toLocaleString()} ${r.existingBaselineUnit || "tons"}`,
    },
    {
      title: "Total Since Operation",
      render: (_, r) =>
        `${(r.totalVolumeSinceOperation ?? 0).toLocaleString()} ${r.totalVolumeSinceOperationUnit || "tons"}`,
    },
    { title: "Haulers", render: (_, r) => r.accreditedHaulers?.length || 0 },
    {
      title: "Linked Facilities",
      render: (_, r) => linkedFacilities[r._id] || 0,
    },
    {
      title: "Status",
      dataIndex: "isActive",
      render: (v) =>
        v ? <Tag color="green">Active</Tag> : <Tag color="red">Inactive</Tag>,
    },
    {
      title: "Actions",
      width: 120,
      render: (_, r) => (
        <Space>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => openEdit(r)}
          />
          <Popconfirm title="Delete?" onConfirm={() => handleDelete(r._id)}>
            <Button type="link" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const VolumeRow = ({ label, nameVal, nameUnit }) => (
    <Row gutter={8}>
      <Col xs={16}>
        <Form.Item label={label} name={nameVal}>
          <InputNumber min={0} style={{ width: "100%" }} />
        </Form.Item>
      </Col>
      <Col xs={8}>
        <Form.Item label="Unit" name={nameUnit}>
          <Select options={unitOptions} />
        </Form.Item>
      </Col>
    </Row>
  );

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <Text type="secondary">
          Manage portal SLF generators that waste generators submit disposal
          data to.
        </Text>
        <Button
          type="primary"
          size="small"
          icon={<PlusOutlined />}
          onClick={openAdd}
          style={{ background: ACCENT, borderColor: ACCENT }}
        >
          Add Generator
        </Button>
      </div>
      <Table
        dataSource={generators}
        columns={genColumns}
        rowKey="_id"
        loading={loadingGen}
        size="small"
        pagination={{ pageSize: 10 }}
        scroll={{ x: 700 }}
      />
      <Modal
        title={editing ? "Edit Generator" : "Add Generator"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        width={720}
        okText="Save"
        okButtonProps={{ style: { background: ACCENT, borderColor: ACCENT } }}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" size="small">
          <Form.Item
            label="SLF Name"
            name="slfName"
            rules={[{ required: true }]}
          >
            <Input placeholder="SLF name" />
          </Form.Item>
          <Form.Item label="Active" name="isActive" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Divider orientation="left" plain>
            Volume / Baseline Info
          </Divider>
          <VolumeRow
            label="Existing Baseline Volume"
            nameVal="existingBaselineVolume"
            nameUnit="existingBaselineUnit"
          />
          <VolumeRow
            label="Total Volume Since Operation"
            nameVal="totalVolumeSinceOperation"
            nameUnit="totalVolumeSinceOperationUnit"
          />
          <VolumeRow
            label="Active Cells Volume"
            nameVal="totalVolumeActiveCells"
            nameUnit="totalVolumeActiveCellsUnit"
          />
          <VolumeRow
            label="Closed Cells Volume"
            nameVal="totalVolumeClosedCells"
            nameUnit="totalVolumeClosedCellsUnit"
          />
          <Divider orientation="left" plain>
            Accredited Haulers
          </Divider>
          <Form.List name="accreditedHaulers">
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, name, ...rest }) => (
                  <Card
                    key={key}
                    size="small"
                    style={{ marginBottom: 8 }}
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
                          label="Name"
                          rules={[{ required: true }]}
                        >
                          <Input />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item
                          {...rest}
                          name={[name, "numberOfTrucks"]}
                          label="Trucks"
                        >
                          <InputNumber min={0} style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item
                          {...rest}
                          name={[name, "privateSectorClients"]}
                          label="Clients"
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
    </>
  );
}

// ── Main Component ──
export default function SLFMonitoring() {
  const { getValues } = useDataRef();
  const provinceOptions = getValues("province").map((p) => ({ label: p, value: p }));
  const monthOptions = getValues("target-month").map((m) => ({ label: m.replace(/^\d+\./, ""), value: m }));
  const mbaOptions = getValues("manila-bay-area").map((v) => ({ label: v, value: v }));
  const slfStatusOptions = getValues("slf-status").map((v) => ({ label: v, value: v }));
  const ownershipOptions = getValues("ownership").map((v) => ({ label: v, value: v }));
  const wasteTypeOptions = getValues("waste-type").map((v) => ({ label: v, value: v }));
  const enmoOptions = getValues("enmo").map((v) => ({ label: v, value: v }));
  const eswmStaffOptions = getValues("eswm-staff").map((v) => ({ label: v, value: v }));
  const focalOptions = getValues("eswm-focal").map((v) => ({ label: v, value: v }));

  const [records, setRecords] = useState([]);
  const [generators, setGenerators] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingGen, setLoadingGen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [detailModal, setDetailModal] = useState(null);
  const [editing, setEditing] = useState(null);
  const [searchText, setSearchText] = useState("");
  const [filterProvince, setFilterProvince] = useState(null);
  const [filterStatus, setFilterStatus] = useState(null);
  const [filterCategory, setFilterCategory] = useState(null);
  const [filterMonth, setFilterMonth] = useState(null);
  const [form] = Form.useForm();

  const fetchRecords = useCallback(async (skipCache = false) => {
    setLoading(true);
    try {
      if (!skipCache) {
        const cached = secureStorage.getJSON(CACHE_KEY);
        if (cached && Date.now() - cached.ts < CACHE_TTL) {
          setRecords(cached.data.map((r) => ({ ...r, ...computeFields(r) })));
          setLoading(false);
          return;
        }
      }
      const { data } = await api.get("/slf-facilities");
      const enriched = data.map((r) => ({ ...r, ...computeFields(r) }));
      setRecords(enriched);
      secureStorage.setJSON(CACHE_KEY, { data, ts: Date.now() });
    } catch {
      Swal.fire("Error", "Failed to load records", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchGenerators = useCallback(async () => {
    setLoadingGen(true);
    try {
      const { data } = await api.get("/slf-generators");
      setGenerators(data);
    } catch {
      /* silent */
    } finally {
      setLoadingGen(false);
    }
  }, []);

  useEffect(() => {
    fetchRecords();
    fetchGenerators();
  }, [fetchRecords, fetchGenerators]);

  const generatorOptions = useMemo(
    () => generators.map((g) => ({ label: g.slfName, value: g._id })),
    [generators],
  );

  const openAdd = () => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };
  const openEdit = (record) => {
    setEditing(record);
    const genId = record.slfGenerator
      ? typeof record.slfGenerator === "object"
        ? record.slfGenerator._id
        : record.slfGenerator
      : null;
    form.setFieldsValue({
      ...record,
      slfGenerator: genId,
      dateOfMonitoring: record.dateOfMonitoring
        ? dayjs(record.dateOfMonitoring)
        : null,
      dateReportPrepared: record.dateReportPrepared
        ? dayjs(record.dateReportPrepared)
        : null,
      dateReportReviewedStaff: record.dateReportReviewedStaff
        ? dayjs(record.dateReportReviewedStaff)
        : null,
      dateReportReviewedFocal: record.dateReportReviewedFocal
        ? dayjs(record.dateReportReviewedFocal)
        : null,
      dateReportApproved: record.dateReportApproved
        ? dayjs(record.dateReportApproved)
        : null,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const payload = {
        ...values,
        dateOfMonitoring: values.dateOfMonitoring?.toISOString(),
        dateReportPrepared: values.dateReportPrepared?.toISOString(),
        dateReportReviewedStaff: values.dateReportReviewedStaff?.toISOString(),
        dateReportReviewedFocal: values.dateReportReviewedFocal?.toISOString(),
        dateReportApproved: values.dateReportApproved?.toISOString(),
      };
      Object.assign(payload, computeFields(payload));
      if (editing) {
        const { data } = await api.put(
          `/slf-facilities/${editing._id}`,
          payload,
        );
        setRecords((prev) =>
          prev.map((r) =>
            r._id === editing._id ? { ...data, ...computeFields(data) } : r,
          ),
        );
        secureStorage.remove(CACHE_KEY);
        Swal.fire("Updated", "Record updated successfully", "success");
      } else {
        await api.post("/slf-facilities", payload);
        secureStorage.remove(CACHE_KEY);
        Swal.fire("Created", "Record added successfully", "success");
        fetchRecords();
      }
    } catch (err) {
      if (err.response)
        Swal.fire(
          "Error",
          err.response.data?.message || "Save failed",
          "error",
        );
    }
    setModalOpen(false);
  };

  const filtered = useMemo(() => {
    let data = records;
    if (searchText) {
      const q = searchText.toLowerCase();
      data = data.filter((r) =>
        [
          r.province,
          r.lgu,
          r.barangay,
          r.enmo,
          r.focalPerson,
          r.ownership,
        ].some((v) => v && v.toLowerCase().includes(q)),
      );
    }
    if (filterProvince)
      data = data.filter((r) => r.province === filterProvince);
    if (filterStatus) data = data.filter((r) => r.statusOfSLF === filterStatus);
    if (filterCategory)
      data = data.filter((r) => r.category === filterCategory);
    if (filterMonth) data = data.filter((r) => r.targetMonth === filterMonth);
    return data;
  }, [
    records,
    searchText,
    filterProvince,
    filterStatus,
    filterCategory,
    filterMonth,
  ]);

  const hasFilters =
    searchText ||
    filterProvince ||
    filterStatus ||
    filterCategory ||
    filterMonth;
  const clearFilters = () => {
    setSearchText("");
    setFilterProvince(null);
    setFilterStatus(null);
    setFilterCategory(null);
    setFilterMonth(null);
  };

  // Summary tiles
  const totalRecords = filtered.length;
  const opCount = filtered.filter(
    (r) => /operational/i.test(r.statusOfSLF) && !/non/i.test(r.statusOfSLF),
  ).length;
  const nonOpCount = filtered.filter((r) => /non/i.test(r.statusOfSLF)).length;
  const totalCapacity = filtered.reduce(
    (s, r) => s + (r.volumeCapacity || 0),
    0,
  );
  const totalLGUs = filtered.reduce((s, r) => s + (r.noOfLGUServed || 0), 0);
  const totalCells = filtered.reduce((s, r) => s + (r.numberOfCell || 0), 0);
  const totalLeachate = filtered.reduce(
    (s, r) => s + (r.noOfLeachatePond || 0),
    0,
  );
  const totalGasVents = filtered.reduce(
    (s, r) => s + (r.numberOfGasVents || 0),
    0,
  );
  const totalWaste = filtered.reduce(
    (s, r) => s + (r.actualResidualWasteReceived || 0),
    0,
  );

  const columns = [
    {
      title: "#",
      key: "idx",
      width: 50,
      fixed: "left",
      render: (_, __, i) => i + 1,
    },
    {
      title: (
        <>
          <EnvironmentOutlined style={{ color: ACCENT }} /> LGU
        </>
      ),
      key: "lgu",
      width: 150,
      fixed: "left",
      filters: buildFilters(records, "province"),
      onFilter: (v, r) => r.province === v,
      sorter: (a, b) => (a.lgu || "").localeCompare(b.lgu || ""),
      render: (_, r) => (
        <Tooltip
          title={`${r.province} — ${r.lgu}${r.barangay ? ` (${r.barangay})` : ""}`}
        >
          <div style={{ lineHeight: 1.3 }}>
            <Text strong style={{ fontSize: 12 }}>
              {r.lgu}
            </Text>
            <br />
            <Text type="secondary" style={{ fontSize: 11 }}>
              {r.province}
              {r.barangay ? ` · ${r.barangay}` : ""}
            </Text>
          </div>
        </Tooltip>
      ),
    },
    {
      title: "MBA",
      dataIndex: "manilaBayArea",
      width: 70,
      filters: buildFilters(records, "manilaBayArea"),
      onFilter: (v, r) => r.manilaBayArea === v,
    },
    {
      title: "Ownership",
      dataIndex: "ownership",
      width: 100,
      filters: buildFilters(records, "ownership"),
      onFilter: (v, r) => r.ownership === v,
    },
    {
      title: "Category",
      dataIndex: "category",
      width: 100,
      render: (v) =>
        v ? (
          <Tag color="blue" bordered={false}>
            {v}
          </Tag>
        ) : (
          "—"
        ),
      filters: buildFilters(records, "category"),
      onFilter: (v, r) => r.category === v,
    },
    {
      title: (
        <>
          <SafetyCertificateOutlined style={{ color: "#52c41a" }} /> Status
        </>
      ),
      key: "status",
      width: 140,
      filters: buildFilters(records, "statusOfSLF"),
      onFilter: (v, r) => r.statusOfSLF === v,
      sorter: (a, b) =>
        (a.yearStartedOperation || 0) - (b.yearStartedOperation || 0),
      render: (_, r) => (
        <div style={{ lineHeight: 1.3 }}>
          {getStatusTag(r.statusOfSLF)}
          {r.yearStartedOperation && (
            <div>
              <Text type="secondary" style={{ fontSize: 10 }}>
                <CalendarOutlined style={{ marginRight: 3 }} />
                Since {r.yearStartedOperation}
              </Text>
            </div>
          )}
        </div>
      ),
    },
    {
      title: "Capacity",
      dataIndex: "volumeCapacity",
      width: 100,
      sorter: (a, b) => (a.volumeCapacity || 0) - (b.volumeCapacity || 0),
      render: (v) =>
        v != null ? (
          <Text strong style={{ color: ACCENT }}>
            {Number(v).toLocaleString()}
          </Text>
        ) : (
          "—"
        ),
    },
    {
      title: "LGUs Served",
      dataIndex: "noOfLGUServed",
      width: 100,
      sorter: (a, b) => (a.noOfLGUServed || 0) - (b.noOfLGUServed || 0),
    },
    { title: "Cells", dataIndex: "numberOfCell", width: 70 },
    { title: "Leachate", dataIndex: "noOfLeachatePond", width: 80 },
    { title: "Gas Vents", dataIndex: "numberOfGasVents", width: 80 },
    {
      title: "Waste (tons)",
      dataIndex: "actualResidualWasteReceived",
      width: 110,
      sorter: (a, b) =>
        (a.actualResidualWasteReceived || 0) -
        (b.actualResidualWasteReceived || 0),
      render: (v) => (v != null ? Number(v).toLocaleString() : "—"),
    },
    { title: "Lifespan", dataIndex: "remainingLifeSpan", width: 100 },
    {
      title: "Portal Link",
      key: "portal",
      width: 100,
      render: (_, r) => {
        const g = r.slfGenerator;
        return g ? (
          <Tag color="blue" bordered={false}>
            <LinkOutlined /> {typeof g === "object" ? g.slfName : "Linked"}
          </Tag>
        ) : (
          <Tag color="default">—</Tag>
        );
      },
    },
    {
      title: (
        <>
          <CalendarOutlined style={{ color: "#13c2c2" }} /> Target Month
        </>
      ),
      dataIndex: "targetMonth",
      key: "targetMonth",
      width: 220,
      ellipsis: true,
      filters: buildFilters(records, "targetMonth"),
      onFilter: (v, r) => r.targetMonth === v,
      render: (v) =>
        v ? (
          <Tag bordered={false} color="cyan">
            {v.replace(/^\d+\./, "")}
          </Tag>
        ) : (
          "—"
        ),
    },
    {
      title: (
        <>
          <TeamOutlined style={{ color: "#722ed1" }} /> Personnel
        </>
      ),
      key: "personnel",
      width: 170,
      ellipsis: false,
      render: (_, r) => (
        <Tooltip
          title={
            <div>
              <div>
                <UserOutlined /> ENMO: {r.enmo || "—"}
              </div>
              <div>
                <UserOutlined /> Focal: {r.focalPerson || "—"}
              </div>
            </div>
          }
        >
          <div
            style={{
              lineHeight: 1.3,
              whiteSpace: "normal",
              wordBreak: "break-word",
            }}
          >
            <Text style={{ fontSize: 11 }}>
              <UserOutlined style={{ color: "#722ed1", marginRight: 4 }} />
              {r.focalPerson || "—"}
            </Text>
            <br />
            <Text type="secondary" style={{ fontSize: 10 }}>
              <SolutionOutlined style={{ marginRight: 3 }} />
              {r.enmo || "—"}
            </Text>
          </div>
        </Tooltip>
      ),
    },
    {
      title: "Actions",
      key: "actions",
      width: 100,
      fixed: "right",
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title="View">
            <Button
              size="small"
              type="text"
              icon={<EyeOutlined />}
              onClick={() => setDetailModal(r)}
            />
          </Tooltip>
          <Tooltip title="Edit">
            <Button
              size="small"
              type="text"
              icon={<EditOutlined />}
              onClick={() => openEdit(r)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  const handleExport = () => {
    const rows = filtered.map((r, i) => ({
      "#": i + 1,
      Province: r.province,
      LGU: r.lgu,
      Barangay: r.barangay,
      MBA: r.manilaBayArea,
      Ownership: r.ownership,
      Category: r.category,
      Status: r.statusOfSLF,
      "Year Started": r.yearStartedOperation,
      Capacity: r.volumeCapacity,
      "LGUs Served": r.noOfLGUServed,
      Cells: r.numberOfCell,
      Leachate: r.noOfLeachatePond,
      "Gas Vents": r.numberOfGasVents,
      "Waste Received": r.actualResidualWasteReceived,
      Lifespan: r.remainingLifeSpan,
      "Target Month": r.targetMonth,
      ENMO: r.enmo,
      Focal: r.focalPerson,
    }));
    exportToExcel(rows, "SLF_Facilities_Data");
  };

  return (
    <div style={{ padding: 0 }}>
      {/* Summary tiles */}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {/* Total SLFs + LGUs Served */}
        <Col xs={24} sm={12} md={6} lg={5}>
          <Card
            size="small"
            hoverable
            style={{ borderRadius: 10, borderLeft: `4px solid ${ACCENT}`, height: "100%" }}
          >
            <Statistic
              title="Total SLFs"
              value={totalRecords}
              prefix={<BankOutlined style={{ color: ACCENT }} />}
            />
            <div style={{ borderTop: "1px dashed #f0f0f0", marginTop: 8, paddingTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                <TeamOutlined style={{ color: "#fa8c16", marginRight: 4 }} />
                LGUs Served: <Text strong>{totalLGUs}</Text>
              </Text>
            </div>
          </Card>
        </Col>
        {/* Operational + Non-Operational */}
        <Col xs={24} sm={12} md={6} lg={5}>
          <Card
            size="small"
            hoverable
            style={{ borderRadius: 10, borderLeft: "4px solid #52c41a", height: "100%" }}
          >
            <Statistic
              title="Operational"
              value={opCount}
              valueStyle={{ color: "#52c41a" }}
              prefix={<CheckCircleOutlined />}
            />
            <div style={{ borderTop: "1px dashed #f0f0f0", marginTop: 8, paddingTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                <CloseCircleOutlined style={{ color: "#ff4d4f", marginRight: 4 }} />
                Non-Operational: <Text strong style={{ color: "#ff4d4f" }}>{nonOpCount}</Text>
              </Text>
            </div>
          </Card>
        </Col>
        {/* Capacity + Waste Received */}
        <Col xs={24} sm={12} md={6} lg={5}>
          <Card
            size="small"
            hoverable
            style={{ borderRadius: 10, borderLeft: "4px solid #722ed1", height: "100%" }}
          >
            <Statistic
              title="Capacity"
              value={totalCapacity}
              prefix={<DatabaseOutlined style={{ color: "#722ed1" }} />}
              formatter={(v) => Number(v).toLocaleString()}
            />
            <div style={{ borderTop: "1px dashed #f0f0f0", marginTop: 8, paddingTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                <BarChartOutlined style={{ color: "#eb2f96", marginRight: 4 }} />
                Waste Received: <Text strong>{Number(totalWaste).toLocaleString()} tons</Text>
              </Text>
            </div>
          </Card>
        </Col>
        {/* Total Cells */}
        <Col xs={12} sm={6} md={3} lg={4}>
          <Card
            size="small"
            hoverable
            style={{ borderRadius: 10, borderLeft: "4px solid #13c2c2", height: "100%" }}
          >
            <Statistic
              title="Total Cells"
              value={totalCells}
              prefix={<ExperimentOutlined style={{ color: "#13c2c2" }} />}
            />
          </Card>
        </Col>
        {/* Leachate Ponds */}
        <Col xs={12} sm={6} md={3} lg={5}>
          <Card
            size="small"
            hoverable
            style={{ borderRadius: 10, borderLeft: "4px solid #1890ff", height: "100%" }}
          >
            <Statistic
              title="Leachate Ponds"
              value={totalLeachate}
              prefix={<AlertOutlined style={{ color: "#1890ff" }} />}
            />
          </Card>
        </Col>
      </Row>

      <Tabs
        defaultActiveKey="facilities"
        items={[
          {
            key: "facilities",
            label: (
              <>
                <BankOutlined /> Sanitary Landfill Facility
              </>
            ),
            children: (
              <>
                {/* Header with Search + Export */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 16,
                    flexWrap: "wrap",
                    gap: 12,
                  }}
                >
                  <Title level={4} style={{ margin: 0 }}>
                    <BankOutlined /> Sanitary Landfill Facility
                  </Title>
                  <Space wrap>
                    <Input
                      placeholder="Search..."
                      prefix={<SearchOutlined />}
                      value={searchText}
                      onChange={(e) => setSearchText(e.target.value)}
                      style={{ width: "100%", maxWidth: 200 }}
                      allowClear
                    />
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      onClick={openAdd}
                      style={{ background: ACCENT, borderColor: ACCENT }}
                    >
                      Add Record
                    </Button>
                    <Button icon={<DownloadOutlined />} onClick={handleExport}>
                      Export
                    </Button>
                    <Tooltip title="Refresh data">
                      <Button
                        icon={<ReloadOutlined />}
                        onClick={() => fetchRecords(true)}
                        loading={loading}
                      />
                    </Tooltip>
                  </Space>
                </div>

                {/* Filter Bar */}
                <Card
                  size="small"
                  style={{ borderRadius: 10, marginBottom: 12 }}
                  bodyStyle={{ padding: "10px 16px" }}
                >
                  <Row gutter={[10, 10]} align="middle">
                    <Col>
                      <FilterOutlined
                        style={{ color: ACCENT, marginRight: 6 }}
                      />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Filters:
                      </Text>
                    </Col>
                    <Col flex="auto">
                      <Space wrap size={8}>
                        <Select
                          placeholder="Province"
                          value={filterProvince}
                          onChange={setFilterProvince}
                          allowClear
                          style={{
                            width: "100%",
                            minWidth: 120,
                            maxWidth: 160,
                          }}
                          size="small"
                          options={provinceOptions}
                          suffixIcon={<EnvironmentOutlined />}
                        />
                        <Select
                          placeholder="Status"
                          value={filterStatus}
                          onChange={setFilterStatus}
                          allowClear
                          style={{
                            width: "100%",
                            minWidth: 110,
                            maxWidth: 160,
                          }}
                          size="small"
                          options={buildFilters(records, "statusOfSLF")}
                          suffixIcon={<SafetyCertificateOutlined />}
                        />
                        <Select
                          placeholder="Category"
                          value={filterCategory}
                          onChange={setFilterCategory}
                          allowClear
                          style={{
                            width: "100%",
                            minWidth: 110,
                            maxWidth: 150,
                          }}
                          size="small"
                          options={buildFilters(records, "category")}
                        />
                        <Select
                          placeholder="Target Month"
                          value={filterMonth}
                          onChange={setFilterMonth}
                          allowClear
                          style={{
                            width: "100%",
                            minWidth: 110,
                            maxWidth: 150,
                          }}
                          size="small"
                          options={monthOptions}
                          suffixIcon={<CalendarOutlined />}
                        />
                        {hasFilters && (
                          <Tooltip title="Clear all filters">
                            <Button
                              size="small"
                              type="link"
                              danger
                              icon={<ClearOutlined />}
                              onClick={clearFilters}
                            >
                              Clear
                            </Button>
                          </Tooltip>
                        )}
                      </Space>
                    </Col>
                    <Col>
                      <Tag
                        bordered={false}
                        color={hasFilters ? "blue" : "default"}
                      >
                        {filtered.length} / {records.length} records
                      </Tag>
                    </Col>
                  </Row>
                </Card>

                {/* Table */}
                <Card size="small" style={{ borderRadius: 10 }}>
                  <Table
                    dataSource={filtered}
                    columns={columns}
                    rowKey="_id"
                    loading={loading}
                    size="small"
                    scroll={{ x: 1800 }}
                    pagination={{
                      pageSize: 50,
                      showSizeChanger: true,
                      showTotal: (t) => `${t} records`,
                    }}
                  />
                </Card>
              </>
            ),
          },
          {
            key: "portal",
            label: (
              <>
                <LinkOutlined /> Waste Generators
              </>
            ),
            children: (
              <PortalGenerators
                generators={generators}
                loadingGen={loadingGen}
                fetchGenerators={fetchGenerators}
                slfRecords={records}
              />
            ),
          },
        ]}
      />

      {/* Add/Edit Modal */}
      <Modal
        title={editing ? "Edit SLF Facility" : "Add SLF Facility"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        width={960}
        okText="Save"
        okButtonProps={{ style: { background: ACCENT, borderColor: ACCENT } }}
      >
        <Form form={form} layout="vertical" size="small">
          <Collapse
            defaultActiveKey={["location","facility","permits","personnel","monitoring","portal","compliance"]}
            bordered={false}
            items={[
              {
                key: "location",
                label: <span style={{ color: "#1677ff" }}><EnvironmentOutlined /> Location</span>,
                children: (
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item
                name="province"
                label="Province"
                rules={[{ required: true }]}
              >
                <Select options={provinceOptions} placeholder="Select" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="lgu" label="LGU" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="barangay" label="Barangay">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="manilaBayArea" label="Manila Bay Area">
                <Select options={mbaOptions} allowClear placeholder="Select" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="congressionalDistrict"
                label="Congressional District"
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="ownership" label="Ownership">
                <Select options={ownershipOptions} allowClear placeholder="Select" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="latitude" label="Latitude">
                <InputNumber style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="longitude" label="Longitude">
                <InputNumber style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
                ),
              },
              {
                key: "facility",
                label: <span style={{ color: "#fa8c16" }}><BankOutlined /> Facility Details</span>,
                children: (
          <Row gutter={12}>
            <Col span={6}>
              <Form.Item name="yearStartedOperation" label="Year Started">
                <InputNumber style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="category" label="Category">
                <Select options={wasteTypeOptions} allowClear placeholder="Select" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="volumeCapacity" label="Volume Capacity">
                <InputNumber style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="noOfLGUServed" label="LGUs Served">
                <InputNumber style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="statusOfSLF" label="Status">
                <Select options={slfStatusOptions} allowClear placeholder="Select Status" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="remainingLifeSpan" label="Remaining Lifespan">
                <Input />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="numberOfCell" label="No. of Cells">
                <InputNumber style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="noOfLeachatePond" label="Leachate Ponds">
                <InputNumber style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="numberOfGasVents" label="Gas Vents">
                <InputNumber style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name="actualResidualWasteReceived"
                label="Waste Received"
              >
                <InputNumber style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="estimatedVolumeWaste" label="Est. Volume Waste">
                <InputNumber style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="mrfEstablished" label="MRF Established">
                <Input />
              </Form.Item>
            </Col>
          </Row>
                ),
              },
              {
                key: "permits",
                label: <span style={{ color: "#faad14" }}><SafetyCertificateOutlined /> Permits</span>,
                children: (
          <Row gutter={12}>
            <Col span={6}>
              <Form.Item name="eccNo" label="ECC No.">
                <Input />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="dischargePermit" label="Discharge Permit">
                <Input />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="permitToOperate" label="Permit to Operate">
                <Input />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="hazwasteGenerationId" label="Hazwaste Gen. ID">
                <Input />
              </Form.Item>
            </Col>
          </Row>
                ),
              },
              {
                key: "personnel",
                label: <span style={{ color: "#52c41a" }}><TeamOutlined /> Personnel</span>,
                children: (
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="targetMonth" label="Target Month">
                <Select
                  options={monthOptions}
                  placeholder="Select"
                  allowClear
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="enmo" label="ENMO">
                <Select options={enmoOptions} allowClear showSearch placeholder="Select ENMO" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="eswmStaff" label="ESWM Staff">
                <Select options={eswmStaffOptions} allowClear showSearch placeholder="Select Staff" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="focalPerson" label="Focal Person">
                <Select options={focalOptions} allowClear showSearch placeholder="Select Focal" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="iisNumber" label="IIS Number">
                <Input />
              </Form.Item>
            </Col>
          </Row>
                ),
              },
              {
                key: "monitoring",
                label: <span style={{ color: "#13c2c2" }}><CalendarOutlined /> Monitoring Dates</span>,
                children: (
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="dateOfMonitoring" label="Monitoring">
                <DatePicker style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="dateReportPrepared" label="Report Prepared">
                <DatePicker style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="dateReportReviewedStaff"
                label="Reviewed (Staff)"
              >
                <DatePicker style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="dateReportReviewedFocal"
                label="Reviewed (Focal)"
              >
                <DatePicker style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="dateReportApproved" label="Approved">
                <DatePicker style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
                ),
              },
              {
                key: "portal",
                label: <span style={{ color: "#597ef7" }}><LinkOutlined /> Portal Link</span>,
                children: (
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="slfGenerator" label="Link to Portal Generator">
                <Select
                  options={generatorOptions}
                  placeholder="Select generator (optional)"
                  allowClear
                  showSearch
                  optionFilterProp="label"
                />
              </Form.Item>
            </Col>
          </Row>
                ),
              },
              {
                key: "compliance",
                label: <span style={{ color: "#eb2f96" }}><FileTextOutlined /> Compliance</span>,
                children: (
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="remarksAndRecommendation" label="Remarks">
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="findings" label="Findings">
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="adviseLetterDateIssued"
                label="Advise Letter Date"
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="complianceToAdvise" label="Compliance">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="signedDocument" label="Signed Document">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="docketNoNOV" label="Docket No. (NOV)">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="dateOfIssuanceNOV" label="NOV Issuance Date">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="dateOfTechnicalConference"
                label="Tech Conference Date"
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="commitments" label="Commitments">
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="remarksCompliance" label="Compliance Remarks">
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
          </Row>
                ),
              },
            ]}
          />
        </Form>
      </Modal>

      {/* Detail Modal */}
      <Modal
        title={
          <Space>
            <BankOutlined /> SLF Facility Details
          </Space>
        }
        open={!!detailModal}
        onCancel={() => setDetailModal(null)}
        footer={<Button onClick={() => setDetailModal(null)}>Close</Button>}
        width={900}
      >
        {detailModal && (
          <Tabs
            defaultActiveKey="1"
            items={[
              {
                key: "1",
                label: "Location & Status",
                children: (
                  <Row gutter={[16, 8]}>
                    <Col span={12}>
                      <Text type="secondary">Province:</Text>{" "}
                      <Text strong>{detailModal.province}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">LGU:</Text>{" "}
                      <Text strong>{detailModal.lgu}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Barangay:</Text>{" "}
                      <Text strong>{detailModal.barangay || "—"}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">MBA:</Text>{" "}
                      <Text strong>{detailModal.manilaBayArea || "—"}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Ownership:</Text>{" "}
                      <Text strong>{detailModal.ownership || "—"}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">District:</Text>{" "}
                      <Text strong>
                        {detailModal.congressionalDistrict || "—"}
                      </Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Status:</Text>{" "}
                      {getStatusTag(detailModal.statusOfSLF)}
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Category:</Text>{" "}
                      {detailModal.category ? (
                        <Tag color="blue">{detailModal.category}</Tag>
                      ) : (
                        "—"
                      )}
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Year Started:</Text>{" "}
                      <Text strong>
                        {detailModal.yearStartedOperation || "—"}
                      </Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Capacity:</Text>{" "}
                      <Text strong>
                        {detailModal.volumeCapacity
                          ? Number(detailModal.volumeCapacity).toLocaleString()
                          : "—"}
                      </Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">LGUs Served:</Text>{" "}
                      <Text strong>{detailModal.noOfLGUServed || "—"}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Remaining Lifespan:</Text>{" "}
                      <Text strong>{detailModal.remainingLifeSpan || "—"}</Text>
                    </Col>
                  </Row>
                ),
              },
              {
                key: "2",
                label: "Operations",
                children: (
                  <Row gutter={[16, 8]}>
                    <Col span={8}>
                      <Text type="secondary">Cells:</Text>{" "}
                      <Text strong>{detailModal.numberOfCell ?? "—"}</Text>
                    </Col>
                    <Col span={8}>
                      <Text type="secondary">Leachate Ponds:</Text>{" "}
                      <Text strong>{detailModal.noOfLeachatePond ?? "—"}</Text>
                    </Col>
                    <Col span={8}>
                      <Text type="secondary">Gas Vents:</Text>{" "}
                      <Text strong>{detailModal.numberOfGasVents ?? "—"}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Waste Received:</Text>{" "}
                      <Text strong>
                        {detailModal.actualResidualWasteReceived
                          ? `${Number(detailModal.actualResidualWasteReceived).toLocaleString()} tons`
                          : "—"}
                      </Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Est. Volume:</Text>{" "}
                      <Text strong>
                        {detailModal.estimatedVolumeWaste
                          ? Number(
                              detailModal.estimatedVolumeWaste,
                            ).toLocaleString()
                          : "—"}
                      </Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">MRF Established:</Text>{" "}
                      <Text strong>{detailModal.mrfEstablished || "—"}</Text>
                    </Col>
                    <Divider plain orientation="left">
                      Permits
                    </Divider>
                    <Col span={12}>
                      <Text type="secondary">ECC No.:</Text>{" "}
                      <Text>{detailModal.eccNo || "—"}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Discharge Permit:</Text>{" "}
                      <Text>{detailModal.dischargePermit || "—"}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Permit to Operate:</Text>{" "}
                      <Text>{detailModal.permitToOperate || "—"}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Hazwaste Gen. ID:</Text>{" "}
                      <Text>{detailModal.hazwasteGenerationId || "—"}</Text>
                    </Col>
                    {detailModal.slfGenerator && (
                      <>
                        <Divider plain orientation="left">
                          Portal Link
                        </Divider>
                        <Col span={24}>
                          <Tag color="blue" icon={<LinkOutlined />}>
                            {typeof detailModal.slfGenerator === "object"
                              ? detailModal.slfGenerator.slfName
                              : "Linked Generator"}
                          </Tag>
                        </Col>
                      </>
                    )}
                  </Row>
                ),
              },
              {
                key: "3",
                label: "Personnel & Monitoring",
                children: (
                  <Row gutter={[16, 8]}>
                    <Col span={12}>
                      <Text type="secondary">Target Month:</Text>{" "}
                      <Text strong>{detailModal.targetMonth || "—"}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">ENMO:</Text>{" "}
                      <Text strong>{detailModal.enmo || "—"}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">ESWM Staff:</Text>{" "}
                      <Text strong>{detailModal.eswmStaff || "—"}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Focal Person:</Text>{" "}
                      <Text strong>{detailModal.focalPerson || "—"}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">IIS Number:</Text>{" "}
                      <Text strong>{detailModal.iisNumber || "—"}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Monitoring:</Text>{" "}
                      <Text strong>
                        {detailModal.dateOfMonitoring
                          ? dayjs(detailModal.dateOfMonitoring).format(
                              "MMM DD, YYYY",
                            )
                          : "—"}
                      </Text>
                    </Col>
                    <Col span={8}>
                      <Text type="secondary">Days Prepared:</Text>{" "}
                      <Text strong>
                        {detailModal.totalDaysReportPrepared ?? "—"}
                      </Text>
                    </Col>
                    <Col span={8}>
                      <Text type="secondary">Days Staff Review:</Text>{" "}
                      <Text strong>
                        {detailModal.totalDaysReviewedStaff ?? "—"}
                      </Text>
                    </Col>
                    <Col span={8}>
                      <Text type="secondary">Days Focal Review:</Text>{" "}
                      <Text strong>
                        {detailModal.totalDaysReviewedFocal ?? "—"}
                      </Text>
                    </Col>
                  </Row>
                ),
              },
              {
                key: "4",
                label: "Compliance",
                children: (
                  <Row gutter={[16, 8]}>
                    <Col span={24}>
                      <Text type="secondary">Remarks:</Text>{" "}
                      <Text>{detailModal.remarksAndRecommendation || "—"}</Text>
                    </Col>
                    <Col span={24}>
                      <Text type="secondary">Findings:</Text>{" "}
                      <Text>{detailModal.findings || "—"}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Advise Letter:</Text>{" "}
                      <Text>{detailModal.adviseLetterDateIssued || "—"}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Compliance:</Text>{" "}
                      <Text>{detailModal.complianceToAdvise || "—"}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Signed Document:</Text>{" "}
                      <Text>{detailModal.signedDocument || "—"}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Docket (NOV):</Text>{" "}
                      <Text>{detailModal.docketNoNOV || "—"}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">NOV Date:</Text>{" "}
                      <Text>{detailModal.dateOfIssuanceNOV || "—"}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Tech Conference:</Text>{" "}
                      <Text>
                        {detailModal.dateOfTechnicalConference || "—"}
                      </Text>
                    </Col>
                    <Col span={24}>
                      <Text type="secondary">Commitments:</Text>{" "}
                      <Text>{detailModal.commitments || "—"}</Text>
                    </Col>
                  </Row>
                ),
              },
            ]}
          />
        )}
      </Modal>
    </div>
  );
}
