import { useEffect, useMemo, useState } from "react";
import {
  Form,
  Input,
  Switch,
  Select,
  AutoComplete,
  InputNumber,
  Button,
  Card,
  Row,
  Col,
  Tag,
  Alert,
  Typography,
  Space,
  Checkbox,
  Spin,
  Descriptions,
} from "antd";
import {
  RobotOutlined,
  SaveOutlined,
  ApiOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
  ExperimentOutlined,
  KeyOutlined,
  CheckCircleFilled,
  GiftOutlined,
  DollarOutlined,
} from "@ant-design/icons";
import Swal from "sweetalert2";
import api from "../../api";

const { Text, Paragraph, Link } = Typography;

// Provider metadata — drives the provider chooser, model presets, and key hints.
// The frontend never holds a raw key; it only submits it for encrypted at-rest
// storage server-side (or the server env var is used). All model calls are
// server-side; the browser never talks to a model vendor directly.
const PROVIDER_INFO = {
  anthropic: {
    label: "Anthropic (Claude)",
    tagline: "Official Claude API — most capable, requires funded billing.",
    accent: "#d97757",
    free: false,
    keyPlaceholder: "sk-ant-…",
    keyUrl: "https://console.anthropic.com/",
    envVar: "ANTHROPIC_API_KEY",
    defaultModel: "claude-haiku-4-5",
    models: [
      { value: "claude-opus-4-8", label: "claude-opus-4-8 — most capable (highest cost)" },
      { value: "claude-sonnet-4-5", label: "claude-sonnet-4-5 — balanced" },
      { value: "claude-haiku-4-5", label: "claude-haiku-4-5 — fastest & cheapest" },
    ],
  },
  gemini: {
    label: "Google Gemini",
    tagline: "Google Gemini API — a genuine free tier is available.",
    accent: "#4285f4",
    free: true,
    keyPlaceholder: "AIza… (free key)",
    keyUrl: "https://aistudio.google.com/apikey",
    envVar: "GEMINI_API_KEY",
    defaultModel: "gemini-2.5-flash",
    models: [
      { value: "gemini-2.5-flash", label: "gemini-2.5-flash — free tier (recommended)" },
      { value: "gemini-flash-latest", label: "gemini-flash-latest — free tier" },
      { value: "gemini-2.5-pro", label: "gemini-2.5-pro — advanced" },
      { value: "gemini-2.0-flash", label: "gemini-2.0-flash — may require billing" },
    ],
  },
};

const ALL_PROVIDER_MODELS = Object.values(PROVIDER_INFO).flatMap((p) => p.models.map((m) => m.value));

// Automation Agent — DEVELOPER configuration surface. It never contains,
// requests, or displays the raw API key: the key lives in the server environment
// (ANTHROPIC_API_KEY / GEMINI_API_KEY) as the source of truth, or as an encrypted
// DB fallback. The frontend only ever sees a masked status.
export default function AutomationAgentSettings({ isDark }) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [usageToday, setUsageToday] = useState(0);

  // Reactive provider selection (drives model presets + key hints).
  const provider = Form.useWatch("provider", form) || "anthropic";
  const info = PROVIDER_INFO[provider] || PROVIDER_INFO.anthropic;

  // Read-only query panel state
  const [queryFn, setQueryFn] = useState(null);
  const [queryText, setQueryText] = useState("");
  const [querying, setQuerying] = useState(false);
  const [queryResult, setQueryResult] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/developer/automation-agent/settings");
      setStatus(data.status || null);
      setCatalog(data.functionCatalog || []);
      setUsageToday(data.usageToday || 0);
      form.setFieldsValue({
        ...data.config,
        provider: data.config?.provider || "anthropic",
        apiKey: "", // never prefill; blank = keep stored key
      });
      if (!queryFn && data.functionCatalog?.length) setQueryFn(data.functionCatalog[0].id);
    } catch {
      /* leave disabled */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switch provider: keep a custom model if the user typed one, otherwise pick
  // the recommended default for the newly selected provider.
  const selectProvider = (p) => {
    if (p === provider) return;
    const curModel = form.getFieldValue("model");
    const otherModels = PROVIDER_INFO[p === "anthropic" ? "gemini" : "anthropic"].models.map((m) => m.value);
    const keepCustom = curModel && !otherModels.includes(curModel) && !ALL_PROVIDER_MODELS.includes(curModel);
    form.setFieldsValue({
      provider: p,
      model: keepCustom ? curModel : PROVIDER_INFO[p].defaultModel,
      apiKey: "", // don't carry a typed key across providers
    });
  };

  const keyTag = useMemo(() => {
    if (!status) return <Tag color="default">Unknown</Tag>;
    if (!status.keyConfigured) return <Tag color="red">Not configured</Tag>;
    return (
      <Tag color="green">
        Configured{status.keySource === "env" ? " (server env)" : " (encrypted DB)"}
      </Tag>
    );
  }, [status]);

  const opTag = useMemo(() => {
    if (!status) return null;
    if (status.operational) return <Tag color="blue">Operational</Tag>;
    if (!status.masterEnabled) return <Tag color="orange">Disabled (env master switch off)</Tag>;
    if (!status.enabled) return <Tag color="orange">Disabled</Tag>;
    if (status.sdkAvailable === false) return <Tag color="red">SDK not installed</Tag>;
    return <Tag color="orange">Not operational (no key)</Tag>;
  }, [status]);

  const handleSave = async (values) => {
    setSaving(true);
    try {
      const payload = { ...values };
      if (!String(payload.apiKey || "").trim()) delete payload.apiKey; // blank keeps stored key
      const { data } = await api.put("/developer/automation-agent/settings", payload);
      setStatus(data.status || null);
      form.setFieldsValue({ apiKey: "" });
      Swal.fire({ icon: "success", title: "Automation Agent settings saved", timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Could not save settings", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const { data } = await api.post("/developer/automation-agent/test");
      if (data.ok) {
        Swal.fire({ icon: "success", title: "Connection successful", text: data.message, timer: 2000, showConfirmButton: false });
      } else {
        Swal.fire({ icon: data.code === "not_configured" ? "info" : "warning", title: "Connection not established", text: data.message });
      }
      await load();
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Test failed", "error");
    } finally {
      setTesting(false);
    }
  };

  const clearStoredKey = async () => {
    const res = await Swal.fire({
      icon: "warning",
      title: "Clear stored API key?",
      text: "This removes the encrypted API key from the database. The server environment key (if set) still applies.",
      showCancelButton: true,
      confirmButtonText: "Clear key",
    });
    if (!res.isConfirmed) return;
    try {
      const { data } = await api.put("/developer/automation-agent/settings", { clearApiKey: true });
      setStatus(data.status || null);
      Swal.fire({ icon: "success", title: "Stored key cleared", timer: 1400, showConfirmButton: false });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Could not clear key", "error");
    }
  };

  const runQuery = async () => {
    if (!queryFn) return;
    setQuerying(true);
    setQueryResult(null);
    try {
      const { data } = await api.post("/automation-agent/query", { functionId: queryFn, question: queryText });
      setQueryResult(data);
      if (data.ok) await load(); // refresh usage counter
    } catch (err) {
      setQueryResult({ ok: false, message: err.response?.data?.message || "Request failed" });
    } finally {
      setQuerying(false);
    }
  };

  const cardStyle = { borderRadius: 10, marginBottom: 16 };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 48 }}>
        <Spin tip="Loading Automation Agent settings…" />
      </div>
    );
  }

  return (
    <Form form={form} layout="vertical" onFinish={handleSave} initialValues={{ provider: "anthropic" }}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16, borderRadius: 8 }}
        message="Read-only AI operations assistant — choose your AI provider"
        description="This agent summarizes and explains system data. It is read-only: it can never modify submissions, change statuses, send messages, or run arbitrary queries. Pick a provider below — Anthropic (Claude) for maximum capability with funded billing, or Google Gemini which offers a genuine free tier. All calls run server-side; the browser never contacts a model vendor. Without a valid key the agent stays disabled."
      />

      {/* Keep provider in the form without rendering a default control */}
      <Form.Item name="provider" hidden><Input /></Form.Item>

      {/* Provider chooser */}
      <Card size="small" style={cardStyle} title={<span><ApiOutlined /> AI Provider</span>}>
        <Row gutter={16}>
          {Object.entries(PROVIDER_INFO).map(([id, p]) => {
            const selected = provider === id;
            return (
              <Col xs={24} md={12} key={id}>
                <Card
                  hoverable
                  onClick={() => selectProvider(id)}
                  style={{
                    borderRadius: 10,
                    marginBottom: 8,
                    cursor: "pointer",
                    borderWidth: selected ? 2 : 1,
                    borderColor: selected ? p.accent : undefined,
                    boxShadow: selected ? `0 0 0 2px ${p.accent}22` : undefined,
                  }}
                  styles={{ body: { padding: 16 } }}
                >
                  <Space align="start" style={{ justifyContent: "space-between", width: "100%" }}>
                    <Space direction="vertical" size={2} style={{ maxWidth: "100%" }}>
                      <Space size={8}>
                        <span style={{ width: 10, height: 10, borderRadius: "50%", background: p.accent, display: "inline-block" }} />
                        <Text strong style={{ fontSize: 15 }}>{p.label}</Text>
                        {p.free ? (
                          <Tag color="green" icon={<GiftOutlined />} style={{ marginInlineEnd: 0 }}>Free tier</Tag>
                        ) : (
                          <Tag color="gold" icon={<DollarOutlined />} style={{ marginInlineEnd: 0 }}>Paid</Tag>
                        )}
                      </Space>
                      <Text type="secondary" style={{ fontSize: 12 }}>{p.tagline}</Text>
                    </Space>
                    {selected && <CheckCircleFilled style={{ color: p.accent, fontSize: 18 }} />}
                  </Space>
                </Card>
              </Col>
            );
          })}
        </Row>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Get a key: <Link href={info.keyUrl} target="_blank" rel="noreferrer">{info.keyUrl}</Link>
        </Text>
      </Card>

      {/* Status */}
      <Card size="small" style={cardStyle} title={<span><RobotOutlined /> Agent Status</span>}>
        <Descriptions size="small" column={{ xs: 1, sm: 2, md: 3 }} bordered>
          <Descriptions.Item label="Provider">{status?.providerLabel || info.label}</Descriptions.Item>
          <Descriptions.Item label="State">{opTag}</Descriptions.Item>
          <Descriptions.Item label="API Key">
            <Space size={4} wrap>
              {keyTag}
              {status?.keyConfigured && status?.keyHint && (
                <Text type="secondary" style={{ fontSize: 12 }}>{status.keyHint}</Text>
              )}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="Model">{status?.model || "—"}</Descriptions.Item>
          <Descriptions.Item label="Requests today">{usageToday} / {status?.dailyRequestLimit ?? "∞"}</Descriptions.Item>
          <Descriptions.Item label="Last connection">
            {status?.lastSuccessfulConnectionAt ? new Date(status.lastSuccessfulConnectionAt).toLocaleString() : "Never"}
          </Descriptions.Item>
        </Descriptions>
        {status?.lastError && (
          <Alert type="error" showIcon style={{ marginTop: 12 }} message="Last error" description={status.lastError} />
        )}
        <div style={{ marginTop: 12 }}>
          <Button icon={<ThunderboltOutlined />} onClick={handleTest} loading={testing}>
            Test Connection
          </Button>
        </div>
      </Card>

      {/* Enable + Model config */}
      <Card size="small" style={cardStyle} title={<span><ExperimentOutlined /> Model &amp; Tuning</span>}>
        <Row gutter={16}>
          <Col xs={24} md={8}>
            <Form.Item name="enabled" label="Agent enabled" valuePropName="checked">
              <Switch checkedChildren="Enabled" unCheckedChildren="Disabled" />
            </Form.Item>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Also requires the server master switch (AUTOMATION_AGENT_ENABLED) and a key.
            </Text>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item
              name="model"
              label={`Model (${info.label})`}
              extra={`Pick a preset or type a custom ${info.label} model. Blank falls back to the server default.`}
            >
              <AutoComplete
                options={info.models.map((m) => ({ value: m.value, label: m.label }))}
                placeholder={info.defaultModel}
                filterOption={(input, opt) => String(opt?.value || "").toLowerCase().includes(input.toLowerCase())}
                allowClear
              />
            </Form.Item>
          </Col>
          <Col xs={12} md={4}>
            <Form.Item name="maxTokens" label="Max output tokens">
              <InputNumber min={1} max={8192} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col xs={12} md={4}>
            <Form.Item name="temperature" label="Temperature">
              <InputNumber min={0} max={1} step={0.1} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col xs={12} md={8}>
            <Form.Item name="requestTimeoutMs" label="Request timeout (ms)">
              <InputNumber min={1000} max={120000} step={1000} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={16}>
            <Form.Item
              name="apiKey"
              label={<span><KeyOutlined /> {info.label} API Key (encrypted DB fallback)</span>}
              extra={
                status?.keySource === "env"
                  ? `A server environment key (${status?.keyEnvVar || info.envVar}) is active and takes precedence. Leave blank.`
                  : status?.keyConfigured
                    ? "A key is stored (encrypted). Leave blank to keep it, or enter a new one to replace it."
                    : `No key stored. Prefer setting ${info.envVar} on the server; a key entered here is encrypted at rest.`
              }
            >
              <Input.Password placeholder={status?.keyConfigured ? "•••••••• (stored)" : info.keyPlaceholder} autoComplete="new-password" />
            </Form.Item>
            {status?.keySource === "database" && (
              <Button size="small" danger type="link" onClick={clearStoredKey}>Clear stored key</Button>
            )}
            {info.free && (
              <Alert
                type="success"
                showIcon
                icon={<GiftOutlined />}
                style={{ marginTop: 4, borderRadius: 8 }}
                message="Free tier tip"
                description="Gemini Flash models (e.g. gemini-2.5-flash) work on the free tier with no billing. If a model reports zero free-tier quota, switch to a Flash model."
              />
            )}
          </Col>
        </Row>
      </Card>

      {/* Limits + logging */}
      <Card size="small" style={cardStyle} title={<span><SafetyCertificateOutlined /> Usage &amp; Cost Controls</span>}>
        <Row gutter={16}>
          <Col xs={12} md={6}>
            <Form.Item name="dailyRequestLimit" label="Daily request limit (global)" extra="Blank = env default">
              <InputNumber min={0} max={100000} style={{ width: "100%" }} placeholder="env" />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="perUserRequestLimit" label="Per-user daily limit" extra="Blank = env default">
              <InputNumber min={0} max={100000} style={{ width: "100%" }} placeholder="env" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="loggingLevel" label="Logging level" extra="'full' stores prompt + response (developer-only, access-controlled).">
              <Select
                options={[
                  { label: "None — count only", value: "none" },
                  { label: "Metadata — tokens, categories, duration (recommended)", value: "metadata" },
                  { label: "Full — includes prompt + response text", value: "full" },
                ]}
              />
            </Form.Item>
          </Col>
        </Row>
      </Card>

      {/* Behavior */}
      <Card size="small" style={cardStyle} title={<span><ExperimentOutlined /> Behavior &amp; Allowed Functions</span>}>
        <Form.Item name="systemInstruction" label="System instruction">
          <Input.TextArea rows={3} placeholder="How the agent should behave…" />
        </Form.Item>
        <Form.Item name="allowedFunctions" label="Allowed read-only functions" extra="Leave all unchecked to permit every read-only function.">
          <Checkbox.Group style={{ width: "100%" }}>
            <Row gutter={[8, 8]}>
              {catalog.map((f) => (
                <Col xs={24} md={12} key={f.id}>
                  <Checkbox value={f.id}>
                    <Text strong style={{ fontSize: 13 }}>{f.label}</Text>
                    <div style={{ fontSize: 11, color: "#888" }}>{f.description}</div>
                  </Checkbox>
                </Col>
              ))}
            </Row>
          </Checkbox.Group>
        </Form.Item>
      </Card>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 24 }}>
        <Button type="primary" icon={<SaveOutlined />} htmlType="submit" loading={saving}>
          Save Automation Agent Settings
        </Button>
      </div>

      {/* Read-only query panel (drives POST /automation-agent/query) */}
      <Card size="small" style={cardStyle} title={<span><RobotOutlined /> Try a read-only query</span>}>
        <Paragraph type="secondary" style={{ fontSize: 12 }}>
          Runs one allowlisted read-only function to build bounded, sanitized context, then asks the model to summarize it. Requires the agent to be operational.
        </Paragraph>
        <Row gutter={12}>
          <Col xs={24} md={10}>
            <Select
              style={{ width: "100%" }}
              value={queryFn}
              onChange={setQueryFn}
              placeholder="Select a function"
              options={catalog.map((f) => ({ label: f.label, value: f.id }))}
            />
          </Col>
          <Col xs={24} md={10}>
            <Input
              placeholder="Optional question / focus"
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              onPressEnter={runQuery}
            />
          </Col>
          <Col xs={24} md={4}>
            <Button
              type="primary"
              block
              onClick={runQuery}
              loading={querying}
              disabled={querying || !status?.operational || !queryFn}
            >
              Run
            </Button>
          </Col>
        </Row>
        {!status?.operational && (
          <Text type="secondary" style={{ fontSize: 12 }}>The agent must be enabled with a valid key before you can run a query.</Text>
        )}
        {queryResult && (
          <div style={{ marginTop: 12 }}>
            {queryResult.ok ? (
              <Alert
                type="success"
                message={
                  <Space wrap size={6}>
                    <Text strong>Answer</Text>
                    {queryResult.provider && <Tag color="blue">{queryResult.provider}</Tag>}
                    {queryResult.model && <Tag>{queryResult.model}</Tag>}
                    {queryResult.maskingApplied && <Tag color="volcano">masked context</Tag>}
                    {(queryResult.dataCategories || []).map((c) => <Tag key={c}>{c}</Tag>)}
                  </Space>
                }
                description={<div style={{ whiteSpace: "pre-wrap" }}>{queryResult.answer}</div>}
              />
            ) : (
              <Alert type={queryResult.code === "disabled" ? "info" : "warning"} showIcon message={queryResult.message} />
            )}
          </div>
        )}
      </Card>

      <Text type="secondary" style={{ fontSize: 12, color: isDark ? "#8c8c8c" : undefined }}>
        The API key is never exposed to the browser, returned in responses, or logged in full. The frontend calls this application's backend only — never a model vendor directly.
      </Text>
    </Form>
  );
}
