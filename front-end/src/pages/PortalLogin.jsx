import { useState } from "react";
import { Form, Input, Button, Card, Typography, Divider } from "antd";
import {
  UserOutlined,
  LockOutlined,
  SafetyCertificateOutlined,
  GlobalOutlined,
  BarChartOutlined,
} from "@ant-design/icons";
import { Link, useNavigate } from "react-router-dom";
import Swal from "sweetalert2";
import api from "../api";
import secureStorage from "../utils/secureStorage";
import embLogo from "../assets/emblogo.svg";
import bgEmb from "../assets/bgemb.webp";

const { Title, Text } = Typography;

export default function PortalLogin() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const onFinish = async (values) => {
    setLoading(true);
    try {
      const { data } = await api.post("/portal-auth/login", values);
      secureStorage.set("portal_token", data.token);
      secureStorage.setJSON("portal_user", data.user);
      navigate("/slfportal");
    } catch (err) {
      Swal.fire({
        icon: "error",
        title: "Login Failed",
        text: err.response?.data?.message || "Something went wrong",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      {/* Left Branding Panel */}
      <div className="auth-left" style={styles.leftPanel}>
        <div style={styles.overlay} />
        <div style={styles.brandContent}>
          <img src={embLogo} alt="EMBR3 Logo" style={styles.logo} />
          <Title level={1} style={styles.brandTitle}>
            SLF Portal
          </Title>
          <Text style={styles.brandSubtitle}>
            Sanitary Landfill Generators Portal
          </Text>
          <div style={styles.brandDivider} />
          <Text style={styles.brandDesc}>
            Access your SLF portal account to submit disposal data for your
            assigned Sanitary Landfill Facility.
          </Text>
          <div style={styles.featureList}>
            {[
              {
                icon: <SafetyCertificateOutlined />,
                text: "SLF Data Submission",
              },
              { icon: <GlobalOutlined />, text: "Track Your Submissions" },
              {
                icon: <BarChartOutlined />,
                text: "Real-time Status Updates",
              },
            ].map((f, i) => (
              <div key={i} style={styles.featureItem}>
                <span style={styles.featureIcon}>{f.icon}</span>
                <Text style={styles.featureText}>{f.text}</Text>
              </div>
            ))}
          </div>
        </div>
        <Text style={styles.leftFooter}>
          &copy; 2026 EMBR3 &mdash; Environmental Management Bureau Region III
        </Text>
      </div>

      {/* Right Login Panel */}
      <div className="auth-right" style={styles.rightPanel}>
        <div style={styles.cardWrapper}>
          <Card style={styles.card} variant="borderless">
            <div style={styles.cardHeader}>
              <div style={styles.avatarCircle}>
                <UserOutlined style={{ fontSize: 28, color: "#fff" }} />
              </div>
              <Title level={3} style={styles.cardTitle}>
                SLF Portal Login
              </Title>
              <Text type="secondary" style={{ fontSize: 14 }}>
                Sign in with your portal account
              </Text>
            </div>

            <Form
              name="portal-login"
              size="large"
              onFinish={onFinish}
              layout="vertical"
              requiredMark={false}
              style={{ marginTop: 24 }}
            >
              <Form.Item
                name="email"
                label={
                  <Text strong style={{ color: "#1a3353" }}>
                    Email
                  </Text>
                }
                rules={[
                  { required: true, message: "Please enter your email" },
                ]}
              >
                <Input
                  prefix={<UserOutlined style={{ color: "#1a3353" }} />}
                  placeholder="you@example.com"
                  style={styles.input}
                />
              </Form.Item>

              <Form.Item
                name="password"
                label={
                  <Text strong style={{ color: "#1a3353" }}>
                    Password
                  </Text>
                }
                rules={[
                  {
                    required: true,
                    message: "Please enter your password",
                  },
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined style={{ color: "#1a3353" }} />}
                  placeholder="Enter your password"
                  style={styles.input}
                />
              </Form.Item>

              <Form.Item style={{ marginBottom: 16, marginTop: 8 }}>
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={loading}
                  block
                  style={styles.loginBtn}
                >
                  Sign In
                </Button>
              </Form.Item>

              <div style={{ textAlign: "right", marginTop: -8, marginBottom: 8 }}>
                <Link to="/slfportal/forgot-password" style={{ color: "#2d5f8a", fontSize: 13 }}>
                  Forgot password?
                </Link>
              </div>
            </Form>

            <Divider plain style={{ margin: "12px 0" }}>
              <Text type="secondary" style={{ fontSize: 13 }}>
                Don&apos;t have an account?
              </Text>
            </Divider>

            <div style={{ textAlign: "center" }}>
              <Link to="/slfportal/signup">
                <Button type="default" block style={styles.signupBtn}>
                  Register for Portal
                </Button>
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

const styles = {
  leftPanel: {
    background: `url(${bgEmb}) center/cover no-repeat`,
  },
  overlay: {
    position: "absolute",
    inset: 0,
    background:
      "linear-gradient(160deg, rgba(14,30,53,0.93) 0%, rgba(26,51,83,0.88) 40%, rgba(30,80,130,0.82) 100%)",
    zIndex: 0,
  },
  brandContent: {
    maxWidth: 440,
    color: "#fff",
    position: "relative",
    zIndex: 1,
  },
  logo: {
    width: 72,
    marginBottom: 20,
    filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.3))",
  },
  brandTitle: {
    color: "#fff",
    fontSize: 38,
    fontWeight: 800,
    marginBottom: 4,
    letterSpacing: 2,
    lineHeight: 1.1,
  },
  brandSubtitle: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 16,
    display: "block",
    fontWeight: 400,
  },
  brandDivider: {
    width: 50,
    height: 3,
    background: "linear-gradient(90deg, #4fc3f7, #81d4fa)",
    borderRadius: 2,
    margin: "20px 0",
  },
  brandDesc: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 14,
    lineHeight: 1.7,
    display: "block",
    marginBottom: 28,
  },
  featureList: { display: "flex", flexDirection: "column", gap: 14 },
  featureItem: { display: "flex", alignItems: "center", gap: 12 },
  featureIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    background: "rgba(79,195,247,0.15)",
    border: "1px solid rgba(79,195,247,0.25)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#4fc3f7",
    fontSize: 16,
    flexShrink: 0,
  },
  featureText: { color: "rgba(255,255,255,0.8)", fontSize: 14 },
  leftFooter: {
    position: "absolute",
    bottom: 24,
    color: "rgba(255,255,255,0.35)",
    fontSize: 11,
    zIndex: 1,
    letterSpacing: 0.3,
  },
  rightPanel: {
    background: "linear-gradient(180deg, #f5f7fa 0%, #e8ecf1 100%)",
  },
  cardWrapper: { width: "100%", maxWidth: 440 },
  card: {
    width: "100%",
    borderRadius: 16,
    boxShadow:
      "0 8px 40px rgba(26,51,83,0.10), 0 2px 8px rgba(0,0,0,0.06)",
    padding: "24px 16px",
    border: "1px solid rgba(26,51,83,0.06)",
  },
  cardHeader: { textAlign: "center", marginBottom: 8 },
  avatarCircle: {
    width: 56,
    height: 56,
    borderRadius: "50%",
    background: "linear-gradient(135deg, #1a3353, #2d5f8a)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    boxShadow: "0 4px 14px rgba(26,51,83,0.25)",
  },
  cardTitle: {
    margin: "0 0 4px 0",
    color: "#1a3353",
    fontWeight: 700,
    letterSpacing: 0.5,
  },
  input: { borderRadius: 8, height: 44 },
  loginBtn: {
    height: 48,
    borderRadius: 10,
    fontWeight: 600,
    fontSize: 16,
    background: "linear-gradient(135deg, #1a3353 0%, #2d5f8a 100%)",
    border: "none",
    boxShadow: "0 4px 14px rgba(26,51,83,0.3)",
  },
  signupBtn: {
    height: 42,
    borderRadius: 10,
    fontWeight: 500,
    fontSize: 14,
    color: "#1a3353",
    borderColor: "#1a3353",
  },
};
