import { useState } from "react";
import { Form, Input, Button, Card, Typography, Result } from "antd";
import { LockOutlined } from "@ant-design/icons";
import { Link, useSearchParams } from "react-router-dom";
import Swal from "sweetalert2";
import api from "../api";
import embLogo from "../assets/emblogo.svg";
import bgEmb from "../assets/bgemb.webp";

const { Title, Text } = Typography;

export default function AdminResetPassword() {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const onFinish = async (values) => {
    if (!token) {
      Swal.fire("Error", "Invalid or missing reset token.", "error");
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post("/auth/reset-password", {
        token,
        password: values.password,
      });
      setDone(true);
      Swal.fire({ icon: "success", title: "Success", text: data.message, confirmButtonColor: "#1a3353" });
    } catch (err) {
      Swal.fire({
        icon: "error",
        title: "Reset Failed",
        text: err.response?.data?.message || "Something went wrong",
      });
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="auth-container">
        <div className="auth-left" style={styles.leftPanel}>
          <div style={styles.overlay} />
          <div className="brand-content" style={styles.brandContent}>
            <img src={embLogo} alt="EMBR3 Logo" style={styles.logo} />
            <Title level={1} style={styles.brandTitle}>EMBR3 ESWMP</Title>
          </div>
        </div>
        <div className="auth-right" style={styles.rightPanel}>
          <div style={styles.cardWrapper}>
            <Card style={styles.card} variant="borderless">
              <Result
                status="error"
                title="Invalid Link"
                subTitle="This password reset link is invalid or has expired."
                extra={
                  <Link to="/admin/forgot-password">
                    <Button type="primary" style={styles.loginBtn}>Request New Link</Button>
                  </Link>
                }
              />
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-left" style={styles.leftPanel}>
        <div style={styles.overlay} />
        <div className="brand-content" style={styles.brandContent}>
          <img src={embLogo} alt="EMBR3 Logo" style={styles.logo} />
          <Title level={1} style={styles.brandTitle}>
            EMBR3 ESWMP
          </Title>
          <Text style={styles.brandSubtitle}>Set New Password</Text>
          <div className="brand-divider" style={styles.brandDivider} />
          <Text className="brand-desc" style={styles.brandDesc}>
            Enter your new password below. Make sure it is at least 6 characters
            long and something you&#39;ll remember.
          </Text>
        </div>
        <Text className="left-footer" style={styles.leftFooter}>
          &copy; 2026 EMBR3 &mdash; Environmental Management Bureau Region III
        </Text>
      </div>

      <div className="auth-right" style={styles.rightPanel}>
        <div style={styles.cardWrapper}>
          <Card style={styles.card} variant="borderless">
            {done ? (
              <Result
                status="success"
                title="Password Reset!"
                subTitle="Your password has been updated. You can now log in with your new password."
                extra={
                  <Link to="/admin/login">
                    <Button type="primary" style={styles.loginBtn}>
                      Go to Login
                    </Button>
                  </Link>
                }
              />
            ) : (
              <>
                <div style={styles.cardHeader}>
                  <div style={styles.avatarCircle}>
                    <LockOutlined style={{ fontSize: 28, color: "#fff" }} />
                  </div>
                  <Title level={3} style={styles.cardTitle}>
                    Reset Password
                  </Title>
                  <Text type="secondary" style={{ fontSize: 14 }}>
                    Enter your new password
                  </Text>
                </div>

                <Form
                  name="admin-reset-password"
                  size="large"
                  onFinish={onFinish}
                  layout="vertical"
                  requiredMark={false}
                  style={{ marginTop: 24 }}
                >
                  <Form.Item
                    name="password"
                    label={
                      <Text strong style={{ color: "#1a3353" }}>
                        New Password
                      </Text>
                    }
                    rules={[
                      { required: true, message: "Please enter your new password" },
                      { min: 6, message: "Password must be at least 6 characters" },
                    ]}
                  >
                    <Input.Password
                      prefix={<LockOutlined style={{ color: "#1a3353" }} />}
                      placeholder="Enter new password"
                      style={styles.input}
                    />
                  </Form.Item>

                  <Form.Item
                    name="confirmPassword"
                    label={
                      <Text strong style={{ color: "#1a3353" }}>
                        Confirm Password
                      </Text>
                    }
                    dependencies={["password"]}
                    rules={[
                      { required: true, message: "Please confirm your password" },
                      ({ getFieldValue }) => ({
                        validator(_, value) {
                          if (!value || getFieldValue("password") === value) {
                            return Promise.resolve();
                          }
                          return Promise.reject(new Error("Passwords do not match"));
                        },
                      }),
                    ]}
                  >
                    <Input.Password
                      prefix={<LockOutlined style={{ color: "#1a3353" }} />}
                      placeholder="Confirm new password"
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
                      Reset Password
                    </Button>
                  </Form.Item>
                </Form>
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
