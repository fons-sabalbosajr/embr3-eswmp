import { useState } from "react";
import { Form, Input, Button, Card, Typography, Divider, Row, Col } from "antd";
import { UserOutlined, MailOutlined, LockOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import Swal from "sweetalert2";
import api from "../api";
import embLogo from "../assets/emblogo.svg";
import bgEmb from "../assets/bgemb.webp";
import "./Auth.css";

const { Title, Text } = Typography;

export default function Signup() {
  const [loading, setLoading] = useState(false);

  const onFinish = async (values) => {
    setLoading(true);
    try {
      await api.post("/auth/signup", values);
      Swal.fire({
        icon: "success",
        title: "Account Created!",
        html: `Your account is now <b>pending approval</b> by the developer.<br/>You will be notified via email at <b>${values.email}</b> once approved.`,
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
    <div className="auth-page">
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
          <Title level={2} className="auth-brand-title">EMBR3 ESWMP</Title>
          <Text className="auth-brand-subtitle">Ecological Solid Waste Management Pipeline</Text>
          <div className="auth-features">
            <span className="auth-feature-item"><span className="auth-feature-dot" />Secure Admin Registration</span>
            <span className="auth-feature-item"><span className="auth-feature-dot" />Role-based Access Control</span>
            <span className="auth-feature-item"><span className="auth-feature-dot" />Developer-Approved Accounts</span>
          </div>
        </div>

        <div className="auth-card-wrapper auth-card-wrapper-signup">
          <Card className="auth-card" variant="borderless">
            <div className="auth-card-header">
              <div className="auth-avatar"><UserOutlined /></div>
              <Title level={3} className="auth-card-title">Create Account</Title>
              <Text className="auth-card-subtitle">Register as an administrator</Text>
              <div className="auth-card-badge auth-card-badge-admin">Admin Registration</div>
            </div>

            <Form name="signup" size="large" onFinish={onFinish} layout="vertical" requiredMark={false} className="auth-form">
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="firstName" label="First Name" rules={[{ required: true, message: "Required" }]}>
                    <Input prefix={<UserOutlined style={{ color: "#1a3353" }} />} placeholder="Juan" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="lastName" label="Last Name" rules={[{ required: true, message: "Required" }]}>
                    <Input prefix={<UserOutlined style={{ color: "#1a3353" }} />} placeholder="Dela Cruz" />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="email" label="Email Address" rules={[{ required: true, message: "Please enter your email" }, { type: "email", message: "Please enter a valid email" }]}>
                <Input prefix={<MailOutlined style={{ color: "#1a3353" }} />} placeholder="you@example.com" />
              </Form.Item>
              <Form.Item name="password" label="Password" rules={[{ required: true, message: "Please enter a password" }, { min: 6, message: "At least 6 characters" }]}>
                <Input.Password prefix={<LockOutlined style={{ color: "#1a3353" }} />} placeholder="••••••••" />
              </Form.Item>
              <Form.Item
                name="confirmPassword"
                label="Confirm Password"
                dependencies={["password"]}
                rules={[
                  { required: true, message: "Please confirm your password" },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue("password") === value) return Promise.resolve();
                      return Promise.reject(new Error("Passwords do not match"));
                    },
                  }),
                ]}
              >
                <Input.Password prefix={<LockOutlined style={{ color: "#1a3353" }} />} placeholder="••••••••" />
              </Form.Item>
              <Form.Item style={{ marginBottom: 16, marginTop: 8 }}>
                <Button className="auth-btn-primary" type="primary" htmlType="submit" loading={loading} block>Create Account</Button>
              </Form.Item>
            </Form>

            <Divider plain className="auth-divider">
              <Text type="secondary" style={{ fontSize: 13 }}>Already have an account?</Text>
            </Divider>
            <div style={{ textAlign: "center" }}>
              <Link to="/admin/login">
                <Button className="auth-btn-secondary" type="default" block>Sign In Instead</Button>
              </Link>
            </div>
          </Card>
        </div>
      </div>

      <div className="auth-page-footer">&copy; 2026 EMBR3 &mdash; Environmental Management Bureau Region III</div>
    </div>
  );
}
