import { useState } from "react";
import { Form, Input, Button, Card, Typography, Result } from "antd";
import { LockOutlined } from "@ant-design/icons";
import { Link, useSearchParams } from "react-router-dom";
import Swal from "sweetalert2";
import api from "../api";
import embLogo from "../assets/emblogo.svg";
import bgEmb from "../assets/bgemb.webp";
import "./Auth.css";

const { Title, Text } = Typography;

export default function PortalResetPassword() {
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
      const { data } = await api.post("/portal-auth/reset-password", { token, password: values.password });
      setDone(true);
      Swal.fire({ icon: "success", title: "Success", text: data.message, confirmButtonColor: "#1a3353" });
    } catch (err) {
      Swal.fire({ icon: "error", title: "Reset Failed", text: err.response?.data?.message || "Something went wrong" });
    } finally {
      setLoading(false);
    }
  };

  const renderContent = () => {
    if (!token) {
      return (
        <Result
          status="error"
          title="Invalid Link"
          subTitle="This password reset link is invalid or has expired."
          extra={
            <Link to="/slfportal/forgot-password">
              <Button className="auth-btn-primary" type="primary">Request New Link</Button>
            </Link>
          }
        />
      );
    }
    if (done) {
      return (
        <Result
          status="success"
          title="Password Reset!"
          subTitle="Your password has been updated. You can now log in with your new password."
          extra={
            <Link to="/slfportal/login">
              <Button className="auth-btn-primary" type="primary">Go to Login</Button>
            </Link>
          }
        />
      );
    }
    return (
      <>
        <div className="auth-card-header">
          <div className="auth-avatar"><LockOutlined /></div>
          <Title level={3} className="auth-card-title">Reset Password</Title>
          <Text className="auth-card-subtitle">Enter your new password</Text>
          <div className="auth-card-badge auth-card-badge-portal">SLF Portal</div>
        </div>
        <Form name="portal-reset-password" size="large" onFinish={onFinish} layout="vertical" requiredMark={false} className="auth-form">
          <Form.Item name="password" label="New Password" rules={[{ required: true, message: "Please enter your new password" }, { min: 6, message: "Password must be at least 6 characters" }]}>
            <Input.Password prefix={<LockOutlined style={{ color: "#1a3353" }} />} placeholder="Enter new password" />
          </Form.Item>
          <Form.Item name="confirmPassword" label="Confirm Password" dependencies={["password"]} rules={[{ required: true, message: "Please confirm your password" }, ({ getFieldValue }) => ({ validator(_, value) { if (!value || getFieldValue("password") === value) return Promise.resolve(); return Promise.reject(new Error("Passwords do not match")); } })]}>
            <Input.Password prefix={<LockOutlined style={{ color: "#1a3353" }} />} placeholder="Confirm new password" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 16, marginTop: 8 }}>
            <Button className="auth-btn-primary" type="primary" htmlType="submit" loading={loading} block>Reset Password</Button>
          </Form.Item>
        </Form>
      </>
    );
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
          <Title level={2} className="auth-brand-title">SLF Portal</Title>
          <Text className="auth-brand-subtitle">Set New Password</Text>
        </div>

        <div className="auth-card-wrapper auth-card-wrapper-login">
          <Card className="auth-card" variant="borderless">{renderContent()}</Card>
        </div>
      </div>

      <div className="auth-page-footer">&copy; 2026 EMBR3 &mdash; Environmental Management Bureau Region III</div>
    </div>
  );
}
