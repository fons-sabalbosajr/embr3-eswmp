import { R3_PROVINCES, getStatusTag } from "../../slf-monitoring/SlfDashboardTab";
import { BellOutlined, EnvironmentOutlined, TableOutlined, TeamOutlined } from "@ant-design/icons";
import { Alert, Badge, Button, Card, Col, Empty, Input, Modal, Row, Space, Statistic, Table, Tabs, Tag, message } from "antd";

// LGUs-served insight, with the nested capacity-alert dialog it launches.
export default function SlfLguModal({
  slfLguModal,
  setSlfLguModal,
  records,
  capacityAlertModal,
  setCapacityAlertModal,
  capacityAlertSending,
  sendCapacityAlert,
}) {
  return (
    <Modal
      open={slfLguModal}
      onCancel={() => setSlfLguModal(false)}
      title={
        <Space>
          <TeamOutlined style={{ color: "#fa8c16" }} />

          <Modal
            title={
              <Space>
                <BellOutlined style={{ color: "#fa8c16" }} />
                <span>Notify Assigned SLF Users</span>
              </Space>
            }
            open={!!capacityAlertModal?.open}
            onCancel={() => setCapacityAlertModal(null)}
            onOk={sendCapacityAlert}
            okText="Send Notification"
            confirmLoading={capacityAlertSending}
            width={620}
            destroyOnHidden
          >
            {capacityAlertModal?.cell && (
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <Alert
                  type="warning"
                  showIcon
                  message={`${capacityAlertModal.record?.lgu || "SLF"} Cell ${capacityAlertModal.cell.index + 1} is ${capacityAlertModal.cell.pct}% full`}
                  description="This sends a portal notification to users assigned to this SLF and also creates an admin notification."
                />
                <Input.TextArea
                  rows={5}
                  value={capacityAlertModal.message}
                  onChange={(event) =>
                    setCapacityAlertModal((prev) => ({
                      ...prev,
                      message: event.target.value,
                    }))
                  }
                  placeholder="Write the notification message for assigned SLF users"
                />
              </Space>
            )}
          </Modal>
          <Text strong>LGU Served — SLF Details</Text>
        </Space>
      }
      footer={
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <Button onClick={() => setSlfLguModal(false)}>Close</Button>
          <Button
            type="primary"
            icon={<TableOutlined />}
            onClick={() => setSlfLguModal(false)}
          >
            See More Details in Table
          </Button>
        </div>
      }
      width={1050}
      destroyOnHidden
    >
      {(() => {
        const lguData = records.filter(
          (r) => getServedClientCount(r) > 0,
        );
        const inR3 = lguData.filter((r) => R3_PROVINCES.includes(r.province));
        const outR3 = lguData.filter(
          (r) => !R3_PROVINCES.includes(r.province),
        );
        const totalInR3 = inR3.reduce(
          (s, r) => s + getServedClientCount(r),
          0,
        );
        const totalOutR3 = outR3.reduce(
          (s, r) => s + getServedClientCount(r),
          0,
        );
        const cols = [
          {
            title: "SLF / LGU",
            dataIndex: "lgu",
            key: "lgu",
            width: 180,
            render: (v, r) => (
              <Text strong style={{ fontSize: 12 }}>
                {v}
                {r.barangay ? (
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {" "}
                    ({r.barangay})
                  </Text>
                ) : (
                  ""
                )}
              </Text>
            ),
          },
          {
            title: "Province",
            dataIndex: "province",
            key: "province",
            width: 120,
            render: (v) => <Tag color="geekblue">{v || "—"}</Tag>,
          },
          {
            title: "No. of LGUs Served",
            dataIndex: "noOfLGUServed",
            key: "noOfLGUServed",
            width: 140,
            align: "center",
            render: (_, record) => (
              <Badge
                count={getServedClientCount(record)}
                color="#fa8c16"
                overflowCount={999}
                style={{ fontWeight: 700 }}
              />
            ),
          },
          {
            title: "Status",
            dataIndex: "statusOfSLF",
            key: "statusOfSLF",
            width: 130,
            render: (v) => getStatusTag(v),
          },
          {
            title: "Ownership",
            dataIndex: "ownership",
            key: "ownership",
            width: 130,
            render: (v) => v || "—",
          },
          {
            title: "Category",
            dataIndex: "category",
            key: "category",
            width: 80,
            align: "center",
            render: (v) => (v ? <Tag color="purple">{v}</Tag> : "—"),
          },
        ];
        const summary = (data) => {
          const tot = data.reduce((s, r) => s + getServedClientCount(r), 0);
          return (
            <Table.Summary.Row>
              <Table.Summary.Cell colSpan={2} index={0}>
                <Text strong>Total</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={2} align="center">
                <Text strong style={{ color: "#fa8c16" }}>
                  {tot}
                </Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell colSpan={3} index={3} />
            </Table.Summary.Row>
          );
        };
        return (
          <Tabs
            defaultActiveKey="r3"
            items={[
              {
                key: "r3",
                label: (
                  <span>
                    <EnvironmentOutlined /> Within Region 3{" "}
                    <Badge
                      count={totalInR3}
                      color="#fa8c16"
                      overflowCount={999}
                      style={{ marginLeft: 4 }}
                    />
                  </span>
                ),
                children:
                  inR3.length > 0 ? (
                    <>
                      <Row gutter={16} style={{ marginBottom: 12 }}>
                        <Col span={8}>
                          <Card
                            size="small"
                            style={{
                              borderRadius: 8,
                              background: "#fff7e6",
                              borderColor: "#ffd591",
                            }}
                          >
                            <Statistic
                              title="SLF Facilities"
                              value={inR3.length}
                              styles={{
                                content: { color: "#fa8c16", fontSize: 22 },
                              }}
                            />
                          </Card>
                        </Col>
                        <Col span={8}>
                          <Card
                            size="small"
                            style={{
                              borderRadius: 8,
                              background: "#fff7e6",
                              borderColor: "#ffd591",
                            }}
                          >
                            <Statistic
                              title="Total LGUs Served"
                              value={totalInR3}
                              styles={{
                                content: { color: "#fa8c16", fontSize: 22 },
                              }}
                            />
                          </Card>
                        </Col>
                        <Col span={8}>
                          <Card
                            size="small"
                            style={{
                              borderRadius: 8,
                              background: "#fff7e6",
                              borderColor: "#ffd591",
                            }}
                          >
                            <Statistic
                              title="Avg LGUs/SLF"
                              value={(totalInR3 / inR3.length).toFixed(1)}
                              styles={{
                                content: { color: "#fa8c16", fontSize: 22 },
                              }}
                            />
                          </Card>
                        </Col>
                      </Row>
                      <Table
                        dataSource={inR3}
                        rowKey="_id"
                        size="small"
                        columns={cols}
                        pagination={{ pageSize: 10, showSizeChanger: true }}
                        scroll={{ x: "max-content" }}
                        summary={summary}
                      />
                    </>
                  ) : (
                    <Empty description="No SLF data within Region 3 reporting LGU services" />
                  ),
              },
              {
                key: "out",
                label: (
                  <span>
                    <EnvironmentOutlined /> Outside Region 3{" "}
                    <Badge
                      count={totalOutR3}
                      color="#1890ff"
                      overflowCount={999}
                      style={{ marginLeft: 4 }}
                    />
                  </span>
                ),
                children:
                  outR3.length > 0 ? (
                    <>
                      <Row gutter={16} style={{ marginBottom: 12 }}>
                        <Col span={8}>
                          <Card
                            size="small"
                            style={{
                              borderRadius: 8,
                              background: "#e6f7ff",
                              borderColor: "#91d5ff",
                            }}
                          >
                            <Statistic
                              title="SLF Facilities"
                              value={outR3.length}
                              styles={{
                                content: { color: "#1890ff", fontSize: 22 },
                              }}
                            />
                          </Card>
                        </Col>
                        <Col span={8}>
                          <Card
                            size="small"
                            style={{
                              borderRadius: 8,
                              background: "#e6f7ff",
                              borderColor: "#91d5ff",
                            }}
                          >
                            <Statistic
                              title="Total LGUs Served"
                              value={totalOutR3}
                              styles={{
                                content: { color: "#1890ff", fontSize: 22 },
                              }}
                            />
                          </Card>
                        </Col>
                        <Col span={8}>
                          <Card
                            size="small"
                            style={{
                              borderRadius: 8,
                              background: "#e6f7ff",
                              borderColor: "#91d5ff",
                            }}
                          >
                            <Statistic
                              title="Avg LGUs/SLF"
                              value={(totalOutR3 / outR3.length).toFixed(1)}
                              styles={{
                                content: { color: "#1890ff", fontSize: 22 },
                              }}
                            />
                          </Card>
                        </Col>
                      </Row>
                      <Table
                        dataSource={outR3}
                        rowKey="_id"
                        size="small"
                        columns={cols}
                        pagination={{ pageSize: 10, showSizeChanger: true }}
                        scroll={{ x: "max-content" }}
                        summary={summary}
                      />
                    </>
                  ) : (
                    <Empty description="No SLF data outside Region 3 reporting LGU services" />
                  ),
              },
            ]}
          />
        );
      })()}
    </Modal>
  );
}
