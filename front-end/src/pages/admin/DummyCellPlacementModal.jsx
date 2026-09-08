import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Row,
  Col,
  Progress,
  Tag,
  Typography,
  Empty,
  Spin,
  Alert,
  Space,
  Statistic,
  Card,
} from "antd";
import { DatabaseOutlined } from "@ant-design/icons";
import { convertVolume } from "../../utils/volumeUnits";
import { fetchAllSubmissions } from "./shared/submissionRecords";

const { Text } = Typography;
// Display-only unit label. Conversion comes from utils/volumeUnits.js.
const normalizeUnit = (unit) => String(unit || "m³").replace("m3", "m³");
const isActiveCellStatus = (status) =>
  /active|operational|open/i.test(String(status || "Active Cell"));
const statusColor = (pct) => {
  if (pct == null) return "#8c8c8c";
  if (pct >= 90) return "#ff4d4f";
  if (pct >= 75) return "#faad14";
  return "#52c41a";
};

const facilityDisplayName = (f) =>
  `${f?.lgu || f?.province || "Dummy SLF"}${f?.ownership ? ` (${f.ownership})` : ""}`.trim();

// Developer-only visualization: shows how a dummy account's cell-placed disposal
// waste fills the cells of a dummy SLF facility. Mirrors the real admin Cell
// Waste Placement aggregation so a successful result here validates the same
// cell-infrastructure logic used for real SLF facilities.
export default function DummyCellPlacementModal({ open, facility, onClose }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !facility?._id) return;
    let cancelled = false;
    setLoading(true);
    // Paged — the search below scopes this to one facility, but the response
    // carries full trucks, which is more than one request should return.
    fetchAllSubmissions({
      includeTrucks: true,
      withTruckVolume: true,
      includeDummy: "true", // honored for developer role
      search: facility.lgu || facilityDisplayName(facility),
    })
      .then((rows) => {
        if (cancelled) return;
        // Keep only this dummy facility's records (by facility id, with a name fallback).
        const own = rows.filter((r) => {
          const genId = String(r.slfGenerator?._id || r.slfGenerator || "");
          if (genId && genId === String(facility._id)) return true;
          return (
            !!facility.lgu &&
            String(r.slfName || "").toLowerCase().includes(String(facility.lgu).toLowerCase())
          );
        });
        setRecords(own);
      })
      .catch(() => {
        if (!cancelled) setRecords([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, facility]);

  const cells = useMemo(() => {
    if (!facility) return [];
    const count = Math.max(
      Number(facility.numberOfCell || 0),
      facility.cellCapacities?.length || 0,
      facility.cellStatuses?.length || 0,
      1,
    );
    const rows = Array.from({ length: count }, (_, i) => {
      const unit = normalizeUnit(
        facility.cellCapacityUnits?.[i] || facility.cellFillUnits?.[i] || "m³",
      );
      const capacity = Number(facility.cellCapacities?.[i] || 0);
      const baseFill = convertVolume(
        facility.cellFillValues?.[i] || 0,
        facility.cellFillUnits?.[i] || unit,
        unit,
      );
      return {
        index: i,
        label: `Cell ${i + 1}`,
        status: facility.cellStatuses?.[i] || "Active Cell",
        type: facility.cellTypes?.[i] || "Residual",
        unit,
        capacity,
        used: baseFill,
        entries: 0,
      };
    });
    records.forEach((rec) => {
      (rec.trucks || []).forEach((truck) => {
        const vehs = (truck.vehicles || []).filter(
          (v) => v.cellIndex != null && Number(v.actualVolume || 0) > 0,
        );
        if (vehs.length) {
          vehs.forEach((v) => {
            const row = rows[Number(v.cellIndex)];
            if (!row) return;
            row.used += convertVolume(
              v.actualVolume,
              v.actualVolumeUnit || truck.actualVolumeUnit || row.unit,
              row.unit,
            );
            row.entries += 1;
          });
          return;
        }
        if (truck.cellIndex == null) return;
        const row = rows[Number(truck.cellIndex)];
        if (!row) return;
        row.used += convertVolume(
          truck.actualVolume,
          truck.actualVolumeUnit || row.unit,
          row.unit,
        );
        row.entries += 1;
      });
    });
    return rows.map((row) => ({
      ...row,
      pct: row.capacity > 0 ? Math.min(100, Math.round((row.used / row.capacity) * 100)) : null,
      remaining: row.capacity > 0 ? Math.max(0, row.capacity - row.used) : null,
      isFull: row.capacity > 0 && row.used >= row.capacity,
    }));
  }, [facility, records]);

  const summary = useMemo(() => {
    let placed = 0;
    let unplaced = 0;
    records.forEach((rec) =>
      (rec.trucks || []).forEach((truck) => {
        const vehs = (truck.vehicles || []).filter(
          (v) => Number(v.actualVolume || 0) > 0,
        );
        if (vehs.length) {
          vehs.forEach((v) => (v.cellIndex != null ? (placed += 1) : (unplaced += 1)));
        } else if (Number(truck.actualVolume || 0) > 0) {
          truck.cellIndex != null ? (placed += 1) : (unplaced += 1);
        }
      }),
    );
    return {
      submissions: records.length,
      placed,
      unplaced,
      fullCells: cells.filter((c) => c.isFull).length,
    };
  }, [records, cells]);

  return (
    <Modal
      title={
        <Space>
          <DatabaseOutlined style={{ color: "#722ed1" }} />
          <span>Cell Placement — {facilityDisplayName(facility)}</span>
          <Tag color="purple">DUMMY</Tag>
        </Space>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={860}
      destroyOnHidden
    >
      <Spin spinning={loading}>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12, borderRadius: 8 }}
          message="How dummy submissions fill this facility's cells"
          description="Waste from dummy-account disposal submissions that has a cell placement is added to the matching cell below. When placed volume reaches a cell's capacity, the cell shows as Full — the same rule the real SLF Data Table uses to close cells for further disposal."
        />

        <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
          <Col xs={12} md={6}>
            <Card size="small" style={{ borderRadius: 8 }}>
              <Statistic title="Dummy Submissions" value={summary.submissions} />
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card size="small" style={{ borderRadius: 8 }}>
              <Statistic title="Placed Entries" value={summary.placed} valueStyle={{ color: "#52c41a" }} />
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card size="small" style={{ borderRadius: 8 }}>
              <Statistic title="Unplaced" value={summary.unplaced} valueStyle={{ color: summary.unplaced ? "#faad14" : undefined }} />
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card size="small" style={{ borderRadius: 8 }}>
              <Statistic title="Cells Full" value={summary.fullCells} valueStyle={{ color: summary.fullCells ? "#ff4d4f" : undefined }} />
            </Card>
          </Col>
        </Row>

        {cells.length === 0 ? (
          <Empty description="No cells configured for this dummy facility." />
        ) : (
          <Row gutter={[10, 10]}>
            {cells.map((cell) => (
              <Col xs={24} md={12} key={cell.index}>
                <div
                  style={{
                    border: `1px solid ${cell.isFull ? "#ffccc7" : "#f0f0f0"}`,
                    background: cell.isFull ? "#fff2f0" : "#fff",
                    borderRadius: 8,
                    padding: 12,
                  }}
                >
                  <Space
                    style={{ width: "100%", justifyContent: "space-between" }}
                    align="start"
                  >
                    <Space direction="vertical" size={2}>
                      <Text strong>{cell.label}</Text>
                      <Space size={4} wrap>
                        <Tag color={isActiveCellStatus(cell.status) ? "green" : "default"}>
                          {cell.status}
                        </Tag>
                        <Tag>{cell.type}</Tag>
                        {cell.isFull && <Tag color="red">FULL</Tag>}
                      </Space>
                    </Space>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {cell.entries} entr{cell.entries === 1 ? "y" : "ies"}
                    </Text>
                  </Space>
                  <div style={{ marginTop: 8 }}>
                    <Text style={{ fontSize: 12 }}>
                      {Number(cell.used || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      {cell.capacity ? ` / ${Number(cell.capacity).toLocaleString()}` : ""} {cell.unit}
                      {cell.remaining != null && (
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {" "}· {cell.remaining.toLocaleString(undefined, { maximumFractionDigits: 2 })} {cell.unit} left
                        </Text>
                      )}
                    </Text>
                    <Progress
                      percent={cell.pct == null ? 0 : cell.pct}
                      showInfo={cell.pct != null}
                      strokeColor={statusColor(cell.pct)}
                      style={{ marginTop: 4 }}
                    />
                  </div>
                </div>
              </Col>
            ))}
          </Row>
        )}

        {summary.unplaced > 0 && (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 12, borderRadius: 8 }}
            message={`${summary.unplaced} disposal entr${summary.unplaced === 1 ? "y has" : "ies have"} volume but no cell placement.`}
            description="These are counted in totals but not attributed to any cell. In the portal, the dummy account can place them via Organize Cell Placement."
          />
        )}
      </Spin>
    </Modal>
  );
}
