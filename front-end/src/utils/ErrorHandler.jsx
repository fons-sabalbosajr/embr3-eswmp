import { useState, useEffect, useCallback, Component } from "react";
import { Modal, Button, Typography, Result, Collapse, Tag } from "antd";
import {
  WifiOutlined,
  CloseCircleOutlined,
  BugOutlined,
  ReloadOutlined,
  WarningOutlined,
  CopyOutlined,
  HomeOutlined,
  DownOutlined,
} from "@ant-design/icons";

const { Text, Title } = Typography;

/* ─────── Styled error modal (replaces SweetAlert) ─────── */

const iconMap = {
  error: <CloseCircleOutlined style={{ fontSize: 48, color: "#ff4d4f" }} />,
  warning: <WarningOutlined style={{ fontSize: 48, color: "#faad14" }} />,
  offline: <WifiOutlined style={{ fontSize: 48, color: "#8c8c8c" }} />,
  bug: <BugOutlined style={{ fontSize: 48, color: "#ff4d4f" }} />,
};

export function ErrorCard({ open, type = "error", title, message, onClose }) {
  return (
    <Modal
      open={open}
      footer={null}
      closable={false}
      centered
      width={400}
      styles={{ body: { padding: 0 } }}
    >
      <div style={cardStyles.wrapper}>
        <div style={cardStyles.iconBand(type)}>
          {iconMap[type] || iconMap.error}
        </div>
        <div style={cardStyles.body}>
          <Title level={4} style={{ margin: 0, color: "#1a3353" }}>
            {title}
          </Title>
          <Text
            type="secondary"
            style={{ fontSize: 14, marginTop: 8, display: "block" }}
          >
            {message}
          </Text>
          <Button type="primary" block onClick={onClose} style={cardStyles.btn}>
            OK
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const bandColors = {
  error: "linear-gradient(135deg, #ff4d4f 0%, #cf1322 100%)",
  warning: "linear-gradient(135deg, #faad14 0%, #d48806 100%)",
  offline: "linear-gradient(135deg, #8c8c8c 0%, #595959 100%)",
  bug: "linear-gradient(135deg, #ff4d4f 0%, #a8071a 100%)",
};

const cardStyles = {
  wrapper: { borderRadius: 12, overflow: "hidden" },
  iconBand: (type) => ({
    background: bandColors[type] || bandColors.error,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "28px 0 20px",
    color: "#fff",
  }),
  body: { padding: "20px 24px 24px", textAlign: "center" },
  btn: {
    marginTop: 20,
    height: 42,
    borderRadius: 8,
    fontWeight: 600,
    background: "#1a3353",
    border: "none",
  },
};

/* ─────── useErrorCard hook ─────── */

export function useErrorCard() {
  const [state, setState] = useState({
    open: false,
    type: "error",
    title: "",
    message: "",
  });

  const showError = useCallback((opts) => {
    setState({ open: true, ...opts });
  }, []);

  const close = useCallback(() => {
    setState((s) => ({ ...s, open: false }));
  }, []);

  const card = (
    <ErrorCard
      open={state.open}
      type={state.type}
      title={state.title}
      message={state.message}
      onClose={close}
    />
  );

  return { showError, card };
}

/* ─────── Offline banner ─────── */

export function OfflineBanner() {
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div style={offlineStyles.bar}>
      <WifiOutlined style={{ fontSize: 18, marginRight: 10 }} />
      <span style={{ fontWeight: 600 }}>You seem to be offline.</span>
      <span style={{ marginLeft: 6, opacity: 0.85 }}>
        Please check your internet connection and try again.
      </span>
    </div>
  );
}

const offlineStyles = {
  bar: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    background: "linear-gradient(135deg, #595959 0%, #434343 100%)",
    color: "#fff",
    padding: "10px 20px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 14,
    boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
  },
};

/* ─────── Error Boundary ─────── */

export class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, copied: false, showStack: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    // Log to console for dev visibility
    console.error("[AppErrorBoundary]", error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, copied: false, showStack: false });
    window.location.reload();
  };

  handleGoHome = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, copied: false, showStack: false });
    window.location.href = "/";
  };

  handleCopy = () => {
    const { error, errorInfo } = this.state;
    const text = [
      `Error: ${error?.message || "Unknown error"}`,
      `\nTimestamp: ${new Date().toISOString()}`,
      `\nURL: ${window.location.href}`,
      `\nStack:\n${error?.stack || ""}`,
      errorInfo?.componentStack ? `\nComponent Stack:\n${errorInfo.componentStack}` : "",
    ].join("");
    navigator.clipboard.writeText(text).then(() => {
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    });
  };

  render() {
    if (this.state.hasError) {
      const { error, errorInfo, copied, showStack } = this.state;
      const isDev = import.meta.env?.DEV ?? false;

      return (
        <div style={boundaryStyles.wrapper}>
          <div style={boundaryStyles.card}>
            {/* Header band */}
            <div style={boundaryStyles.iconBand}>
              <BugOutlined style={{ fontSize: 44, color: "#fff", marginBottom: 6 }} />
              <span style={{ color: "#fff", fontWeight: 700, fontSize: 16, letterSpacing: 0.3 }}>
                Application Error
              </span>
            </div>

            {/* Body */}
            <div style={boundaryStyles.body}>
              <Title level={4} style={{ margin: "0 0 6px", color: "#1a3353" }}>
                Something went wrong
              </Title>
              <Text type="secondary" style={{ fontSize: 13, display: "block", marginBottom: 16 }}>
                An unexpected error occurred. You can reload the page or go to the home screen.
              </Text>

              {/* Error message box */}
              {error?.message && (
                <div style={boundaryStyles.errorBox}>
                  <Tag color="red" style={{ fontSize: 11, marginBottom: 6, borderRadius: 4 }}>
                    {error.name || "Error"}
                  </Tag>
                  <Text code style={{ fontSize: 12, display: "block", wordBreak: "break-word", color: "#cf1322" }}>
                    {error.message}
                  </Text>
                </div>
              )}

              {/* Stack trace toggle (dev or expandable) */}
              {(isDev || errorInfo) && (
                <div style={{ marginBottom: 14 }}>
                  <Button
                    size="small"
                    type="text"
                    icon={<DownOutlined rotate={showStack ? 180 : 0} style={{ fontSize: 10 }} />}
                    style={{ fontSize: 11, color: "#8c8c8c", padding: "0 4px" }}
                    onClick={() => this.setState((s) => ({ showStack: !s.showStack }))}
                  >
                    {showStack ? "Hide" : "Show"} stack trace
                  </Button>
                  {showStack && (
                    <pre style={boundaryStyles.stackPre}>
                      {error?.stack || "No stack available"}
                      {errorInfo?.componentStack ? `\n\nComponent Stack:${errorInfo.componentStack}` : ""}
                    </pre>
                  )}
                </div>
              )}

              {/* Action buttons */}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Button
                  type="primary"
                  icon={<ReloadOutlined />}
                  onClick={this.handleReload}
                  style={{ ...boundaryStyles.btn, flex: 1 }}
                >
                  Reload Page
                </Button>
                <Button
                  icon={<HomeOutlined />}
                  onClick={this.handleGoHome}
                  style={{ flex: 1, height: 42, borderRadius: 8, fontWeight: 600 }}
                >
                  Go to Home
                </Button>
              </div>
              <Button
                icon={<CopyOutlined />}
                size="small"
                type="text"
                onClick={this.handleCopy}
                style={{ marginTop: 10, width: "100%", color: copied ? "#52c41a" : "#8c8c8c", fontSize: 12 }}
              >
                {copied ? "Copied to clipboard!" : "Copy error details for reporting"}
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const boundaryStyles = {
  wrapper: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "linear-gradient(180deg, #f5f7fa 0%, #e8ecf1 100%)",
    padding: 16,
  },
  card: {
    maxWidth: 520,
    width: "100%",
    background: "#fff",
    borderRadius: 16,
    overflow: "hidden",
    boxShadow: "0 8px 40px rgba(26,51,83,0.10), 0 2px 8px rgba(0,0,0,0.06)",
  },
  iconBand: {
    background: "linear-gradient(135deg, #ff4d4f 0%, #a8071a 100%)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "28px 0 20px",
    gap: 6,
  },
  body: {
    padding: "20px 28px 24px",
  },
  errorBox: {
    background: "#fff1f0",
    border: "1px solid #ffa39e",
    borderRadius: 8,
    padding: "10px 14px",
    marginBottom: 14,
  },
  stackPre: {
    background: "#1a1a2e",
    color: "#a8b2d8",
    borderRadius: 8,
    padding: "12px 14px",
    fontSize: 10,
    lineHeight: 1.6,
    overflowX: "auto",
    maxHeight: 200,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    marginTop: 6,
  },
  btn: {
    height: 42,
    borderRadius: 8,
    fontWeight: 600,
    background: "#1a3353",
    border: "none",
  },
};
