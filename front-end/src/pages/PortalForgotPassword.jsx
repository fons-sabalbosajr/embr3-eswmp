import { useState, useRef } from "react";
import { Form, Input, Button, Card, Typography, Result } from "antd";
import { MailOutlined, ArrowLeftOutlined, LockOutlined, SafetyOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import Swal from "sweetalert2";
import api from "../api";
import embLogo from "../assets/emblogo.svg";
import bgEmb from "../assets/bgemb.webp";

const { Title, Text } = Typography;

export default function PortalForgotPassword() {
  const [step, setStep] = useState(1); // 1=email, 2=code, 3=password, 4=done
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const inputRefs = useRef([]);

  // Step 1: Send code to email
  const onSendCode = async (values) => {
    setLoading(true);
    try {
      await api.post("/portal-auth/forgot-password", { email: values.email });
      setEmail(values.email);
      setStep(2);
    } catch {
      Swal.fire({ icon: "error", title: "Error", text: "Something went wrong. Please try again later." });
    } finally {
      setLoading(false);
    }
  };

  // Handle individual digit input
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

  // Step 2: Verify code
  const onVerifyCode = async () => {
    if (fullCode.length !== 6) {
      Swal.fire({ icon: "warning", title: "Invalid Code", text: "Please enter the full 6-digit code." });
      return;
    }
    setLoading(true);
    try {
      await api.post("/portal-auth/verify-reset-code", { email, code: fullCode });
      setStep(3);
    } catch (err) {
      Swal.fire({ icon: "error", title: "Invalid Code", text: err.response?.data?.message || "The code is invalid or has expired." });
    } finally {
      setLoading(false);
    }
  };

  // Step 3: Reset password
  const onResetPassword = async (values) => {
    setLoading(true);
    try {
      const { data } = await api.post("/portal-auth/reset-password", {
        email,
        code: fullCode,
        password: values.password,
      });
      setStep(4);
      Swal.fire({ icon: "success", title: "Success", text: data.message, confirmButtonColor: "#1a3353" });
    } catch (err) {
      Swal.fire({ icon: "error", title: "Error", text: err.response?.data?.message || "Something went wrong." });
    } finally {
      setLoading(false);
    }
  };

  // Resend code
  const onResend = async () => {
    setLoading(true);
    try {
      await api.post("/portal-auth/forgot-password", { email });
      Swal.fire({ icon: "success", title: "Code Resent", text: "A new code has been sent to your email.", confirmButtonColor: "#1a3353" });
      setCode(["", "", "", "", "", ""]);
    } catch {
      Swal.fire({ icon: "error", title: "Error", text: "Failed to resend code." });
    } finally {
      setLoading(false);
    }
  };

  const brandDesc = {
    1: "Enter your registered email address and we'll send you a 6-digit code to reset your password.",
    2: "Check your email for a 6-digit verification code.",
    3: "Enter your new password below.",
    4: "Your password has been reset.",
  };

  const renderStep = () => {
    if (step === 4) {
      return (
        <Result
          status="success"
          title="Password Reset!"
          subTitle="Your password has been updated. You can now log in with your new password."
          extra={
            <Link to="/slfportal/login">
              <Button type="primary" style={styles.loginBtn}>Go to Login</Button>
            </Link>
          }
        />
      );
    }
    if (step === 3) {
      return (
        <>
          <div style={styles.cardHeader}>
            <div style={styles.avatarCircle}>
              <LockOutlined style={{ fontSize: 28, color: "#fff" }} />
            </div>
            <Title level={3} style={styles.cardTitle}>New Password</Title>
            <Text type="secondary" style={{ fontSize: 14 }}>Enter your new password</Text>
          </div>
          <Form name="portal-new-pw" size="large" onFinish={onResetPassword} layout="vertical" requiredMark={false} style={{ marginTop: 24 }}>
            <Form.Item name="password" label={<Text strong style={{ color: "#1a3353" }}>New Password</Text>} rules={[{ required: true, message: "Please enter your new password" }, { min: 6, message: "Password must be at least 6 characters" }]}>
              <Input.Password prefix={<LockOutlined style={{ color: "#1a3353" }} />} placeholder="Enter new password" style={styles.input} />
            </Form.Item>
            <Form.Item name="confirmPassword" label={<Text strong style={{ color: "#1a3353" }}>Confirm Password</Text>} dependencies={["password"]} rules={[{ required: true, message: "Please confirm your password" }, ({ getFieldValue }) => ({ validator(_, value) { if (!value || getFieldValue("password") === value) return Promise.resolve(); return Promise.reject(new Error("Passwords do not match")); } })]}>
              <Input.Password prefix={<LockOutlined style={{ color: "#1a3353" }} />} placeholder="Confirm new password" style={styles.input} />
            </Form.Item>
            <Form.Item style={{ marginBottom: 16, marginTop: 8 }}>
              <Button type="primary" htmlType="submit" loading={loading} block style={styles.loginBtn}>Reset Password</Button>
            </Form.Item>
          </Form>
        </>
      );
    }
    if (step === 2) {
      return (
        <>
          <div style={styles.cardHeader}>
            <div style={styles.avatarCircle}>
              <SafetyOutlined style={{ fontSize: 28, color: "#fff" }} />
            </div>
            <Title level={3} style={styles.cardTitle}>Enter Code</Title>
            <Text type="secondary" style={{ fontSize: 14 }}>
              We sent a 6-digit code to <strong>{email}</strong>
            </Text>
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
          <Button type="primary" loading={loading} block style={styles.loginBtn} onClick={onVerifyCode}>
            Verify Code
          </Button>
          <div style={{ textAlign: "center", marginTop: 16 }}>
            <Text type="secondary" style={{ fontSize: 13 }}>Didn&#39;t receive the code? </Text>
            <Button type="link" style={{ padding: 0, color: "#2d5f8a", fontSize: 13 }} onClick={onResend} disabled={loading}>
              Resend
            </Button>
          </div>
          <div style={{ textAlign: "center", marginTop: 8 }}>
            <Button type="link" icon={<ArrowLeftOutlined />} style={{ color: "#1a3353" }} onClick={() => { setStep(1); setCode(["", "", "", "", "", ""]); }}>
              Change email
            </Button>
          </div>
        </>
      );
    }
    // Step 1
    return (
      <>
        <div style={styles.cardHeader}>
          <div style={styles.avatarCircle}>
            <MailOutlined style={{ fontSize: 28, color: "#fff" }} />
          </div>
          <Title level={3} style={styles.cardTitle}>Forgot Password</Title>
          <Text type="secondary" style={{ fontSize: 14 }}>We&#39;ll send a 6-digit code to your email</Text>
        </div>
        <Form name="portal-forgot-password" size="large" onFinish={onSendCode} layout="vertical" requiredMark={false} style={{ marginTop: 24 }}>
          <Form.Item name="email" label={<Text strong style={{ color: "#1a3353" }}>Email Address</Text>} rules={[{ required: true, message: "Please enter your email" }, { type: "email", message: "Please enter a valid email" }]}>
            <Input prefix={<MailOutlined style={{ color: "#1a3353" }} />} placeholder="you@example.com" style={styles.input} />
          </Form.Item>
          <Form.Item style={{ marginBottom: 16, marginTop: 8 }}>
            <Button type="primary" htmlType="submit" loading={loading} block style={styles.loginBtn}>Send Code</Button>
          </Form.Item>
        </Form>
        <div style={{ textAlign: "center", marginTop: 8 }}>
          <Link to="/slfportal/login">
            <Button type="link" icon={<ArrowLeftOutlined />} style={{ color: "#1a3353" }}>Back to Login</Button>
          </Link>
        </div>
      </>
    );
  };

  return (
    <div className="auth-container">
      <div className="auth-left" style={styles.leftPanel}>
        <div style={styles.overlay} />
        <div className="brand-content" style={styles.brandContent}>
          <img src={embLogo} alt="EMBR3 Logo" style={styles.logo} />
          <Title level={1} style={styles.brandTitle}>SLF Portal</Title>
          <Text style={styles.brandSubtitle}>Password Recovery</Text>
          <div className="brand-divider" style={styles.brandDivider} />
          <Text className="brand-desc" style={styles.brandDesc}>{brandDesc[step]}</Text>
        </div>
        <Text className="left-footer" style={styles.leftFooter}>
          &copy; 2026 EMBR3 &mdash; Environmental Management Bureau Region III
        </Text>
      </div>
      <div className="auth-right" style={styles.rightPanel}>
        <div style={styles.cardWrapper}>
          <Card style={styles.card} variant="borderless">{renderStep()}</Card>
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
