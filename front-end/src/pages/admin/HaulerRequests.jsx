import { useState, useEffect, useRef } from "react";
import {
  Table,
  Button,
  Tag,
  Space,
  Typography,
  Select,
  Input,
  Modal,
  Tooltip,
  Badge,
} from "antd";
import {
  CheckOutlined,
  CloseOutlined,
  EyeOutlined,
  SearchOutlined,
  ReloadOutlined,
  FilePdfOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import Swal from "sweetalert2";
import api from "../../api";
import dayjs from "dayjs";

const { Text, Title } = Typography;
const { Option } = Select;

const STATUS_COLOR = {
  pending: "gold",
  approved: "green",
  rejected: "red",
};

export default function HaulerRequests({ isDark, canEdit = true }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [viewRecord, setViewRecord] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const fetchingRef = useRef(false);

  const fetchData = async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setLoading(true);
    try {
      const params = { limit: 100 };
      if (statusFilter !== "all") params.status = statusFilter;
      if (search) params.search = search;
      const { data: res } = await api.get("/hauler-delete-requests", { params });
      setData(res.requests || []);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const handleApprove = async (record) => {
    const result = await Swal.fire({
      title: "Approve Deletion Request?",
      html: `This will permanently remove the hauler <strong>${record.haulerName}</strong> from ${record.slfName || record.companyName || "the SLF"}.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#52c41a",
      cancelButtonColor: "#8c8c8c",
      confirmButtonText: "Yes, Approve",
      input: "textarea",
      inputPlaceholder: "Admin remarks (optional)...",
      inputAttributes: { rows: 3 },
    });
    if (!result.isConfirmed) return;
    setActionLoading(true);
    try {
      await api.patch(`/hauler-delete-requests/${record._id}/approve`, {
        adminRemarks: result.value || "",
      });
      Swal.fire("Approved!", `Hauler "${record.haulerName}" has been removed.`, "success");
      fetchData();
      setViewRecord(null);
    } catch (err) {
      Swal.fire("Error", err?.response?.data?.message || "Could not approve the request.", "error");
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async (record) => {
    const result = await Swal.fire({
      title: "Reject Deletion Request?",
      html: `Request <strong>${record.requestNo}</strong> will be rejected.`,
      icon: "question",
      showCancelButton: true,
      confirmButtonColor: "#ff4d4f",
      cancelButtonColor: "#8c8c8c",
      confirmButtonText: "Reject",
      input: "textarea",
      inputPlaceholder: "Reason for rejection (optional)...",
      inputAttributes: { rows: 3 },
    });
    if (!result.isConfirmed) return;
    setActionLoading(true);
    try {
      await api.patch(`/hauler-delete-requests/${record._id}/reject`, {
        adminRemarks: result.value || "",
      });
      Swal.fire("Rejected", "The deletion request has been rejected.", "success");
      fetchData();
      setViewRecord(null);
    } catch (err) {
      Swal.fire("Error", err?.response?.data?.message || "Could not reject the request.", "error");
    } finally {
      setActionLoading(false);
    }
  };

  const pendingCount = data.filter((r) => r.status === "pending").length;

  const filtered = data.filter((r) => {
    const s = search.toLowerCase();
    if (!s) return true;
    return (
      r.haulerName?.toLowerCase().includes(s) ||
      r.portalUserEmail?.toLowerCase().includes(s) ||
      r.companyName?.toLowerCase().includes(s) ||
      r.requestNo?.toLowerCase().includes(s)
    );
  });

  const columns = [
    {
      title: "#",
      key: "index",
      width: 45,
      render: (_, __, i) => i + 1,
    },
    {
      title: "Request No.",
      dataIndex: "requestNo",
      key: "requestNo",
      width: 130,
      render: (v) => <Text strong style={{ fontSize: 12 }}>{v}</Text>,
    },
    {
      title: "Hauler Name",
      dataIndex: "haulerName",
      key: "haulerName",
    },
    {
      title: "SLF / Company",
      key: "company",
      render: (_, r) => r.slfName || r.companyName || "—",
    },
    {
      title: "Submitted By",
      dataIndex: "portalUserEmail",
      key: "portalUserEmail",
      render: (v, r) => (
        <div>
          <Text style={{ fontSize: 12 }}>{r.portalUserName || v}</Text>
          <Text type="secondary" style={{ fontSize: 11, display: "block" }}>{v}</Text>
        </div>
      ),
    },
    {
      title: "Date Submitted",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 130,
      render: (v) => dayjs(v).format("MMM D, YYYY"),
    },
    {
      title: "LOI",
      key: "loi",
      width: 60,
      render: (_, r) =>
        r.letterOfIntentUrl ? (
          <Tooltip title="View Letter of Intent">
            <Button
              type="link"
              size="small"
              icon={<FilePdfOutlined />}
              href={r.letterOfIntentUrl}
              target="_blank"
            />
          </Tooltip>
        ) : (
          <Text type="secondary" style={{ fontSize: 11 }}>None</Text>
        ),
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (v) => (
        <Tag color={STATUS_COLOR[v] || "default"} style={{ textTransform: "capitalize" }}>
          {v}
        </Tag>
      ),
    },
    {
      title: "Actions",
      key: "actions",
      width: 110,
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title="View Details">
            <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => setViewRecord(r)} />
          </Tooltip>
          {canEdit && r.status === "pending" && (
            <>
              <Tooltip title="Approve">
                <Button
                  type="text"
                  size="small"
                  icon={<CheckOutlined />}
                  style={{ color: "#52c41a" }}
                  loading={actionLoading}
                  onClick={() => handleApprove(r)}
                />
              </Tooltip>
              <Tooltip title="Reject">
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<CloseOutlined />}
                  loading={actionLoading}
                  onClick={() => handleReject(r)}
                />
              </Tooltip>
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: "0 2px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div>
          <Title level={5} style={{ margin: 0 }}>
            Hauler Deletion Requests
            {pendingCount > 0 && (
              <Badge count={pendingCount} style={{ marginLeft: 8, backgroundColor: "#faad14" }} />
            )}
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Review and process portal users&apos; requests to delete accredited haulers.
          </Text>
        </div>
        <Space style={{ marginLeft: "auto" }} wrap>
          <Select
            value={statusFilter}
            onChange={(v) => setStatusFilter(v)}
            style={{ width: 130 }}
          >
            <Option value="all">All Status</Option>
            <Option value="pending">Pending</Option>
            <Option value="approved">Approved</Option>
            <Option value="rejected">Rejected</Option>
          </Select>
          <Input
            prefix={<SearchOutlined />}
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            allowClear
            style={{ width: 200 }}
          />
          <Button icon={<ReloadOutlined />} onClick={fetchData} loading={loading}>
            Refresh
          </Button>
        </Space>
      </div>

      <Table
        dataSource={filtered}
        rowKey="_id"
        columns={columns}
        loading={loading}
        size="small"
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `${t} request(s)` }}
        locale={{ emptyText: "No hauler deletion requests found." }}
      />

      {/* View Details Modal */}
      <Modal
        title={`Request Details — ${viewRecord?.requestNo}`}
        open={!!viewRecord}
        onCancel={() => setViewRecord(null)}
        footer={
          canEdit && viewRecord?.status === "pending"
            ? [
                <Button key="close" onClick={() => setViewRecord(null)}>Close</Button>,
                <Button key="reject" danger icon={<CloseOutlined />} loading={actionLoading} onClick={() => handleReject(viewRecord)}>Reject</Button>,
                <Button key="approve" type="primary" icon={<CheckOutlined />} style={{ background: "#52c41a", borderColor: "#52c41a" }} loading={actionLoading} onClick={() => handleApprove(viewRecord)}>Approve & Delete Hauler</Button>,
              ]
            : [<Button key="close" onClick={() => setViewRecord(null)}>Close</Button>]
        }
        width={560}
        destroyOnHidden
      >
        {viewRecord && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ background: "#fafafa", borderRadius: 8, padding: 14, border: "1px solid #f0f0f0" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px" }}>
                {[
                  ["Request No.", viewRecord.requestNo],
                  ["Status", <Tag color={STATUS_COLOR[viewRecord.status]}>{viewRecord.status}</Tag>],
                  ["Hauler Name", viewRecord.haulerName],
                  ["Office Address", viewRecord.officeAddress || "—"],
                  ["SLF / Company", viewRecord.slfName || viewRecord.companyName || "—"],
                  ["Submitted By", `${viewRecord.portalUserName || ""} (${viewRecord.portalUserEmail})`],
                  ["Date Submitted", dayjs(viewRecord.createdAt).format("MMMM D, YYYY h:mm A")],
                  ["Reviewed By", viewRecord.reviewedBy || "—"],
                  ["Reviewed At", viewRecord.reviewedAt ? dayjs(viewRecord.reviewedAt).format("MMMM D, YYYY h:mm A") : "—"],
                ].map(([label, val]) => (
                  <div key={label}>
                    <Text type="secondary" style={{ fontSize: 11, display: "block" }}>{label}</Text>
                    <Text style={{ fontSize: 13 }}>{val}</Text>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 11, display: "block", marginBottom: 4 }}>Reason / Justification</Text>
              <div style={{ background: "#fffbe6", border: "1px solid #ffe58f", borderRadius: 6, padding: "8px 12px" }}>
                <Text style={{ fontSize: 13 }}>{viewRecord.reason}</Text>
              </div>
            </div>
            {viewRecord.adminRemarks && (
              <div>
                <Text type="secondary" style={{ fontSize: 11, display: "block", marginBottom: 4 }}>Admin Remarks</Text>
                <div style={{ background: "#f6ffed", border: "1px solid #b7eb8f", borderRadius: 6, padding: "8px 12px" }}>
                  <Text style={{ fontSize: 13 }}>{viewRecord.adminRemarks}</Text>
                </div>
              </div>
            )}
            {viewRecord.letterOfIntentUrl && (
              <div>
                <Text type="secondary" style={{ fontSize: 11, display: "block", marginBottom: 4 }}>Letter of Intent</Text>
                <Button
                  icon={<FilePdfOutlined />}
                  href={viewRecord.letterOfIntentUrl}
                  target="_blank"
                  type="link"
                  style={{ padding: 0, fontSize: 13 }}
                >
                  {viewRecord.letterOfIntentFileName || "View Attached File"}
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
