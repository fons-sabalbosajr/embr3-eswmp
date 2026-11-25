import { EyeOutlined, WifiOutlined, BellOutlined, MessageOutlined, CustomerServiceOutlined } from "@ant-design/icons";
import { Text } from "./portalShared";
import { Tag, Collapse, Space, Button, Alert, Card } from "antd";
import dayjs from "dayjs";

export default function PortalNoticeBanners({
  activeSlfName, announcementBannerRef, announcementDismissed, dismissAnnouncement,
  fetchSupportTickets, isDeveloperContext, isOnline, isPlanningUnitView, isPortalUpdateAnnouncement,
  markPortalNotificationsRead, openPortalUpdateTour, portalAnnouncement, portalNotificationCounts,
  portalUser, setMessageDrawerOpen, setSupportDrawerOpen, setSupportTab, supportTickets,
  uiPrefsLoaded,
}) {
  return (
    <>
      {isDeveloperContext && (
        <div
          className="slf-dev-banner"
          style={{
            background: isPlanningUnitView
              ? "linear-gradient(90deg, #0e1e35 0%, #1a3353 100%)"
              : "linear-gradient(90deg, #531dab 0%, #722ed1 100%)",
            color: "#fff",
            padding: "10px 16px",
            borderRadius: 8,
            marginBottom: 12,
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 10,
            fontSize: 13,
          }}
        >
          <EyeOutlined />
          <Text strong style={{ color: "#fff" }}>
            {isPlanningUnitView ? "Planning Unit View" : "Developer View"}
          </Text>
          {/* The dot separators only make sense while this reads as one line.
              Below md the banner wraps into stacked rows and they are hidden
              (see .slf-dev-banner), where they would otherwise dangle at the
              end of a line as stray punctuation. */}
          <span className="slf-dev-banner-sep" style={{ opacity: 0.75 }}>·</span>
          <span className="slf-dev-banner-field">
            Viewing: <strong>{activeSlfName || "—"}</strong>
          </span>
          <span className="slf-dev-banner-sep" style={{ opacity: 0.75 }}>·</span>
          <span className="slf-dev-banner-field">
            Portal User:{" "}
            <strong>
              {[portalUser?.firstName, portalUser?.lastName].filter(Boolean).join(" ") ||
                portalUser?.email}
            </strong>
          </span>
          {/* `margin-inline-start: auto` right-aligns the tag on a single-line
              banner, but once the banner wraps it strands the tag alone on the
              last row. The class drops the auto margin below md. */}
          {/* The mode WRITES now, so the banner has to say so. A stale
              "READ-ONLY" tag over a session that can submit, save a baseline
              and delete a draft is worse than no tag: it tells the developer
              their next click is safe when it is not. */}
          {isPlanningUnitView ? (
            <Tag
              className="slf-dev-banner-tag"
              color="gold"
              style={{ marginInlineStart: "auto", marginInlineEnd: 0 }}
            >
              VIEW-ONLY
              {portalUser?.planningUnitValidUntil
                ? ` · access until ${dayjs(portalUser.planningUnitValidUntil).format("MMM D, YYYY")}`
                : ""}
            </Tag>
          ) : (
            <Tag
              className="slf-dev-banner-tag"
              color="volcano"
              style={{ marginInlineStart: "auto", marginInlineEnd: 0 }}
            >
              FULL CONTROL — WRITES ARE LIVE
            </Tag>
          )}
        </div>
      )}
      {!isOnline && (
        <div
          style={{
            background: "linear-gradient(90deg, #7c3a10 0%, #b45309 100%)",
            color: "#fff",
            padding: "8px 16px",
            borderRadius: 8,
            marginBottom: 12,
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          <WifiOutlined />
          You are currently offline. Some features may be unavailable. Data
          will be sent once your connection is restored.
        </div>
      )}
      {/* `uiPrefsLoaded` gates the banner so a dismissed announcement is never
          rendered and then yanked away. If the preference read fails the flag
          still flips, so the banner shows — an announcement seen twice beats
          one that is never seen. */}
      {portalAnnouncement && uiPrefsLoaded && !announcementDismissed && (
        <div ref={announcementBannerRef}>
          <Collapse
          size="small"
          style={{
            marginBottom: 12,
            borderRadius: 8,
          }}
          items={[
            {
              key: "announcement",
              label: (
                <Space wrap>
                  <Text strong>
                    {portalAnnouncement.portalAnnouncementTitle ||
                      "SLF Portal Announcement"}
                  </Text>
                  <Tag color="blue">Announcement</Tag>
                </Space>
              ),
              extra: (
                <Space size={4} onClick={(event) => event.stopPropagation()}>
                  {isPortalUpdateAnnouncement && (
                    <Button
                      size="small"
                      type="text"
                      onClick={() => openPortalUpdateTour()}
                    >
                      What's New Tour
                    </Button>
                  )}
                  {portalAnnouncement.portalAnnouncementDismissible !== false ? (
                    <Button
                      size="small"
                      type="text"
                      onClick={() => {
                        dismissAnnouncement();
                      }}
                    >
                      Dismiss
                    </Button>
                  ) : null}
                </Space>
              ),
              children: (
                <Alert
                  type={portalAnnouncement.portalAnnouncementType || "info"}
                  showIcon
                  message={null}
                  description={
                    <Space
                      direction="vertical"
                      size={8}
                      style={{ width: "100%" }}
                    >
                      <div style={{ whiteSpace: "pre-wrap" }}>
                        {portalAnnouncement.portalAnnouncementMessage}
                      </div>
                    </Space>
                  }
                />
              ),
            },
          ]}
          />
        </div>
      )}
      {(portalNotificationCounts.messages > 0 ||
        portalNotificationCounts.support > 0) && (
        <Card
          size="small"
          style={{
            marginBottom: 12,
            borderRadius: 8,
            borderColor: "#91caff",
            background: "#e6f4ff",
          }}
          bodyStyle={{ padding: "10px 14px" }}
        >
          <Space
            wrap
            style={{ width: "100%", justifyContent: "space-between" }}
          >
            <Space>
              <BellOutlined style={{ color: "#1677ff" }} />
              <Text strong>You have unread admin updates</Text>
              {portalNotificationCounts.messages > 0 && (
                <Tag color="blue">
                  {portalNotificationCounts.messages} message(s)
                </Tag>
              )}
              {portalNotificationCounts.support > 0 && (
                <Tag color="purple">
                  {portalNotificationCounts.support} ticket update(s)
                </Tag>
              )}
            </Space>
            <Space>
              {portalNotificationCounts.messages > 0 && (
                <Button
                  size="small"
                  type="primary"
                  icon={<MessageOutlined />}
                  onClick={() => {
                    setMessageDrawerOpen(true);
                    if (supportTickets.length === 0) fetchSupportTickets();
                    markPortalNotificationsRead("messages");
                  }}
                >
                  Open Messages
                </Button>
              )}
              {portalNotificationCounts.support > 0 && (
                <Button
                  size="small"
                  icon={<CustomerServiceOutlined />}
                  onClick={() => {
                    setSupportDrawerOpen(true);
                    setSupportTab("my-tickets");
                    if (supportTickets.length === 0) fetchSupportTickets();
                    markPortalNotificationsRead("support");
                  }}
                >
                  View Tickets
                </Button>
              )}
            </Space>
          </Space>
        </Card>
      )}
    </>
  );
}
