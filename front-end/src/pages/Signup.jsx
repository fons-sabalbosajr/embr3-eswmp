import { useState } from "react";
import { Form, Input, Button, Card, Typography, Divider, Row, Col } from "antd";
import {
  UserOutlined,
  MailOutlined,
  LockOutlined,
} from "@ant-design/icons";
import { Link } from "react-router-dom";
import Swal from "sweetalert2";
import api from "../api";

const { Title, Text } = Typography;

export default function Signup() {
  const [loading, setLoading] = useState(false);

  const onFinish = async (values) => {
    setLoading(true);
    try {
      const { data } = await api.post("/auth/signup", values);
      Swal.fire({
        icon: "success",
        title: "Verification Email Sent!",
        html: `A verification link has been sent to <b>${values.email}</b>.<br/>Please check your inbox and verify your email to continue.`,
        confirmButtonColor: "#1a3353",
      });
    } catch (err) {
      Swal.fire({
        icon: "error",
        title: "Sign Up Failed",
        text: err.response?.data?.message || "Something went wrong",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.leftPanel}>
        <div style={styles.brandContent}>
          <Title level={1} style={styles.brandTitle}>
            EMBR3 ESWMP
          </Title>
          <Text style={styles.brandSubtitle}>
            Enhanced Solid Waste Management Program
          </Text>
          <div style={styles.brandDivider} />
          <Text style={styles.brandDesc}>
            Join the platform to manage and monitor solid waste operations
            efficiently across all regions.
          </Text>
        </div>
      </div>

      <div style={styles.rightPanel}>
        <Card style={styles.card} variant="borderless">
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <Title level={2} style={{ margin: 0, color: "#1a3353" }}>
              Create Account
            </Title>
            <Text type="secondary">Register as an administrator</Text>
          </div>

          <Form
            name="signup"
            size="large"
            onFinish={onFinish}
            layout="vertical"
            requiredMark={false}
          >
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item
                  name="firstName"
                  label="First Name"
                  rules={[{ required: true, message: "Required" }]}
                >
                  <Input prefix={<UserOutlined />} placeholder="Juan" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="lastName"
                  label="Last Name"
                  rules={[{ required: true, message: "Required" }]}
                >
                  <Input prefix={<UserOutlined />} placeholder="Dela Cruz" />
                </Form.Item>
              </Col>
            </Row>

            <Form.Item
              name="email"
              label="Email Address"
              rules={[
                { required: true, message: "Please enter your email" },
                { type: "email", message: "Please enter a valid email" },
              ]}
            >
              <Input prefix={<MailOutlined />} placeholder="you@example.com" />
            </Form.Item>

            <Form.Item
              name="password"
              label="Password"
              rules={[
                { required: true, message: "Please enter a password" },
                { min: 6, message: "At least 6 characters" },
              ]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="••••••••" />
            </Form.Item>

            <Form.Item
              name="confirmPassword"
              label="Confirm Password"
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
              <Input.Password prefix={<LockOutlined />} placeholder="••••••••" />
            </Form.Item>

            <Form.Item style={{ marginBottom: 16 }}>
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                block
                style={styles.signupBtn}
              >
                Create Account
              </Button>
            </Form.Item>
          </Form>

          <Divider plain>
            <Text type="secondary">Already have an account?</Text>
          </Divider>

          <div style={{ textAlign: "center" }}>
            <Link to="/login">
              <Button type="link" style={{ fontSize: 15 }}>
                Sign In Instead
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: "flex",
    minHeight: "100vh",
  },
  leftPanel: {
    flex: 1,
    background: "linear-gradient(135deg, #1a3353 0%, #2d5f8a 50%, #1a3353 100%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 48,
  },
  brandContent: {
    maxWidth: 420,
    color: "#fff",
  },
  brandTitle: {
    color: "#fff",
    fontSize: 42,
    fontWeight: 800,
    marginBottom: 8,
    letterSpacing: 2,
  },
  brandSubtitle: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 17,
    display: "block",
  },
  brandDivider: {
    width: 60,
    height: 4,
    background: "#4fc3f7",
    borderRadius: 2,
    margin: "24px 0",
  },
  brandDesc: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 15,
    lineHeight: 1.7,
    display: "block",
  },
  rightPanel: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#f0f2f5",
    padding: 32,
  },
  card: {
    width: "100%",
    maxWidth: 460,
    borderRadius: 12,
    boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
    padding: "16px 8px",
  },
  signupBtn: {
    height: 48,
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 16,
    background: "#1a3353",
    borderColor: "#1a3353",
  },
};
