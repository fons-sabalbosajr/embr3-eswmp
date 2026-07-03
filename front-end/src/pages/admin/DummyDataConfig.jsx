import { useState, useEffect, useCallback } from "react";
import {
  Card,
  Tabs,
  Button,
  Space,
  Tag,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Typography,
  Alert,
  Popconfirm,
  Tooltip,
  Row,
  Col,
  Divider,
  DatePicker,
  Switch,
} from "antd";
import {
  UserOutlined,
  MailOutlined,
  PlusOutlined,
  ReloadOutlined,
  DeleteOutlined,
  EditOutlined,
  ExperimentOutlined,
  BankOutlined,
  EnvironmentOutlined,
  SafetyCertificateOutlined,
  ToolOutlined,
  DatabaseOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import Swal from "sweetalert2";
import api from "../../api";
import ResponsiveTable from "./shared/ResponsiveTable";
import DummyCellPlacementModal from "./DummyCellPlacementModal";

const { Text } = Typography;

// SLF facility fields that are stored as dates. DatePicker gives dayjs objects,
// so these are converted to/from ISO strings when loading and saving the form.
const SLF_DATE_FIELDS = [
  "dischargePermitValidity",
  "permitToOperateValidity",
];
const PERMIT_STATUS_OPTIONS = ["New", "Renewal"].map((v) => ({ label: v, value: v }));

const PROVINCES = [
  "Batangas","Cavite","Laguna","Quezon","Rizal",
  "Bataan","Bulacan","Nueva Ecija","Pampanga","Tarlac","Zambales","Aurora",
];
const SLF_STATUS_OPTIONS = [
  "Operational","Non-Operational","Under Construction","Closed/Full","Rehabilitation",
].map((v) => ({ label: v, value: v }));
const SLF_CATEGORY_OPTIONS = [
  "Category 1","Category 2","Category 3","Category 4",
].map((v) => ({ label: v, value: v }));
const OWNERSHIP_OPTIONS = ["Public","Private","Public-Private Partnership"].map((v) => ({ label: v, value: v }));
const UNIT_OPTIONS = [{ label: "m³", value: "m³" },{ label: "tons", value: "tons" }];

export default function DummyDataConfig({ isDark }) {
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [slf, setSlf] = useState([]);
  const [slfLoading, setSlfLoading] = useState(false);

  const [userModal, setUserModal] = useState({ open: false, record: null });
  const [userSaving, setUserSaving] = useState(false);
  const [userForm] = Form.useForm();

  const [slfModal, setSlfModal] = useState({ open: false });
  const [slfSaving, setSlfSaving] = useState(false);
  const [slfForm] = Form.useForm();

  const [assignModal, setAssignModal] = useState({ open: false, record: null });
  const [cellModal, setCellModal] = useState({ open: false, facility: null });
  const [assignFacilityId, setAssignFacilityId] = useState(undefined);
  const [assignSaving, setAssignSaving] = useState(false);

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const { data } = await api.get("/dummy-data/portal-users");
      setUsers(Array.isArray(data) ? data : []);
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Failed to load dummy users", "error");
    } finally {
      setUsersLoading(false);
    }
  }, []);

  const fetchSlf = useCallback(async () => {
    setSlfLoading(true);
    try {
      const { data } = await api.get("/dummy-data/slf-facilities");
      setSlf(Array.isArray(data) ? data : []);
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Failed to load dummy SLF data", "error");
    } finally {
      setSlfLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    fetchSlf();
  }, [fetchUsers, fetchSlf]);

  /* ── Dummy portal users ── */
  const openUserModal = (record = null) => {
    setUserModal({ open: true, record });
    if (record) {
      userForm.setFieldsValue({
        firstName: record.firstName,
        lastName: record.lastName,
        email: record.email,
        contactNumber: record.contactNumber,
        companyName: record.companyName,
        password: "",
      });
    } else {
      userForm.resetFields();
    }
  };

  const saveUser = async () => {
    try {
      const values = await userForm.validateFields();
      setUserSaving(true);
      if (userModal.record) {
        const payload = { ...values };
        if (!payload.password) delete payload.password;
        await api.put(`/dummy-data/portal-users/${userModal.record._id}`, payload);
      } else {
        await api.post("/dummy-data/portal-users", values);
      }
      setUserModal({ open: false, record: null });
      userForm.resetFields();
      fetchUsers();
      Swal.fire({
        icon: "success",
        title: userModal.record ? "Dummy user updated" : "Dummy user created",
        timer: 1600,
        showConfirmButton: false,
      });
    } catch (err) {
      if (err?.errorFields) return; // validation error
      Swal.fire("Error", err.response?.data?.message || "Could not save dummy user", "error");
    } finally {
      setUserSaving(false);
    }
  };

  const deleteUser = async (id) => {
    try {
      await api.delete(`/dummy-data/portal-users/${id}`);
      fetchUsers();
      Swal.fire({ icon: "success", title: "Deleted", timer: 1200, showConfirmButton: false });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Could not delete", "error");
    }
  };

  /* ── Assign dummy facility ── */
  const openAssignModal = (record) => {
    setAssignModal({ open: true, record });
    // Preselect the currently assigned dummy facility if it still exists.
    const currentId = Array.isArray(record.assignedSlf) && record.assignedSlf.length
      ? (typeof record.assignedSlf[0] === "object" ? record.assignedSlf[0]?._id : record.assignedSlf[0])
      : undefined;
    setAssignFacilityId(currentId);
  };

  const saveAssignment = async () => {
    if (!assignFacilityId) {
      Swal.fire({ icon: "warning", title: "Select a facility", text: "Please choose a dummy SLF facility to assign." });
      return;
    }
    setAssignSaving(true);
    try {
      await api.post(`/dummy-data/portal-users/${assignModal.record._id}/assign-facility`, {
        facilityId: assignFacilityId,
      });
      setAssignModal({ open: false, record: null });
      setAssignFacilityId(undefined);
      fetchUsers();
      Swal.fire({ icon: "success", title: "Facility Assigned", text: "The dummy account is now linked to the dummy facility.", timer: 1600, showConfirmButton: false });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Could not assign facility", "error");
    } finally {
      setAssignSaving(false);
    }
  };

  /* ── Dummy SLF data ── */
  const openSlfModal = (record = null) => {
    slfForm.resetFields();
    if (record) {
      const dateValues = {};
      SLF_DATE_FIELDS.forEach((f) => {
        dateValues[f] = record[f] ? dayjs(record[f]) : undefined;
      });
      slfForm.setFieldsValue({
        ...record,
        ...dateValues,
        dataYear: record.dataYear || new Date().getFullYear(),
        volumeCapacityUnit: record.volumeCapacityUnit || "m³",
        receivingVolumeCapacityUnit: record.receivingVolumeCapacityUnit || "m³",
        wasteReceivedUnit: record.wasteReceivedUnit || "m³",
        estimatedVolumeWasteUnit: record.estimatedVolumeWasteUnit || "m³",
      });
      setSlfModal({ open: true, record });
    } else {
      slfForm.setFieldsValue({ dataYear: new Date().getFullYear(), volumeCapacityUnit: "m³", receivingVolumeCapacityUnit: "m³" });
      setSlfModal({ open: true, record: null });
    }
  };

  const saveSlf = async () => {
    try {
      const values = await slfForm.validateFields();
      // Convert dayjs date fields to ISO strings so Mongoose can cast them.
      SLF_DATE_FIELDS.forEach((f) => {
        if (values[f] && dayjs.isDayjs(values[f])) {
          values[f] = values[f].toISOString();
        } else if (values[f] == null) {
          values[f] = null;
        }
      });
      setSlfSaving(true);
      if (slfModal.record) {
        await api.put(`/dummy-data/slf-facilities/${slfModal.record._id}`, values);
      } else {
        await api.post("/dummy-data/slf-facilities", values);
      }
      setSlfModal({ open: false, record: null });
      slfForm.resetFields();
      fetchSlf();
      Swal.fire({ icon: "success", title: slfModal.record ? "Dummy SLF updated" : "Dummy SLF created", timer: 1600, showConfirmButton: false });
    } catch (err) {
      if (err?.errorFields) return;
      Swal.fire("Error", err.response?.data?.message || "Could not create dummy SLF", "error");
    } finally {
      setSlfSaving(false);
    }
  };

  const deleteSlf = async (id) => {
    try {
      await api.delete(`/dummy-data/slf-facilities/${id}`);
      fetchSlf();
      Swal.fire({ icon: "success", title: "Deleted", timer: 1200, showConfirmButton: false });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Could not delete", "error");
    }
  };

  const userColumns = [
    {
      title: "Name",
      key: "name",
      render: (_, r) => (
        <Space>
          <UserOutlined />
          <Text strong>{`${r.firstName || ""} ${r.lastName || ""}`.trim() || "—"}</Text>
          <Tag color="purple">DUMMY</Tag>
        </Space>
      ),
    },
    { title: "Email", dataIndex: "email", key: "email", ellipsis: true },
    { title: "Company", dataIndex: "companyName", key: "companyName", render: (v) => v || "—" },
    {
      title: "Assigned Dummy Facility",
      key: "assignedFacility",
      width: 240,
      render: (_, r) => {
        const names = Array.isArray(r.assignedSlfName) ? r.assignedSlfName.filter(Boolean) : [];
        if (names.length === 0) return <Tag color="default">Not assigned</Tag>;
        const full = names.join(", ");
        return (
          <Tooltip title={full}>
            <Tag
              color="geekblue"
              style={{
                maxWidth: 220,
                whiteSpace: "normal",
                wordBreak: "break-word",
                display: "inline-block",
                lineHeight: 1.3,
              }}
            >
              {full}
            </Tag>
          </Tooltip>
        );
      },
    },
    {
      title: "Actions",
      key: "actions",
      width: 190,
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title="Assign / reassign dummy facility">
            <Button size="small" icon={<BankOutlined />} onClick={() => openAssignModal(r)} />
          </Tooltip>
          <Tooltip title="Edit">
            <Button size="small" icon={<EditOutlined />} onClick={() => openUserModal(r)} />
          </Tooltip>
          <Popconfirm title="Delete this dummy user?" onConfirm={() => deleteUser(r._id)} okText="Delete" okButtonProps={{ danger: true }}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const slfColumns = [
    {
      title: "LGU / Facility",
      key: "lgu",
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <Text strong>{r.lgu || "—"}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>{r.province || "—"}</Text>
        </Space>
      ),
    },
    { title: "Category", dataIndex: "category", key: "category", render: (v) => (v ? <Tag>{v}</Tag> : "—") },
    {
      title: "Status",
      dataIndex: "statusOfSLF",
      key: "statusOfSLF",
      render: (v) => v ? (
        <Tag color={/operational/i.test(v) && !/non/i.test(v) ? "green" : /non/i.test(v) ? "red" : "default"}>{v}</Tag>
      ) : "—",
    },
    { title: "Ownership", dataIndex: "ownership", key: "ownership", render: (v) => v || "—" },
    { title: "Year", dataIndex: "dataYear", key: "dataYear", width: 80, render: (v) => <Tag color="blue">{v || "—"}</Tag> },
    {
      title: "Actions",
      key: "actions",
      width: 170,
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title="View cell placement / fills">
            <Button
              size="small"
              icon={<DatabaseOutlined />}
              onClick={() => setCellModal({ open: true, facility: r })}
            />
          </Tooltip>
          <Tooltip title="Edit dummy facility">
            <Button size="small" icon={<EditOutlined />} onClick={() => openSlfModal(r)} />
          </Tooltip>
          <Popconfirm title="Delete this dummy SLF?" onConfirm={() => deleteSlf(r._id)} okText="Delete" okButtonProps={{ danger: true }}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12, borderRadius: 8 }}
        message="Dummy / Test Data"
        description="Records created here are flagged with isDummy and kept separate from real Portal Users and the real SLF Data Table. They are safe to create, edit, and delete for demos and testing."
      />
      <Tabs
        size="small"
        items={[
          {
            key: "users",
            label: (
              <span>
                <UserOutlined /> Dummy Portal Users
              </span>
            ),
            children: (
              <Card
                style={{ borderRadius: 10 }}
                title={
                  <Space>
                    <ExperimentOutlined style={{ color: "#722ed1" }} />
                    <span>Dummy Portal Users</span>
                    <Tag>{users.length}</Tag>
                  </Space>
                }
                extra={
                  <Space>
                    <Button size="small" icon={<ReloadOutlined />} onClick={fetchUsers} loading={usersLoading}>
                      Refresh
                    </Button>
                    <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => openUserModal(null)}>
                      New Dummy User
                    </Button>
                  </Space>
                }
              >
                <ResponsiveTable
                  dataSource={users}
                  columns={userColumns}
                  rowKey="_id"
                  size="small"
                  loading={usersLoading}
                  pagination={{ pageSize: 10, size: "small" }}
                  scroll={{ x: 700 }}
                />
              </Card>
            ),
          },
          {
            key: "slf",
            label: (
              <span>
                <BankOutlined /> Dummy SLF Data
              </span>
            ),
            children: (
              <Card
                style={{ borderRadius: 10 }}
                title={
                  <Space>
                    <BankOutlined style={{ color: "#722ed1" }} />
                    <span>Dummy SLF Facilities</span>
                    <Tag>{slf.length}</Tag>
                  </Space>
                }
                extra={
                  <Space>
                    <Button size="small" icon={<ReloadOutlined />} onClick={fetchSlf} loading={slfLoading}>
                      Refresh
                    </Button>
                    <Button size="small" type="primary" icon={<PlusOutlined />} onClick={openSlfModal}>
                      New Dummy SLF
                    </Button>
                  </Space>
                }
              >
                <ResponsiveTable
                  dataSource={slf}
                  columns={slfColumns}
                  rowKey="_id"
                  size="small"
                  loading={slfLoading}
                  pagination={{ pageSize: 10, size: "small" }}
                  scroll={{ x: 800 }}
                />
              </Card>
            ),
          },
        ]}
      />

      {/* Dummy user modal */}
      <Modal
        title={userModal.record ? "Edit Dummy Portal User" : "New Dummy Portal User"}
        open={userModal.open}
        onCancel={() => setUserModal({ open: false, record: null })}
        onOk={saveUser}
        confirmLoading={userSaving}
        okText={userModal.record ? "Save Changes" : "Create"}
        destroyOnHidden
      >
        <Form form={userForm} layout="vertical">
          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item name="firstName" label="First Name" rules={[{ required: true }]}>
                <Input prefix={<UserOutlined />} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="lastName" label="Last Name" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="email"
            label="Email"
            rules={[
              { required: true, message: "Email is required" },
              { type: "email", message: "Enter a valid email" },
            ]}
          >
            <Input prefix={<MailOutlined />} disabled={!!userModal.record} />
          </Form.Item>
          <Form.Item
            name="password"
            label={userModal.record ? "New Password (leave blank to keep)" : "Password"}
            rules={userModal.record ? [] : [{ required: true, min: 6, message: "Min 6 characters" }]}
          >
            <Input.Password placeholder="••••••" />
          </Form.Item>
          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item name="contactNumber" label="Contact Number">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="companyName" label="Company Name">
                <Input />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* Assign dummy facility modal */}
      <Modal
        title={
          <Space>
            <BankOutlined style={{ color: "#722ed1" }} />
            <span>Assign Dummy SLF Facility</span>
          </Space>
        }
        open={assignModal.open}
        onCancel={() => setAssignModal({ open: false, record: null })}
        onOk={saveAssignment}
        confirmLoading={assignSaving}
        okText="Assign Facility"
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12, borderRadius: 8 }}
          message="Dummy accounts can only be linked to dummy SLF facilities."
          description="After assigning, the dummy account will load this facility on Portal login and can submit test data against its cells."
        />
        {assignModal.record && (
          <Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
            Account: <Text strong>{`${assignModal.record.firstName || ""} ${assignModal.record.lastName || ""}`.trim()}</Text> ({assignModal.record.email})
          </Text>
        )}
        <Select
          showSearch
          allowClear
          style={{ width: "100%" }}
          placeholder="Select a dummy SLF facility"
          value={assignFacilityId}
          onChange={setAssignFacilityId}
          optionFilterProp="label"
          notFoundContent={slf.length === 0 ? "No dummy facilities yet — create one first." : "No match"}
          options={slf.map((f) => ({
            label: `${f.lgu || f.province || "Dummy SLF"}${f.ownership ? ` (${f.ownership})` : ""}`,
            value: f._id,
          }))}
        />
      </Modal>

      {/* Dummy SLF modal — matches the real SLF Data Table edit form structure */}
      <Modal
        title={
          <Space>
            <BankOutlined style={{ color: "#722ed1" }} />
            <span>{slfModal.record ? "Edit Dummy SLF Facility" : "New Dummy SLF Facility"}</span>
            <Tag color="purple">DUMMY</Tag>
          </Space>
        }
        open={slfModal.open}
        onCancel={() => setSlfModal({ open: false, record: null })}
        onOk={saveSlf}
        confirmLoading={slfSaving}
        okText={slfModal.record ? "Save Changes" : "Create Dummy SLF"}
        width={820}
        destroyOnHidden
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12, borderRadius: 8 }}
          message="This record is for demo/testing only and will not appear in the real SLF Data Table."
        />
        <Form form={slfForm} layout="vertical">
          <Tabs
            size="small"
            items={[
              {
                key: "location",
                label: (
                  <span>
                    <EnvironmentOutlined /> Location
                  </span>
                ),
                children: (
                  <Row gutter={[12, 0]}>
                    <Col xs={24} md={12}>
                      <Form.Item
                        name="province"
                        label="Province"
                        rules={[{ required: true, message: "Province is required" }]}
                      >
                        <Select
                          showSearch
                          placeholder="Select Province"
                          options={PROVINCES.map((p) => ({ label: p, value: p }))}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="barangay" label="Barangay">
                        <Input placeholder="Enter barangay name" />
                      </Form.Item>
                    </Col>
                    <Col xs={24}>
                      <Form.Item
                        name="lgu"
                        label="LGU Name"
                        rules={[{ required: true, message: "LGU name is required" }]}
                      >
                        <Input.TextArea
                          rows={2}
                          placeholder="Enter full LGU name"
                          autoSize={{ minRows: 2, maxRows: 3 }}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="ownership" label="Ownership">
                        <Select allowClear placeholder="Select Ownership" options={OWNERSHIP_OPTIONS} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="latitude" label="Latitude">
                        <InputNumber style={{ width: "100%" }} step={0.001} precision={6} placeholder="e.g. 14.0827" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="longitude" label="Longitude">
                        <InputNumber style={{ width: "100%" }} step={0.001} precision={6} placeholder="e.g. 121.1475" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="manilaBayArea" label="Manila Bay Area">
                        <Input placeholder="e.g. Within / Outside Manila Bay Area" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="congressionalDistrict" label="Congressional District">
                        <Input placeholder="e.g. 1st District" />
                      </Form.Item>
                    </Col>
                  </Row>
                ),
              },
              {
                key: "facility",
                label: (
                  <span>
                    <BankOutlined /> Facility Details
                  </span>
                ),
                children: (
                  <Row gutter={[12, 0]}>
                    <Col xs={24} md={8}>
                      <Form.Item name="category" label="SLF Category">
                        <Select allowClear showSearch placeholder="Select Category" options={SLF_CATEGORY_OPTIONS} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="statusOfSLF" label="Status">
                        <Select allowClear placeholder="Select Status" options={SLF_STATUS_OPTIONS} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="yearStartedOperation" label="Year Started">
                        <InputNumber style={{ width: "100%" }} placeholder={String(new Date().getFullYear())} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item label="Total Volume Capacity">
                        <Space.Compact style={{ width: "100%" }}>
                          <Form.Item name="volumeCapacity" noStyle>
                            <InputNumber style={{ width: "calc(100% - 80px)" }} min={0} placeholder="e.g. 50000" />
                          </Form.Item>
                          <Form.Item name="volumeCapacityUnit" noStyle>
                            <Select style={{ width: 80 }} options={UNIT_OPTIONS} defaultValue="m³" />
                          </Form.Item>
                        </Space.Compact>
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item label="Receiving Capacity / Day">
                        <Space.Compact style={{ width: "100%" }}>
                          <Form.Item name="receivingVolumeCapacity" noStyle>
                            <InputNumber style={{ width: "calc(100% - 80px)" }} min={0} placeholder="e.g. 200" />
                          </Form.Item>
                          <Form.Item name="receivingVolumeCapacityUnit" noStyle>
                            <Select style={{ width: 80 }} options={UNIT_OPTIONS} defaultValue="m³" />
                          </Form.Item>
                        </Space.Compact>
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="noOfLGUServed" label="No. of LGUs Served">
                        <InputNumber style={{ width: "100%" }} min={0} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="numberOfCell" label="No. of Cells">
                        <InputNumber style={{ width: "100%" }} min={0} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="dataYear" label="Data Year">
                        <InputNumber style={{ width: "100%" }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24}>
                      <Divider orientation="left" style={{ fontSize: 12, margin: "4px 0 8px" }}>LGUs Served</Divider>
                      <Form.Item name="lguServedList">
                        <Select
                          mode="tags"
                          placeholder="Type & press Enter to add LGUs"
                          style={{ width: "100%" }}
                          tokenSeparators={[","]}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="numberOfGasVents" label="No. of Gas Vents">
                        <InputNumber style={{ width: "100%" }} min={0} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="noOfLeachatePond" label="No. of Leachate Ponds">
                        <InputNumber style={{ width: "100%" }} min={0} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="hasMRF" label="Has MRF" valuePropName="checked">
                        <Switch checkedChildren="Yes" unCheckedChildren="No" />
                      </Form.Item>
                    </Col>
                    <Col xs={24}>
                      <Divider orientation="left" style={{ fontSize: 12, margin: "4px 0 8px" }}>Personnel</Divider>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="enmo" label="ENMO Name">
                        <Input placeholder="Environmental Officer" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="eswmStaff" label="ESWM Staff">
                        <Input placeholder="ESWM Staff" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="focalPerson" label="Focal Person">
                        <Input placeholder="Focal Person" />
                      </Form.Item>
                    </Col>
                  </Row>
                ),
              },
              {
                key: "permits",
                label: (
                  <span>
                    <SafetyCertificateOutlined /> Permits
                  </span>
                ),
                children: (
                  <Row gutter={[12, 0]}>
                    <Col xs={24} md={12}>
                      <Form.Item name="eccNo" label="ECC No.">
                        <Input placeholder="Environmental Compliance Certificate No." />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="hazwasteGenerationId" label="Hazwaste Generation ID">
                        <Input placeholder="Hazardous Waste Generation ID" />
                      </Form.Item>
                    </Col>
                    <Col xs={24}>
                      <Divider orientation="left" style={{ fontSize: 12, margin: "4px 0 8px" }}>Discharge Permit</Divider>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="dischargePermit" label="Permit No.">
                        <Input placeholder="Discharge permit no." />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="dischargePermitValidity" label="Validity">
                        <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="dischargePermitStatus" label="Status">
                        <Select allowClear placeholder="Status" options={PERMIT_STATUS_OPTIONS} />
                      </Form.Item>
                    </Col>
                    <Col xs={24}>
                      <Divider orientation="left" style={{ fontSize: 12, margin: "4px 0 8px" }}>Permit to Operate</Divider>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="permitToOperate" label="Permit No.">
                        <Input placeholder="Permit to operate no." />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="permitToOperateValidity" label="Validity">
                        <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="permitToOperateStatus" label="Status">
                        <Select allowClear placeholder="Status" options={PERMIT_STATUS_OPTIONS} />
                      </Form.Item>
                    </Col>
                  </Row>
                ),
              },
              {
                key: "operations",
                label: (
                  <span>
                    <ToolOutlined /> Operations
                  </span>
                ),
                children: (
                  <Row gutter={[12, 0]}>
                    <Col xs={24} md={12}>
                      <Form.Item name="remainingLifeSpan" label="Remaining Life Span">
                        <Input placeholder="e.g. 5 years" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item label="Actual Residual Waste Received">
                        <Space.Compact style={{ width: "100%" }}>
                          <Form.Item name="actualResidualWasteReceived" noStyle>
                            <InputNumber style={{ width: "calc(100% - 80px)" }} min={0} placeholder="e.g. 1200" />
                          </Form.Item>
                          <Form.Item name="wasteReceivedUnit" noStyle>
                            <Select style={{ width: 80 }} options={UNIT_OPTIONS} defaultValue="m³" />
                          </Form.Item>
                        </Space.Compact>
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item label="Estimated Volume of Waste">
                        <Space.Compact style={{ width: "100%" }}>
                          <Form.Item name="estimatedVolumeWaste" noStyle>
                            <InputNumber style={{ width: "calc(100% - 80px)" }} min={0} placeholder="e.g. 8000" />
                          </Form.Item>
                          <Form.Item name="estimatedVolumeWasteUnit" noStyle>
                            <Select style={{ width: 80 }} options={UNIT_OPTIONS} defaultValue="m³" />
                          </Form.Item>
                        </Space.Compact>
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="trackingOfReports" label="Tracking of Reports">
                        <Input placeholder="e.g. On-time / Delayed" />
                      </Form.Item>
                    </Col>
                    <Col xs={24}>
                      <Form.Item name="remarksAndRecommendation" label="Remarks & Recommendation">
                        <Input.TextArea rows={2} autoSize={{ minRows: 2, maxRows: 4 }} placeholder="Remarks / recommendations for this dummy facility" />
                      </Form.Item>
                    </Col>
                  </Row>
                ),
              },
            ]}
          />
        </Form>
      </Modal>

      <DummyCellPlacementModal
        open={cellModal.open}
        facility={cellModal.facility}
        onClose={() => setCellModal({ open: false, facility: null })}
      />
    </div>
  );
}
