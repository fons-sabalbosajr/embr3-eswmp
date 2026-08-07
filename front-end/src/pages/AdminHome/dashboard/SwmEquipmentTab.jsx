import { useState, useMemo } from "react";
import { FitBounds, ProvinceBoundary } from "../MapPrimitives";
import { TILE_LAYERS } from "../constants";
import { AppstoreOutlined, BarChartOutlined, CarOutlined, EnvironmentOutlined, FileTextOutlined, FundOutlined, GlobalOutlined, SafetyCertificateOutlined, TeamOutlined, UserOutlined } from "@ant-design/icons";
import { Button, Card, Col, Progress, Row, Select, Space, Statistic, Tag, Tooltip, Typography } from "antd";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";

const { Text } = Typography;

// SWM Equipment dashboard tab.
//
// Owns its own map state (tile layer, province/type filters) and the derived
// map points, because nothing outside this tab reads them — the container used
// to hold all five tabs' map state side by side.
export default function SwmEquipmentTab({ equipStats, loading, isDark, setActiveMenu }) {
  const [equipTileKey, setEquipTileKey] = useState("street");
  const [equipFilterProvince, setEquipFilterProvince] = useState(null);
  const [equipFilterType, setEquipFilterType] = useState(null);

  const equipMapPts = useMemo(
    () =>
      ((equipStats && equipStats.mapData) || [])
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
    [equipStats && equipStats.mapData],
  );

  const filteredEquipMapPts = useMemo(() => {
    let pts = equipMapPts;
    if (equipFilterProvince)
      pts = pts.filter((p) => p.record.province === equipFilterProvince);
    if (equipFilterType)
      pts = pts.filter((p) => p.record.typeOfEquipment === equipFilterType);
    return pts;
  }, [equipMapPts, equipFilterProvince, equipFilterType]);

  const equipProvinceOptions = useMemo(() => {
    const set = new Set(
      equipMapPts.map((p) => p.record.province).filter(Boolean),
    );
    return [...set].sort().map((v) => ({ label: v, value: v }));
  }, [equipMapPts]);

  const equipTypeOptions = useMemo(() => {
    const set = new Set(
      equipMapPts.map((p) => p.record.typeOfEquipment).filter(Boolean),
    );
    return [...set].sort().map((v) => ({ label: v, value: v }));
  }, [equipMapPts]);

  const equipStatusIcon = (record) => {
    const shredderOp =
      /operational/i.test(record.statusOfBioShredder) &&
      !/non/i.test(record.statusOfBioShredder);
    const composterOp =
      /operational/i.test(record.statusOfBioComposter) &&
      !/non/i.test(record.statusOfBioComposter);
    const bg =
      shredderOp && composterOp
        ? "#52c41a"
        : shredderOp || composterOp
          ? "#faad14"
          : "#ff4d4f";
    const icon =
      shredderOp && composterOp ? "✓" : shredderOp || composterOp ? "▲" : "✕";
    return L.divIcon({
      className: "",
      html: `<div style="width:20px;height:20px;border-radius:50%;background:${bg};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:bold">${icon}</div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
      popupAnchor: [0, -12],
    });
  };

  const equipProvList = equipStats.byProvinceList || [];
  const equipMaxProv = Math.max(...equipProvList.map((p) => p.count), 1);
  const equipByType = equipStats.byType || {};
  const equipOps = equipStats.equipmentStatus || {};
  const equipTile = TILE_LAYERS[equipTileKey];

  const EQUIP_CARD_H = 280;

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
              title="Total Equipment"
              value={equipStats.totalRecords}
              prefix={<CarOutlined style={{ color: "#fa8c16" }} />}
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
              title="Soil Enhancer"
              value={equipOps.totalSoilEnhancer || 0}
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
              title="Chairs Produced"
              value={equipOps.totalChairsProduced || 0}
              prefix={
                <SafetyCertificateOutlined style={{ color: "#13c2c2" }} />
              }
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
            <Tooltip title="Click to view SWM Equipment page">
              <div
                style={{ cursor: "pointer" }}
                onClick={() => setActiveMenu("cs-swm-equip")}
              >
                <Statistic
                  title="View All Records"
                  value={equipStats.totalRecords}
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
            {/* Equipment per Province */}
            <Col xs={24} sm={12}>
              <Card
                title={
                  <>
                    <BarChartOutlined /> Equipment per Province
                  </>
                }
                style={{ borderRadius: 10, height: EQUIP_CARD_H }}
                loading={loading}
                styles={{
                  body: { overflow: "auto", height: EQUIP_CARD_H - 57 },
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
                  {equipProvList.map((p, i) => (
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
                            width: `${Math.max((p.count / equipMaxProv) * 100, 4)}%`,
                            height: "100%",
                            background:
                              "linear-gradient(90deg, #fa8c16 0%, #ffc069 100%)",
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

            {/* Equipment Type Distribution */}
            <Col xs={24} sm={12}>
              <Card
                title={
                  <>
                    <CarOutlined /> By Equipment Type
                  </>
                }
                style={{ borderRadius: 10, height: EQUIP_CARD_H }}
                loading={loading}
                styles={{
                  body: { overflow: "auto", height: EQUIP_CARD_H - 57 },
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  {Object.entries(equipByType).map(([type, count]) => (
                    <div key={type}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          marginBottom: 4,
                        }}
                      >
                        <Text>{type}</Text>
                        <Text strong>
                          {count}{" "}
                          <span style={{ color: "#999", fontWeight: 400 }}>
                            (
                            {equipStats.totalRecords > 0
                              ? Math.round(
                                  (count / equipStats.totalRecords) * 100,
                                )
                              : 0}
                            %)
                          </span>
                        </Text>
                      </div>
                      <Progress
                        percent={
                          equipStats.totalRecords > 0
                            ? Math.round(
                                (count / equipStats.totalRecords) * 100,
                              )
                            : 0
                        }
                        strokeColor="#fa8c16"
                        showInfo={false}
                        size="small"
                      />
                    </div>
                  ))}
                </div>
              </Card>
            </Col>

            {/* Manila Bay Area */}
            <Col xs={24} sm={12}>
              <Card
                title="Manila Bay Area"
                style={{ borderRadius: 10, height: EQUIP_CARD_H }}
                loading={loading}
                styles={{
                  body: { overflow: "auto", height: EQUIP_CARD_H - 57 },
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  {Object.entries(equipStats.byManilaBayArea || {}).map(
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
                              {equipStats.totalRecords > 0
                                ? Math.round(
                                    (count / equipStats.totalRecords) * 100,
                                  )
                                : 0}
                              %)
                            </span>
                          </Text>
                        </div>
                        <Progress
                          percent={
                            equipStats.totalRecords > 0
                              ? Math.round(
                                  (count / equipStats.totalRecords) * 100,
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

            {/* Key Metrics */}
            <Col xs={24} sm={12}>
              <Card
                title={
                  <>
                    <BarChartOutlined /> Key Metrics
                  </>
                }
                style={{ borderRadius: 10, height: EQUIP_CARD_H }}
                loading={loading}
                styles={{
                  body: {
                    overflow: "auto",
                    height: EQUIP_CARD_H - 57,
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
                  <Row gutter={8}>
                    <Col span={12}>
                      <div
                        style={{
                          textAlign: "center",
                          padding: "8px 4px",
                          background: isDark ? "rgba(114,46,209,0.15)" : "#f9f0ff",
                          borderRadius: 6,
                          border: isDark ? "1px solid rgba(114,46,209,0.3)" : "1px solid #efdbff",
                        }}
                      >
                        <Text
                          type="secondary"
                          style={{ fontSize: 10, display: "block" }}
                        >
                          Soil Enhancer
                        </Text>
                        <Text
                          strong
                          style={{ fontSize: 16, color: "#722ed1" }}
                        >
                          {(
                            equipOps.totalSoilEnhancer || 0
                          ).toLocaleString()}{" "}
                          kg
                        </Text>
                      </div>
                    </Col>
                    <Col span={12}>
                      <div
                        style={{
                          textAlign: "center",
                          padding: "8px 4px",
                          background: isDark ? "rgba(19,194,194,0.15)" : "#e6fffb",
                          borderRadius: 6,
                          border: "1px solid #87e8de",
                        }}
                      >
                        <Text
                          type="secondary"
                          style={{ fontSize: 10, display: "block" }}
                        >
                          Chairs Produced
                        </Text>
                        <Text
                          strong
                          style={{ fontSize: 16, color: "#13c2c2" }}
                        >
                          {(
                            equipOps.totalChairsProduced || 0
                          ).toLocaleString()}
                        </Text>
                      </div>
                    </Col>
                  </Row>
                  <div
                    style={{
                      textAlign: "center",
                      padding: "8px 4px",
                      background: isDark ? "rgba(250,173,20,0.15)" : "#fff7e6",
                      borderRadius: 6,
                      border: "1px solid #ffd591",
                    }}
                  >
                    <Text
                      type="secondary"
                      style={{ fontSize: 10, display: "block" }}
                    >
                      Total Equipment Records
                    </Text>
                    <Text strong style={{ fontSize: 16, color: "#fa8c16" }}>
                      {equipStats.totalRecords}
                    </Text>
                    <Text
                      type="secondary"
                      style={{ fontSize: 10, display: "block" }}
                    >
                      {Object.keys(equipByType).length} equipment types
                    </Text>
                  </div>
                </div>
              </Card>
            </Col>
          </Row>
        </Col>

        {/* RIGHT COLUMN — Equipment Map (sticky) */}
        <Col xs={24} lg={10}>
          <div
            style={{
              position: "sticky",
              top: 80,
              height: EQUIP_CARD_H * 3 + 32,
            }}
          >
            <Card
              size="small"
              title={
                <>
                  <GlobalOutlined /> Equipment Location Map{" "}
                  <Tag bordered={false} color="orange">
                    {filteredEquipMapPts.length} plotted
                  </Tag>
                  {filteredEquipMapPts.length !== equipMapPts.length && (
                    <Tag bordered={false} color="default">
                      of {equipMapPts.length}
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
                        equipTileKey === "street" ? "primary" : "default"
                      }
                      icon={<GlobalOutlined />}
                      onClick={() => setEquipTileKey("street")}
                    />
                  </Tooltip>
                  <Tooltip title="Satellite">
                    <Button
                      size="small"
                      type={
                        equipTileKey === "satellite" ? "primary" : "default"
                      }
                      icon={<EnvironmentOutlined />}
                      onClick={() => setEquipTileKey("satellite")}
                    />
                  </Tooltip>
                  <Tooltip title="Terrain">
                    <Button
                      size="small"
                      type={
                        equipTileKey === "terrain" ? "primary" : "default"
                      }
                      icon={<FundOutlined />}
                      onClick={() => setEquipTileKey("terrain")}
                    />
                  </Tooltip>
                  <Tooltip title="Dark">
                    <Button
                      size="small"
                      type={equipTileKey === "dark" ? "primary" : "default"}
                      icon={<AppstoreOutlined />}
                      onClick={() => setEquipTileKey("dark")}
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
                  value={equipFilterProvince}
                  onChange={setEquipFilterProvince}
                  options={equipProvinceOptions}
                  style={{ minWidth: 120, flex: 1 }}
                />
                <Select
                  size="small"
                  allowClear
                  placeholder="Equipment Type"
                  value={equipFilterType}
                  onChange={setEquipFilterType}
                  options={equipTypeOptions}
                  style={{ minWidth: 140, flex: 1 }}
                />
                {(equipFilterProvince || equipFilterType) && (
                  <Button
                    size="small"
                    type="link"
                    danger
                    onClick={() => {
                      setEquipFilterProvince(null);
                      setEquipFilterType(null);
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
                    Both Op
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
                    Partial
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
                </div>
              </div>
              {filteredEquipMapPts.length > 0 ? (
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
                    key={equipTileKey}
                    attribution={equipTile.attr}
                    url={equipTile.url}
                  />
                  <FitBounds points={filteredEquipMapPts} />
                  <ProvinceBoundary
                    key={equipFilterProvince || "__equip_none__"}
                    province={equipFilterProvince}
                  />
                  {filteredEquipMapPts.map((pt, idx) => (
                    <Marker
                      key={pt.record._id || idx}
                      position={[pt.lat, pt.lng]}
                      icon={equipStatusIcon(pt.record)}
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
                                background: isDark ? "rgba(250,173,20,0.15)" : "#fff7e6",
                                color: "#fa8c16",
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
                          {pt.record.typeOfEquipment && (
                            <div style={{ marginBottom: 4 }}>
                              <CarOutlined style={{ color: "#fa8c16" }} />{" "}
                              <span style={{ color: "#595959" }}>
                                Type:
                              </span>{" "}
                              <strong>{pt.record.typeOfEquipment}</strong>
                            </div>
                          )}
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
                                Bio-Shredder
                              </span>
                              {(() => {
                                const s = pt.record.statusOfBioShredder;
                                const isOp =
                                  /operational/i.test(s) && !/non/i.test(s);
                                return (
                                  <strong
                                    style={{
                                      color: isOp ? "#52c41a" : "#ff4d4f",
                                    }}
                                  >
                                    {isOp
                                      ? "✓ Operational"
                                      : /non/i.test(s)
                                        ? "✕ Non-Op"
                                        : "—"}
                                  </strong>
                                );
                              })()}
                            </div>
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                marginBottom: 3,
                              }}
                            >
                              <span style={{ color: "#595959" }}>
                                Bio-Composter
                              </span>
                              {(() => {
                                const s = pt.record.statusOfBioComposter;
                                const isOp =
                                  /operational/i.test(s) && !/non/i.test(s);
                                return (
                                  <strong
                                    style={{
                                      color: isOp ? "#52c41a" : "#ff4d4f",
                                    }}
                                  >
                                    {isOp
                                      ? "✓ Operational"
                                      : /non/i.test(s)
                                        ? "✕ Non-Op"
                                        : "—"}
                                  </strong>
                                );
                              })()}
                            </div>
                            {pt.record.statusOfCCTV && (
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                }}
                              >
                                <span style={{ color: "#595959" }}>
                                  CCTV
                                </span>
                                {(() => {
                                  const s = pt.record.statusOfCCTV;
                                  const isOp =
                                    /operational/i.test(s) &&
                                    !/non/i.test(s);
                                  return (
                                    <strong
                                      style={{
                                        color: isOp ? "#52c41a" : "#ff4d4f",
                                      }}
                                    >
                                      {isOp
                                        ? "✓ Operational"
                                        : /non/i.test(s)
                                          ? "✕ Non-Op"
                                          : "—"}
                                    </strong>
                                  );
                                })()}
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
                              <UserOutlined style={{ color: "#fa8c16" }} />{" "}
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

/** Append the SwmEquipmentTab tab to `tabItems`, preserving the original guard and order. */
export function pushSwmEquipmentTab(tabItems, props) {
  if (!(props.equipStats && props.equipStats.totalRecords > 0)) return;
  tabItems.push({
    key: "swm-equip",
    label: (
      <span>
        <CarOutlined /> SWM Equipment
      </span>
    ),
    children: <SwmEquipmentTab {...props} />,
  });
}
