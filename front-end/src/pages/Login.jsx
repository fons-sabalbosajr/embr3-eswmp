import { useState } from "react";
import { Form, Input, Button, Card, Typography, Divider } from "antd";
import { MailOutlined, LockOutlined } from "@ant-design/icons";
import { Link, useNavigate } from "react-router-dom";
import Swal from "sweetalert2";
import api from "../api";
import secureStorage from "../utils/secureStorage";
import embLogo from "../assets/emblogo.svg";
import bgEmb from "../assets/bgemb.webp";

const { Title, Text } = Typography;

export default function Login() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const onFinish = async (values) => {
    setLoading(true);
    try {
      const { data } = await api.post("/auth/login", values);
      secureStorage.set("token", data.token);
      secureStorage.setJSON("user", data.user);
      Swal.fire({
        icon: "success",
        title: "Welcome Back!",
        text: `Hello, ${data.user.firstName}!`,
        timer: 1500,
        showConfirmButton: false,
      }).then(() => navigate("/admin"));
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
    <div style={styles.container}>
      <div style={styles.leftPanel}>
        <div style={styles.brandContent}>
          <img
            src={embLogo}
            alt="EMBR3 Logo"
            style={{ width: 80, marginBottom: 20 }}
          />
          <Title level={1} style={styles.brandTitle}>
            EMBR3 ESWMP
          </Title>
          <Text style={styles.brandSubtitle}>
            Ecological Solid Waste Management Pipeline
          </Text>
          <div style={styles.brandDivider} />
          <Text style={styles.brandDesc}>
            Streamlining waste management operations with modern tools and
            real-time data insights.
          </Text>
        </div>
      </div>

      <div style={styles.rightPanel}>
        <Card style={styles.card} variant="borderless">
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <Title level={2} style={{ margin: 0, color: "#1a3353" }}>
              Admin Login
            </Title>
            <Text type="secondary">Sign in to your account</Text>
          </div>

          <Form
            name="login"
            size="large"
            onFinish={onFinish}
            layout="vertical"
            requiredMark={false}
          >
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
              rules={[{ required: true, message: "Please enter your password" }]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="••••••••" />
            </Form.Item>

            <Form.Item style={{ marginBottom: 16 }}>
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
          </Form>

          <Divider plain>
            <Text type="secondary">New here?</Text>
          </Divider>

          <div style={{ textAlign: "center" }}>
            <Link to="/signup">
              <Button type="link" style={{ fontSize: 15 }}>
                Create an Account
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
    background: `linear-gradient(135deg, rgba(26,51,83,0.88) 0%, rgba(45,95,138,0.85) 50%, rgba(26,51,83,0.90) 100%), url(${bgEmb}) center/cover no-repeat`,
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
    maxWidth: 420,
    borderRadius: 12,
    boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
    padding: "16px 8px",
  },
  loginBtn: {
    height: 48,
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 16,
    background: "#1a3353",
    borderColor: "#1a3353",
  },
};
