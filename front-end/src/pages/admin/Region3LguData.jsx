import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Card, Table, Button, Modal, Form, Input, Select, Space, Tag, Row, Col,
  Typography, Tooltip, Descriptions, Popconfirm, Empty, Alert, Upload, Steps, Statistic,
} from "antd";
import {
  PlusOutlined, EditOutlined, DownloadOutlined, SearchOutlined, EyeOutlined,
  ReloadOutlined, EnvironmentOutlined, FilterOutlined, ClearOutlined, DeleteOutlined,
  UploadOutlined, ImportOutlined, FileExcelOutlined,
} from "@ant-design/icons";
import Swal from "sweetalert2";
import * as XLSX from "xlsx";
import dayjs from "dayjs";
import api from "../../api";
import { exportToExcel } from "../../utils/exportExcel";
import { withSizeChanger } from "../../utils/tablePagination";
import secureStorage from "../../utils/secureStorage";
import { isDeveloper as isDeveloperUser } from "../../utils/adminIdentity";

const { Title, Text } = Typography;

// Mirrors Region3Lgu.LGU_TYPES on the server. "Special Zone" covers freeports and
// special economic zones — real client addresses that PSGC does not list as
// political subdivisions, so they can never arrive through a PSGC import. The
// nationally chartered ones (Clark Freeport Zone, Subic Bay Freeport Zone, the
// Freeport Area of Bataan …) ship as built-ins in server/utils/specialZones and
// need no encoding here; this type is how any that are missing get added.
const LGU_TYPES = [
  { label: "Province", value: "Province" },
  { label: "City", value: "City" },
  { label: "Municipality", value: "Municipality" },
  { label: "Special Zone", value: "Special Zone" },
];
const STATUS_OPTIONS = [
  { label: "Active", value: "Active" },
  { label: "Inactive", value: "Inactive" },
];
const IMPORT_HEADERS = ["psgcCode", "name", "lguType", "province", "municipalityCity", "region", "status", "aliases", "notes"];

const normalize = (v) => String(v || "").toLowerCase().replace(/province of\s+/g, "").replace(/[.,''`]/g, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
const dupKey = (r) => (String(r.psgcCode || "").trim() ? `psgc:${String(r.psgcCode).trim()}` : `nkt:${normalize(r.name)}|${normalize(r.province)}|${r.lguType || "Municipality"}`);

const lguTypeTag = (t) =>
  t === "Province" ? <Tag color="geekblue">Province</Tag>
  : t === "City" ? <Tag color="blue">City</Tag>
  : t === "Special Zone" ? <Tag color="purple">Special Zone</Tag>
  : <Tag color="cyan">Municipality</Tag>;
const statusTag = (s) => s === "Active" ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag>;

export default function Region3LguData({ isDark }) {
  // Developers reach this tab with full rights; a non-developer admin with a
  // direct route only gets what their region3Lgu permission allows (backend also
  // enforces). Buttons hide when the level is missing.
  const user = secureStorage.getJSON("user") || {};
  const isDeveloper = isDeveloperUser(user);
  const perm = (level) => isDeveloper || user.permissions?.region3Lgu?.[level] === true;
  const canEdit = perm("edit");
  const canDelete = perm("delete");
  const canImport = perm("edit");

  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [search, setSearch] = useState("");
  const [filterProvince, setFilterProvince] = useState(null);
  const [filterType, setFilterType] = useState(null);
  const [filterStatus, setFilterStatus] = useState(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [detail, setDetail] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  const fetchRecords = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    try {
      const { data } = await api.get("/region3-lgu");
      setRecords(Array.isArray(data) ? data : []);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  const provinceOptions = useMemo(() => {
    const set = new Set(records.map((r) => (r.province || "").trim()).filter(Boolean));
    return [...set].sort().map((p) => ({ label: p, value: p }));
  }, [records]);

  const hasActiveFilters = filterProvince || filterType || filterStatus || search;
  const clearAllFilters = () => { setFilterProvince(null); setFilterType(null); setFilterStatus(null); setSearch(""); };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((r) => {
      if (filterProvince && r.province !== filterProvince) return false;
      if (filterType && r.lguType !== filterType) return false;
      if (filterStatus && r.status !== filterStatus) return false;
      if (!q) return true;
      return [r.name, r.province, r.municipalityCity, r.psgcCode, (r.aliases || []).join(" ")]
        .some((v) => String(v || "").toLowerCase().includes(q));
    });
  }, [records, search, filterProvince, filterType, filterStatus]);

  const openAdd = () => { setEditing(null); form.resetFields(); form.setFieldsValue({ lguType: "Municipality", status: "Active", region: "Region III" }); setModalOpen(true); };
  const openEdit = (r) => {
    setEditing(r);
    form.setFieldsValue({ ...r, aliases: (r.aliases || []).join(", ") });
    setModalOpen(true);
  };

  const handleSave = async () => {
    let values;
    try { values = await form.validateFields(); } catch { return; }
    setSaving(true);
    const payload = { ...values, aliases: String(values.aliases || "").split(",").map((s) => s.trim()).filter(Boolean) };
    try {
      if (editing) await api.put(`/region3-lgu/${editing._id}`, payload);
      else await api.post("/region3-lgu", payload);
      Swal.fire({ icon: "success", title: editing ? "LGU updated" : "LGU added", timer: 1200, showConfirmButton: false });
      setModalOpen(false);
      fetchRecords(false);
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Save failed", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (r) => {
    Swal.fire({ title: "Delete this LGU?", text: `${r.name}, ${r.province}`, icon: "warning", showCancelButton: true, confirmButtonColor: "#ff4d4f", confirmButtonText: "Delete" })
      .then(async (res) => {
        if (!res.isConfirmed) return;
        try {
          await api.delete(`/region3-lgu/${r._id}`);
          setRecords((prev) => prev.filter((x) => x._id !== r._id));
          Swal.fire({ icon: "success", title: "Deleted", timer: 1000, showConfirmButton: false });
        } catch (err) {
          Swal.fire("Error", err.response?.data?.message || "Delete failed", "error");
        }
      });
  };

  const handleExport = () => {
    exportToExcel(filtered.map((r) => ({
      "PSGC Code": r.psgcCode, Name: r.name, Type: r.lguType, Province: r.province,
      "Municipality/City": r.municipalityCity, Region: r.region, Status: r.status,
      Aliases: (r.aliases || []).join("|"), Notes: r.notes,
    })), "Region3_LGU");
  };

  const downloadTemplate = () => {
    const csv = `${IMPORT_HEADERS.join(",")}\n031234567,City of San Fernando,City,Pampanga,San Fernando,Region III,Active,SanFernando|CSF,\n`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "region3_lgu_template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  // ── Import: parse a CSV/XLSX file entirely on the client, classify each row,
  //    preview, then confirm. Nothing is written until the user confirms. ──
  const existingKeys = useMemo(() => new Set(records.map(dupKey)), [records]);
  const parseFile = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        const seen = new Set();
        const rows = json.map((raw, i) => {
          const rec = {
            psgcCode: String(raw.psgcCode ?? raw.PSGC ?? raw["PSGC Code"] ?? "").trim(),
            name: String(raw.name ?? raw.Name ?? raw.LGU ?? "").trim(),
            lguType: String(raw.lguType ?? raw.Type ?? raw["LGU Type"] ?? "Municipality").trim() || "Municipality",
            province: String(raw.province ?? raw.Province ?? "").trim(),
            municipalityCity: String(raw.municipalityCity ?? raw["Municipality/City"] ?? "").trim(),
            region: String(raw.region ?? raw.Region ?? "Region III").trim() || "Region III",
            status: String(raw.status ?? raw.Status ?? "Active").trim() || "Active",
            aliases: String(raw.aliases ?? raw.Aliases ?? "").split(/[|,]/).map((s) => s.trim()).filter(Boolean),
            notes: String(raw.notes ?? raw.Notes ?? "").trim(),
          };
          const issues = [];
          if (!rec.name) issues.push("Missing name");
          if (!rec.province) issues.push("Missing province");
          if (!LGU_TYPES.some((type) => type.value === rec.lguType)) issues.push("Invalid type");
          const k = dupKey(rec);
          let state = "new";
          if (issues.length) state = "invalid";
          else if (seen.has(k)) { state = "dupInFile"; issues.push("Duplicate in file"); }
          else if (existingKeys.has(k)) state = "update";
          seen.add(k);
          return { key: i, ...rec, issues, state };
        });
        setImportRows(rows);
        setImportResult(null);
      } catch {
        Swal.fire("Error", "Could not parse the file. Use the provided CSV template.", "error");
      }
    };
    reader.readAsArrayBuffer(file);
    return false; // prevent antd auto-upload
  };

  const confirmImport = async () => {
    const valid = importRows.filter((r) => r.state !== "invalid" && r.state !== "dupInFile");
    if (!valid.length) { Swal.fire("Nothing to import", "No valid rows found.", "info"); return; }
    setImporting(true);
    try {
      const { data } = await api.post("/region3-lgu/import", { records: valid.map(({ key, issues, state, ...rec }) => rec) });
      setImportResult(data);
      fetchRecords(false);
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Import failed", "error");
    } finally {
      setImporting(false);
    }
  };

  const importStats = useMemo(() => importRows.reduce((a, r) => {
    a.total += 1;
    if (r.state === "invalid") a.invalid += 1;
    else if (r.state === "dupInFile") a.dupInFile += 1;
    else if (r.state === "update") a.update += 1;
    else a.new += 1;
    return a;
  }, { total: 0, new: 0, update: 0, invalid: 0, dupInFile: 0 }), [importRows]);

  const columns = [
    { title: "LGU Name", dataIndex: "name", key: "name", width: 200, fixed: "left", sorter: (a, b) => (a.name || "").localeCompare(b.name || ""),
      render: (v, r) => <div style={{ lineHeight: 1.3 }}><Text strong style={{ fontSize: 12 }}>{v}</Text><br />{lguTypeTag(r.lguType)}</div> },
    { title: "Province", dataIndex: "province", key: "province", width: 140, sorter: (a, b) => (a.province || "").localeCompare(b.province || ""),
      render: (v) => <Space size={4}><EnvironmentOutlined style={{ color: "#fa8c16" }} /><Text style={{ fontSize: 12 }}>{v || "—"}</Text></Space> },
    { title: "Municipality/City", dataIndex: "municipalityCity", key: "municipalityCity", width: 150, render: (v) => v || <Text type="secondary">—</Text> },
    { title: "PSGC", dataIndex: "psgcCode", key: "psgcCode", width: 110, render: (v) => v ? <Tag>{v}</Tag> : <Text type="secondary">—</Text> },
    { title: "Status", dataIndex: "status", key: "status", width: 100, sorter: (a, b) => (a.status || "").localeCompare(b.status || ""), render: (v) => statusTag(v) },
    { title: "Updated", dataIndex: "updatedAt", key: "updatedAt", width: 110, sorter: (a, b) => new Date(a.updatedAt || 0) - new Date(b.updatedAt || 0), render: (v) => v ? <Text style={{ fontSize: 11 }}>{dayjs(v).format("MM/DD/YYYY")}</Text> : "—" },
    {
      title: "Actions", key: "actions", width: 120, fixed: "right",
      render: (_, r) => (
        <Space size={2}>
          <Tooltip title="View"><Button type="text" size="small" icon={<EyeOutlined style={{ color: "#1890ff" }} />} onClick={() => setDetail(r)} /></Tooltip>
          {canEdit && <Tooltip title="Edit"><Button type="text" size="small" icon={<EditOutlined style={{ color: "#52c41a" }} />} onClick={() => openEdit(r)} /></Tooltip>}
          {canDelete && (
            <Popconfirm title="Delete this LGU?" onConfirm={() => handleDelete(r)} okText="Delete" okButtonProps={{ danger: true }}>
              <Tooltip title="Delete"><Button type="text" size="small" danger icon={<DeleteOutlined />} /></Tooltip>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  if (!perm("view")) {
    return <Empty description="You do not have permission to view Region 3 LGU data." style={{ marginTop: 60 }} />;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <Title level={5} style={{ margin: 0 }}><EnvironmentOutlined /> Region 3 LGU Data</Title>
        <Space wrap>
          <Input placeholder="Search LGU..." prefix={<SearchOutlined />} value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 220 }} allowClear />
          {canEdit && <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>Add LGU</Button>}
          {canImport && <Button icon={<ImportOutlined />} onClick={() => { setImportRows([]); setImportResult(null); setImportOpen(true); }}>Import</Button>}
          <Button icon={<DownloadOutlined />} onClick={handleExport} disabled={!filtered.length}>Export</Button>
          <Tooltip title="Refresh"><Button icon={<ReloadOutlined />} onClick={() => fetchRecords(true)} loading={loading} /></Tooltip>
        </Space>
      </div>

      {error && (
        <Alert type="error" showIcon style={{ marginBottom: 12 }} message="Failed to load Region 3 LGU data"
          action={<Button size="small" onClick={() => fetchRecords(true)}>Retry</Button>} />
      )}

      <Card size="small" style={{ borderRadius: 10, marginBottom: 12 }} bodyStyle={{ padding: "10px 16px" }}>
        <Row gutter={[10, 10]} align="middle">
          <Col><FilterOutlined style={{ color: "#1890ff", marginRight: 6 }} /><Text type="secondary" style={{ fontSize: 12 }}>Filters:</Text></Col>
          <Col flex="auto">
            <Space wrap size={8}>
              <Select placeholder="Province" value={filterProvince} onChange={setFilterProvince} allowClear showSearch size="small" style={{ minWidth: 150 }} options={provinceOptions} />
              <Select placeholder="LGU Type" value={filterType} onChange={setFilterType} allowClear size="small" style={{ minWidth: 140 }} options={LGU_TYPES} />
              <Select placeholder="Status" value={filterStatus} onChange={setFilterStatus} allowClear size="small" style={{ minWidth: 120 }} options={STATUS_OPTIONS} />
              {hasActiveFilters && <Button size="small" type="link" danger icon={<ClearOutlined />} onClick={clearAllFilters}>Clear</Button>}
            </Space>
          </Col>
          <Col><Tag bordered={false} color={hasActiveFilters ? "blue" : "default"}>{filtered.length} / {records.length}</Tag></Col>
        </Row>
      </Card>

      <Card style={{ borderRadius: 10 }} bodyStyle={{ padding: 0 }}>
        <Table
          dataSource={filtered} columns={columns} rowKey="_id" size="small" loading={loading} scroll={{ x: 1000 }}
          locale={{ emptyText: <Empty description={hasActiveFilters ? "No LGUs match the filters." : "No Region 3 LGUs yet. Add or import to begin."} /> }}
          pagination={withSizeChanger({ defaultPageSize: 10 })}
        />
      </Card>

      {/* Detail Modal */}
      <Modal title={<Space><EyeOutlined /> {detail?.name}</Space>} open={!!detail} onCancel={() => setDetail(null)} footer={<Button onClick={() => setDetail(null)}>Close</Button>} width={560} style={{ maxWidth: "95vw" }}>
        {detail && (
          <Descriptions column={2} size="small" bordered>
            <Descriptions.Item label="Name" span={2}><Text strong>{detail.name}</Text></Descriptions.Item>
            <Descriptions.Item label="Type">{lguTypeTag(detail.lguType)}</Descriptions.Item>
            <Descriptions.Item label="Status">{statusTag(detail.status)}</Descriptions.Item>
            <Descriptions.Item label="Province">{detail.province || "—"}</Descriptions.Item>
            <Descriptions.Item label="Municipality/City">{detail.municipalityCity || "—"}</Descriptions.Item>
            <Descriptions.Item label="PSGC Code">{detail.psgcCode || "—"}</Descriptions.Item>
            <Descriptions.Item label="Region">{detail.region || "—"}</Descriptions.Item>
            <Descriptions.Item label="Aliases" span={2}>{(detail.aliases || []).join(", ") || "—"}</Descriptions.Item>
            <Descriptions.Item label="Notes" span={2}>{detail.notes || "—"}</Descriptions.Item>
            <Descriptions.Item label="Source">{detail.source || "—"}</Descriptions.Item>
            <Descriptions.Item label="Updated">{detail.updatedAt ? dayjs(detail.updatedAt).format("MM/DD/YYYY HH:mm") : "—"}</Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      {/* Add / Edit Modal */}
      <Modal title={editing ? "Edit LGU" : "Add LGU"} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={handleSave} okText={editing ? "Update" : "Create"} confirmLoading={saving} width={620} style={{ maxWidth: "95vw" }} destroyOnClose>
        <Form form={form} layout="vertical" size="small">
          <Row gutter={16}>
            <Col xs={24} sm={16}><Form.Item name="name" label="LGU Name" rules={[{ required: true, message: "Name is required" }, { whitespace: true, message: "Name is required" }]}><Input placeholder="e.g. City of San Fernando" /></Form.Item></Col>
            <Col xs={24} sm={8}><Form.Item name="lguType" label="LGU Type" rules={[{ required: true }]}><Select options={LGU_TYPES} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="province" label="Province" rules={[{ required: true, message: "Province is required" }]}><Input placeholder="e.g. Pampanga" /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="municipalityCity" label="Municipality / City"><Input /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="psgcCode" label="PSGC Code"><Input placeholder="Optional" /></Form.Item></Col>
            <Col xs={24} sm={6}><Form.Item name="region" label="Region"><Input /></Form.Item></Col>
            <Col xs={24} sm={6}><Form.Item name="status" label="Status" rules={[{ required: true }]}><Select options={STATUS_OPTIONS} /></Form.Item></Col>
            <Col span={24}><Form.Item name="aliases" label="Aliases (comma-separated)"><Input placeholder="e.g. CSF, San Fernando" /></Form.Item></Col>
            <Col span={24}><Form.Item name="notes" label="Notes"><Input.TextArea rows={2} /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>

      {/* Import Modal */}
      <Modal
        title={<Space><FileExcelOutlined /> Import Region 3 LGUs</Space>}
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        width={860}
        style={{ maxWidth: "97vw" }}
        footer={
          <Space>
            <Button onClick={downloadTemplate} icon={<DownloadOutlined />}>Template</Button>
            <Button onClick={() => setImportOpen(false)}>Close</Button>
            {!importResult && importRows.length > 0 && (
              <Button type="primary" icon={<ImportOutlined />} loading={importing} onClick={confirmImport}>
                Confirm Import ({importStats.new + importStats.update} valid)
              </Button>
            )}
          </Space>
        }
      >
        <Steps size="small" current={importResult ? 2 : importRows.length ? 1 : 0} style={{ marginBottom: 16 }}
          items={[{ title: "Upload" }, { title: "Preview & validate" }, { title: "Result" }]} />

        {!importRows.length && !importResult && (
          <Upload.Dragger accept=".csv,.xlsx,.xls" beforeUpload={parseFile} showUploadList={false} multiple={false}>
            <p className="ant-upload-drag-icon"><UploadOutlined /></p>
            <p className="ant-upload-text">Click or drag a CSV / XLSX file here</p>
            <p className="ant-upload-hint">Required columns: name, province. Others optional. Use the template for the exact headers.</p>
          </Upload.Dragger>
        )}

        {importRows.length > 0 && !importResult && (
          <>
            <Space wrap style={{ marginBottom: 12 }}>
              <Tag color="blue">New: {importStats.new}</Tag>
              <Tag color="green">Update: {importStats.update}</Tag>
              <Tag color="red">Invalid: {importStats.invalid}</Tag>
              <Tag color="orange">Dup in file: {importStats.dupInFile}</Tag>
              <Button size="small" onClick={() => { setImportRows([]); }}>Choose another file</Button>
            </Space>
            <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Nothing is saved until you confirm. Invalid and in-file-duplicate rows are skipped." />
            <Table
              dataSource={importRows} rowKey="key" size="small" scroll={{ x: 700, y: 300 }}
              pagination={withSizeChanger({ defaultPageSize: 10 })}
              columns={[
                { title: "State", dataIndex: "state", width: 100, render: (s) => s === "new" ? <Tag color="blue">New</Tag> : s === "update" ? <Tag color="green">Update</Tag> : s === "dupInFile" ? <Tag color="orange">Dup</Tag> : <Tag color="red">Invalid</Tag> },
                { title: "Name", dataIndex: "name", ellipsis: true },
                { title: "Type", dataIndex: "lguType", width: 110 },
                { title: "Province", dataIndex: "province", width: 130 },
                { title: "PSGC", dataIndex: "psgcCode", width: 100, render: (v) => v || "—" },
                { title: "Issues", dataIndex: "issues", render: (v) => v.length ? <Text type="danger" style={{ fontSize: 11 }}>{v.join(", ")}</Text> : <Text type="secondary" style={{ fontSize: 11 }}>—</Text> },
              ]}
            />
          </>
        )}

        {importResult && (
          <Row gutter={[12, 12]}>
            <Col xs={12} md={6}><Card size="small"><Statistic title="Created" value={importResult.created} valueStyle={{ color: "#1677ff" }} /></Card></Col>
            <Col xs={12} md={6}><Card size="small"><Statistic title="Updated" value={importResult.updated} valueStyle={{ color: "#52c41a" }} /></Card></Col>
            <Col xs={12} md={6}><Card size="small"><Statistic title="Skipped" value={importResult.skipped} valueStyle={{ color: "#8c8c8c" }} /></Card></Col>
            <Col xs={12} md={6}><Card size="small"><Statistic title="Invalid" value={importResult.invalid} valueStyle={{ color: "#cf1322" }} /></Card></Col>
            {importResult.errors?.length > 0 && (
              <Col span={24}><Alert type="warning" showIcon message={`${importResult.errors.length} row(s) rejected`} description={importResult.errors.slice(0, 10).map((e) => `${e.name}: ${e.error}`).join("; ")} /></Col>
            )}
          </Row>
        )}
      </Modal>
    </div>
  );
}
