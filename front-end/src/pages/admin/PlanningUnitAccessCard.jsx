import { useCallback, useEffect, useState } from "react";
import {
  Alert, Button, Card, Col, Collapse, DatePicker, Descriptions, Form, Input, Row, Space, Switch, Tag, Typography,
} from "antd";
import { EyeOutlined, LogoutOutlined, ReloadOutlined, TeamOutlined } from "@ant-design/icons";
import Swal from "sweetalert2";
import dayjs from "dayjs";
import api from "../../api";

const { Text } = Typography;

// Developer Settings → Dev Portal Credential → Planning Unit Access.
//
// The Planning Unit gets its own username + password + PIN into the SLF Portal,
// like the Developer Portal access, but VIEW-ONLY and valid only until a set date
// (default end of Dec 31, 2026). The server (routes/planningUnit.js and
// middleware/planningUnitGuard.js) enforces all of it; this card only manages it.

const STATE_TAG = {
  active: <Tag color="green">Active</Tag>,
  disabled: <Tag>Turned off</Tag>,
  expired: <Tag color="red">Expired</Tag>,
  "not-configured": <Tag color="orange">Not set up</Tag>,
};

const fmt = (d) => (d ? dayjs(d).format("MMM D, YYYY h:mm A") : "—");

export default function PlanningUnitAccessCard() {
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [ending, setEnding] = useState(false);
  const [form] = Form.useForm();

  const applyStatus = useCallback((data) => {
    setStatus(data);
    form.setFieldsValue({
      enabled: !!data.enabled,
      username: data.username || "planningunit",
      validUntil: data.validUntil ? dayjs(data.validUntil) : dayjs("2026-12-31T23:59:59+08:00"),
    });
  }, [form]);

  const load = useCallback(
    () => api.get("/planning-unit/settings").then(({ data }) => applyStatus(data)).catch(() => setStatus(null)),
    [applyStatus],
  );

  useEffect(() => {
    api.get("/planning-unit/settings").then(({ data }) => applyStatus(data)).catch(() => setStatus(null));
  }, [applyStatus]);

  const save = async (values) => {
    setSaving(true);
    try {
      const body = {
        currentPassword: values.currentPassword,
        enabled: !!values.enabled,
        username: values.username,
        validUntil: values.validUntil ? values.validUntil.endOf("day").toISOString() : undefined,
      };
      if (values.password) body.password = values.password;
      if (values.pin) body.pin = values.pin;
      const { data } = await api.put("/planning-unit/settings", body);
      setStatus(data);
      form.resetFields(["currentPassword", "password", "confirmPassword", "pin", "confirmPin"]);
      Swal.fire({
        icon: "success",
        title: "Planning Unit access saved",
        text: data.active
          ? `The Planning Unit can sign in to the SLF Portal (view-only) until ${fmt(data.validUntil)}.`
          : "Saved. Planning Unit sign-in is not active right now.",
        confirmButtonColor: "#1a3353",
      });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Could not save Planning Unit access.", "error");
    } finally {
      setSaving(false);
    }
  };

  const endSessions = async () => {
    const ok = await Swal.fire({
      icon: "warning",
      title: "Sign out every Planning Unit session?",
      text: "Anyone viewing the portal with Planning Unit access is signed out now. They can sign in again while the access is active.",
      showCancelButton: true,
      confirmButtonText: "Sign out all",
      confirmButtonColor: "#cf1322",
    });
    if (!ok.isConfirmed) return;
    setEnding(true);
    try {
      const { data } = await api.post("/planning-unit/end-sessions");
      setStatus(data);
      Swal.fire({ icon: "success", title: "Sessions ended", timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Could not end sessions.", "error");
    } finally {
      setEnding(false);
    }
  };

  const firstSetup = !status?.passwordSet || !status?.pinSet;

  return (
    <Card
      style={{ marginTop: 16, borderRadius: 10 }}
      title={
        <Space wrap>
          <TeamOutlined style={{ color: "#1a3353" }} />
          <Text strong>Planning Unit Access</Text>
          {status && (STATE_TAG[status.state] || null)}
          <Tag color="gold">View-only</Tag>
        </Space>
      }
      extra={<Button size="small" icon={<ReloadOutlined />} onClick={load}>Refresh</Button>}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="A time-limited, view-only way into the SLF Portal for the Planning Unit"
        description={
          <span>
            The Planning Unit signs in on the <b>SLF Portal login page</b> with this username and password,
            enters this PIN, then picks the SLF portal account to view. They can open every page and
            report of that account, but <b>cannot save, submit, edit or delete anything</b>: the server
            refuses every change. Access stops automatically at the <b>Valid until</b> date
            (default <b>December 31, 2026</b>), and every account opened is logged.
          </span>
        }
      />

      {status && (
        <Descriptions size="small" column={{ xs: 1, md: 3 }} style={{ marginBottom: 16 }} bordered>
          <Descriptions.Item label="Username">{status.username || "—"}</Descriptions.Item>
          <Descriptions.Item label="Valid until">
            {fmt(status.validUntil)} {status.expired && <Tag color="red" style={{ marginInlineStart: 6 }}>Expired</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label="Password / PIN">
            <Space size={4}>
              <Tag color={status.passwordSet ? "green" : "red"}>{status.passwordSet ? "Password set" : "No password"}</Tag>
              <Tag color={status.pinSet ? "green" : "red"}>{status.pinSet ? "PIN set" : "No PIN"}</Tag>
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="Last used">{fmt(status.lastUsedAt)}</Descriptions.Item>
          <Descriptions.Item label="Last account viewed">{status.lastViewedPortalUser || "—"}</Descriptions.Item>
          <Descriptions.Item label="Lockout">
            {status.locked ? <Tag color="volcano">Locked until {fmt(status.lockedUntil)}</Tag> : "None"}
          </Descriptions.Item>
        </Descriptions>
      )}

      <Form form={form} layout="vertical" onFinish={save} requiredMark={false}>
        <Row gutter={[16, 0]}>
          <Col xs={24} md={8}>
            <Form.Item name="enabled" label="Planning Unit sign-in" valuePropName="checked">
              <Switch checkedChildren="On" unCheckedChildren="Off" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item
              name="username"
              label="Username"
              rules={[
                { required: true, message: "Enter a username" },
                { pattern: /^[a-zA-Z0-9._-]{4,40}$/, message: "4–40 letters, numbers, dot, dash or underscore" },
              ]}
            >
              <Input placeholder="planningunit" autoComplete="off" />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="validUntil" label="Valid until" rules={[{ required: true, message: "Pick the last day of access" }]}>
              <DatePicker style={{ width: "100%" }} format="MMM D, YYYY" allowClear={false} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="password"
              label={status?.passwordSet ? "New password (leave blank to keep)" : "Password"}
              rules={[
                { required: firstSetup && !status?.passwordSet, message: "Set a password" },
                { min: 8, message: "At least 8 characters" },
              ]}
            >
              <Input.Password autoComplete="new-password" placeholder="At least 8 characters" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="confirmPassword"
              label="Confirm password"
              dependencies={["password"]}
              rules={[({ getFieldValue }) => ({
                validator: (_, v) => (!getFieldValue("password") || v === getFieldValue("password")
                  ? Promise.resolve() : Promise.reject(new Error("Passwords do not match"))),
              })]}
            >
              <Input.Password autoComplete="new-password" placeholder="Re-enter password" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="pin"
              label={status?.pinSet ? "New PIN (leave blank to keep)" : "PIN (6 digits)"}
              rules={[
                { required: firstSetup && !status?.pinSet, message: "Set a 6-digit PIN" },
                { pattern: /^\d{6}$/, message: "PIN must be exactly 6 digits" },
              ]}
            >
              <Input.Password inputMode="numeric" maxLength={6} placeholder="6-digit PIN" autoComplete="off" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="confirmPin"
              label="Confirm PIN"
              dependencies={["pin"]}
              rules={[({ getFieldValue }) => ({
                validator: (_, v) => (!getFieldValue("pin") || v === getFieldValue("pin")
                  ? Promise.resolve() : Promise.reject(new Error("PINs do not match"))),
              })]}
            >
              <Input.Password inputMode="numeric" maxLength={6} placeholder="Re-enter PIN" autoComplete="off" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              name="currentPassword"
              label="Your developer password (to confirm)"
              rules={[{ required: true, message: "Enter your developer password" }]}
            >
              <Input.Password autoComplete="current-password" placeholder="Developer account password" />
            </Form.Item>
          </Col>
        </Row>
        <Space wrap>
          <Button type="primary" htmlType="submit" loading={saving} icon={<EyeOutlined />}>
            Save Planning Unit Access
          </Button>
          <Button danger icon={<LogoutOutlined />} loading={ending} onClick={endSessions} disabled={!status?.passwordSet}>
            Sign out all Planning Unit sessions
          </Button>
        </Space>
      </Form>

      <Collapse
        style={{ marginTop: 16 }}
        items={[{
          key: "how",
          label: "How the Planning Unit signs in",
          children: (
            <ol style={{ paddingLeft: 18, margin: 0, lineHeight: 1.9 }}>
              <li>Open the SLF Portal login page.</li>
              <li>Type the Planning Unit <b>username</b> in the Email field and the <b>password</b>, then click <b>Sign In</b>.</li>
              <li>Enter the 6-digit <b>PIN</b>.</li>
              <li>Choose the SLF portal account to view, then click <b>Open View-only</b>.</li>
              <li>A navy <b>Planning Unit View · VIEW-ONLY</b> banner stays on screen. Log out to switch accounts or finish.</li>
            </ol>
          ),
        }]}
      />
    </Card>
  );
}
