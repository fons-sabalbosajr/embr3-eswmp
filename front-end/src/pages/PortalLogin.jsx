import { useEffect, useRef, useState } from "react";
import { Form, Input, Button, Card, Typography, Divider, Alert, Space, Tag, Collapse, Modal, Select } from "antd";
import {
  UserOutlined,
  LockOutlined,
  SafetyCertificateOutlined,
  NotificationOutlined,
  CalendarOutlined,
  InfoCircleOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
} from "@ant-design/icons";
import { Link, useNavigate } from "react-router-dom";
import { useErrorCard } from "../utils/ErrorHandler";
import api from "../api";
import secureStorage from "../utils/secureStorage";
import AuthBrandLogos from "../components/AuthBrandLogos";
import bgEmb from "../assets/bgemb.webp";
import "./Auth.css";
import VeraAuthAssistant, { reportVeraAuthIssue } from "../components/VeraAuthAssistant";

const { Title, Text } = Typography;

const announcementTypeMeta = {
  info: {
    icon: <InfoCircleOutlined />,
    iconClassName: "auth-announcement-type-icon-info",
    tagColor: "blue",
    label: "Information",
  },
  success: {
    icon: <CheckCircleOutlined />,
    iconClassName: "auth-announcement-type-icon-success",
    tagColor: "green",
    label: "Update",
  },
  warning: {
    icon: <ExclamationCircleOutlined />,
    iconClassName: "auth-announcement-type-icon-warning",
    tagColor: "orange",
    label: "Important",
  },
  error: {
    icon: <ExclamationCircleOutlined />,
    iconClassName: "auth-announcement-type-icon-error",
    tagColor: "red",
    label: "Urgent",
  },
};

export default function PortalLogin() {
  const [loading, setLoading] = useState(false);
  const [portalSettings, setPortalSettings] = useState(null);
  const [announcement, setAnnouncement] = useState(null);
  const [credentialModalOpen, setCredentialModalOpen] = useState(false);
  const [credentialCodeRequested, setCredentialCodeRequested] = useState(false);
  const [credentialLoading, setCredentialLoading] = useState(false);
  const [pendingCredentialLogin, setPendingCredentialLogin] = useState(null);
  const [credentialForm] = Form.useForm();
  // Developer override → portal impersonation (staged: override → PIN → select).
  const [devModalOpen, setDevModalOpen] = useState(false);
  const [devStage, setDevStage] = useState("pin");
  const [devStageToken, setDevStageToken] = useState("");
  const [devSessionToken, setDevSessionToken] = useState("");
  const [devPortalUsers, setDevPortalUsers] = useState([]);
  const [devSelectedUser, setDevSelectedUser] = useState(null);
  const [devLoading, setDevLoading] = useState(false);
  const [devForm] = Form.useForm();
  const navigate = useNavigate();
  const { showError, card: errorCard } = useErrorCard();
  const announcementType = announcement?.portalAnnouncementType || "info";
  const announcementMeta =
    announcementTypeMeta[announcementType] || announcementTypeMeta.info;
  const portalMaintenanceActive = !!portalSettings?.portalMaintenanceMode;
  const portalMaintenanceMessage =
    portalSettings?.portalMaintenanceMessage ||
    portalSettings?.portalMaintenanceReason ||
    "The portal is currently under maintenance. Please try again later.";

  useEffect(() => {
    api
      .get("/settings/app")
      .then(({ data }) => {
        setPortalSettings(data);
        const now = Date.now();
        const startsAt = data.portalAnnouncementStartAt
          ? new Date(data.portalAnnouncementStartAt).getTime()
          : null;
        const endsAt = data.portalAnnouncementEndAt
          ? new Date(data.portalAnnouncementEndAt).getTime()
          : null;
        const isActive =
          data.portalAnnouncementEnabled &&
          data.portalAnnouncementShowOnLogin !== false &&
          (!startsAt || startsAt <= now) &&
          (!endsAt || endsAt >= now);
        setAnnouncement(isActive ? data : null);
      })
      .catch(() => {});
  }, []);

  // Show a clear "session expired" message when the API client redirected here
  // after an invalid/expired token (set in api.js), instead of a generic error.
  useEffect(() => {
    try {
      if (secureStorage.sessionGet("session_expired") === "1") {
        secureStorage.sessionRemove("session_expired");
        showError({ type: "warning", title: "Session Expired", message: "Your session has expired. Please sign in again to continue." });
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Maintenance disables sign-in AND password recovery, so offer VERA the moment
  // that state is known rather than after the user has tried and failed.
  useEffect(() => {
    if (portalMaintenanceActive) reportVeraAuthIssue("maintenance");
  }, [portalMaintenanceActive]);

  // Hard guard against duplicate auth requests: a fast double-click, an Enter-key
  // repeat, or a Strict-Mode re-invocation must never fire a second in-flight
  // login (each extra request counts against the auth rate limiter → 429).
  const loginInFlight = useRef(false);

  const onFinish = async (values) => {
    if (loginInFlight.current) return;
    loginInFlight.current = true;
    setLoading(true);
    try {
      const { data } = await api.post("/portal-auth/login", values);
      if (data.user?.allowCredentialSelfService) {
        setPendingCredentialLogin({
          token: data.token,
          user: data.user,
          needsVerification: data.needsVerification,
        });
        credentialForm.setFieldsValue({
          email: data.user.email || values.email,
          username: data.user.username || data.user.email?.split("@")?.[0] || "",
          password: "",
          code: "",
        });
        setCredentialCodeRequested(false);
        setCredentialModalOpen(true);
        return;
      }
      secureStorage.set("portal_token", data.token);
      secureStorage.setJSON("portal_user", data.user);
      // Redirect held users to the verification update form
      if (data.needsVerification) {
        navigate("/slfportal/verify-update");
      } else {
        navigate("/slfportal");
      }
    } catch (err) {
      // Developers sign in through these same fields — no separate entry point.
      // When the credentials belong to an active developer account, surface the
      // Dev Portal PIN step instead of a normal login error.
      const status = err.response?.status;
      if (navigator.onLine && (status === 401 || status === 404)) {
        const handledAsDeveloper = await tryDeveloperLogin(values);
        if (handledAsDeveloper) return;
      }
      // Offer VERA alongside the error dialog: the modal states WHAT went wrong,
      // the hint offers help working out what to do about it.
      if (!navigator.onLine) {
        showError({ type: "offline", title: "You're Offline", message: "It seems you are not connected to the internet. Please check your connection and try again." });
        reportVeraAuthIssue("offline");
      } else if (status === 429) {
        showError({ type: "warning", title: "Too Many Attempts", message: err.response?.data?.message || "Too many login attempts. Please wait a few minutes and try again." });
        reportVeraAuthIssue("rate_limited");
      } else {
        showError({ type: "error", title: "Login Failed", message: err.response?.data?.message || "Something went wrong" });
        reportVeraAuthIssue("login_failed");
      }
    } finally {
      loginInFlight.current = false;
      setLoading(false);
    }
  };

  // Detect developer credentials entered in the normal portal login fields.
  // Returns true when the attempt was handled as a developer (PIN prompt shown
  // or a developer-specific error surfaced), false when it's not a developer so
  // the caller falls back to the standard portal login error.
  const tryDeveloperLogin = async ({ email, password }) => {
    try {
      const { data } = await api.post("/dev-portal/override", { email, password });
      devForm.resetFields();
      setDevStageToken(data.stageToken);
      setDevStage("pin");
      setDevModalOpen(true);
      return true;
    } catch (err) {
      const status = err.response?.status;
      // 400 = valid developer but no PIN configured; 403 = deactivated developer.
      if (status === 400 || status === 403) {
        showError({
          type: "error",
          title: "Developer Access",
          message: err.response?.data?.message || "Developer access is unavailable.",
        });
        return true;
      }
      // 401/other = not a developer → let the normal portal error show.
      return false;
    }
  };

  const resetDevFlow = () => {
    setDevModalOpen(false);
    setDevStage("pin");
    setDevStageToken("");
    setDevSessionToken("");
    setDevPortalUsers([]);
    setDevSelectedUser(null);
    devForm.resetFields();
  };

  const submitDevPin = async () => {
    try {
      const v = await devForm.validateFields(["pin"]);
      setDevLoading(true);
      const { data } = await api.post(
        "/dev-portal/verify-pin",
        { pin: v.pin },
        { headers: { Authorization: `Bearer ${devStageToken}` } },
      );
      setDevSessionToken(data.sessionToken);
      const { data: users } = await api.get("/dev-portal/portal-users", {
        headers: { Authorization: `Bearer ${data.sessionToken}` },
      });
      setDevPortalUsers(Array.isArray(users) ? users : []);
      setDevStage("select");
    } catch (err) {
      if (err?.errorFields) return;
      Modal.error({ title: "PIN verification failed", content: err.response?.data?.message || "Incorrect PIN." });
    } finally {
      setDevLoading(false);
    }
  };

  const startImpersonation = async () => {
    if (!devSelectedUser) return;
    try {
      setDevLoading(true);
      const { data } = await api.post(
        "/dev-portal/impersonate",
        { portalUserId: devSelectedUser },
        { headers: { Authorization: `Bearer ${devSessionToken}` } },
      );
      secureStorage.set("portal_token", data.token);
      // The token issued here is the DEVELOPER's, carrying an explicit portal
      // context — it is not the portal user's own token. The session is read-only
      // and the backend enforces that; these flags only drive the UI badge and
      // disable the write controls.
      secureStorage.setJSON("portal_user", {
        ...data.user,
        devImpersonation: true,
        developerContext: true,
        readOnly: data.readOnly !== false,
        developerEmail: data.developerEmail || "",
      });
      resetDevFlow();
      navigate("/slfportal");
    } catch (err) {
      Modal.error({ title: "Could not start session", content: err.response?.data?.message || "Failed to start debug session." });
    } finally {
      setDevLoading(false);
    }
  };

  const requestCredentialCode = async () => {
    try {
      const values = await credentialForm.validateFields(["email", "username", "password"]);
      setCredentialLoading(true);
      await api.post("/portal-auth/credentials/request-code", values, {
        headers: pendingCredentialLogin?.token
          ? { Authorization: `Bearer ${pendingCredentialLogin.token}` }
          : undefined,
      });
      setCredentialCodeRequested(true);
      Modal.success({
        title: "Verification code sent",
        content: "Please check your registered email for the 6-digit verification code.",
      });
    } catch (err) {
      if (err?.errorFields) return;
      Modal.error({
        title: "Could not send code",
        content: err.response?.data?.message || "Please check your registered email and try again.",
      });
    } finally {
      setCredentialLoading(false);
    }
  };

  const updateCredentials = async () => {
    try {
      const values = await credentialForm.validateFields();
      setCredentialLoading(true);
      await api.post("/portal-auth/credentials/update", values, {
        headers: pendingCredentialLogin?.token
          ? { Authorization: `Bearer ${pendingCredentialLogin.token}` }
          : undefined,
      });
      setCredentialModalOpen(false);
      setCredentialCodeRequested(false);
      setPendingCredentialLogin(null);
      credentialForm.resetFields();
      Modal.success({
        title: "Credentials updated",
        content: "You can now log in using your updated username and password.",
      });
    } catch (err) {
      if (err?.errorFields) return;
      Modal.error({
        title: "Could not update credentials",
        content: err.response?.data?.message || "Please verify the code and try again.",
      });
    } finally {
      setCredentialLoading(false);
    }
  };

  return (
    <div className="auth-page">
      {errorCard}
      <div className="auth-page-bg" style={{ backgroundImage: `url(${bgEmb})` }} />
      <div className="auth-page-overlay" />
      <div className="auth-page-sweep" />
      <div className="auth-page-grid" />
      <div className="auth-orb auth-orb-1" />
      <div className="auth-orb auth-orb-2" />
      <div className="auth-orb auth-orb-3" />

      <div className="auth-center">
        <div className="auth-brand-header">
          <AuthBrandLogos />
          <Title level={2} className="auth-brand-title">SLF Portal</Title>
          <Text className="auth-brand-subtitle">Sanitary Landfill Generators Portal</Text>
          <div className="auth-features">
            <span className="auth-feature-item"><span className="auth-feature-dot" />SLF Data Submission</span>
            <span className="auth-feature-item"><span className="auth-feature-dot" />Track Your Submissions</span>
            <span className="auth-feature-item"><span className="auth-feature-dot" />Real-time Status Updates</span>
          </div>
        </div>

        <div className="auth-card-wrapper auth-card-wrapper-login">
          {portalMaintenanceActive && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 14, textAlign: "left" }}
              message="Portal maintenance in progress"
              description={portalMaintenanceMessage}
            />
          )}
          {announcement && (
            <Collapse
              className="auth-announcement-collapse"
              size="small"
              defaultActiveKey={[]}
              style={{ marginBottom: 14, textAlign: "left" }}
              items={[{
                key: "announcement",
                label: (
                  <div className="auth-announcement-header">
                    <div className="auth-announcement-heading">
                      <span className="auth-announcement-bell">
                        <NotificationOutlined />
                      </span>
                      <div className="auth-announcement-heading-copy">
                        <div className="auth-announcement-title-row">
                          <span className="auth-announcement-title-text">
                            {announcement.portalAnnouncementTitle || "SLF Portal Announcement"}
                          </span>
                          <Tag color={announcementMeta.tagColor} className="auth-announcement-tag">
                            {announcementMeta.label}
                          </Tag>
                        </div>
                        <div className="auth-announcement-subline">
                          <span className={`auth-announcement-type-icon ${announcementMeta.iconClassName}`}>
                            {announcementMeta.icon}
                          </span>
                          <span>Posted advisory</span>
                          <span className="auth-announcement-subline-sep">•</span>
                          <CalendarOutlined />
                          <span>
                            {announcement.portalAnnouncementStartAt
                              ? new Date(announcement.portalAnnouncementStartAt).toLocaleDateString()
                              : "Active now"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ),
                children: (
                  <div className="auth-announcement-body">
                    <div className="auth-announcement-body-meta">
                      <span className={`auth-announcement-type-icon ${announcementMeta.iconClassName}`}>
                        {announcementMeta.icon}
                      </span>
                      <Text className="auth-announcement-body-label">
                        {announcementMeta.label} notice for portal users
                      </Text>
                    </div>
                    <div className="auth-announcement-scroll">
                      <div className="auth-announcement-message">
                        {announcement.portalAnnouncementMessage}
                      </div>
                    </div>
                  </div>
                ),
              }]}
            />
          )}
          <Card className="auth-card" variant="borderless">
            <div className="auth-card-header">
              <div className="auth-avatar"><UserOutlined /></div>
              <Title level={3} className="auth-card-title">Portal Login</Title>
              <Text className="auth-card-subtitle">Sign in with your portal account</Text>
              <div className="auth-card-badge auth-card-badge-portal">SLF Portal</div>
            </div>

            <Form name="portal-login" size="large" onFinish={onFinish} layout="vertical" requiredMark={false} className="auth-form">
              <Form.Item name="email" label="Email" rules={[{ required: true, message: "Please enter your email" }]}>
                <Input prefix={<UserOutlined style={{ color: "#1a3353" }} />} placeholder="email address" disabled={portalMaintenanceActive} />
              </Form.Item>
              <Form.Item name="password" label="Password" rules={[{ required: true, message: "Please enter your password" }]}>
                <Input.Password prefix={<LockOutlined style={{ color: "#1a3353" }} />} placeholder="password" disabled={portalMaintenanceActive} />
              </Form.Item>
              <Form.Item style={{ marginBottom: 16, marginTop: 8 }}>
                <Button className="auth-btn-primary" type="primary" htmlType="submit" loading={loading} block disabled={portalMaintenanceActive}>Sign In</Button>
              </Form.Item>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: -8, marginBottom: 8, flexWrap: "wrap" }}>
                {/* <Button
                  type="link"
                  size="small"
                  className="auth-forgot-link"
                  style={{ padding: 0 }}
                  onClick={() => {
                    setCredentialModalOpen(true);
                    setCredentialCodeRequested(false);
                    setPendingCredentialLogin(null);
                    credentialForm.resetFields();
                  }}
                >
                  Update credentials
                </Button> */}
                {portalMaintenanceActive ? (
                  <Text type="secondary">Password recovery is unavailable during maintenance.</Text>
                ) : (
                  <Link to="/slfportal/forgot-password" className="auth-forgot-link">Forgot password?</Link>
                )}
              </div>
            </Form>

            <Divider plain className="auth-divider">
              <Text type="secondary" style={{ fontSize: 13 }}>Don&apos;t have an account?</Text>
            </Divider>
            <div style={{ textAlign: "center" }}>
              {portalMaintenanceActive ? (
                <Button className="auth-btn-secondary" type="default" block disabled>
                  Registration unavailable during maintenance
                </Button>
              ) : (
                <Link to="/slfportal/signup">
                  <Button className="auth-btn-secondary" type="default" block>Register for Portal</Button>
                </Link>
              )}
            </div>
          </Card>
        </div>
      </div>

      <div className="auth-page-footer">&copy; 2026 EMBR3 &mdash; Ecological Solid Waste Management Section</div>
      <Modal
        title={
          <Space>
            <SafetyCertificateOutlined />
            {pendingCredentialLogin ? "Credential Update Required" : "Update Portal Credentials"}
          </Space>
        }
        open={credentialModalOpen}
        maskClosable={!pendingCredentialLogin}
        keyboard={!pendingCredentialLogin}
        onCancel={() => {
          setCredentialModalOpen(false);
          setCredentialCodeRequested(false);
          setPendingCredentialLogin(null);
        }}
        footer={[
          <Button
            key="cancel"
            onClick={() => {
              setCredentialModalOpen(false);
              setCredentialCodeRequested(false);
              setPendingCredentialLogin(null);
            }}
          >
            {pendingCredentialLogin ? "Back to Login" : "Cancel"}
          </Button>,
          <Button key="code" loading={credentialLoading} onClick={requestCredentialCode}>
            Send Code
          </Button>,
          <Button
            key="update"
            type="primary"
            loading={credentialLoading}
            disabled={!credentialCodeRequested}
            onClick={updateCredentials}
          >
            Save Credentials
          </Button>,
        ]}
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 14 }}
          message="Email verification is required before saving credential changes."
          description={
            pendingCredentialLogin
              ? "Your administrator enabled credential updating for this account. Please update your username and/or password before entering the portal."
              : "This option is available only when the administrator enables credential updates for your portal account."
          }
        />
        <Form form={credentialForm} layout="vertical" requiredMark={false}>
          <Form.Item
            name="email"
            label="Registered Email"
            rules={[
              { required: true, message: "Enter your registered email" },
              { type: "email", message: "Enter a valid email" },
            ]}
          >
            <Input prefix={<UserOutlined />} placeholder="email address" />
          </Form.Item>
          <Form.Item
            name="username"
            label="New Username"
            rules={[{ required: true, message: "Username is required" }]}
          >
            <Input prefix={<UserOutlined />} placeholder="New username" />
          </Form.Item>
          <Form.Item
            name="password"
            label="New Password"
            extra="Leave blank only if you want to update the username."
            rules={[{ min: 6, message: "Password must be at least 6 characters" }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="New password" />
          </Form.Item>
          <Form.Item
            name="code"
            label="Verification Code"
            rules={[{ required: true, message: "Enter the verification code" }]}
          >
            <Input placeholder="6-digit code" disabled={!credentialCodeRequested} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={
          <Space>
            <SafetyCertificateOutlined />
            Developer Portal Access (Debug)
          </Space>
        }
        open={devModalOpen}
        onCancel={resetDevFlow}
        footer={
          devStage === "pin"
            ? [
                <Button key="cancel" onClick={resetDevFlow}>Cancel</Button>,
                <Button key="verify" type="primary" loading={devLoading} onClick={submitDevPin}>Verify PIN</Button>,
              ]
            : [
                <Button key="cancel" onClick={resetDevFlow}>Cancel</Button>,
                <Button key="start" type="primary" danger loading={devLoading} disabled={!devSelectedUser} onClick={startImpersonation}>
                  Start Debug Session
                </Button>,
              ]
        }
        destroyOnHidden
        width={900}
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 14 }}
          message="Developer-only debug access"
          description="Your developer credentials were verified. Enter the Dev Portal PIN to open a selected portal user's session for debugging. Every impersonation is logged."
        />
        <Form form={devForm} layout="vertical" requiredMark={false}>
          {devStage === "pin" && (
            <Form.Item name="pin" label="Dev Portal PIN" rules={[{ required: true, message: "Enter the PIN" }]}>
              <Input.Password inputMode="numeric" maxLength={8} placeholder="PIN" autoComplete="off" autoFocus />
            </Form.Item>
          )}
          {devStage === "select" && (
            <Form.Item label="Select a portal user to debug">
              <Select
                showSearch
                placeholder="Choose a portal account"
                value={devSelectedUser}
                onChange={setDevSelectedUser}
                optionFilterProp="label"
                options={devPortalUsers.map((u) => {
                  const slf = Array.isArray(u.assignedSlfName) ? u.assignedSlfName.filter(Boolean).join(", ") : u.assignedSlfName;
                  const name = `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.companyName || u.email;
                  return {
                    value: u._id,
                    label: `${slf ? `${slf} — ` : ""}${name} · ${u.email}`.trim(),
                  };
                })}
                style={{ width: "100%" }}
              />
            </Form.Item>
          )}
        </Form>
      </Modal>
      <VeraAuthAssistant page="portal-login" />
    </div>
  );
}
