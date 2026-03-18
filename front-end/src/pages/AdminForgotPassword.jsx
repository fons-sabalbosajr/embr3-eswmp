import { useState } from "react";
import { Form, Input, Button, Card, Typography, Result } from "antd";
import { MailOutlined, ArrowLeftOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import Swal from "sweetalert2";
import api from "../api";
import embLogo from "../assets/emblogo.svg";
import bgEmb from "../assets/bgemb.webp";

const { Title, Text } = Typography;

export default function AdminForgotPassword() {
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const onFinish = async (values) => {
    setLoading(true);
    try {
      await api.post("/auth/forgot-password", { email: values.email });
      setSent(true);
    } catch {
      Swal.fire({
        icon: "error",
        title: "Error",
        text: "Something went wrong. Please try again later.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-left" style={styles.leftPanel}>
        <div style={styles.overlay} />
        <div style={styles.brandContent}>
          <img src={embLogo} alt="EMBR3 Logo" style={styles.logo} />
          <Title level={1} style={styles.brandTitle}>
            EMBR3 ESWMP
          </Title>
          <Text style={styles.brandSubtitle}>Password Recovery</Text>
          <div style={styles.brandDivider} />
          <Text style={styles.brandDesc}>
            Enter your registered email address and we&#39;ll send you a link to
            reset your admin account password.
          </Text>
        </div>
        <Text style={styles.leftFooter}>
          &copy; 2026 EMBR3 &mdash; Environmental Management Bureau Region III
        </Text>
      </div>

      <div className="auth-right" style={styles.rightPanel}>
        <div style={styles.cardWrapper}>
          <Card style={styles.card} variant="borderless">
            {sent ? (
              <Result
                status="success"
                title="Check Your Email"
                subTitle="If an account with that email exists, a password reset link has been sent. Please check your inbox (and spam folder)."
                extra={
                  <Link to="/admin/login">
                    <Button type="primary" style={styles.loginBtn}>
                      Back to Login
                    </Button>
                  </Link>
                }
              />
            ) : (
              <>
                <div style={styles.cardHeader}>
                  <div style={styles.avatarCircle}>
                    <MailOutlined style={{ fontSize: 28, color: "#fff" }} />
                  </div>
                  <Title level={3} style={styles.cardTitle}>
                    Forgot Password
                  </Title>
                  <Text type="secondary" style={{ fontSize: 14 }}>
                    We&#39;ll send a reset link to your email
                  </Text>
                </div>

                <Form
                  name="admin-forgot-password"
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
                        Email Address
                      </Text>
                    }
                    rules={[
                      { required: true, message: "Please enter your email" },
                      { type: "email", message: "Please enter a valid email" },
                    ]}
                  >
                    <Input
                      prefix={<MailOutlined style={{ color: "#1a3353" }} />}
                      placeholder="you@example.com"
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
                      Send Reset Link
                    </Button>
                  </Form.Item>
                </Form>

                <div style={{ textAlign: "center", marginTop: 8 }}>
                  <Link to="/admin/login">
                    <Button
                      type="link"
                      icon={<ArrowLeftOutlined />}
                      style={{ color: "#1a3353" }}
                    >
                      Back to Login
                    </Button>
                  </Link>
                </div>
              </>
            )}
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
};
