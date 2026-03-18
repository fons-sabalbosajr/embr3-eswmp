import { useState, useEffect } from "react";
import {
  Table,
  Button,
  Tag,
  Space,
  Typography,
  Card,
  Select,
  Input,
  Modal,
  Descriptions,
  Popconfirm,
  Divider,
} from "antd";
import {
  CheckOutlined,
  CloseOutlined,
  EyeOutlined,
  DeleteOutlined,
  SearchOutlined,
  DownloadOutlined,
} from "@ant-design/icons";
import { exportToExcel } from "../../utils/exportExcel";
import Swal from "sweetalert2";
import api from "../../api";
import secureStorage from "../../utils/secureStorage";
import dayjs from "dayjs";

const { Title, Text } = Typography;
const { Option } = Select;
const CACHE_KEY = "submissions-cache";
const CACHE_TTL = 5 * 60 * 1000;

export default function SubmissionSettings() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [viewRecord, setViewRecord] = useState(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 8000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = async (skipCache = false) => {
    try {
      if (!skipCache) {
        const cached = secureStorage.getJSON(CACHE_KEY);
        if (cached && Date.now() - cached.ts < CACHE_TTL) {
          setData(cached.data);
          setLoading(false);
          return;
        }
      }
      const { data: result } = await api.get("/data-slf");
      setData(result);
      secureStorage.setJSON(CACHE_KEY, { data: result, ts: Date.now() });
    } catch {
      Swal.fire("Error", "Could not load submissions", "error");
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (id, status) => {
    try {
      const { data: updated } = await api.patch(`/data-slf/${id}/status`, {
        status,
      });
      setData((prev) => prev.map((d) => (d._id === id ? updated : d)));
      secureStorage.remove(CACHE_KEY);
      Swal.fire({
        icon: "success",
        title: `Submission ${status}`,
        timer: 1000,
        showConfirmButton: false,
      });
    } catch {
      Swal.fire("Error", "Could not update status", "error");
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/data-slf/${id}`);
      setData((prev) => prev.filter((d) => d._id !== id));
      secureStorage.remove(CACHE_KEY);
      Swal.fire({
        icon: "success",
        title: "Deleted",
        timer: 800,
        showConfirmButton: false,
      });
    } catch {
      Swal.fire("Error", "Could not delete submission", "error");
    }
  };

  const handleBulkAcknowledge = async () => {
    const pendingIds = selectedRowKeys.filter((id) => {
      const entry = data.find((d) => d._id === id);
      return entry?.status === "pending";
    });
    if (pendingIds.length === 0) {
      Swal.fire("Info", "No pending entries selected.", "info");
      return;
    }
    const confirmed = await Swal.fire({
      title: `Acknowledge ${pendingIds.length} entry(ies)?`,
      text: "This will send an acknowledgement email to the submitters.",
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Acknowledge All",
      confirmButtonColor: "#52c41a",
    });
    if (!confirmed.isConfirmed) return;
    try {
      const { data: result } = await api.patch("/data-slf/bulk-status", {
        ids: pendingIds,
        status: "acknowledged",
      });
      setData((prev) =>
        prev.map((d) => {
          const updated = result.data.find((u) => u._id === d._id);
          return updated || d;
        })
      );
      secureStorage.remove(CACHE_KEY);
      setSelectedRowKeys([]);
      Swal.fire({
        icon: "success",
        title: `${result.data.length} entries acknowledged`,
        timer: 1500,
        showConfirmButton: false,
      });
    } catch {
      Swal.fire("Error", "Could not acknowledge entries", "error");
    }
  };

  const filtered = data.filter((d) => {
    const matchSearch =
      d.idNo?.toLowerCase().includes(search.toLowerCase()) ||
      d.lguCompanyName?.toLowerCase().includes(search.toLowerCase()) ||
      d.submittedBy?.toLowerCase().includes(search.toLowerCase());
    const matchStatus =
      statusFilter === "all" || d.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const statusColors = {
    pending: "orange",
    acknowledged: "green",
    rejected: "red",
  };

  const columns = [
    {
      title: "ID No.",
      dataIndex: "idNo",
      key: "idNo",
      render: (text) => <Text strong>{text}</Text>,
    },
    {
      title: "LGU/Company",
      dataIndex: "lguCompanyName",
      key: "lguCompanyName",
    },
    {
      title: "Date of Disposal",
      dataIndex: "dateOfDisposal",
      key: "dateOfDisposal",
      render: (val) => (val ? dayjs(val).format("MMM DD, YYYY") : "—"),
    },
    {
      title: "Trucks",
      key: "trucks",
      width: 70,
      render: (_, r) => r.trucks?.length || 0,
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      render: (val) => (
        <Tag color={statusColors[val] || "default"}>
          {val?.charAt(0).toUpperCase() + val?.slice(1)}
        </Tag>
      ),
    },
    {
      title: "Actions",
      key: "actions",
      render: (_, r) => (
        <Space>
          <Button
            type="text"
            icon={<EyeOutlined />}
            onClick={() => setViewRecord(r)}
            size="small"
          />
          {r.status === "pending" && (
            <>
              <Button
                type="text"
                icon={<CheckOutlined />}
                style={{ color: "#52c41a" }}
                onClick={() => updateStatus(r._id, "acknowledged")}
                size="small"
              />
              <Button
                type="text"
                icon={<CloseOutlined />}
                style={{ color: "#ff4d4f" }}
                onClick={() => updateStatus(r._id, "rejected")}
                size="small"
              />
            </>
          )}
          <Popconfirm
            title="Delete this submission?"
            onConfirm={() => handleDelete(r._id)}
          >
            <Button type="text" danger icon={<DeleteOutlined />} size="small" />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 4 }}>
        Submission Management
      </Title>
      <Text type="secondary">
        View, acknowledge, or reject client portal submissions
      </Text>

      <Card style={{ marginTop: 16, borderRadius: 10 }}>
        <Space style={{ marginBottom: 16, flexWrap: "wrap" }}>
          <Button
            icon={<DownloadOutlined />}
            onClick={() => {
              const rows = filtered.map((d) => ({
                "ID No.": d.idNo,
                "LGU/Company": d.lguCompanyName,
                "Company Type": d.companyType,
                "Date of Disposal": d.dateOfDisposal ? dayjs(d.dateOfDisposal).format("YYYY-MM-DD") : "",
                Status: d.status,
                Trucks: d.trucks?.length || 0,
                "Submitted By": d.submittedBy || "",
                "Submitted At": d.createdAt ? dayjs(d.createdAt).format("YYYY-MM-DD HH:mm") : "",
              }));
              exportToExcel(rows, "Submissions");
            }}
          >
            Export Excel
          </Button>
          <Input
            placeholder="Search by ID, company, or email..."
            prefix={<SearchOutlined />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%", maxWidth: 300 }}
            allowClear
          />
          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            style={{ width: "100%", maxWidth: 160 }}
          >
            <Option value="all">All Statuses</Option>
            <Option value="pending">Pending</Option>
            <Option value="acknowledged">Acknowledged</Option>
            <Option value="rejected">Rejected</Option>
          </Select>
          {selectedRowKeys.length > 0 && (
            <Button
              type="primary"
              icon={<CheckOutlined />}
              style={{ background: "#52c41a", borderColor: "#52c41a" }}
              onClick={handleBulkAcknowledge}
            >
              Acknowledge Selected ({selectedRowKeys.length})
            </Button>
          )}
        </Space>

        <Table
          dataSource={filtered}
          columns={columns}
          rowKey="_id"
          loading={loading}
          pagination={{ pageSize: 15 }}
          size="middle"
          scroll={{ x: 900 }}
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
          }}
        />
      </Card>

      <Modal
        title={`Submission — ${viewRecord?.idNo || ""}`}
        open={!!viewRecord}
        onCancel={() => setViewRecord(null)}
        footer={
          viewRecord?.status === "pending" ? (
            <Space>
              <Button
                type="primary"
                icon={<CheckOutlined />}
                style={{ background: "#52c41a", borderColor: "#52c41a" }}
                onClick={() => {
                  updateStatus(viewRecord._id, "acknowledged");
                  setViewRecord(null);
                }}
              >
                Acknowledge
              </Button>
              <Button
                danger
                icon={<CloseOutlined />}
                onClick={() => {
                  updateStatus(viewRecord._id, "rejected");
                  setViewRecord(null);
                }}
              >
                Reject
              </Button>
            </Space>
          ) : null
        }
        width={640}
        style={{ maxWidth: "95vw" }}
      >
        {viewRecord && (
          <>
            <Descriptions column={{ xs: 1, sm: 2 }} bordered size="small">
              <Descriptions.Item label="ID No.">{viewRecord.idNo}</Descriptions.Item>
              <Descriptions.Item label="Status">
                <Tag color={statusColors[viewRecord.status]}>
                  {viewRecord.status?.charAt(0).toUpperCase() + viewRecord.status?.slice(1)}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Date of Disposal">
                {viewRecord.dateOfDisposal
                  ? dayjs(viewRecord.dateOfDisposal).format("MMM DD, YYYY")
                  : "—"}
              </Descriptions.Item>
              <Descriptions.Item label="LGU/Company">
                {viewRecord.lguCompanyName}
              </Descriptions.Item>
              <Descriptions.Item label="Company Type">
                {viewRecord.companyType}
              </Descriptions.Item>
              <Descriptions.Item label="Address">
                {viewRecord.address || "—"}
              </Descriptions.Item>
              <Descriptions.Item label="Submitted By" span={2}>
                {viewRecord.submittedBy || "—"}
              </Descriptions.Item>
              {viewRecord.submissionId && (
                <Descriptions.Item label="Submission ID" span={2}>
                  {viewRecord.submissionId}
                </Descriptions.Item>
              )}
            </Descriptions>

            {viewRecord.trucks?.length > 0 && (
              <>
                <Divider titlePlacement="left" style={{ fontSize: 13, fontWeight: 600 }}>
                  Trucks ({viewRecord.trucks.length})
                </Divider>
                <Table
                  dataSource={viewRecord.trucks}
                  rowKey={(_, i) => i}
                  size="small"
                  pagination={false}
                  columns={[
                    { title: "Ticket No.", dataIndex: "disposalTicketNo", key: "disposalTicketNo", render: (v) => v || "—" },
                    { title: "Hauler", dataIndex: "hauler", key: "hauler" },
                    { title: "Plate No.", dataIndex: "plateNumber", key: "plateNumber" },
                    {
                      title: "Capacity",
                      key: "cap",
                      render: (_, t) =>
                        t.truckCapacity
                          ? `${t.truckCapacity} ${t.truckCapacityUnit || "m3"}`
                          : "—",
                    },
                    {
                      title: "Volume",
                      key: "vol",
                      render: (_, t) =>
                        t.actualVolume != null
                          ? `${t.actualVolume} ${t.actualVolumeUnit || "tons"}`
                          : "—",
                    },
                    {
                      title: "Waste Type",
                      dataIndex: "wasteType",
                      key: "wasteType",
                      render: (v) => v ? <Tag color={v === "Residual" ? "blue" : "volcano"}>{v}</Tag> : "—",
                    },
                  ]}
                />
              </>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
