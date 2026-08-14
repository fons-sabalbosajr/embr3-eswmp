import { getCellTypeConfig, getSlfCapacityColor, isNonExistentCell, resolveCellName } from "../../../../utils/cellVisuals";
import { VOLUME_METRICS } from "../../../../utils/volumeMetrics";
import CellGaugeLegend from "../../slf-monitoring/CellGaugeLegend";
import HaulerClientsTab from "../../slf-monitoring/HaulerClientsTab";
import SlfDashboardTab, { getStatusTag } from "../../slf-monitoring/SlfDashboardTab";
import { ACCENT, CHART_COLORS, convertVolume, formatStringArray, getMediaKind, getServedClientCount, isActiveCellStatus, isCompletedCellStatus, isHazardousCellType, normalizeCellStatus, normalizeStoredFileUrl, normalizeUnit, resolveMediaOpenUrl, resolveMediaUrl } from "../../slf-monitoring/helpers.jsx";
import { AlertOutlined, AppstoreOutlined, BankOutlined, BarChartOutlined, BellOutlined, DatabaseOutlined, EnvironmentOutlined, ExperimentOutlined, EyeOutlined, FileImageOutlined, FilePdfOutlined, FileTextOutlined, FolderOutlined, LinkOutlined, PlayCircleOutlined, SafetyCertificateOutlined, TeamOutlined, UnorderedListOutlined, WarningOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Col, Collapse, Descriptions, Divider, Empty, Image, List, Modal, Progress, Row, Segmented, Space, Statistic, Table, Tabs, Tag, Tooltip, Typography } from "antd";
import dayjs from "dayjs";
import { Bar, BarChart, CartesianGrid, Cell as RCell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";

const { Text } = Typography;

// Facility detail modal: the read-only profile view for one SLF — overview,
// dashboard metrics, cell infrastructure, gallery, documents and submission
// history.
//
// The largest single region of the container. All fetching stays there; this
// component only renders what it is given.
export default function SlfDetailModal({
  isDark,
  detailModal,
  setDetailModal,
  detailViewRecord,
  detailDashboard,
  detailDashboardError,
  detailProgress,
  detailHistoryLoading,
  detailSubmissionsLoading,
  baselineData,
  loadingBaseline,
  galleryViewMode,
  setGalleryViewMode,
  openFilePreview,
  openDailySubmissionsModal,
  setCapacityAlertModal,
}) {
  return (
    <Modal
      title={
        <Space size={6}>
          <BankOutlined style={{ color: ACCENT }} />
          <span>SLF Facility Details</span>
          {detailModal && (
            <>
              <Text
                type="secondary"
                style={{ fontWeight: 400, fontSize: 13 }}
              >
                —
              </Text>
              <Text strong style={{ color: ACCENT, fontSize: 14 }}>
                {detailModal.lgu || ""}
              </Text>
              {detailModal.province && (
                <Text
                  type="secondary"
                  style={{ fontSize: 12, fontWeight: 400 }}
                >
                  {detailModal.province}
                </Text>
              )}
            </>
          )}
        </Space>
      }
      open={!!detailModal}
      onCancel={() => setDetailModal(null)}
      footer={<Button onClick={() => setDetailModal(null)}>Close</Button>}
      width={1400}
    >
      {detailModal && (
        <>
          {detailViewRecord ? (
            <Tabs
              className="slf-detail-tabs"
              defaultActiveKey="slf-dashboard"
              tabPosition="left"
              destroyInactiveTabPane
              style={{ minHeight: 400 }}
              tabBarStyle={{
                background: isDark ? "rgba(22,119,255,0.08)" : "#f0f5ff",
                borderRight: `1px solid ${isDark ? "#1d3a6b" : "#d6e4ff"}`,
                borderRadius: "8px 0 0 8px",
                padding: "8px 0",
              }}
              items={[
                {
                  key: "slf-dashboard",
                  label: (
                    <span style={{ color: "#722ed1" }}>
                      <BarChartOutlined /> SLF Dashboard
                    </span>
                  ),
                  children: (
                    <SlfDashboardTab
                      dashboard={detailDashboard}
                      isDark={isDark}
                      loading={
                        detailHistoryLoading ||
                        loadingBaseline ||
                        detailSubmissionsLoading
                      }
                      progress={detailProgress}
                      error={detailDashboardError}
                    />
                  ),
                },
                {
                  key: "1",
                  label: (
                    <span style={{ color: "#1677ff" }}>
                      <EnvironmentOutlined /> Location &amp; Facility Details
                    </span>
                  ),
                  children: (
                    <>
                      <Descriptions column={2} size="small" bordered>
                        <Descriptions.Item label="Province">
                          {detailViewRecord.province || "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="LGU">
                          {detailViewRecord.lgu || "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="Barangay">
                          {detailViewRecord.barangay || "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="MBA">
                          {detailViewRecord.manilaBayArea || "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="Ownership">
                          {detailViewRecord.ownership || "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="District">
                          {detailViewRecord.congressionalDistrict || "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="Status">
                          {getStatusTag(detailViewRecord.statusOfSLF)}
                        </Descriptions.Item>
                        <Descriptions.Item label="SLF Category">
                          {detailViewRecord.category ? (
                            <Tag color="blue">
                              {detailViewRecord.category}
                            </Tag>
                          ) : (
                            "—"
                          )}
                        </Descriptions.Item>
                        <Descriptions.Item label="Year Started">
                          {detailViewRecord.yearStartedOperation || "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="Capacity per day">
                          {detailViewRecord.receivingVolumeCapacity
                            ? `${Number(detailViewRecord.receivingVolumeCapacity).toLocaleString()} ${normalizeUnit(detailViewRecord.receivingVolumeCapacityUnit)}`
                            : "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="LGUs Served">
                          {getServedClientCount(detailViewRecord) || "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="WWTF">
                          {detailViewRecord.hasWastewaterTreatmentFacility ? (
                            <Tag color="success">Yes</Tag>
                          ) : (
                            <Tag>No</Tag>
                          )}
                        </Descriptions.Item>
                        <Descriptions.Item label="Treatment Type">
                          {formatStringArray(
                            detailViewRecord.wastewaterTreatmentFacilityType,
                          ) || "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="WWTF Remarks">
                          {detailViewRecord.wastewaterTreatmentFacilityRemarks ||
                            "—"}
                        </Descriptions.Item>
                      </Descriptions>
                      {(detailViewRecord.receivingFacilities || []).length >
                        0 && (
                        <>
                          <Divider plain orientation="left">
                            <BankOutlined /> Receiving Facility Table
                          </Divider>
                          <Table
                            dataSource={detailViewRecord.receivingFacilities}
                            rowKey={(_, i) => i}
                            size="small"
                            pagination={false}
                            columns={[
                              {
                                title: "No.",
                                width: 64,
                                align: "center",
                                render: (_, __, index) => index + 1,
                              },
                              {
                                title: "MRF Type",
                                dataIndex: "mrfTypes",
                                render: (types) =>
                                  (types || []).length ? (
                                    <Space wrap>
                                      {(types || []).map((type) => (
                                        <Tag key={type} color="blue">
                                          {type}
                                        </Tag>
                                      ))}
                                    </Space>
                                  ) : (
                                    "—"
                                  ),
                              },
                              {
                                title: "MRF Name",
                                dataIndex: "mrfName",
                                render: (value) => value || "—",
                              },
                              {
                                title: "Status",
                                dataIndex: "status",
                                width: 150,
                                render: (value) =>
                                  value ? (
                                    <Tag
                                      color={
                                        value === "Active"
                                          ? "green"
                                          : value === "Under Construction"
                                            ? "orange"
                                            : "default"
                                      }
                                    >
                                      {value}
                                    </Tag>
                                  ) : (
                                    "—"
                                  ),
                              },
                              {
                                title: "Description",
                                dataIndex: "description",
                                render: (value) =>
                                  value ? (
                                    <Text
                                      ellipsis={{ tooltip: value }}
                                      style={{
                                        maxWidth: 280,
                                        display: "block",
                                      }}
                                    >
                                      {value}
                                    </Text>
                                  ) : (
                                    <Text type="secondary">—</Text>
                                  ),
                              },
                            ]}
                          />
                        </>
                      )}
                    </>
                  ),
                },
                {
                  key: "2",
                  label: (
                    <span style={{ color: "#13b626" }}>
                      <BankOutlined /> Facility &amp; Operations
                    </span>
                  ),
                  children: (() => {
                    // Count the cells the facility ACTUALLY has, the same way
                    // Cell Infrastructure counts them: a "Not Existed" cell is a
                    // deleted one and is not shown or counted there, so reading
                    // the raw numberOfCell here reported a different figure for
                    // the same SLF on two admin screens.
                    const configuredStatuses = detailViewRecord.cellStatuses || [];
                    const configuredCount = Math.max(
                      Number(detailViewRecord.numberOfCell || 0),
                      configuredStatuses.length,
                    );
                    const cells = configuredStatuses.length
                      ? Array.from({ length: configuredCount }).filter(
                          (_, i) => !isNonExistentCell(configuredStatuses[i] || "Active Cell"),
                        ).length
                      : configuredCount;
                    const leachate = detailViewRecord.noOfLeachatePond || 0;
                    const gasVents = detailViewRecord.numberOfGasVents || 0;
                    // Waste Received is the canonical rollup total (baseline +
                    // valid submissions, each once) — the same number Cell
                    // Infrastructure and the portal read. See
                    // enrichFacilityWithBaseline / GET /data-slf/cell-occupancy.
                    const wasteReceived =
                      detailViewRecord.actualResidualWasteReceived || 0;
                    const wasteReceivedUnit = normalizeUnit(
                      detailViewRecord.wasteReceivedUnit || "m³",
                    );
                    const estVolume = 0;
                    const capacity = detailViewRecord.volumeCapacity || 0;
                    const capacityUnit = normalizeUnit(
                      detailViewRecord.volumeCapacityUnit || "m³",
                    );
                    const wasteReceivedInCapacityUnit = convertVolume(
                      wasteReceived,
                      wasteReceivedUnit,
                      capacityUnit,
                    );
                    const receivingCapacity =
                      detailViewRecord.receivingVolumeCapacity || 0;
                    const receivingCapacityUnit = normalizeUnit(
                      detailViewRecord.receivingVolumeCapacityUnit ||
                        detailViewRecord.volumeCapacityUnit ||
                        "m³",
                    );
                    // Leachate & Gas removed from the Facility & Operations UI
                    // (each SLF cell carries its own capacity data instead).
                    const infraData = [
                      { name: "Cells", value: cells },
                    ].filter((d) => d.value > 0);
                    const capacityData = (() => {
                      if (capacity > 0) {
                        return [
                          {
                            name: "Waste Received",
                            value: Math.min(
                              wasteReceivedInCapacityUnit,
                              capacity,
                            ),
                          },
                          {
                            name: "Remaining Capacity",
                            value: Math.max(
                              0,
                              capacity - wasteReceivedInCapacityUnit,
                            ),
                          },
                        ];
                      }
                      return wasteReceived > 0
                        ? [{ name: "Waste Received", value: wasteReceived }]
                        : [];
                    })();
                    const volumeData = [
                      wasteReceived > 0 && {
                        name: "Waste Received",
                        value: wasteReceived,
                      },
                      capacity > 0 && { name: "Capacity", value: capacity },
                    ].filter(Boolean);
                    const activeCellEntries = Array.isArray(
                      baselineData?.activeCellEntries,
                    )
                      ? baselineData.activeCellEntries
                      : [];
                    const closedCellEntries = Array.isArray(
                      baselineData?.closedCellEntries,
                    )
                      ? baselineData.closedCellEntries
                      : [];
                    const baselineEntryUnit = normalizeUnit(
                      baselineData?.baselineUnit ||
                        baselineData?.totalVolumeAcceptedUnit ||
                        "m³",
                    );
                    const baselineEntryVolumeData = [
                      ...activeCellEntries.map((entry, i) => ({
                        name: `Active ${entry.cellName || `Cell ${i + 1}`}`,
                        value: Number(entry.volume || 0),
                        unit: normalizeUnit(entry.unit || baselineEntryUnit),
                      })),
                      ...closedCellEntries.map((entry, i) => ({
                        name: `Closed ${entry.cellName || `Cell ${i + 1}`}`,
                        value: Number(entry.volume || 0),
                        unit: normalizeUnit(entry.unit || baselineEntryUnit),
                      })),
                    ].filter((item) => item.value > 0);
                    // Cell volume data from baseline
                    const aggregateCellVolumeData = baselineData
                      ? [
                          baselineData.activeCellResidualVolume > 0 && {
                            name: "Active Residual",
                            value: baselineData.activeCellResidualVolume,
                            unit: (
                              baselineData.activeCellResidualUnit || "m³"
                            ).replace("m3", "m³"),
                          },
                          baselineData.activeCellInertVolume > 0 && {
                            name: "Active Inert",
                            value: baselineData.activeCellInertVolume,
                            unit: (
                              baselineData.activeCellInertUnit || "m³"
                            ).replace("m3", "m³"),
                          },
                          baselineData.closedCellResidualVolume > 0 && {
                            name: "Closed Residual",
                            value: baselineData.closedCellResidualVolume,
                            unit: (
                              baselineData.closedCellResidualUnit || "m³"
                            ).replace("m3", "m³"),
                          },
                          baselineData.closedCellInertVolume > 0 && {
                            name: "Closed Inert",
                            value: baselineData.closedCellInertVolume,
                            unit: (
                              baselineData.closedCellInertUnit || "m³"
                            ).replace("m3", "m³"),
                          },
                        ].filter(Boolean)
                      : [];
                    const cellVolumeData =
                      baselineEntryVolumeData.length > 0
                        ? baselineEntryVolumeData
                        : aggregateCellVolumeData;
                    const hasCharts =
                      infraData.length > 0 ||
                      capacityData.length > 0 ||
                      cellVolumeData.length > 0;
                    const pctUsed =
                      capacity > 0
                        ? Math.min(
                            Math.round(
                              (wasteReceivedInCapacityUnit / capacity) * 100,
                            ),
                            100,
                          )
                        : 0;
                    const cellCaps = detailViewRecord.cellCapacities || [];
                    return (
                      <>
                        <Descriptions
                          column={3}
                          size="small"
                          bordered
                          style={{ marginBottom: 16 }}
                        >
                          <Descriptions.Item label="Cells">
                            {cells || "—"}
                          </Descriptions.Item>
                          <Descriptions.Item
                            label="Waste Received in Cell"
                            span={1}
                          >
                            {wasteReceived
                              ? `${Number(wasteReceived).toLocaleString()} ${normalizeUnit(detailViewRecord.wasteReceivedUnit || "tons")}`
                              : "—"}
                          </Descriptions.Item>
                          <Descriptions.Item
                            label="Capacity per day"
                            span={1}
                          >
                            {receivingCapacity
                              ? `${Number(receivingCapacity).toLocaleString()} ${receivingCapacityUnit}`
                              : "—"}
                          </Descriptions.Item>
                        </Descriptions>

                        {/* Cell Infrastructure Status */}
                        {cells > 0 &&
                          (() => {
                            const cellStatuses =
                              detailViewRecord.cellStatuses || [];
                            const cellTypesArr =
                              detailViewRecord.cellTypes || [];
                            const cellCapacityUnits =
                              detailViewRecord.cellCapacityUnits || [];
                            const hasAnyBaselineData = Boolean(baselineData);
                            const hasCellUsageRows = (
                              detailViewRecord._cellUsageRows || []
                            ).some(
                              (row) =>
                                Number(row?.baseline || 0) > 0 ||
                                Number(row?.submissions || 0) > 0 ||
                                Number(row?.total || 0) > 0,
                            );
                            const hasCellBaseline =
                              hasCellUsageRows ||
                              (baselineData &&
                                (activeCellEntries.some(
                                  (entry) => Number(entry?.volume || 0) > 0,
                                ) ||
                                  closedCellEntries.some(
                                    (entry) => Number(entry?.volume || 0) > 0,
                                  ) ||
                                  baselineData.activeCellResidualVolume > 0 ||
                                  baselineData.activeCellInertVolume > 0 ||
                                  baselineData.closedCellResidualVolume > 0 ||
                                  baselineData.closedCellInertVolume > 0));
                            return (
                              <>
                                <Divider plain orientation="left">
                                  <BarChartOutlined /> Cell Infrastructure
                                  Status
                                </Divider>
                                <Row
                                  gutter={[16, 16]}
                                  style={{ marginBottom: 16 }}
                                >
                                  <Col xs={24}>
                                    <Card
                                      size="small"
                                      title={
                                        <Space wrap size={4}>
                                          <BarChartOutlined /> Per-Cell Status
                                          &amp; Capacity
                                          {detailViewRecord._cellUsageSubmissionCount >
                                            0 && (
                                            <Tag
                                              color="geekblue"
                                              style={{ fontSize: 10 }}
                                            >
                                              {
                                                detailViewRecord._cellUsageSubmissionCount
                                              }{" "}
                                              portal submission
                                              {detailViewRecord._cellUsageSubmissionCount !==
                                              1
                                                ? "s"
                                                : ""}{" "}
                                              included
                                            </Tag>
                                          )}
                                        </Space>
                                      }
                                      style={{ borderRadius: 10 }}
                                    >
                                      {(() => {
                                        const fillValues =
                                          detailViewRecord.cellFillValues ||
                                          [];
                                        const fillUnits =
                                          detailViewRecord.cellFillUnits ||
                                          [];
                                        const alertCells = (
                                          cellCaps.length > 0
                                            ? cellCaps
                                            : Array.from(
                                                { length: cells },
                                                () => 0,
                                              )
                                        )
                                          .map((cap, index) => {
                                            const status =
                                              normalizeCellStatus(
                                                cellStatuses[index],
                                              );
                                            if (
                                              !isActiveCellStatus(status) ||
                                              Number(cap || 0) <= 0
                                            )
                                              return null;
                                            const capUnit = normalizeUnit(
                                              cellCapacityUnits[index] ||
                                                detailViewRecord.volumeCapacityUnit ||
                                                "m³",
                                            );
                                            const used = convertVolume(
                                              fillValues[index] || 0,
                                              fillUnits[index] ||
                                                detailViewRecord.wasteReceivedUnit ||
                                                capUnit,
                                              capUnit,
                                            );
                                            const pct = Math.min(
                                              Math.round(
                                                (used / Number(cap || 0)) *
                                                  100,
                                              ),
                                              100,
                                            );
                                            return {
                                              index,
                                              pct,
                                              used,
                                              capacity: Number(cap || 0),
                                              unit: capUnit,
                                              status,
                                            };
                                          })
                                          .filter(
                                            (cell) => cell && cell.pct >= 80,
                                          );
                                        return alertCells.length > 0 ? (
                                          <Alert
                                            type="warning"
                                            showIcon
                                            style={{
                                              marginBottom: 12,
                                              borderRadius: 8,
                                            }}
                                            message={
                                              <Space wrap>
                                                <Text strong>
                                                  Active cell reached 80%
                                                  capacity
                                                </Text>
                                                <Tag color="orange">
                                                  {resolveCellName(
                                                    detailViewRecord,
                                                    alertCells[0].index,
                                                  )}
                                                  : {alertCells[0].pct}% full
                                                </Tag>
                                                <Button
                                                  size="small"
                                                  type="primary"
                                                  icon={<BellOutlined />}
                                                  onClick={() =>
                                                    setCapacityAlertModal({
                                                      open: true,
                                                      record:
                                                        detailViewRecord,
                                                      cell: alertCells[0],
                                                      message: `${detailViewRecord.lgu || "Assigned SLF"} Cell ${alertCells[0].index + 1} is ${alertCells[0].pct}% full (${alertCells[0].used.toLocaleString(undefined, { maximumFractionDigits: 2 })} / ${alertCells[0].capacity.toLocaleString()} ${alertCells[0].unit}). Please review disposal planning and remaining cell capacity.`,
                                                    })
                                                  }
                                                >
                                                  Notify Assigned Users
                                                </Button>
                                              </Space>
                                            }
                                          />
                                        ) : null;
                                      })()}
                                      {detailViewRecord._submissionWasteReceived >
                                        0 && (
                                        <div
                                          style={{
                                            marginBottom: 8,
                                            fontSize: 11,
                                            color: "#8c8c8c",
                                            borderBottom: "1px solid #f0f0f0",
                                            paddingBottom: 6,
                                          }}
                                        >
                                          <Space size={12} wrap>
                                            <span>
                                              Baseline:{" "}
                                              <Text strong>
                                                {Number(
                                                  detailViewRecord._baselineWasteReceived ||
                                                    0,
                                                ).toLocaleString()}{" "}
                                                {normalizeUnit(
                                                  detailViewRecord.wasteReceivedUnit ||
                                                    "tons",
                                                )}
                                              </Text>
                                            </span>
                                            <span
                                              style={{ color: "#2f54eb" }}
                                            >
                                              Submissions:{" "}
                                              <Text
                                                strong
                                                style={{ color: "#2f54eb" }}
                                              >
                                                +
                                                {Number(
                                                  detailViewRecord._submissionWasteReceived,
                                                ).toLocaleString()}{" "}
                                                {normalizeUnit(
                                                  detailViewRecord._submissionWasteReceivedUnit ||
                                                    "tons",
                                                )}
                                              </Text>
                                            </span>
                                          </Space>
                                        </div>
                                      )}
                                      <Row gutter={[16, 16]} justify="center">
                                        {(cellCaps.length > 0
                                          ? cellCaps
                                          : Array.from(
                                              { length: cells },
                                              () => 0,
                                            )
                                        ).map((cap, i) => {
                                          const fillValues =
                                            detailViewRecord.cellFillValues ||
                                            [];
                                          const capUnit = normalizeUnit(
                                            cellCapacityUnits[i] ||
                                              detailViewRecord.volumeCapacityUnit ||
                                              "m³",
                                          );
                                          const usedInCell = Number(
                                            fillValues[i] || 0,
                                          );
                                          const cellFillUnit = normalizeUnit(
                                            detailViewRecord.cellFillUnits?.[
                                              i
                                            ] ||
                                              detailViewRecord.wasteReceivedUnit ||
                                              capUnit,
                                          );
                                          const usedForCapacity =
                                            convertVolume(
                                              usedInCell,
                                              cellFillUnit,
                                              capUnit,
                                            );
                                          const cellFill =
                                            cap > 0
                                              ? Math.min(
                                                  Math.round(
                                                    (usedForCapacity / cap) *
                                                      100,
                                                  ),
                                                  100,
                                                )
                                              : 0;
                                          const cellSt = normalizeCellStatus(
                                            cellStatuses[i],
                                          );
                                          const cellTy =
                                            cellTypesArr[i] || "Residual";
                                          const isClosed =
                                            isCompletedCellStatus(cellSt);
                                          const isHaz =
                                            cellTy === "Treated Haz Waste";
                                          // Remaining capacity in the cell's own unit.
                                          const remaining =
                                            cap > 0
                                              ? Math.max(
                                                  0,
                                                  cap - usedForCapacity,
                                                )
                                              : null;
                                          // Reusable capacity colour: each cell keeps its
                                          // TYPE colour below the warning band, then escalates
                                          // to warning/alarming/critical as it fills. Missing /
                                          // nonexistent cells render gray.
                                          const gaugeColor =
                                            getSlfCapacityColor(
                                              isClosed ? 100 : cellFill,
                                              {
                                                baseColor:
                                                  getCellTypeConfig(cellTy)
                                                    .color,
                                                exists:
                                                  cap > 0 &&
                                                  !isNonExistentCell(cellSt),
                                              },
                                            );
                                          return (
                                            <Col
                                              xs={12}
                                              sm={8}
                                              md={6}
                                              lg={4}
                                              key={i}
                                              style={{ textAlign: "center" }}
                                            >
                                              <Progress
                                                type="dashboard"
                                                percent={
                                                  isClosed ? 100 : cellFill
                                                }
                                                size={80}
                                                strokeColor={gaugeColor}
                                                format={() => (
                                                  <div
                                                    style={{
                                                      lineHeight: 1.2,
                                                    }}
                                                  >
                                                    <div
                                                      style={{
                                                        fontSize: 14,
                                                        fontWeight: 700,
                                                        color: gaugeColor,
                                                      }}
                                                    >
                                                      {isClosed
                                                        ? "—"
                                                        : `${cellFill}%`}
                                                    </div>
                                                  </div>
                                                )}
                                              />
                                              <div
                                                style={{
                                                  marginTop: 6,
                                                  fontSize: 12,
                                                  fontWeight: 600,
                                                }}
                                              >
                                                {resolveCellName(
                                                  detailViewRecord,
                                                  i,
                                                )}
                                              </div>
                                              <Tag
                                                color={isHaz ? "red" : "blue"}
                                                style={{
                                                  fontSize: 9,
                                                  marginTop: 2,
                                                }}
                                              >
                                                {cellTy ===
                                                "Treated Haz Waste"
                                                  ? "Haz Waste"
                                                  : cellTy}
                                              </Tag>
                                              <div
                                                style={{
                                                  fontSize: 10,
                                                  color: "#8c8c8c",
                                                }}
                                              >
                                                {usedInCell > 0
                                                  ? `${usedInCell.toLocaleString()} ${cellFillUnit} / `
                                                  : ""}
                                                {cap > 0
                                                  ? `${cap.toLocaleString()} ${capUnit}`
                                                  : "—"}
                                              </div>
                                              {remaining != null &&
                                                !isClosed && (
                                                  // Remaining Capacity is RED in the standard
                                                  // palette (it previously rendered green, which
                                                  // is now reserved for stored volume). Overflow
                                                  // stays red too, and is distinguished by
                                                  // wording + weight rather than by hue.
                                                  <div
                                                    style={{
                                                      fontSize: 10,
                                                      fontWeight:
                                                        remaining <= 0 ? 700 : 400,
                                                      color:
                                                        VOLUME_METRICS.remaining
                                                          .color,
                                                    }}
                                                  >
                                                    {remaining <= 0
                                                      ? "Over capacity"
                                                      : `${remaining.toLocaleString(
                                                          undefined,
                                                          {
                                                            maximumFractionDigits: 2,
                                                          },
                                                        )} ${capUnit} left`}
                                                  </div>
                                                )}
                                              <div style={{ marginTop: 6 }}>
                                                <Tag
                                                  color={
                                                    isActiveCellStatus(cellSt)
                                                      ? "success"
                                                      : isClosed
                                                        ? "default"
                                                        : "warning"
                                                  }
                                                  style={{ fontSize: 9 }}
                                                >
                                                  {cellSt}
                                                </Tag>
                                              </div>
                                            </Col>
                                          );
                                        })}
                                      </Row>
                                      {/* Facility Details renders a grid of coloured
                                          cell gauges; this is the same shared key used
                                          on Cell Infrastructure and the SLF Data Table. */}
                                      <CellGaugeLegend isDark={isDark} />
                                    </Card>
                                  </Col>
                                </Row>

                                {/* Baseline cell volumes */}
                                {hasCellBaseline ? (
                                  (() => {
                                    // Build per-cell rows: prefer _cellUsageRows from enriched record, else build from baseline entries
                                    const cellRows = detailViewRecord
                                      ?._cellUsageRows?.length
                                      ? detailViewRecord._cellUsageRows
                                      : (() => {
                                          const rows = [];
                                          activeCellEntries.forEach(
                                            (entry, i) => {
                                              rows.push({
                                                key: `active-${i}`,
                                                cellName:
                                                  entry.cellName ||
                                                  `Cell ${i + 1}`,
                                                status: "Active Cell",
                                                type:
                                                  entry.wasteType ||
                                                  "Residual",
                                                isHazardous:
                                                  isHazardousCellType(
                                                    entry.wasteType,
                                                  ),
                                                baseline: Number(
                                                  entry.volume || 0,
                                                ),
                                                submissions: 0,
                                                total: Number(
                                                  entry.volume || 0,
                                                ),
                                                unit:
                                                  entry.unit ||
                                                  baselineEntryUnit,
                                                capacity: 0,
                                                capacityUnit:
                                                  entry.unit ||
                                                  baselineEntryUnit,
                                              });
                                            },
                                          );
                                          closedCellEntries.forEach(
                                            (entry, i) => {
                                              rows.push({
                                                key: `closed-${i}`,
                                                cellName:
                                                  entry.cellName ||
                                                  `Closed Cell ${i + 1}`,
                                                status: "Used/Completed",
                                                type:
                                                  entry.wasteType ||
                                                  "Residual",
                                                isHazardous:
                                                  isHazardousCellType(
                                                    entry.wasteType,
                                                  ),
                                                baseline: Number(
                                                  entry.volume || 0,
                                                ),
                                                submissions: 0,
                                                total: Number(
                                                  entry.volume || 0,
                                                ),
                                                unit:
                                                  entry.unit ||
                                                  baselineEntryUnit,
                                                capacity: 0,
                                                capacityUnit:
                                                  entry.unit ||
                                                  baselineEntryUnit,
                                              });
                                            },
                                          );
                                          return rows;
                                        })();

                                    const cellTableCols = [
                                      {
                                        title: "Cell",
                                        dataIndex: "cellName",
                                        width: 130,
                                        sorter: (a, b) =>
                                          (a.cellName || "").localeCompare(
                                            b.cellName || "",
                                          ),
                                        render: (v, row) => (
                                          <Space size={4}>
                                            <Text strong>{v}</Text>
                                            {row.isHazardous && (
                                              <Tag
                                                color="red"
                                                style={{ fontSize: 9 }}
                                              >
                                                Haz
                                              </Tag>
                                            )}
                                          </Space>
                                        ),
                                      },
                                      {
                                        title: "Status",
                                        dataIndex: "status",
                                        width: 130,
                                        render: (v, row) => {
                                          const status = normalizeCellStatus(
                                            v || row.cellStatus,
                                          );
                                          return (
                                            <Tag
                                              color={
                                                isActiveCellStatus(status)
                                                  ? "green"
                                                  : isCompletedCellStatus(
                                                        status,
                                                      )
                                                    ? "default"
                                                    : "gold"
                                              }
                                            >
                                              {status || "Active Cell"}
                                            </Tag>
                                          );
                                        },
                                      },
                                      {
                                        title: "Type",
                                        dataIndex: "type",
                                        width: 120,
                                        render: (v, row) => {
                                          const type =
                                            v || row.wasteType || "Residual";
                                          return (
                                            <Tag
                                              color={
                                                isHazardousCellType(type)
                                                  ? "red"
                                                  : "blue"
                                              }
                                            >
                                              {isHazardousCellType(type)
                                                ? "Treated Haz Waste"
                                                : "Residual"}
                                            </Tag>
                                          );
                                        },
                                      },
                                      {
                                        title: "Baseline Volume",
                                        key: "baseline",
                                        align: "right",
                                        render: (_, row) =>
                                          row.baseline > 0 ? (
                                            <Text
                                              style={{ color: "#595959" }}
                                            >
                                              {Number(
                                                row.baseline,
                                              ).toLocaleString(undefined, {
                                                maximumFractionDigits: 2,
                                              })}{" "}
                                              {row.unit}
                                            </Text>
                                          ) : (
                                            "—"
                                          ),
                                      },
                                      {
                                        title: "Submissions",
                                        key: "submissions",
                                        align: "right",
                                        render: (_, row) =>
                                          row.submissions > 0 ? (
                                            <Text
                                              strong
                                              style={{ color: "#2f54eb" }}
                                            >
                                              +
                                              {Number(
                                                row.submissions,
                                              ).toLocaleString(undefined, {
                                                maximumFractionDigits: 2,
                                              })}{" "}
                                              {row.unit}
                                            </Text>
                                          ) : (
                                            <Text type="secondary">—</Text>
                                          ),
                                      },
                                      {
                                        title: "Total Fill",
                                        key: "total",
                                        align: "right",
                                        render: (_, row) => {
                                          const pctFill =
                                            row.capacity > 0
                                              ? Math.min(
                                                  Math.round(
                                                    (row.total /
                                                      row.capacity) *
                                                      100,
                                                  ),
                                                  100,
                                                )
                                              : null;
                                          return row.total > 0 ? (
                                            <Space
                                              direction="vertical"
                                              size={0}
                                              align="end"
                                            >
                                              <Text strong>
                                                {Number(
                                                  row.total,
                                                ).toLocaleString(undefined, {
                                                  maximumFractionDigits: 2,
                                                })}{" "}
                                                {row.unit}
                                              </Text>
                                              {pctFill != null && (
                                                <Text
                                                  style={{
                                                    fontSize: 10,
                                                    color:
                                                      pctFill >= 90
                                                        ? "#ff4d4f"
                                                        : pctFill >= 70
                                                          ? "#faad14"
                                                          : "#52c41a",
                                                  }}
                                                >
                                                  {pctFill}% full
                                                </Text>
                                              )}
                                            </Space>
                                          ) : (
                                            "—"
                                          );
                                        },
                                      },
                                      {
                                        title: "Capacity",
                                        key: "capacity",
                                        align: "right",
                                        render: (_, row) =>
                                          row.capacity > 0
                                            ? `${Number(row.capacity).toLocaleString()} ${row.capacityUnit || row.unit}`
                                            : "—",
                                      },
                                    ];

                                    cellTableCols.push({
                                      title: "Daily Submissions",
                                      key: "dailySubmissions",
                                      width: 150,
                                      align: "center",
                                      render: (_, row) => {
                                        // Offered when the authoritative rollup
                                        // says submissions placed waste in this
                                        // cell. Keying it off the VOLUME hid the
                                        // drill-down for a cell whose waste
                                        // arrives as per-vehicle placements (the
                                        // truck-level figure is 0 there) and for
                                        // a cell whose total is an admin
                                        // override. `submissionCount` is absent
                                        // on the client-side fallback rows, so
                                        // those keep the old volume rule.
                                        const count = row.submissionCount;
                                        const hasSubmissions =
                                          count === undefined
                                            ? Number(row.submissions || 0) > 0
                                            : count > 0;
                                        return (
                                          <Tooltip
                                            title={
                                              hasSubmissions
                                                ? `View the ${count ?? ""} submission${count === 1 ? "" : "s"} placed in ${row.cellName}`.replace(
                                                    "  ",
                                                    " ",
                                                  )
                                                : row.overridden
                                                  ? "This cell's volume was set by an admin — there are no submissions to list"
                                                  : "No submissions have been placed in this cell"
                                            }
                                          >
                                            <Button
                                              size="small"
                                              icon={<EyeOutlined />}
                                              disabled={!hasSubmissions}
                                              onClick={() =>
                                                openDailySubmissionsModal(row)
                                              }
                                            >
                                              View
                                            </Button>
                                          </Tooltip>
                                        );
                                      },
                                    });

                                    const totalBaseline = cellRows.reduce(
                                      (s, r) => s + (r.baseline || 0),
                                      0,
                                    );
                                    const totalSub = cellRows.reduce(
                                      (s, r) => s + (r.submissions || 0),
                                      0,
                                    );
                                    const totalFill = cellRows.reduce(
                                      (s, r) => s + (r.total || 0),
                                      0,
                                    );
                                    const displayUnit =
                                      cellRows[0]?.unit || baselineEntryUnit;

                                    return (
                                      <Collapse
                                        size="small"
                                        variant="filled"
                                        destroyOnHidden
                                        style={{ marginBottom: 8 }}
                                        items={[
                                          {
                                            key: "cell-volumes",
                                            label: (
                                              <Space wrap>
                                                <DatabaseOutlined
                                                  style={{ color: "#2f54eb" }}
                                                />
                                                <Text strong>
                                                  Submission Cell Placement
                                                </Text>
                                                <Tag color="blue">
                                                  {cellRows.length} cell
                                                  {cellRows.length !== 1
                                                    ? "s"
                                                    : ""}
                                                </Tag>
                                                {totalBaseline > 0 && (
                                                  <Tag color="default">
                                                    Baseline{" "}
                                                    {Number(
                                                      totalBaseline,
                                                    ).toLocaleString(
                                                      undefined,
                                                      {
                                                        maximumFractionDigits: 1,
                                                      },
                                                    )}{" "}
                                                    {displayUnit}
                                                  </Tag>
                                                )}
                                                {totalSub > 0 && (
                                                  <Tag color="geekblue">
                                                    +
                                                    {Number(
                                                      totalSub,
                                                    ).toLocaleString(
                                                      undefined,
                                                      {
                                                        maximumFractionDigits: 1,
                                                      },
                                                    )}{" "}
                                                    {displayUnit} from
                                                    submissions
                                                  </Tag>
                                                )}
                                                {/* Waste the operator has
                                                    submitted but not yet
                                                    organized has NO cell, so it
                                                    is reported here rather than
                                                    attributed to one. */}
                                                {Number(
                                                  detailViewRecord._unplacedVolume || 0,
                                                ) > 0 && (
                                                  <Tooltip title="Submitted and counted in this SLF's received total, but the operator has not organized it into a cell yet — so it is not in any cell's Waste in Cell figure.">
                                                    <Tag color="orange">
                                                      {Number(
                                                        detailViewRecord._unplacedVolume,
                                                      ).toLocaleString(undefined, {
                                                        maximumFractionDigits: 1,
                                                      })}{" "}
                                                      {displayUnit} awaiting
                                                      placement
                                                    </Tag>
                                                  </Tooltip>
                                                )}
                                              </Space>
                                            ),
                                            children: (
                                              <Table
                                                dataSource={cellRows}
                                                columns={cellTableCols}
                                                rowKey={(row) =>
                                                  row.key ||
                                                  `${row.cellName}-${row.index}`
                                                }
                                                size="small"
                                                pagination={false}
                                                scroll={{ x: 760 }}
                                                summary={() => (
                                                  <Table.Summary.Row>
                                                    <Table.Summary.Cell
                                                      index={0}
                                                      colSpan={3}
                                                    >
                                                      <Text strong>
                                                        Total
                                                      </Text>
                                                    </Table.Summary.Cell>
                                                    <Table.Summary.Cell
                                                      index={3}
                                                      align="right"
                                                    >
                                                      <Text
                                                        strong
                                                        style={{
                                                          color: "#595959",
                                                        }}
                                                      >
                                                        {totalBaseline > 0
                                                          ? `${Number(totalBaseline).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${displayUnit}`
                                                          : "—"}
                                                      </Text>
                                                    </Table.Summary.Cell>
                                                    <Table.Summary.Cell
                                                      index={4}
                                                      align="right"
                                                    >
                                                      <Text
                                                        strong
                                                        style={{
                                                          color: "#2f54eb",
                                                        }}
                                                      >
                                                        {totalSub > 0
                                                          ? `+${Number(totalSub).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${displayUnit}`
                                                          : "—"}
                                                      </Text>
                                                    </Table.Summary.Cell>
                                                    <Table.Summary.Cell
                                                      index={5}
                                                      align="right"
                                                    >
                                                      <Text strong>
                                                        {totalFill > 0
                                                          ? `${Number(totalFill).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${displayUnit}`
                                                          : "—"}
                                                      </Text>
                                                    </Table.Summary.Cell>
                                                    <Table.Summary.Cell
                                                      index={6}
                                                    />
                                                    <Table.Summary.Cell
                                                      index={7}
                                                    />
                                                  </Table.Summary.Row>
                                                )}
                                              />
                                            ),
                                          },
                                        ]}
                                      />
                                    );
                                  })()
                                ) : hasAnyBaselineData ? (
                                  <Empty
                                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                                    description="No baseline cell volumes encoded yet"
                                    style={{ marginBottom: 8 }}
                                  />
                                ) : (
                                  <Alert
                                    type="warning"
                                    showIcon
                                    message="Baseline cell information not available"
                                    description="The assigned SLF's baseline cell information (Active/Closed cell volumes) needs to be updated in the Baseline Data tab."
                                    style={{
                                      marginBottom: 8,
                                      borderRadius: 8,
                                    }}
                                  />
                                )}
                              </>
                            );
                          })()}

                        {/* Leachate Treatment Plant */}
                        {false &&
                          ((detailViewRecord.leachatePondDetails || [])
                            .length > 0 ||
                            leachate > 0) && (
                            <>
                              <Divider plain orientation="left">
                                <AlertOutlined style={{ color: "#1677ff" }} />{" "}
                                Leachate Treatment Plant
                              </Divider>
                              {(detailViewRecord.leachatePondDetails || [])
                                .length > 0 ? (
                                <Table
                                  dataSource={
                                    detailViewRecord.leachatePondDetails
                                  }
                                  rowKey={(_, i) => i}
                                  size="small"
                                  pagination={false}
                                  style={{ marginBottom: 16 }}
                                  columns={[
                                    {
                                      title: "Pond No.",
                                      dataIndex: "pondNo",
                                      width: 80,
                                      render: (v) => v ?? "—",
                                    },
                                    {
                                      title: "Description",
                                      dataIndex: "description",
                                      render: (v) =>
                                        v ? (
                                          <Text
                                            ellipsis={{ tooltip: v }}
                                            style={{
                                              maxWidth: 280,
                                              display: "block",
                                            }}
                                          >
                                            {v}
                                          </Text>
                                        ) : (
                                          <Text type="secondary">—</Text>
                                        ),
                                    },
                                    {
                                      title: "Status",
                                      dataIndex: "status",
                                      width: 150,
                                      render: (v) => (
                                        <Tag
                                          color={
                                            v === "Active"
                                              ? "blue"
                                              : v === "Under Maintenance"
                                                ? "orange"
                                                : "default"
                                          }
                                        >
                                          {v || "—"}
                                        </Tag>
                                      ),
                                    },
                                  ]}
                                />
                              ) : (
                                <Alert
                                  type="info"
                                  showIcon
                                  message={`${leachate} leachate pond(s) recorded (no detail entries yet)`}
                                  style={{
                                    marginBottom: 16,
                                    borderRadius: 8,
                                  }}
                                />
                              )}
                            </>
                          )}

                        {/* Gas Management Details */}
                        {false &&
                          ((detailViewRecord.gasVentDetails || []).length >
                            0 ||
                            gasVents > 0) && (
                            <>
                              <Divider plain orientation="left">
                                <ExperimentOutlined
                                  style={{ color: "#52c41a" }}
                                />{" "}
                                Gas Management Details
                              </Divider>
                              {(detailViewRecord.gasVentDetails || [])
                                .length > 0 ? (
                                <Table
                                  dataSource={detailViewRecord.gasVentDetails}
                                  rowKey={(_, i) => i}
                                  size="small"
                                  pagination={false}
                                  style={{ marginBottom: 16 }}
                                  columns={[
                                    {
                                      title: "Vent No.",
                                      dataIndex: "ventNo",
                                      width: 80,
                                      render: (v) => v ?? "—",
                                    },
                                    {
                                      title: "Type",
                                      dataIndex: "ventType",
                                      width: 130,
                                      render: (v) => v || "—",
                                    },
                                    {
                                      title: "Description",
                                      dataIndex: "description",
                                      render: (v) =>
                                        v ? (
                                          <Text
                                            ellipsis={{ tooltip: v }}
                                            style={{
                                              maxWidth: 220,
                                              display: "block",
                                            }}
                                          >
                                            {v}
                                          </Text>
                                        ) : (
                                          <Text type="secondary">—</Text>
                                        ),
                                    },
                                    {
                                      title: "Status",
                                      dataIndex: "status",
                                      width: 150,
                                      render: (v) => (
                                        <Tag
                                          color={
                                            v === "Active"
                                              ? "green"
                                              : v === "Under Maintenance"
                                                ? "orange"
                                                : "default"
                                          }
                                        >
                                          {v || "—"}
                                        </Tag>
                                      ),
                                    },
                                  ]}
                                />
                              ) : (
                                <Alert
                                  type="info"
                                  showIcon
                                  message={`${gasVents} gas management record(s) recorded (no detail entries yet)`}
                                  style={{
                                    marginBottom: 16,
                                    borderRadius: 8,
                                  }}
                                />
                              )}
                            </>
                          )}

                        {hasCharts && (
                          <>
                            <Divider plain orientation="left">
                              <BarChartOutlined /> Charts
                            </Divider>
                            <Row gutter={[16, 16]}>
                              {/* Capacity Utilization Pie — shown in Charts section only when no cell infra section (cells === 0) */}
                              {capacityData.length > 0 && cells === 0 && (
                                <Col xs={24} md={12}>
                                  <Card
                                    size="small"
                                    title="Capacity Utilization by Waste Type"
                                    style={{ borderRadius: 10 }}
                                  >
                                    <ResponsiveContainer
                                      width="100%"
                                      height={220}
                                    >
                                      <PieChart>
                                        <Pie
                                          data={capacityData}
                                          cx="50%"
                                          cy="50%"
                                          innerRadius={50}
                                          outerRadius={80}
                                          paddingAngle={
                                            capacityData.length > 1 ? 3 : 0
                                          }
                                          dataKey="value"
                                          isAnimationActive={false}
                                          animationBegin={80}
                                          animationDuration={650}
                                          label={({ name, value }) =>
                                            `${name}: ${value.toLocaleString()}`
                                          }
                                        >
                                          {capacityData.map((entry, i) => (
                                            <RCell
                                              key={i}
                                              fill={
                                                entry.name.includes(
                                                  "Residual",
                                                )
                                                  ? "#52c41a"
                                                  : entry.name.includes("Haz")
                                                    ? "#ff4d4f"
                                                    : entry.name.includes(
                                                          "Remaining",
                                                        )
                                                      ? "#d9d9d9"
                                                      : CHART_COLORS[
                                                          i %
                                                            CHART_COLORS.length
                                                        ]
                                              }
                                            />
                                          ))}
                                        </Pie>
                                        <RTooltip
                                          formatter={(v) =>
                                            v.toLocaleString()
                                          }
                                        />
                                        <Legend />
                                      </PieChart>
                                    </ResponsiveContainer>
                                  </Card>
                                </Col>
                              )}
                              {/* Volume Comparison Bar */}
                              {volumeData.length > 1 && (
                                <Col xs={24} md={12}>
                                  <Card
                                    size="small"
                                    title="Volume Comparison"
                                    style={{ borderRadius: 10 }}
                                  >
                                    <ResponsiveContainer
                                      width="100%"
                                      height={220}
                                    >
                                      <BarChart data={volumeData}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis
                                          dataKey="name"
                                          tick={{ fontSize: 12 }}
                                        />
                                        <YAxis />
                                        <RTooltip
                                          formatter={(v) =>
                                            v.toLocaleString()
                                          }
                                        />
                                        <Bar
                                          dataKey="value"
                                          fill="#52c41a"
                                          radius={[4, 4, 0, 0]}
                                          isAnimationActive={false}
                                        >
                                          {volumeData.map((_, i) => (
                                            <RCell
                                              key={i}
                                              fill={
                                                CHART_COLORS[
                                                  i % CHART_COLORS.length
                                                ]
                                              }
                                            />
                                          ))}
                                        </Bar>
                                      </BarChart>
                                    </ResponsiveContainer>
                                  </Card>
                                </Col>
                              )}
                            </Row>
                          </>
                        )}
                      </>
                    );
                  })(),
                },
                {
                  key: "permits-compliance-personnel",
                  label: (
                    <span style={{ color: "#faad14" }}>
                      <SafetyCertificateOutlined /> Monitoring
                    </span>
                  ),
                  children: (
                    <Collapse
                      // Monitoring section — Permits, Compliance and Personnel &
                      // Monitoring as separate collapsible cards, COLLAPSED by
                      // default (each expands independently).
                      style={{ borderRadius: 8 }}
                      items={[
                        {
                          key: "permits",
                          label: (
                            <span>
                              <SafetyCertificateOutlined
                                style={{ color: "#faad14" }}
                              />{" "}
                              Permits
                            </span>
                          ),
                          children: (
                            <>
                              <Descriptions
                                column={2}
                                size="small"
                                bordered
                                style={{ marginBottom: 12 }}
                              >
                                <Descriptions.Item label="ECC No.">
                                  {detailViewRecord.eccNo || "—"}
                                </Descriptions.Item>
                                <Descriptions.Item label="Hazwaste Gen. ID">
                                  {detailViewRecord.hazwasteGenerationId ||
                                    "—"}
                                </Descriptions.Item>
                                {detailViewRecord.slfGenerator && (
                                  <Descriptions.Item
                                    label="Portal Link"
                                    span={2}
                                  >
                                    <Tag color="blue" icon={<LinkOutlined />}>
                                      {typeof detailViewRecord.slfGenerator ===
                                      "object"
                                        ? detailViewRecord.slfGenerator
                                            .slfName
                                        : "Linked Generator"}
                                    </Tag>
                                  </Descriptions.Item>
                                )}
                              </Descriptions>
                              <Divider plain orientation="left">
                                Discharge Permits
                              </Divider>
                              <Table
                                size="small"
                                pagination={false}
                                dataSource={
                                  detailViewRecord.dischargePermits?.length
                                    ? detailViewRecord.dischargePermits
                                    : detailViewRecord.dischargePermit
                                      ? [
                                          {
                                            permitNo:
                                              detailViewRecord.dischargePermit,
                                            validity:
                                              detailViewRecord.dischargePermitValidity,
                                            status:
                                              detailViewRecord.dischargePermitStatus,
                                          },
                                        ]
                                      : []
                                }
                                rowKey={(_, i) => i}
                                locale={{
                                  emptyText: "No discharge permits recorded",
                                }}
                                columns={[
                                  {
                                    title: "Permit No.",
                                    dataIndex: "permitNo",
                                    render: (v) => v || "—",
                                  },
                                  {
                                    title: "DP Type",
                                    dataIndex: "permitType",
                                    width: 150,
                                    render: (v) => v || "—",
                                  },
                                  {
                                    title: "Validity",
                                    dataIndex: "validity",
                                    width: 160,
                                    render: (v) =>
                                      v ? dayjs(v).format("MM/DD/YYYY") : "—",
                                  },
                                  {
                                    title: "Status",
                                    dataIndex: "status",
                                    width: 130,
                                    render: (v) => (v ? <Tag>{v}</Tag> : "—"),
                                  },
                                ]}
                              />
                              <Divider
                                plain
                                orientation="left"
                                style={{ marginTop: 16 }}
                              >
                                Permits to Operate
                              </Divider>
                              <Table
                                size="small"
                                pagination={false}
                                dataSource={
                                  detailViewRecord.permitToOperatePermits
                                    ?.length
                                    ? detailViewRecord.permitToOperatePermits
                                    : detailViewRecord.permitToOperate
                                      ? [
                                          {
                                            permitNo:
                                              detailViewRecord.permitToOperate,
                                            validity:
                                              detailViewRecord.permitToOperateValidity,
                                            status:
                                              detailViewRecord.permitToOperateStatus,
                                          },
                                        ]
                                      : []
                                }
                                rowKey={(_, i) => i}
                                locale={{
                                  emptyText: "No permits to operate recorded",
                                }}
                                columns={[
                                  {
                                    title: "Permit No.",
                                    dataIndex: "permitNo",
                                    render: (v) => v || "—",
                                  },
                                  {
                                    title: "Validity",
                                    dataIndex: "validity",
                                    width: 160,
                                    render: (v) =>
                                      v ? dayjs(v).format("MM/DD/YYYY") : "—",
                                  },
                                  {
                                    title: "Status",
                                    dataIndex: "status",
                                    width: 130,
                                    render: (v) => (v ? <Tag>{v}</Tag> : "—"),
                                  },
                                ]}
                              />
                            </>
                          ),
                        },
                      ]}
                    />
                  ),
                },
                {
                  key: "5",
                  label: (
                    <span style={{ color: "#a00d59" }}>
                      <WarningOutlined /> Preventive Measures
                    </span>
                  ),
                  children: (
                    <>
                      <Divider orientation="left">
                        Preventive Measure Files
                      </Divider>
                      {(detailViewRecord.preventiveMeasureFiles || [])
                        .length > 0 ? (
                        <Table
                          size="small"
                          pagination={false}
                          rowKey="key"
                          dataSource={(() => {
                            const detailByUrl = new Map(
                              (detailViewRecord.preventiveMeasureFileDetails || [])
                                .filter((d) => d?.url)
                                .map((d) => [d.url, d]),
                            );
                            return (
                              detailViewRecord.preventiveMeasureFiles || []
                            ).map((entry, i) => {
                              const url = normalizeStoredFileUrl(entry);
                              const detail =
                                detailByUrl.get(entry) ||
                                detailByUrl.get(url) ||
                                {};
                              const name =
                                detail.fileName ||
                                decodeURIComponent(
                                  String(url || "").split("/").pop() || "",
                                ).split("?")[0] ||
                                `File ${i + 1}`;
                              return {
                                key: i,
                                url,
                                name,
                                description: detail.description || "",
                                docType: detail.docType || "Preventive Measures",
                                kind: getMediaKind(url || name || ""),
                              };
                            });
                          })()}
                          columns={[
                            {
                              title: "File",
                              dataIndex: "name",
                              render: (v, r) => (
                                <Space size={6}>
                                  {r.kind === "pdf" ? (
                                    <FilePdfOutlined style={{ color: "#ff4d4f" }} />
                                  ) : r.kind === "image" ? (
                                    <FileImageOutlined style={{ color: "#1677ff" }} />
                                  ) : (
                                    <FileTextOutlined style={{ color: "#8c8c8c" }} />
                                  )}
                                  <Text style={{ fontSize: 12 }}>{v}</Text>
                                </Space>
                              ),
                            },
                            {
                              title: "Description",
                              dataIndex: "description",
                              width: 200,
                              render: (v) =>
                                v ? (
                                  <Text style={{ fontSize: 10 }}>{v}</Text>
                                ) : (
                                  <Text type="secondary">—</Text>
                                ),
                            },
                            {
                              title: "Type",
                              dataIndex: "docType",
                              width: 170,
                              render: (v) => <Tag color="orange">{v}</Tag>,
                            },
                            {
                              title: "Action",
                              width: 90,
                              align: "center",
                              render: (_, r) =>
                                r.url ? (
                                  <Tooltip title="Preview">
                                    <Button
                                      size="small"
                                      icon={<EyeOutlined />}
                                      onClick={() =>
                                        openFilePreview(r.url, r.name)
                                      }
                                    />
                                  </Tooltip>
                                ) : (
                                  <Text type="secondary">—</Text>
                                ),
                            },
                          ]}
                        />
                      ) : (
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description="No preventive measure files uploaded"
                        />
                      )}
                      <Divider orientation="left" style={{ marginTop: 16 }}>
                        Safe Closure and Rehabilitation Plan (SCRP)
                      </Divider>
                      {detailViewRecord.scrpDetails?.length > 0 ? (
                        <Table
                          dataSource={detailViewRecord.scrpDetails}
                          rowKey={(_, i) => i}
                          size="small"
                          pagination={false}
                          columns={[
                            {
                              title: "Plan / Activity",
                              dataIndex: "planTitle",
                              render: (v) => v || "—",
                            },
                            {
                              title: "Status",
                              dataIndex: "status",
                              width: 150,
                              render: (v) =>
                                v ? <Tag color="blue">{v}</Tag> : "—",
                            },
                            {
                              title: "Remarks",
                              dataIndex: "remarks",
                              render: (v) => v || "—",
                            },
                            {
                              title: "Attachments",
                              dataIndex: "attachments",
                              width: 160,
                              render: (v) =>
                                (v || []).length ? (
                                  <Space size={[4, 4]} wrap>
                                    {(v || []).map((att, ai) => {
                                      const url = normalizeStoredFileUrl(att);
                                      if (!url) return null;
                                      return (
                                        <Tag
                                          key={ai}
                                          color="purple"
                                          icon={<EyeOutlined />}
                                          style={{ cursor: "pointer" }}
                                          onClick={() => openFilePreview(url, `SCRP File ${ai + 1}`)}
                                        >
                                          File {ai + 1}
                                        </Tag>
                                      );
                                    })}
                                  </Space>
                                ) : (
                                  "—"
                                ),
                            },
                          ]}
                        />
                      ) : (
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description="No SCRP entries recorded"
                        />
                      )}
                    </>
                  ),
                },
                {
                  key: "gallery",
                  label: (
                    <span style={{ color: "#1677ff" }}>
                      <FileImageOutlined /> Gallery
                    </span>
                  ),
                  children: (() => {
                    const structured = detailViewRecord.galleryItems || [];
                    const legacy = (detailViewRecord.galleryPhotos || []).map(
                      (url) => ({
                        url,
                        component: "Legacy Photos",
                        folder: "General",
                        caption: "",
                      }),
                    );
                    const photos = [...structured, ...legacy].filter(
                      (item) => item.url,
                    );
                    if (!photos.length)
                      return (
                        <Empty description="No gallery photos uploaded yet" />
                      );
                    const groups = photos.reduce((map, item) => {
                      const key = `${item.folder || "General"} / ${item.component || "SLF Component"}`;
                      if (!map[key]) map[key] = [];
                      map[key].push(item);
                      return map;
                    }, {});
                    const fileName = (item) =>
                      item.caption ||
                      decodeURIComponent(
                        String(item.url || "")
                          .split("/")
                          .pop() || "Photo",
                      ).split("?")[0];
                    return (
                      <>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: 12,
                            flexWrap: "wrap",
                            gap: 8,
                          }}
                        >
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {photos.length} media file(s) — click any item to
                            open in a new tab.
                          </Text>
                          <Segmented
                            size="small"
                            value={galleryViewMode}
                            onChange={setGalleryViewMode}
                            options={[
                              {
                                label: "Tiled",
                                value: "tiled",
                                icon: <AppstoreOutlined />,
                              },
                              {
                                label: "List",
                                value: "list",
                                icon: <UnorderedListOutlined />,
                              },
                            ]}
                          />
                        </div>
                        <Image.PreviewGroup>
                          <Space
                            direction="vertical"
                            size={14}
                            style={{ width: "100%" }}
                          >
                            {Object.entries(groups).map(([group, items]) =>
                              galleryViewMode === "list" ? (
                                <div key={group}>
                                  <Divider
                                    plain
                                    orientation="left"
                                    style={{ marginTop: 0 }}
                                  >
                                    {group}
                                  </Divider>
                                  <List
                                    size="small"
                                    dataSource={items}
                                    renderItem={(item) => {
                                      const kind = getMediaKind(item.url);
                                      return (
                                        <List.Item
                                          actions={[
                                            <a
                                              key="open"
                                              href={resolveMediaOpenUrl(
                                                item.url,
                                              )}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                            >
                                              <LinkOutlined /> Open in new tab
                                            </a>,
                                          ]}
                                        >
                                          <List.Item.Meta
                                            avatar={
                                              kind === "image" ? (
                                                <Image
                                                  src={resolveMediaUrl(
                                                    item.url,
                                                    { thumbnail: true },
                                                  )}
                                                  preview={{
                                                    src: resolveMediaUrl(
                                                      item.url,
                                                    ),
                                                  }}
                                                  width={64}
                                                  height={48}
                                                  loading="lazy"
                                                  decoding="async"
                                                  style={{
                                                    objectFit: "cover",
                                                    borderRadius: 4,
                                                  }}
                                                  fallback="data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='48'%3E%3Crect width='100%25' height='100%25' fill='%23f0f0f0'/%3E%3C/svg%3E"
                                                />
                                              ) : (
                                                <a
                                                  href={resolveMediaOpenUrl(
                                                    item.url,
                                                  )}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  style={{
                                                    width: 64,
                                                    height: 48,
                                                    borderRadius: 4,
                                                    background: isDark
                                                      ? "#1f1f1f"
                                                      : "#f0f0f0",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    fontSize: 22,
                                                    color:
                                                      kind === "pdf"
                                                        ? "#cf1322"
                                                        : "#1677ff",
                                                  }}
                                                >
                                                  {kind === "video" ? (
                                                    <PlayCircleOutlined />
                                                  ) : kind === "pdf" ? (
                                                    <FilePdfOutlined />
                                                  ) : (
                                                    <FileTextOutlined />
                                                  )}
                                                </a>
                                              )
                                            }
                                            title={
                                              <Text style={{ fontSize: 12 }}>
                                                {fileName(item)}
                                              </Text>
                                            }
                                            description={
                                              <Text
                                                type="secondary"
                                                style={{ fontSize: 11 }}
                                              >
                                                {item.folder || "General"} ·{" "}
                                                {item.component ||
                                                  "SLF Component"}
                                              </Text>
                                            }
                                          />
                                        </List.Item>
                                      );
                                    }}
                                  />
                                </div>
                              ) : (
                                <div key={group}>
                                  <Divider
                                    plain
                                    orientation="left"
                                    style={{ marginTop: 0 }}
                                  >
                                    {group}
                                  </Divider>
                                  <Row gutter={[8, 8]}>
                                    {items.map((item, i) => {
                                      const kind = getMediaKind(item.url);
                                      // Gallery items are photos, but files stored
                                      // on Google Drive have NO extension, so
                                      // getMediaKind returns "file" and the tile
                                      // used to fall through to a generic icon —
                                      // the thumbnail image was never shown. Treat
                                      // "file"/extension-less items as images here
                                      // (only real videos/pdfs keep the icon).
                                      const isImageLike =
                                        kind === "image" || kind === "file";
                                      return (
                                        <Col
                                          key={`${item.url}-${i}`}
                                          xs={12}
                                          sm={8}
                                          md={6}
                                        >
                                          {isImageLike ? (
                                            <Image
                                              src={resolveMediaUrl(item.url, {
                                                thumbnail: true,
                                              })}
                                              preview={{
                                                src: resolveMediaUrl(
                                                  item.url,
                                                ),
                                              }}
                                              loading="lazy"
                                              decoding="async"
                                              fallback="data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='110'%3E%3Crect width='100%25' height='100%25' fill='%23f0f0f0'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%23999' font-size='12' font-family='sans-serif'%3EImage unavailable%3C/text%3E%3C/svg%3E"
                                              style={{
                                                width: "100%",
                                                borderRadius: 6,
                                                objectFit: "cover",
                                                height: 110,
                                              }}
                                            />
                                          ) : (
                                            <a
                                              href={resolveMediaOpenUrl(
                                                item.url,
                                              )}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              style={{
                                                width: "100%",
                                                height: 110,
                                                borderRadius: 6,
                                                background: isDark
                                                  ? "#1f1f1f"
                                                  : "#f0f0f0",
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                fontSize: 36,
                                                color:
                                                  kind === "pdf"
                                                    ? "#cf1322"
                                                    : kind === "video"
                                                      ? "#722ed1"
                                                      : "#1677ff",
                                              }}
                                            >
                                              {kind === "video" ? (
                                                <PlayCircleOutlined />
                                              ) : kind === "pdf" ? (
                                                <FilePdfOutlined />
                                              ) : (
                                                <FileTextOutlined />
                                              )}
                                            </a>
                                          )}
                                          <a
                                            href={resolveMediaOpenUrl(
                                              item.url,
                                            )}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            style={{
                                              fontSize: 11,
                                              display: "inline-block",
                                              marginTop: 4,
                                            }}
                                          >
                                            <LinkOutlined /> Open
                                          </a>
                                          {item.caption && (
                                            <Text
                                              type="secondary"
                                              style={{
                                                display: "block",
                                                fontSize: 11,
                                              }}
                                            >
                                              {item.caption}
                                            </Text>
                                          )}
                                        </Col>
                                      );
                                    })}
                                  </Row>
                                </div>
                              ),
                            )}
                          </Space>
                        </Image.PreviewGroup>
                      </>
                    );
                  })(),
                },
                {
                  key: "documents",
                  label: (
                    <span style={{ color: "#722ed1" }}>
                      <FolderOutlined /> Documents
                    </span>
                  ),
                  children:
                    (detailViewRecord.slfDocuments || []).length > 0 ? (
                      <Table
                        dataSource={detailViewRecord.slfDocuments}
                        rowKey={(_, i) => i}
                        size="small"
                        pagination={false}
                        tableLayout="fixed"
                        // Horizontal scroll kicks in only when the fixed columns
                        // truly can't fit, keeping the table inside the modal.
                        scroll={{ x: 640 }}
                        columns={[
                          {
                            title: "Title",
                            dataIndex: "title",
                            ellipsis: { showTitle: true },
                            render: (v) => (
                              <Text strong style={{ fontSize: 12 }}>
                                {v || "—"}
                              </Text>
                            ),
                          },
                          {
                            title: "Type",
                            dataIndex: "docType",
                            width: 150,
                            ellipsis: true,
                            render: (v) =>
                              v ? <Tag color="purple">{v}</Tag> : "—",
                          },
                          {
                            title: "Description",
                            dataIndex: "description",
                            ellipsis: { showTitle: true },
                            render: (v) =>
                              v ? (
                                <Text
                                  type="secondary"
                                  style={{ fontSize: 12 }}
                                >
                                  {v}
                                </Text>
                              ) : (
                                "—"
                              ),
                          },
                          {
                            title: "File",
                            dataIndex: "url",
                            width: 96,
                            fixed: "right",
                            render: (v, doc) => {
                              const raw =
                                normalizeStoredFileUrl(v) ||
                                normalizeStoredFileUrl(doc?.fileUrl);
                              if (!raw) return "—";
                              const kind = getMediaKind(raw);
                              return (
                                <Button
                                  size="small"
                                  type="link"
                                  icon={
                                    kind === "pdf" ? (
                                      <FilePdfOutlined />
                                    ) : kind === "image" ? (
                                      <FileImageOutlined />
                                    ) : (
                                      <EyeOutlined />
                                    )
                                  }
                                  onClick={() => openFilePreview(raw, doc?.title || doc?.fileName)}
                                >
                                  View
                                </Button>
                              );
                            },
                          },
                        ]}
                      />
                    ) : (
                      <Empty description="No documents uploaded yet" />
                    ),
                },
                {
                  key: "haulers-clients",
                  label: (
                    <span style={{ color: "#13c2c2" }}>
                      <TeamOutlined /> Haulers &amp; Clients
                    </span>
                  ),
                  children: (
                    <HaulerClientsTab
                      baselineData={baselineData}
                      loading={loadingBaseline}
                      savedAt={baselineData?.savedAt}
                    />
                  ),
                },
                ...(detailViewRecord.slfGenerator
                  ? [
                      {
                        key: "6",
                        label: (
                          <span style={{ color: "#595959" }}>
                            <DatabaseOutlined /> Baseline Info
                          </span>
                        ),
                        children: loadingBaseline ? (
                          <div style={{ textAlign: "center", padding: 32 }}>
                            <Text type="secondary">
                              Loading baseline data...
                            </Text>
                          </div>
                        ) : baselineData ? (
                          <>
                            <Row gutter={[16, 12]}>
                              <Col span={24}>
                                <Text
                                  type="secondary"
                                  style={{ fontSize: 12 }}
                                >
                                  Last updated:{" "}
                                  {baselineData.savedAt
                                    ? dayjs(baselineData.savedAt).format(
                                        "MM/DD/YYYY h:mm A",
                                      )
                                    : "—"}
                                </Text>
                              </Col>
                              <Col span={12}>
                                <Card
                                  size="small"
                                  style={{ borderRadius: 8 }}
                                >
                                  <Statistic
                                    title="Total Volume Accepted"
                                    value={
                                      baselineData.totalVolumeAccepted ?? 0
                                    }
                                    suffix={(
                                      baselineData.totalVolumeAcceptedUnit ||
                                      "m³"
                                    ).replace("m3", "m³")}
                                    precision={2}
                                  />
                                </Card>
                              </Col>
                              <Col span={12}>
                                <Card
                                  size="small"
                                  style={{ borderRadius: 8 }}
                                >
                                  <Statistic
                                    title="Active Cell (Residual)"
                                    value={
                                      baselineData.activeCellResidualVolume ??
                                      0
                                    }
                                    suffix={(
                                      baselineData.activeCellResidualUnit ||
                                      "m³"
                                    ).replace("m3", "m³")}
                                    precision={2}
                                  />
                                </Card>
                              </Col>
                              <Col span={12}>
                                <Card
                                  size="small"
                                  style={{ borderRadius: 8 }}
                                >
                                  <Statistic
                                    title="Active Cell (Inert)"
                                    value={
                                      baselineData.activeCellInertVolume ?? 0
                                    }
                                    suffix={(
                                      baselineData.activeCellInertUnit || "m³"
                                    ).replace("m3", "m³")}
                                    precision={2}
                                  />
                                </Card>
                              </Col>
                              <Col span={12}>
                                <Card
                                  size="small"
                                  style={{ borderRadius: 8 }}
                                >
                                  <Statistic
                                    title="Closed Cell (Residual)"
                                    value={
                                      baselineData.closedCellResidualVolume ??
                                      0
                                    }
                                    suffix={(
                                      baselineData.closedCellResidualUnit ||
                                      "m³"
                                    ).replace("m3", "m³")}
                                    precision={2}
                                  />
                                </Card>
                              </Col>
                              <Col span={12}>
                                <Card
                                  size="small"
                                  style={{ borderRadius: 8 }}
                                >
                                  <Statistic
                                    title="Closed Cell (Inert)"
                                    value={
                                      baselineData.closedCellInertVolume ?? 0
                                    }
                                    suffix={(
                                      baselineData.closedCellInertUnit || "m³"
                                    ).replace("m3", "m³")}
                                    precision={2}
                                  />
                                </Card>
                              </Col>
                            </Row>
                            {baselineData.accreditedHaulers?.length > 0 && (
                              <>
                                <Divider plain orientation="left">
                                  <TeamOutlined /> Accredited Haulers (
                                  {baselineData.accreditedHaulers.length})
                                </Divider>
                                <Table
                                  dataSource={baselineData.accreditedHaulers}
                                  rowKey={(_, i) => i}
                                  size="small"
                                  pagination={false}
                                  expandable={{
                                    expandedRowRender: (h) => {
                                      const vehicles = h.vehicles || [];
                                      const clients =
                                        h.privateSectorClients || [];
                                      return (
                                        <div style={{ padding: "8px 0" }}>
                                          {vehicles.length > 0 && (
                                            <>
                                              <Text
                                                strong
                                                style={{
                                                  fontSize: 12,
                                                  color: "#1677ff",
                                                }}
                                              >
                                                Registered Vehicles
                                              </Text>
                                              <Table
                                                className="hauler-wrap-table"
                                                dataSource={vehicles}
                                                rowKey={(_, vi) => vi}
                                                size="small"
                                                pagination={false}
                                                style={{
                                                  marginTop: 6,
                                                  marginBottom: 10,
                                                }}
                                                columns={[
                                                  {
                                                    title: "Plate No.",
                                                    dataIndex: "plateNumber",
                                                    width: 120,
                                                    render: (v) => v || "—",
                                                  },
                                                  {
                                                    title: "Type",
                                                    dataIndex: "vehicleType",
                                                    width: 130,
                                                    render: (v) =>
                                                      v ? (
                                                        <Tag color="geekblue">
                                                          {v}
                                                        </Tag>
                                                      ) : (
                                                        "—"
                                                      ),
                                                  },
                                                  {
                                                    title: "Capacity",
                                                    width: 140,
                                                    render: (_, v) =>
                                                      v.capacity
                                                        ? `${Number(v.capacity).toLocaleString()} ${v.capacityUnit || "m³"}`
                                                        : "—",
                                                  },
                                                ]}
                                              />
                                            </>
                                          )}
                                          {clients.length > 0 && (
                                            <>
                                              <Text
                                                strong
                                                style={{
                                                  fontSize: 12,
                                                  color: "#52c41a",
                                                }}
                                              >
                                                Private Sector Clients
                                              </Text>
                                              <Table
                                                className="hauler-wrap-table"
                                                dataSource={clients}
                                                rowKey={(_, ci) => ci}
                                                size="small"
                                                pagination={false}
                                                style={{ marginTop: 6 }}
                                                columns={[
                                                  {
                                                    title: "Client Name",
                                                    dataIndex: "clientName",
                                                    render: (v) => v || "—",
                                                  },
                                                  {
                                                    title: "Type",
                                                    dataIndex: "clientType",
                                                    width: 100,
                                                    render: (v) =>
                                                      v ? (
                                                        <Tag
                                                          color={
                                                            v === "LGU"
                                                              ? "blue"
                                                              : "purple"
                                                          }
                                                        >
                                                          {v}
                                                        </Tag>
                                                      ) : (
                                                        "—"
                                                      ),
                                                  },
                                                  {
                                                    title: "Province",
                                                    dataIndex: "province",
                                                    width: 120,
                                                    render: (v) => v || "—",
                                                  },
                                                  {
                                                    title: "Municipality",
                                                    dataIndex: "municipality",
                                                    width: 140,
                                                    render: (v) => v || "—",
                                                  },
                                                  {
                                                    title: "Trips/Month",
                                                    dataIndex:
                                                      "noOfTripsPerMonth",
                                                    width: 110,
                                                    align: "center",
                                                    render: (v) => v ?? "—",
                                                  },
                                                ]}
                                              />
                                            </>
                                          )}
                                          {vehicles.length === 0 &&
                                            clients.length === 0 && (
                                              <Text
                                                type="secondary"
                                                style={{ fontSize: 12 }}
                                              >
                                                No vehicle or client details
                                                recorded.
                                              </Text>
                                            )}
                                        </div>
                                      );
                                    },
                                    rowExpandable: (h) =>
                                      (h.vehicles?.length || 0) > 0 ||
                                      (h.privateSectorClients?.length || 0) >
                                        0,
                                  }}
                                  columns={[
                                    {
                                      title: "Hauler Name",
                                      dataIndex: "haulerName",
                                      key: "haulerName",
                                      render: (v) => (
                                        <Text strong style={{ fontSize: 12 }}>
                                          {v || "—"}
                                        </Text>
                                      ),
                                    },
                                    {
                                      title: "No. of Trucks",
                                      dataIndex: "numberOfTrucks",
                                      key: "numberOfTrucks",
                                      width: 110,
                                      align: "center",
                                      render: (v) =>
                                        v != null ? (
                                          <Tag color="blue">{v}</Tag>
                                        ) : (
                                          "—"
                                        ),
                                    },
                                    {
                                      title: "Office Address",
                                      key: "officeAddr",
                                      render: (_, h) => {
                                        const parts = [
                                          h.officeBarangay,
                                          h.officeCity,
                                          h.officeProvince,
                                        ].filter(Boolean);
                                        return parts.length > 0
                                          ? parts.join(", ")
                                          : h.officeAddress || "—";
                                      },
                                    },
                                    {
                                      title: "Vehicles",
                                      key: "vehicleCount",
                                      width: 90,
                                      align: "center",
                                      render: (_, h) =>
                                        (h.vehicles?.length || 0) > 0 ? (
                                          <Tag color="geekblue">
                                            {h.vehicles.length}
                                          </Tag>
                                        ) : (
                                          <Text type="secondary">—</Text>
                                        ),
                                    },
                                    {
                                      title: "Clients",
                                      key: "clientCount",
                                      width: 80,
                                      align: "center",
                                      render: (_, h) =>
                                        (h.privateSectorClients?.length ||
                                          0) > 0 ? (
                                          <Tag color="green">
                                            {h.privateSectorClients.length}
                                          </Tag>
                                        ) : (
                                          <Text type="secondary">—</Text>
                                        ),
                                    },
                                  ]}
                                />
                              </>
                            )}
                          </>
                        ) : (
                          <div style={{ textAlign: "center", padding: 32 }}>
                            <Text type="secondary">
                              No baseline data submitted yet for this SLF.
                            </Text>
                          </div>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          ) : (
            <div style={{ textAlign: "center", padding: 48 }}>
              <Empty description="No record found for this year" />
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
