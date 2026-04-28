import { useState } from "react";
import {
  Form, Input, Button, Card, Typography, Divider,
  Row, Col, Upload, message as antMessage, Steps,
} from "antd";
import {
  UserOutlined, MailOutlined, LockOutlined, PhoneOutlined,
  BankOutlined, UploadOutlined, FileProtectOutlined,
  ArrowRightOutlined, ArrowLeftOutlined, CheckOutlined,
} from "@ant-design/icons";
import { Link, useNavigate } from "react-router-dom";
import Swal from "sweetalert2";
import api from "../api";
import embLogo from "../assets/emblogo.svg";
import bgEmb from "../assets/bgemb.webp";
import "./Auth.css";

const { Title, Text } = Typography;

const ALLOWED_TYPES = [
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const MAX_FILE_MB = 20;

const STEPS = [
  { title: "Personal Info",   icon: <UserOutlined /> },
  { title: "Verification",    icon: <FileProtectOutlined /> },
  { title: "Password",        icon: <LockOutlined /> },
];

export default function PortalSignup() {
  const [current, setCurrent] = useState(0);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const [verificationFile, setVerificationFile] = useState(null);

  /* ── File upload helpers ── */
  const beforeUpload = (file) => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      antMessage.error("Only images (JPG/PNG/GIF/WEBP) or documents (PDF/DOC/DOCX) are allowed.");
      return Upload.LIST_IGNORE;
    }
    if (file.size / 1024 / 1024 > MAX_FILE_MB) {
      antMessage.error(`File must be smaller than ${MAX_FILE_MB} MB.`);
      return Upload.LIST_IGNORE;
    }
    setVerificationFile(file);
    return false;
  };
  const onRemoveFile = () => { setVerificationFile(null); return true; };

  /* ── Step navigation ── */
  const STEP_FIELDS = [
    ["firstName", "lastName", "email", "contactNumber", "companyName"],
    ["officeEmail", "pcoEmail"],
    ["password", "confirmPassword"],
  ];

  const goNext = async () => {
    try {
      await form.validateFields(STEP_FIELDS[current]);
      setCurrent((c) => c + 1);
    } catch { /* validation errors shown inline */ }
  };

  const goBack = () => setCurrent((c) => c - 1);

  /* ── Final submit ── */
  const onFinish = async (values) => {
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("firstName", values.firstName);
      formData.append("lastName", values.lastName);
      formData.append("email", values.email);
      formData.append("password", values.password);
      formData.append("contactNumber", values.contactNumber || "");
      formData.append("companyName", values.companyName || "");
      formData.append("officeEmail", values.officeEmail || "");
      formData.append("pcoEmail", values.pcoEmail || "");
      if (verificationFile) formData.append("verificationFile", verificationFile);

      await api.post("/portal-auth/signup", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      form.resetFields();
      setVerificationFile(null);
      setCurrent(0);
      Swal.fire({
        icon: "success",
        title: "Registration Submitted!",
        html: "Your account is pending admin approval.<br/>You will be notified once approved.",
        confirmButtonColor: "#1a3353",
      }).then(() => navigate("/slfportal/login"));
    } catch (err) {
      const msg = err.response?.data?.message || "Something went wrong";
      if (msg.toLowerCase().includes("already registered")) {
        Swal.fire({
          icon: "warning",
          title: "Already Registered",
          html: "This email is already registered.<br/>Please log in or use a different email.",
          confirmButtonColor: "#1a3353",
          showCancelButton: true,
          confirmButtonText: "Go to Login",
          cancelButtonText: "Try Again",
        }).then((result) => { if (result.isConfirmed) navigate("/slfportal/login"); });
      } else {
        Swal.fire({ icon: "error", title: "Registration Failed", text: msg });
      }
    } finally {
      setLoading(false);
    }
  };

  /* ── Step panels ── */
  const stepPanels = [
    /* Step 0 — Personal Info */
    <>
      <Row gutter={12}>
        <Col xs={24} sm={12}>
          <Form.Item name="firstName" label="First Name" rules={[{ required: true, message: "Required" }]}>
            <Input prefix={<UserOutlined style={{ color: "#1a3353" }} />} placeholder="Juan" />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12}>
          <Form.Item name="lastName" label="Last Name" rules={[{ required: true, message: "Required" }]}>
            <Input prefix={<UserOutlined style={{ color: "#1a3353" }} />} placeholder="Dela Cruz" />
          </Form.Item>
        </Col>
      </Row>
      <Form.Item
        name="email" label="Email Address"
        rules={[{ required: true, message: "Please enter your email" }, { type: "email", message: "Enter a valid email" }]}
      >
        <Input prefix={<MailOutlined style={{ color: "#1a3353" }} />} placeholder="you@example.com" />
      </Form.Item>
      <Row gutter={12}>
        <Col xs={24} sm={12}>
          <Form.Item name="contactNumber" label="Contact Number">
            <Input prefix={<PhoneOutlined style={{ color: "#1a3353" }} />} placeholder="09XX-XXX-XXXX" />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12}>
          <Form.Item name="companyName" label="Company / LGU Name">
            <Input prefix={<BankOutlined style={{ color: "#1a3353" }} />} placeholder="Company name" />
          </Form.Item>
        </Col>
      </Row>
    </>,

    /* Step 1 — Additional Emails + Verification */
    <>
      <Row gutter={12}>
        <Col xs={24} sm={12}>
          <Form.Item
            name="officeEmail" label="Office Email Address"
            rules={[{ type: "email", message: "Enter a valid email" }]}
          >
            <Input prefix={<MailOutlined style={{ color: "#1a3353" }} />} placeholder="office@example.com" />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12}>
          <Form.Item
            name="pcoEmail" label="PCO Email Address"
            rules={[{ type: "email", message: "Enter a valid email" }]}
          >
            <Input prefix={<MailOutlined style={{ color: "#1a3353" }} />} placeholder="pco@example.com" />
          </Form.Item>
        </Col>
      </Row>

      <div style={{
        padding: "12px 16px", background: "#f0f5ff", borderRadius: 8,
        border: "1px solid #adc6ff", marginBottom: 16, fontSize: 13,
        color: "#1d39c4", lineHeight: 1.6,
      }}>
        Upload a copy of the <strong>authorization letter from the office</strong> confirming
        you are the legitimate portal registrant.
        Accepted: JPG, PNG, PDF, DOC, DOCX (max {MAX_FILE_MB}&nbsp;MB).
      </div>
      <Form.Item label="Authorization Letter / Proof of Identity">
        <Upload
          maxCount={1}
          beforeUpload={beforeUpload}
          onRemove={onRemoveFile}
          fileList={verificationFile ? [verificationFile] : []}
          accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx"
        >
          <Button icon={<UploadOutlined />}>Select File</Button>
        </Upload>
        <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: "block" }}>
          File will be securely stored in the EMB&nbsp;R3 records system.
        </Text>
      </Form.Item>
    </>,

    /* Step 2 — Password */
    <>
      <Form.Item
        name="password" label="Password"
        rules={[{ required: true, message: "Please enter a password" }, { min: 6, message: "At least 6 characters" }]}
      >
        <Input.Password prefix={<LockOutlined style={{ color: "#1a3353" }} />} placeholder="••••••••" />
      </Form.Item>
      <Form.Item
        name="confirmPassword" label="Confirm Password"
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
    </>,
  ];

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
          <Text className="auth-brand-subtitle">Sanitary Landfill Generators Portal</Text>
          <div className="auth-features">
            <span className="auth-feature-item"><span className="auth-feature-dot" />Secure Registration</span>
            <span className="auth-feature-item"><span className="auth-feature-dot" />Admin-Approved Accounts</span>
            <span className="auth-feature-item"><span className="auth-feature-dot" />Assigned SLF Facility</span>
          </div>
        </div>

        <div className="auth-card-wrapper auth-card-wrapper-signup">
          <Card className="auth-card" variant="borderless">

            {/* ── Header ── */}
            <div className="auth-card-header">
              <div className="auth-avatar"><UserOutlined /></div>
              <Title level={3} className="auth-card-title">Portal Registration</Title>
              <Text className="auth-card-subtitle">Create your SLF portal account</Text>
              <div className="auth-card-badge auth-card-badge-portal">SLF Registration</div>
            </div>

            {/* ── Steps indicator ── */}
            <Steps
              current={current}
              size="small"
              items={STEPS}
              style={{ marginBottom: 28, marginTop: 4 }}
            />

            {/* ── Step label ── */}
            <div style={{
              fontSize: 13, fontWeight: 600, color: "#1a3353",
              marginBottom: 16, letterSpacing: 0.3,
            }}>
              Step {current + 1} of {STEPS.length} — {STEPS[current].title}
            </div>

            {/* ── Form panels ── */}
            <Form
              form={form}
              name="portal-signup"
              size="large"
              onFinish={onFinish}
              layout="vertical"
              requiredMark={false}
              className="auth-form"
            >
              {/* Always render all fields so antd Form keeps values; hide inactive steps */}
              {STEPS.map((_, idx) => (
                <div key={idx} style={{ display: idx === current ? "block" : "none" }}>
                  {stepPanels[idx]}
                </div>
              ))}

              {/* ── Navigation buttons ── */}
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                {current > 0 && (
                  <Button
                    size="large"
                    icon={<ArrowLeftOutlined />}
                    onClick={goBack}
                    style={{ flex: 1 }}
                  >
                    Back
                  </Button>
                )}
                {current < STEPS.length - 1 ? (
                  <Button
                    className="auth-btn-primary"
                    type="primary"
                    size="large"
                    icon={<ArrowRightOutlined />}
                    iconPosition="end"
                    onClick={goNext}
                    style={{ flex: 2 }}
                  >
                    Next
                  </Button>
                ) : (
                  <Button
                    className="auth-btn-primary"
                    type="primary"
                    htmlType="submit"
                    size="large"
                    loading={loading}
                    icon={<CheckOutlined />}
                    style={{ flex: 2 }}
                  >
                    Submit Registration
                  </Button>
                )}
              </div>
            </Form>

            <Divider plain className="auth-divider">
              <Text type="secondary" style={{ fontSize: 13 }}>Already have an account?</Text>
            </Divider>
            <div style={{ textAlign: "center" }}>
              <Link to="/slfportal/login">
                <Button className="auth-btn-secondary" type="default" block>Sign In to Portal</Button>
              </Link>
            </div>
          </Card>
        </div>
      </div>

      <div className="auth-page-footer">&copy; 2026 EMBR3 &mdash; Environmental Management Bureau Region III</div>
    </div>
  );
}

