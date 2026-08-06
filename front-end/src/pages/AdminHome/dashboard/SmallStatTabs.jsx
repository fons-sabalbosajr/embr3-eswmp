import { Row, Col, Card, Statistic, Progress, Button, Typography } from "antd";
import {
  EnvironmentOutlined,
  SafetyCertificateOutlined,
  SwapOutlined,
  FileTextOutlined,
  ToolOutlined,
  TeamOutlined,
  RiseOutlined,
  BarChartOutlined,
} from "@ant-design/icons";

const { Text } = Typography;

// The six small, read-only dashboard tabs: Open Dumpsites, Residual Containment,
// Transfer Stations, PDS (Scoping), Technical Assistance, and LGU Assist &
// Diversion. Each is a leaf that only READS its stats payload and reports a
// "view all" intent upward, so they take three props and hold no state.
//
// They are grouped in one file on purpose: each is ~35 lines and they share the
// same shape, so splitting them further would scatter code without making any of
// it easier to read.
//
// NB: four of these bodies are near-identical (tiles → By Province → By Status →
// link). Collapsing them onto one shared component is a worthwhile follow-up, but
// it is a behaviour-affecting change and deliberately NOT part of this move.

const provinceList = (byProvince = {}) =>
  Object.entries(byProvince)
    .map(([province, count]) => ({ province, count }))
    .sort((a, b) => b.count - a.count);

const maxCount = (list) => Math.max(...list.map((p) => p.count), 1);

export function OpenDumpsitesTab({ stats, loading, onViewAll }) {
  const odByStatus = stats.byStatus || {};
  const odProvList = provinceList(stats.byProvince);
  const odMaxProv = maxCount(odProvList);
  return (
    <>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={12} md={6}><Card hoverable style={{ borderRadius: 10, height: 110 }} loading={loading}><Statistic title="Total Sites" value={stats.totalRecords} prefix={<EnvironmentOutlined style={{ color: "#ff4d4f" }} />} /></Card></Col>
        {Object.entries(odByStatus).slice(0, 3).map(([k, v]) => (
          <Col key={k} xs={12} sm={12} md={6}><Card hoverable style={{ borderRadius: 10, height: 110 }} loading={loading}><Statistic title={k} value={v} valueStyle={{ color: k.toLowerCase().includes("rehab") ? "#52c41a" : k.toLowerCase().includes("open") ? "#ff4d4f" : "#faad14" }} /></Card></Col>
        ))}
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card title="By Province" size="small" style={{ borderRadius: 10 }}>
            {odProvList.map(p => (
              <div key={p.province} style={{ marginBottom: 6 }}><Text style={{ fontSize: 12 }}>{p.province}</Text><Progress percent={Math.round((p.count / odMaxProv) * 100)} format={() => p.count} size="small" strokeColor="#ff4d4f" /></div>
            ))}
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="By Status" size="small" style={{ borderRadius: 10 }}>
            {Object.entries(odByStatus).map(([k, v]) => (
              <div key={k} style={{ marginBottom: 6 }}><Text style={{ fontSize: 12 }}>{k}</Text><Progress percent={Math.round((v / stats.totalRecords) * 100)} format={() => v} size="small" /></div>
            ))}
          </Card>
        </Col>
      </Row>
      <Row style={{ marginTop: 16 }}><Col span={24}><Button type="link" onClick={onViewAll}>View All Open Dumpsites →</Button></Col></Row>
    </>
  );
}

export function ResidualContainmentTab({ stats, loading, onViewAll }) {
  const rcaByStatus = stats.byStatus || {};
  const rcaProvList = provinceList(stats.byProvince);
  const rcaMaxProv = maxCount(rcaProvList);
  return (
    <>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={12} md={6}><Card hoverable style={{ borderRadius: 10, height: 110 }} loading={loading}><Statistic title="Total Facilities" value={stats.totalRecords} prefix={<SafetyCertificateOutlined style={{ color: "#722ed1" }} />} /></Card></Col>
        {Object.entries(rcaByStatus).slice(0, 3).map(([k, v]) => (
          <Col key={k} xs={12} sm={12} md={6}><Card hoverable style={{ borderRadius: 10, height: 110 }} loading={loading}><Statistic title={k} value={v} valueStyle={{ color: k.toLowerCase().includes("operational") && !k.toLowerCase().includes("non") ? "#52c41a" : "#ff4d4f" }} /></Card></Col>
        ))}
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card title="By Province" size="small" style={{ borderRadius: 10 }}>
            {rcaProvList.map(p => (
              <div key={p.province} style={{ marginBottom: 6 }}><Text style={{ fontSize: 12 }}>{p.province}</Text><Progress percent={Math.round((p.count / rcaMaxProv) * 100)} format={() => p.count} size="small" strokeColor="#722ed1" /></div>
            ))}
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="By Status" size="small" style={{ borderRadius: 10 }}>
            {Object.entries(rcaByStatus).map(([k, v]) => (
              <div key={k} style={{ marginBottom: 6 }}><Text style={{ fontSize: 12 }}>{k}</Text><Progress percent={Math.round((v / stats.totalRecords) * 100)} format={() => v} size="small" /></div>
            ))}
          </Card>
        </Col>
      </Row>
      <Row style={{ marginTop: 16 }}><Col span={24}><Button type="link" onClick={onViewAll}>View All Residual Containment →</Button></Col></Row>
    </>
  );
}

export function TransferStationsTab({ stats, loading, onViewAll }) {
  const tsByStatus = stats.byStatus || {};
  const tsProvList = provinceList(stats.byProvince);
  const tsMaxProv = maxCount(tsProvList);
  return (
    <>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={12} md={6}><Card hoverable style={{ borderRadius: 10, height: 110 }} loading={loading}><Statistic title="Total Stations" value={stats.totalRecords} prefix={<SwapOutlined style={{ color: "#13c2c2" }} />} /></Card></Col>
        {Object.entries(tsByStatus).slice(0, 3).map(([k, v]) => (
          <Col key={k} xs={12} sm={12} md={6}><Card hoverable style={{ borderRadius: 10, height: 110 }} loading={loading}><Statistic title={k} value={v} valueStyle={{ color: k.toLowerCase().includes("operational") && !k.toLowerCase().includes("non") ? "#52c41a" : "#faad14" }} /></Card></Col>
        ))}
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card title="By Province" size="small" style={{ borderRadius: 10 }}>
            {tsProvList.map(p => (
              <div key={p.province} style={{ marginBottom: 6 }}><Text style={{ fontSize: 12 }}>{p.province}</Text><Progress percent={Math.round((p.count / tsMaxProv) * 100)} format={() => p.count} size="small" strokeColor="#13c2c2" /></div>
            ))}
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="By Status" size="small" style={{ borderRadius: 10 }}>
            {Object.entries(tsByStatus).map(([k, v]) => (
              <div key={k} style={{ marginBottom: 6 }}><Text style={{ fontSize: 12 }}>{k}</Text><Progress percent={Math.round((v / stats.totalRecords) * 100)} format={() => v} size="small" /></div>
            ))}
          </Card>
        </Col>
      </Row>
      <Row style={{ marginTop: 16 }}><Col span={24}><Button type="link" onClick={onViewAll}>View All Transfer Stations →</Button></Col></Row>
    </>
  );
}

export function PdsScopingTab({ stats, loading, onViewAll }) {
  const pdsByStatus = stats.byStatus || {};
  const pdsProvList = provinceList(stats.byProvince);
  const pdsMaxProv = maxCount(pdsProvList);
  return (
    <>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={12} md={6}><Card hoverable style={{ borderRadius: 10, height: 110 }} loading={loading}><Statistic title="Total Records" value={stats.totalRecords} prefix={<FileTextOutlined style={{ color: "#1890ff" }} />} /></Card></Col>
        {Object.entries(pdsByStatus).slice(0, 3).map(([k, v]) => (
          <Col key={k} xs={12} sm={12} md={6}><Card hoverable style={{ borderRadius: 10, height: 110 }} loading={loading}><Statistic title={k} value={v} /></Card></Col>
        ))}
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card title="By Province" size="small" style={{ borderRadius: 10 }}>
            {pdsProvList.map(p => (
              <div key={p.province} style={{ marginBottom: 6 }}><Text style={{ fontSize: 12 }}>{p.province}</Text><Progress percent={Math.round((p.count / pdsMaxProv) * 100)} format={() => p.count} size="small" strokeColor="#1890ff" /></div>
            ))}
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="By Status" size="small" style={{ borderRadius: 10 }}>
            {Object.entries(pdsByStatus).map(([k, v]) => (
              <div key={k} style={{ marginBottom: 6 }}><Text style={{ fontSize: 12 }}>{k}</Text><Progress percent={Math.round((v / stats.totalRecords) * 100)} format={() => v} size="small" /></div>
            ))}
          </Card>
        </Col>
      </Row>
      <Row style={{ marginTop: 16 }}><Col span={24}><Button type="link" onClick={onViewAll}>View All PDS Records →</Button></Col></Row>
    </>
  );
}

export function TechnicalAssistanceTab({ stats, loading, onViewAll }) {
  const taByStatus = stats.byStatus || {};
  const taByFacility = stats.byFacilityType || {};
  const taProvList = provinceList(stats.byProvince);
  const taMaxProv = maxCount(taProvList);
  return (
    <>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={12} md={6}><Card hoverable style={{ borderRadius: 10, height: 110 }} loading={loading}><Statistic title="Total Records" value={stats.totalRecords} prefix={<ToolOutlined style={{ color: "#fa8c16" }} />} /></Card></Col>
        {Object.entries(taByStatus).slice(0, 3).map(([k, v]) => (
          <Col key={k} xs={12} sm={12} md={6}><Card hoverable style={{ borderRadius: 10, height: 110 }} loading={loading}><Statistic title={k} value={v} /></Card></Col>
        ))}
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <Card title="By Province" size="small" style={{ borderRadius: 10 }}>
            {taProvList.map(p => (
              <div key={p.province} style={{ marginBottom: 6 }}><Text style={{ fontSize: 12 }}>{p.province}</Text><Progress percent={Math.round((p.count / taMaxProv) * 100)} format={() => p.count} size="small" strokeColor="#fa8c16" /></div>
            ))}
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card title="By Status" size="small" style={{ borderRadius: 10 }}>
            {Object.entries(taByStatus).map(([k, v]) => (
              <div key={k} style={{ marginBottom: 6 }}><Text style={{ fontSize: 12 }}>{k}</Text><Progress percent={Math.round((v / stats.totalRecords) * 100)} format={() => v} size="small" /></div>
            ))}
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card title="By Facility Type" size="small" style={{ borderRadius: 10 }}>
            {Object.entries(taByFacility).map(([k, v]) => (
              <div key={k} style={{ marginBottom: 6 }}><Text style={{ fontSize: 12 }}>{k}</Text><Progress percent={Math.round((v / stats.totalRecords) * 100)} format={() => v} size="small" strokeColor="#722ed1" /></div>
            ))}
          </Card>
        </Col>
      </Row>
      <Row style={{ marginTop: 16 }}><Col span={24}><Button type="link" onClick={onViewAll}>View All Technical Assistance →</Button></Col></Row>
    </>
  );
}

export function LguDiversionTab({ stats, loading, onViewAll }) {
  const ldByStatus = stats.byStatus || {};
  const ldWaste = stats.wasteStats || {};
  const ldProvList = provinceList(stats.byProvince);
  const ldMaxProv = maxCount(ldProvList);
  return (
    <>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={12} md={6}><Card hoverable style={{ borderRadius: 10, height: 110 }} loading={loading}><Statistic title="Total LGUs" value={stats.totalRecords} prefix={<TeamOutlined style={{ color: "#52c41a" }} />} /></Card></Col>
        <Col xs={12} sm={12} md={6}><Card hoverable style={{ borderRadius: 10, height: 110 }} loading={loading}><Statistic title="Avg Diversion" value={(ldWaste.avgDiversion || 0).toFixed(1)} suffix="%" prefix={<RiseOutlined style={{ color: "#1890ff" }} />} /></Card></Col>
        <Col xs={12} sm={12} md={6}><Card hoverable style={{ borderRadius: 10, height: 110 }} loading={loading}><Statistic title="Total Waste Gen" value={ldWaste.totalWasteGen || 0} prefix={<BarChartOutlined style={{ color: "#ff4d4f" }} />} formatter={(v) => Number(v).toLocaleString()} /></Card></Col>
        <Col xs={12} sm={12} md={6}><Card hoverable style={{ borderRadius: 10, height: 110 }} loading={loading}><Statistic title="Total Diverted" value={ldWaste.totalDiverted || 0} prefix={<BarChartOutlined style={{ color: "#52c41a" }} />} formatter={(v) => Number(v).toLocaleString()} /></Card></Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card title="By Province" size="small" style={{ borderRadius: 10 }}>
            {ldProvList.map(p => (
              <div key={p.province} style={{ marginBottom: 6 }}><Text style={{ fontSize: 12 }}>{p.province}</Text><Progress percent={Math.round((p.count / ldMaxProv) * 100)} format={() => p.count} size="small" strokeColor="#52c41a" /></div>
            ))}
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="By Status" size="small" style={{ borderRadius: 10 }}>
            {Object.entries(ldByStatus).map(([k, v]) => (
              <div key={k} style={{ marginBottom: 6 }}><Text style={{ fontSize: 12 }}>{k}</Text><Progress percent={Math.round((v / stats.totalRecords) * 100)} format={() => v} size="small" /></div>
            ))}
          </Card>
        </Col>
      </Row>
      <Row style={{ marginTop: 16 }}><Col span={24}><Button type="link" onClick={onViewAll}>View All LGU Assist & Diversion →</Button></Col></Row>
    </>
  );
}

/**
 * Append every small stat tab that has data to `tabItems`, preserving the
 * original order and the "only when totalRecords > 0" rule.
 */
export function pushSmallStatTabs(tabItems, { stats, loading, setActiveMenu }) {
  const entries = [
    { key: "open-dumpsites", label: <span><EnvironmentOutlined /> Open Dumpsites</span>, data: stats.openDumpStats, menu: "cs-open-dump", Tab: OpenDumpsitesTab },
    { key: "residual-containment", label: <span><SafetyCertificateOutlined /> Residual Containment</span>, data: stats.rcaStats, menu: "cs-rca", Tab: ResidualContainmentTab },
    { key: "transfer-stations", label: <span><SwapOutlined /> Transfer Stations</span>, data: stats.tsStats, menu: "cs-transfer-station", Tab: TransferStationsTab },
    { key: "pds-scoping", label: <span><FileTextOutlined /> PDS (Scoping)</span>, data: stats.pdsStats, menu: "cs-pds", Tab: PdsScopingTab },
    { key: "tech-assist", label: <span><ToolOutlined /> Technical Assistance</span>, data: stats.techAssistStats, menu: "cs-tech-assist", Tab: TechnicalAssistanceTab },
    { key: "lgu-diversion", label: <span><TeamOutlined /> LGU Assist & Diversion</span>, data: stats.lguDivStats, menu: "cs-lgu-diversion", Tab: LguDiversionTab },
  ];

  entries.forEach(({ key, label, data, menu, Tab }) => {
    if (!data || !(data.totalRecords > 0)) return;
    tabItems.push({
      key,
      label,
      children: <Tab stats={data} loading={loading} onViewAll={() => setActiveMenu(menu)} />,
    });
  });
}
