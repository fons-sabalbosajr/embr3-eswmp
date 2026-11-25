// Admin → Portal Submissions → Submissions: the body of the submission detail
// modal. Same design as the portal's Submission History detail (dark banner,
// summary tiles, then collapsible sections built from the individual waste
// entries), so EMB and the operator read a submission the same way. Admin-only
// additions: the submission's company and address, each load's clients and
// truck capacity, and the transaction history link.
import { Alert, Button, Col, Collapse, Progress, Row, Skeleton, Space, Table, Tag, Tooltip, Typography } from "antd";
import {
  CarOutlined,
  HistoryOutlined,
  IdcardOutlined,
  PieChartOutlined,
  TeamOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { buildSubmissionWasteEntries, formatWasteEntryTotals } from "../../utils/submissionEntries";
import { submissionCellUsage } from "../SLFPortal/submissionCellUsage";
import { getCellStatusConfig, getCellTypeConfig } from "../../utils/cellVisuals";
import { volumeCapacityStatus } from "../../utils/volumeUnits";
import { wasteTypeTagColor } from "../../utils/wasteCategories";
import WeighedVolumeNote from "../../components/WeighedVolumeNote";

const { Text } = Typography;

const STATUS_LABELS = {
  pending: "Pending Review",
  acknowledged: "Acknowledged",
  rejected: "Rejected",
  reverted: "Reverted",
  editApproved: "Edit Approved",
  revert_requested: "Revert Requested",
};

const unitLabel = (unit, fallback = "m³") => String(unit || fallback).replace("m3", "m³");
const fmt = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

const clientLabel = (c) => {
  if (!c) return "";
  if (typeof c === "string") return c.trim();
  return String(c.clientName || c.name || c.company || "").trim();
};

function SummaryTile({ label, tone, isDark, children }) {
  const tones = {
    blue: { bg: "#f0f5ff", border: "#d6e4ff", dark: "rgba(47,84,235,0.1)", darkBorder: "rgba(47,84,235,0.3)" },
    green: { bg: "#f6ffed", border: "#d9f7be", dark: "rgba(82,196,26,0.1)", darkBorder: "rgba(82,196,26,0.3)" },
    orange: { bg: "#fff7e6", border: "#ffe7ba", dark: "rgba(250,173,20,0.1)", darkBorder: "rgba(250,173,20,0.3)" },
  }[tone];
  return (
    <div
      style={{
        background: isDark ? tones.dark : tones.bg,
        border: `1px solid ${isDark ? tones.darkBorder : tones.border}`,
        borderRadius: 8,
        padding: "12px 16px",
        minHeight: 72,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      <Text type="secondary" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </Text>
      <div style={{ marginTop: 4 }}>{children}</div>
    </div>
  );
}

function InfoItem({ label, children, wide }) {
  return (
    <div style={{ gridColumn: wide ? "1 / -1" : undefined, minWidth: 0 }}>
      <Text
        type="secondary"
        style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, display: "block", marginBottom: 2 }}
      >
        {label}
      </Text>
      <div style={{ fontSize: 13, fontWeight: 600, overflowWrap: "anywhere" }}>{children || "—"}</div>
    </div>
  );
}

export default function SubmissionDetailView({
  record: r,
  loading = false,
  isDark = false,
  resolvedAddr = {},
  statusColors = {},
  txnHistoryKey = null,
  onOpenTxnHistory,
}) {
  if (!r) return null;
  const facility = r.slfGenerator && typeof r.slfGenerator === "object" ? r.slfGenerator : null;
  const fallbackUnit = unitLabel(r.baselineUnit || r.totalVolumeAcceptedUnit || facility?.volumeCapacityUnit);
  // One row per waste entry: a truck that split its load across vehicles
  // contributes one row per vehicle, each with its own type, volume, unit, cell.
  const wasteEntries = buildSubmissionWasteEntries(r, { slfName: r.slfName, fallbackUnit });
  const totalVolumeSummary = formatWasteEntryTotals(wasteEntries, r.totalVolumeAcceptedUnit || fallbackUnit);
  const trucks = r.trucks || [];
  const borderColor = isDark ? "rgba(255,255,255,0.12)" : "#f0f0f0";

  const statusTag = (
    <Tag color={statusColors[r.status] || "default"} style={{ fontSize: 12, fontWeight: 600, padding: "2px 10px", marginInlineEnd: 0 }}>
      {STATUS_LABELS[r.status] || (r.status ? r.status.charAt(0).toUpperCase() + r.status.slice(1) : "Unknown")}
    </Tag>
  );

  // ── Sections ──────────────────────────────────────────────────────────────
  const infoSection = {
    key: "info",
    label: (
      <Text strong style={{ fontSize: 13 }}>
        <IdcardOutlined style={{ color: "#2f54eb", marginRight: 6 }} />
        Submission Information
      </Text>
    ),
    children: (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 190px), 1fr))", gap: "12px 16px" }}>
        <InfoItem label="SLF Facility">{r.slfName || facility?.slfName}</InfoItem>
        <InfoItem label="Date of Disposal">
          {r.dateOfDisposal ? dayjs(r.dateOfDisposal).format("MMM D, YYYY") : null}
        </InfoItem>
        <InfoItem label="Submitted By">{r.submittedBy}</InfoItem>
        <InfoItem label="Submitted At">
          {r.createdAt ? dayjs(r.createdAt).format("MMM D, YYYY h:mm A") : null}
        </InfoItem>
        <InfoItem label="Company & Address" wide>
          {r.lguCompanyName}
          {r.address && (
            <Text type="secondary" style={{ fontSize: 12, display: "block", fontWeight: 400 }}>
              {r.address}
            </Text>
          )}
        </InfoItem>
        {(r.companyRegion || r.companyProvince || r.companyMunicipality || r.companyBarangay) && (
          <>
            <InfoItem label="Region">{resolvedAddr.region || r.companyRegion}</InfoItem>
            <InfoItem label="Province">{resolvedAddr.province || r.companyProvince}</InfoItem>
            <InfoItem label="City / Municipality">{resolvedAddr.municipality || r.companyMunicipality}</InfoItem>
            <InfoItem label="Barangay">{resolvedAddr.barangay || r.companyBarangay}</InfoItem>
          </>
        )}
        {r.totalVolumeAccepted != null && (
          <InfoItem label="Total Volume Accepted (baseline)">
            {`${fmt(r.totalVolumeAccepted)} ${unitLabel(r.totalVolumeAcceptedUnit)}`}
          </InfoItem>
        )}
      </div>
    ),
  };

  const cellSection = {
    // The cells THIS submission's waste went into, each with its capacity gauge
    // from the facility record — not one facility-wide figure.
    key: "cells",
    label: (
      <Text strong style={{ fontSize: 13 }}>
        <PieChartOutlined style={{ color: "#13c2c2", marginRight: 6 }} />
        Cell Capacity — cells used by this submission
      </Text>
    ),
    children: (() => {
      if (!facility) {
        return <Text type="secondary">Facility cell data is not available for this submission.</Text>;
      }
      const { cells, unplaced } = submissionCellUsage(wasteEntries, facility, fallbackUnit);
      if (!cells.length && !unplaced.entries) {
        return <Text type="secondary">No waste entries in this submission.</Text>;
      }
      return (
        <div>
          <Row gutter={[12, 12]}>
            {cells.map((cell) => {
              const color = cell.pct >= 90 ? "#ff4d4f" : cell.pct >= 70 ? "#faad14" : "#52c41a";
              const status = getCellStatusConfig(cell.status);
              const type = getCellTypeConfig(cell.type);
              return (
                <Col xs={24} sm={12} lg={8} key={cell.index}>
                  <div
                    style={{
                      border: `1px solid ${borderColor}`,
                      borderRadius: 8,
                      padding: "10px 12px",
                      display: "flex",
                      gap: 12,
                      alignItems: "center",
                      height: "100%",
                    }}
                  >
                    <Progress
                      type="dashboard"
                      percent={cell.pct}
                      size={84}
                      strokeColor={color}
                      format={() => (
                        <div style={{ lineHeight: 1.2 }}>
                          <div style={{ fontSize: 15, fontWeight: 700, color }}>{cell.pct}%</div>
                          <div style={{ fontSize: 9.5, color: "#8c8c8c" }}>filled</div>
                        </div>
                      )}
                    />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <Text strong style={{ fontSize: 13, display: "block", wordBreak: "break-word" }}>
                        {cell.name}
                      </Text>
                      <Space size={4} wrap style={{ margin: "2px 0 4px" }}>
                        <Tag color={status.tag} style={{ marginInlineEnd: 0, fontSize: 10.5 }}>{status.label}</Tag>
                        <Tag color={type.tag} style={{ marginInlineEnd: 0, fontSize: 10.5 }}>{type.label}</Tag>
                      </Space>
                      <div style={{ fontSize: 11.5, lineHeight: 1.5 }}>
                        <div>
                          This submission:{" "}
                          <Text strong style={{ fontSize: 11.5 }}>
                            {fmt(cell.submissionVolume)} {cell.capacityUnit}
                          </Text>{" "}
                          ({cell.entries} entr{cell.entries === 1 ? "y" : "ies"})
                        </div>
                        <Text type="secondary" style={{ fontSize: 11.5 }}>
                          {cell.capacity > 0
                            ? `${fmt(cell.used)} of ${fmt(cell.capacity)} ${cell.capacityUnit} used · ${fmt(cell.remaining)} left`
                            : "No capacity set for this cell"}
                        </Text>
                      </div>
                    </div>
                  </div>
                </Col>
              );
            })}
          </Row>
          {unplaced.entries > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 12 }}
              message={`${unplaced.entries} waste entr${unplaced.entries === 1 ? "y is" : "ies are"} not placed in a cell (${unplaced.volumes.join(", ")}).`}
            />
          )}
          <Text type="secondary" style={{ display: "block", fontSize: 11, marginTop: 8 }}>
            Gauges show each cell&apos;s current fill from the facility record.
          </Text>
        </div>
      );
    })(),
  };

  const haulerSection = r.accreditedHaulers?.length > 0 && {
    key: "haulers",
    label: (
      <Text strong style={{ fontSize: 13 }}>
        <TeamOutlined style={{ color: "#52c41a", marginRight: 6 }} />
        Accredited Haulers ({r.accreditedHaulers.length})
      </Text>
    ),
    children: (() => {
      const haulerRows = r.accreditedHaulers.map((h, i) => {
        const rawClients = Array.isArray(h.privateSectorClients)
          ? h.privateSectorClients
          : h.privateSectorClients
            ? [h.privateSectorClients]
            : [];
        const vehicles =
          h.vehicles?.length > 0
            ? h.vehicles
            : h.plateNumber || h.vehicleType || h.capacity != null
              ? [{ plateNumber: h.plateNumber, vehicleType: h.vehicleType, capacity: h.capacity, capacityUnit: h.capacityUnit }]
              : [];
        return {
          ...h,
          _idx: i,
          clientStr: rawClients.map(clientLabel).filter(Boolean).join(", ") || "—",
          vehicles,
        };
      });
      return (
        <Table
          size="small"
          rowKey="_idx"
          pagination={false}
          dataSource={haulerRows}
          className="slf-detail-fit"
          tableLayout="fixed"
          expandable={{
            expandedRowRender: (row) => (
              <Table
                size="small"
                rowKey={(_, vi) => vi}
                pagination={false}
                dataSource={row.vehicles}
                className="slf-detail-fit"
                tableLayout="fixed"
                style={{ margin: "4px 0" }}
                columns={[
                  { title: "#", width: 40, render: (_, __, vi) => vi + 1 },
                  { title: "Plate Number", dataIndex: "plateNumber", render: (v) => v || "—" },
                  { title: "Vehicle Type", dataIndex: "vehicleType", render: (v) => v || "—" },
                  {
                    title: "Capacity",
                    render: (_, v) => (v.capacity != null ? `${v.capacity} ${unitLabel(v.capacityUnit, fallbackUnit)}` : "—"),
                  },
                ]}
              />
            ),
            rowExpandable: (row) => row.vehicles.length > 0,
          }}
          columns={[
            { title: "#", dataIndex: "_idx", width: 44, render: (v) => v + 1 },
            { title: "Hauler Name", dataIndex: "haulerName", render: (v) => <Text strong>{v || "Unnamed"}</Text> },
            { title: "Hauler Clients", dataIndex: "clientStr" },
            { title: "No. of Trucks", dataIndex: "numberOfTrucks", width: 84, align: "center", render: (v) => v ?? "—" },
            { title: "Office Address", dataIndex: "officeAddress", render: (v) => v || "—" },
          ]}
        />
      );
    })(),
  };

  const transportSection = {
    key: "transport",
    label: (
      <Text strong style={{ fontSize: 13 }}>
        <CarOutlined style={{ color: "#fa8c16", marginRight: 6 }} />
        Transport &amp; Disposal ({wasteEntries.length} waste entr{wasteEntries.length === 1 ? "y" : "ies"} across{" "}
        {trucks.length} truck{trucks.length === 1 ? "" : "s"})
      </Text>
    ),
    children:
      wasteEntries.length > 0 ? (
        <Table
          dataSource={wasteEntries}
          rowKey="key"
          size="small"
          className="slf-slim-scroll slf-detail-fit"
          tableLayout="fixed"
          pagination={
            wasteEntries.length > 10
              ? {
                  pageSize: 10,
                  size: "small",
                  showSizeChanger: true,
                  pageSizeOptions: [10, 20, 50, 100],
                  showTotal: (total) => `${total} waste entr${total === 1 ? "y" : "ies"}`,
                }
              : false
          }
          columns={[
            { title: "#", key: "idx", width: "4%", render: (_, __, i) => <Text type="secondary">{i + 1}</Text> },
            { title: "Ticket No.", dataIndex: "ticketNo", key: "ticket", width: "10%", render: (v) => v || "—" },
            { title: "Hauler", dataIndex: "hauler", key: "hauler", width: "13%", render: (v) => <Text strong>{v || "—"}</Text> },
            {
              title: "Clients",
              key: "clients",
              width: "14%",
              // Clients are { name, details }. A load that named no client shows
              // its hauler's accredited clients instead — greyed and labelled,
              // so they are never read as recorded on the trip (as in the export).
              render: (_, e) => {
                if (!e.clients?.length) return <Text type="secondary">—</Text>;
                const fromHauler = e.clientSource === "hauler";
                return (
                  <div>
                    <Space size={[2, 2]} wrap>
                      {e.clients.map((c, ci) => (
                        <Tooltip key={ci} title={c.details || undefined}>
                          <Tag color={fromHauler ? "default" : "purple"} variant="filled" style={{ margin: 0 }}>
                            {c.name}
                          </Tag>
                        </Tooltip>
                      ))}
                    </Space>
                    {fromHauler && (
                      <Text type="secondary" style={{ display: "block", fontSize: 10.5, lineHeight: 1.3, marginTop: 2 }}>
                        From hauler list — not recorded on trip
                      </Text>
                    )}
                  </div>
                );
              },
            },
            { title: "Plate No.", dataIndex: "plateNumber", key: "plate", width: "9%", render: (v) => v || "—" },
            {
              title: "Waste Type",
              dataIndex: "wasteType",
              key: "waste",
              width: "11%",
              render: (v) => (v ? <Tag color={wasteTypeTagColor(v, "blue")} variant="filled">{v}</Tag> : "—"),
            },
            {
              title: "Capacity",
              key: "cap",
              width: "8%",
              render: (_, e) => {
                const truck = trucks[e.truckIndex] || {};
                const vehicle = e.vehicleIndex != null ? truck.vehicles?.[e.vehicleIndex] : null;
                const capacity = vehicle?.capacity ?? truck.truckCapacity;
                return capacity ? `${capacity} ${unitLabel(vehicle?.capacityUnit || truck.truckCapacityUnit, e.unit)}` : "—";
              },
            },
            {
              // Coloured against the load's capacity (units normalised first).
              title: "Volume",
              key: "vol",
              align: "right",
              width: "9%",
              render: (_, e) => {
                if (e.volume == null) return "—";
                const truck = trucks[e.truckIndex] || {};
                const vehicle = e.vehicleIndex != null ? truck.vehicles?.[e.vehicleIndex] : null;
                const capacity = vehicle?.capacity ?? truck.truckCapacity;
                const capacityUnit = vehicle?.capacityUnit || truck.truckCapacityUnit || e.unit;
                const status = volumeCapacityStatus({
                  actualVolume: e.volume,
                  actualVolumeUnit: e.unit,
                  capacity,
                  capacityUnit,
                });
                const value = (
                  <Text strong style={{ color: status.comparable ? status.color : "#52c41a" }}>
                    {fmt(e.volume)}
                  </Text>
                );
                return (
                  <div>
                    {status.comparable ? (
                      <Tooltip
                        title={
                          <span style={{ fontSize: 12 }}>
                            Capacity: {capacity} {unitLabel(capacityUnit)}
                            <br />
                            Actual volume: {fmt(e.volume)} {e.unit}
                            <br />
                            Utilization: {status.percent.toFixed(1)}%
                          </span>
                        }
                      >
                        {value}
                      </Tooltip>
                    ) : (
                      value
                    )}
                    <div>
                      <WeighedVolumeNote entry={e} />
                    </div>
                  </div>
                );
              },
            },
            // The unit has its own column so a volume is never read without it.
            { title: "Unit", dataIndex: "unit", key: "unit", width: "6%", render: (v) => v || "—" },
            {
              title: "Cell",
              dataIndex: "cell",
              key: "cell",
              width: "8%",
              render: (v) => v || <Text type="secondary">Unplaced</Text>,
            },
            {
              title: "HW Code",
              key: "hw",
              width: "8%",
              render: (_, e) => {
                const codes = (e.hazWasteCodes || []).filter(Boolean);
                if (!codes.length) return <Text type="secondary">—</Text>;
                return (
                  <Tooltip title={codes.join(", ")}>
                    <Space size={[2, 2]} wrap>
                      {codes.slice(0, 2).map((code) => (
                        <Tag key={code} color="volcano" variant="filled" style={{ margin: 0 }}>
                          {code}
                        </Tag>
                      ))}
                      {codes.length > 2 && (
                        <Tag variant="filled" style={{ margin: 0 }}>
                          +{codes.length - 2}
                        </Tag>
                      )}
                    </Space>
                  </Tooltip>
                );
              },
            },
          ]}
        />
      ) : (
        <div style={{ textAlign: "center", padding: "20px 0" }}>
          <Text type="secondary">No transport entries recorded.</Text>
        </div>
      ),
  };

  return (
    <div>
      {/* Header banner — same as the portal's Submission History detail. */}
      <div
        style={{
          background: "linear-gradient(135deg, #0e1e35 0%, #1a3353 100%)",
          padding: "24px 28px 20px",
          paddingRight: 56,
          borderRadius: "8px 8px 0 0",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>
              Submission Details
            </Text>
            <div style={{ marginTop: 4 }}>
              <Text style={{ color: "#fff", fontSize: 20, fontWeight: 700, letterSpacing: 0.5, overflowWrap: "anywhere" }}>
                {r.isGroupedSubmission ? `${r.entryCount} Grouped Submissions` : r.idNo}
              </Text>
            </div>
            <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 4, display: "block" }}>
              {r.lguCompanyName} &middot;{" "}
              {r.dateOfDisposal ? dayjs(r.dateOfDisposal).format("MMMM D, YYYY") : "No date"}
            </Text>
          </div>
          <div style={{ textAlign: "right" }}>
            {statusTag}
            {r.createdAt && (
              <div style={{ marginTop: 8 }}>
                <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 11 }}>
                  Submitted {dayjs(r.createdAt).format("MMM D, YYYY h:mm A")}
                </Text>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* The banner renders from the list row, so the modal is never blank; the
          sections below need the full record and skeleton until it arrives. */}
      {loading ? (
        <div style={{ padding: "24px 28px" }}>
          <Row gutter={16} style={{ marginBottom: 24 }}>
            {[0, 1, 2].map((i) => (
              <Col xs={8} key={i}>
                <Skeleton.Input active block style={{ height: 72 }} />
              </Col>
            ))}
          </Row>
          <Skeleton active paragraph={{ rows: 6 }} />
        </div>
      ) : (
        <div style={{ padding: "24px 28px" }}>
          <Row gutter={[16, 12]} style={{ marginBottom: 24 }}>
            <Col xs={24} sm={8}>
              <SummaryTile label="Company Type" tone="blue" isDark={isDark}>
                <Tag color={r.companyType === "LGU" ? "blue" : "purple"} style={{ margin: 0, fontWeight: 600 }}>
                  {r.companyType || "—"}
                </Tag>
              </SummaryTile>
            </Col>
            <Col xs={24} sm={8}>
              <SummaryTile label="Truck Entries" tone="green" isDark={isDark}>
                <Text strong style={{ fontSize: 18, color: isDark ? "#73d13d" : "#52c41a" }}>
                  {trucks.length}
                </Text>
              </SummaryTile>
            </Col>
            <Col xs={24} sm={8}>
              <SummaryTile label="Total Volume" tone="orange" isDark={isDark}>
                <Text strong style={{ fontSize: 16, color: isDark ? "#ffc53d" : "#fa8c16" }}>
                  {totalVolumeSummary}
                </Text>
              </SummaryTile>
            </Col>
          </Row>

          <Collapse
            bordered={false}
            size="small"
            defaultActiveKey={["info", "transport"]}
            style={{ background: "transparent" }}
            items={[infoSection, cellSection, haulerSection, transportSection].filter(Boolean)}
          />

          {r.status === "reverted" && r.revertReason && (
            <div
              style={{
                background: isDark ? "rgba(250,84,28,0.12)" : "#fff2e8",
                border: `1px solid ${isDark ? "rgba(250,84,28,0.4)" : "#ffbb96"}`,
                borderRadius: 8,
                padding: "12px 16px",
                marginTop: 20,
              }}
            >
              <Space align="start">
                <UndoOutlined style={{ color: "#fa541c", marginTop: 2 }} />
                <div>
                  <Text strong style={{ color: "#fa541c", fontSize: 13 }}>
                    Reverted by Administrator
                  </Text>
                  <div style={{ marginTop: 4 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Reason: {r.revertReason}
                    </Text>
                  </div>
                  {r.revertedAt && (
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {dayjs(r.revertedAt).format("MMM D, YYYY h:mm A")}
                    </Text>
                  )}
                </div>
              </Space>
            </div>
          )}

          {txnHistoryKey && (
            <Button
              block
              type="primary"
              icon={<HistoryOutlined />}
              style={{ background: "#722ed1", borderColor: "#722ed1", marginTop: 16 }}
              onClick={() => onOpenTxnHistory?.(txnHistoryKey)}
            >
              View Transaction History
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
