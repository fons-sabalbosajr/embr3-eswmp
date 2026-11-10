import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  AutoComplete,
  Button,
  Card,
  Checkbox,
  Col,
  Collapse,
  Descriptions,
  Divider,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  ApiOutlined,
  CheckCircleOutlined,
  CheckCircleTwoTone,
  ClockCircleOutlined,
  CloseCircleTwoTone,
  DatabaseOutlined,
  DeleteOutlined,
  KeyOutlined,
  MessageOutlined,
  MinusCircleOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
  ThunderboltOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import Swal from "sweetalert2";
import dayjs from "dayjs";
import api from "../../api";
import { VeraFlame } from "../../components/vera/VeraMark";

const { Text, Paragraph } = Typography;

// ---------------------------------------------------------------------------
// Developer Settings › VERA & AI Agent — laid out like VERA's settings in
// embr3-ucds: what state VERA is in and why, every model in the order the
// router tries it with its live status and today's use, then the switches.
//
// One configuration drives VERA's chat, the automatic submission remarks, the
// ticket triage and the read-only agent query. The browser never talks to a
// model vendor and never sees a key — only a masked hint.
// ---------------------------------------------------------------------------

// Model presets per provider. Any other model name can be typed.
const MODEL_CHOICES = {
  gemini: [
    { value: "gemini-2.5-flash", tag: "Recommended · free tier", tagColor: "green" },
    { value: "gemini-flash-latest", tag: "Free tier", tagColor: "green" },
    { value: "gemini-2.5-flash-lite", tag: "Lighter · free tier", tagColor: "blue" },
    { value: "gemini-2.5-pro", tag: "Needs billing", tagColor: "orange" },
  ],
  groq: [
    { value: "openai/gpt-oss-120b", tag: "Most accurate · free tier", tagColor: "green" },
    { value: "openai/gpt-oss-20b", tag: "Lighter · free tier", tagColor: "blue" },
  ],
  anthropic: [
    { value: "claude-haiku-5-5", tag: "Fast · inexpensive", tagColor: "blue" },
    { value: "claude-sonnet-5-5", tag: "Balanced", tagColor: "purple" },
    { value: "claude-opus-5-5", tag: "Most capable · highest cost", tagColor: "gold" },
    { value: "claude-haiku-4-5", tag: "Previous generation", tagColor: "default" },
  ],
};
const KEY_PLACEHOLDER = { anthropic: "sk-ant-…", gemini: "AIza…", groq: "gsk_…" };

const STATUS = {
  ready: { color: "success", icon: <CheckCircleOutlined />, label: "Ready" },
  resting: { color: "warning", icon: <ClockCircleOutlined />, label: "Resting" },
  "no-key": { color: "default", icon: <KeyOutlined />, label: "No API key" },
};

const fmt = (n) => new Intl.NumberFormat().format(n ?? 0);
const compact = (n) => new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n ?? 0);
function untilText(at) {
  const ms = new Date(at).getTime() - Date.now();
  if (!Number.isFinite(ms)) return "";
  if (ms <= 60000) return "under a minute";
  const h = Math.floor(ms / 3600000);
  const m = Math.round((ms % 3600000) / 60000);
  return h ? `${h}h ${m}m` : `${m}m`;
}

function StatTile({ icon, color, title, value, note, tip }) {
  const tile = (
    <Card size="small" style={{ borderRadius: 10, height: "100%" }} styles={{ body: { padding: "10px 12px" } }}>
      <Space align="start" size={10}>
        <span style={{ fontSize: 20, color, lineHeight: 1 }} aria-hidden>{icon}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: "#8c8c8c" }}>{title}</div>
          <div style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.25 }}>{value}</div>
          <div style={{ fontSize: 11.5, color: "#8c8c8c" }}>{note || " "}</div>
        </div>
      </Space>
    </Card>
  );
  return tip ? <Tooltip title={tip}>{tile}</Tooltip> : tile;
}

export default function AutomationAgentSettings({ isDark }) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [clearingKey, setClearingKey] = useState(false);
  const [status, setStatus] = useState(null);
  const [activity, setActivity] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [testResult, setTestResult] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const provider = Form.useWatch("provider", form) || status?.provider || "gemini";
  const providerInfo = useMemo(
    () => (status?.providers || []).find((p) => p.id === provider) || null,
    [status, provider],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/developer/automation-agent/settings");
      setStatus(data.status || null);
      setActivity(data.activity || null);
      setCatalog(data.functionCatalog || []);
      form.setFieldsValue({ ...data.config, apiKey: "" }); // never prefill a key
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Could not load VERA settings", "error");
    } finally {
      setLoading(false);
    }
  }, [form]);

  // Status only — the form is left as the developer is editing it.
  const refreshStatus = useCallback(async () => {
    setRefreshing(true);
    try {
      const { data } = await api.get("/developer/automation-agent/status");
      setStatus(data.status || null);
      setActivity(data.activity || null);
    } catch {
      /* keep the last status */
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // Loading on mount is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Live: every 30 s while the tab is visible.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") refreshStatus();
    }, 30000);
    return () => clearInterval(t);
  }, [refreshStatus]);

  const save = async (values) => {
    setSaving(true);
    try {
      const payload = { ...values };
      if (!String(payload.apiKey || "").trim()) delete payload.apiKey; // blank keeps the stored key
      const { data } = await api.put("/developer/automation-agent/settings", payload);
      setStatus(data.status || null);
      form.setFieldsValue({ apiKey: "" });
      refreshStatus();
      Swal.fire({ icon: "success", title: "VERA settings saved", timer: 1400, showConfirmButton: false });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Could not save settings", "error");
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { data } = await api.post("/developer/automation-agent/test");
      setTestResult(data);
    } catch (err) {
      setTestResult({ ok: false, message: err.response?.data?.message || "The connection test failed." });
    } finally {
      setTesting(false);
      refreshStatus();
    }
  };

  const clearStoredKey = async () => {
    const res = await Swal.fire({
      icon: "warning",
      title: "Clear the stored API key?",
      text: "Removes the encrypted key from the database. A key in the server environment still applies.",
      showCancelButton: true,
      confirmButtonText: "Clear key",
    });
    if (!res.isConfirmed) return;
    setClearingKey(true);
    try {
      const { data } = await api.put("/developer/automation-agent/settings", { clearApiKey: true });
      setStatus(data.status || null);
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Could not clear the key", "error");
    } finally {
      setClearingKey(false);
    }
  };

  const clearCache = async () => {
    try {
      await api.post("/developer/automation-agent/cache/clear");
      refreshStatus();
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Could not clear the cache", "error");
    }
  };

  // Switching provider: offer that provider's recommended model unless a
  // custom name was typed.
  const onProviderChange = (p) => {
    const cur = form.getFieldValue("model");
    const presets = Object.values(MODEL_CHOICES).flat().map((m) => m.value);
    if (!cur || presets.includes(cur)) form.setFieldsValue({ model: MODEL_CHOICES[p]?.[0]?.value || "" });
    form.setFieldsValue({ apiKey: "" });
  };

  if (loading && !status) {
    return (
      <div style={{ textAlign: "center", padding: 48 }}>
        <Spin />
      </div>
    );
  }

  const t = activity?.totals || {};
  const answeredPct = t.modelCalls ? Math.round((t.modelOk / t.modelCalls) * 100) : null;
  const models = activity?.models || [];
  const anyReady = models.some((m) => m.status === "ready");
  const stateTag = status?.operational ? (
    <Tag color="green">Operational</Tag>
  ) : status?.enabled ? (
    <Tag color="gold">Help library only</Tag>
  ) : (
    <Tag>Off</Tag>
  );

  const columns = [
    { title: "#", key: "i", width: 40, align: "center", render: (_, __, i) => i + 1 },
    {
      title: "Model",
      key: "model",
      width: "30%",
      render: (_, m) => (
        <Space direction="vertical" size={2} style={{ width: "100%" }}>
          <Text strong style={{ fontFamily: "monospace", wordBreak: "break-all" }}>{m.model}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{m.providerLabel} · {m.role}</Text>
        </Space>
      ),
    },
    {
      title: "Status",
      key: "status",
      width: "26%",
      render: (_, m) => {
        const s = STATUS[m.status] || { color: "default", icon: <MinusCircleOutlined />, label: m.status };
        return (
          <Space direction="vertical" size={2}>
            <Tag color={s.color} icon={s.icon} style={{ marginInlineEnd: 0 }}>{s.label}</Tag>
            {m.status === "resting" && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {m.reason} — tried again in {untilText(m.restingUntil)} ({dayjs(m.restingUntil).format("h:mm A")})
              </Text>
            )}
          </Space>
        );
      },
    },
    {
      title: "Today",
      key: "today",
      width: "24%",
      render: (_, m) =>
        m.today?.calls ? (
          <Space direction="vertical" size={0}>
            <Text>{fmt(m.today.calls)} request{m.today.calls === 1 ? "" : "s"}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {fmt(m.today.ok)} answered{m.today.failed ? ` · ${fmt(m.today.failed)} failed` : ""}
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {compact(m.today.inputTokens + m.today.outputTokens)} tokens
              {m.today.avgMs != null ? ` · ${(m.today.avgMs / 1000).toFixed(1)} s avg` : ""}
            </Text>
          </Space>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: "Last used",
      key: "last",
      render: (_, m) =>
        m.today?.lastAt ? (
          <Text style={{ fontSize: 12 }}>{dayjs(m.today.lastAt).format("h:mm A")}</Text>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>Not today</Text>
        ),
    },
  ];

  return (
    <Spin spinning={loading}>
      <Card
        style={{ borderRadius: 12, marginBottom: 16 }}
        title={
          <Space>
            <VeraFlame size={24} theme={isDark ? "dark" : "light"} glow={false} />
            <span>VERA Assistant &amp; AI Agent</span>
            {stateTag}
          </Space>
        }
        extra={
          <Space wrap>
            <Button icon={<ApiOutlined />} loading={testing} onClick={test} disabled={!status?.keyConfigured}>
              Test connection
            </Button>
            <Button icon={<ReloadOutlined />} onClick={load} disabled={saving}>
              Reset
            </Button>
          </Space>
        }
      >
        <Paragraph type="secondary" style={{ marginTop: 0 }}>
          One configuration for VERA's chat (portal, admin and sign-in pages), automatic submission remarks and ticket triage.
          VERA is read-only: it explains and summarizes, and never changes a record.
        </Paragraph>

        {status && (
          <Alert
            style={{ marginBottom: 16 }}
            type={status.operational ? (anyReady ? "success" : "warning") : status.enabled || status.keyConfigured ? "warning" : "info"}
            showIcon
            message={
              status.operational
                ? anyReady
                  ? "VERA is answering with the AI model."
                  : "No model is answering right now — VERA uses the help library until one is tried again."
                : status.enabled
                  ? "VERA is answering from the built-in help library only."
                  : "VERA's AI model is turned off."
            }
            description={
              <div style={{ fontSize: 13 }}>
                {!status.masterEnabled && (
                  <div>• The server switch <Text code>AUTOMATION_AGENT_ENABLED</Text> is not <Text code>true</Text> — it is the master switch, and the toggle below cannot override it.</div>
                )}
                {!status.keyConfigured && (
                  <div>• No API key for {status.providerLabel}. Set <Text code>{status.keyEnvVar}</Text> in <Text code>server/.env</Text>, or store one below.</div>
                )}
                {status.masterEnabled && status.keyConfigured && !status.enabled && <div>• The key and master switch are ready — turn the AI model on below.</div>}
                {status.operational && (
                  <div>• Using <Text strong>{status.providerLabel}</Text> with <Text code>{status.model}</Text>.</div>
                )}
              </div>
            }
          />
        )}

        {testResult && (
          <Alert
            style={{ marginBottom: 16 }}
            type={testResult.ok ? "success" : testResult.code === "not_configured" ? "info" : "error"}
            showIcon
            closable
            onClose={() => setTestResult(null)}
            message={testResult.ok ? `${testResult.model} replied in ${fmt(testResult.durationMs)} ms` : "Connection test failed"}
            description={testResult.ok ? `${testResult.provider} · ${testResult.model}` : testResult.message}
          />
        )}

        {status && (
          <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 4 }} bordered style={{ marginBottom: 16 }}>
            <Descriptions.Item label="Master switch (server)">
              {status.masterEnabled ? (
                <Space size={4}><CheckCircleTwoTone twoToneColor="#52c41a" /> on</Space>
              ) : (
                <Space size={4}><CloseCircleTwoTone twoToneColor="#cf1322" /> off</Space>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="API key">
              {status.keyConfigured ? (
                <Tooltip title={status.keySource === "env" ? "Read from the server environment" : "Stored encrypted in the database"}>
                  <Space size={4}><CheckCircleTwoTone twoToneColor="#52c41a" /><Text style={{ fontSize: 12 }}>{status.keyHint}</Text></Space>
                </Tooltip>
              ) : (
                <Space size={4}><CloseCircleTwoTone twoToneColor="#cf1322" /><Text code>{status.keyEnvVar}</Text></Space>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="Selected model"><Text code>{status.model}</Text></Descriptions.Item>
            <Descriptions.Item label="Last connection">
              {status.lastSuccessfulConnectionAt ? dayjs(status.lastSuccessfulConnectionAt).format("MMM D, h:mm A") : "Never"}
            </Descriptions.Item>
          </Descriptions>
        )}
        {status?.lastError && (
          <Alert type="error" showIcon style={{ marginBottom: 16 }} message="Last error" description={status.lastError} />
        )}

        <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
          <Col xs={12} md={8} xl={4}>
            <StatTile icon={<ApiOutlined />} color="#1677ff" title="Model requests today" value={fmt(t.modelCalls)} note={`${fmt((t.modelCalls || 0) - (t.modelOk || 0))} failed`} />
          </Col>
          <Col xs={12} md={8} xl={4}>
            <StatTile icon={<CheckCircleOutlined />} color="#52c41a" title="Answered" value={answeredPct != null ? `${answeredPct}%` : "—"} note={`${fmt(t.modelOk)} of ${fmt(t.modelCalls)}`} />
          </Col>
          <Col xs={12} md={8} xl={4}>
            <StatTile icon={<ThunderboltOutlined />} color="#d48806" title="Tokens today" value={compact((t.inputTokens || 0) + (t.outputTokens || 0))} note={`${compact(t.inputTokens)} in · ${compact(t.outputTokens)} out`} />
          </Col>
          <Col xs={12} md={8} xl={4}>
            <StatTile icon={<MessageOutlined />} color="#13c2c2" title="Chat messages today" value={fmt(t.chatMessages)} note={`${fmt(t.fromLibrary)} from the help library`} />
          </Col>
          <Col xs={12} md={8} xl={4}>
            <StatTile
              icon={<DatabaseOutlined />}
              color="#722ed1"
              title="From the cache today"
              value={fmt(t.fromCache)}
              note={activity?.cache ? `${compact(activity.cache.tokensSaved)} tokens saved` : ""}
              tip="Answers given from the semantic cache: a question close to one already answered, for the same kind of account. No request, no tokens."
            />
          </Col>
          <Col xs={12} md={8} xl={4}>
            <StatTile
              icon={<SafetyCertificateOutlined />}
              color={activity?.guardrails ? "#52c41a" : "#cf1322"}
              title="Guardrails"
              value={activity?.guardrails ? "On" : "Off"}
              note="injection · secrets · data fence"
            />
          </Col>
        </Row>

        <Card
          size="small"
          title="Models, in the order VERA tries them"
          extra={
            <Text type="secondary" style={{ fontSize: 12 }}>
              <ReloadOutlined spin={refreshing} /> Updated {activity?.asOf ? dayjs(activity.asOf).format("h:mm:ss A") : "—"} · live
            </Text>
          }
        >
          <Table
            size="small"
            rowKey={(m) => `${m.provider}:${m.model}:${m.role}`}
            columns={columns}
            dataSource={models}
            pagination={false}
            tableLayout="fixed"
            scroll={{ x: 640 }}
            locale={{ emptyText: "No model can be routed to — add a key for at least one provider." }}
          />
          <Text type="secondary" style={{ display: "block", marginTop: 8, fontSize: 12 }}>
            A model that fails is rested and the next one answers: a spent daily quota for up to an hour, an overloaded or slow model
            for 10 minutes and longer each time it repeats. Rests are kept in server memory and clear on restart.
          </Text>
        </Card>
      </Card>

      <Card style={{ borderRadius: 12, marginBottom: 16 }} title="Configuration">
        <Form form={form} layout="vertical" onFinish={save} disabled={saving}>
          <Divider orientation="left" style={{ marginTop: 0 }}>Availability</Divider>
          <Row gutter={24}>
            <Col xs={24} sm={8}>
              <Form.Item name="enabled" label="AI model answers" valuePropName="checked" tooltip="Off: VERA still answers, from the built-in help library only. Nothing is sent to a provider.">
                <Switch checkedChildren="On" unCheckedChildren="Off" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item
                name="veraOnAdminLogin"
                label="VERA on the admin sign-in pages"
                valuePropName="checked"
                tooltip="Admin login, sign-up and forgot-password pages. Visitors there are not signed in; VERA only explains account recovery."
              >
                <Switch checkedChildren="Shown" unCheckedChildren="Hidden" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item
                name="veraOnPortalLogin"
                label="VERA on the SLF Portal sign-in pages"
                valuePropName="checked"
                tooltip="Portal login, sign-up and forgot-password pages."
              >
                <Switch checkedChildren="Shown" unCheckedChildren="Hidden" />
              </Form.Item>
            </Col>
          </Row>

          <Divider orientation="left">Model</Divider>
          <Row gutter={24}>
            <Col xs={24} md={8}>
              <Form.Item name="provider" label="Provider" tooltip="Each provider reads its own key from its own environment variable.">
                <Select
                  onChange={onProviderChange}
                  options={(status?.providers || []).map((p) => ({
                    value: p.id,
                    label: (
                      <Space size={6}>
                        <span>{p.label}</span>
                        {p.keyConfigured ? <Tag color="green" style={{ marginInlineEnd: 0, fontSize: 11 }}>key set</Tag> : <Tag style={{ marginInlineEnd: 0, fontSize: 11 }}>no key</Tag>}
                      </Space>
                    ),
                  }))}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={10}>
              <Form.Item name="model" label="Model" tooltip="Pick one or type a model name. Blank uses the provider's server default.">
                <AutoComplete
                  allowClear
                  placeholder={providerInfo?.defaultModel || "provider default"}
                  options={(MODEL_CHOICES[provider] || []).map((m) => ({
                    value: m.value,
                    label: (
                      <Space size={6}>
                        <span>{m.value}</span>
                        {m.tag && <Tag color={m.tagColor} style={{ marginInlineEnd: 0, fontSize: 11 }}>{m.tag}</Tag>}
                      </Space>
                    ),
                  }))}
                  filterOption={(input, option) => option.value.toLowerCase().includes(String(input || "").toLowerCase())}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="maxTokens" label="Max reply tokens" tooltip="The longest answer a model may give.">
                <InputNumber min={64} max={8192} step={64} style={{ width: "100%" }} placeholder={String(status?.maxTokens ?? "")} />
              </Form.Item>
            </Col>
            <Col xs={24} md={14}>
              <Form.Item
                name="apiKey"
                label={<span><KeyOutlined /> Stored API key (encrypted)</span>}
                extra={
                  providerInfo?.keySource === "env"
                    ? `${providerInfo.envVar} is set on the server and takes precedence — leave blank.`
                    : providerInfo?.keyConfigured
                      ? "A key is stored. Leave blank to keep it, or paste a new one to replace it."
                      : `Prefer ${providerInfo?.envVar || "the provider's variable"} in server/.env; a key pasted here is encrypted at rest.`
                }
              >
                <Input.Password placeholder={providerInfo?.keyConfigured ? "•••••••• (stored)" : KEY_PLACEHOLDER[provider]} autoComplete="new-password" />
              </Form.Item>
            </Col>
            <Col xs={24} md={10} style={{ display: "flex", alignItems: "center" }}>
              {status?.keySource === "database" && (
                <Button danger type="link" icon={<DeleteOutlined />} loading={clearingKey} onClick={clearStoredKey}>
                  Clear stored key
                </Button>
              )}
            </Col>
          </Row>

          <Divider orientation="left">Limits</Divider>
          <Row gutter={24}>
            <Col xs={12} md={8}>
              <Form.Item name="dailyRequestLimit" label="Agent queries per day, everyone" tooltip="Blank uses the server value.">
                <InputNumber min={0} max={100000} style={{ width: "100%" }} placeholder={String(status?.dailyRequestLimit ?? "")} />
              </Form.Item>
            </Col>
            <Col xs={12} md={8}>
              <Form.Item name="perUserRequestLimit" label="Agent queries per person / day" tooltip="Blank uses the server value.">
                <InputNumber min={0} max={100000} style={{ width: "100%" }} placeholder={String(status?.perUserRequestLimit ?? "")} />
              </Form.Item>
            </Col>
          </Row>

          <Divider orientation="left">Cost &amp; safety</Divider>
          <Row gutter={24}>
            <Col xs={24} sm={12} lg={8}>
              <Form.Item
                name="semanticCache"
                label="Reuse answers to the same question"
                valuePropName="checked"
                tooltip="A question close to one already answered — same meaning, same help articles, same kind of account — is answered from server memory with no model request. Never for live data, page data or follow-ups."
              >
                <Switch checkedChildren="On" unCheckedChildren="Off" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <Form.Item
                name="lightModelRouting"
                label="Send short questions to the light model"
                valuePropName="checked"
                tooltip={`Short help questions go to ${status?.router?.lightModel || "the provider's light model"} first: fewer tokens and its own quota. Live data and long questions stay on the selected model.`}
              >
                <Switch checkedChildren="On" unCheckedChildren="Off" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <Form.Item
                name="guardrails"
                label="Guardrails"
                valuePropName="checked"
                tooltip="Refuses prompt-injection attempts for every role, removes anything shaped like a key, token, password or connection string from every answer, and marks records sent to the model as data, never instructions."
              >
                <Switch checkedChildren="On" unCheckedChildren="Off" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <Form.Item name="modelRouting" label="Fall back within the provider" valuePropName="checked" tooltip="When the selected model is rate limited or down, its light model answers.">
                <Switch checkedChildren="On" unCheckedChildren="Off" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <Form.Item name="crossProviderFallback" label="Fall back to other providers" valuePropName="checked" tooltip="Then the other providers whose keys are set, free tiers first.">
                <Switch checkedChildren="On" unCheckedChildren="Off" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} lg={8}>
              <Space direction="vertical" size={2}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Cache: {fmt(activity?.cache?.entries)} answers kept · {fmt(activity?.cache?.hits)} hits / {fmt(activity?.cache?.misses)} misses since restart
                </Text>
                <Button size="small" icon={<DeleteOutlined />} onClick={clearCache} disabled={!activity?.cache?.entries}>
                  Empty the cache
                </Button>
              </Space>
            </Col>
          </Row>

          <Collapse
            ghost
            style={{ marginBottom: 12 }}
            items={[
              {
                key: "advanced",
                label: <Text type="secondary">Advanced — tuning, logging and the agent's read-only functions</Text>,
                children: (
                  <>
                    <Row gutter={24}>
                      <Col xs={12} md={6}>
                        <Form.Item name="temperature" label="Temperature" tooltip="Claude 5.x models take no temperature; it is left out for them.">
                          <InputNumber min={0} max={1} step={0.1} style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col xs={12} md={6}>
                        <Form.Item name="requestTimeoutMs" label="Timeout (ms)">
                          <InputNumber min={1000} max={120000} step={1000} style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={12}>
                        <Form.Item name="loggingLevel" label="Logging level">
                          <Select
                            options={[
                              { label: "None — count only", value: "none" },
                              { label: "Metadata — tokens and timing (recommended)", value: "metadata" },
                              { label: "Full — also the question and the answer", value: "full" },
                            ]}
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Form.Item name="systemInstruction" label="Agent system instruction" tooltip="For the read-only agent query and automatic remarks. VERA's chat has its own built-in rules.">
                      <Input.TextArea rows={3} />
                    </Form.Item>
                    <Form.Item name="allowedFunctions" label="Allowed read-only functions" extra="None checked permits every read-only function.">
                      <Checkbox.Group style={{ width: "100%" }}>
                        <Row gutter={[8, 8]}>
                          {catalog.map((f) => (
                            <Col xs={24} md={12} key={f.id}>
                              <Checkbox value={f.id}>
                                <Text style={{ fontSize: 13 }}>{f.label}</Text>
                              </Checkbox>
                            </Col>
                          ))}
                        </Row>
                      </Checkbox.Group>
                    </Form.Item>
                  </>
                ),
              },
            ]}
          />

          <Space>
            <Button type="primary" icon={<SaveOutlined />} htmlType="submit" loading={saving}>
              Save VERA settings
            </Button>
            {!status?.masterEnabled && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                <WarningOutlined /> The server master switch is off — settings are saved but no model is called.
              </Text>
            )}
          </Space>
        </Form>
      </Card>
    </Spin>
  );
}
