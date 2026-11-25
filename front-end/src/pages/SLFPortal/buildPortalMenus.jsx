import { Modal, Space, Button, Descriptions, Tag, Badge, Menu } from "antd";
import dayjs from "dayjs";
import {
  DashboardOutlined,
  FileTextOutlined,
  HistoryOutlined,
  ContainerOutlined,
  FolderOpenOutlined,
  AuditOutlined,
  UserOutlined,
  LogoutOutlined,
} from "@ant-design/icons";
import { ORGANIZE_CELLS_ENABLED } from "./constants";
import embLogo from "../../assets/emblogo.svg";
import { Text } from "./portalShared";

export default function buildPortalMenus({
  activeMenu, activeSlfName, collapsed, fetchSupportTickets, getPortalNotificationMeta,
  isMessageNotification, isMobile, isSupportNotification, markPortalNotificationRead,
  markPortalNotificationsRead, notifDetail, openCellOrganizer, portalNotifications,
  portalUnreadCount, portalUser, queueAttentionCount, revealBaselineCard, setActiveMenu,
  setActiveTab, setMessageDrawerOpen, setMobileDrawer, setNotifDetail, setNotificationPanelOpen,
  setPreviousNotifOpen, setSupportDrawerOpen, setSupportTab, submissions, supportTickets,
  unplacedSubmissions,
}) {
  const revertedCount = submissions.filter(
    (s) => s.status === "reverted",
  ).length;
  const unreadPortalNotifications = portalNotifications.filter(
    (notification) => !notification.read,
  );
  const portalNotificationCounts = {
    total: portalUnreadCount,
    messages: unreadPortalNotifications.filter(isMessageNotification).length,
    support: unreadPortalNotifications.filter(isSupportNotification).length,
    history: unreadPortalNotifications.filter((notification) =>
      [
        "reverted",
        "status_change",
        "submission_edit_approved",
        "submission_edit_rejected",
      ].includes(notification.type),
    ).length,
    requests: unreadPortalNotifications.filter((notification) =>
      ["baseline_update_approved", "baseline_update_rejected"].includes(
        notification.type,
      ),
    ).length,
  };
  const historyBadgeCount = revertedCount + portalNotificationCounts.history;
  const openPortalNotification = async (notification) => {
    const meta = getPortalNotificationMeta(notification);
    if (meta.action === "messages") {
      setMessageDrawerOpen(true);
      if (supportTickets.length === 0) fetchSupportTickets();
      markPortalNotificationsRead("messages");
    } else if (meta.action === "support") {
      setSupportDrawerOpen(true);
      setSupportTab("my-tickets");
      if (supportTickets.length === 0) fetchSupportTickets();
      markPortalNotificationsRead("support");
    } else if (meta.action === "history") {
      setActiveMenu("history");
      markPortalNotificationsRead("history");
    } else if (meta.action === "requests") {
      setActiveMenu("requests");
      markPortalNotificationsRead("requests");
    } else if (meta.action === "drafts") {
      setActiveMenu("drafts");
      await markPortalNotificationRead(notification);
    } else if (meta.action === "baseline") {
      setActiveMenu("data-entry");
      setActiveTab("baseline");
      // The verified clients are inside the Accredited Haulers card.
      revealBaselineCard("haulers");
      await markPortalNotificationRead(notification);
    } else {
      await markPortalNotificationRead(notification);
    }
    setNotificationPanelOpen(false);
  };


  // ── Previous Notifications (full history) ──
  // Table view of every notification already loaded in portalNotifications — the
  // popover only shows the most recent few. Reuses getPortalNotificationMeta and
  // openPortalNotification; no new data source.

  // Full message + jump-to-context for a single notification opened from the
  // Previous Notifications table.
  const notificationDetailModal = (
    <Modal
      open={!!notifDetail}
      onCancel={() => setNotifDetail(null)}
      width={520}
      title={
        notifDetail ? (
          <Space>
            {getPortalNotificationMeta(notifDetail).icon}
            <span>
              {notifDetail.title ||
                getPortalNotificationMeta(notifDetail).label}
            </span>
          </Space>
        ) : (
          "Notification"
        )
      }
      footer={
        notifDetail ? (
          <Space>
            {getPortalNotificationMeta(notifDetail).action !== "none" && (
              <Button
                type="primary"
                onClick={() => {
                  const target = notifDetail;
                  setNotifDetail(null);
                  setPreviousNotifOpen(false);
                  openPortalNotification(target);
                }}
              >
                Go to details
              </Button>
            )}
            <Button onClick={() => setNotifDetail(null)}>Close</Button>
          </Space>
        ) : null
      }
    >
      {notifDetail && (
        <Descriptions size="small" column={1} bordered>
          <Descriptions.Item label="Type">
            <Tag color={getPortalNotificationMeta(notifDetail).color}>
              {getPortalNotificationMeta(notifDetail).label}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Date / Time">
            {notifDetail.createdAt
              ? dayjs(notifDetail.createdAt).format("MMM D, YYYY h:mm A")
              : "—"}
          </Descriptions.Item>
          <Descriptions.Item label="Status">
            {notifDetail.read ? "Read" : "Unread"}
          </Descriptions.Item>
          <Descriptions.Item label="Message">
            <div
              style={{
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                wordBreak: "break-word",
              }}
            >
              {notifDetail.message || "—"}
            </div>
          </Descriptions.Item>
        </Descriptions>
      )}
    </Modal>
  );

  const menuItems = [
    {
      key: "overview",
      icon: <DashboardOutlined />,
      label: "Dashboard",
    },
    {
      key: "data-entry",
      icon: <FileTextOutlined />,
      label: (
        <span>
          Data Entry
          {portalNotificationCounts.total > 0 &&
            activeMenu !== "data-entry" && (
              <Badge dot style={{ marginLeft: 8 }} />
            )}
        </span>
      ),
    },
    {
      key: "history",
      icon: <HistoryOutlined />,
      label: (
        <span>
          Submission History
          {historyBadgeCount > 0 && (
            <Badge
              count={historyBadgeCount}
              size="small"
              style={{ marginLeft: 8, backgroundColor: "#fa541c" }}
            />
          )}
        </span>
      ),
    },
    // {
    //   key: "cell-placement",
    //   icon: <ContainerOutlined />,
    //   label: (
    //     <span>
    //       Organize Cells
    //       {unplacedSubmissions.length > 0 && (
    //         <Badge
    //           count={unplacedSubmissions.length}
    //           size="small"
    //           style={{ marginLeft: 8, backgroundColor: "#722ed1" }}
    //         />
    //       )}
    //     </span>
    //   ),
    // },
    ...(ORGANIZE_CELLS_ENABLED
      ? [
          {
            key: "cell-placement",
            icon: <ContainerOutlined />,
            label: (
              <span>
                Organize Cells
                {unplacedSubmissions.length > 0 && (
                  <Badge
                    count={unplacedSubmissions.length}
                    size="small"
                    style={{ marginLeft: 8, backgroundColor: "#722ed1" }}
                  />
                )}
              </span>
            ),
          },
        ]
      : []),
    {
      key: "drafts",
      icon: <FileTextOutlined />,
      label: (
        <span>
          Drafts & Scheduled
          {queueAttentionCount > 0 && (
            <Badge
              count={queueAttentionCount}
              size="small"
              style={{ marginLeft: 8, backgroundColor: "#fa541c" }}
            />
          )}
        </span>
      ),
    },
     {
      key: "documents",
      icon: <FolderOpenOutlined />,
      label: (
        <span>
          My Documents
          <Tag color="green" style={{ marginLeft: 8, fontSize: 10, lineHeight: "16px", padding: "0 5px" }}>
            NEW
          </Tag>
        </span>
      ),
    },
    {
      key: "requests",
      icon: <AuditOutlined />,
      label: (
        <span>
          My Requests
          {portalNotificationCounts.requests > 0 && (
            <Badge
              count={portalNotificationCounts.requests}
              size="small"
              style={{ marginLeft: 8, backgroundColor: "#1677ff" }}
            />
          )}
        </span>
      ),
    },
  ];

  const siderContent = (
    <div>
      <div className="portal-sider-logo">
        <img
          src={embLogo}
          alt="EMBR3"
          style={{ width: 36, marginRight: collapsed && !isMobile ? 0 : 10 }}
        />
        {(!collapsed || isMobile) && (
          <div>
            <Text
              strong
              style={{
                color: "#fff",
                fontSize: 14,
                display: "block",
                lineHeight: 1.2,
              }}
            >
              SLF Portal
            </Text>
            <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 11 }}>
              EMBR3 ESWMP
            </Text>
          </div>
        )}
      </div>
      <Menu
        mode="inline"
        selectedKeys={[activeMenu]}
        onClick={({ key }) => {
          if (key === "cell-placement") {
            openCellOrganizer();
            if (isMobile) setMobileDrawer(false);
            return;
          }
          setActiveMenu(key);
          if (key === "history") markPortalNotificationsRead("history");
          if (key === "requests") markPortalNotificationsRead("requests");
          if (isMobile) setMobileDrawer(false);
        }}
        items={menuItems}
        style={{ background: "transparent", borderRight: 0, color: "#fff" }}
        theme="dark"
      />
    </div>
  );

  const userDisplay = portalUser
    ? `${portalUser.firstName} ${portalUser.lastName}`
    : "";

  const userMenuItems = [
    {
      key: "info",
      label: (
        <div style={{ padding: "4px 0" }}>
          <Text strong style={{ display: "block" }}>
            {userDisplay}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {portalUser?.email}
          </Text>
          <br />
          <Tag color="blue" style={{ marginTop: 4 }}>
            {activeSlfName}
          </Tag>
        </div>
      ),
      disabled: true,
    },
    { type: "divider" },
    // The profile picture is changed from the camera button on the avatar in
    // View Profile (ProfilePhotoEditor, cameraOnly).
    { key: "profile", icon: <UserOutlined />, label: "View Profile" },
    { key: "logout", icon: <LogoutOutlined />, label: "Logout", danger: true },
  ];

  return {
    notificationDetailModal, openPortalNotification, portalNotificationCounts, siderContent,
    userDisplay, userMenuItems,
  };
}
