import { useState, useEffect } from 'react';
import { Button, Card, Table, Tag, Tooltip, Progress, Badge, Collapse, Empty, Space, Typography, Descriptions } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, ContainerOutlined, DatabaseOutlined, ReloadOutlined, TeamOutlined, WarningOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../../api';
import { normalizeUnit, getWasteKind, CHART_COLORS, formatVolume } from './helpers.jsx';
import { parseCellIndex } from './SlfDashboardTab';

const { Text } = Typography;

function WasteBaselineInfo() {
  const [baselines, setBaselines] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedGen, setExpandedGen] = useState(null);

  useEffect(() => {
    setLoading(true);
    api
      .get("/data-slf/baselines")
      .then(({ data }) => setBaselines(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const columns = [
    {
      title: "SLF Name",
      dataIndex: "slfName",
      key: "slfName",
      render: (t) => <Text strong>{t}</Text>,
    },
    {
      title: "Status",
      dataIndex: "isActive",
      key: "isActive",
      width: 100,
      render: (v) =>
        v ? <Tag color="green">Active</Tag> : <Tag color="red">Inactive</Tag>,
    },
    {
      title: "Total Volume Accepted",
      key: "totalVolumeAccepted",
      render: (_, r) =>
        r.totalVolumeAccepted != null
          ? `${r.totalVolumeAccepted.toLocaleString()} ${normalizeUnit(r.totalVolumeAcceptedUnit || r.baselineUnit)}`
          : "—",
    },
    {
      title: "Active Cell (Residual)",
      key: "activeCellResidual",
      render: (_, r) =>
        r.activeCellResidualVolume != null
          ? `${r.activeCellResidualVolume.toLocaleString()} ${normalizeUnit(r.activeCellResidualUnit || r.baselineUnit)}`
          : "—",
    },
    {
      title: "Active Cell (Inert)",
      key: "activeCellInert",
      render: (_, r) =>
        r.activeCellInertVolume != null
          ? `${r.activeCellInertVolume.toLocaleString()} ${normalizeUnit(r.activeCellInertUnit || r.baselineUnit)}`
          : "—",
    },
    {
      title: "Closed Cell (Residual)",
      key: "closedCellResidual",
      render: (_, r) =>
        r.closedCellResidualVolume != null
          ? `${r.closedCellResidualVolume.toLocaleString()} ${normalizeUnit(r.closedCellResidualUnit || r.baselineUnit)}`
          : "—",
    },
    {
      title: "Closed Cell (Inert)",
      key: "closedCellInert",
      render: (_, r) =>
        r.closedCellInertVolume != null
          ? `${r.closedCellInertVolume.toLocaleString()} ${normalizeUnit(r.closedCellInertUnit || r.baselineUnit)}`
          : "—",
    },
    {
      title: "Haulers",
      key: "haulers",
      width: 80,
      render: (_, r) => r.accreditedHaulers?.length || 0,
    },
    {
      title: "Submitted By",
      dataIndex: "submittedBy",
      key: "submittedBy",
      ellipsis: true,
      render: (v) => v || "—",
    },
    {
      title: "Last Updated",
      dataIndex: "lastUpdated",
      key: "lastUpdated",
      width: 140,
      render: (v) => (v ? dayjs(v).format("MM/DD/YYYY") : "—"),
    },
  ];

  const buildBaselineCellRows = (record, cellType) => {
    const entries =
      cellType === "active"
        ? record.activeCellEntries || []
        : record.closedCellEntries || [];
    const fallbackRows =
      cellType === "active"
        ? [
            {
              cellName: "Active Cell - Residual",
              wasteType: "Residual",
              volume: record.activeCellResidualVolume,
              unit: record.activeCellResidualUnit || record.baselineUnit,
            },
            {
              cellName: "Active Cell - Inert",
              wasteType: "Inert",
              volume: record.activeCellInertVolume,
              unit: record.activeCellInertUnit || record.baselineUnit,
            },
            {
              cellName: "Active Cell - Hazardous",
              wasteType: "Hazardous Waste",
              volume: record.activeCellHazardousVolume,
              unit: record.activeCellHazardousUnit || record.baselineUnit,
            },
          ]
        : [
            {
              cellName: "Closed Cell - Residual",
              wasteType: "Residual",
              volume: record.closedCellResidualVolume,
              unit: record.closedCellResidualUnit || record.baselineUnit,
            },
            {
              cellName: "Closed Cell - Inert",
              wasteType: "Inert",
              volume: record.closedCellInertVolume,
              unit: record.closedCellInertUnit || record.baselineUnit,
            },
            {
              cellName: "Closed Cell - Hazardous",
              wasteType: "Hazardous Waste",
              volume: record.closedCellHazardousVolume,
              unit: record.closedCellHazardousUnit || record.baselineUnit,
            },
          ];

    const source =
      entries.length > 0
        ? entries.map((entry, index) => ({
            key: `${cellType}-${index}`,
            cellNo: (parseCellIndex(entry.cellName) ?? index) + 1,
            cellName: entry.cellName || `Cell ${index + 1}`,
            wasteType: entry.wasteType || "Residual",
            volume: Number(entry.volume || 0),
            unit: record.baselineUnit || "m³",
          }))
        : fallbackRows.map((entry, index) => ({
            key: `${cellType}-fallback-${index}`,
            cellNo: index + 1,
            cellName: entry.cellName,
            wasteType: entry.wasteType,
            volume: Number(entry.volume || 0),
            unit: entry.unit || record.baselineUnit || "m³",
          }));

    return source
      .filter((entry) => entry.volume > 0)
      .sort(
        (a, b) => a.cellNo - b.cellNo || a.cellName.localeCompare(b.cellName),
      );
  };

  const baselineCellColumns = [
    {
      title: "Cell No.",
      dataIndex: "cellNo",
      width: 90,
      render: (value) => <Tag color="blue">{value}</Tag>,
    },
    {
      title: "Cell Name",
      dataIndex: "cellName",
      render: (value) => <Text strong>{value}</Text>,
    },
    {
      title: "Waste Type",
      dataIndex: "wasteType",
      render: (value) => (
        <Tag color={getWasteKind(value) === "hazardous" ? "red" : "green"}>
          {value}
        </Tag>
      ),
    },
    {
      title: "Baseline Volume",
      key: "volume",
      align: "right",
      render: (_, row) => (
        <Text strong>{formatVolume(row.volume, row.unit)}</Text>
      ),
    },
  ];

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <Text type="secondary">
          Baseline waste volume information submitted by SLF portal users.
        </Text>
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={() => {
            setLoading(true);
            api
              .get("/data-slf/baselines")
              .then(({ data }) => setBaselines(data))
              .catch(() => {})
              .finally(() => setLoading(false));
          }}
        >
          Refresh
        </Button>
      </div>
      <Table
        dataSource={baselines}
        columns={columns}
        rowKey="_id"
        loading={loading}
        size="small"
        pagination={{ pageSize: 10 }}
        scroll={{ x: 1200 }}
        expandable={{
          expandedRowKeys: expandedGen ? [expandedGen] : [],
          onExpand: (expanded, record) =>
            setExpandedGen(expanded ? record._id : null),
          expandedRowRender: (record) => {
            const activeRows = buildBaselineCellRows(record, "active");
            const closedRows = buildBaselineCellRows(record, "closed");
            return (
              <Card
                size="small"
                style={{ borderRadius: 8 }}
                bodyStyle={{ padding: 8 }}
              >
                <Collapse
                  size="small"
                  defaultActiveKey={["active"]}
                  items={[
                    {
                      key: "active",
                      label: (
                        <Space>
                          <ContainerOutlined /> Active Cell Volumes{" "}
                          <Tag color="green">{activeRows.length}</Tag>
                        </Space>
                      ),
                      children:
                        activeRows.length > 0 ? (
                          <Table
                            dataSource={activeRows}
                            columns={baselineCellColumns}
                            rowKey="key"
                            size="small"
                            pagination={false}
                          />
                        ) : (
                          <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description="No active cell baseline volumes"
                          />
                        ),
                    },
                    {
                      key: "closed",
                      label: (
                        <Space>
                          <DatabaseOutlined /> Closed Cell Volumes{" "}
                          <Tag>{closedRows.length}</Tag>
                        </Space>
                      ),
                      children:
                        closedRows.length > 0 ? (
                          <Table
                            dataSource={closedRows}
                            columns={baselineCellColumns}
                            rowKey="key"
                            size="small"
                            pagination={false}
                          />
                        ) : (
                          <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description="No closed cell baseline volumes"
                          />
                        ),
                    },
                    {
                      key: "haulers",
                      label: (
                        <Space>
                          <TeamOutlined /> Accredited Haulers{" "}
                          <Tag color="blue">
                            {record.accreditedHaulers?.length || 0}
                          </Tag>
                        </Space>
                      ),
                      children:
                        record.accreditedHaulers?.length > 0 ? (
                          <Table
                            dataSource={record.accreditedHaulers}
                            rowKey={(_, i) => i}
                            size="small"
                            pagination={false}
                            columns={[
                              {
                                title: "Hauler Name",
                                dataIndex: "haulerName",
                                key: "haulerName",
                              },
                              {
                                title: "Number of Trucks",
                                dataIndex: "numberOfTrucks",
                                key: "numberOfTrucks",
                                render: (v) => v ?? "—",
                              },
                              {
                                title: "Private Sector Clients",
                                dataIndex: "privateSectorClients",
                                key: "privateSectorClients",
                                render: (v) => v || "—",
                              },
                            ]}
                          />
                        ) : (
                          <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description="No accredited haulers"
                          />
                        ),
                    },
                  ]}
                />
              </Card>
            );
          },
          rowExpandable: () => true,
        }}
      />
    </>
  );
}

// -- Portal Generators Sub-Tab --

export default WasteBaselineInfo;
