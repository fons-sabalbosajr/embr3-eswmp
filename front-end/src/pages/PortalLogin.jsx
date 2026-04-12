import { useState } from "react";
import { Form, Input, Button, Card, Typography, Divider } from "antd";
import { UserOutlined, LockOutlined } from "@ant-design/icons";
import { Link, useNavigate } from "react-router-dom";
import { useErrorCard } from "../utils/ErrorHandler";
import api from "../api";
import secureStorage from "../utils/secureStorage";
import embLogo from "../assets/emblogo.svg";
import bgEmb from "../assets/bgemb.webp";
import "./Auth.css";

const { Title, Text } = Typography;

export default function PortalLogin() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { showError, card: errorCard } = useErrorCard();

  const onFinish = async (values) => {
    setLoading(true);
    try {
      const { data } = await api.post("/portal-auth/login", values);
      secureStorage.set("portal_token", data.token);
      secureStorage.setJSON("portal_user", data.user);
      navigate("/slfportal");
    } catch (err) {
      if (!navigator.onLine) {
        showError({ type: "offline", title: "You're Offline", message: "It seems you are not connected to the internet. Please check your connection and try again." });
      } else {
        showError({ type: "error", title: "Login Failed", message: err.response?.data?.message || "Something went wrong" });
      }
    } finally {
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
          <div className="auth-brand-logo-circle">
            <img src={embLogo} alt="EMBR3 Logo" />
          </div>
          <Title level={2} className="auth-brand-title">SLF Portal</Title>
          <Text className="auth-brand-subtitle">Sanitary Landfill Generators Portal</Text>
          <div className="auth-features">
            <span className="auth-feature-item"><span className="auth-feature-dot" />SLF Data Submission</span>
            <span className="auth-feature-item"><span className="auth-feature-dot" />Track Your Submissions</span>
            <span className="auth-feature-item"><span className="auth-feature-dot" />Real-time Status Updates</span>
          </div>
        </div>

        <div className="auth-card-wrapper auth-card-wrapper-login">
          <Card className="auth-card" variant="borderless">
            <div className="auth-card-header">
              <div className="auth-avatar"><UserOutlined /></div>
              <Title level={3} className="auth-card-title">Portal Login</Title>
              <Text className="auth-card-subtitle">Sign in with your portal account</Text>
              <div className="auth-card-badge auth-card-badge-portal">SLF Portal</div>
            </div>

            <Form name="portal-login" size="large" onFinish={onFinish} layout="vertical" requiredMark={false} className="auth-form">
              <Form.Item name="email" label="Email" rules={[{ required: true, message: "Please enter your email" }]}>
                <Input prefix={<UserOutlined style={{ color: "#1a3353" }} />} placeholder="you@example.com" />
              </Form.Item>
              <Form.Item name="password" label="Password" rules={[{ required: true, message: "Please enter your password" }]}>
                <Input.Password prefix={<LockOutlined style={{ color: "#1a3353" }} />} placeholder="Password" />
              </Form.Item>
              <Form.Item style={{ marginBottom: 16, marginTop: 8 }}>
                <Button className="auth-btn-primary" type="primary" htmlType="submit" loading={loading} block>Sign In</Button>
              </Form.Item>
              <div style={{ textAlign: "right", marginTop: -8, marginBottom: 8 }}>
                <Link to="/slfportal/forgot-password" className="auth-forgot-link">Forgot password?</Link>
              </div>
            </Form>

            <Divider plain className="auth-divider">
              <Text type="secondary" style={{ fontSize: 13 }}>Don&apos;t have an account?</Text>
            </Divider>
            <div style={{ textAlign: "center" }}>
              <Link to="/slfportal/signup">
                <Button className="auth-btn-secondary" type="default" block>Register for Portal</Button>
              </Link>
            </div>
          </Card>
        </div>
      </div>

      <div className="auth-page-footer">&copy; 2026 EMBR3 &mdash; Environmental Management Bureau Region III</div>
    </div>
  );
}
