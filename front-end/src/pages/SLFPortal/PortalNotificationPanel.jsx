import { BellOutlined, HistoryOutlined } from "@ant-design/icons";
import { Avatar, Badge, Button, Empty, List, Space, Tag } from "antd";
import dayjs from "dayjs";

// Bell dropdown for portal notifications: unread counts by category, a short
// list of the most recent items, and a link into the full history modal.
//
// Presentational — every count and handler is supplied by the container, which
// still owns the notification state.
export default function PortalNotificationPanel({
  isMobile,
  portalNotifications,
  portalNotificationCounts,
  getPortalNotificationMeta,
  openPortalNotification,
  markPortalNotificationsRead,
  setNotificationPanelOpen,
  setPreviousNotifOpen,
}) {
  return (
    <div
      style={{ width: isMobile ? 300 : 380, maxWidth: "calc(100vw - 32px)" }}
    >
      <Space
        style={{
          width: "100%",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <Space size={6}>
          <BellOutlined style={{ color: "#1677ff" }} />
          <Text strong>Recent Notifications</Text>
          {portalNotificationCounts.total > 0 && (
            <Badge count={portalNotificationCounts.total} size="small" />
          )}
        </Space>
        {portalNotificationCounts.total > 0 && (
          <Button
            size="small"
            type="link"
            onClick={() => markPortalNotificationsRead("all")}
          >
            Mark all read
          </Button>
        )}
      </Space>
      {portalNotifications.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No notifications yet"
        />
      ) : (
        <List
          size="small"
          dataSource={portalNotifications.slice(0, 6)}
          style={{ maxHeight: 420, overflowY: "auto" }}
          renderItem={(notification) => {
            const meta = getPortalNotificationMeta(notification);
            return (
              <List.Item
                onClick={() => openPortalNotification(notification)}
                style={{
                  cursor: "pointer",
                  padding: "10px 8px",
                  borderRadius: 8,
                  background: notification.read ? "#fff" : "#f0f7ff",
                  marginBottom: 4,
                }}
              >
                <List.Item.Meta
                  avatar={
                    <Badge dot={!notification.read}>
                      <Avatar
                        size="small"
                        style={{
                          background: notification.read ? "#f0f0f0" : "#e6f4ff",
                          color: "#1677ff",
                        }}
                        icon={meta.icon}
                      />
                    </Badge>
                  }
                  title={
                    <Space size={6} wrap>
                      <Text strong style={{ fontSize: 13 }}>
                        {notification.title || meta.label}
                      </Text>
                      <Tag
                        color={meta.color}
                        bordered={false}
                        style={{ marginInlineEnd: 0 }}
                      >
                        {meta.label}
                      </Tag>
                    </Space>
                  }
                  description={
                    <div>
                      <Text
                        type="secondary"
                        style={{ fontSize: 12, whiteSpace: "normal" }}
                      >
                        {notification.message ||
                          "Open this update for more details."}
                      </Text>
                      <div>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {notification.createdAt
                            ? dayjs(notification.createdAt).fromNow()
                            : ""}
                        </Text>
                      </div>
                    </div>
                  }
                />
              </List.Item>
            );
          }}
        />
      )}
      {portalNotifications.length > 0 && (
        <Button
          type="link"
          block
          icon={<HistoryOutlined />}
          style={{ marginTop: 4 }}
          onClick={() => {
            setNotificationPanelOpen(false);
            setPreviousNotifOpen(true);
          }}
        >
          View all previous notifications ({portalNotifications.length})
        </Button>
      )}
    </div>
  );
}
