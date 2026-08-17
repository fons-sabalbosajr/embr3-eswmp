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
  Segmented,
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
  HistoryOutlined,
  ReloadOutlined,
  SaveOutlined,
  SearchOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import Swal from "sweetalert2";
import dayjs from "dayjs";
import api from "../../api";
import { getSocket } from "../../utils/socket";

const { Text, Title } = Typography;
const DEFAULT_PAGE_SIZE = 12;
// Display-only unit label (a missing unit renders as m³, as it always has).
const normalizeUnit = (unit) => String(unit || "m³").replace("m3", "m³");
const MIN_CORRECTION_REASON = 5;
// Mirrors CORRECTABLE_STATUSES on the server. The button follows the same rule
// the API enforces — it is a convenience, never the authorization.
const CORRECTABLE_STATUSES = ["acknowledged", "pending"];

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
  // Server-paginated list page (only entries with truck volume). The heavy
  // full-dataset load was replaced with (a) a paginated list like Portal
  // Submissions and (b) the per-facility cell rollup below.
  const [pageRecords, setPageRecords] = useState([]);
  // Per-cell fill for the selected facility, computed server-side. This used to
  // be done in the browser by downloading every record of the facility (with
  // full trucks[]) plus the whole /baselines aggregation; both are gone.
  const [overview, setOverview] = useState(null);
  const [facilityLoading, setFacilityLoading] = useState(false);
  const [facilityRefresh, setFacilityRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  // "unassigned" = submissions still awaiting cell placement; "assigned" =
  // submissions already placed (historical/current placement records).
  const [assignmentTab, setAssignmentTab] = useState("unassigned");
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
  // Correct Cell workflow — one placement at a time.
  const [correction, setCorrection] = useState(null);
  const [correctionCell, setCorrectionCell] = useState(undefined);
  const [correctionReason, setCorrectionReason] = useState("");
  const [correcting, setCorrecting] = useState(false);
  const [historyFor, setHistoryFor] = useState(null);

  const page = pagination.current;
  const pageSize = pagination.pageSize;
  const searchTerm = debouncedSearch.trim();

  // Server-paginated submissions list (mirrors the Portal Submissions loading).
  const fetchPage = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoading(true);
      try {
        const { data } = await api.get("/data-slf", {
          params: {
            mode: "list",
            includeTrucks: true,
            withTruckVolume: true,
            assignment: assignmentTab,
            page,
            limit: pageSize,
            ...(searchTerm ? { search: searchTerm } : {}),
          },
        });
        const rows = Array.isArray(data?.data)
          ? data.data
          : Array.isArray(data)
            ? data
            : [];
        const total = typeof data?.total === "number" ? data.total : rows.length;
        setPageRecords(rows);
        setPagination((prev) => ({ ...prev, total }));
        setSelectedId((cur) =>
          rows.some((r) => r._id === cur) ? cur : rows[0]?._id || null,
        );
      } catch {
        setPageRecords([]);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [page, pageSize, searchTerm, assignmentTab],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPagination((prev) => ({ ...prev, current: 1 }));
      setDebouncedSearch(search.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  // A single admin action fans out into several `data-refresh` events (the write
  // itself, then the facility occupancy recompute), and the page ALSO refreshes
  // itself directly after a save. Unthrottled, one Save Placement produced four
  // requests — two list pages and two facility rollups — for one change. Coalesce
  // the socket-driven refresh into one trailing call per burst; the explicit
  // post-save refresh stays, so correctness never depends on socket delivery.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    let timer = null;
    const handler = ({ target } = {}) => {
      if (target && !["submissions", "baselines", "facility"].includes(target)) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        fetchPage({ silent: true });
        setFacilityRefresh((n) => n + 1);
      }, 400);
    };
    socket.on("data-refresh", handler);
    return () => {
      window.clearTimeout(timer);
      socket.off("data-refresh", handler);
    };
  }, [fetchPage]);

  const submissions = pageRecords;
  const selected =
    pageRecords.find((record) => record._id === selectedId) || pageRecords[0] || null;
  const facilityId = selected?.slfGenerator?._id
    ? String(selected.slfGenerator._id)
    : selected?.slfGenerator
      ? String(selected.slfGenerator)
      : "";

  // ONE small request per facility for the whole cell panel. The rollup is
  // computed by the server from the same function that produces the persisted
  // occupancy, so this panel cannot disagree with the dashboard gauges — and the
  // response is sized by the number of CELLS, not the number of submissions.
  useEffect(() => {
    if (!facilityId) {
      setOverview(null);
      return undefined;
    }
    let cancelled = false;
    setFacilityLoading(true);
    api
      .get(`/data-slf/cell-placement-overview/${facilityId}`)
      .then(({ data }) => {
        if (!cancelled) setOverview(data || null);
      })
      .catch(() => {
        if (!cancelled) setOverview(null);
      })
      .finally(() => {
        if (!cancelled) setFacilityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [facilityId, facilityRefresh]);

  const cellRows = useMemo(
    () => (overview?.cells || []).map((cell) => ({ ...cell, key: cell.index })),
    [overview],
  );
  const excludedPreBaselineCount = overview?.excludedPreBaselineCount || 0;
  const preBaselineDetectorEnabled = overview?.preBaselineDetectorEnabled !== false;

  const activeCellOptions = cellRows
    .filter((cell) => cell.active)
    .map((cell) => ({ label: `${cell.label} - ${cell.status}`, value: cell.index }));
  const cellByIndex = useMemo(
    () => new Map(cellRows.map((cell) => [cell.index, cell])),
    [cellRows],
  );

  // One row per PLACEMENT: a vehicle when the truck carries them (that is where
  // the portal records per-vehicle cells), the truck itself otherwise. Both the
  // assignment editor and the correction workflow address a placement by its
  // (truckIndex, vehicleIndex) pair, which is what the API writes back to.
  const placements = useMemo(() => {
    const rows = [];
    (selected?.trucks || []).forEach((truck, truckIndex) => {
      const vehicles = Array.isArray(truck.vehicles) ? truck.vehicles : [];
      const withVolume = vehicles.filter((v) => Number(v?.actualVolume || 0) > 0);
      const source = withVolume.length ? withVolume : null;
      if (!source) {
        rows.push({
          key: `${truckIndex}`,
          truckIndex,
          vehicleIndex: null,
          ticket: truck.disposalTicketNo || truck.plateNumber || "—",
          wasteType: truck.wasteType || "Residual",
          volume: Number(truck.actualVolume || 0),
          unit: normalizeUnit(truck.actualVolumeUnit || selected?.baselineUnit || "m³"),
          cellIndex: truck.cellIndex ?? null,
        });
        return;
      }
      source.forEach((vehicle) => {
        const vehicleIndex = vehicles.indexOf(vehicle);
        rows.push({
          key: `${truckIndex}-${vehicleIndex}`,
          truckIndex,
          vehicleIndex,
          ticket:
            vehicle.plateNumber || truck.disposalTicketNo || truck.plateNumber || "—",
          wasteType: vehicle.wasteType || truck.wasteType || "Residual",
          volume: Number(vehicle.actualVolume || 0),
          unit: normalizeUnit(
            vehicle.actualVolumeUnit || truck.actualVolumeUnit || selected?.baselineUnit || "m³",
          ),
          cellIndex: vehicle.cellIndex ?? null,
        });
      });
    });
    return rows;
  }, [selected]);

  // A correction reassigns waste that is ALREADY placed on a submission the
  // business rules allow to be corrected. The server enforces exactly this.
  const canCorrect =
    canEdit && CORRECTABLE_STATUSES.includes(String(selected?.status || "").toLowerCase());

  // Local (unsaved) edit of one placement's cell. Applied to the loaded record so
  // the table reflects the choice; persisted by Save Placement.
  const updatePlacementCell = (row, cellIndex) => {
    setPageRecords((prev) => prev.map((record) => {
      if (record._id !== selected?._id) return record;
      const cell = cellByIndex.get(cellIndex);
      const patch = {
        cellIndex,
        cellName: cell ? cell.label : "",
        cellType: cell ? cell.type : "",
      };
      const trucks = (record.trucks || []).map((truck, index) => {
        if (index !== row.truckIndex) return truck;
        if (row.vehicleIndex == null) {
          const vehicles = Array.isArray(truck.vehicles)
            ? truck.vehicles.map((v) => ({ ...v, ...patch }))
            : truck.vehicles;
          return { ...truck, ...patch, ...(vehicles ? { vehicles } : {}) };
        }
        const vehicles = (truck.vehicles || []).map((v, vi) =>
          vi === row.vehicleIndex ? { ...v, ...patch } : v,
        );
        // Legacy readers use the truck-level copy, which mirrors vehicle 0 —
        // the same rule the API applies.
        return row.vehicleIndex === 0
          ? { ...truck, ...patch, vehicles }
          : { ...truck, vehicles };
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
    placements
      .filter((row) => selectedTruckIndexes.includes(row.key))
      .forEach((row) => updatePlacementCell(row, bulkCellIndex));
  };

  const savePlacement = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      // One assignment per PLACEMENT, addressed by (truckIndex, vehicleIndex) —
      // a truck's vehicles each carry their own cell, and sending only the truck
      // index silently overwrote all of them with one value.
      const assignments = placements.map((row) => {
        const truck = selected.trucks?.[row.truckIndex] || {};
        const slot = row.vehicleIndex == null ? truck : truck.vehicles?.[row.vehicleIndex] || {};
        const ci = slot.cellIndex;
        // Persist the CURRENT cell name (from the facility's cellRows), not the copy
        // frozen on the truck at a previous assignment — otherwise an admin rename
        // would leave a stale name stored here. Reads re-resolve canonically anyway,
        // but keeping the stored copy current avoids drift between Admin and Portal.
        const match = ci != null ? cellByIndex.get(Number(ci)) : null;
        return {
          truckIndex: row.truckIndex,
          vehicleIndex: row.vehicleIndex,
          cellIndex: ci ?? null,
          cellName:
            match?.label || slot.cellName || (ci != null ? `Cell ${Number(ci) + 1}` : ""),
          cellType: match?.type || slot.cellType || "",
        };
      });
      const { data } = await api.patch(`/data-slf/${selected._id}/cell-assignments`, { assignments });
      const updated = data.data || selected;
      setPageRecords((prev) => prev.map((record) => (record._id === selected._id ? updated : record)));
      // Re-pull the facility rollup so cell-fill totals reflect the save.
      setFacilityRefresh((n) => n + 1);
      // Re-filter the current tab so a now-assigned submission moves out of
      // "For Cell Assignment" into "Assigned Records" (and totals update).
      fetchPage({ silent: true });
      Swal.fire({ icon: "success", title: "Placement Saved", timer: 1100, showConfirmButton: false });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Could not save placement.", "error");
    } finally {
      setSaving(false);
    }
  };

  const openCorrection = (row) => {
    setCorrection(row);
    setCorrectionCell(undefined);
    setCorrectionReason("");
  };

  // Correct Cell — reassign an already-placed volume, with a reason, preserving
  // the original placement in the submission's audit trail.
  const submitCorrection = async () => {
    if (!selected || !correction) return;
    setCorrecting(true);
    try {
      const { data } = await api.patch(
        `/data-slf/${selected._id}/correct-cell-placement`,
        {
          truckIndex: correction.truckIndex,
          vehicleIndex: correction.vehicleIndex,
          // Sent so the server can refuse if somebody else moved this waste
          // while the modal was open.
          fromCellIndex: correction.cellIndex,
          toCellIndex: correctionCell,
          reason: correctionReason.trim(),
          expectedIdNo: selected.idNo || undefined,
        },
      );
      const updated = data.data || selected;
      setPageRecords((prev) => prev.map((record) => (record._id === selected._id ? updated : record)));
      setCorrection(null);
      setCorrectionCell(undefined);
      setCorrectionReason("");
      setFacilityRefresh((n) => n + 1);
      fetchPage({ silent: true });
      Swal.fire({ icon: "success", title: "Placement Corrected", text: data.message, timer: 1600, showConfirmButton: false });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Could not correct the placement.", "error");
    } finally {
      setCorrecting(false);
    }
  };

  const sendAlert = async () => {
    const cell = alertModal.cell;
    if (!cell) return;
    const submissionIds = cell.submissionIds || [];
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
            {/* `fetchReference()` used to be called here and does not exist in this
                component — Refresh threw a ReferenceError before it could reload
                anything. The two refreshes below are the whole page's data. */}
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => { fetchPage(); setFacilityRefresh((n) => n + 1); }}>
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
            <Segmented
              block
              value={assignmentTab}
              onChange={(v) => {
                setAssignmentTab(v);
                setSelectedId(null);
                setPagination((prev) => ({ ...prev, current: 1 }));
              }}
              options={[
                { label: "For Cell Assignment", value: "unassigned" },
                { label: "Assigned Records", value: "assigned" },
              ]}
              style={{ marginBottom: 10 }}
            />
            <List
              size="small"
              loading={loading}
              dataSource={submissions}
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      assignmentTab === "unassigned"
                        ? "No submissions awaiting cell placement"
                        : "No placed submissions yet"
                    }
                  />
                ),
              }}
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
                  preBaselineDetectorEnabled && excludedPreBaselineCount > 0
                    ? `${excludedPreBaselineCount} submission(s) with disposal dates before baseline encoding are currently excluded from cell-fill totals.`
                    : undefined
                }
              />
              <Card
                size="small"
                title={<Space><DatabaseOutlined /> Cell Status</Space>}
                extra={
                  <Text type="secondary">
                    {facilityLoading ? "Loading fills…" : `${cellRows.length} cell(s)`}
                  </Text>
                }
                loading={facilityLoading && cellRows.length === 0}
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
                            <Tag color={cell.active ? "green" : "default"} style={{ width: "fit-content" }}>
                              {cell.status}
                            </Tag>
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              {Number(cell.used || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                              {cell.capacity ? ` / ${Number(cell.capacity).toLocaleString()}` : ""} {cell.unit}
                            </Text>
                            <Text type="secondary" style={{ fontSize: 10 }}>
                              baseline {Number(cell.baselineUsed || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                              {" · "}submitted {Number(cell.submittedUsed || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
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
                          disabled={!cell.submissionCount}
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
                title="Submission Waste Placement"
                extra={
                  <Space wrap>
                    {(selected.cellCorrections || []).length > 0 && (
                      <Button size="small" icon={<HistoryOutlined />} onClick={() => setHistoryFor(selected)}>
                        Corrections ({selected.cellCorrections.length})
                      </Button>
                    )}
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
                  rowKey="key"
                  pagination={false}
                  scroll={{ x: 940 }}
                  dataSource={placements}
                  rowSelection={{
                    selectedRowKeys: selectedTruckIndexes,
                    onChange: (keys) => setSelectedTruckIndexes(keys),
                    getCheckboxProps: () => ({ disabled: !canEdit || activeCellOptions.length === 0 }),
                  }}
                  columns={[
                    { title: "Ticket / Plate", dataIndex: "ticket", width: 150, render: (v) => <Text>{v}</Text> },
                    { title: "Waste Type", dataIndex: "wasteType", width: 140, render: (v) => <Tag>{v}</Tag> },
                    {
                      title: "Volume",
                      width: 120,
                      render: (_, row) => `${row.volume.toLocaleString()} ${row.unit}`,
                    },
                    {
                      title: "Assigned Cell",
                      render: (_, row) => (
                        <Select
                          disabled={!canEdit || activeCellOptions.length === 0}
                          placeholder="Select active cell"
                          style={{ width: "100%" }}
                          allowClear
                          value={row.cellIndex ?? undefined}
                          options={activeCellOptions}
                          onChange={(value) => updatePlacementCell(row, value)}
                        />
                      ),
                    },
                    {
                      title: "Saved",
                      width: 70,
                      align: "center",
                      render: (_, row) => (row.cellIndex != null ? <CheckOutlined style={{ color: "#52c41a" }} /> : "—"),
                    },
                    {
                      title: "Correction",
                      width: 130,
                      align: "center",
                      // Only a placement that HAS a cell can be corrected —
                      // assigning an unplaced one is Save Placement's job.
                      render: (_, row) => (
                        <Tooltip
                          title={
                            row.cellIndex == null
                              ? "Assign a cell first"
                              : !canCorrect
                                ? `A ${String(selected.status || "pending").replace(/_/g, " ")} submission cannot be corrected here`
                                : "Move this waste to a different cell, with a reason"
                          }
                        >
                          <Button
                            size="small"
                            icon={<SwapOutlined />}
                            disabled={!canCorrect || row.cellIndex == null}
                            onClick={() => openCorrection(row)}
                          >
                            Correct Cell
                          </Button>
                        </Tooltip>
                      ),
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

      {/* Correct Cell — the whole change is shown before it is made: which
          submission, which waste, where it is now and where it is going. The
          reason is mandatory because it is what the audit entry records. */}
      <Modal
        title="Correct Waste Placement"
        open={!!correction}
        onCancel={() => setCorrection(null)}
        onOk={submitCorrection}
        okText="Confirm Correction"
        confirmLoading={correcting}
        okButtonProps={{
          icon: <SwapOutlined />,
          disabled:
            correctionCell == null ||
            correctionCell === correction?.cellIndex ||
            correctionReason.trim().length < MIN_CORRECTION_REASON,
        }}
        destroyOnHidden
      >
        {correction && (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Alert
              type="info"
              showIcon
              message="The original placement is preserved"
              description="The submission, its reference and its volume do not change. The cell it was recorded against moves, and the previous cell is kept in the submission's correction history."
            />
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>Submission</Text>
              <div><Text strong>{selected?.idNo || selected?.submissionId || "—"}</Text> · <Text>{getFacilityName(selected)}</Text></div>
            </div>
            <Row gutter={12}>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: 12 }}>Waste</Text>
                <div>
                  <Text strong>{correction.volume.toLocaleString()} {correction.unit}</Text>
                  <div><Text type="secondary" style={{ fontSize: 12 }}>{correction.ticket} · {correction.wasteType}</Text></div>
                </div>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: 12 }}>Current cell</Text>
                <div>
                  <Tag color="orange">
                    {cellByIndex.get(correction.cellIndex)?.label || `Cell ${Number(correction.cellIndex) + 1}`}
                  </Tag>
                </div>
              </Col>
            </Row>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>New cell</Text>
              <Select
                style={{ width: "100%" }}
                placeholder="Select the correct active cell"
                value={correctionCell}
                onChange={setCorrectionCell}
                options={activeCellOptions.filter((o) => o.value !== correction.cellIndex)}
              />
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>Reason for correction (required)</Text>
              <Input.TextArea
                rows={3}
                maxLength={500}
                showCount
                value={correctionReason}
                onChange={(e) => setCorrectionReason(e.target.value)}
                placeholder="e.g. Portal user selected the wrong cell; the load was tipped in Cell 05."
              />
            </div>
          </Space>
        )}
      </Modal>

      {/* Correction history — kept out of the main table so the placement view
          stays readable; opened per submission. */}
      <Modal
        title="Waste Placement Corrections"
        open={!!historyFor}
        onCancel={() => setHistoryFor(null)}
        footer={null}
        width={760}
      >
        <Table
          size="small"
          rowKey={(row, index) => row._id || index}
          pagination={false}
          scroll={{ x: 700 }}
          dataSource={historyFor?.cellCorrections || []}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No corrections recorded" /> }}
          columns={[
            {
              title: "Corrected At",
              dataIndex: "correctedAt",
              width: 160,
              render: (v) => (v ? dayjs(v).format("MMM D, YYYY h:mm A") : "—"),
            },
            {
              title: "Change",
              width: 210,
              render: (_, row) => (
                <Space size={4}>
                  <Tag color="default">{row.fromCellName || `Cell ${Number(row.fromCellIndex) + 1}`}</Tag>
                  <SwapOutlined />
                  <Tag color="blue">{row.toCellName || `Cell ${Number(row.toCellIndex) + 1}`}</Tag>
                </Space>
              ),
            },
            {
              title: "Volume",
              width: 110,
              render: (_, row) =>
                row.volume
                  ? `${Number(row.volume).toLocaleString()} ${normalizeUnit(row.volumeUnit)}`
                  : "—",
            },
            { title: "Corrected By", dataIndex: "correctedBy", width: 180 },
            { title: "Reason", dataIndex: "reason" },
          ]}
        />
      </Modal>
    </div>
  );
}
