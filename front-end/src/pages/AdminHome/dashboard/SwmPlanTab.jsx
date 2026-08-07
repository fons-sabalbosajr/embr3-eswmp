import { useState, useMemo } from "react";
import api from "../../../api";
import { FitBounds, ProvinceBoundary } from "../MapPrimitives";
import { getPlanStatus, planStatusIcon, TILE_LAYERS } from "../constants";
import { AlertOutlined, AppstoreOutlined, AuditOutlined, BarChartOutlined, ClockCircleOutlined, ContainerOutlined, CopyOutlined, DeleteOutlined, EnvironmentOutlined, ExperimentOutlined, EyeOutlined, FileDoneOutlined, FundOutlined, FundProjectionScreenOutlined, GlobalOutlined, LinkOutlined, PieChartOutlined, RiseOutlined, SafetyCertificateOutlined, TeamOutlined, UserOutlined } from "@ant-design/icons";
import { Button, Card, Col, Progress, Row, Select, Space, Statistic, Tag, Tooltip, Typography } from "antd";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";

const { Text } = Typography;

// 10-Year SWM Plan dashboard tab.
//
// Owns its own map state (tile layer, province/status filters) and derived map
// points. `setMapViewRecord` stays a prop because the record detail modal it
// opens is rendered by the container, outside the tab set.
export default function SwmPlanTab({ swmStats, loading, isDark, setMapViewRecord }) {
  const [tileKey, setTileKey] = useState("street");
  const tile = TILE_LAYERS[tileKey];
  const [mapFilterProvince, setMapFilterProvince] = useState(null);
  const [mapFilterStatus, setMapFilterStatus] = useState(null);

  const mapPts = useMemo(
    () =>
      ((swmStats && swmStats.mapData) || [])
        .filter(
          (r) =>
            r.latitude &&
            r.longitude &&
            !isNaN(r.latitude) &&
            !isNaN(r.longitude),
        )
        .map((r) => ({
          lat: Number(r.latitude),
          lng: Number(r.longitude),
          record: r,
        })),
    [swmStats && swmStats.mapData],
  );

  const filteredMapPts = useMemo(() => {
    let pts = mapPts;
    if (mapFilterProvince)
      pts = pts.filter((p) => p.record.province === mapFilterProvince);
    if (mapFilterStatus)
      pts = pts.filter(
        (p) => getPlanStatus(p.record.forRenewal) === mapFilterStatus,
      );
    return pts;
  }, [mapPts, mapFilterProvince, mapFilterStatus]);

  const provinceOptions = useMemo(() => {
    const set = new Set(mapPts.map((p) => p.record.province).filter(Boolean));
    return [...set].sort().map((v) => ({ label: v, value: v }));
  }, [mapPts]);

  const provList = swmStats.byProvinceList || [];
  const maxProvCount = Math.max(...provList.map((p) => p.count), 1);
  const divProv = swmStats.diversionByProvince || [];
  const wc = swmStats.wasteComposition || {};

  const CARD_H = 280;

  return (
    <>
      {/* Row 1: Full-width stat tiles */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={12} md={6}>
          <Card
            hoverable
            style={{ borderRadius: 10, height: 110 }}
            loading={loading}
          >
            <Statistic
              title="Total LGUs"
              value={swmStats.totalRecords}
              prefix={<EnvironmentOutlined style={{ color: isDark ? "#a0b4c8" : "#1a3353" }} />}
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
              title="Compliant"
              value={swmStats.byCompliance?.Compliant || 0}
              prefix={
                <SafetyCertificateOutlined style={{ color: "#52c41a" }} />
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
              title="Non-Compliant"
              value={swmStats.byCompliance?.["Non-Compliant"] || 0}
              styles={{ content: { color: "#ff4d4f" } }}
              prefix={<ClockCircleOutlined />}
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
              title="Avg. Diversion"
              value={((wc.avgDiversionRate || 0) * 100).toFixed(1)}
              suffix="%"
              prefix={<RiseOutlined style={{ color: "#1890ff" }} />}
            />
          </Card>
        </Col>
      </Row>

      {/* Two-column layout: cards left, map right */}
      <Row gutter={[16, 16]}>
        {/* LEFT COLUMN — Stats cards */}
        <Col xs={24} lg={14}>
          <Row gutter={[16, 16]}>
            {/* Compliance Status */}
            <Col xs={24} sm={12}>
              <Card
                title={
                  <>
                    <PieChartOutlined /> Compliance Status
                  </>
                }
                style={{ borderRadius: 10, height: CARD_H }}
                loading={loading}
                styles={{ body: { overflow: "auto", height: CARD_H - 57 } }}
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
                      label: "Compliant",
                      count: swmStats.byCompliance?.Compliant || 0,
                      color: "#52c41a",
                    },
                    {
                      label: "Non-Compliant",
                      count: swmStats.byCompliance?.["Non-Compliant"] || 0,
                      color: "#ff4d4f",
                    },
                    {
                      label: "Pending",
                      count: swmStats.byCompliance?.Pending || 0,
                      color: "#faad14",
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
                        <Text
                          style={{ color: isDark ? "#ccc" : undefined }}
                        >
                          {s.label}
                        </Text>
                        <Text
                          strong
                          style={{ color: isDark ? "#fff" : undefined }}
                        >
                          {s.count}{" "}
                          {swmStats.totalRecords > 0 && (
                            <span
                              style={{ color: "#999", fontWeight: 400 }}
                            >
                              (
                              {Math.round(
                                (s.count / swmStats.totalRecords) * 100,
                              )}
                              %)
                            </span>
                          )}
                        </Text>
                      </div>
                      <Progress
                        percent={
                          swmStats.totalRecords > 0
                            ? Math.round(
                                (s.count / swmStats.totalRecords) * 100,
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

            {/* Waste Composition */}
            <Col xs={24} sm={12}>
              <Card
                title={
                  <>
                    <BarChartOutlined /> Waste Composition
                  </>
                }
                style={{ borderRadius: 10, height: CARD_H }}
                loading={loading}
                styles={{ body: { overflow: "auto", height: CARD_H - 57 } }}
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
                      label: "Biodegradable",
                      pct: (wc.avgBiodegradable || 0) * 100,
                      color: "#52c41a",
                    },
                    {
                      label: "Recyclable",
                      pct: (wc.avgRecyclable || 0) * 100,
                      color: "#1890ff",
                    },
                    {
                      label: "Residual",
                      pct: (wc.avgResidual || 0) * 100,
                      color: "#ff4d4f",
                    },
                    {
                      label: "Special",
                      pct: (wc.avgSpecial || 0) * 100,
                      color: "#722ed1",
                    },
                  ].map((w) => (
                    <div key={w.label}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          marginBottom: 4,
                        }}
                      >
                        <Text
                          style={{ color: isDark ? "#ccc" : undefined }}
                        >
                          {w.label}
                        </Text>
                        <Text
                          strong
                          style={{ color: isDark ? "#fff" : undefined }}
                        >
                          {w.pct.toFixed(1)}%
                        </Text>
                      </div>
                      <Progress
                        percent={Math.round(w.pct)}
                        strokeColor={w.color}
                        showInfo={false}
                        size="small"
                      />
                    </div>
                  ))}
                </div>
              </Card>
            </Col>

            {/* LGUs per Province */}
            <Col xs={24} sm={12}>
              <Card
                title={
                  <>
                    <BarChartOutlined /> LGUs per Province
                  </>
                }
                style={{ borderRadius: 10, height: CARD_H }}
                loading={loading}
                styles={{ body: { overflow: "auto", height: CARD_H - 57 } }}
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
                  {provList.map((p, i) => (
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
                            width: `${Math.max((p.count / maxProvCount) * 100, 4)}%`,
                            height: "100%",
                            background:
                              "linear-gradient(90deg, #1a3353 0%, #4fc3f7 100%)",
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

            {/* Diversion Rate by Province */}
            <Col xs={24} sm={12}>
              <Card
                title={
                  <>
                    <RiseOutlined /> Diversion by Province
                  </>
                }
                style={{ borderRadius: 10, height: CARD_H }}
                loading={loading}
                styles={{ body: { overflow: "auto", height: CARD_H - 57 } }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  {divProv.slice(0, 7).map((d) => (
                    <div key={d._id}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          marginBottom: 2,
                        }}
                      >
                        <Text
                          style={{
                            color: isDark ? "#ccc" : undefined,
                            fontSize: 12,
                          }}
                        >
                          {d._id}
                        </Text>
                        <Text
                          strong
                          style={{
                            color: isDark ? "#fff" : undefined,
                            fontSize: 12,
                          }}
                        >
                          {(d.avgDiversion * 100).toFixed(1)}%{" "}
                          <span
                            style={{
                              color: "#999",
                              fontWeight: 400,
                              fontSize: 10,
                            }}
                          >
                            ({d.count})
                          </span>
                        </Text>
                      </div>
                      <Progress
                        percent={Math.round(d.avgDiversion * 100)}
                        strokeColor={
                          d.avgDiversion * 100 >= 50 ? "#52c41a" : "#faad14"
                        }
                        showInfo={false}
                        size="small"
                      />
                    </div>
                  ))}
                </div>
              </Card>
            </Col>

            {/* Renewal Status */}
            <Col xs={24} sm={12}>
              <Card
                title="Renewal Status"
                style={{ borderRadius: 10, height: CARD_H }}
                loading={loading}
                styles={{ body: { overflow: "auto", height: CARD_H - 57 } }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  {Object.entries(swmStats.renewalStatus || {}).map(
                    ([key, count]) => (
                      <div key={key}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            marginBottom: 4,
                          }}
                        >
                          <Text
                            style={{ color: isDark ? "#ccc" : undefined }}
                          >
                            {key}
                          </Text>
                          <Text
                            strong
                            style={{ color: isDark ? "#fff" : undefined }}
                          >
                            {count}
                          </Text>
                        </div>
                        <Progress
                          percent={
                            swmStats.totalRecords > 0
                              ? Math.round(
                                  (count / swmStats.totalRecords) * 100,
                                )
                              : 0
                          }
                          strokeColor={
                            key === "Approved"
                              ? "#52c41a"
                              : key === "For Renewal"
                                ? "#faad14"
                                : "#1890ff"
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

            {/* Manila Bay Area */}
            <Col xs={24} sm={12}>
              <Card
                title="Manila Bay Area"
                style={{ borderRadius: 10, height: CARD_H }}
                loading={loading}
                styles={{ body: { overflow: "auto", height: CARD_H - 57 } }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  {Object.entries(swmStats.byManilaBayArea || {}).map(
                    ([key, count]) => (
                      <div key={key}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            marginBottom: 4,
                          }}
                        >
                          <Text
                            style={{ color: isDark ? "#ccc" : undefined }}
                          >
                            {key || "Unspecified"}
                          </Text>
                          <Text
                            strong
                            style={{ color: isDark ? "#fff" : undefined }}
                          >
                            {count}
                          </Text>
                        </div>
                        <Progress
                          percent={
                            swmStats.totalRecords > 0
                              ? Math.round(
                                  (count / swmStats.totalRecords) * 100,
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

        {/* RIGHT COLUMN — Map (sticky) */}
        <Col xs={24} lg={10}>
          <div
            style={{
              position: "sticky",
              top: 80,
              height: CARD_H * 3 + 32,
            }}
          >
            <Card
              size="small"
              title={
                <>
                  <GlobalOutlined /> LGU Location Map{" "}
                  <Tag bordered={false} color="blue">
                    {filteredMapPts.length} plotted
                  </Tag>
                  {filteredMapPts.length !== mapPts.length && (
                    <Tag bordered={false} color="default">
                      of {mapPts.length}
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
                      type={tileKey === "street" ? "primary" : "default"}
                      icon={<GlobalOutlined />}
                      onClick={() => setTileKey("street")}
                    />
                  </Tooltip>
                  <Tooltip title="Satellite">
                    <Button
                      size="small"
                      type={tileKey === "satellite" ? "primary" : "default"}
                      icon={<EnvironmentOutlined />}
                      onClick={() => setTileKey("satellite")}
                    />
                  </Tooltip>
                  <Tooltip title="Terrain">
                    <Button
                      size="small"
                      type={tileKey === "terrain" ? "primary" : "default"}
                      icon={<FundOutlined />}
                      onClick={() => setTileKey("terrain")}
                    />
                  </Tooltip>
                  <Tooltip title="Dark">
                    <Button
                      size="small"
                      type={tileKey === "dark" ? "primary" : "default"}
                      icon={<AppstoreOutlined />}
                      onClick={() => setTileKey("dark")}
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
                  value={mapFilterProvince}
                  onChange={setMapFilterProvince}
                  options={provinceOptions}
                  style={{ minWidth: 120, flex: 1 }}
                />
                <Select
                  size="small"
                  allowClear
                  placeholder="Plan Status"
                  value={mapFilterStatus}
                  onChange={setMapFilterStatus}
                  options={[
                    { label: "✓ Approved", value: "Approved" },
                    { label: "▲ For Renewal", value: "For Renewal" },
                    { label: "● Other", value: "Other" },
                  ]}
                  style={{ minWidth: 110, flex: 1 }}
                />
                {(mapFilterProvince || mapFilterStatus) && (
                  <Button
                    size="small"
                    type="link"
                    danger
                    onClick={() => {
                      setMapFilterProvince(null);
                      setMapFilterStatus(null);
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
                    Approved
                  </span>
                  <span>
                    <span
                      style={{
                        display: "inline-block",
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: "#faad14",
                        marginRight: 3,
                        verticalAlign: "middle",
                      }}
                    />
                    For Renewal
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
                    Other
                  </span>
                </div>
              </div>
              {filteredMapPts.length > 0 ? (
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
                    key={tileKey}
                    attribution={tile.attr}
                    url={tile.url}
                  />
                  <FitBounds points={filteredMapPts} />
                  <ProvinceBoundary
                    key={mapFilterProvince || "__none__"}
                    province={mapFilterProvince}
                  />
                  {filteredMapPts.map((pt, idx) => (
                    <Marker
                      key={pt.record._id || idx}
                      position={[pt.lat, pt.lng]}
                      icon={planStatusIcon(pt.record.forRenewal)}
                    >
                      <Popup maxWidth={320} minWidth={260}>
                        <div
                          className="popup-light"
                          style={{
                            fontSize: 12,
                            lineHeight: 1.7,
                            padding: 2,
                          }}
                        >
                          {/* Header */}
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
                                background: isDark ? "rgba(22,119,255,0.15)" : "#e6f7ff",
                                color: "#1890ff",
                                borderRadius: 4,
                                padding: "1px 6px",
                                fontSize: 11,
                              }}
                            >
                              <EnvironmentOutlined /> {pt.record.province}
                            </span>
                            {pt.record.congressionalDistrict && (
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
                                {pt.record.congressionalDistrict}
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

                          {/* Compliance & Renewal */}
                          <div
                            style={{
                              display: "flex",
                              gap: 4,
                              flexWrap: "wrap",
                              marginBottom: 6,
                            }}
                          >
                            {(() => {
                              const r =
                                pt.record.remarksAndRecommendation || "";
                              const isC =
                                /compliant/i.test(r) && !/non/i.test(r);
                              const isNC =
                                /non/i.test(r) && /compliant/i.test(r);
                              return (
                                <span
                                  className={`status-badge ${isC ? "status-badge-compliant" : isNC ? "status-badge-noncompliant" : "status-badge-pending"}`}
                                >
                                  <SafetyCertificateOutlined />{" "}
                                  {isC
                                    ? "Compliant"
                                    : isNC
                                      ? "Non-Compliant"
                                      : "Pending"}
                                </span>
                              );
                            })()}
                            {pt.record.forRenewal && (
                              <span
                                className={`status-badge ${/approved/i.test(pt.record.forRenewal) ? "status-badge-approved" : /renewal/i.test(pt.record.forRenewal) ? "status-badge-renewal" : "status-badge-other"}`}
                              >
                                <AuditOutlined /> {pt.record.forRenewal}
                              </span>
                            )}
                          </div>

                          {/* Plan Info */}
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 3,
                              marginBottom: 6,
                            }}
                          >
                            {pt.record.typeOfSWMPlan && (
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 5,
                                }}
                              >
                                <FileDoneOutlined
                                  style={{ color: "#1890ff" }}
                                />{" "}
                                <span style={{ color: "#595959" }}>
                                  Plan:
                                </span>{" "}
                                <strong>{pt.record.typeOfSWMPlan}</strong>
                              </div>
                            )}
                            {pt.record.periodCovered && (
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 5,
                                }}
                              >
                                <ClockCircleOutlined
                                  style={{ color: "#722ed1" }}
                                />{" "}
                                <span style={{ color: "#595959" }}>
                                  Period:
                                </span>{" "}
                                {pt.record.periodCovered}
                              </div>
                            )}
                            {pt.record.yearApproved && (
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 5,
                                }}
                              >
                                <AuditOutlined
                                  style={{ color: "#52c41a" }}
                                />{" "}
                                <span style={{ color: "#595959" }}>
                                  Approved:
                                </span>{" "}
                                {pt.record.yearApproved}
                              </div>
                            )}
                          </div>

                          {/* Environmental Data */}
                          <div
                            style={{
                              background: isDark ? "#1f1f1f" : "#fafafa",
                              borderRadius: 6,
                              padding: "6px 8px",
                              marginBottom: 6,
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                marginBottom: 3,
                              }}
                            >
                              <span style={{ color: "#595959" }}>
                                <BarChartOutlined
                                  style={{ color: "#1890ff" }}
                                />{" "}
                                Diversion Rate
                              </span>
                              <strong
                                style={{
                                  color:
                                    pt.record.wasteDiversionRate >= 0.25
                                      ? "#52c41a"
                                      : "#ff4d4f",
                                }}
                              >
                                {pt.record.wasteDiversionRate
                                  ? `${(pt.record.wasteDiversionRate * 100).toFixed(1)}%`
                                  : "—"}
                              </strong>
                            </div>
                            {pt.record.totalWasteGeneration != null && (
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  marginBottom: 3,
                                }}
                              >
                                <span style={{ color: "#595959" }}>
                                  <DeleteOutlined
                                    style={{ color: "#ff4d4f" }}
                                  />{" "}
                                  Waste Gen.
                                </span>
                                <strong>
                                  {pt.record.totalWasteGeneration.toLocaleString()}{" "}
                                  tons
                                </strong>
                              </div>
                            )}
                            {pt.record.pcg != null && (
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                }}
                              >
                                <span style={{ color: "#595959" }}>
                                  <ExperimentOutlined
                                    style={{ color: "#722ed1" }}
                                  />{" "}
                                  PCG
                                </span>
                                <strong>{pt.record.pcg}</strong>
                              </div>
                            )}
                          </div>

                          {/* Waste Composition mini bars */}
                          {(pt.record.biodegradablePercent ||
                            pt.record.recyclablePercent ||
                            pt.record.residualPercent ||
                            pt.record.specialPercent) && (
                            <div style={{ marginBottom: 6 }}>
                              <div
                                style={{
                                  fontSize: 11,
                                  color: "#595959",
                                  marginBottom: 2,
                                  fontWeight: 600,
                                }}
                              >
                                Waste Composition
                              </div>
                              <div
                                style={{
                                  display: "flex",
                                  gap: 2,
                                  height: 8,
                                  borderRadius: 4,
                                  overflow: "hidden",
                                }}
                              >
                                {pt.record.biodegradablePercent > 0 && (
                                  <div
                                    title={`Biodegradable ${(pt.record.biodegradablePercent * 100).toFixed(1)}%`}
                                    style={{
                                      flex: pt.record.biodegradablePercent,
                                      background: "#52c41a",
                                    }}
                                  />
                                )}
                                {pt.record.recyclablePercent > 0 && (
                                  <div
                                    title={`Recyclable ${(pt.record.recyclablePercent * 100).toFixed(1)}%`}
                                    style={{
                                      flex: pt.record.recyclablePercent,
                                      background: "#1890ff",
                                    }}
                                  />
                                )}
                                {pt.record.residualPercent > 0 && (
                                  <div
                                    title={`Residual ${(pt.record.residualPercent * 100).toFixed(1)}%`}
                                    style={{
                                      flex: pt.record.residualPercent,
                                      background: "#ff4d4f",
                                    }}
                                  />
                                )}
                                {pt.record.specialPercent > 0 && (
                                  <div
                                    title={`Special ${(pt.record.specialPercent * 100).toFixed(1)}%`}
                                    style={{
                                      flex: pt.record.specialPercent,
                                      background: "#722ed1",
                                    }}
                                  />
                                )}
                              </div>
                              <div
                                style={{
                                  display: "flex",
                                  gap: 8,
                                  fontSize: 10,
                                  color: "#999",
                                  marginTop: 2,
                                  flexWrap: "wrap",
                                }}
                              >
                                <span>
                                  <span
                                    style={{
                                      display: "inline-block",
                                      width: 6,
                                      height: 6,
                                      borderRadius: 1,
                                      background: "#52c41a",
                                      marginRight: 2,
                                    }}
                                  />
                                  Bio{" "}
                                  {(
                                    pt.record.biodegradablePercent * 100
                                  ).toFixed(0)}
                                  %
                                </span>
                                <span>
                                  <span
                                    style={{
                                      display: "inline-block",
                                      width: 6,
                                      height: 6,
                                      borderRadius: 1,
                                      background: "#1890ff",
                                      marginRight: 2,
                                    }}
                                  />
                                  Rec{" "}
                                  {(
                                    pt.record.recyclablePercent * 100
                                  ).toFixed(0)}
                                  %
                                </span>
                                <span>
                                  <span
                                    style={{
                                      display: "inline-block",
                                      width: 6,
                                      height: 6,
                                      borderRadius: 1,
                                      background: "#ff4d4f",
                                      marginRight: 2,
                                    }}
                                  />
                                  Res{" "}
                                  {(
                                    pt.record.residualPercent * 100
                                  ).toFixed(0)}
                                  %
                                </span>
                                <span>
                                  <span
                                    style={{
                                      display: "inline-block",
                                      width: 6,
                                      height: 6,
                                      borderRadius: 1,
                                      background: "#722ed1",
                                      marginRight: 2,
                                    }}
                                  />
                                  Spc{" "}
                                  {(pt.record.specialPercent * 100).toFixed(
                                    0,
                                  )}
                                  %
                                </span>
                              </div>
                            </div>
                          )}

                          {/* Disposal */}
                          {pt.record.lguFinalDisposal && (
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 5,
                                marginBottom: 4,
                              }}
                            >
                              <ContainerOutlined
                                style={{ color: "#fa8c16" }}
                              />{" "}
                              <span style={{ color: "#595959" }}>
                                Disposal:
                              </span>{" "}
                              {pt.record.lguFinalDisposal}
                            </div>
                          )}

                          {/* Personnel */}
                          <hr
                            style={{
                              margin: "4px 0 5px",
                              border: "none",
                              borderTop: isDark ? "1px solid #303030" : "1px solid #f0f0f0",
                            }}
                          />
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 2,
                            }}
                          >
                            {pt.record.focalPerson && (
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 5,
                                }}
                              >
                                <UserOutlined
                                  style={{ color: "#1890ff" }}
                                />{" "}
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
                                <TeamOutlined
                                  style={{ color: "#52c41a" }}
                                />{" "}
                                <span style={{ color: "#595959" }}>
                                  ENMO:
                                </span>{" "}
                                {pt.record.enmoAssigned}
                              </div>
                            )}
                          </div>

                          {/* Remarks */}
                          {pt.record.remarksAndRecommendation && (
                            <div
                              style={{
                                marginTop: 6,
                                background: isDark ? "rgba(250,219,20,0.15)" : "#fffbe6",
                                borderRadius: 4,
                                padding: "4px 6px",
                                fontSize: 11,
                                color: "#ad8b00",
                              }}
                            >
                              <AlertOutlined />{" "}
                              {pt.record.remarksAndRecommendation}
                            </div>
                          )}

                          {/* Signed Document */}
                          {pt.record.signedDocument && (
                            <a
                              href={pt.record.signedDocument}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 5,
                                marginTop: 6,
                                padding: "4px 8px",
                                background: isDark ? "rgba(22,119,255,0.15)" : "#e6f7ff",
                                borderRadius: 4,
                                fontSize: 11,
                                color: "#1890ff",
                                textDecoration: "none",
                                fontWeight: 600,
                              }}
                            >
                              <LinkOutlined /> View Signed Document
                            </a>
                          )}

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
                                  .get(`/ten-year-swm/${pt.record._id}`)
                                  .then(({ data }) =>
                                    setMapViewRecord(data),
                                  )
                                  .catch(() => setMapViewRecord(pt.record));
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

/** Append the SwmPlanTab tab to `tabItems`, preserving the original guard and order. */
export function pushSwmPlanTab(tabItems, props) {
  if (!(props.swmStats && props.swmStats.totalRecords > 0)) return;
  tabItems.push({
    key: "swm-plan",
    label: (
      <span>
        <FundProjectionScreenOutlined /> 10-Year SWM Plan
      </span>
    ),
    children: <SwmPlanTab {...props} />,
  });
}
