import { useRef, useState } from "react";
import { Form, Input, Button, Card, Typography, Divider } from "antd";
import { UserOutlined, LockOutlined } from "@ant-design/icons";
import { Link, useNavigate } from "react-router-dom";
import { useErrorCard } from "../utils/ErrorHandler";
import api from "../api";
import secureStorage from "../utils/secureStorage";
import AuthBrandLogos from "../components/AuthBrandLogos";
import bgEmb from "../assets/bgemb.webp";
import "./Auth.css";

const { Title, Text } = Typography;

export default function Login() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { showError, card: errorCard } = useErrorCard();

  const loginInFlight = useRef(false);

  const onFinish = async (values) => {
    if (loginInFlight.current) return;
    loginInFlight.current = true;
    setLoading(true);
    try {
      const { data } = await api.post("/auth/login", values);
      secureStorage.set("token", data.token);
      secureStorage.setJSON("user", data.user);
      navigate("/admin");
    } catch (err) {
      if (!navigator.onLine) {
        showError({ type: "offline", title: "You're Offline", message: "It seems you are not connected to the internet. Please check your connection and try again." });
      } else if (err.response?.status === 429) {
        showError({ type: "warning", title: "Too Many Attempts", message: err.response?.data?.message || "Too many login attempts. Please wait a few minutes and try again." });
      } else {
        showError({ type: "error", title: "Login Failed", message: err.response?.data?.message || "Something went wrong" });
      }
    } finally {
      loginInFlight.current = false;
      setLoading(false);
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
          <Title level={2} className="auth-brand-title">EMBR3 ESWMP</Title>
          <Text className="auth-brand-subtitle">Ecological Solid Waste Management Pipeline</Text>
          <div className="auth-features">
            <span className="auth-feature-item"><span className="auth-feature-dot" />SLF Monitoring &amp; Compliance</span>
            <span className="auth-feature-item"><span className="auth-feature-dot" />Province-wide Coverage</span>
            <span className="auth-feature-item"><span className="auth-feature-dot" />Real-time Analytics &amp; Reports</span>
          </div>
        </div>

        <div className="auth-card-wrapper auth-card-wrapper-login">
          <Card className="auth-card" variant="borderless">
            <div className="auth-card-header">
              <div className="auth-avatar"><UserOutlined /></div>
              <Title level={3} className="auth-card-title">Admin Portal</Title>
              <Text className="auth-card-subtitle">Sign in with your admin credentials</Text>
              <div className="auth-card-badge auth-card-badge-admin">Admin Access</div>
            </div>

            <Form name="login" size="large" onFinish={onFinish} layout="vertical" requiredMark={false} className="auth-form">
              <Form.Item name="email" label="Email or Username" rules={[{ required: true, message: "Please enter your email or username" }]}>
                <Input prefix={<UserOutlined style={{ color: "#1a3353" }} />} placeholder="email or username" />
              </Form.Item>
              <Form.Item name="password" label="Password" rules={[{ required: true, message: "Please enter your password" }]}>
                <Input.Password prefix={<LockOutlined style={{ color: "#1a3353" }} />} placeholder="password" />
              </Form.Item>
              <Form.Item style={{ marginBottom: 16, marginTop: 8 }}>
                <Button className="auth-btn-primary" type="primary" htmlType="submit" loading={loading} block>Sign In</Button>
              </Form.Item>
              <div style={{ textAlign: "right", marginTop: -8, marginBottom: 8 }}>
                <Link to="/admin/forgot-password" className="auth-forgot-link">Forgot password?</Link>
              </div>
            </Form>

            <Divider plain className="auth-divider">
              <Text type="secondary" style={{ fontSize: 13 }}>Don&apos;t have an account?</Text>
            </Divider>
            <div style={{ textAlign: "center" }}>
              <Link to="/admin/signup">
                <Button className="auth-btn-secondary" type="default" block>Create an Account</Button>
              </Link>
            </div>
          </Card>
        </div>
      </div>

      <div className="auth-page-footer">&copy; 2026 EMBR3 &mdash; Environmental Management Bureau Region III</div>
    </div>
  );
}
