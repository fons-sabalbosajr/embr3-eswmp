import { buildFilters, matchesFilter } from "../shared/tableFilters";
import { formatCompact, getStatusTag } from "../slf-monitoring/SlfDashboardTab";
import { ACCENT, isHazardousCellType, managementStatusSummary, normalizeUnit } from "../slf-monitoring/helpers.jsx";
import { AlertOutlined, CalendarOutlined, ContainerOutlined, DeleteOutlined, EditOutlined, ExperimentOutlined, EyeOutlined, SolutionOutlined, UserOutlined, WarningOutlined } from "@ant-design/icons";
import { Button, Space, Tag, Tooltip } from "antd";

// Column definitions for the SLF Data Table.
//
// A factory, not a constant: the cell renderers open the edit drawer, the detail
// modal and the delete-review flow, and several read the loaded record set for
// cross-row context. Those are explicit parameters so nothing is closed over.
export function makeMonitoringColumns({
  canEdit,
  canDelete,
  records,
  style,
  CATEGORY_DESC,
  getCategoryLabel,
  openEdit,
  setDetailModal,
  reviewAndDeleteRecord,
}) {
  return [
    {
      title: "#",
      key: "idx",
      width: 40,
      render: (_, __, i) => i + 1,
    },
    {
      title: "LGU",
      key: "lgu",
      width: 200,
      filters: buildFilters(records, "province"),
      onFilter: (v, r) => matchesFilter(r.province, v),
      sorter: (a, b) => (a.lgu || "").localeCompare(b.lgu || ""),
      render: (_, r) => (
        <Tooltip
          title={`${r.province} — ${r.lgu}${r.barangay ? ` (${r.barangay})` : ""}`}
        >
          <div style={{ lineHeight: 1.3 }}>
            <Text strong style={{ fontSize: 12 }}>
              {r.lgu}
            </Text>
            <br />
            <Text type="secondary" style={{ fontSize: 11 }}>
              {r.province}
              {r.barangay ? ` · ${r.barangay}` : ""}
            </Text>
          </div>
        </Tooltip>
      ),
    },
    {
      title: "Ownership",
      dataIndex: "ownership",
      width: 110,
      align: "center",
      filters: buildFilters(records, "ownership"),
      onFilter: (v, r) => matchesFilter(r.ownership, v),
    },
    {
      title: "Category",
      dataIndex: "category",
      width: 100,
      render: (v) =>
        v ? (
          <Tooltip title={CATEGORY_DESC[v] || v}>
            <div
              style={{
                maxWidth: "100%",
                whiteSpace: "normal",
                wordBreak: "break-word",
                lineHeight: 1.25,
              }}
            >
              <Tag
                color="blue"
                variant="filled"
                style={{
                  marginInlineEnd: 0,
                  maxWidth: "100%",
                  whiteSpace: "normal",
                  wordBreak: "break-word",
                  lineHeight: 1.3,
                  padding: "2px 6px",
                }}
              >
                {getCategoryLabel(v)}
                {CATEGORY_DESC[v] ? ` - ${CATEGORY_DESC[v]}` : ""}
              </Tag>
            </div>
          </Tooltip>
        ) : (
          "—"
        ),
      filters: buildFilters(records, "category"),
      onFilter: (v, r) => matchesFilter(r.category, v),
    },
    {
      title: "Status",
      key: "status",
      width: 140,
      filters: buildFilters(records, "statusOfSLF"),
      onFilter: (v, r) => matchesFilter(r.statusOfSLF, v),
      sorter: (a, b) =>
        (a.statusOfSLF || "").localeCompare(b.statusOfSLF || ""),
      render: (_, r) => (
        <div style={{ lineHeight: 1.3 }}>
          {getStatusTag(r.statusOfSLF)}
          {r.yearStartedOperation && (
            <div>
              <Text type="secondary" style={{ fontSize: 10 }}>
                <CalendarOutlined style={{ marginRight: 3 }} />
                Since {r.yearStartedOperation}
              </Text>
            </div>
          )}
        </div>
      ),
    },
    {
      title: "Capacity per day",
      key: "capacityPerDay",
      width: 100,
      align: "center",
      sorter: (a, b) =>
        (a.receivingVolumeCapacity ?? a.volumeCapacity ?? 0) -
        (b.receivingVolumeCapacity ?? b.volumeCapacity ?? 0),
      render: (_, r) => {
        const value = r.receivingVolumeCapacity ?? r.volumeCapacity;
        const unit = normalizeUnit(
          r.receivingVolumeCapacity != null
            ? r.receivingVolumeCapacityUnit || r.volumeCapacityUnit || "m³"
            : r.volumeCapacityUnit || "m³",
        );
        return value != null ? (
          <div style={{ lineHeight: 1.25 }}>
            <Text strong style={{ color: ACCENT }}>
              {Number(value).toLocaleString()}
            </Text>
            <br />
            <Text type="secondary" style={{ fontSize: 11 }}>
              {unit}/day
            </Text>
          </div>
        ) : (
          "—"
        );
      },
    },
    {
      title: "LGUs Served",
      dataIndex: "noOfLGUServed",
      width: 80,
      align: "center",
      sorter: (a, b) => getServedClientCount(a) - getServedClientCount(b),
      render: (_, record) => getServedClientCount(record) || "—",
    },
    {
      title: "Cells",
      dataIndex: "numberOfCell",
      key: "cells",
      width: 140,
      sorter: (a, b) => (a.numberOfCell || 0) - (b.numberOfCell || 0),
      render: (_, r) => {
        const total =
          Number(r.numberOfCell || 0) ||
          (Array.isArray(r.cellTypes) ? r.cellTypes.length : 0);
        const types = Array.isArray(r.cellTypes) ? r.cellTypes : [];
        // Data genuinely unavailable → dash (not zero).
        if (!(Number(r.numberOfCell) > 0) && types.length === 0) {
          return <Text type="secondary">—</Text>;
        }
        let hazardous = 0;
        for (let i = 0; i < total; i += 1) {
          if (isHazardousCellType(types[i] || "Residual")) hazardous += 1;
        }
        const residual = Math.max(total - hazardous, 0);
        return (
          <Tooltip
            title={`${residual} residual cell(s), ${hazardous} hazardous cell(s)`}
          >
            {/* Item #7: label left, value tag right — aligned uniformly so the
                numeric tags line up regardless of label length. */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 3,
                minWidth: 116,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <span
                  style={{ fontSize: 12, whiteSpace: "nowrap" }}
                  aria-label={`Residual cells: ${residual}`}
                >
                  <ContainerOutlined
                    style={{ color: "#2f54eb", marginRight: 4 }}
                  />
                  Residual
                </span>
                <Tag
                  color={residual ? "blue" : "default"}
                  style={{ margin: 0 }}
                >
                  {residual}
                </Tag>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <span
                  style={{ fontSize: 12, whiteSpace: "nowrap" }}
                  aria-label={`Hazardous cells: ${hazardous}`}
                >
                  <WarningOutlined
                    style={{ color: "#cf1322", marginRight: 4 }}
                  />
                  Hazardous
                </span>
                <Tag
                  color={hazardous ? "red" : "default"}
                  style={{ margin: 0 }}
                >
                  {hazardous}
                </Tag>
              </div>
            </div>
          </Tooltip>
        );
      },
    },
    {
      title: "Leachate & Gas Management",
      key: "managementSummary",
      width: 130,
      render: (_, r) => {
        const leachateCount =
          Number(r.noOfLeachatePond || 0) ||
          (r.leachatePondDetails || []).length;
        const gasCount =
          Number(r.numberOfGasVents || 0) || (r.gasVentDetails || []).length;
        const tooltip = [
          leachateCount
            ? `Leachate\n${managementStatusSummary(r.leachatePondDetails || []) || `${leachateCount} recorded`}`
            : "No leachate treatment plant recorded",
          gasCount
            ? `Gas Management\n${managementStatusSummary(r.gasVentDetails || []) || `${gasCount} recorded`}`
            : "No gas management details recorded",
        ].join("\n\n");
        return (
          <Tooltip
            title={
              <div
                style={{
                  maxWidth: 280,
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  fontSize: 12,
                }}
              >
                {tooltip}
              </div>
            }
          >
            {/* Item #7: label left, count right — aligned to match the Cells column. */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 3,
                minWidth: 108,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                  <AlertOutlined style={{ color: "#fa8c16", marginRight: 4 }} />
                  Leachate
                </span>
                <Tag
                  color={leachateCount ? "orange" : "default"}
                  style={{ margin: 0 }}
                >
                  {leachateCount || 0}
                </Tag>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                  <ExperimentOutlined
                    style={{ color: "#13c2c2", marginRight: 4 }}
                  />
                  Gas
                </span>
                <Tag
                  color={gasCount ? "cyan" : "default"}
                  style={{ margin: 0 }}
                >
                  {gasCount || 0}
                </Tag>
              </div>
            </div>
          </Tooltip>
        );
      },
    },
    {
      title: "Waste Received",
      dataIndex: "actualResidualWasteReceived",
      width: 110,
      sorter: (a, b) =>
        (a.actualResidualWasteReceived || 0) -
        (b.actualResidualWasteReceived || 0),
      render: (v, record) =>
        v != null ? (
          <Tooltip
            title={`${Number(v).toLocaleString()} ${normalizeUnit(record.wasteReceivedUnit || "m³")}`}
          >
            {`${formatCompact(v)} ${normalizeUnit(record.wasteReceivedUnit || "m³")}`}
          </Tooltip>
        ) : (
          "—"
        ),
    },
    // {
    //   title: "Target Month",
    //   dataIndex: "targetMonth",
    //   key: "targetMonth",
    //   width: 150,
    //   align: "center",
    //   ellipsis: false,
    //   filters: buildFilters(records, "targetMonth"),
    //   onFilter: (v, r) => matchesFilter(r.targetMonth, v),
    //   render: (v) =>
    //     v ? (
    //       <div
    //         style={{
    //           whiteSpace: "normal",
    //           wordBreak: "break-word",
    //           lineHeight: 1.25,
    //         }}
    //       >
    //         <Tag
    //           variant="filled"
    //           color="cyan"
    //           style={{
    //             whiteSpace: "normal",
    //             wordBreak: "break-word",
    //             lineHeight: 1.3,
    //           }}
    //         >
    //           {v.replace(/^\d+\./, "")}
    //         </Tag>
    //       </div>
    //     ) : (
    //       "—"
    //     ),
    // },
    {
      title: "Personnel",
      key: "personnel",
      width: 160,
      ellipsis: false,
      render: (_, r) => (
        <Tooltip
          title={
            <div>
              <div>
                <UserOutlined /> ENMO: {r.enmo || "—"}
              </div>
              <div>
                <UserOutlined /> Focal: {r.focalPerson || "—"}
              </div>
            </div>
          }
        >
          <div
            style={{
              lineHeight: 1.3,
              whiteSpace: "normal",
              wordBreak: "break-word",
            }}
          >
            <Text style={{ fontSize: 11 }}>
              <UserOutlined style={{ color: "#722ed1", marginRight: 4 }} />
              {r.focalPerson || "—"}
            </Text>
            <br />
            <Text type="secondary" style={{ fontSize: 10 }}>
              <SolutionOutlined style={{ marginRight: 3 }} />
              {r.enmo || "—"}
            </Text>
          </div>
        </Tooltip>
      ),
    },
    {
      title: "Actions",
      key: "actions",
      width: 120,
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title="View">
            <Button
              size="small"
              type="primary"
              icon={<EyeOutlined />}
              onClick={() => setDetailModal(r)}
            />
          </Tooltip>
          {canEdit && (
            <Tooltip title="Edit">
              <Button
                size="small"
                type="primary"
                icon={<EditOutlined />}
                onClick={() => openEdit(r)}
              />
            </Tooltip>
          )}
          {canDelete && (
            <Tooltip title="Delete">
              <Button
                size="small"
                type="primary"
                danger
                icon={<DeleteOutlined />}
                onClick={() => reviewAndDeleteRecord(r)}
              />
            </Tooltip>
          )}
        </Space>
      ),
    },
  ];
}
