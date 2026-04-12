import { useState, useRef } from "react";
import { Form, Input, Button, Card, Typography, Result } from "antd";
import { MailOutlined, ArrowLeftOutlined, LockOutlined, SafetyOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import Swal from "sweetalert2";
import api from "../api";
import embLogo from "../assets/emblogo.svg";
import bgEmb from "../assets/bgemb.webp";
import "./Auth.css";

const { Title, Text } = Typography;

export default function AdminForgotPassword() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const inputRefs = useRef([]);

  const onSendCode = async (values) => {
    setLoading(true);
    try {
      await api.post("/auth/forgot-password", { email: values.email });
      setEmail(values.email);
      setStep(2);
    } catch {
      Swal.fire({ icon: "error", title: "Error", text: "Something went wrong. Please try again later." });
    } finally {
      setLoading(false);
    }
  };

  const handleCodeChange = (index, value) => {
    if (value && !/^\d$/.test(value)) return;
    const next = [...code];
    next[index] = value;
    setCode(next);
    if (value && index < 5) inputRefs.current[index + 1]?.focus();
  };

  const handleCodeKeyDown = (index, e) => {
    if (e.key === "Backspace" && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleCodePaste = (e) => {
    const paste = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (paste.length === 6) {
      e.preventDefault();
      setCode(paste.split(""));
      inputRefs.current[5]?.focus();
    }
  };

  const fullCode = code.join("");

  const onVerifyCode = async () => {
    if (fullCode.length !== 6) {
      Swal.fire({ icon: "warning", title: "Invalid Code", text: "Please enter the full 6-digit code." });
      return;
    }
    setLoading(true);
    try {
      await api.post("/auth/verify-reset-code", { email, code: fullCode });
      setStep(3);
    } catch (err) {
      Swal.fire({ icon: "error", title: "Invalid Code", text: err.response?.data?.message || "The code is invalid or has expired." });
    } finally {
      setLoading(false);
    }
  };

  const onResetPassword = async (values) => {
    setLoading(true);
    try {
      const { data } = await api.post("/auth/reset-password", { email, code: fullCode, password: values.password });
      setStep(4);
      Swal.fire({ icon: "success", title: "Success", text: data.message, confirmButtonColor: "#1a3353" });
    } catch (err) {
      Swal.fire({ icon: "error", title: "Error", text: err.response?.data?.message || "Something went wrong." });
    } finally {
      setLoading(false);
    }
  };

  const onResend = async () => {
    setLoading(true);
    try {
      await api.post("/auth/forgot-password", { email });
      Swal.fire({ icon: "success", title: "Code Resent", text: "A new code has been sent to your email.", confirmButtonColor: "#1a3353" });
      setCode(["", "", "", "", "", ""]);
    } catch {
      Swal.fire({ icon: "error", title: "Error", text: "Failed to resend code." });
    } finally {
      setLoading(false);
    }
  };

  const brandSubtitles = {
    1: "Password Recovery",
    2: "Verify Your Code",
    3: "Set New Password",
    4: "Password Reset Complete",
  };

  const renderStep = () => {
    if (step === 4) {
      return (
        <Result
          status="success"
          title="Password Reset!"
          subTitle="Your password has been updated. You can now log in with your new password."
          extra={
            <Link to="/admin/login">
              <Button className="auth-btn-primary" type="primary">Go to Login</Button>
            </Link>
          }
        />
      );
    }
    if (step === 3) {
      return (
        <>
          <div className="auth-card-header">
            <div className="auth-avatar"><LockOutlined /></div>
            <Title level={3} className="auth-card-title">New Password</Title>
            <Text className="auth-card-subtitle">Enter your new password</Text>
            <div className="auth-card-badge auth-card-badge-admin">Admin Account</div>
          </div>
          <Form name="admin-new-pw" size="large" onFinish={onResetPassword} layout="vertical" requiredMark={false} className="auth-form">
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
    }
    if (step === 2) {
      return (
        <>
          <div className="auth-card-header">
            <div className="auth-avatar"><SafetyOutlined /></div>
            <Title level={3} className="auth-card-title">Enter Code</Title>
            <Text className="auth-card-subtitle">We sent a 6-digit code to <strong>{email}</strong></Text>
            <div className="auth-card-badge auth-card-badge-admin">Admin Account</div>
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: 8, margin: "28px 0 24px" }} onPaste={handleCodePaste}>
            {code.map((d, i) => (
              <Input
                key={i}
                ref={(el) => (inputRefs.current[i] = el)}
                value={d}
                maxLength={1}
                onChange={(e) => handleCodeChange(i, e.target.value)}
                onKeyDown={(e) => handleCodeKeyDown(i, e)}
                style={{ width: 48, height: 56, textAlign: "center", fontSize: 24, fontWeight: 700, borderRadius: 10, border: "2px solid #d9d9d9", color: "#1a3353" }}
              />
            ))}
          </div>
          <Button className="auth-btn-primary" type="primary" loading={loading} block onClick={onVerifyCode}>Verify Code</Button>
          <div style={{ textAlign: "center", marginTop: 16 }}>
            <Text type="secondary" style={{ fontSize: 13 }}>Didn&#39;t receive the code? </Text>
            <Button type="link" style={{ padding: 0, color: "#2d5f8a", fontSize: 13 }} onClick={onResend} disabled={loading}>Resend</Button>
          </div>
          <div style={{ textAlign: "center", marginTop: 8 }}>
            <Button type="link" icon={<ArrowLeftOutlined />} style={{ color: "#1a3353" }} onClick={() => { setStep(1); setCode(["", "", "", "", "", ""]); }}>Change email</Button>
          </div>
        </>
      );
    }
    return (
      <>
        <div className="auth-card-header">
          <div className="auth-avatar"><MailOutlined /></div>
          <Title level={3} className="auth-card-title">Forgot Password</Title>
          <Text className="auth-card-subtitle">We&#39;ll send a 6-digit code to your email</Text>
          <div className="auth-card-badge auth-card-badge-admin">Admin Account</div>
        </div>
        <Form name="admin-forgot-password" size="large" onFinish={onSendCode} layout="vertical" requiredMark={false} className="auth-form">
          <Form.Item name="email" label="Email Address" rules={[{ required: true, message: "Please enter your email" }, { type: "email", message: "Please enter a valid email" }]}>
            <Input prefix={<MailOutlined style={{ color: "#1a3353" }} />} placeholder="you@example.com" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 16, marginTop: 8 }}>
            <Button className="auth-btn-primary" type="primary" htmlType="submit" loading={loading} block>Send Code</Button>
          </Form.Item>
        </Form>
        <div style={{ textAlign: "center", marginTop: 8 }}>
          <Link to="/admin/login">
            <Button type="link" icon={<ArrowLeftOutlined />} style={{ color: "#1a3353" }}>Back to Login</Button>
          </Link>
        </div>
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
          <Title level={2} className="auth-brand-title">EMBR3 ESWMP</Title>
          <Text className="auth-brand-subtitle">{brandSubtitles[step]}</Text>
        </div>

        <div className="auth-card-wrapper auth-card-wrapper-login">
          <Card className="auth-card" variant="borderless">{renderStep()}</Card>
        </div>
      </div>

      <div className="auth-page-footer">&copy; 2026 EMBR3 &mdash; Environmental Management Bureau Region III</div>
    </div>
  );
}
