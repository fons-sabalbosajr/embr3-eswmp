import { useState, useMemo } from "react";
import { FitBounds, ProvinceBoundary } from "../MapPrimitives";
import { AppstoreOutlined, BankOutlined, BarChartOutlined, CalendarOutlined, CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, EnvironmentOutlined, FundOutlined, GlobalOutlined, PieChartOutlined, RiseOutlined, SafetyCertificateOutlined, TeamOutlined, UserOutlined } from "@ant-design/icons";
import { Button, Card, Col, Progress, Row, Select, Space, Statistic, Tag, Tooltip } from "antd";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";

import { mrfStatusIcon } from "./mapMarkers";

// Funded MRF dashboard tab.
//
// Owns its own map state (tile layer, province/status filters) and derived map
// points. The marker icon is shared with the LGU-Initiated MRF tab, so it comes
// from dashboard/mapMarkers.js rather than being duplicated.
export default function FundedMrfTab({ mrfStats, loading, isDark, setActiveMenu }) {
  const [mrfTileKey, setMrfTileKey] = useState("street");
  const [mrfFilterProvince, setMrfFilterProvince] = useState(null);
  const [mrfFilterStatus, setMrfFilterStatus] = useState(null);

  const mrfMapPts = useMemo(
    () =>
      ((mrfStats && mrfStats.mapData) || [])
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
    [mrfStats && mrfStats.mapData],
  );

  const filteredMrfMapPts = useMemo(() => {
    let pts = mrfMapPts;
    if (mrfFilterProvince)
      pts = pts.filter((p) => p.record.province === mrfFilterProvince);
    if (mrfFilterStatus) {
      if (mrfFilterStatus === "Operational")
        pts = pts.filter(
          (p) =>
            /operational/i.test(p.record.statusOfMRF) &&
            !/non/i.test(p.record.statusOfMRF),
        );
      else if (mrfFilterStatus === "Non-Operational")
        pts = pts.filter((p) => /non/i.test(p.record.statusOfMRF));
      else pts = pts.filter((p) => !p.record.statusOfMRF);
    }
    return pts;
  }, [mrfMapPts, mrfFilterProvince, mrfFilterStatus]);

  const mrfProvinceOptions = useMemo(() => {
    const set = new Set(
      mrfMapPts.map((p) => p.record.province).filter(Boolean),
    );
    return [...set].sort().map((v) => ({ label: v, value: v }));
  }, [mrfMapPts]);

  const mrfProvList = mrfStats.byProvinceList || [];
  const mrfMaxProvCount = Math.max(...mrfProvList.map((p) => p.count), 1);
  const mrfDivProv = mrfStats.diversionByProvince || [];
  const fs = mrfStats.fundingStats || {};
  const opCount = mrfStats.byStatus?.Operational || 0;
  const nonOpCount = mrfStats.byStatus?.["Non-Operational"] || 0;
  const opRate =
    mrfStats.totalRecords > 0 ? (opCount / mrfStats.totalRecords) * 100 : 0;
  const avgDiv = (fs.avgDiversionRate || 0) * 100;

  const MRF_CARD_H = 280;

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
              title="Total MRFs"
              value={mrfStats.totalRecords}
              prefix={<BankOutlined style={{ color: isDark ? "#a0b4c8" : "#1a3353" }} />}
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
              value={opCount}
              prefix={<CheckCircleOutlined style={{ color: "#52c41a" }} />}
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
              value={nonOpCount}
              styles={{ content: { color: "#ff4d4f" } }}
              prefix={<CloseCircleOutlined />}
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
              title="Total Funding"
              value={fs.totalFunding || 0}
              prefix={
                <span
                  style={{
                    color: "#faad14",
                    fontWeight: 700,
                    fontSize: 18,
                  }}
                >
                  ₱
                </span>
              }
              formatter={(v) => Number(v).toLocaleString()}
            />
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
                style={{ borderRadius: 10, height: MRF_CARD_H }}
                loading={loading}
                styles={{
                  body: { overflow: "auto", height: MRF_CARD_H - 57 },
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
                      count: opCount,
                      color: "#52c41a",
                      icon: <CheckCircleOutlined />,
                    },
                    {
                      label: "Non-Operational",
                      count: nonOpCount,
                      color: "#ff4d4f",
                      icon: <CloseCircleOutlined />,
                    },
                    {
                      label: "Not Yet Monitored",
                      count: mrfStats.byStatus?.["Not Yet Monitored"] || 0,
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
                        <Text>{s.label}</Text>
                        <Text strong>
                          {s.count}{" "}
                          <span style={{ color: "#999", fontWeight: 400 }}>
                            (
                            {mrfStats.totalRecords > 0
                              ? Math.round(
                                  (s.count / mrfStats.totalRecords) * 100,
                                )
                              : 0}
                            %)
                          </span>
                        </Text>
                      </div>
                      <Progress
                        percent={
                          mrfStats.totalRecords > 0
                            ? Math.round(
                                (s.count / mrfStats.totalRecords) * 100,
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

            {/* Key Metrics — Enhanced */}
            <Col xs={24} sm={12}>
              <Card
                title={
                  <>
                    <BarChartOutlined /> Key Metrics
                  </>
                }
                style={{ borderRadius: 10, height: MRF_CARD_H }}
                loading={loading}
                styles={{
                  body: {
                    overflow: "auto",
                    height: MRF_CARD_H - 57,
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
                  {/* Operational Rate with circular progress */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "6px 10px",
                      background:
                        isDark ? "linear-gradient(135deg, rgba(82,196,26,0.12) 0%, rgba(250,219,20,0.08) 100%)" : "linear-gradient(135deg, #f6ffed 0%, #fcffe6 100%)",
                      borderRadius: 8,
                      border: isDark ? "1px solid rgba(82,196,26,0.3)" : "1px solid #d9f7be",
                    }}
                  >
                    <Progress
                      type="circle"
                      percent={Math.round(opRate)}
                      size={48}
                      strokeColor={{ "0%": "#52c41a", "100%": "#95de64" }}
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
                        style={{ fontSize: 16, color: "#389e0d" }}
                      >
                        {opRate.toFixed(1)}%
                      </Text>
                    </div>
                  </div>
                  {/* Avg Diversion Rate with circular progress */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "6px 10px",
                      background:
                        isDark ? "linear-gradient(135deg, rgba(22,119,255,0.12) 0%, rgba(47,84,235,0.08) 100%)" : "linear-gradient(135deg, #e6f7ff 0%, #f0f5ff 100%)",
                      borderRadius: 8,
                      border: isDark ? "1px solid rgba(22,119,255,0.3)" : "1px solid #bae7ff",
                    }}
                  >
                    <Progress
                      type="circle"
                      percent={Math.round(avgDiv)}
                      size={48}
                      strokeColor={{ "0%": "#1890ff", "100%": "#69c0ff" }}
                      format={(p) => (
                        <span style={{ fontSize: 12, fontWeight: 700 }}>
                          {p}%
                        </span>
                      )}
                    />
                    <div>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        Avg. Diversion Rate
                      </Text>
                      <br />
                      <Text
                        strong
                        style={{ fontSize: 16, color: "#096dd9" }}
                      >
                        {avgDiv.toFixed(1)}%
                      </Text>
                    </div>
                  </div>
                  {/* Bottom stats row */}
                  <Row gutter={8}>
                    <Col span={8}>
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
                          Brgys Served
                        </Text>
                        <Text
                          strong
                          style={{ fontSize: 16, color: "#722ed1" }}
                        >
                          {(fs.totalBrgyServed || 0).toLocaleString()}
                        </Text>
                      </div>
                    </Col>
                    <Col span={8}>
                      <div
                        style={{
                          textAlign: "center",
                          padding: "6px 4px",
                          background: isDark ? "rgba(250,173,20,0.15)" : "#fff7e6",
                          borderRadius: 6,
                          border: isDark ? "1px solid rgba(250,173,20,0.3)" : "1px solid #ffe7ba",
                        }}
                      >
                        <Text
                          type="secondary"
                          style={{ fontSize: 10, display: "block" }}
                        >
                          Avg. Funding
                        </Text>
                        <Text
                          strong
                          style={{ fontSize: 16, color: "#d48806" }}
                        >
                          ₱{Math.round(fs.avgFunding || 0).toLocaleString()}
                        </Text>
                      </div>
                    </Col>
                    <Col span={8}>
                      <div
                        style={{
                          textAlign: "center",
                          padding: "6px 4px",
                          background: isDark ? "rgba(255,77,79,0.15)" : "#fff1f0",
                          borderRadius: 6,
                          border: isDark ? "1px solid rgba(255,77,79,0.3)" : "1px solid #ffccc7",
                        }}
                      >
                        <Text
                          type="secondary"
                          style={{ fontSize: 10, display: "block" }}
                        >
                          Waste Gen.
                        </Text>
                        <Text
                          strong
                          style={{ fontSize: 16, color: "#cf1322" }}
                        >
                          {(fs.totalWasteGen || 0).toLocaleString()}
                        </Text>
                      </div>
                    </Col>
                  </Row>
                </div>
              </Card>
            </Col>

            {/* MRFs per Province */}
            <Col xs={24} sm={12}>
              <Card
                title={
                  <>
                    <BarChartOutlined /> MRFs per Province
                  </>
                }
                style={{ borderRadius: 10, height: MRF_CARD_H }}
                loading={loading}
                styles={{
                  body: { overflow: "auto", height: MRF_CARD_H - 57 },
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
                  {mrfProvList.map((p, i) => (
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
                            width: `${Math.max((p.count / mrfMaxProvCount) * 100, 4)}%`,
                            height: "100%",
                            background:
                              "linear-gradient(90deg, #2f54eb 0%, #85a5ff 100%)",
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
                style={{ borderRadius: 10, height: MRF_CARD_H }}
                loading={loading}
                styles={{
                  body: { overflow: "auto", height: MRF_CARD_H - 57 },
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  {mrfDivProv.slice(0, 7).map((d) => (
                    <div key={d._id}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          marginBottom: 2,
                        }}
                      >
                        <Text style={{ fontSize: 12 }}>{d._id}</Text>
                        <Text strong style={{ fontSize: 12 }}>
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

            {/* MRF Type Distribution */}
            <Col xs={24} sm={12}>
              <Card
                title={
                  <>
                    <BankOutlined /> MRF Type
                  </>
                }
                style={{ borderRadius: 10, height: MRF_CARD_H }}
                loading={loading}
                styles={{
                  body: { overflow: "auto", height: MRF_CARD_H - 57 },
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  {Object.entries(mrfStats.byMRFType || {}).map(
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
                          <Text strong>{count}</Text>
                        </div>
                        <Progress
                          percent={
                            mrfStats.totalRecords > 0
                              ? Math.round(
                                  (count / mrfStats.totalRecords) * 100,
                                )
                              : 0
                          }
                          strokeColor="#2f54eb"
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
                style={{ borderRadius: 10, height: MRF_CARD_H }}
                loading={loading}
                styles={{
                  body: { overflow: "auto", height: MRF_CARD_H - 57 },
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  {Object.entries(mrfStats.byManilaBayArea || {}).map(
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
                          <Text strong>{count}</Text>
                        </div>
                        <Progress
                          percent={
                            mrfStats.totalRecords > 0
                              ? Math.round(
                                  (count / mrfStats.totalRecords) * 100,
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

        {/* RIGHT COLUMN — MRF Map (sticky) */}
        <Col xs={24} lg={10}>
          <div
            style={{
              position: "sticky",
              top: 80,
              height: MRF_CARD_H * 3 + 32,
            }}
          >
            <Card
              size="small"
              title={
                <>
                  <GlobalOutlined /> MRF Location Map{" "}
                  <Tag bordered={false} color="blue">
                    {filteredMrfMapPts.length} plotted
                  </Tag>
                  {filteredMrfMapPts.length !== mrfMapPts.length && (
                    <Tag bordered={false} color="default">
                      of {mrfMapPts.length}
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
                      type={mrfTileKey === "street" ? "primary" : "default"}
                      icon={<GlobalOutlined />}
                      onClick={() => setMrfTileKey("street")}
                    />
                  </Tooltip>
                  <Tooltip title="Satellite">
                    <Button
                      size="small"
                      type={
                        mrfTileKey === "satellite" ? "primary" : "default"
                      }
                      icon={<EnvironmentOutlined />}
                      onClick={() => setMrfTileKey("satellite")}
                    />
                  </Tooltip>
                  <Tooltip title="Terrain">
                    <Button
                      size="small"
                      type={
                        mrfTileKey === "terrain" ? "primary" : "default"
                      }
                      icon={<FundOutlined />}
                      onClick={() => setMrfTileKey("terrain")}
                    />
                  </Tooltip>
                  <Tooltip title="Dark">
                    <Button
                      size="small"
                      type={mrfTileKey === "dark" ? "primary" : "default"}
                      icon={<AppstoreOutlined />}
                      onClick={() => setMrfTileKey("dark")}
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
                  value={mrfFilterProvince}
                  onChange={setMrfFilterProvince}
                  options={mrfProvinceOptions}
                  style={{ minWidth: 120, flex: 1 }}
                />
                <Select
                  size="small"
                  allowClear
                  placeholder="Status"
                  value={mrfFilterStatus}
                  onChange={setMrfFilterStatus}
                  options={[
                    { label: "✓ Operational", value: "Operational" },
                    {
                      label: "✕ Non-Operational",
                      value: "Non-Operational",
                    },
                  ]}
                  style={{ minWidth: 130, flex: 1 }}
                />
                {(mrfFilterProvince || mrfFilterStatus) && (
                  <Button
                    size="small"
                    type="link"
                    danger
                    onClick={() => {
                      setMrfFilterProvince(null);
                      setMrfFilterStatus(null);
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
              {filteredMrfMapPts.length > 0 ? (
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
                    key={mrfTileKey}
                    attribution={mrfTile.attr}
                    url={mrfTile.url}
                  />
                  <FitBounds points={filteredMrfMapPts} />
                  <ProvinceBoundary
                    key={mrfFilterProvince || "__mrf_none__"}
                    province={mrfFilterProvince}
                  />
                  {filteredMrfMapPts.map((pt, idx) => (
                    <Marker
                      key={pt.record._id || idx}
                      position={[pt.lat, pt.lng]}
                      icon={mrfStatusIcon(pt.record.statusOfMRF)}
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
                                background: isDark ? "rgba(22,119,255,0.15)" : "#e6f7ff",
                                color: "#1890ff",
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
                          {pt.record.typeOfMRF && (
                            <div style={{ marginBottom: 4 }}>
                              <BankOutlined style={{ color: "#2f54eb" }} />{" "}
                              <span style={{ color: "#595959" }}>
                                Type:
                              </span>{" "}
                              <strong>{pt.record.typeOfMRF}</strong>
                            </div>
                          )}
                          <div
                            style={{
                              display: "flex",
                              gap: 4,
                              flexWrap: "wrap",
                              marginBottom: 6,
                            }}
                          >
                            {(() => {
                              const s = pt.record.statusOfMRF;
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
                            {pt.record.amountGranted != null && (
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  marginBottom: 3,
                                }}
                              >
                                <span style={{ color: "#595959" }}>
                                  <span
                                    style={{
                                      color: "#faad14",
                                      fontWeight: 700,
                                    }}
                                  >
                                    ₱
                                  </span>{" "}
                                  Funding
                                </span>
                                <strong>
                                  ₱
                                  {pt.record.amountGranted.toLocaleString()}
                                </strong>
                              </div>
                            )}
                            {pt.record.yearGranted && (
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  marginBottom: 3,
                                }}
                              >
                                <span style={{ color: "#595959" }}>
                                  <CalendarOutlined
                                    style={{ color: "#722ed1" }}
                                  />{" "}
                                  Year
                                </span>
                                <strong>{pt.record.yearGranted}</strong>
                              </div>
                            )}
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                              }}
                            >
                              <span style={{ color: "#595959" }}>
                                <BarChartOutlined
                                  style={{ color: "#1890ff" }}
                                />{" "}
                                Diversion
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
                              <UserOutlined style={{ color: "#1890ff" }} />{" "}
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

/** Append the FundedMrfTab tab to `tabItems`, preserving the original guard and order. */
export function pushFundedMrfTab(tabItems, props) {
  if (!(props.mrfStats && props.mrfStats.totalRecords > 0)) return;
  tabItems.push({
    key: "funded-mrf",
    label: (
      <span>
        <BankOutlined /> Funded MRF
      </span>
    ),
    children: <FundedMrfTab {...props} />,
  });
}
