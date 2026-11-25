import { ORGANIZE_CELLS_ENABLED } from "./constants";
import {
  Modal,
  Space,
  Tag,
  Button,
  Alert,
  Spin,
  Skeleton,
  Empty,
  Collapse,
  Card,
  Row,
  Col,
  Progress,
  Tooltip,
  Select,
  Checkbox,
  Table,
  InputNumber,
  Pagination,
} from "antd";
import {
  ContainerOutlined,
  ThunderboltOutlined,
  SaveOutlined,
  InfoCircleOutlined,
  DownOutlined,
  UpOutlined,
  CheckCircleOutlined,
} from "@ant-design/icons";
import { Text } from "./portalShared";
import {
  isNonExistentCell,
  getCellStatusConfig,
  getCellTypeConfig,
  resolveCellName,
  getCapacityStatus,
} from "../../utils/cellVisuals";
import { normalizeCellStatus, isActiveCellStatus } from "./helpers";
import { resolveCellUnit, convertVolume } from "../../utils/volumeUnits";
import { cellPercent } from "../../utils/cellCapacity";
import { ResponsiveContainer, PieChart, Pie, Cell as RCell, Tooltip as RTooltip } from "recharts";
import dayjs from "dayjs";
import { wasteTypeTagColor } from "../../utils/wasteCategories";
import { rowVolumeM3, cellChoicesFor } from "./organizeCellRules";

export default function CellOrganizerModal({
  activeCellOptions, applyBulkCellToSelected, autoPlaceOrganizer, baselineUnit, cellCapacityNotice,
  cellInfraCollapsed, cellOrganizerBulkCell, cellOrganizerData, cellOrganizerError,
  cellOrganizerExpanded, cellOrganizerLoading, cellOrganizerOpen, cellOrganizerPage,
  cellOrganizerPageSize, cellOrganizerSaving, cellOrganizerSelected, cellRoomLabel,
  openCellOrganizer, organizerPlanned, organizerStats, organizerWork, prefilledCapacityCount,
  reservedCellFill, saveCellOrganizer, setBulkOrganizeOpen, setCellInfraCollapsed,
  setCellOrganizerBulkCell, setCellOrganizerData, setCellOrganizerExpanded, setCellOrganizerOpen,
  setCellOrganizerPage, setCellOrganizerPageSize, setCellOrganizerSelected, slfCellCount, slfInfo,
  slfInfoLoading, slfUnit, updateOrganizerCapacity, updateOrganizerCell,
}) {
  return (
    ORGANIZE_CELLS_ENABLED && (
      <Modal
        title={
          <Space>
            <ContainerOutlined style={{ color: "#722ed1" }} />
            <span>Organize Cell Placement</span>
            {organizerWork.placementSubs.length > 0 && (
              <Tag color="purple">{organizerWork.placementSubs.length} submission(s) to place</Tag>
            )}
            {cellOrganizerData.length > 0 && (
              <Button
                size="small"
                icon={<ThunderboltOutlined />}
                onClick={() => setBulkOrganizeOpen(true)}
                type="primary"
              >
                Bulk Upload
              </Button>
            )}
          </Space>
        }
        open={cellOrganizerOpen}
        onCancel={() => {
          setCellOrganizerOpen(false);
          // Release the working copy — it holds the FULL trucks[]/vehicles[] of
          // every unplaced submission, which is the heaviest thing the Portal
          // ever puts in memory. Leaving it behind kept that alive for the rest
          // of the session.
          setCellOrganizerData([]);
          setCellOrganizerSelected([]);
          setCellOrganizerExpanded([]);
        }}
        width={960}
        okText="Save Placement"
        okButtonProps={{
          icon: <SaveOutlined />,
          loading: cellOrganizerSaving,
          // No cell can accept waste, so every placement would be invalid.
          // Disabling here is what keeps the warning above honest and stops a
          // partially-valid save from writing an assignment to a full cell.
          disabled: Boolean(cellCapacityNotice),
          title: cellCapacityNotice
            ? "No disposal cell can currently accept waste"
            : undefined,
        }}
        onOk={saveCellOrganizer}
        destroyOnHidden
        styles={{ body: { maxHeight: "72vh", overflowY: "auto", padding: "12px 16px" } }}
      >
        {/* Capacity warning. Shown INSTEAD of the old behaviour, where a full
            cell made the whole organizer render empty with no explanation.
            The rows below still list normally — only the cell dropdowns are
            gated — so the operator can see exactly what is outstanding and
            what has to happen before it can be placed. */}
        {cellCapacityNotice && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message={
              cellCapacityNotice.kind === "at-capacity"
                ? "Your operational cell is already at 100% capacity"
                : cellCapacityNotice.kind === "no-cells"
                  ? "No disposal cells are configured"
                  : "No disposal cell can currently accept waste"
            }
            description={
              <div style={{ fontSize: 12 }}>
                <div style={{ marginBottom: 6 }}>
                  The entries below still need a disposal cell, but no cell is
                  currently able to accept them. They remain outstanding and are
                  listed here so nothing is lost.
                </div>
                {cellCapacityNotice.cells.length > 0 && (
                  <ul style={{ margin: "0 0 6px", paddingLeft: 18 }}>
                    {cellCapacityNotice.cells.map((c) => (
                      <li key={c.label}>
                        <b>{c.label}</b> — {c.reason}
                      </li>
                    ))}
                  </ul>
                )}
                <div>
                  <b>What to do:</b> assign these entries to another cell once one
                  becomes available, or contact the EMB Region III administrator to
                  open or reopen a disposal cell for this facility. Saving is
                  disabled until a cell can accept the waste, so no invalid
                  placement can be recorded.
                </div>
              </div>
            }
          />
        )}
        {/* The modal opens instantly; the unassigned placements stream in behind
            this. It used to await the fetch BEFORE opening, so clicking the menu
            left the app sitting with nothing on screen and feeling frozen. */}
        {cellOrganizerLoading ? (
          <div style={{ padding: "56px 0", textAlign: "center" }}>
            <Spin size="large" />
            <div style={{ marginTop: 14 }}>
              <Text type="secondary">
                Loading the entries that still need a disposal cell…
              </Text>
            </div>
            <div style={{ marginTop: 18, maxWidth: 560, margin: "18px auto 0" }}>
              <Skeleton active paragraph={{ rows: 3 }} />
            </div>
          </div>
        ) : cellOrganizerError ? (
          <Alert
            type="error"
            showIcon
            message="Could not load submissions"
            description={cellOrganizerError}
            action={
              <Button size="small" loading={cellOrganizerLoading} onClick={openCellOrganizer}>
                Retry
              </Button>
            }
          />
        ) : cellOrganizerData.length === 0 ? (
          <Empty description="All your submissions are already organized into cells." />
        ) : (
          <Space direction="vertical" size={10} style={{ width: "100%" }}>
            {/* Instructions collapsed by default so the organizer opens on the
                placement work, not a wall of steps. Expand to review the how-to. */}
            <Collapse
              size="small"
              defaultActiveKey={[]}
              style={{ borderRadius: 8, background: "#e6f4ff", borderColor: "#91caff" }}
              items={[
                {
                  key: "how-to",
                  label: (
                    <Space size={6}>
                      <InfoCircleOutlined style={{ color: "#1677ff" }} />
                      <Text strong style={{ fontSize: 13 }}>
                        How to organize your past submissions into cells
                      </Text>
                    </Space>
                  ),
                  children: (
                    <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                      <li>Only waste that has <b>no disposal cell yet</b> is listed for placement. Waste that is already placed is never offered again — moving it is an EMB correction.</li>
                      <li><b>Pick a cell</b> for each row. Only cells that fit the <b>waste type</b> are offered (hazardous waste → a hazardous cell, residual waste → a residual cell), each with the room it has left <i>after the rows you have already chosen</i>.</li>
                      <li>To place many rows at once, <b>tick the checkboxes</b>, choose a cell in the purple bar and press <b>Apply</b> — rows that cell cannot take are skipped and counted. Or press <b>Auto-place</b> to fill every empty row into the compatible cell with the most room.</li>
                      <li>Placed waste still missing a <b>Truck Capacity</b> is listed separately at the bottom. Where that plate&apos;s capacity is on your <b>Baseline Data</b> it is filled in and marked <i>from baseline</i>; check it and edit only if that trip was different.</li>
                      <li>Click <b>Save Placement</b> to record your choices and update the cell fill levels. New submissions stay blocked until all past waste is placed and every missing capacity is completed.</li>
                    </ol>
                  ),
                },
              ]}
            />

            {/* Pre-filled capacities are stated up front: numbers appear in a
                form the operator is about to submit, so where they came from
                must be visible rather than implied. */}
            {prefilledCapacityCount > 0 && (
              <Alert
                type="success"
                showIcon
                message={`${prefilledCapacityCount} truck capacit${prefilledCapacityCount === 1 ? "y was" : "ies were"} filled in from your Baseline Data`}
                description="These plates already have a declared capacity on your baseline, so you do not need to re-encode them. Each one is marked “from baseline” — review it and edit only if that trip was different. Nothing is saved until you click Save Placement."
              />
            )}

          {/* ── Cell Status Summary ──
              Reads the SAME canonical admin-side data and helpers the Cell
              Infra Overview uses, rather than re-deriving its own view:

              • cell COUNT widens across every cell array (a stale numberOfCell
                used to truncate the list, or show none at all),
              • cell NAME comes from the facility's current cellNames, so an
                admin rename is reflected here instead of a frozen "Cell N",
              • "Not Existed" cells are excluded, matching the admin,
              • capacity and fill are NORMALIZED before being compared — they
                carry independent declared units, and comparing them raw made
                cells look full when they were not,
              • status colours come from the centralized cell status resolver
                instead of a private colour table that could drift. */}
          {(() => {
            // While the facility is still loading, slfCellCount is 0 — returning
            // null here made the whole Cell Status card DISAPPEAR mid-load and
            // then pop in, which reads as "this SLF has no cells". Show the card
            // with a skeleton instead, so the layout is stable and the state is
            // honest: loading ≠ no cells.
            if (slfInfoLoading) {
              return (
                <Card size="small" style={{ borderRadius: 8, marginTop: 12 }}>
                  <Skeleton active title={{ width: "30%" }} paragraph={{ rows: 3 }} />
                </Card>
              );
            }
            if (!slfCellCount) return null;

            const cells = Array.from({ length: slfCellCount }, (_, idx) => {
              const stored = slfInfo?.cellStatuses?.[idx];
              if (isNonExistentCell(stored)) return null;
              const rawStatus = normalizeCellStatus(stored);
              const statusConfig = getCellStatusConfig(stored);
              const typeConfig = getCellTypeConfig(slfInfo?.cellTypes?.[idx]);
              const type = slfInfo?.cellTypes?.[idx] || "Residual";
              const submissionAllowed = slfInfo?.cellSubmissionAllowed?.[idx] !== false;
              const isOpen = isActiveCellStatus(rawStatus);

              const capUnit = resolveCellUnit(slfInfo, idx, "capacity");
              const fillUnit = resolveCellUnit(slfInfo, idx, "fill");
              const capacity = convertVolume(slfInfo?.cellCapacities?.[idx], capUnit, capUnit) ?? 0;
              const fill = convertVolume(slfInfo?.cellFillValues?.[idx], fillUnit, capUnit) ?? 0;
              // Full = in the cell + pending review (see reservedCellFill).
              const reserved = convertVolume(reservedCellFill(idx), fillUnit, capUnit) ?? fill;

              // THE cell % (utils/cellCapacity.js) — what every other cell view shows.
              const pct = cellPercent(fill, capacity);
              const isFull = capacity > 0 && reserved >= capacity;
              return {
                idx,
                label: resolveCellName(slfInfo, idx),
                status: rawStatus,
                statusConfig,
                typeConfig,
                capacityStatus: getCapacityStatus(pct),
                type,
                submissionAllowed,
                isOpen,
                isFull,
                capacity,
                fill,
                capUnit,
                pct,
              };
            }).filter(Boolean);
            if (!cells.length) return null;

            // Colours come from the centralized cell status resolver, so the
            // Portal can't drift from the admin's palette. (These replace two
            // private lookup tables that had to be kept in sync by hand.)
            const STATUS_COLOR = Object.fromEntries(
              cells.map((c) => [c.status, c.statusConfig.color]),
            );
            const STATUS_BG = Object.fromEntries(
              cells.map((c) => [c.status, c.statusConfig.bg]),
            );

            const pieCounts = cells.reduce((acc, c) => {
              const key = c.isFull
                ? "Full / Disabled"
                : isActiveCellStatus(c.status) && c.submissionAllowed
                ? "Open for Disposal"
                : isActiveCellStatus(c.status) && !c.submissionAllowed
                ? "Active (locked)"
                : c.status || "Other";
              acc[key] = (acc[key] || 0) + 1;
              return acc;
            }, {});
            const PIE_COLORS = {
              "Open for Disposal": "#52c41a",
              "Full / Disabled": "#ff4d4f",
              "Active (locked)": "#faad14",
              "Used/Completed": "#8c8c8c",
              "Closed": "#bfbfbf",
              "Under Construction": "#fa8c16",
              "Reserved Area": "#1677ff",
              "Reserved Cell": "#597ef7",
              "Not Existed": "#d9d9d9",
            };
            const pieData = Object.entries(pieCounts).map(([name, value]) => ({ name, value }));

            return (
              <Card
                size="small"
                style={{
                  borderRadius: 16,
                  border: "1px solid #e7d8ff",
                  background:
                    "linear-gradient(135deg, rgba(114,46,209,0.08) 0%, rgba(255,255,255,0.98) 48%, rgba(24,144,255,0.05) 100%)",
                  boxShadow: "0 10px 30px rgba(114,46,209,0.08)",
                  overflow: "hidden",
                }}
                styles={{ body: { padding: "14px 16px 16px" } }}
                title={
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <Space>
                      <div
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 10,
                          background: "linear-gradient(135deg, #722ed1 0%, #9254de 100%)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          boxShadow: "0 6px 16px rgba(114,46,209,0.24)",
                        }}
                      >
                        <ContainerOutlined style={{ color: "#fff", fontSize: 16 }} />
                      </div>
                      <div>
                        <Text strong style={{ fontSize: 14, display: "block" }}>
                          Cell Infra Overview
                        </Text>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          Open cells only remain selectable while capacity is still available.
                        </Text>
                      </div>
                    </Space>
                    <Space size={8} wrap>
                      <Space size={6} wrap>
                        <Tag color="green">{activeCellOptions.length} open</Tag>
                        {cells.filter((c) => c.isFull).length > 0 && (
                          <Tag color="red">{cells.filter((c) => c.isFull).length} full / disabled</Tag>
                        )}
                      </Space>
                      <Button
                        type="text"
                        size="small"
                        aria-label={cellInfraCollapsed ? "Expand Cell Infra Overview" : "Collapse Cell Infra Overview"}
                        icon={cellInfraCollapsed ? <DownOutlined /> : <UpOutlined />}
                        onClick={() => setCellInfraCollapsed((v) => !v)}
                      />
                    </Space>
                  </div>
                }
              >
                {!cellInfraCollapsed && (
                <Row gutter={[10, 10]} align="middle">
                  {/* Pie chart */}
                  <Col xs={24} sm={8} style={{ textAlign: "center" }}>
                    <ResponsiveContainer width="100%" height={130}>
                      <PieChart>
                        <Pie
                          data={pieData}
                          cx="50%"
                          cy="50%"
                          innerRadius={36}
                          outerRadius={56}
                          paddingAngle={2}
                          dataKey="value"
                          isAnimationActive={false}
                        >
                          {pieData.map((entry) => (
                            <RCell
                              key={entry.name}
                              fill={PIE_COLORS[entry.name] || "#d9d9d9"}
                            />
                          ))}
                        </Pie>
                        <RTooltip
                          formatter={(val, name) => [`${val} cell(s)`, name]}
                          contentStyle={{ fontSize: 11 }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{ marginTop: -8 }}>
                      {pieData.map((entry) => (
                        <Space key={entry.name} size={4} style={{ marginRight: 10 }}>
                          <span
                            style={{
                              display: "inline-block",
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              background: PIE_COLORS[entry.name] || "#d9d9d9",
                            }}
                          />
                          <Text style={{ fontSize: 10 }}>{entry.name} ({entry.value})</Text>
                        </Space>
                      ))}
                    </div>
                  </Col>

                  {/* Per-cell cards */}
                  <Col xs={24} sm={16}>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill, minmax(145px, 1fr))",
                        gap: 10,
                      }}
                    >
                      {cells.map((c) => {
                        const color = c.isFull
                          ? "#ff4d4f"
                          : c.isOpen && c.submissionAllowed
                          ? "#52c41a"
                          : c.isOpen
                          ? "#faad14"
                          : STATUS_COLOR[c.status] || "#8c8c8c";
                        const bg = c.isFull
                          ? "linear-gradient(135deg, #fff1f0 0%, #fff 100%)"
                          : c.isOpen && c.submissionAllowed
                          ? "#f6ffed"
                          : c.isOpen
                          ? "#fffbe6"
                          : STATUS_BG[c.status] || "#f5f5f5";
                        const statusLabel = c.isFull
                          ? "Full / Disabled"
                          : c.isOpen && c.submissionAllowed
                          ? "Open"
                          : c.isOpen
                          ? "Active (locked)"
                          : c.status;
                        return (
                          <div
                            key={c.idx}
                            style={{
                              borderRadius: 14,
                              border: `1.5px solid ${color}33`,
                              background: bg,
                              padding: "10px 11px",
                              borderLeft: `5px solid ${color}`,
                              position: "relative",
                              boxShadow: c.isFull
                                ? "0 6px 18px rgba(255,77,79,0.10)"
                                : "0 6px 18px rgba(0,0,0,0.04)",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "flex-start",
                                gap: 6,
                                marginBottom: 2,
                              }}
                            >
                              <Text strong style={{ fontSize: 12, display: "block", color }}>
                                {c.label}
                              </Text>
                              <Tag
                                color={c.isFull ? "red" : c.isOpen && c.submissionAllowed ? "green" : c.isOpen ? "gold" : "default"}
                                style={{ margin: 0, fontSize: 9, lineHeight: "16px", paddingInline: 6 }}
                              >
                                {c.isFull ? "FULL" : c.isOpen && c.submissionAllowed ? "OPEN" : c.isOpen ? "LOCKED" : "OFF"}
                              </Tag>
                            </div>
                            <Text style={{ fontSize: 10, display: "block", color: "#595959", marginBottom: 1 }}>
                              {statusLabel}
                            </Text>
                            <Text style={{ fontSize: 10, display: "block", color: "#8c8c8c" }}>
                              {c.type}
                            </Text>
                            {/* {c.capacity > 0 && (
                              <Text style={{ fontSize: 9, display: "block", color: "#8c8c8c", marginTop: 4 }}>
                                {Number(c.fill || 0).toLocaleString()} / {Number(c.capacity).toLocaleString()} {c.capUnit}
                              </Text>
                            )} */}
                            {c.pct != null && (
                              <div
                                style={{
                                  marginTop: 6,
                                  height: 6,
                                  borderRadius: 4,
                                  background: "#e0e0e0",
                                  overflow: "hidden",
                                }}
                              >
                                <div
                                  style={{
                                    height: "100%",
                                    borderRadius: 4,
                                    width: `${c.pct}%`,
                                    background: c.pct >= 90 ? "#ff4d4f" : c.pct >= 75 ? "#faad14" : "#52c41a",
                                  }}
                                />
                              </div>
                            )}
                            {c.pct != null && (
                              <Text style={{ fontSize: 9, color: c.isFull ? "#cf1322" : "#8c8c8c", fontWeight: c.isFull ? 700 : 400 }}>
                                {c.isFull ? "No longer available" : `${c.pct}% filled`}
                              </Text>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </Col>
                </Row>
                )}
              </Card>
            );
          })()}

          {/* ── Session progress + Auto-place ── */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              flexWrap: "wrap",
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #efdbff",
              background: "#fdf9ff",
            }}
          >
            {organizerStats.toPlace > 0 ? (
              <div style={{ flex: "1 1 240px", minWidth: 200 }}>
                <Text style={{ fontSize: 12 }}>
                  <b>{organizerStats.placed.toLocaleString()}</b> of{" "}
                  <b>{organizerStats.toPlace.toLocaleString()}</b> unplaced load
                  {organizerStats.toPlace === 1 ? "" : "s"} assigned a cell
                </Text>
                <Progress
                  percent={Math.round((organizerStats.placed / organizerStats.toPlace) * 100)}
                  size="small"
                  strokeColor="#722ed1"
                  showInfo={false}
                  style={{ margin: 0 }}
                />
              </div>
            ) : (
              <Text style={{ fontSize: 12, flex: "1 1 240px" }}>
                <CheckCircleOutlined style={{ color: "#52c41a", marginRight: 6 }} />
                All your waste is already placed in cells.
              </Text>
            )}
            {organizerStats.capacityNeeded > 0 && (
              <Tag color={organizerStats.capacityFilled >= organizerStats.capacityNeeded ? "green" : "orange"} style={{ margin: 0 }}>
                Truck capacity: {organizerStats.capacityFilled}/{organizerStats.capacityNeeded}
              </Tag>
            )}
            {organizerStats.toPlace > organizerStats.placed && activeCellOptions.length > 0 && (
              <Tooltip title="Fill every row that has no cell into the open cell of the right waste type with the most room left, largest loads first. Nothing is saved until you press Save Placement.">
                <Button size="small" icon={<ThunderboltOutlined />} onClick={autoPlaceOrganizer}>
                  Auto-place {(organizerStats.toPlace - organizerStats.placed).toLocaleString()} row
                  {organizerStats.toPlace - organizerStats.placed === 1 ? "" : "s"}
                </Button>
              </Tooltip>
            )}
          </div>

          {/* ── Bulk-assign bar ── */}
          {cellOrganizerSelected.length > 0 && (
            <div
              style={{
                background: "linear-gradient(90deg, #391085 0%, #531dab 100%)",
                borderRadius: 8,
                padding: "10px 14px",
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <Tag color="white" style={{ color: "#531dab", fontWeight: 700, fontSize: 12 }}>
                {cellOrganizerSelected.length} row(s) selected
              </Tag>
              <Select
                placeholder="Select cell to apply to all"
                value={cellOrganizerBulkCell}
                onChange={setCellOrganizerBulkCell}
                allowClear
                style={{ flex: 1, minWidth: 200 }}
                options={activeCellOptions.map((o) => ({
                  label: `${o.label}${cellRoomLabel(o, organizerPlanned)}`,
                  value: o.value,
                }))}
                size="small"
              />
              <Button
                size="small"
                type="primary"
                disabled={!cellOrganizerBulkCell}
                onClick={applyBulkCellToSelected}
                style={{ background: "#9254de", borderColor: "#9254de" }}
                icon={<ContainerOutlined />}
              >
                Apply to Selected
              </Button>
              <Button
                size="small"
                type="text"
                onClick={() => {
                  setCellOrganizerSelected([]);
                  setCellOrganizerBulkCell(undefined);
                }}
                style={{ color: "rgba(255,255,255,0.75)" }}
              >
                Clear
              </Button>
            </div>
          )}

          {/* ── Collapsible submission cards ── */}
          <Collapse
            accordion={false}
            activeKey={cellOrganizerExpanded}
            onChange={setCellOrganizerExpanded}
            bordered={false}
            style={{ background: "transparent" }}
            items={organizerWork.placementSubs
              .slice(
                (cellOrganizerPage - 1) * cellOrganizerPageSize,
                cellOrganizerPage * cellOrganizerPageSize,
              )
              .map((sub) => {
              // ONLY waste that has no cell yet (splitOrganizerWork). Placed
              // waste that is merely missing a Truck Capacity is listed in its
              // own section below and never appears here as placement work.
              const rows = (sub.placements || []).map((p) => ({
                placement: p,
                rowKey: `${sub._id}|${p.truckIndex}|${
                      Number.isInteger(p.vehicleIndex) ? p.vehicleIndex : "t"
                    }`,
                truckIndex: p.truckIndex,
                vehicleIndex: Number.isInteger(p.vehicleIndex) ? p.vehicleIndex : null,
                plate: p.plateNumber || p.hauler || "-",
                wasteType: p.wasteType || "Residual",
                volume: p.actualVolume,
                volumeUnit: p.actualVolumeUnit || baselineUnit || slfUnit,
                // A cell counts only with a valid cell IDENTIFIER. A legacy
                // name-only copy (cellName without cellIndex) is unassigned —
                // showing it made the row read as "placed" while nothing could
                // be written back, so the arrangement never persisted. Once the
                // user picks a cell, updateOrganizerCell writes a real
                // cellIndex and the selection renders normally.
                cellName: Number.isInteger(p.cellIndex) ? p.cellName : undefined,
                needsCell: p.needsCell !== false,
                needsCapacity: !!p.needsCapacity,
                capacity: p.capacity,
                // Pre-filled from the baseline fleet, shown so the operator
                // knows where the number came from and can correct it.
                capacityPrefilled: !!p.capacityPrefilled,
              }));

              // A row is complete when it has a cell (if it needed one) AND a
              // positive Truck Capacity (if it was missing). Both must be done
              // before the submission drops off the block list (#6).
              const isRowComplete = (r) =>
                (!r.needsCell || !!r.cellName) &&
                (!r.needsCapacity || Number(r.capacity) > 0);
              const placedCount = rows.filter(isRowComplete).length;
              const allPlaced = placedCount === rows.length;
              const subSelectedCount = rows.filter((r) =>
                cellOrganizerSelected.includes(r.rowKey),
              ).length;
              const allSubSelected = subSelectedCount === rows.length;

              return {
                key: sub._id,
                label: (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                      width: "100%",
                    }}
                  >
                    {/* select-all checkbox for this submission */}
                    <Checkbox
                      checked={allSubSelected && rows.length > 0}
                      indeterminate={subSelectedCount > 0 && !allSubSelected}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const keys = rows.map((r) => r.rowKey);
                        if (e.target.checked) {
                          setCellOrganizerSelected((prev) => [
                            ...prev.filter((k) => !keys.includes(k)),
                            ...keys,
                          ]);
                        } else {
                          setCellOrganizerSelected((prev) =>
                            prev.filter((k) => !keys.includes(k)),
                          );
                        }
                      }}
                    />
                    <Text strong style={{ fontSize: 13 }}>
                      {sub.idNo || sub.submissionId || "Submission"}
                    </Text>
                    <Tag color="blue">{sub.lguCompanyName || "—"}</Tag>
                    {sub.dateOfDisposal && (
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {dayjs(sub.dateOfDisposal).format("MM/DD/YYYY")}
                      </Text>
                    )}
                    <Tag
                      color={allPlaced ? "success" : "warning"}
                      style={{ marginLeft: "auto" }}
                    >
                      {placedCount}/{rows.length} placed
                    </Tag>
                  </div>
                ),
                style: {
                  borderRadius: 10,
                  marginBottom: 6,
                  border: "1px solid #efdbff",
                  background: "#fdf9ff",
                },
                styles: { header: { padding: "10px 14px" }, body: { padding: "0 14px 12px" } },
                children: (
                  <Table
                    size="small"
                    rowKey="rowKey"
                    pagination={
                      rows.length > 10
                        ? {
                            pageSize: 10,
                            size: "small",
                            showSizeChanger: true,
                            pageSizeOptions: [10, 20, 50, 100],
                            showTotal: (total) =>
                              `${total} row${total === 1 ? "" : "s"}`,
                          }
                        : false
                    }
                    dataSource={rows}
                    rowSelection={{
                      selectedRowKeys: cellOrganizerSelected.filter((k) =>
                        rows.some((r) => r.rowKey === k),
                      ),
                      onChange: (selectedKeys) => {
                        const otherSubs = cellOrganizerSelected.filter(
                          (k) => !rows.some((r) => r.rowKey === k),
                        );
                        setCellOrganizerSelected([...otherSubs, ...selectedKeys]);
                      },
                      columnWidth: 36,
                    }}
                    columns={[
                      { title: "Truck / Plate", dataIndex: "plate", width: 130, render: (v) => <Text style={{ fontSize: 12 }}>{v}</Text> },
                      {
                        title: "Waste Type",
                        dataIndex: "wasteType",
                        width: 150,
                        render: (v) => (
                          <Tag color={wasteTypeTagColor(v, "green")} style={{ fontSize: 11 }}>
                            {v}
                          </Tag>
                        ),
                      },
                      {
                        title: "Volume",
                        width: 100,
                        render: (_, r) => (
                          <Text style={{ fontSize: 12 }}>
                            {Number(r.volume || 0).toLocaleString()}{" "}
                            {String(r.volumeUnit).replace("m3", "m³")}
                          </Text>
                        ),
                      },
                      {
                        title: "Disposal Cell",
                        render: (_, r) => {
                          // Only cells that fit the WASTE TYPE, with the room each
                          // has left after every OTHER row's choice in this
                          // session. There is no fallback to "any open cell":
                          // that fallback is how a hazardous load could be
                          // offered a residual cell.
                          const planned = new Map(organizerPlanned);
                          if (r.cellName && Number.isInteger(r.placement.cellIndex)) {
                            const own = rowVolumeM3(r.placement);
                            planned.set(r.placement.cellIndex, (planned.get(r.placement.cellIndex) || 0) - own);
                          }
                          const choices = cellChoicesFor(r.placement, activeCellOptions, planned);
                          if (!choices.length) {
                            return (
                              <Tooltip title={`No open cell accepts ${r.wasteType} waste. Contact EMB Region III to open one.`}>
                                <Select
                                  size="small"
                                  style={{ width: "100%" }}
                                  disabled
                                  status="warning"
                                  placeholder={`No open ${/haz|inert/i.test(r.wasteType) ? "hazardous" : "residual"} cell`}
                                />
                              </Tooltip>
                            );
                          }
                          return (
                            <Select
                              size="small"
                              style={{ width: "100%" }}
                              placeholder="Select open cell"
                              value={r.cellName || undefined}
                              allowClear
                              status={r.cellName ? "" : "warning"}
                              popupMatchSelectWidth={false}
                              options={choices.map(({ option: o, fits, room }) => ({
                                value: o.value,
                                // A full option stays selectable only if it is the
                                // row's current choice, so the value still renders.
                                disabled: !fits && o.value !== r.cellName,
                                label: `${o.label}${Number.isFinite(room) ? cellRoomLabel(o, planned) : ""}${fits ? "" : " — not enough room"}`,
                              }))}
                              onChange={(val) =>
                                updateOrganizerCell(sub._id, r.truckIndex, r.vehicleIndex, val)
                              }
                            />
                          );
                        },
                      },
                      {
                        // Historical Truck Capacity completion (#6). Only rows
                        // that are actually missing a capacity render an input;
                        // rows that already have one show it read-only.
                        title: (
                          <span>
                            Truck Capacity{" "}
                            <Text type="secondary" style={{ fontSize: 10, fontWeight: 400 }}>
                              ({String(baselineUnit || slfUnit).replace("m3", "m³")})
                            </Text>
                          </span>
                        ),
                        width: 140,
                        render: (_, r) =>
                          r.needsCapacity ? (
                            <Space direction="vertical" size={0} style={{ width: "100%" }}>
                              <InputNumber
                                size="small"
                                style={{ width: "100%" }}
                                min={0}
                                step={0.1}
                                placeholder="Required"
                                status={Number(r.capacity) > 0 ? "" : "warning"}
                                value={Number(r.capacity) > 0 ? r.capacity : undefined}
                                onChange={(val) =>
                                  updateOrganizerCapacity(sub._id, r.truckIndex, r.vehicleIndex, val)
                                }
                              />
                              {r.capacityPrefilled && Number(r.capacity) > 0 && (
                                <Tooltip title="Taken from this plate's capacity on your Baseline Data. Edit it if this trip was different.">
                                  <Text type="secondary" style={{ fontSize: 10 }}>
                                    from baseline
                                  </Text>
                                </Tooltip>
                              )}
                            </Space>
                          ) : (
                            <Text style={{ fontSize: 12 }}>
                              {Number(r.capacity) > 0
                                ? `${Number(r.capacity).toLocaleString()} ${String(baselineUnit || slfUnit).replace("m3", "m³")}`
                                : "—"}
                            </Text>
                          ),
                      },
                    ]}
                  />
                ),
              };
            })}
          />
          {organizerWork.placementSubs.length > cellOrganizerPageSize && (
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Pagination
                size="small"
                current={cellOrganizerPage}
                pageSize={cellOrganizerPageSize}
                total={organizerWork.placementSubs.length}
                showSizeChanger
                pageSizeOptions={["5", "10", "20", "50"]}
                showTotal={(total) =>
                  `${total} submission${total === 1 ? "" : "s"}`
                }
                onChange={(p, size) => {
                  setCellOrganizerPage(p);
                  setCellOrganizerPageSize(size || cellOrganizerPageSize);
                }}
              />
            </div>
          )}

          {/* ── Already placed — Truck Capacity still needed ──
              Waste that HAS a cell is never placement work. It is listed here
              only because a historical trip is missing its Truck Capacity,
              which still blocks new submissions. The cell is shown, never
              offered for change. */}
          {organizerWork.capacityRows.length > 0 && (
            <Collapse
              size="small"
              defaultActiveKey={organizerWork.placementSubs.length ? [] : ["capacity"]}
              style={{ borderRadius: 10, background: "#fffbe6", borderColor: "#ffe58f" }}
              items={[
                {
                  key: "capacity",
                  label: (
                    <Space size={8} wrap>
                      <InfoCircleOutlined style={{ color: "#d48806" }} />
                      <Text strong style={{ fontSize: 13 }}>
                        Already placed — Truck Capacity still needed
                      </Text>
                      <Tag color="orange" style={{ margin: 0 }}>
                        {organizerWork.capacityRows.filter((c) => !(Number(c.placement.capacity) > 0)).length} of{" "}
                        {organizerWork.capacityRows.length} missing
                      </Tag>
                    </Space>
                  ),
                  children: (
                    <Table
                      size="small"
                      rowKey="key"
                      dataSource={organizerWork.capacityRows}
                      pagination={
                        organizerWork.capacityRows.length > 10
                          ? { pageSize: 10, size: "small", showSizeChanger: false, showTotal: (t) => `${t} load${t === 1 ? "" : "s"}` }
                          : false
                      }
                      columns={[
                        {
                          title: "Submission",
                          width: 150,
                          render: (_, c) => (
                            <div style={{ lineHeight: 1.3 }}>
                              <Text style={{ fontSize: 12 }}>{c.sub.idNo || c.sub.submissionId || "Submission"}</Text>
                              {c.sub.dateOfDisposal && (
                                <div>
                                  <Text type="secondary" style={{ fontSize: 11 }}>
                                    {dayjs(c.sub.dateOfDisposal).format("MM/DD/YYYY")}
                                  </Text>
                                </div>
                              )}
                            </div>
                          ),
                        },
                        { title: "Truck / Plate", width: 120, render: (_, c) => <Text style={{ fontSize: 12 }}>{c.placement.plateNumber || c.placement.hauler || "-"}</Text> },
                        {
                          title: "Volume",
                          width: 100,
                          render: (_, c) => (
                            <Text style={{ fontSize: 12 }}>
                              {Number(c.placement.actualVolume || 0).toLocaleString()}{" "}
                              {String(c.placement.actualVolumeUnit || baselineUnit || slfUnit).replace("m3", "m³")}
                            </Text>
                          ),
                        },
                        {
                          title: "Placed in",
                          render: (_, c) => (
                            <Tag color="purple" bordered={false} style={{ margin: 0 }}>
                              {c.placement.cellName || `Cell ${Number(c.placement.cellIndex) + 1}`}
                            </Tag>
                          ),
                        },
                        {
                          title: (
                            <span>
                              Truck Capacity{" "}
                              <Text type="secondary" style={{ fontSize: 10, fontWeight: 400 }}>
                                ({String(baselineUnit || slfUnit).replace("m3", "m³")})
                              </Text>
                            </span>
                          ),
                          width: 150,
                          render: (_, c) => (
                            <Space direction="vertical" size={0} style={{ width: "100%" }}>
                              <InputNumber
                                size="small"
                                style={{ width: "100%" }}
                                min={0}
                                step={0.1}
                                placeholder="Required"
                                status={Number(c.placement.capacity) > 0 ? "" : "warning"}
                                value={Number(c.placement.capacity) > 0 ? c.placement.capacity : undefined}
                                onChange={(val) =>
                                  updateOrganizerCapacity(
                                    c.sub._id,
                                    c.placement.truckIndex,
                                    Number.isInteger(c.placement.vehicleIndex) ? c.placement.vehicleIndex : null,
                                    val,
                                  )
                                }
                              />
                              {c.placement.capacityPrefilled && Number(c.placement.capacity) > 0 && (
                                <Tooltip title="Taken from this plate's capacity on your Baseline Data. Edit it if this trip was different.">
                                  <Text type="secondary" style={{ fontSize: 10 }}>from baseline</Text>
                                </Tooltip>
                              )}
                            </Space>
                          ),
                        },
                      ]}
                    />
                  ),
                },
              ]}
            />
          )}
          </Space>
        )}
      </Modal>
    )
  );
}
