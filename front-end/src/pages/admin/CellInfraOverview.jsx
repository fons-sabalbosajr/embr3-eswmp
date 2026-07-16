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
  Popover,
  Avatar,
  Badge,
  Skeleton,
  message,
} from "antd";
import {
  ContainerOutlined,
  EyeOutlined,
  EditOutlined,
  PlusOutlined,
  DeleteOutlined,
  SaveOutlined,
  EnvironmentOutlined,
  UserOutlined,
} from "@ant-design/icons";
import GaugeMeter, { computeGaugePercent } from "../../components/GaugeMeter";
import { withSizeChanger } from "../../utils/tablePagination";
import {
  getCellTypeConfig,
  getCellStatusConfig,
  isNonExistentCell,
  getCapacityStatus,
  CELL_TYPE_OPTIONS,
  CELL_STATUS_OPTIONS,
} from "../../utils/cellVisuals";
import api from "../../api";

const { Text } = Typography;

const ACCENT = "#2f54eb";

const UNIT_OPTIONS = [
  { label: "m³", value: "m³" },
  { label: "tons", value: "tons" },
];

const fmt = (v) => parseFloat(Number(v || 0).toFixed(2)).toLocaleString();

// Placeholder rows for the skeleton table (5 ≈ a typical first page).
const SKELETON_ROWS = Array.from({ length: 5 }, (_, i) => ({ key: `skeleton-${i}` }));

// SLF postal-ish address from the facility's existing location fields. Only real
// stored values are joined — never a fabricated placeholder.
function deriveAddress(facility) {
  return [facility?.barangay, facility?.lgu, facility?.province]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(", ");
}

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
    if (isNonExistentCell(status)) continue; // deleted cell — not shown/counted
    const capacity = Number(caps[i]);
    const usedRaw = Number(fills[i]);
    const used = Number.isFinite(usedRaw) ? usedRaw : 0;
    const type = types[i] || "Residual";
    const cap = Number.isFinite(capacity) ? capacity : null;
    const typeConfig = getCellTypeConfig(type);
    const statusConfig = getCellStatusConfig(status);
    const percent = computeGaugePercent({ usedCapacity: used, totalCapacity: cap });
    cells.push({
      index: i,
      name: names[i] || `Cell ${i + 1}`, // project fallback convention
      type,
      typeConfig,
      isHazardous: typeConfig.isHazardous,
      status,
      statusConfig,
      capacity: cap,
      used,
      unit: capUnits[i] || deriveUnit(facility) || "m³",
      percent,
      capacityStatus: getCapacityStatus(percent),
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

// Compact summary shown on gauge hover. Reads ONLY from the already-derived cell
// + row objects (no API call) — every field is a real stored/derived value.
function CellHoverDetails({ cell, row }) {
  const { typeConfig, statusConfig, capacityStatus } = cell;
  const operators = row?.operators || [];
  const item = (label, value) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, fontSize: 12, lineHeight: 1.9 }}>
      <Text type="secondary" style={{ fontSize: 12 }}>{label}</Text>
      <span style={{ fontWeight: 500, textAlign: "right" }}>{value}</span>
    </div>
  );
  return (
    <div style={{ minWidth: 270, maxWidth: 550 }}>
      <Space size={6} style={{ marginBottom: 6 }} wrap>
        <Tag color={typeConfig.tag} style={{ marginInlineEnd: 0 }}>{typeConfig.label}</Tag>
        <Badge status={statusConfig.badge} text={<span style={{ fontSize: 12 }}>{statusConfig.label}</span>} />
      </Space>
      {statusConfig.description && (
        <div style={{ marginBottom: 6 }}>
          <Text type="secondary" style={{ fontSize: 11 }}>{statusConfig.description}</Text>
        </div>
      )}
      {item("Current volume", `${fmt(cell.used)} ${cell.unit}`)}
      {item("Capacity", cell.capacity == null ? "—" : `${fmt(cell.capacity)} ${cell.unit}`)}
      {item("Remaining", cell.remaining == null ? "—" : `${fmt(cell.remaining)} ${cell.unit}`)}
      {item(
        "Utilization",
        cell.percent == null ? (
          <Text type="secondary">No capacity data</Text>
        ) : (
          <span style={{ color: capacityStatus.color, fontWeight: 600 }}>
            {parseFloat(cell.percent.toFixed(2))}% · {capacityStatus.label}
          </span>
        ),
      )}
      {row?.slfName && item("SLF", row.slfName)}
      {operators.length > 0 &&
        item("Operator", operators.map((o) => o.name).join(", "))}
    </div>
  );
}


function CellGauge({ cell, row }) {
  const { typeConfig, statusConfig } = cell;
  const color = typeConfig.color;
  return (
    <Popover
      placement="top"
      content={<CellHoverDetails cell={cell} row={row} />}
      title={<Text strong style={{ fontSize: 13 }}>{cell.name}</Text>}
      mouseEnterDelay={0.15}
    >
      <div style={{ textAlign: "center", minWidth: 62, cursor: "pointer" }}>
        <GaugeMeter
          percent={cell.percent}
          color={color}
          size={60}
          thickness={4}
          percentFontSize={11}
          noDataFontSize={9}
          noDataText="n/a"
          fillStyle={statusConfig.fill}
          fillOpacity={statusConfig.opacity}
        />
        <div
          style={{
            fontSize: 10,
            fontWeight: 400,
            marginTop: 1,
            color,
            opacity: statusConfig.disabled ? 0.65 : 1,
            maxWidth: 70,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {cell.name}
        </div>
      </div>
    </Popover>
  );
}

function OperatorGroup({ operators = [] }) {
  if (!operators.length) return <Text type="secondary" style={{ fontSize: 11 }}>No operator</Text>;
  return (
    <Avatar.Group
      max={{
        count: 3,
        style: { backgroundColor: "#f0f0f0", color: "#595959", fontSize: 10 },
        popover: {
          content: (
            <Space direction="vertical" size={2}>
              {operators.slice(3).map((o) => (
                <Text key={o.id} style={{ fontSize: 12 }}>{o.name}</Text>
              ))}
            </Space>
          ),
        },
      }}
      size={20}
    >
      {operators.map((o) => (
        <Tooltip key={o.id} title={o.email ? `${o.name} · ${o.email}` : o.name}>
          <Avatar size={20} style={{ backgroundColor: o.color, fontSize: 10 }} icon={!o.initials ? <UserOutlined /> : undefined}>
            {o.initials || undefined}
          </Avatar>
        </Tooltip>
      ))}
    </Avatar.Group>
  );
}

// Stable per-operator avatar colour derived from their id (no random churn).
const AVATAR_COLORS = ["#1677ff", "#52c41a", "#722ed1", "#fa8c16", "#13c2c2", "#eb2f96"];
function operatorColor(id) {
  const str = String(id || "");
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export default function CellInfraOverview({
  rows = [],
  isDark,
  canEdit = true,
  onEdited,
  loading = false,
  portalUsers = [],
}) {
  const [expanded, setExpanded] = useState(false);
  const [viewRow, setViewRow] = useState(null);
  const [editRow, setEditRow] = useState(null);
  const [editCells, setEditCells] = useState([]);
  const [saving, setSaving] = useState(false);

  // facilityId → approved portal users assigned to it. Built once from the
  // already-loaded portal-user list; the hover card and SLF column both read it,
  // so neither triggers a request.
  const operatorsByFacility = useMemo(() => {
    const map = new Map();
    portalUsers.forEach((u) => {
      if (u?.status && u.status !== "approved") return;
      const name = [u?.firstName, u?.lastName].filter(Boolean).join(" ").trim() || u?.username || u?.email || "";
      if (!name) return;
      const operator = {
        id: String(u._id),
        name,
        email: u.email || "",
        initials: [u?.firstName?.[0], u?.lastName?.[0]].filter(Boolean).join("").toUpperCase(),
        color: operatorColor(u._id),
      };
      (u.assignedSlf || []).forEach((slf) => {
        const fid = String(slf?._id || slf);
        if (!fid) return;
        if (!map.has(fid)) map.set(fid, []);
        map.get(fid).push(operator);
      });
    });
    return map;
  }, [portalUsers]);

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
          address: deriveAddress(o.facility),
          operators: operatorsByFacility.get(o.key) || [],
        };
      })
      .sort((a, b) => (b.submissions || 0) - (a.submissions || 0));
  }, [rows, expanded, operatorsByFacility]);

  const isLoading = loading;

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
      onEdited?.();
    } catch (err) {
      message.error(err.response?.data?.message || "Could not update cell infrastructure.");
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    {
      title: "Sanitary Land Fill Information",
      dataIndex: "slfName",
      key: "slf",
      fixed: "left",
      width: 260,
      render: (v, r) => (
        <Space direction="vertical" size={2} >
          <Text strong style={{ fontSize: 11 }}>{v}</Text>
          {r.address ? (
            <Tooltip title={r.address}>
              <Text
                type="secondary"
                style={{
                  fontSize: 11,
                  display: "block",
                  overflow: "hidden",
                  //textOverflow: "ellipsis",
                  //whiteSpace: "nowrap",
                }}
              >
                <EnvironmentOutlined style={{ marginRight: 4 }} />
                {r.address}
              </Text>
            </Tooltip>
          ) : (
            <Text type="secondary" style={{ fontSize: 11 }}>No address on record</Text>
          )}
          <Space size={6} align="center">
            <OperatorGroup operators={r.operators} />
            <Text type="secondary" style={{ fontSize: 11 }}>
              · {r.cells.length} cell{r.cells.length === 1 ? "" : "s"}
            </Text>
          </Space>
        </Space>
      ),
    },
    {
      title: "Total Submissions",
      dataIndex: "submissions",
      key: "submissions",
      width: 120,
      align: "center",
      sorter: (a, b) => (a.submissions || 0) - (b.submissions || 0),
      render: (v) => <Tag color="blue">{Number(v || 0).toLocaleString()}</Tag>,
    },
    {
      title: "Waste Unit",
      dataIndex: "unit",
      key: "unit",
      width: 90,
      align: "center",
      render: (v) => (v ? <Tag>{v}</Tag> : <Text type="secondary">—</Text>),
    },
    {
      title: "Available Cells",
      key: "gauges",
      width: 450,
      render: (_, r) =>
        r.cells.length ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "2px 0" }}>
            {r.cells.map((c) => (
              <CellGauge key={c.index} cell={c} row={r} />
            ))}
          </div>
        ) : (
          <Text type="secondary" style={{ fontSize: 11 }}>No cells configured</Text>
        ),
    },
    {
      title: "Total Cell Utilization",
      key: "total",
      width: 150,
      render: (_, r) => {
        const pct = r.totalAgg.percent;
        if (pct == null) return <Text type="secondary" style={{ fontSize: 12 }}>No capacity data</Text>;
        const rounded = parseFloat(pct.toFixed(2));
        const capacityStatus = getCapacityStatus(rounded);
        return (
          <div>
            <Progress
              percent={rounded}
              size="small"
              status={capacityStatus.key === "normal" ? "normal" : capacityStatus.key === "elevated" ? "active" : "exception"}
              strokeColor={capacityStatus.color}
            />
            <Text type="secondary" style={{ fontSize: 11 }}>
              {fmt(r.totalAgg.usedSum)} / {fmt(r.totalAgg.capSum)} {r.unit || ""}
            </Text>
          </div>
        );
      },
    },
    {
      title: "Actions",
      key: "actions",
      fixed: "right",
      width: 120,
      render: (_, r) => (
        <Space>
          <Button size="small" type="primary" icon={<EyeOutlined />} onClick={() => setViewRow(r)} />           
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
        expandIconPosition="end"
        expandIcon={({ isActive }) => (
          <span
            aria-hidden="true"
            style={{
              display: "inline-flex",
              alignItems: "center", // vertically centred against the label
              justifyContent: "center",
              fontSize: 14,
              lineHeight: 1,
              color: "#8c8c8c",
              transform: isActive ? "rotate(90deg)" : "none",
              transition: "transform 0.2s",
            }}
          >
            &gt;
          </span>
        )}
        items={[
          {
            key: "cell-infra",
            label: <Text strong style={{ fontSize: 14, color: ACCENT }}>
                Cell Infrastructure Overview
              </Text>,
            children: expanded ? (
              isLoading ? (
                <Table
                  size="small"
                  rowKey="key"
                  columns={columns.map((col) => ({
                    ...col,
                    render: () => <Skeleton.Input active size="small" style={{ width: "100%", minWidth: 60, height: 44 }} />,
                  }))}
                  dataSource={SKELETON_ROWS}
                  scroll={{ x: 1140 }}
                  pagination={false}
                />
              ) : overviewRows.length ? (
                <Table
                  size="small"
                  rowKey="key"
                  columns={columns}
                  dataSource={overviewRows}
                  scroll={{ x: 1140 }}
                  pagination={withSizeChanger({ pageSize: 20, size: "small", showTotal: (t) => `${t} SLF` })}
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
            {viewRow?.slfName}
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
                {viewRow.totalAgg.percent == null ? (
                  "No capacity data"
                ) : (
                  <span style={{ color: getCapacityStatus(viewRow.totalAgg.percent).color, fontWeight: 600 }}>
                    {parseFloat(viewRow.totalAgg.percent.toFixed(2))}% · {getCapacityStatus(viewRow.totalAgg.percent).label}
                  </span>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Address" span={2}>
                {viewRow.address || <Text type="secondary">—</Text>}
              </Descriptions.Item>
              <Descriptions.Item label="Operator">
                <OperatorGroup operators={viewRow.operators} />
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
                  render: (_, c) => <CellGauge cell={c} row={viewRow} />,
                },
                { title: "Cell Name", dataIndex: "name", key: "name", render: (v) => <Text strong style={{ fontSize: 12 }}>{v}</Text> },
                {
                  title: "Type",
                  dataIndex: "type",
                  key: "type",
                  render: (v, c) => <Tag color={c.typeConfig.tag}>{v}</Tag>,
                },
                {
                  title: "Status",
                  dataIndex: "status",
                  key: "status",
                  render: (v, c) => <Badge status={c.statusConfig.badge} text={<span style={{ fontSize: 12 }}>{v}</span>} />,
                },
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
