import { useMemo, useState } from "react";
import { EyeOutlined, HistoryOutlined, SearchOutlined } from "@ant-design/icons";
import { Button, DatePicker, Input, Modal, Select, Space, Table, Tag } from "antd";
import dayjs from "dayjs";

// Full notification history modal: search, read/unread filter, date range, and a
// paged table of every notification the portal user has received.
//
// The three FILTER states and the derived list live here rather than in the
// container: nothing outside this modal ever read them, so keeping them here
// removes six props and keeps the filter logic beside the controls that drive
// it. The open/closed state stays with the container, because the notification
// bell opens this modal.
export default function PreviousNotificationsModal({
  open,
  onClose,
  isMobile,
  portalNotifications,
  portalNotificationCounts,
  getPortalNotificationMeta,
  markPortalNotificationsRead,
  setNotifDetail,
}) {
  const [previousNotifSearch, setPreviousNotifSearch] = useState("");
  const [previousNotifStatus, setPreviousNotifStatus] = useState("all");
  const [previousNotifDateRange, setPreviousNotifDateRange] = useState(null);

const filteredPreviousNotifications = useMemo(() => {
  const q = previousNotifSearch.trim().toLowerCase();
  return portalNotifications.filter((notification) => {
    if (previousNotifStatus === "read" && !notification.read) return false;
    if (previousNotifStatus === "unread" && notification.read) return false;
    if (previousNotifDateRange?.[0] && previousNotifDateRange?.[1]) {
      const created = dayjs(notification.createdAt);
      if (!created.isValid()) return false;
      if (
        created.isBefore(previousNotifDateRange[0], "day") ||
        created.isAfter(previousNotifDateRange[1], "day")
      ) {
        return false;
      }
    }
    if (!q) return true;
    const meta = getPortalNotificationMeta(notification);
    return [notification.title, notification.message, notification.type, meta.label].some((value) =>
      String(value || "").toLowerCase().includes(q),
    );
  });
}, [portalNotifications, previousNotifDateRange, previousNotifSearch, previousNotifStatus]);

  return (
    <Modal
      open={open}
      onCancel={() => onClose()}
      width={isMobile ? "96vw" : 1200}
      title={
        <Space>
          <HistoryOutlined style={{ color: "#1a3353" }} />
          <span>Previous Notifications</span>
          {filteredPreviousNotifications.length > 0 && (
            <Tag>{filteredPreviousNotifications.length} shown</Tag>
          )}
        </Space>
      }
      footer={
        <Space>
          {portalNotificationCounts.total > 0 && (
            <Button onClick={() => markPortalNotificationsRead("all")}>
              Mark all read
            </Button>
          )}
          <Button type="primary" onClick={() => onClose()}>
            Close
          </Button>
        </Space>
      }
      styles={{ body: { maxHeight: "72vh", overflowY: "auto", paddingTop: 12 } }}
    >
      <Space wrap style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }}>
        <Space wrap>
          <Input
            allowClear
            placeholder="Search notifications"
            prefix={<SearchOutlined />}
            value={previousNotifSearch}
            onChange={(event) => setPreviousNotifSearch(event.target.value)}
            style={{ width: 240 }}
          />
          <Select
            value={previousNotifStatus}
            onChange={setPreviousNotifStatus}
            style={{ width: 140 }}
            options={[
              { label: "All Status", value: "all" },
              { label: "Unread", value: "unread" },
              { label: "Read", value: "read" },
            ]}
          />
          <DatePicker.RangePicker
            value={previousNotifDateRange}
            onChange={setPreviousNotifDateRange}
            allowClear
          />
        </Space>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {portalNotifications.length} loaded
        </Text>
      </Space>
      <Table
        size="small"
        rowKey={(n) => n._id}
        dataSource={filteredPreviousNotifications}
        className="portal-user-wrap-table"
        scroll={{ x: 980 }}
        pagination={{
          defaultPageSize: 10,
          showSizeChanger: true,
          pageSizeOptions: ["10", "20", "50", "100"],
          showTotal: (total) => `${total} notification(s)`,
        }}
        columns={[
          {
            title: "Date / Time",
            dataIndex: "createdAt",
            key: "createdAt",
            width: 160,
            sorter: (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
            defaultSortOrder: "descend",
            render: (v) =>
              v
                ? dayjs(v).format("MMM D, YYYY h:mm A")
                : "—",
          },
          {
            title: "Type",
            key: "type",
            width: 170,
            filters: [
              "Admin Message",
              "Support Ticket",
              "Submission Update",
              "Submission Status",
              "Request Update",
              "Admin Update",
            ].map((label) => ({ text: label, value: label })),
            onFilter: (value, record) =>
              getPortalNotificationMeta(record).label === value,
            render: (_, record) => {
              const meta = getPortalNotificationMeta(record);
              return (
                <Tag color={meta.color} icon={meta.icon}>
                  {meta.label}
                </Tag>
              );
            },
          },
          {
            title: "Title / Message",
            key: "message",
            render: (_, record) => {
              const meta = getPortalNotificationMeta(record);
              return (
                <div style={{ whiteSpace: "normal", wordBreak: "break-word" }}>
                  <Text strong style={{ fontSize: 13 }}>
                    {record.title || meta.label}
                  </Text>
                  <div>
                    <Text
                      type="secondary"
                      style={{
                        fontSize: 12,
                        whiteSpace: "normal",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {record.message || "—"}
                    </Text>
                  </div>
                </div>
              );
            },
          },
          {
            title: "Status",
            dataIndex: "read",
            key: "read",
            width: 100,
            align: "center",
            filters: [
              { text: "Unread", value: false },
              { text: "Read", value: true },
            ],
            onFilter: (value, record) => !!record.read === value,
            render: (read) =>
              read ? (
                <Tag color="default">Read</Tag>
              ) : (
                <Tag color="blue">Unread</Tag>
              ),
          },
          {
            title: "Action",
            key: "action",
            width: 90,
            align: "center",
            render: (_, record) => (
              <Button
                type="link"
                size="small"
                icon={<EyeOutlined />}
                onClick={() => setNotifDetail(record)}
              >
                View
              </Button>
            ),
          },
        ]}
      />
    </Modal>
  );
}
