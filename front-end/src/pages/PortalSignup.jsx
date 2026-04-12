import { useState } from "react";
import { Form, Input, Button, Card, Typography, Divider, Row, Col } from "antd";
import {
  UserOutlined,
  MailOutlined,
  LockOutlined,
  PhoneOutlined,
  BankOutlined,
} from "@ant-design/icons";
import { Link, useNavigate } from "react-router-dom";
import Swal from "sweetalert2";
import api from "../api";
import embLogo from "../assets/emblogo.svg";
import bgEmb from "../assets/bgemb.webp";
import "./Auth.css";

const { Title, Text } = Typography;

export default function PortalSignup() {
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const navigate = useNavigate();

  const onFinish = async (values) => {
    setLoading(true);
    try {
      await api.post("/portal-auth/signup", values);
      form.resetFields();
      Swal.fire({
        icon: "success",
        title: "Registration Submitted!",
        html: "Your account is pending admin approval.<br/>You will be notified once approved.",
        confirmButtonColor: "#1a3353",
      }).then(() => {
        navigate("/slfportal/login");
      });
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
        }).then((result) => {
          if (result.isConfirmed) navigate("/slfportal/login");
        });
      } else {
        Swal.fire({
          icon: "error",
          title: "Registration Failed",
          text: msg,
        });
      }
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
            <div className="auth-card-header">
              <div className="auth-avatar"><UserOutlined /></div>
              <Title level={3} className="auth-card-title">Portal Registration</Title>
              <Text className="auth-card-subtitle">Create your SLF portal account</Text>
              <div className="auth-card-badge auth-card-badge-portal">SLF Registration</div>
            </div>

            <Form form={form} name="portal-signup" size="large" onFinish={onFinish} layout="vertical" requiredMark={false} className="auth-form">
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
              <Form.Item name="email" label="Email Address" rules={[{ required: true, message: "Please enter your email" }, { type: "email", message: "Please enter a valid email" }]}>
                <Input prefix={<MailOutlined style={{ color: "#1a3353" }} />} placeholder="you@example.com" />
              </Form.Item>
              <Row gutter={12}>
                <Col xs={24} sm={12}>
                  <Form.Item name="contactNumber" label="Contact Number">
                    <Input prefix={<PhoneOutlined style={{ color: "#1a3353" }} />} placeholder="09XX-XXX-XXXX" />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item name="companyName" label="Company/LGU Name">
                    <Input prefix={<BankOutlined style={{ color: "#1a3353" }} />} placeholder="Company name" />
                  </Form.Item>
                </Col>
              </Row>
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
                <Button className="auth-btn-primary" type="primary" htmlType="submit" loading={loading} block>Register</Button>
              </Form.Item>
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
