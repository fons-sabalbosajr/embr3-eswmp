import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Input,
  List,
  Modal,
  Pagination,
  Progress,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  BellOutlined,
  CheckOutlined,
  DatabaseOutlined,
  ReloadOutlined,
  SaveOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import Swal from "sweetalert2";
import dayjs from "dayjs";
import api from "../../api";
import { fetchWithCache, invalidateCache } from "../../utils/pageCache";
import { getSocket } from "../../utils/socket";
import { rowMatchesSearch } from "./shared/tableFilters";

const { Text, Title } = Typography;
const CACHE_KEY = "cell-waste-placement-cache";
const CACHE_TTL = 2 * 60 * 1000;
const DEFAULT_PAGE_SIZE = 12;
const TON_PER_M3 = 0.2;

const normalizeUnit = (unit) => String(unit || "m³").replace("m3", "m³");
const convertVolume = (value, fromUnit = "m³", toUnit = fromUnit) => {
  const amount = Number(value || 0);
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit || from);
  if (!amount || from === to) return amount;
  if (from === "tons" && to === "m³") return amount / TON_PER_M3;
  if (from === "m³" && to === "tons") return amount * TON_PER_M3;
  return amount;
};

const isActiveCellStatus = (status) =>
  /active|operational|open/i.test(String(status || "Active Cell"));

const statusColor = (pct) => {
  if (pct == null) return "#8c8c8c";
  if (pct >= 90) return "#ff4d4f";
  if (pct >= 75) return "#faad14";
  return "#52c41a";
};

const getFacilityName = (record) =>
  record?.slfName || record?.slfGenerator?.lgu || record?.slfGenerator?.slfName || "Unassigned SLF";

function MiniDonut({ pct, color }) {
  const value = Math.max(0, Math.min(100, Number(pct || 0)));
  return (
    <div
      style={{
        width: 48,
        height: 48,
        borderRadius: "50%",
        background: `conic-gradient(${color} ${value * 3.6}deg, #f0f0f0 0deg)`,
        display: "grid",
        placeItems: "center",
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          background: "#fff",
          display: "grid",
          placeItems: "center",
          fontSize: 10,
          fontWeight: 700,
        }}
      >
        {pct == null ? "—" : `${Math.round(value)}%`}
      </div>
    </div>
  );
}

export default function CellWastePlacement({ canEdit = true }) {
  const [records, setRecords] = useState([]);
  const [baselines, setBaselines] = useState([]);
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    total: 0,
  });
  const [saving, setSaving] = useState(false);
  const [selectedTruckIndexes, setSelectedTruckIndexes] = useState([]);
  const [bulkCellIndex, setBulkCellIndex] = useState(undefined);
  const [alertModal, setAlertModal] = useState({ open: false, cell: null });
  const [alertMessage, setAlertMessage] = useState("");

  const page = pagination.current;
  const pageSize = pagination.pageSize;
  const searchTerm = debouncedSearch.trim();
  const currentCacheKey = useMemo(
    () => [CACHE_KEY, page, pageSize, searchTerm.toLowerCase()].join(":"),
    [page, pageSize, searchTerm],
  );

  const fetchRecords = useCallback(async ({ force = false, silent = false } = {}) => {
    await fetchWithCache(
      currentCacheKey,
      async () => {
        const [recordsRes, baselinesRes, settingsRes] = await Promise.all([
          api.get("/data-slf", {
            params: {
              mode: "list",
              page,
              limit: pageSize,
              search: searchTerm || undefined,
              includeTrucks: true,
              withTruckVolume: true,
            },
          }),
          api.get("/data-slf/baselines"),
          api.get("/settings/app"),
        ]);
        return {
          records: recordsRes.data?.data || [],
          total: Number(recordsRes.data?.total || 0),
          page: Number(recordsRes.data?.page || page),
          pageSize: Number(recordsRes.data?.limit || pageSize),
          baselines: baselinesRes.data || [],
          settings: settingsRes.data || {},
        };
      },
      {
        ttl: CACHE_TTL,
        force,
        onStart: () => !silent && setLoading(true),
        onEnd: () => !silent && setLoading(false),
        onData: (payload = {}) => {
          const next = Array.isArray(payload) ? payload : Array.isArray(payload.records) ? payload.records : [];
          setRecords(next);
          setPagination((prev) => ({
            ...prev,
            current: payload.page || prev.current,
            pageSize: payload.pageSize || prev.pageSize,
            total: typeof payload.total === "number" ? payload.total : next.length,
          }));
          setBaselines(Array.isArray(payload.baselines) ? payload.baselines : []);
          setSettings(payload.settings || {});
          setSelectedId((current) => next.some((row) => row._id === current) ? current : next[0]?._id || null);
          setLoading(false);
        },
      },
    );
  }, [currentCacheKey, page, pageSize, searchTerm]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPagination((prev) => ({ ...prev, current: 1 }));
      setDebouncedSearch(search.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const handler = ({ target } = {}) => {
      if (!target || target === "submissions") {
        invalidateCache(currentCacheKey);
        fetchRecords({ force: true, silent: true });
      }
    };
    socket.on("data-refresh", handler);
    return () => socket.off("data-refresh", handler);
  }, [currentCacheKey, fetchRecords]);

  const submissions = useMemo(() => {
    return records.filter((record) => (record.trucks || []).some((truck) => Number(truck.actualVolume || 0) > 0));
  }, [records]);

  const filteredSubmissions = useMemo(() => {
    if (!search.trim()) return submissions;
    return submissions.filter((record) =>
      rowMatchesSearch(record, search, [
        "idNo",
        "submissionId",
        "lguCompanyName",
        "companyType",
        "submittedBy",
        (item) => getFacilityName(item),
        (item) => (item.createdAt ? dayjs(item.createdAt).format("MM/DD/YYYY") : ""),
      ]),
    );
  }, [search, submissions]);

  const selected = filteredSubmissions.find((record) => record._id === selectedId) || filteredSubmissions[0] || null;
  const facility = selected?.slfGenerator || {};
  const baselineMap = useMemo(() => {
    const map = new Map();
    baselines.forEach((baseline) => {
      const key = String(baseline.slfName || baseline.lguCompanyName || "").trim().toLowerCase();
      if (key) map.set(key, baseline);
    });
    return map;
  }, [baselines]);

  const getBaselineForRecord = (record) =>
    baselineMap.get(String(getFacilityName(record) || "").trim().toLowerCase()) || null;

  const shouldCountRecord = (record) => {
    if (!settings.excludePreBaselineDisposalFromCellFill) return true;
    const baseline = getBaselineForRecord(record);
    const baselineDate = baseline?.lastUpdated || baseline?.createdAt;
    if (!baselineDate || !record?.dateOfDisposal) return true;
    const disposalBeforeBaseline = dayjs(record.dateOfDisposal).startOf("day").isBefore(dayjs(baselineDate).startOf("day"));
    const submittedAfterBaseline = record.createdAt && dayjs(record.createdAt).isAfter(dayjs(baselineDate));
    return !disposalBeforeBaseline || submittedAfterBaseline;
  };

  const excludedPreBaselineCount = useMemo(() =>
    records.filter((record) => (record.trucks || []).length && !shouldCountRecord(record)).length,
  [records, settings.excludePreBaselineDisposalFromCellFill, baselineMap]);

  const cellRows = useMemo(() => {
    if (!selected) return [];
    const cellCount = Math.max(
      Number(facility.numberOfCell || 0),
      facility.cellCapacities?.length || 0,
      facility.cellStatuses?.length || 0,
      1,
    );
    const rows = Array.from({ length: cellCount }, (_, index) => {
      const unit = normalizeUnit(facility.cellCapacityUnits?.[index] || facility.cellFillUnits?.[index] || selected.baselineUnit || "m³");
      const capacity = Number(facility.cellCapacities?.[index] || 0);
      const baseFill = convertVolume(facility.cellFillValues?.[index] || 0, facility.cellFillUnits?.[index] || unit, unit);
      return {
        index,
        key: index,
        label: `Cell ${index + 1}`,
        status: facility.cellStatuses?.[index] || "Active Cell",
        type: facility.cellTypes?.[index] || "Residual",
        unit,
        capacity,
        used: baseFill,
        submissions: [],
      };
    });
    records.forEach((record) => {
      if (getFacilityName(record) !== getFacilityName(selected) || !shouldCountRecord(record)) return;
      (record.trucks || []).forEach((truck, truckIndex) => {
        if (truck.cellIndex == null) return;
        const row = rows[Number(truck.cellIndex)];
        if (!row) return;
        const volume = convertVolume(truck.actualVolume, truck.actualVolumeUnit || record.baselineUnit || row.unit, row.unit);
        row.used += volume;
        row.submissions.push({ record, truck, truckIndex, volume });
      });
    });
    return rows.map((row) => ({
      ...row,
      pct: row.capacity > 0 ? Math.min(100, (row.used / row.capacity) * 100) : null,
      remaining: row.capacity > 0 ? Math.max(0, row.capacity - row.used) : null,
    }));
  }, [facility, records, selected, settings.excludePreBaselineDisposalFromCellFill, baselineMap]);

  const activeCellOptions = cellRows
    .filter((cell) => isActiveCellStatus(cell.status))
    .map((cell) => ({ label: `${cell.label} - ${cell.status}`, value: cell.index }));

  const updateTruckCell = (truckIndex, cellIndex) => {
    setRecords((prev) => prev.map((record) => {
      if (record._id !== selected?._id) return record;
      const trucks = (record.trucks || []).map((truck, index) => {
        if (index !== truckIndex) return truck;
        const cell = cellRows.find((item) => item.index === cellIndex);
        return {
          ...truck,
          cellIndex,
          cellName: cell ? cell.label : "",
          cellType: cell ? cell.type : "",
        };
      });
      return { ...record, trucks };
    }));
  };

  useEffect(() => {
    setSelectedTruckIndexes([]);
    setBulkCellIndex(undefined);
  }, [selected?._id]);

  const applyBulkCell = () => {
    if (!selected || bulkCellIndex == null || selectedTruckIndexes.length === 0) return;
    setRecords((prev) => prev.map((record) => {
      if (record._id !== selected._id) return record;
      const cell = cellRows.find((item) => item.index === bulkCellIndex);
      const trucks = (record.trucks || []).map((truck, index) => {
        if (!selectedTruckIndexes.includes(index)) return truck;
        return {
          ...truck,
          cellIndex: bulkCellIndex,
          cellName: cell ? cell.label : "",
          cellType: cell ? cell.type : "",
        };
      });
      return { ...record, trucks };
    }));
  };

  const savePlacement = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const assignments = (selected.trucks || []).map((truck, truckIndex) => ({
        truckIndex,
        cellIndex: truck.cellIndex ?? null,
        cellName: truck.cellName || (truck.cellIndex != null ? `Cell ${Number(truck.cellIndex) + 1}` : ""),
        cellType: truck.cellType || "",
      }));
      const { data } = await api.patch(`/data-slf/${selected._id}/cell-assignments`, { assignments });
      const updated = data.data || selected;
      setRecords((prev) => prev.map((record) => (record._id === selected._id ? updated : record)));
      invalidateCache(currentCacheKey);
      Swal.fire({ icon: "success", title: "Placement Saved", timer: 1100, showConfirmButton: false });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Could not save placement.", "error");
    } finally {
      setSaving(false);
    }
  };

  const sendAlert = async () => {
    const cell = alertModal.cell;
    if (!cell) return;
    const submissionIds = [...new Set(cell.submissions.map((item) => item.record._id).filter(Boolean))];
    try {
      await api.post("/data-slf/cell-capacity-alert", {
        submissionIds,
        cellName: cell.label,
        slfName: getFacilityName(selected),
        message: alertMessage.trim() || undefined,
      });
      setAlertModal({ open: false, cell: null });
      setAlertMessage("");
      Swal.fire({ icon: "success", title: "Notification Sent", timer: 1200, showConfirmButton: false });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Could not send notification.", "error");
    }
  };

  return (
    <div>
      <Card style={{ borderRadius: 8, marginBottom: 12 }}>
        <Space style={{ width: "100%", justifyContent: "space-between", flexWrap: "wrap" }}>
          <div>
            <Title level={5} style={{ margin: 0 }}>Cell Waste Placement</Title>
            <Text type="secondary">Assign portal submission truck volumes to active landfill cells.</Text>
          </div>
          <Space wrap>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => fetchRecords({ force: true })}>
              Refresh
            </Button>
          </Space>
        </Space>
      </Card>

      <Row gutter={12}>
        <Col xs={24} lg={8}>
          <Card
            size="small"
            title="Portal Submissions"
            extra={
              <Input
                allowClear
                prefix={<SearchOutlined />}
                placeholder="Search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: 220 }}
              />
            }
            style={{ borderRadius: 8 }}
          >
            <List
              size="small"
              loading={loading}
                dataSource={filteredSubmissions}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No submissions with truck volume" /> }}
              style={{ maxHeight: 640, overflow: "auto" }}
              renderItem={(record) => (
                <List.Item
                  onClick={() => setSelectedId(record._id)}
                  style={{
                    cursor: "pointer",
                    borderRadius: 6,
                    padding: 10,
                    background: record._id === selected?._id ? "#e6f4ff" : "transparent",
                  }}
                >
                  <List.Item.Meta
                    title={<Text strong>{record.idNo || record.submissionId || "No ID"}</Text>}
                    description={
                      <Space direction="vertical" size={0}>
                        <Text style={{ fontSize: 12 }}>{record.lguCompanyName || "Unnamed generator"}</Text>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {getFacilityName(record)} • {record.createdAt ? dayjs(record.createdAt).format("MM/DD/YYYY") : "No date"}
                        </Text>
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
            <Pagination
              current={pagination.current}
              pageSize={pagination.pageSize}
              total={pagination.total}
              size="small"
              showSizeChanger
              pageSizeOptions={["12", "24", "48"]}
              showTotal={(total) => `${total} submissions`}
              onChange={(nextPage, nextPageSize) => {
                setSelectedId(null);
                setPagination((prev) => ({
                  ...prev,
                  current: nextPage,
                  pageSize: nextPageSize || prev.pageSize,
                }));
              }}
              style={{ marginTop: 12, textAlign: "right" }}
            />
          </Card>
        </Col>
        <Col xs={24} lg={16}>
          {!selected ? (
            <Card style={{ borderRadius: 8 }}><Empty description="Select a submission" /></Card>
          ) : (
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Alert
                type={activeCellOptions.length ? "info" : "warning"}
                showIcon
                message={activeCellOptions.length ? `Assigning waste for ${getFacilityName(selected)}` : "No active landfill cells are configured for this SLF."}
                description={
                  settings.preBaselineDisposalDetectorEnabled && excludedPreBaselineCount > 0
                    ? `${excludedPreBaselineCount} submission(s) with disposal dates before baseline encoding are currently excluded from cell-fill totals.`
                    : undefined
                }
              />
              <Card
                size="small"
                title={<Space><DatabaseOutlined /> Cell Status</Space>}
                extra={<Text type="secondary">{cellRows.length} cell(s)</Text>}
                style={{ borderRadius: 8 }}
              >
                <Row gutter={[10, 10]}>
                  {cellRows.map((cell) => (
                    <Col xs={24} md={12} xl={8} key={cell.key}>
                      <div style={{ border: "1px solid #f0f0f0", borderRadius: 8, padding: 10, minHeight: 126 }}>
                        <Space align="start">
                          <MiniDonut pct={cell.pct} color={statusColor(cell.pct)} />
                          <Space direction="vertical" size={2}>
                            <Text strong>{cell.label}</Text>
                            <Tag color={isActiveCellStatus(cell.status) ? "green" : "default"} style={{ width: "fit-content" }}>
                              {cell.status}
                            </Tag>
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              {Number(cell.used || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                              {cell.capacity ? ` / ${Number(cell.capacity).toLocaleString()}` : ""} {cell.unit}
                            </Text>
                          </Space>
                        </Space>
                        <Progress
                          percent={cell.pct == null ? 0 : Math.round(cell.pct)}
                          showInfo={false}
                          strokeColor={statusColor(cell.pct)}
                          style={{ marginTop: 8 }}
                        />
                        <Button
                          size="small"
                          icon={<BellOutlined />}
                          disabled={!cell.submissions.length}
                          style={{ marginTop: 8 }}
                          onClick={() => {
                            setAlertModal({ open: true, cell });
                            setAlertMessage(`The ${cell.label} at ${getFacilityName(selected)} is now approximately ${Math.round(cell.pct || 0)}% full. Please coordinate with EMB Region III before the next disposal.`);
                          }}
                        >
                          Notify Users
                        </Button>
                      </div>
                    </Col>
                  ))}
                </Row>
              </Card>

              <Card
                size="small"
                title="Submission Truck Placement"
                extra={
                  <Space wrap>
                    <Select
                      disabled={!canEdit || activeCellOptions.length === 0 || selectedTruckIndexes.length === 0}
                      placeholder="Cell for selected"
                      allowClear
                      value={bulkCellIndex}
                      options={activeCellOptions}
                      onChange={setBulkCellIndex}
                      style={{ width: 180 }}
                    />
                    <Button disabled={!canEdit || bulkCellIndex == null || selectedTruckIndexes.length === 0} onClick={applyBulkCell}>
                      Apply to Selected
                    </Button>
                    <Tooltip title={canEdit ? "Save placement" : "You do not have edit access"}>
                      <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!canEdit} onClick={savePlacement}>
                        Save Placement
                      </Button>
                    </Tooltip>
                  </Space>
                }
                style={{ borderRadius: 8 }}
              >
                <Table
                  size="small"
                  rowKey={(_, index) => index}
                  pagination={false}
                  scroll={{ x: 820 }}
                  dataSource={selected.trucks || []}
                  rowSelection={{
                    selectedRowKeys: selectedTruckIndexes,
                    onChange: (keys) => setSelectedTruckIndexes(keys.map(Number)),
                    getCheckboxProps: () => ({ disabled: !canEdit || activeCellOptions.length === 0 }),
                  }}
                  columns={[
                    { title: "Ticket / Plate", width: 160, render: (_, truck) => <Text>{truck.disposalTicketNo || truck.plateNumber || "—"}</Text> },
                    { title: "Waste Type", width: 150, render: (_, truck) => <Tag>{truck.wasteType || "Residual"}</Tag> },
                    {
                      title: "Volume",
                      width: 130,
                      render: (_, truck) => `${Number(truck.actualVolume || 0).toLocaleString()} ${normalizeUnit(truck.actualVolumeUnit || selected.baselineUnit || "m³")}`,
                    },
                    {
                      title: "Assigned Cell",
                      render: (_, truck, index) => (
                        <Select
                          disabled={!canEdit || activeCellOptions.length === 0}
                          placeholder="Select active cell"
                          style={{ width: "100%" }}
                          allowClear
                          value={truck.cellIndex ?? undefined}
                          options={activeCellOptions}
                          onChange={(value) => updateTruckCell(index, value)}
                        />
                      ),
                    },
                    {
                      title: "Saved",
                      width: 80,
                      align: "center",
                      render: (_, truck) => truck.cellIndex != null ? <CheckOutlined style={{ color: "#52c41a" }} /> : "—",
                    },
                  ]}
                />
              </Card>
            </Space>
          )}
        </Col>
      </Row>

      <Modal
        title="Send Cell Capacity Notification"
        open={alertModal.open}
        onCancel={() => setAlertModal({ open: false, cell: null })}
        onOk={sendAlert}
        okText="Send Notification"
        okButtonProps={{ icon: <BellOutlined /> }}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Text type="secondary">
            This sends a portal notification to users with submissions assigned to {alertModal.cell?.label || "this cell"}.
          </Text>
          <Input.TextArea
            rows={4}
            value={alertMessage}
            onChange={(e) => setAlertMessage(e.target.value)}
          />
        </Space>
      </Modal>
    </div>
  );
}
