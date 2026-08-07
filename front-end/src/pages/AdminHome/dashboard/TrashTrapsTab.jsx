import { useState, useMemo } from "react";
import api from "../../../api";
import { FitBounds, ProvinceBoundary } from "../MapPrimitives";
import { TILE_LAYERS } from "../constants";
import { AppstoreOutlined, BarChartOutlined, CalendarOutlined, CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, CopyOutlined, DeleteOutlined, EnvironmentOutlined, ExperimentOutlined, EyeOutlined, FileTextOutlined, FundOutlined, GlobalOutlined, PieChartOutlined, RiseOutlined, SafetyCertificateOutlined, TeamOutlined, ToolOutlined, UserOutlined } from "@ant-design/icons";
import { Button, Card, Col, Progress, Row, Select, Space, Statistic, Tag, Tooltip, Typography } from "antd";
import dayjs from "dayjs";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";

const { Text } = Typography;

// Trash Traps dashboard tab.
//
// Owns its own map state (tile layer, province/status filters), the derived map
// points and its marker-icon builder — nothing outside this tab reads them.
export default function TrashTrapsTab({ trapStats, loading, isDark, setActiveMenu, setTrapViewRecord }) {
  const [trapTileKey, setTrapTileKey] = useState("street");
  const [trapFilterProvince, setTrapFilterProvince] = useState(null);
  const [trapFilterStatus, setTrapFilterStatus] = useState(null);

  const trapMapPts = useMemo(
    () =>
      ((trapStats && trapStats.mapData) || [])
        .filter((r) => {
          const lat = Number(r.latitude);
          const lng = Number(r.longitude);
          return (
            lat && lng && !isNaN(lat) && !isNaN(lng) &&
            lat >= 4.5 && lat <= 21.5 && lng >= 116 && lng <= 127
          );
        })
        .map((r) => ({
          lat: Number(r.latitude),
          lng: Number(r.longitude),
          record: r,
        })),
    [trapStats && trapStats.mapData],
  );

  const filteredTrapMapPts = useMemo(() => {
    let pts = trapMapPts;
    if (trapFilterProvince)
      pts = pts.filter((p) => p.record.province === trapFilterProvince);
    if (trapFilterStatus) {
      if (trapFilterStatus === "Operational")
        pts = pts.filter(
          (p) =>
            /operational/i.test(p.record.statusOfTrashTraps) &&
            !/non/i.test(p.record.statusOfTrashTraps),
        );
      else if (trapFilterStatus === "Non-Operational")
        pts = pts.filter((p) => /non/i.test(p.record.statusOfTrashTraps));
      else pts = pts.filter((p) => !p.record.statusOfTrashTraps);
    }
    return pts;
  }, [trapMapPts, trapFilterProvince, trapFilterStatus]);

  const trapProvinceOptions = useMemo(() => {
    const set = new Set(
      trapMapPts.map((p) => p.record.province).filter(Boolean),
    );
    return [...set].sort().map((v) => ({ label: v, value: v }));
  }, [trapMapPts]);

  const trapStatusIcon = (statusOfTrashTraps) => {
    const isOp =
      /operational/i.test(statusOfTrashTraps) &&
      !/non/i.test(statusOfTrashTraps);
    const isNonOp = /non/i.test(statusOfTrashTraps);
    const bg = isOp ? "#52c41a" : isNonOp ? "#ff4d4f" : "#8c8c8c";
    const icon = isOp ? "✓" : isNonOp ? "✕" : "●";
    return L.divIcon({
      className: "",
      html: `<div style="width:20px;height:20px;border-radius:50%;background:${bg};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:bold">${icon}</div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
      popupAnchor: [0, -12],
    });
  };

  const trapProvList = trapStats.byProvinceList || [];
  const trapMaxProv = Math.max(...trapProvList.map((p) => p.count), 1);
  const trapByStatus = trapStats.byStatus || {};
  const trapOp = trapByStatus.Operational || 0;
  const trapNonOp = trapByStatus["Non-Operational"] || 0;
  const trapNotMonitored = trapByStatus["Not Yet Monitored"] || 0;
  const trapOpRate =
    trapStats.totalRecords > 0 ? (trapOp / trapStats.totalRecords) * 100 : 0;
  const trapOps = trapStats.operationStats || {};
  const trapTile = TILE_LAYERS[trapTileKey];

  const TRAP_CARD_H = 280;

  return (
    <>
      {/* Row 1: Stat tiles */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={12} md={6}>
          <Card
            hoverable
            style={{ borderRadius: 10, height: 110 }}
            loading={loading}
          >
            <Statistic
              title="Total Traps"
              value={trapStats.totalRecords}
              prefix={<ExperimentOutlined style={{ color: "#13c2c2" }} />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Card
            hoverable
            style={{ borderRadius: 10, height: 110 }}
            loading={loading}
          >
            <Statistic
              title="Operational"
              value={trapOp}
              valueStyle={{ color: "#52c41a" }}
              prefix={<CheckCircleOutlined />}
              suffix={
                <span
                  style={{ color: "#999", fontSize: 14, fontWeight: 400 }}
                >
                  ({trapOpRate.toFixed(0)}%)
                </span>
              }
            />
          </Card>
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Card
            hoverable
            style={{ borderRadius: 10, height: 110 }}
            loading={loading}
          >
            <Statistic
              title="Non-Operational"
              value={trapNonOp}
              valueStyle={{ color: "#ff4d4f" }}
              prefix={<CloseCircleOutlined />}
              suffix={
                <span
                  style={{ color: "#999", fontSize: 14, fontWeight: 400 }}
                >
                  (
                  {(trapStats.totalRecords > 0
                    ? (trapNonOp / trapStats.totalRecords) * 100
                    : 0
                  ).toFixed(0)}
                  %)
                </span>
              }
            />
          </Card>
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Card
            hoverable
            style={{ borderRadius: 10, height: 110 }}
            loading={loading}
          >
            <Statistic
              title="HDPE Floaters"
              value={trapOps.totalHDPE || 0}
              prefix={<ToolOutlined style={{ color: "#1890ff" }} />}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={12} md={6}>
          <Card
            hoverable
            style={{ borderRadius: 10, height: 110 }}
            loading={loading}
          >
            <Statistic
              title="Total Waste Hauled"
              value={trapOps.totalWasteHauled || 0}
              suffix="kg"
              prefix={<BarChartOutlined style={{ color: "#722ed1" }} />}
              formatter={(v) => Number(v).toLocaleString()}
            />
          </Card>
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Card
            hoverable
            style={{ borderRadius: 10, height: 110 }}
            loading={loading}
          >
            <Statistic
              title="Avg Waste/Trap"
              value={(trapOps.avgWasteHauled || 0).toFixed(1)}
              suffix="kg"
              prefix={<BarChartOutlined style={{ color: "#13c2c2" }} />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Card
            hoverable
            style={{ borderRadius: 10, height: 110 }}
            loading={loading}
          >
            <Statistic
              title="Op. Rate"
              value={trapOpRate.toFixed(1)}
              suffix="%"
              prefix={<RiseOutlined style={{ color: "#faad14" }} />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Card
            hoverable
            style={{ borderRadius: 10, height: 110 }}
            loading={loading}
          >
            <Tooltip title="Click to view Trash Traps page">
              <div
                style={{ cursor: "pointer" }}
                onClick={() => setActiveMenu("cs-trash-traps")}
              >
                <Statistic
                  title="View All Records"
                  value={trapStats.totalRecords}
                  prefix={<FileTextOutlined style={{ color: "#fa8c16" }} />}
                />
              </div>
            </Tooltip>
          </Card>
        </Col>
      </Row>

      {/* Two-column layout: cards left, map right */}
      <Row gutter={[16, 16]}>
        {/* LEFT COLUMN — Stats cards */}
        <Col xs={24} lg={14}>
          <Row gutter={[16, 16]}>
            {/* Operational Status */}
            <Col xs={24} sm={12}>
              <Card
                title={
                  <>
                    <PieChartOutlined /> Operational Status
                  </>
                }
                style={{ borderRadius: 10, height: TRAP_CARD_H }}
                loading={loading}
                styles={{
                  body: { overflow: "auto", height: TRAP_CARD_H - 57 },
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  {[
                    {
                      label: "Operational",
                      count: trapOp,
                      color: "#52c41a",
                      icon: <CheckCircleOutlined />,
                    },
                    {
                      label: "Non-Operational",
                      count: trapNonOp,
                      color: "#ff4d4f",
                      icon: <CloseCircleOutlined />,
                    },
                    {
                      label: "Not Yet Monitored",
                      count: trapNotMonitored,
                      color: "#d9d9d9",
                      icon: <ClockCircleOutlined />,
                    },
                  ].map((s) => (
                    <div key={s.label}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          marginBottom: 4,
                        }}
                      >
                        <Text>
                          {s.icon} {s.label}
                        </Text>
                        <Text strong>
                          {s.count}{" "}
                          <span style={{ color: "#999", fontWeight: 400 }}>
                            (
                            {trapStats.totalRecords > 0
                              ? Math.round(
                                  (s.count / trapStats.totalRecords) * 100,
                                )
                              : 0}
                            %)
                          </span>
                        </Text>
                      </div>
                      <Progress
                        percent={
                          trapStats.totalRecords > 0
                            ? Math.round(
                                (s.count / trapStats.totalRecords) * 100,
                              )
                            : 0
                        }
                        strokeColor={s.color}
                        showInfo={false}
                        size="small"
                      />
                    </div>
                  ))}
                </div>
              </Card>
            </Col>

            {/* Key Metrics */}
            <Col xs={24} sm={12}>
              <Card
                title={
                  <>
                    <BarChartOutlined /> Key Metrics
                  </>
                }
                style={{ borderRadius: 10, height: TRAP_CARD_H }}
                loading={loading}
                styles={{
                  body: {
                    overflow: "auto",
                    height: TRAP_CARD_H - 57,
                    padding: "12px 16px",
                  },
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "6px 10px",
                      background:
                        isDark ? "linear-gradient(135deg, rgba(19,194,194,0.12) 0%, rgba(47,84,235,0.08) 100%)" : "linear-gradient(135deg, #e6fffb 0%, #f0f5ff 100%)",
                      borderRadius: 8,
                      border: "1px solid #87e8de",
                    }}
                  >
                    <Progress
                      type="circle"
                      percent={Math.round(trapOpRate)}
                      size={48}
                      strokeColor={{ "0%": "#13c2c2", "100%": "#87e8de" }}
                      format={(p) => (
                        <span style={{ fontSize: 12, fontWeight: 700 }}>
                          {p}%
                        </span>
                      )}
                    />
                    <div>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        Operational Rate
                      </Text>
                      <br />
                      <Text
                        strong
                        style={{ fontSize: 16, color: "#13c2c2" }}
                      >
                        {trapOpRate.toFixed(1)}%
                      </Text>
                    </div>
                  </div>
                  <Row gutter={8}>
                    <Col span={12}>
                      <div
                        style={{
                          textAlign: "center",
                          padding: "6px 4px",
                          background: isDark ? "rgba(22,119,255,0.15)" : "#e6f7ff",
                          borderRadius: 6,
                          border: isDark ? "1px solid rgba(22,119,255,0.3)" : "1px solid #bae7ff",
                        }}
                      >
                        <Text
                          type="secondary"
                          style={{ fontSize: 10, display: "block" }}
                        >
                          HDPE Floaters
                        </Text>
                        <Text
                          strong
                          style={{ fontSize: 16, color: "#1890ff" }}
                        >
                          {(trapOps.totalHDPE || 0).toLocaleString()}
                        </Text>
                      </div>
                    </Col>
                    <Col span={12}>
                      <div
                        style={{
                          textAlign: "center",
                          padding: "6px 4px",
                          background: isDark ? "rgba(114,46,209,0.15)" : "#f9f0ff",
                          borderRadius: 6,
                          border: isDark ? "1px solid rgba(114,46,209,0.3)" : "1px solid #efdbff",
                        }}
                      >
                        <Text
                          type="secondary"
                          style={{ fontSize: 10, display: "block" }}
                        >
                          Waste Hauled
                        </Text>
                        <Text
                          strong
                          style={{ fontSize: 16, color: "#722ed1" }}
                        >
                          {(trapOps.totalWasteHauled || 0).toLocaleString()}{" "}
                          kg
                        </Text>
                      </div>
                    </Col>
                  </Row>
                  <div
                    style={{
                      textAlign: "center",
                      padding: "6px 4px",
                      background: isDark ? "rgba(250,219,20,0.12)" : "#fcffe6",
                      borderRadius: 6,
                      border: "1px solid #fffb8f",
                    }}
                  >
                    <Text
                      type="secondary"
                      style={{ fontSize: 10, display: "block" }}
                    >
                      Avg Waste per Trap
                    </Text>
                    <Text strong style={{ fontSize: 16, color: "#faad14" }}>
                      {(trapOps.avgWasteHauled || 0).toFixed(1)} kg
                    </Text>
                  </div>
                </div>
              </Card>
            </Col>

            {/* Traps per Province */}
            <Col xs={24} sm={12}>
              <Card
                title={
                  <>
                    <BarChartOutlined /> Traps per Province
                  </>
                }
                style={{ borderRadius: 10, height: TRAP_CARD_H }}
                loading={loading}
                styles={{
                  body: { overflow: "auto", height: TRAP_CARD_H - 57 },
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 5,
                    maxHeight: 170,
                    overflowY: "auto",
                    padding: "0 2px",
                  }}
                >
                  {trapProvList.map((p, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 10,
                          color: isDark ? "#aaa" : "#999",
                          minWidth: 70,
                          textAlign: "right",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {p._id}
                      </Text>
                      <div
                        style={{
                          flex: 1,
                          height: 16,
                          background: isDark ? "#2a2a2a" : "#f5f5f5",
                          borderRadius: 3,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${Math.max((p.count / trapMaxProv) * 100, 4)}%`,
                            height: "100%",
                            background:
                              "linear-gradient(90deg, #13c2c2 0%, #87e8de 100%)",
                            borderRadius: "3px 0 0 3px",
                            transition: "width 0.5s ease",
                          }}
                        />
                      </div>
                      <Text
                        style={{
                          fontSize: 10,
                          color: isDark ? "#ccc" : "#666",
                          minWidth: 20,
                          textAlign: "right",
                          fontWeight: 600,
                        }}
                      >
                        {p.count}
                      </Text>
                    </div>
                  ))}
                </div>
              </Card>
            </Col>

            {/* Manila Bay Area */}
            <Col xs={24} sm={12}>
              <Card
                title="Manila Bay Area"
                style={{ borderRadius: 10, height: TRAP_CARD_H }}
                loading={loading}
                styles={{
                  body: { overflow: "auto", height: TRAP_CARD_H - 57 },
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  {Object.entries(trapStats.byManilaBayArea || {}).map(
                    ([key, count]) => (
                      <div key={key}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            marginBottom: 4,
                          }}
                        >
                          <Text>{key || "Unspecified"}</Text>
                          <Text strong>
                            {count}{" "}
                            <span
                              style={{ color: "#999", fontWeight: 400 }}
                            >
                              (
                              {trapStats.totalRecords > 0
                                ? Math.round(
                                    (count / trapStats.totalRecords) * 100,
                                  )
                                : 0}
                              %)
                            </span>
                          </Text>
                        </div>
                        <Progress
                          percent={
                            trapStats.totalRecords > 0
                              ? Math.round(
                                  (count / trapStats.totalRecords) * 100,
                                )
                              : 0
                          }
                          strokeColor={
                            key === "MBA" ? "#1890ff" : "#8c8c8c"
                          }
                          showInfo={false}
                          size="small"
                        />
                      </div>
                    ),
                  )}
                </div>
              </Card>
            </Col>
          </Row>
        </Col>

        {/* RIGHT COLUMN — Trap Map (sticky) */}
        <Col xs={24} lg={10}>
          <div
            style={{
              position: "sticky",
              top: 80,
              height: TRAP_CARD_H * 2 + 16,
            }}
          >
            <Card
              size="small"
              title={
                <>
                  <GlobalOutlined /> Trash Trap Location Map{" "}
                  <Tag bordered={false} color="cyan">
                    {filteredTrapMapPts.length} plotted
                  </Tag>
                  {filteredTrapMapPts.length !== trapMapPts.length && (
                    <Tag bordered={false} color="default">
                      of {trapMapPts.length}
                    </Tag>
                  )}
                </>
              }
              style={{ borderRadius: 10, height: "100%" }}
              loading={loading}
              extra={
                <Space size={4}>
                  <Tooltip title="Street">
                    <Button
                      size="small"
                      type={
                        trapTileKey === "street" ? "primary" : "default"
                      }
                      icon={<GlobalOutlined />}
                      onClick={() => setTrapTileKey("street")}
                    />
                  </Tooltip>
                  <Tooltip title="Satellite">
                    <Button
                      size="small"
                      type={
                        trapTileKey === "satellite" ? "primary" : "default"
                      }
                      icon={<EnvironmentOutlined />}
                      onClick={() => setTrapTileKey("satellite")}
                    />
                  </Tooltip>
                  <Tooltip title="Terrain">
                    <Button
                      size="small"
                      type={
                        trapTileKey === "terrain" ? "primary" : "default"
                      }
                      icon={<FundOutlined />}
                      onClick={() => setTrapTileKey("terrain")}
                    />
                  </Tooltip>
                  <Tooltip title="Dark">
                    <Button
                      size="small"
                      type={trapTileKey === "dark" ? "primary" : "default"}
                      icon={<AppstoreOutlined />}
                      onClick={() => setTrapTileKey("dark")}
                    />
                  </Tooltip>
                </Space>
              }
              styles={{
                body: { padding: 0, height: "calc(100% - 100px)" },
              }}
            >
              {/* Filter bar */}
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  padding: "8px 10px",
                  background: isDark ? "#1f1f1f" : "#fafafa",
                  borderBottom: isDark ? "1px solid #303030" : "1px solid #f0f0f0",
                  flexWrap: "wrap",
                }}
              >
                <Select
                  size="small"
                  allowClear
                  placeholder="Province"
                  value={trapFilterProvince}
                  onChange={setTrapFilterProvince}
                  options={trapProvinceOptions}
                  style={{ minWidth: 120, flex: 1 }}
                />
                <Select
                  size="small"
                  allowClear
                  placeholder="Status"
                  value={trapFilterStatus}
                  onChange={setTrapFilterStatus}
                  options={[
                    { label: "✓ Operational", value: "Operational" },
                    {
                      label: "✕ Non-Operational",
                      value: "Non-Operational",
                    },
                  ]}
                  style={{ minWidth: 130, flex: 1 }}
                />
                {(trapFilterProvince || trapFilterStatus) && (
                  <Button
                    size="small"
                    type="link"
                    danger
                    onClick={() => {
                      setTrapFilterProvince(null);
                      setTrapFilterStatus(null);
                    }}
                  >
                    Clear
                  </Button>
                )}
                {/* Legend */}
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    marginLeft: "auto",
                    fontSize: 11,
                    color: "#999",
                  }}
                >
                  <span>
                    <span
                      style={{
                        display: "inline-block",
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: "#52c41a",
                        marginRight: 3,
                        verticalAlign: "middle",
                      }}
                    />
                    Operational
                  </span>
                  <span>
                    <span
                      style={{
                        display: "inline-block",
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: "#ff4d4f",
                        marginRight: 3,
                        verticalAlign: "middle",
                      }}
                    />
                    Non-Op
                  </span>
                  <span>
                    <span
                      style={{
                        display: "inline-block",
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: "#8c8c8c",
                        marginRight: 3,
                        verticalAlign: "middle",
                      }}
                    />
                    Not Yet Monitored
                  </span>
                </div>
              </div>
              {filteredTrapMapPts.length > 0 ? (
                <MapContainer
                  center={[15.0, 120.7]}
                  zoom={8}
                  style={{
                    height: "100%",
                    width: "100%",
                    borderRadius: "0 0 10px 10px",
                  }}
                  scrollWheelZoom={true}
                  zoomControl={false}
                >
                  <TileLayer
                    key={trapTileKey}
                    attribution={trapTile.attr}
                    url={trapTile.url}
                  />
                  <FitBounds points={filteredTrapMapPts} />
                  <ProvinceBoundary
                    key={trapFilterProvince || "__trap_none__"}
                    province={trapFilterProvince}
                  />
                  {filteredTrapMapPts.map((pt, idx) => (
                    <Marker
                      key={pt.record._id || idx}
                      position={[pt.lat, pt.lng]}
                      icon={trapStatusIcon(pt.record.statusOfTrashTraps)}
                    >
                      <Popup maxWidth={300} minWidth={240}>
                        <div
                          className="popup-light"
                          style={{
                            fontSize: 12,
                            lineHeight: 1.7,
                            padding: 2,
                          }}
                        >
                          <div
                            style={{
                              fontWeight: 700,
                              fontSize: 14,
                              marginBottom: 2,
                            }}
                          >
                            {pt.record.municipality}
                          </div>
                          <div
                            style={{
                              display: "flex",
                              gap: 4,
                              flexWrap: "wrap",
                              marginBottom: 6,
                            }}
                          >
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 3,
                                background: isDark ? "rgba(19,194,194,0.15)" : "#e6fffb",
                                color: "#13c2c2",
                                borderRadius: 4,
                                padding: "1px 6px",
                                fontSize: 11,
                              }}
                            >
                              <EnvironmentOutlined /> {pt.record.province}
                            </span>
                            {pt.record.barangay && (
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 3,
                                  background: isDark ? "#303030" : "#f0f0f0",
                                  color: "#595959",
                                  borderRadius: 4,
                                  padding: "1px 6px",
                                  fontSize: 11,
                                }}
                              >
                                {pt.record.barangay}
                              </span>
                            )}
                            {pt.record.manilaBayArea && (
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 3,
                                  background:
                                    pt.record.manilaBayArea === "MBA"
                                      ? (isDark ? "rgba(22,119,255,0.15)" : "#e6f7ff")
                                      : (isDark ? "#303030" : "#f5f5f5"),
                                  color:
                                    pt.record.manilaBayArea === "MBA"
                                      ? "#1890ff"
                                      : "#8c8c8c",
                                  borderRadius: 4,
                                  padding: "1px 6px",
                                  fontSize: 11,
                                }}
                              >
                                <GlobalOutlined /> {pt.record.manilaBayArea}
                              </span>
                            )}
                          </div>
                          <hr
                            style={{
                              margin: "4px 0 6px",
                              border: "none",
                              borderTop: isDark ? "1px solid #303030" : "1px solid #f0f0f0",
                            }}
                          />
                          <div
                            style={{
                              display: "flex",
                              gap: 4,
                              flexWrap: "wrap",
                              marginBottom: 6,
                            }}
                          >
                            {(() => {
                              const s = pt.record.statusOfTrashTraps;
                              const isOp =
                                /operational/i.test(s) && !/non/i.test(s);
                              const isNon = /non/i.test(s);
                              return (
                                <span
                                  className={`status-badge ${isOp ? "status-badge-compliant" : isNon ? "status-badge-noncompliant" : "status-badge-pending"}`}
                                >
                                  <SafetyCertificateOutlined />{" "}
                                  {isOp
                                    ? "Operational"
                                    : isNon
                                      ? "Non-Operational"
                                      : "Not Yet Monitored"}
                                </span>
                              );
                            })()}
                          </div>
                          <div
                            style={{
                              background: isDark ? "#1f1f1f" : "#fafafa",
                              borderRadius: 6,
                              padding: "6px 8px",
                              marginBottom: 6,
                            }}
                          >
                            {pt.record.noOfTrashTrapsHDPE != null && (
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  marginBottom: 3,
                                }}
                              >
                                <span style={{ color: "#595959" }}>
                                  <ToolOutlined
                                    style={{ color: "#1890ff" }}
                                  />{" "}
                                  HDPE Floaters
                                </span>
                                <strong>
                                  {pt.record.noOfTrashTrapsHDPE}
                                </strong>
                              </div>
                            )}
                            {pt.record.estimatedVolumeWasteHauled !=
                              null && (
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  marginBottom: 3,
                                }}
                              >
                                <span style={{ color: "#595959" }}>
                                  <BarChartOutlined
                                    style={{ color: "#722ed1" }}
                                  />{" "}
                                  Waste Hauled
                                </span>
                                <strong>
                                  {Number(
                                    pt.record.estimatedVolumeWasteHauled,
                                  ).toLocaleString()}{" "}
                                  kg
                                </strong>
                              </div>
                            )}
                            {pt.record.dateInstalled && (
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                }}
                              >
                                <span style={{ color: "#595959" }}>
                                  <CalendarOutlined
                                    style={{ color: "#13c2c2" }}
                                  />{" "}
                                  Installed
                                </span>
                                <strong>
                                  {dayjs(pt.record.dateInstalled).format(
                                    "MMM DD, YYYY",
                                  )}
                                </strong>
                              </div>
                            )}
                          </div>
                          {pt.record.focalPerson && (
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 5,
                                marginBottom: 2,
                              }}
                            >
                              <UserOutlined style={{ color: "#13c2c2" }} />{" "}
                              <span style={{ color: "#595959" }}>
                                Focal:
                              </span>{" "}
                              <strong>{pt.record.focalPerson}</strong>
                            </div>
                          )}
                          {pt.record.enmoAssigned && (
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 5,
                              }}
                            >
                              <TeamOutlined style={{ color: "#52c41a" }} />{" "}
                              <span style={{ color: "#595959" }}>
                                ENMO:
                              </span>{" "}
                              {pt.record.enmoAssigned}
                            </div>
                          )}
                          <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 4, color: "#8c8c8c", fontSize: 11 }}>
                            <EnvironmentOutlined style={{ color: "#faad14" }} />
                            <span>{pt.lat.toFixed(3)}, {pt.lng.toFixed(3)}</span>
                          </div>
                          {/* Quick Actions */}
                          <div
                            style={{
                              display: "flex",
                              gap: 4,
                              marginTop: 8,
                              paddingTop: 6,
                              borderTop: isDark ? "1px solid #303030" : "1px solid #f0f0f0",
                            }}
                          >
                            <button
                              onClick={() => {
                                api
                                  .get(`/trash-traps/${pt.record._id}`)
                                  .then(({ data }) => setTrapViewRecord(data))
                                  .catch(() => setTrapViewRecord(pt.record));
                              }}
                              className="popup-action-btn"
                              title="View Full Record"
                            >
                              <EyeOutlined /> View
                            </button>
                            <button
                              onClick={() => {
                                const txt = `${pt.record.municipality}, ${pt.record.province} (${pt.lat}, ${pt.lng})`;
                                navigator.clipboard.writeText(txt);
                              }}
                              className="popup-action-btn"
                              title="Copy Location"
                            >
                              <CopyOutlined /> Copy
                            </button>
                          </div>
                        </div>
                      </Popup>
                    </Marker>
                  ))}
                </MapContainer>
              ) : (
                <div
                  style={{
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text type="secondary">No coordinate data available</Text>
                </div>
              )}
            </Card>
          </div>
        </Col>
      </Row>
    </>
  );
}

/** Append the TrashTrapsTab tab to `tabItems`, preserving the original guard and order. */
export function pushTrashTrapsTab(tabItems, props) {
  if (!(props.trapStats && props.trapStats.totalRecords > 0)) return;
  tabItems.push({
    key: "trash-traps",
    label: (
      <span>
        <DeleteOutlined /> Trash Traps
      </span>
    ),
    children: <TrashTrapsTab {...props} />,
  });
}
