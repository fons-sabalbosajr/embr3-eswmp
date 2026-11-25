import { Header, Text } from "./portalShared";
import { Space, Button, Popover, Badge, Tooltip, Dropdown } from "antd";
import { MenuOutlined, BellOutlined, MessageOutlined, CustomerServiceOutlined } from "@ant-design/icons";
import HeaderClock from "./HeaderClock";
import PortalNotificationPanel from "./PortalNotificationPanel";
import { ProfileAvatar } from "../../components/ProfilePhotoEditor";

export default function PortalHeader({
  fetchSupportTickets, handleLogout, isMobile, markPortalNotificationsRead, notificationPanelOpen,
  portalNotificationCounts, portalNotifications, portalUser, setMessageDrawerOpen, setMobileDrawer,
  setNotificationPanelOpen, setPreviousNotifOpen, setProfileModalOpen, setSupportDrawerOpen,
  setSupportTab, stableNotificationMeta, stableOpenNotification, supportTickets, userDisplay,
  userMenuItems,
}) {
  return (
    <Header
      className="portal-header"
      style={{
        background: "#fff",
        padding: "0 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
        position: "sticky",
        top: 0,
        zIndex: 9,
        height: 56,
      }}
    >
      <Space>
        {isMobile && (
          <Button
            type="text"
            icon={<MenuOutlined />}
            onClick={() => setMobileDrawer(true)}
          />
        )}
        <HeaderClock compact={isMobile} />
      </Space>
      <Space size={8}>
        <Popover
          trigger="click"
          placement="bottomRight"
          open={notificationPanelOpen}
          onOpenChange={setNotificationPanelOpen}
          content={
            <PortalNotificationPanel
              isMobile={isMobile}
              portalNotifications={portalNotifications}
              portalNotificationCounts={portalNotificationCounts}
              getPortalNotificationMeta={stableNotificationMeta}
              openPortalNotification={stableOpenNotification}
              markPortalNotificationsRead={markPortalNotificationsRead}
              setNotificationPanelOpen={setNotificationPanelOpen}
              setPreviousNotifOpen={setPreviousNotifOpen}
            />
          }
        >
          <Badge count={portalNotificationCounts.total} size="small">
            <Button
              type={
                portalNotificationCounts.total > 0 ? "primary" : "default"
              }
              shape="circle"
              icon={<BellOutlined />}
              aria-label="Open notifications"
            />
          </Badge>
        </Popover>
        <Tooltip title="Messages from admin">
          <Badge count={portalNotificationCounts.messages} size="small">
            <Button
              type={
                portalNotificationCounts.messages > 0
                  ? "primary"
                  : "default"
              }
              shape="circle"
              icon={<MessageOutlined />}
              onClick={() => {
                setMessageDrawerOpen(true);
                if (supportTickets.length === 0) fetchSupportTickets();
                markPortalNotificationsRead("messages");
              }}
            />
          </Badge>
        </Tooltip>
        <Tooltip title="Support tickets">
          <Badge count={portalNotificationCounts.support} size="small">
            <Button
              shape="circle"
              icon={<CustomerServiceOutlined />}
              onClick={() => {
                setSupportDrawerOpen(true);
                setSupportTab("my-tickets");
                if (supportTickets.length === 0) fetchSupportTickets();
                markPortalNotificationsRead("support");
              }}
            />
          </Badge>
        </Tooltip>
        <Dropdown
          menu={{
            items: userMenuItems,
            onClick: ({ key }) => {
              if (key === "profile") setProfileModalOpen(true);
              if (key === "logout") handleLogout();
            },
          }}
          trigger={["click"]}
        >
          <Space style={{ cursor: "pointer" }}>
            <ProfileAvatar
              size="small"
              photoUrl={portalUser?.profilePhoto?.url}
              fallback={portalUser?.firstName?.[0]?.toUpperCase()}
              style={{
                background: "linear-gradient(135deg, #1a3353, #2d5f8a)",
              }}
            />
            {!isMobile && (
              <Text style={{ color: "#1a3353", fontWeight: 500 }}>
                {userDisplay}
              </Text>
            )}
          </Space>
        </Dropdown>
      </Space>
    </Header>
  );
}
