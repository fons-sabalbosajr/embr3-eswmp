import { Alert, Card, Badge, Button, Row, Col, Space, Spin, Tag, Progress, Tooltip, Typography } from "antd";
import {
  BankOutlined,
  BarChartOutlined,
  CheckCircleOutlined,
  ContainerOutlined,
  DatabaseOutlined,
  DownOutlined,
  EyeOutlined,
  FileTextOutlined,
  InfoCircleOutlined,
  PieChartOutlined,
  RobotOutlined,
  SaveOutlined,
  SendOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import {
  normalizeUnit,
  normalizeCellStatus,
  isActiveCellStatus,
  isCompletedCellStatus,
  isUnavailableCellStatus,
} from "./helpers";
import { convertVolume } from "../../utils/volumeUnits";

const { Text } = Typography;

// ── Assigned SLF capacity dashboard ──
// Presentational: the read-only "Assigned Sanitary Landfill Facility" card —
// facility header, cell-capacity gauges, and baseline/utilization summary.
// All figures are derived from container-owned data passed in as props; the
// only interactions are the Review & Submit and Waste-Received buttons, whose
// handlers live in the container. Prop names mirror the container variables so
// the JSX body is unchanged from its original inline form.
export default function AssignedSlfDashboard({
  activeSlfName,
  slfInfo,
  slfInfoLoading,
  baselineUnit,
  baselineSaved,
  baselineForm,
  activeCellEntries,
  closedCellEntries,
  haulers,
  isMobile,
  hasReviewMissing,
  submitBlockers = [],
  loading,
  slfCardExpanded,
  handleReviewOpen,
  handleSaveDraft,
  savingDraft = false,
  handleOpenWasteReceived,
  // The stale reverted entry that is blocking NEW submissions ({ _id, idNo }),
  // and the handler that opens it in Edit & Resubmit. Lets the blocker list
  // offer the fix instead of only describing it.
  revertToResolve = null,
  onResolveRevert,
  // ID No. of the reverted entry currently being corrected, if any.
  resubmittingIdNo = null,
}) {
  // #5: Review & Submit is disabled until every submission requirement is met.
  const submitDisabled = submitBlockers.length > 0;
  return (
    <>
            <Card
              className="slf-section slf-facility-card"
              styles={{
                header: {
                  background:
                    "linear-gradient(135deg, #1a3353 0%, #2d5f8a 100%)",
                  borderRadius: "10px 10px 0 0",
                  padding: isMobile ? "14px 16px" : "16px 24px",
                },
                body: {
                  padding: 0,
                  overflow: "hidden",
                  maxHeight: 0,
                },
              }}
              title={
                <div
                  style={{ display: "flex", alignItems: "center", gap: 10 }}
                >
                  <div
                    style={{
                      color: "rgba(255,255,255,0.8)",
                      fontSize: 14,
                      transition: "transform 0.3s",
                      transform: slfCardExpanded
                        ? "rotate(180deg)"
                        : "rotate(0deg)",
                      display: "none",
                      alignItems: "center",
                    }}
                  >
                    <DownOutlined />
                  </div>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 8,
                      background: "rgba(255,255,255,0.15)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <BankOutlined style={{ color: "#fff", fontSize: 18 }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <Text
                      strong
                      style={{
                        fontSize: isMobile ? 14 : 16,
                        color: "#fff",
                        display: "block",
                        lineHeight: 1.3,
                      }}
                    >
                      {isMobile
                        ? "Assigned SLF"
                        : "Assigned Sanitary Landfill Facility"}
                    </Text>
                    <Text
                      style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}
                    >
                      {activeSlfName}
                    </Text>
                  </div>
                </div>
              }
              extra={
                <Space size={8} wrap>
                {/* Save as Draft sits beside Review & Submit and is deliberately
                    NOT tied to `submitDisabled`: a draft exists precisely to hold
                    incomplete work, so it stays available while the submission
                    requirements are still outstanding. It persists through the
                    same POST /portal-queue path as the Review modal's button — no
                    second save mechanism. */}
                <Tooltip title="Save your encoded data without submitting. You can finish it later from Drafts & Scheduled.">
                  <Button
                    icon={<SaveOutlined />}
                    onClick={handleSaveDraft}
                    loading={savingDraft}
                    size={isMobile ? "middle" : "large"}
                    style={{ fontWeight: 600 }}
                  >
                    {isMobile ? "Draft" : "Save as Draft"}
                  </Button>
                </Tooltip>
                <Tooltip
                  // #5: a disabled AntD Button swallows pointer events, so the
                  // Tooltip must sit on a NON-disabled wrapper (the span) or the
                  // "what's missing" checklist never shows on hover.
                  title={
                    submitDisabled ? (
                      <div style={{ fontSize: 12 }}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>
                          Complete these before submitting:
                        </div>
                        <ul style={{ margin: 0, paddingLeft: 16 }}>
                          {submitBlockers.map((reason, i) => (
                            <li key={i}>{reason}</li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      ""
                    )
                  }
                >
                  <span
                    style={{
                      display: "inline-block",
                      cursor: submitDisabled ? "not-allowed" : "default",
                    }}
                  >
                    <Badge
                      dot={hasReviewMissing || submitDisabled}
                      offset={[-2, 4]}
                      style={{ backgroundColor: "#ff4d4f" }}
                    >
                      <Button
                        type="primary"
                        icon={<SendOutlined />}
                        onClick={handleReviewOpen}
                        loading={loading}
                        disabled={submitDisabled}
                        className="slf-primary-btn"
                        size={isMobile ? "middle" : "large"}
                        style={{
                          background: submitDisabled ? undefined : "#fff",
                          color: submitDisabled ? undefined : "#1a3353",
                          fontWeight: 600,
                          border: "none",
                          boxShadow: submitDisabled ? "none" : "0 2px 8px rgba(0,0,0,0.15)",
                          pointerEvents: submitDisabled ? "none" : undefined,
                        }}
                      >
                        {isMobile ? "Submit" : "Review & Submit"}
                      </Button>
                    </Badge>
                  </span>
                </Tooltip>
                </Space>
              }
            >
              {/* ── VERA contextual guidance (Issue 4) ──────────────────────────
                  A single, de-duplicated inline message that reports the EXACT
                  outstanding issues (never a generic "please complete your data")
                  and confirms completion once resolved. It is derived purely from
                  live submission state, so a fixed issue clears its own message on
                  the next render — no stale warnings linger after resolution. */}
              {!slfInfoLoading &&
                (submitBlockers.length > 0 ? (
                  <Alert
                    type="warning"
                    showIcon
                    icon={<RobotOutlined />}
                    style={{ marginBottom: 16 }}
                    message={
                      <Text strong style={{ fontSize: 13 }}>
                        VERA — {submitBlockers.length} item
                        {submitBlockers.length === 1 ? "" : "s"} need
                        {submitBlockers.length === 1 ? "s" : ""} attention before you can submit
                      </Text>
                    }
                    description={
                      <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12.5 }}>
                        {submitBlockers.map((reason, i) => (
                          <li key={i}>{reason}</li>
                        ))}
                      </ul>
                    }
                  />
                ) : baselineSaved ? (
                  <Alert
                    type="success"
                    showIcon
                    icon={<RobotOutlined />}
                    style={{ marginBottom: 16 }}
                    message={
                      <Text style={{ fontSize: 12.5 }}>
                        VERA: Baseline Data is complete and all required fields are valid.
                        No additional updates are required — you can submit.
                      </Text>
                    }
                  />
                ) : null)}
              {slfInfoLoading ? (
                <div style={{ textAlign: "center", padding: "40px 0" }}>
                  <Spin size="large" />
                  <div style={{ marginTop: 12 }}>
                    <Text type="secondary">Loading facility data...</Text>
                  </div>
                </div>
              ) : slfInfo ? (
                (() => {
                  const dashboardUnit = normalizeUnit(
                    slfInfo.volumeCapacityUnit ||
                      slfInfo.cellCapacityUnits?.find(Boolean) ||
                      slfInfo.cellFillUnits?.find(Boolean) ||
                      baselineUnit ||
                      "m³",
                  );
                  const cellCaps = slfInfo.cellCapacities || [];
                  const cellStatuses = slfInfo.cellStatuses || [];
                  const cellFillValues = slfInfo.cellFillValues || [];
                  const cellFillUnits = slfInfo.cellFillUnits || [];
                  const cellCapacityUnits = slfInfo.cellCapacityUnits || [];
                  const cells = Math.max(
                    Number(slfInfo.numberOfCell || 0),
                    cellCaps.length,
                    cellStatuses.length,
                    cellFillValues.length,
                  );
                  const cellTypes = slfInfo.cellTypes || [];
                  const adminCellRows = Array.from(
                    { length: cells },
                    (_, index) => {
                      const status = normalizeCellStatus(cellStatuses[index]);
                      const capacityUnit = normalizeUnit(
                        cellCapacityUnits[index] ||
                          slfInfo.volumeCapacityUnit ||
                          dashboardUnit,
                      );
                      const fillUnit = normalizeUnit(
                        cellFillUnits[index] ||
                          slfInfo.wasteReceivedUnit ||
                          capacityUnit,
                      );
                      const capacity = Number(cellCaps[index] || 0);
                      const used = convertVolume(
                        cellFillValues[index] || 0,
                        fillUnit,
                        capacityUnit,
                      );
                      const pct =
                        capacity > 0
                          ? Math.min(
                              Math.round(
                                (Math.min(used, capacity) / capacity) * 100,
                              ),
                              100,
                            )
                          : 0;
                      return {
                        index,
                        status,
                        type: cellTypes[index] || "Residual",
                        capacity,
                        capacityUnit,
                        fillUnit,
                        used,
                        pct,
                        remaining:
                          capacity > 0 ? Math.max(0, capacity - used) : 0,
                        isActive: isActiveCellStatus(status),
                        isCompleted: isCompletedCellStatus(status),
                        isUnavailable: isUnavailableCellStatus(status),
                      };
                    },
                  );
                  const capacity =
                    adminCellRows.reduce(
                      (sum, row) =>
                        sum +
                        convertVolume(
                          row.capacity,
                          row.capacityUnit,
                          dashboardUnit,
                        ),
                      0,
                    ) ||
                    convertVolume(
                      slfInfo.volumeCapacity || 0,
                      slfInfo.volumeCapacityUnit || dashboardUnit,
                      dashboardUnit,
                    );
                  const waste =
                    adminCellRows.reduce(
                      (sum, row) =>
                        sum +
                        convertVolume(
                          row.used,
                          row.capacityUnit,
                          dashboardUnit,
                        ),
                      0,
                    ) ||
                    convertVolume(
                      slfInfo.actualResidualWasteReceived || 0,
                      slfInfo.wasteReceivedUnit || dashboardUnit,
                      dashboardUnit,
                    );
                  const pct =
                    capacity > 0
                      ? Math.min(
                          Math.round(
                            (Math.min(waste, capacity) / capacity) * 100,
                          ),
                          100,
                        )
                      : 0;
                  const operationalCells = adminCellRows.filter(
                    (row) => row.isActive,
                  ).length;
                  const closedCells = adminCellRows.filter(
                    (row) => row.isCompleted,
                  ).length;
                  const residualCells =
                    adminCellRows.filter(
                      (row) => row.type !== "Treated Haz Waste",
                    ).length || cells;
                  const hazCells = adminCellRows.filter(
                    (row) => row.type === "Treated Haz Waste",
                  ).length;
                  const capColor =
                    pct >= 90 ? "#ff4d4f" : pct >= 70 ? "#faad14" : "#52c41a";
                  const capLabel =
                    pct >= 90 ? "Critical" : pct >= 70 ? "Warning" : "Normal";
                  const isOp = !slfInfo.statusOfSLF
                    ?.toLowerCase()
                    .includes("non");
                  // Baseline cell breakdown
                  const isResidualEntry = (entry) =>
                    !/haz|inert/i.test(String(entry?.wasteType || "Residual"));
                  const sumEntryVolumes = (entries, predicate) =>
                    entries
                      .filter(predicate)
                      .reduce(
                        (sum, entry) => sum + Number(entry?.volume || 0),
                        0,
                      );
                  const activeCellRes = activeCellEntries.length
                    ? sumEntryVolumes(activeCellEntries, isResidualEntry)
                    : baselineForm.getFieldValue("activeCellResidualVolume") ||
                      0;
                  const activeCellInert = activeCellEntries.length
                    ? sumEntryVolumes(
                        activeCellEntries,
                        (entry) => !isResidualEntry(entry),
                      )
                    : baselineForm.getFieldValue("activeCellInertVolume") || 0;
                  const closedCellRes = closedCellEntries.length
                    ? sumEntryVolumes(closedCellEntries, isResidualEntry)
                    : baselineForm.getFieldValue("closedCellResidualVolume") ||
                      0;
                  const closedCellInert = closedCellEntries.length
                    ? sumEntryVolumes(
                        closedCellEntries,
                        (entry) => !isResidualEntry(entry),
                      )
                    : baselineForm.getFieldValue("closedCellInertVolume") || 0;
                  const hasBaselineCell =
                    activeCellRes > 0 ||
                    activeCellInert > 0 ||
                    closedCellRes > 0 ||
                    closedCellInert > 0;
                  // LGU served split (from baseline hauler clients)
                  const allClients = haulers
                    .flatMap((h) => h.privateSectorClients || [])
                    .filter((c) => c.clientType === "LGU");
                  const lguR3Clients = allClients.filter(
                    (c) =>
                      (c.region || "").startsWith("03") ||
                      (c.regionName || "").toLowerCase().includes("iii") ||
                      (c.regionName || "")
                        .toLowerCase()
                        .includes("central luzon"),
                  );
                  const lguOutsideClients = allClients.filter(
                    (c) =>
                      !(
                        (c.region || "").startsWith("03") ||
                        (c.regionName || "").toLowerCase().includes("iii") ||
                        (c.regionName || "")
                          .toLowerCase()
                          .includes("central luzon")
                      ),
                  );
                  return (
                    <div>
                      {/* Capacity overview banner */}
                      <div
                        style={{
                          background: `linear-gradient(135deg, ${capColor}08 0%, ${capColor}15 100%)`,
                          border: `1px solid ${capColor}30`,
                          borderRadius: 12,
                          padding: isMobile ? 16 : 20,
                          marginBottom: 20,
                        }}
                      >
                        <Row gutter={[20, 16]} align="middle">
                          {/* `sm={6}` gave the gauge a quarter of a 576–767px
                              tablet — about 124px for a 100px dial plus its
                              capacity tag, which then wrapped mid-word. The gauge
                              now keeps the full row until md, where there is real
                              width to split. */}
                          <Col xs={24} sm={24} md={7} lg={6} style={{ textAlign: "center" }}>
                            <Progress
                              type="dashboard"
                              percent={pct}
                              size={isMobile ? 100 : 120}
                              strokeColor={{ "0%": capColor, "100%": capColor }}
                              strokeWidth={8}
                              format={() => (
                                <div style={{ lineHeight: 1.2 }}>
                                  <div
                                    style={{
                                      fontSize: 22,
                                      fontWeight: 800,
                                      color: capColor,
                                    }}
                                  >
                                    {pct}%
                                  </div>
                                  <div
                                    style={{
                                      fontSize: 10,
                                      color: "#8c8c8c",
                                      fontWeight: 500,
                                    }}
                                  >
                                    UTILIZATION
                                  </div>
                                </div>
                              )}
                            />
                            <Tag
                              color={capColor}
                              style={{
                                marginTop: 6,
                                fontWeight: 600,
                                fontSize: 11,
                              }}
                            >
                              {capLabel}
                            </Tag>
                          </Col>
                          <Col xs={24} sm={24} md={17} lg={18}>
                            <Row gutter={[12, 12]}>
                              {/* Status */}
                              <Col xs={12} sm={12} md={6}>
                                <div
                                  style={{
                                    background: isOp ? "#f6ffed" : "#fff2f0",
                                    borderRadius: 10,
                                    padding: "12px 14px",
                                    border: `1px solid ${isOp ? "#b7eb8f" : "#ffccc7"}`,
                                    height: "100%",
                                  }}
                                >
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 6,
                                      marginBottom: 6,
                                    }}
                                  >
                                    <CheckCircleOutlined
                                      style={{
                                        color: isOp ? "#52c41a" : "#ff4d4f",
                                        fontSize: 13,
                                      }}
                                    />
                                    <span
                                      style={{
                                        fontSize: 10,
                                        color: "#8c8c8c",
                                        textTransform: "uppercase",
                                        letterSpacing: 0.6,
                                        fontWeight: 600,
                                      }}
                                    >
                                      Status
                                    </span>
                                  </div>
                                  <Tag
                                    color={isOp ? "success" : "error"}
                                    style={{
                                      fontSize: 12,
                                      fontWeight: 600,
                                      padding: "2px 10px",
                                    }}
                                  >
                                    {slfInfo.statusOfSLF || "—"}
                                  </Tag>
                                </div>
                              </Col>
                              {/* Cells: Operational / Closed */}
                              <Col xs={12} sm={12} md={6}>
                                <div
                                  style={{
                                    background: "#e6f7ff",
                                    borderRadius: 10,
                                    padding: "12px 14px",
                                    border: "1px solid #91d5ff",
                                    height: "100%",
                                  }}
                                >
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 6,
                                      marginBottom: 6,
                                    }}
                                  >
                                    <ContainerOutlined
                                      style={{ color: "#1890ff", fontSize: 13 }}
                                    />
                                    <span
                                      style={{
                                        fontSize: 10,
                                        color: "#8c8c8c",
                                        textTransform: "uppercase",
                                        letterSpacing: 0.6,
                                        fontWeight: 600,
                                      }}
                                    >
                                      Cells
                                    </span>
                                  </div>
                                  {cells > 0 ? (
                                    <div>
                                      <Tag
                                        color="success"
                                        style={{
                                          fontSize: 11,
                                          marginBottom: 2,
                                        }}
                                      >
                                        Op: {operationalCells}
                                      </Tag>
                                      {closedCells > 0 && (
                                        <Tag
                                          color="default"
                                          style={{ fontSize: 11 }}
                                        >
                                          Closed: {closedCells}
                                        </Tag>
                                      )}
                                    </div>
                                  ) : (
                                    <div
                                      style={{
                                        fontSize: 16,
                                        fontWeight: 700,
                                        color: "#1890ff",
                                      }}
                                    >
                                      —
                                    </div>
                                  )}
                                  {cells > 0 && cellTypes.length > 0 && (
                                    <div style={{ marginTop: 4 }}>
                                      <Tag
                                        color="blue"
                                        style={{ fontSize: 10 }}
                                      >
                                        Res: {residualCells}
                                      </Tag>
                                      {hazCells > 0 && (
                                        <Tag
                                          color="red"
                                          style={{ fontSize: 10 }}
                                        >
                                          THW: {hazCells}
                                        </Tag>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </Col>
                              {/* Waste Filled — clickable */}
                              <Col xs={12} sm={12} md={6}>
                                <div
                                  style={{
                                    background: "#fff7e6",
                                    borderRadius: 10,
                                    padding: "12px 14px",
                                    border: "1px solid #ffd591",
                                    height: "100%",
                                    cursor: "pointer",
                                    transition: "box-shadow 0.2s",
                                  }}
                                  onClick={handleOpenWasteReceived}
                                  title="Click to view waste received breakdown"
                                >
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 6,
                                      marginBottom: 6,
                                    }}
                                  >
                                    <BarChartOutlined
                                      style={{ color: "#fa8c16", fontSize: 13 }}
                                    />
                                    <span
                                      style={{
                                        fontSize: 10,
                                        color: "#8c8c8c",
                                        textTransform: "uppercase",
                                        letterSpacing: 0.6,
                                        fontWeight: 600,
                                      }}
                                    >
                                      Waste Filled
                                    </span>
                                    <EyeOutlined
                                      style={{
                                        marginLeft: "auto",
                                        color: "#fa8c16",
                                        fontSize: 11,
                                      }}
                                    />
                                  </div>
                                  <div
                                    style={{
                                      fontSize: 16,
                                      fontWeight: 700,
                                      color: "#fa8c16",
                                    }}
                                  >
                                    {waste > 0
                                      ? `${waste.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${dashboardUnit}`
                                      : "—"}
                                  </div>
                                  {adminCellRows.some(
                                    (row) => row.used > 0,
                                  ) && (
                                    <div
                                      style={{
                                        fontSize: 10,
                                        color: "#8c8c8c",
                                        fontWeight: 500,
                                        marginTop: 2,
                                      }}
                                    >
                                      From Cell Infrastructure • Tap for
                                      breakdown
                                    </div>
                                  )}
                                </div>
                              </Col>
                              {/* Volume Capacity + LGUs Served */}
                              <Col xs={12} sm={12} md={6}>
                                <div
                                  style={{
                                    background: "#f9f0ff",
                                    borderRadius: 10,
                                    padding: "12px 14px",
                                    border: "1px solid #d3adf7",
                                    height: "100%",
                                  }}
                                >
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 6,
                                      marginBottom: 6,
                                    }}
                                  >
                                    <DatabaseOutlined
                                      style={{ color: "#722ed1", fontSize: 13 }}
                                    />
                                    <span
                                      style={{
                                        fontSize: 10,
                                        color: "#8c8c8c",
                                        textTransform: "uppercase",
                                        letterSpacing: 0.6,
                                        fontWeight: 600,
                                      }}
                                    >
                                      Capacity
                                    </span>
                                  </div>
                                  <div
                                    style={{
                                      fontSize: 16,
                                      fontWeight: 700,
                                      color: "#722ed1",
                                    }}
                                  >
                                    {capacity > 0
                                      ? `${capacity.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${dashboardUnit}`
                                      : "—"}
                                  </div>
                                  {capacity > 0 && waste > 0 && (
                                    <div
                                      style={{
                                        fontSize: 10,
                                        color: "#8c8c8c",
                                        fontWeight: 500,
                                        marginTop: 2,
                                      }}
                                    >
                                      {Math.max(
                                        0,
                                        capacity - waste,
                                      ).toLocaleString(undefined, {
                                        maximumFractionDigits: 2,
                                      })}{" "}
                                      {dashboardUnit} remaining
                                    </div>
                                  )}
                                </div>
                              </Col>
                            </Row>
                            {/* LGUs Served split */}
                            {allClients.length > 0 && (
                              <div
                                style={{
                                  marginTop: 12,
                                  background: "#f0f5ff",
                                  borderRadius: 10,
                                  padding: "10px 14px",
                                  border: "1px solid #adc6ff",
                                }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    marginBottom: 6,
                                  }}
                                >
                                  <TeamOutlined
                                    style={{ color: "#2f54eb", fontSize: 13 }}
                                  />
                                  <span
                                    style={{
                                      fontSize: 10,
                                      color: "#2f54eb",
                                      textTransform: "uppercase",
                                      letterSpacing: 0.6,
                                      fontWeight: 600,
                                    }}
                                  >
                                    LGUs Served
                                  </span>
                                </div>
                                <Space size={8} wrap>
                                  <Tag color="geekblue">
                                    Region III: {lguR3Clients.length}
                                  </Tag>
                                  <Tag color="cyan">
                                    Outside R3: {lguOutsideClients.length}
                                  </Tag>
                                  <Text
                                    style={{ fontSize: 11, color: "#8c8c8c" }}
                                  >
                                    Total: {allClients.length}
                                  </Text>
                                </Space>
                              </div>
                            )}
                          </Col>
                        </Row>
                      </div>

                      {/* Cell Infrastructure & Baseline Utilization — side by side */}
                      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
                        {adminCellRows.length > 0 && (
                          <Col xs={24} md={baselineSaved ? 14 : 24}>
                            <div
                              style={{
                                background: "#fff",
                                borderRadius: 12,
                                padding: isMobile ? 14 : 20,
                                border: "1px solid #e8e8e8",
                                boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
                                height: "100%",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                  marginBottom: 16,
                                }}
                              >
                                <div
                                  style={{
                                    width: 28,
                                    height: 28,
                                    borderRadius: 6,
                                    background: "#1a3353",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                  }}
                                >
                                  <PieChartOutlined
                                    style={{ color: "#fff", fontSize: 13 }}
                                  />
                                </div>
                                <Text
                                  strong
                                  style={{ fontSize: 14, color: "#1a3353" }}
                                >
                                  Cell Infrastructure
                                </Text>
                                <Space size={4} style={{ marginLeft: "auto" }}>
                                  <Tag color="success">
                                    Operational: {operationalCells}
                                  </Tag>
                                  {closedCells > 0 && (
                                    <Tag color="default">
                                      Closed: {closedCells}
                                    </Tag>
                                  )}
                                </Space>
                              </div>
                              <Row gutter={[12, 12]}>
                                {adminCellRows.map((row) => {
                                  const cap = row.capacity;
                                  const cellSt = row.status;
                                  const cellT = row.type;
                                  const isClosed = row.isCompleted;
                                  const isInactive =
                                    row.isCompleted || row.isUnavailable;
                                  const isHaz = cellT === "Treated Haz Waste";
                                  const cellFillUnit = row.capacityUnit;
                                  const cellFill = row.used;
                                  const cellPct = row.pct;
                                  const cellColor = isClosed
                                    ? "#d9d9d9"
                                    : isInactive
                                      ? "#722ed1"
                                      : isHaz
                                        ? cellPct >= 90
                                          ? "#ff4d4f"
                                          : cellPct >= 70
                                            ? "#faad14"
                                            : "#f5222d"
                                        : cellPct >= 90
                                          ? "#ff4d4f"
                                          : cellPct >= 70
                                            ? "#faad14"
                                            : "#52c41a";
                                  const remaining = row.remaining;
                                  return (
                                    <Col
                                      xs={12}
                                      sm={8}
                                      md={Math.min(8, Math.floor(24 / cells))}
                                      key={row.index}
                                    >
                                      <div
                                        style={{
                                          background: isClosed
                                            ? "#fafafa"
                                            : "#fff",
                                          borderRadius: 10,
                                          padding: "14px 12px",
                                          border: `1px solid ${isClosed ? "#e8e8e8" : cellColor}30`,
                                          textAlign: "center",
                                          opacity: isClosed ? 0.7 : 1,
                                        }}
                                      >
                                        <Progress
                                          type="dashboard"
                                          percent={isInactive ? 0 : cellPct}
                                          size={isMobile ? 64 : 80}
                                          strokeWidth={6}
                                          strokeColor={cellColor}
                                          trailColor={
                                            isClosed ? "#bfbfbf" : undefined
                                          }
                                          format={() => (
                                            <span
                                              style={{
                                                fontSize: isMobile ? 13 : 15,
                                                fontWeight: 700,
                                                color: cellColor,
                                              }}
                                            >
                                              {isClosed
                                                ? "—"
                                                : isInactive
                                                  ? "N/A"
                                                  : `${cellPct}%`}
                                            </span>
                                          )}
                                        />
                                        <div
                                          style={{
                                            fontWeight: 700,
                                            fontSize: 13,
                                            color: "#1a3353",
                                            marginTop: 6,
                                          }}
                                        >
                                          Cell {row.index + 1}
                                        </div>
                                        <Tag
                                          color={
                                            isClosed
                                              ? "default"
                                              : isInactive
                                                ? "purple"
                                                : "success"
                                          }
                                          style={{ fontSize: 10, marginTop: 4 }}
                                        >
                                          {cellSt}
                                        </Tag>
                                        <Tag
                                          color={isHaz ? "red" : "blue"}
                                          style={{ fontSize: 10, marginTop: 2 }}
                                        >
                                          {cellT}
                                        </Tag>
                                        <div
                                          style={{
                                            fontSize: 11,
                                            color: "#8c8c8c",
                                            marginTop: 4,
                                            fontWeight: 500,
                                          }}
                                        >
                                          {cap > 0
                                            ? `${cap.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${row.capacityUnit}`
                                            : "—"}
                                        </div>
                                        {!isInactive && cellFill > 0 && (
                                          <div
                                            style={{
                                              fontSize: 10,
                                              marginTop: 3,
                                            }}
                                          >
                                            <span
                                              style={{
                                                color: isHaz
                                                  ? "#f5222d"
                                                  : "#52c41a",
                                                fontWeight: 600,
                                              }}
                                            >
                                              {cellFill.toLocaleString(
                                                undefined,
                                                { maximumFractionDigits: 1 },
                                              )}{" "}
                                              {cellFillUnit}
                                            </span>{" "}
                                            <span style={{ color: "#8c8c8c" }}>
                                              filled
                                            </span>
                                          </div>
                                        )}
                                        {!isInactive &&
                                          cap > 0 &&
                                          remaining > 0 && (
                                            <div
                                              style={{
                                                fontSize: 10,
                                                color: "#8c8c8c",
                                                marginTop: 1,
                                              }}
                                            >
                                              {remaining.toLocaleString(
                                                undefined,
                                                { maximumFractionDigits: 1 },
                                              )}{" "}
                                              {cellFillUnit} remaining
                                            </div>
                                          )}
                                      </div>
                                    </Col>
                                  );
                                })}
                              </Row>
                            </div>
                          </Col>
                        )}
                        {/* Baseline Utilization Breakdown */}
                        {baselineSaved && (
                          <Col xs={24} md={cells > 0 ? 10 : 24}>
                            <div
                              style={{
                                background: "#fff",
                                borderRadius: 12,
                                padding: isMobile ? 14 : 20,
                                border: "1px solid #e8e8e8",
                                boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
                                height: "100%",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                  marginBottom: 16,
                                }}
                              >
                                <div
                                  style={{
                                    width: 28,
                                    height: 28,
                                    borderRadius: 6,
                                    background: "#722ed1",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                  }}
                                >
                                  <DatabaseOutlined
                                    style={{ color: "#fff", fontSize: 13 }}
                                  />
                                </div>
                                <Text
                                  strong
                                  style={{ fontSize: 14, color: "#1a3353" }}
                                >
                                  Baseline Utilization
                                </Text>
                                <Tag
                                  color="purple"
                                  style={{
                                    marginLeft: "auto",
                                    fontWeight: 500,
                                  }}
                                >
                                  From Baseline Data
                                </Tag>
                              </div>
                              {hasBaselineCell ? (
                                <Row gutter={[12, 12]}>
                                  {[
                                    {
                                      label: "Active Cell (Residual)",
                                      value: activeCellRes,
                                      unit: baselineUnit || baselineUnit,
                                      color: "#52c41a",
                                    },
                                    {
                                      label: "Active Cell (Inert)",
                                      value: activeCellInert,
                                      unit: baselineUnit || baselineUnit,
                                      color: "#1890ff",
                                    },
                                    {
                                      label: "Closed Cell (Residual)",
                                      value: closedCellRes,
                                      unit: baselineUnit || baselineUnit,
                                      color: "#fa8c16",
                                    },
                                    {
                                      label: "Closed Cell (Inert)",
                                      value: closedCellInert,
                                      unit: baselineUnit || baselineUnit,
                                      color: "#8c8c8c",
                                    },
                                  ]
                                    .filter((d) => d.value > 0)
                                    .map((item, idx) => (
                                      <Col xs={12} sm={12} md={6} key={idx}>
                                        <div
                                          style={{
                                            background: `${item.color}08`,
                                            borderRadius: 10,
                                            padding: "12px 14px",
                                            border: `1px solid ${item.color}30`,
                                            textAlign: "center",
                                          }}
                                        >
                                          <div
                                            style={{
                                              fontSize: 10,
                                              color: "#8c8c8c",
                                              textTransform: "uppercase",
                                              letterSpacing: 0.5,
                                              fontWeight: 600,
                                              marginBottom: 4,
                                            }}
                                          >
                                            {item.label}
                                          </div>
                                          <div
                                            style={{
                                              fontSize: 16,
                                              fontWeight: 700,
                                              color: item.color,
                                            }}
                                          >
                                            {Number(
                                              item.value,
                                            ).toLocaleString()}
                                          </div>
                                          <div
                                            style={{
                                              fontSize: 10,
                                              color: "#8c8c8c",
                                            }}
                                          >
                                            {item.unit}
                                          </div>
                                        </div>
                                      </Col>
                                    ))}
                                </Row>
                              ) : (
                                <div
                                  style={{
                                    background: "#fff7e6",
                                    border: "1px solid #ffe58f",
                                    borderRadius: 8,
                                    padding: "10px 14px",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                  }}
                                >
                                  <InfoCircleOutlined
                                    style={{ color: "#faad14" }}
                                  />
                                  <Text
                                    style={{ color: "#ad6800", fontSize: 12 }}
                                  >
                                    Cell volume breakdown not yet encoded in
                                    baseline data. Request an update to provide
                                    active/closed cell volumes.
                                  </Text>
                                </div>
                              )}
                            </div>
                          </Col>
                        )}
                      </Row>

                      {/* Facility Details */}
                      <div
                        style={{
                          background: "#fff",
                          borderRadius: 12,
                          border: "1px solid #e8e8e8",
                          boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "12px 20px",
                            borderBottom: "1px solid #f0f0f0",
                            background: "#fafbfc",
                          }}
                        >
                          <div
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: 6,
                              background: "#1a3353",
                              display: "none",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <FileTextOutlined
                              style={{ color: "#fff", fontSize: 13 }}
                            />
                          </div>
                          <Text
                            strong
                            style={{ fontSize: 14, color: "#1a3353" }}
                          >
                            Facility Details
                          </Text>
                        </div>
                        <div style={{ padding: isMobile ? 12 : 16 }}>
                          <Row gutter={[16, 12]}>
                            {[
                              slfInfo.category && {
                                label: "Category",
                                value: slfInfo.category,
                              },
                              slfInfo.yearStartedOperation && {
                                label: "Year Started",
                                value: slfInfo.yearStartedOperation,
                              },
                              slfInfo.remainingLifeSpan && {
                                label: "Remaining Lifespan",
                                value: slfInfo.remainingLifeSpan,
                              },
                              slfInfo.noOfLeachatePond != null && {
                                label: "Leachate Treatment Plant",
                                value: slfInfo.noOfLeachatePond,
                              },
                              slfInfo.numberOfGasVents != null && {
                                label: "Gas Management",
                                value: slfInfo.numberOfGasVents,
                              },
                              slfInfo.hasWastewaterTreatmentFacility !=
                                null && {
                                label: "WWTF",
                                value: slfInfo.hasWastewaterTreatmentFacility
                                  ? (Array.isArray(
                                      slfInfo.wastewaterTreatmentFacilityType,
                                    )
                                      ? slfInfo.wastewaterTreatmentFacilityType.join(
                                          ", ",
                                        )
                                      : slfInfo.wastewaterTreatmentFacilityType) ||
                                    "Yes"
                                  : "No",
                              },
                              [
                                slfInfo.barangay,
                                slfInfo.lgu,
                                slfInfo.province,
                              ].some(Boolean) && {
                                label: "Location",
                                value: [
                                  slfInfo.barangay,
                                  slfInfo.lgu,
                                  slfInfo.province,
                                ]
                                  .filter(Boolean)
                                  .join(", "),
                              },
                              slfInfo.ownership && {
                                label: "Ownership",
                                value: slfInfo.ownership,
                              },
                              slfInfo.mrfEstablished && {
                                label: "MRF Status",
                                value: slfInfo.mrfEstablished,
                              },
                              slfInfo.eccNo && {
                                label: "ECC No.",
                                value: slfInfo.eccNo,
                              },
                              slfInfo.dischargePermit && {
                                label: "Discharge Permit",
                                value: slfInfo.dischargePermit,
                              },
                              slfInfo.permitToOperate && {
                                label: "Permit to Operate",
                                value: slfInfo.permitToOperate,
                              },
                              slfInfo.hazwasteGenerationId && {
                                label: "Hazwaste Gen. ID",
                                value: slfInfo.hazwasteGenerationId,
                              },
                            ]
                              .filter(Boolean)
                              .map((item, idx) => (
                                <Col xs={24} sm={12} md={8} key={idx}>
                                  <div
                                    style={{
                                      padding: "8px 12px",
                                      borderRadius: 8,
                                      background: "#f8f9fb",
                                    }}
                                  >
                                    <div
                                      style={{
                                        fontSize: 11,
                                        color: "#8c8c8c",
                                        textTransform: "uppercase",
                                        letterSpacing: 0.5,
                                        fontWeight: 600,
                                        marginBottom: 2,
                                      }}
                                    >
                                      {item.label}
                                    </div>
                                    <div
                                      style={{
                                        fontSize: 13,
                                        fontWeight: 600,
                                        color: "#262626",
                                        wordBreak: "break-word",
                                      }}
                                    >
                                      {item.value}
                                    </div>
                                  </div>
                                </Col>
                              ))}
                          </Row>
                        </div>
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div
                  style={{
                    background:
                      "linear-gradient(135deg, #fffbe6 0%, #fff8e1 100%)",
                    border: "1px solid #ffe58f",
                    borderRadius: 10,
                    padding: "16px 20px",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <InfoCircleOutlined
                    style={{ color: "#faad14", fontSize: 20 }}
                  />
                  <div>
                    <Text strong style={{ color: "#ad6800", display: "block" }}>
                      Facility Data Unavailable
                    </Text>
                    <Text style={{ color: "#ad6800", fontSize: 12 }}>
                      SLF operational data is currently being processed. Details
                      will appear here once available.
                    </Text>
                  </div>
                </div>
              )}
            </Card>
      {/* Outside the Card: its body is collapsed (maxHeight 0), so anything
          placed inside it never renders. */}
      {resubmittingIdNo && (
        <Alert
        type="info"
        showIcon
        style={{ marginTop: 12 }}
        message={
          <Text style={{ fontSize: 12.5 }}>
            You are correcting reverted entry <Text strong>{resubmittingIdNo}</Text>.{" "}
            <Text strong>Review &amp; Submit</Text> will resubmit it for EMB Region III review,
            labelled as a Resubmission.
          </Text>
        }
      />
    )}
      {revertToResolve && onResolveRevert && (
        <Alert
        type="error"
        showIcon
        style={{ marginTop: 12 }}
        message={
          <Text strong style={{ fontSize: 13 }}>
            Reverted entry {revertToResolve.idNo || ""} is waiting for your correction
          </Text>
        }
        description={
          <Text style={{ fontSize: 12.5 }}>
            New submissions and drafts cannot be submitted until it is corrected and resubmitted.
            {revertToResolve.revertReason ? ` Reason: ${revertToResolve.revertReason}` : ""}
          </Text>
        }
        action={
          <Button
            size="small"
            type="primary"
            style={{ background: "#fa541c", borderColor: "#fa541c" }}
            onClick={() => onResolveRevert(revertToResolve)}
          >
            Resubmit {revertToResolve.idNo || "now"}
          </Button>
        }
      />
    )}
    </>
  );
}

