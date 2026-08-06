import { getTruckCellIndex } from "../../slf-monitoring/SlfDashboardTab";
import { isHazardousCellType, normalizeUnit } from "../../slf-monitoring/helpers.jsx";
import { FileTextOutlined, HistoryOutlined } from "@ant-design/icons";
import { Alert, Avatar, Button, Col, Empty, List, Modal, Row, Select, Space, Table, Tag } from "antd";
import dayjs from "dayjs";

// Assign submitted waste volumes to specific landfill cells.
export default function CellAssignmentModal({
  isDark,
  cellAssignmentModal,
  setCellAssignmentModal,
  cellAssignmentSaving,
  saveCellAssignments,
  updateCellAssignmentLocal,
  getActiveCellOptions,
  records,
}) {
  return (
    <Modal
      title={
        <Space>
          <HistoryOutlined />
          Submission History and Cell Placement
        </Space>
      }
      open={!!cellAssignmentModal}
      onCancel={() => setCellAssignmentModal(null)}
      width={980}
      footer={[
        <Button key="close" onClick={() => setCellAssignmentModal(null)}>
          Close
        </Button>,
        <Button
          key="save"
          type="primary"
          loading={cellAssignmentSaving}
          onClick={saveCellAssignments}
          disabled={
            !cellAssignmentModal?.selectedId ||
            getActiveCellOptions().length === 0
          }
        >
          Save Placement
        </Button>,
      ]}
      destroyOnHidden
    >
      {cellAssignmentModal &&
        (() => {
          const activeCells = getActiveCellOptions();
          const selected = (cellAssignmentModal.submissions || []).find(
            (submission) => submission._id === cellAssignmentModal.selectedId,
          );
          return (
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              <Alert
                type={activeCells.length === 0 ? "warning" : "info"}
                showIcon
                message={
                  activeCells.length === 0
                    ? "No active cells are available. Turn on at least one cell before assigning submitted truck volumes."
                    : "Assign each submitted truck volume to the active cell where the waste was actually placed."
                }
              />
              <Row gutter={12}>
                <Col xs={24} md={9}>
                  <List
                    size="small"
                    bordered
                    style={{ maxHeight: 420, overflowY: "auto" }}
                    dataSource={cellAssignmentModal.submissions || []}
                    locale={{
                      emptyText: "No portal submissions found for this SLF",
                    }}
                    renderItem={(submission) => (
                      <List.Item
                        onClick={() =>
                          setCellAssignmentModal((prev) => ({
                            ...prev,
                            selectedId: submission._id,
                          }))
                        }
                        style={{
                          cursor: "pointer",
                          background:
                            submission._id === cellAssignmentModal.selectedId
                              ? isDark
                                ? "rgba(22,119,255,0.16)"
                                : "#e6f4ff"
                              : "transparent",
                        }}
                      >
                        <List.Item.Meta
                          avatar={<Avatar icon={<FileTextOutlined />} />}
                          title={
                            <Text strong>{submission.idNo || "No ID"}</Text>
                          }
                          description={`${submission.lguCompanyName || "Unnamed"} - ${submission.createdAt ? dayjs(submission.createdAt).format("MM/DD/YYYY") : "No date"}`}
                        />
                      </List.Item>
                    )}
                  />
                </Col>
                <Col xs={24} md={15}>
                  {!selected ? (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="Select a submission"
                    />
                  ) : (
                    (() => {
                      // Flatten trucks → per-vehicle rows so each vehicle's waste
                      // can be placed in its own active cell (matches portal model).
                      const placementRows = [];
                      (selected.trucks || []).forEach((truck, truckIndex) => {
                        if (
                          Array.isArray(truck.vehicles) &&
                          truck.vehicles.length > 0
                        ) {
                          truck.vehicles.forEach((veh, vehicleIndex) => {
                            placementRows.push({
                              rowKey: `${truckIndex}-${vehicleIndex}`,
                              truckIndex,
                              vehicleIndex,
                              plate:
                                veh.plateNumber ||
                                truck.disposalTicketNo ||
                                "-",
                              wasteType:
                                veh.wasteType ||
                                truck.wasteType ||
                                "Residual",
                              volume:
                                veh.actualVolume != null
                                  ? veh.actualVolume
                                  : truck.actualVolume,
                              volumeUnit:
                                veh.actualVolumeUnit ||
                                truck.actualVolumeUnit ||
                                "tons",
                              cellSource: veh,
                            });
                          });
                        } else {
                          placementRows.push({
                            rowKey: `${truckIndex}-t`,
                            truckIndex,
                            vehicleIndex: null,
                            plate:
                              truck.plateNumber ||
                              truck.disposalTicketNo ||
                              "-",
                            wasteType: truck.wasteType || "Residual",
                            volume: truck.actualVolume,
                            volumeUnit: truck.actualVolumeUnit || "tons",
                            cellSource: truck,
                          });
                        }
                      });
                      return (
                        <Table
                          className="portal-user-wrap-table"
                          size="small"
                          rowKey="rowKey"
                          pagination={false}
                          dataSource={placementRows}
                          locale={{
                            emptyText:
                              "No truck records found in this portal submission",
                          }}
                          columns={[
                            {
                              title: "Truck / Plate",
                              width: 150,
                              render: (_, row) => <Text>{row.plate}</Text>,
                            },
                            {
                              title: "Waste Type",
                              width: 140,
                              render: (_, row) => (
                                <Tag
                                  color={
                                    /haz|inert/i.test(row.wasteType)
                                      ? "volcano"
                                      : "green"
                                  }
                                >
                                  {row.wasteType}
                                </Tag>
                              ),
                            },
                            {
                              title: "Volume",
                              width: 110,
                              render: (_, row) =>
                                `${Number(row.volume || 0).toLocaleString()} ${normalizeUnit(row.volumeUnit)}`,
                            },
                            {
                              title: "Portal Cell",
                              width: 100,
                              render: (_, row) => {
                                const cellName = row.cellSource?.cellName;
                                return cellName ? (
                                  <Tag
                                    color="cyan"
                                    bordered={false}
                                    style={{ fontSize: 11 }}
                                  >
                                    {cellName}
                                  </Tag>
                                ) : (
                                  <Text
                                    type="secondary"
                                    style={{ fontSize: 11 }}
                                  >
                                    —
                                  </Text>
                                );
                              },
                            },
                            {
                              title: "Assign Cell",
                              render: (_, row) => {
                                const compatible = activeCells.filter(
                                  (cell) =>
                                    /haz|inert/i.test(row.wasteType)
                                      ? isHazardousCellType(cell.type)
                                      : !isHazardousCellType(cell.type),
                                );
                                const cellList = compatible.length
                                  ? compatible
                                  : activeCells;
                                // Pre-select the portal-submitted cell index when it maps to
                                // an active cell; show it ready for the admin to confirm.
                                const portalIndex = getTruckCellIndex(
                                  row.cellSource,
                                );
                                const preselected = cellList.some(
                                  (cell) => cell.index === portalIndex,
                                )
                                  ? portalIndex
                                  : undefined;
                                return (
                                  <Select
                                    style={{ width: "100%" }}
                                    placeholder={
                                      preselected == null
                                        ? "Select active cell"
                                        : undefined
                                    }
                                    value={preselected}
                                    options={cellList.map((cell) => ({
                                      label: cell.label,
                                      value: cell.index,
                                    }))}
                                    onChange={(value) =>
                                      updateCellAssignmentLocal(
                                        selected._id,
                                        row.truckIndex,
                                        value,
                                        row.vehicleIndex,
                                      )
                                    }
                                    allowClear
                                    disabled={activeCells.length === 0}
                                  />
                                );
                              },
                            },
                          ]}
                        />
                      );
                    })()
                  )}
                </Col>
              </Row>
            </Space>
          );
        })()}
    </Modal>
  );
}
