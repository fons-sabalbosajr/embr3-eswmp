import { useEffect, useMemo, useState } from "react";
import {
  Collapse,
  Table,
  Button,
  Space,
  Tag,
  Progress,
  Modal,
  Descriptions,
  Input,
  InputNumber,
  Select,
  Typography,
  Empty,
  Tooltip,
  message,
} from "antd";
import {
  ContainerOutlined,
  EyeOutlined,
  EditOutlined,
  PlusOutlined,
  DeleteOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import GaugeMeter, { computeGaugePercent } from "../../components/GaugeMeter";
import { withSizeChanger } from "../../utils/tablePagination";
import api from "../../api";

const { Text } = Typography;

const RESIDUAL_COLOR = "#52c41a";
const HAZARD_COLOR = "#cf1322";
const HAZARD_RE = /hazard/i;
const DELETED_RE = /not\s*exist/i;

const CELL_TYPE_OPTIONS = [
  { label: "Residual", value: "Residual" },
  { label: "Treated Hazardous Waste", value: "Treated Hazardous Waste" },
  { label: "Hazardous Waste", value: "Hazardous Waste" },
];
const CELL_STATUS_OPTIONS = [
  { label: "Active Cell", value: "Active Cell" },
  { label: "Used/Completed", value: "Used/Completed" },
  { label: "Under Construction", value: "Under Construction" },
  { label: "Reserved Area", value: "Reserved Area" },
  { label: "Not Existed", value: "Not Existed" },
];
const UNIT_OPTIONS = [
  { label: "m³", value: "m³" },
  { label: "tons", value: "tons" },
];

// The declared unit for an SLF — never fabricated.
function deriveUnit(facility) {
  return (
    facility?.wasteReceivedUnit ||
    (facility?.cellCapacityUnits || []).find(Boolean) ||
    (facility?.cellFillUnits || []).find(Boolean) ||
    facility?.baselineUnit ||
    ""
  );
}

// Derive the real cells from the facility's existing cell-infra arrays. Deleted
// cells ("Not Existed") are excluded; missing capacity/volume stay null/0 so the
// gauge shows "no data" rather than a fabricated value.
function deriveCells(facility) {
  if (!facility) return [];
  const caps = facility.cellCapacities || [];
  const fills = facility.cellFillValues || [];
  const types = facility.cellTypes || [];
  const statuses = facility.cellStatuses || [];
  const names = facility.cellNames || [];
  const capUnits = facility.cellCapacityUnits || [];
  const n = Math.max(
    Number(facility.numberOfCell || 0),
    caps.length,
    fills.length,
    types.length,
    statuses.length,
  );
  const cells = [];
  for (let i = 0; i < n; i += 1) {
    const status = statuses[i] || "Active Cell";
    if (DELETED_RE.test(status)) continue; // deleted cell — not shown/counted
    const capacity = Number(caps[i]);
    const usedRaw = Number(fills[i]);
    const used = Number.isFinite(usedRaw) ? usedRaw : 0;
    const type = types[i] || "Residual";
    const cap = Number.isFinite(capacity) ? capacity : null;
    cells.push({
      index: i,
      name: names[i] || `Cell ${i + 1}`, // project fallback convention
      type,
      isHazardous: HAZARD_RE.test(type),
      status,
      capacity: cap,
      used,
      unit: capUnits[i] || deriveUnit(facility) || "m³",
      percent: computeGaugePercent({ usedCapacity: used, totalCapacity: cap }),
      remaining: cap != null ? Math.max(0, cap - used) : null,
    });
  }
  return cells;
}

// Aggregate utilization across a subset of cells (used for Total Cell Utilization).
function aggregate(cells) {
  let usedSum = 0;
  let capSum = 0;
  let hasCap = false;
  cells.forEach((c) => {
    usedSum += c.used || 0;
    if (c.capacity != null && c.capacity > 0) {
      capSum += c.capacity;
      hasCap = true;
    }
  });
  return {
    usedSum,
    capSum,
    count: cells.length,
    percent: hasCap ? computeGaugePercent({ usedCapacity: usedSum, totalCapacity: capSum }) : null,
  };
}

// One compact gauge per cell — small, thin, readable in a table row.
function CellGauge({ cell }) {
  const color = cell.isHazardous ? HAZARD_COLOR : RESIDUAL_COLOR;
  return (
    <div style={{ textAlign: "center", minWidth: 62 }}>
      <GaugeMeter
        percent={cell.percent}
        color={color}
        size={52}
        thickness={6}
        percentFontSize={11}
        noDataFontSize={9}
        noDataText="n/a"
      />
      <Tooltip title={`${cell.type}${cell.status ? ` · ${cell.status}` : ""}`}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 400,
            marginTop: 1,
            color,
            maxWidth: 70,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {cell.name}
        </div>
      </Tooltip>
    </div>
  );
}

export default function CellInfraOverview({ rows = [], isDark, canEdit = true, onEdited }) {
  const [expanded, setExpanded] = useState(false);
  const [viewRow, setViewRow] = useState(null);
  const [editRow, setEditRow] = useState(null);
  const [editCells, setEditCells] = useState([]);
  const [saving, setSaving] = useState(false);

  // One row per facility (dedup across summary rows), with derived cell metrics.
  // Only computed once the card is expanded (avoids the per-cell work on every
  // Portal Submissions load while the card stays collapsed).
  const overviewRows = useMemo(() => {
    if (!expanded) return [];
    const map = new Map();
    rows.forEach((r) => {
      const f = r.facility;
      if (!f?._id) return;
      const id = String(f._id);
      if (!map.has(id)) {
        map.set(id, {
          key: id,
          facility: f,
          slfName: r.slfName || f.lgu || f.slfName || "—",
          submissions: 0,
        });
      }
      map.get(id).submissions += Number(r.submissions || 0);
    });
    return [...map.values()]
      .map((o) => {
        const cells = deriveCells(o.facility);
        return {
          ...o,
          cells,
          totalAgg: aggregate(cells),
          unit: deriveUnit(o.facility),
        };
      })
      .sort((a, b) => (b.submissions || 0) - (a.submissions || 0));
  }, [rows, expanded]);

  // Keep an open View modal in sync after an edit refreshes the underlying rows.
  useEffect(() => {
    if (!viewRow) return;
    const fresh = overviewRows.find((r) => r.key === viewRow.key);
    if (fresh && fresh !== viewRow) setViewRow(fresh);
  }, [overviewRows]); // eslint-disable-line react-hooks/exhaustive-deps

  const openEdit = (row) => {
    setEditRow(row);
    setEditCells(
      row.cells.map((c) => ({
        _origIndex: c.index,
        name: c.name,
        type: c.type,
        status: c.status,
        capacity: c.capacity,
        unit: c.unit,
      })),
    );
  };

  const saveEdit = async () => {
    if (!editRow) return;
    const facility = editRow.facility;
    const origFills = facility.cellFillValues || [];
    const origFillUnits = facility.cellFillUnits || [];
    const payload = {
      numberOfCell: editCells.length,
      cellNames: editCells.map((c) => c.name || ""),
      cellTypes: editCells.map((c) => c.type || "Residual"),
      cellStatuses: editCells.map((c) => c.status || "Active Cell"),
      cellCapacities: editCells.map((c) =>
        c.capacity === null || c.capacity === undefined || c.capacity === "" ? null : Number(c.capacity),
      ),
      cellCapacityUnits: editCells.map((c) => c.unit || "m³"),
      // Keep existing fill volumes aligned to their cell (new cells start empty).
      cellFillValues: editCells.map((c) =>
        c._origIndex != null && origFills[c._origIndex] != null ? origFills[c._origIndex] : null,
      ),
      cellFillUnits: editCells.map((c) =>
        c._origIndex != null && origFillUnits[c._origIndex] != null
          ? origFillUnits[c._origIndex]
          : c.unit || "m³",
      ),
    };
    setSaving(true);
    try {
      await api.put(`/slf-facilities/${facility._id}`, payload);
      message.success("Cell infrastructure updated.");
      setEditRow(null);
      // Refresh only the affected SLF cell-infra data; the parent re-fetches
      // facilities → new `rows` → overviewRows/gauges/Total Utilization update,
      // and the open View modal syncs via the effect above.
      onEdited?.();
    } catch (err) {
      message.error(err.response?.data?.message || "Could not update cell infrastructure.");
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    {
      title: "SLF",
      dataIndex: "slfName",
      key: "slf",
      fixed: "left",
      width: 200,
      render: (v, r) => (
        <Space direction="vertical" size={0}>
          <Text strong style={{ fontSize: 12 }}>{v}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {r.cells.length} cell{r.cells.length === 1 ? "" : "s"}
          </Text>
        </Space>
      ),
    },
    {
      title: "Submissions",
      dataIndex: "submissions",
      key: "submissions",
      width: 100,
      align: "center",
      sorter: (a, b) => (a.submissions || 0) - (b.submissions || 0),
      render: (v) => <Tag color="blue">{Number(v || 0).toLocaleString()}</Tag>,
    },
    {
      title: "Unit",
      dataIndex: "unit",
      key: "unit",
      width: 90,
      align: "center",
      render: (v) => (v ? <Tag>{v}</Tag> : <Text type="secondary">—</Text>),
    },
    {
      title: "Cell Gauge Charts",
      key: "gauges",
      width: 360,
      render: (_, r) =>
        r.cells.length ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "2px 0" }}>
            {r.cells.map((c) => (
              <CellGauge key={c.index} cell={c} />
            ))}
          </div>
        ) : (
          <Text type="secondary" style={{ fontSize: 11 }}>No cells configured</Text>
        ),
    },
    {
      title: "Total Cell Utilization",
      key: "total",
      width: 180,
      render: (_, r) => {
        const pct = r.totalAgg.percent;
        if (pct == null) return <Text type="secondary" style={{ fontSize: 12 }}>No capacity data</Text>;
        const rounded = parseFloat(pct.toFixed(2));
        const used = parseFloat(r.totalAgg.usedSum.toFixed(2)).toLocaleString();
        const cap = parseFloat(r.totalAgg.capSum.toFixed(2)).toLocaleString();
        return (
          <div>
            <Progress
              percent={rounded}
              size="small"
              status={rounded >= 90 ? "exception" : rounded >= 75 ? "active" : "normal"}
              strokeColor={rounded >= 90 ? "#ff4d4f" : rounded >= 75 ? "#faad14" : "#52c41a"}
            />
            <Text type="secondary" style={{ fontSize: 11 }}>
              {used} / {cap} {r.unit || ""}
            </Text>
          </div>
        );
      },
    },
    {
      title: "Actions",
      key: "actions",
      fixed: "right",
      width: 150,
      render: (_, r) => (
        <Space>
          <Button size="small" icon={<EyeOutlined />} onClick={() => setViewRow(r)}>
            View
          </Button>
          {canEdit && (
            <Button size="small" type="primary" ghost icon={<EditOutlined />} onClick={() => openEdit(r)}>
              Edit
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <>
      <Collapse
        style={{ marginBottom: 16, borderRadius: 10 }}
        onChange={(keys) => setExpanded((Array.isArray(keys) ? keys : [keys]).includes("cell-infra"))}
        items={[
          {
            key: "cell-infra",
            label: (
              <Space>
                <ContainerOutlined style={{ color: "#13c2c2" }} />
                <Text strong>Cell Infra Overview</Text>
              </Space>
            ),
            children: expanded ? (
              overviewRows.length ? (
                <Table
                  size="small"
                  rowKey="key"
                  columns={columns}
                  dataSource={overviewRows}
                  scroll={{ x: 1080 }}
                  pagination={withSizeChanger({ pageSize: 10, size: "small", showTotal: (t) => `${t} SLF` })}
                />
              ) : (
                <Empty description="No SLF cell infrastructure to show yet" />
              )
            ) : null,
          },
        ]}
      />

      {/* View: per-cell gauges + details for the selected SLF */}
      <Modal
        open={!!viewRow}
        onCancel={() => setViewRow(null)}
        footer={<Button onClick={() => setViewRow(null)}>Close</Button>}
        width={920}
        title={
          <Space>
            <ContainerOutlined style={{ color: "#13c2c2" }} />
            {viewRow?.slfName} — Cell Infrastructure
          </Space>
        }
      >
        {viewRow && (
          <>
            <Descriptions size="small" column={3} bordered style={{ marginBottom: 12 }}>
              <Descriptions.Item label="Submissions">
                {Number(viewRow.submissions || 0).toLocaleString()}
              </Descriptions.Item>
              <Descriptions.Item label="Unit">{viewRow.unit || "—"}</Descriptions.Item>
              <Descriptions.Item label="Total Utilization">
                {viewRow.totalAgg.percent == null
                  ? "No capacity data"
                  : `${parseFloat(viewRow.totalAgg.percent.toFixed(2))}%`}
              </Descriptions.Item>
            </Descriptions>
            <Table
              size="small"
              rowKey="index"
              dataSource={viewRow.cells}
              pagination={false}
              scroll={{ x: 780 }}
              locale={{ emptyText: <Empty description="No cells configured" /> }}
              columns={[
                {
                  title: "Gauge",
                  key: "gauge",
                  width: 90,
                  align: "center",
                  render: (_, c) => <CellGauge cell={c} />,
                },
                { title: "Cell Name", dataIndex: "name", key: "name", render: (v) => <Text strong style={{ fontSize: 12 }}>{v}</Text> },
                {
                  title: "Type",
                  dataIndex: "type",
                  key: "type",
                  render: (v, c) => <Tag color={c.isHazardous ? "volcano" : "green"}>{v}</Tag>,
                },
                { title: "Status", dataIndex: "status", key: "status", render: (v) => <Tag>{v}</Tag> },
                {
                  title: "Capacity",
                  dataIndex: "capacity",
                  key: "capacity",
                  align: "right",
                  render: (v, c) => (v == null ? <Text type="secondary">—</Text> : `${parseFloat(Number(v).toFixed(2)).toLocaleString()} ${c.unit}`),
                },
                {
                  title: "Used",
                  dataIndex: "used",
                  key: "used",
                  align: "right",
                  render: (v, c) => `${parseFloat(Number(v || 0).toFixed(2)).toLocaleString()} ${c.unit}`,
                },
                {
                  title: "Remaining",
                  dataIndex: "remaining",
                  key: "remaining",
                  align: "right",
                  render: (v, c) => (v == null ? <Text type="secondary">—</Text> : `${parseFloat(Number(v).toFixed(2)).toLocaleString()} ${c.unit}`),
                },
              ]}
            />
          </>
        )}
      </Modal>

      {/* Edit: manage the existing cell infrastructure (reuses PUT /slf-facilities/:id) */}
      <Modal
        open={!!editRow}
        onCancel={() => setEditRow(null)}
        onOk={saveEdit}
        okText="Save"
        okButtonProps={{ icon: <SaveOutlined />, loading: saving }}
        width={920}
        title={
          <Space>
            <EditOutlined /> Edit Cell Infrastructure — {editRow?.slfName}
          </Space>
        }
      >
        <Space style={{ marginBottom: 12 }}>
          <Button
            icon={<PlusOutlined />}
            onClick={() =>
              setEditCells((prev) => [
                ...prev,
                { _origIndex: null, name: `Cell ${prev.length + 1}`, type: "Residual", status: "Active Cell", capacity: null, unit: editRow?.unit || "m³" },
              ])
            }
          >
            Add Cell
          </Button>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Saving updates the shared SLF record; the table, gauges, and utilization refresh automatically.
          </Text>
        </Space>
        <Table
          size="small"
          rowKey={(_, i) => i}
          dataSource={editCells}
          pagination={false}
          scroll={{ x: 760 }}
          locale={{ emptyText: <Empty description="No cells — add one" /> }}
          columns={[
            {
              title: "Cell Name",
              key: "name",
              render: (_, c, i) => (
                <Input
                  size="small"
                  value={c.name}
                  onChange={(e) =>
                    setEditCells((prev) => prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                  }
                />
              ),
            },
            {
              title: "Type",
              key: "type",
              width: 190,
              render: (_, c, i) => (
                <Select
                  size="small"
                  style={{ width: "100%" }}
                  value={c.type}
                  options={CELL_TYPE_OPTIONS}
                  onChange={(v) => setEditCells((prev) => prev.map((x, j) => (j === i ? { ...x, type: v } : x)))}
                />
              ),
            },
            {
              title: "Status",
              key: "status",
              width: 160,
              render: (_, c, i) => (
                <Select
                  size="small"
                  style={{ width: "100%" }}
                  value={c.status}
                  options={CELL_STATUS_OPTIONS}
                  onChange={(v) => setEditCells((prev) => prev.map((x, j) => (j === i ? { ...x, status: v } : x)))}
                />
              ),
            },
            {
              title: "Capacity",
              key: "capacity",
              width: 130,
              render: (_, c, i) => (
                <InputNumber
                  size="small"
                  style={{ width: "100%" }}
                  min={0}
                  value={c.capacity}
                  placeholder="—"
                  onChange={(v) => setEditCells((prev) => prev.map((x, j) => (j === i ? { ...x, capacity: v } : x)))}
                />
              ),
            },
            {
              title: "Unit",
              key: "unit",
              width: 90,
              render: (_, c, i) => (
                <Select
                  size="small"
                  style={{ width: "100%" }}
                  value={c.unit}
                  options={UNIT_OPTIONS}
                  onChange={(v) => setEditCells((prev) => prev.map((x, j) => (j === i ? { ...x, unit: v } : x)))}
                />
              ),
            },
            {
              title: "",
              key: "remove",
              width: 44,
              render: (_, c, i) => (
                <Button
                  size="small"
                  danger
                  type="text"
                  icon={<DeleteOutlined />}
                  onClick={() => setEditCells((prev) => prev.filter((_, j) => j !== i))}
                />
              ),
            },
          ]}
        />
      </Modal>
    </>
  );
}
