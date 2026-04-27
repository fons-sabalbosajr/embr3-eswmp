import { useState, useEffect } from "react";
import { Form, Input, Button, Card, Typography, Upload, message as antMessage, Alert } from "antd";
import { MailOutlined, UploadOutlined, FileProtectOutlined, WarningOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import Swal from "sweetalert2";
import api from "../api";
import secureStorage from "../utils/secureStorage";
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

export default function PortalVerificationUpdate() {
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const [verificationFile, setVerificationFile] = useState(null);

  // Redirect to login if no token
  useEffect(() => {
    const token = secureStorage.get("portal_token");
    if (!token) navigate("/slfportal/login", { replace: true });
  }, [navigate]);

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

  const onRemoveFile = () => {
    setVerificationFile(null);
    return true;
  };

  const onFinish = async (values) => {
    if (!verificationFile) {
      Swal.fire({
        icon: "warning",
        title: "File Required",
        text: "Please upload your authorization letter or proof of identity before submitting.",
        confirmButtonColor: "#1a3353",
      });
      return;
    }

    setLoading(true);
    try {
      const token = secureStorage.get("portal_token");
      const formData = new FormData();
      if (values.officeEmail) formData.append("officeEmail", values.officeEmail);
      if (values.pcoEmail) formData.append("pcoEmail", values.pcoEmail);
      formData.append("verificationFile", verificationFile);

      await api.post("/portal-auth/submit-verification", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
          Authorization: `Bearer ${token}`,
        },
      });

      Swal.fire({
        icon: "success",
        title: "Verification Submitted!",
        html: "Your information has been sent for admin review.<br/>You can now continue using the portal.",
        confirmButtonColor: "#1a3353",
      }).then(() => {
        navigate("/slfportal");
      });
    } catch (err) {
      Swal.fire({
        icon: "error",
        title: "Submission Failed",
        text: err.response?.data?.message || "Something went wrong. Please try again.",
        confirmButtonColor: "#1a3353",
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
          <Title level={2} className="auth-brand-title">SLF Portal</Title>
          <Text className="auth-brand-subtitle">Sanitary Landfill Generators Portal</Text>
        </div>

        <div className="auth-card-wrapper auth-card-wrapper-login">
          <Card className="auth-card" variant="borderless">
            <div className="auth-card-header">
              <div className="auth-avatar" style={{ background: "#fa8c16" }}>
                <WarningOutlined />
              </div>
              <Title level={3} className="auth-card-title">Verification Required</Title>
              <Text className="auth-card-subtitle">Please update your information to continue</Text>
            </div>

            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 20 }}
              title="Action Required"
              description="The administrator requires you to update your verification details. Please fill in the fields below and upload your authorization letter before proceeding."
            />

            <Form form={form} name="verify-update" size="large" onFinish={onFinish} layout="vertical" requiredMark={false} className="auth-form">

              <Form.Item
                name="officeEmail"
                label="Office Email Address"
                rules={[{ type: "email", message: "Enter a valid email" }]}
              >
                <Input prefix={<MailOutlined style={{ color: "#1a3353" }} />} placeholder="office@example.com" />
              </Form.Item>

              <Form.Item
                name="pcoEmail"
                label="PCO Email Address"
                rules={[{ type: "email", message: "Enter a valid email" }]}
              >
                <Input prefix={<MailOutlined style={{ color: "#1a3353" }} />} placeholder="pco@example.com" />
              </Form.Item>

              <Form.Item
                label={
                  <span>
                    <FileProtectOutlined style={{ marginRight: 6, color: "#fa8c16" }} />
                    Authorization Letter / Proof of Identity
                    <span style={{ color: "#ff4d4f", marginLeft: 4 }}>*</span>
                  </span>
                }
              >
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
                  Upload the letter you received from the office confirming your authorization. Max {MAX_FILE_MB} MB.
                </Text>
              </Form.Item>

              <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
                <Button
                  className="auth-btn-primary"
                  type="primary"
                  htmlType="submit"
                  loading={loading}
                  block
                >
                  Submit Verification
                </Button>
              </Form.Item>
            </Form>
          </Card>
        </div>
      </div>

      <div className="auth-page-footer">&copy; 2026 EMBR3 &mdash; Environmental Management Bureau Region III</div>
    </div>
  );
}
