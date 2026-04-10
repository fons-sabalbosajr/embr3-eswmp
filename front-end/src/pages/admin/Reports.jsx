import { useState, useEffect, useCallback } from "react";
import {
  Card,
  Table,
  Typography,
  Select,
  Input,
  Tag,
  Space,
  Button,
  Timeline,
  Modal,
  Empty,
  Row,
  Col,
  Spin,
} from "antd";
import {
  BarChartOutlined,
  SearchOutlined,
  ReloadOutlined,
  SendOutlined,
  MailOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  HistoryOutlined,
  ExclamationCircleOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import api from "../../api";
import { exportToExcel } from "../../utils/exportExcel";
import secureStorage from "../../utils/secureStorage";

const { Title, Text } = Typography;
const { Option } = Select;
const CACHE_KEY = "reports-txn-cache";
const CACHE_TTL = 5 * 60 * 1000;

const TYPE_CONFIG = {
  submission: { color: "blue", icon: <SendOutlined />, label: "Submission" },
  email_ack_sent: { color: "green", icon: <MailOutlined />, label: "Email Sent" },
  email_ack_failed: { color: "red", icon: <ExclamationCircleOutlined />, label: "Email Failed" },
  status_change: { color: "orange", icon: <CheckCircleOutlined />, label: "Status Change" },
  deleted: { color: "default", icon: <DeleteOutlined />, label: "Deleted" },
};

export default function Reports() {
  const [transactions, setTransactions] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState([]);
  const [filterCompany, setFilterCompany] = useState(undefined);
  const [filterType, setFilterType] = useState(undefined);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Thread modal
  const [threadVisible, setThreadVisible] = useState(false);
  const [threadData, setThreadData] = useState([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadSubId, setThreadSubId] = useState("");

  const fetchTransactions = useCallback(async (skipCache = false) => {
    const cacheSubKey = `${CACHE_KEY}-${page}-${pageSize}-${filterCompany || ""}-${filterType || ""}-${search || ""}`;
    if (!skipCache) {
      const cached = secureStorage.getJSON(cacheSubKey);
      if (cached && Date.now() - cached.ts < CACHE_TTL) {
        setTransactions(cached.data.transactions);
        setTotal(cached.data.total);
        setLoading(false);
        return;
      }
    }
    setLoading(true);
    try {
      const params = { page, limit: pageSize };
      if (filterCompany) params.company = filterCompany;
      if (filterType) params.type = filterType;
      if (search) params.search = search;

      const { data } = await api.get("/transactions", { params });
      setTransactions(data.transactions);
      setTotal(data.total);
      secureStorage.setJSON(cacheSubKey, { data, ts: Date.now() });
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filterCompany, filterType, search]);

  const fetchCompanies = useCallback(async () => {
    try {
      const cached = secureStorage.getJSON("reports-companies-cache");
      if (cached && Date.now() - cached.ts < CACHE_TTL) {
        setCompanies(cached.data);
        return;
      }
      const { data } = await api.get("/transactions/companies");
      setCompanies(data);
      secureStorage.setJSON("reports-companies-cache", { data, ts: Date.now() });
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  useEffect(() => {
    fetchTransactions();
    const interval = setInterval(fetchTransactions, 10000);
    return () => clearInterval(interval);
  }, [fetchTransactions]);

  const openThread = async (submissionId) => {
    setThreadSubId(submissionId);
    setThreadVisible(true);
    setThreadLoading(true);
    try {
      const { data } = await api.get(`/transactions/thread/${submissionId}`);
      setThreadData(data);
    } catch {
      setThreadData([]);
    } finally {
      setThreadLoading(false);
    }
  };

  const handleExport = () => {
    const rows = transactions.map((t, i) => ({
      "#": i + 1,
      Date: dayjs(t.createdAt).format("YYYY-MM-DD HH:mm"),
      "Submission ID": t.submissionId || "—",
      Company: t.companyName || "—",
      Type: TYPE_CONFIG[t.type]?.label || t.type,
      Description: t.description || "—",
      "Performed By": t.performedBy || "—",
      "Submitted By": t.submittedBy || "—",
    }));
    exportToExcel(rows, "Transaction_History", "Transactions");
  };

  const columns = [
    {
      title: "Date & Time",
      dataIndex: "createdAt",
      width: 140,
      render: (v) => <span style={{ fontSize: 12 }}>{dayjs(v).format("MMM DD, YYYY hh:mm A")}</span>,
    },
    {
      title: "Submission ID",
      dataIndex: "submissionId",
      width: 180,
      ellipsis: true,
      render: (v) =>
        v ? (
          <Button type="link" size="small" onClick={() => openThread(v)} style={{ padding: 0, fontSize: 12 }}>
            {v}
          </Button>
        ) : (
          "—"
        ),
    },
    {
      title: "Company",
      dataIndex: "companyName",
      width: 150,
      ellipsis: true,
      render: (v) => <span style={{ fontSize: 12 }}>{v || "—"}</span>,
    },
    {
      title: "Type",
      dataIndex: "type",
      width: 150,
      render: (v) => {
        const cfg = TYPE_CONFIG[v] || {};
        return (
          <Tag color={cfg.color} icon={cfg.icon} style={{ fontSize: 11 }}>
            {cfg.label || v}
          </Tag>
        );
      },
    },
    {
      title: "Description",
      dataIndex: "description",
      ellipsis: true,
      render: (v) => <span style={{ fontSize: 12 }}>{v || "—"}</span>,
    },
    {
      title: "Performed By",
      dataIndex: "performedBy",
      width: 250,
      ellipsis: true,
      render: (v) => <span style={{ fontSize: 12 }}>{v || "—"}</span>,
    },
  ];

  const getTimelineColor = (type) => {
    const map = {
      submission: "blue",
      email_ack_sent: "green",
      email_ack_failed: "red",
      status_change: "orange",
      deleted: "gray",
    };
    return map[type] || "blue";
  };

  return (
    <div>
      <div style={{ marginBottom: 4 }}>
        <Title level={4} style={{ margin: 0 }}>
          <BarChartOutlined style={{ marginRight: 8 }} />
          Reports — Transaction History
        </Title>
        <Text type="secondary">
          Track all submissions, status changes, and email notifications per company
        </Text>
      </div>

      <Card style={{ marginTop: 16, borderRadius: 10 }}>
        <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
          <Col xs={24} sm={8} md={6}>
            <Select
              allowClear
              placeholder="Filter by Company"
              value={filterCompany}
              onChange={(v) => { setFilterCompany(v); setPage(1); }}
              style={{ width: "100%" }}
              showSearch
              optionFilterProp="children"
            >
              {companies.map((c) => (
                <Option key={c} value={c}>
                  {c}
                </Option>
              ))}
            </Select>
          </Col>
          <Col xs={24} sm={8} md={5}>
            <Select
              allowClear
              placeholder="Filter by Type"
              value={filterType}
              onChange={(v) => { setFilterType(v); setPage(1); }}
              style={{ width: "100%" }}
            >
              <Option value="submission">Submission</Option>
              <Option value="email_ack_sent">Email Sent</Option>
              <Option value="email_ack_failed">Email Failed</Option>
              <Option value="status_change">Status Change</Option>
              <Option value="deleted">Deleted</Option>
            </Select>
          </Col>
          <Col xs={24} sm={8} md={6}>
            <Input
              placeholder="Search..."
              prefix={<SearchOutlined />}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              allowClear
            />
          </Col>
          <Col>
            <Space>
              <Button icon={<ReloadOutlined />} onClick={fetchTransactions}>
                Refresh
              </Button>
              <Button onClick={handleExport} disabled={transactions.length === 0}>
                Export Excel
              </Button>
            </Space>
          </Col>
        </Row>

        <Table
          dataSource={transactions}
          columns={columns}
          rowKey="_id"
          loading={loading}
          size="small"
          scroll={{ x: 750 }}
          style={{ fontSize: 12 }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: ["10", "20", "50", "100"],
            onChange: (p, ps) => { setPage(p); setPageSize(ps); },
            showTotal: (t) => `${t} transactions`,
          }}
        />
      </Card>

      {/* Thread Modal */}
      <Modal
        title={
          <Space>
            <HistoryOutlined />
            <span>Transaction Thread — {threadSubId}</span>
          </Space>
        }
        open={threadVisible}
        onCancel={() => setThreadVisible(false)}
        footer={null}
        width={600}
        style={{ maxWidth: "95vw" }}
      >
        {threadLoading ? (
          <div style={{ textAlign: "center", padding: 40 }}>
            <Spin />
          </div>
        ) : threadData.length === 0 ? (
          <Empty description="No transactions found" />
        ) : (
          <Timeline
            items={threadData.map((t) => ({
              color: getTimelineColor(t.type),
              children: (
                <div key={t._id}>
                  <Text strong style={{ fontSize: 13 }}>
                    {TYPE_CONFIG[t.type]?.label || t.type}
                  </Text>
                  <br />
                  <Text style={{ fontSize: 13 }}>{t.description}</Text>
                  <br />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {dayjs(t.createdAt).format("MMM DD, YYYY HH:mm:ss")} — {t.performedBy || "system"}
                  </Text>
                </div>
              ),
            }))}
          />
        )}
      </Modal>
    </div>
  );
}
