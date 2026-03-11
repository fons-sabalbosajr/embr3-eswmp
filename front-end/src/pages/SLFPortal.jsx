import { useState, useEffect } from "react";
import {
  Form,
  Input,
  InputNumber,
  Button,
  Card,
  Typography,
  Result,
  Select,
  DatePicker,
  Divider,
  Row,
  Col,
  Space,
  Table,
  Spin,
  Empty,
} from "antd";
import {
  CheckCircleOutlined,
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  EnvironmentOutlined,
  FileTextOutlined,
  SendOutlined,
} from "@ant-design/icons";
import Swal from "sweetalert2";
import dayjs from "dayjs";
import api from "../api";
import "./SLFPortal.css";

const { Title, Text, Paragraph } = Typography;
const { Option } = Select;

const EMPTY_TRUCK = {
  disposalTicketNo: "",
  hauler: "",
  plateNumber: "",
  truckCapacity: null,
  truckCapacityUnit: "m3",
  actualVolume: null,
  actualVolumeUnit: "tons",
  wasteType: undefined,
};

export default function SLFPortal() {
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [generators, setGenerators] = useState([]);
  const [loadingGenerators, setLoadingGenerators] = useState(true);
  const [entryForm] = Form.useForm();
  // Truck state (managed manually — no nested form)
  const [trucks, setTrucks] = useState([]);
  const [truckDraft, setTruckDraft] = useState({ ...EMPTY_TRUCK });
  const [editingTruckKey, setEditingTruckKey] = useState(null);
  const [truckErrors, setTruckErrors] = useState({});

  useEffect(() => {
    fetchGenerators();
    const interval = setInterval(fetchGenerators, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchGenerators = async () => {
    try {
      const { data } = await api.get("/slf-generators");
      setGenerators(data);
    } catch {
      // silently fail
    } finally {
      setLoadingGenerators(false);
    }
  };

  // ── Truck helpers (no <Form>, just state) ──

  const updateTruckDraft = (field, value) => {
    setTruckDraft((prev) => ({ ...prev, [field]: value }));
    if (truckErrors[field]) {
      setTruckErrors((prev) => {
        const copy = { ...prev };
        delete copy[field];
        return copy;
      });
    }
  };

  const validateTruck = () => {
    const errs = {};
    if (!truckDraft.hauler?.trim()) errs.hauler = "Required";
    if (!truckDraft.plateNumber?.trim()) errs.plateNumber = "Required";
    if (!truckDraft.actualVolume && truckDraft.actualVolume !== 0)
      errs.actualVolume = "Required";
    if (!truckDraft.wasteType) errs.wasteType = "Required";
    setTruckErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleAddTruck = () => {
    if (!validateTruck()) return;
    if (editingTruckKey) {
      setTrucks((prev) =>
        prev.map((t) =>
          t.key === editingTruckKey ? { ...t, ...truckDraft } : t
        )
      );
      setEditingTruckKey(null);
    } else {
      setTrucks((prev) => [...prev, { key: Date.now(), ...truckDraft }]);
    }
    setTruckDraft({ ...EMPTY_TRUCK });
    setTruckErrors({});
  };

  const editTruck = (record) => {
    setEditingTruckKey(record.key);
    setTruckDraft({
      disposalTicketNo: record.disposalTicketNo || "",
      hauler: record.hauler || "",
      plateNumber: record.plateNumber || "",
      truckCapacity: record.truckCapacity,
      truckCapacityUnit: record.truckCapacityUnit || "m3",
      actualVolume: record.actualVolume,
      actualVolumeUnit: record.actualVolumeUnit || "tons",
      wasteType: record.wasteType,
    });
    setTruckErrors({});
  };

  const removeTruck = (key) => {
    setTrucks((prev) => prev.filter((t) => t.key !== key));
    if (editingTruckKey === key) {
      setEditingTruckKey(null);
      setTruckDraft({ ...EMPTY_TRUCK });
      setTruckErrors({});
    }
  };

  const cancelEditTruck = () => {
    setEditingTruckKey(null);
    setTruckDraft({ ...EMPTY_TRUCK });
    setTruckErrors({});
  };

  // ── Submit handler ──

  const handleSubmit = async (values) => {
    if (trucks.length === 0) {
      Swal.fire("Warning", "Please add at least one truck entry.", "warning");
      return;
    }

    const { value: email, isConfirmed } = await Swal.fire({
      title: "Enter Your Email",
      html: '<p style="color:#666;font-size:14px;margin:0 0 8px;">An acknowledgement email will be sent to this address.</p>',
      input: "email",
      inputPlaceholder: "your@email.com",
      showCancelButton: true,
      confirmButtonText: "Submit",
      confirmButtonColor: "#1a3353",
      inputValidator: (value) => {
        if (!value) return "Please enter your email address.";
      },
    });

    if (!isConfirmed) return;

    setLoading(true);
    try {
      const entry = {
        ...values,
        dateOfDisposal: values.dateOfDisposal
          ? values.dateOfDisposal.format("YYYY-MM-DD")
          : null,
        trucks: trucks.map(({ key, ...rest }) => rest),
      };

      await api.post("/data-slf", {
        entries: [entry],
        submittedBy: email,
      });
      Swal.fire({
        icon: "success",
        title: "Submitted Successfully!",
        html: "Your disposal data has been recorded.<br/>An acknowledgement email will be sent shortly.",
        confirmButtonColor: "#1a3353",
      });
      setSubmitted(true);
      setTrucks([]);
      setTruckDraft({ ...EMPTY_TRUCK });
      setEditingTruckKey(null);
      entryForm.resetFields();
    } catch (err) {
      Swal.fire({
        icon: "error",
        title: "Submission Failed",
        text: err.response?.data?.message || "Something went wrong.",
      });
    } finally {
      setLoading(false);
    }
  };

  // ── Truck table columns ──

  const truckColumns = [
    {
      title: "#",
      key: "index",
      width: 40,
      render: (_, __, i) => i + 1,
    },
    {
      title: "Ticket No.",
      dataIndex: "disposalTicketNo",
      key: "disposalTicketNo",
      render: (v) => v || "—",
    },
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
      title: "Actual Volume",
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
      render: (v) => v || "—",
    },
    {
      title: "Actions",
      key: "actions",
      width: 100,
      render: (_, t) => (
        <Space size="small">
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => editTruck(t)}
            style={{ color: "#1a3353" }}
          />
          <Button
            type="text"
            danger
            size="small"
            icon={<DeleteOutlined />}
            onClick={() => removeTruck(t.key)}
          />
        </Space>
      ),
    },
  ];

  // ── Render ──

  if (submitted) {
    return (
      <div className="slf-page">
        <Card className="slf-result-card">
          <Result
            status="success"
            icon={<CheckCircleOutlined style={{ color: "#1a3353" }} />}
            title="Submission Successful!"
            subTitle="Your SLF disposal data has been recorded. You will receive an acknowledgement email shortly."
            extra={
              <Button
                type="primary"
                size="large"
                onClick={() => setSubmitted(false)}
                className="slf-primary-btn"
              >
                Submit More Data
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  const fieldErr = (name) =>
    truckErrors[name]
      ? { validateStatus: "error", help: truckErrors[name] }
      : {};

  return (
    <div className="slf-page">
      {/* Header Banner */}
      <div className="slf-banner">
        <div className="slf-banner-content">
          <Title level={2} className="slf-banner-title">
            <EnvironmentOutlined style={{ marginRight: 12 }} />
            SLF Generators Portal
          </Title>
          <Paragraph className="slf-banner-sub">
            Ecological Solid Waste Management Pipeline (ESWMP) — Sanitary
            Landfill Monitoring System
          </Paragraph>
        </div>
      </div>

      <div className="slf-container">
        {/* Section 1: Select SLF */}
        <Card
          className="slf-section"
          title={
            <Space>
              <FileTextOutlined style={{ color: "#1a3353" }} />
              <Text strong style={{ fontSize: 16, color: "#1a3353" }}>
                Name of Sanitary Landfill Facility (SLF)
              </Text>
            </Space>
          }
        >
          <Form.Item
            label="Select Sanitary Landfill Facility"
            style={{ marginBottom: 0, maxWidth: 480 }}
          >
            <Select
              placeholder="Select SLF"
              loading={loadingGenerators}
              showSearch
              optionFilterProp="label"
              options={generators.filter((g) => g.isActive !== false).map((g) => ({
                label: g.slfName,
                value: g._id,
              }))}
              onChange={(val) => {
                const selected = generators.find((g) => g._id === val);
                if (selected) {
                  entryForm.setFieldsValue({ slfName: selected.slfName });
                }
              }}
              notFoundContent={
                loadingGenerators ? (
                  <Spin size="small" />
                ) : (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="No SLF facilities available"
                  />
                )
              }
            />
          </Form.Item>
        </Card>

        {/* Section 2: Disposal Data */}
        <Card
          className="slf-section"
          style={{ marginTop: 20 }}
          title={
            <Space>
              <FileTextOutlined style={{ color: "#1a3353" }} />
              <Text strong style={{ fontSize: 16, color: "#1a3353" }}>
                List of Generators — Disposal Data
              </Text>
            </Space>
          }
        >
          <Form
            form={entryForm}
            layout="vertical"
            onFinish={handleSubmit}
            requiredMark={false}
          >
            {/* Disposal Information */}
            <Divider titlePlacement="left" className="slf-category-divider">
              Disposal Information
            </Divider>
            <Form.Item name="slfName" hidden>
              <Input />
            </Form.Item>
            <Row gutter={[12, 0]}>
              <Col xs={24} sm={12} md={8}>
                <Form.Item
                  name="dateOfDisposal"
                  label="Date of Disposal"
                  rules={[{ required: true, message: "Required" }]}
                >
                  <DatePicker style={{ width: "100%" }} />
                </Form.Item>
              </Col>
            </Row>

            {/* Company Information */}
            <Divider titlePlacement="left" className="slf-category-divider">
              Company Information
            </Divider>
            <Row gutter={[12, 0]}>
              <Col xs={24} sm={14} md={12}>
                <Form.Item
                  name="lguCompanyName"
                  label="LGU/Company Name"
                  rules={[{ required: true, message: "Required" }]}
                >
                  <Input placeholder="e.g. Dela Cruz, Juan" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={10} md={6}>
                <Form.Item
                  name="companyType"
                  label="Company Type"
                  rules={[{ required: true, message: "Required" }]}
                >
                  <Select placeholder="Select type">
                    <Option value="LGU">LGU</Option>
                    <Option value="Private">Private</Option>
                  </Select>
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={[12, 0]}>
              <Col xs={24}>
                <Form.Item name="address" label="Address">
                  <Input placeholder="Complete address" />
                </Form.Item>
              </Col>
            </Row>

            {/* Transport Information & Volume */}
            <Divider titlePlacement="left" className="slf-category-divider">
              Transport Information &amp; Volume
            </Divider>

            {/* Truck sub-form (NO nested <Form>) */}
            <div className="slf-truck-box">
              <Row gutter={[12, 0]}>
                <Col xs={24} sm={12} md={5}>
                  <Form.Item
                    label="Disposal/Trip Ticket No."
                    {...fieldErr("disposalTicketNo")}
                  >
                    <Input
                      placeholder="Ticket number"
                      value={truckDraft.disposalTicketNo}
                      onChange={(e) =>
                        updateTruckDraft("disposalTicketNo", e.target.value)
                      }
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={4}>
                  <Form.Item label="Hauler" {...fieldErr("hauler")}>
                    <Input
                      placeholder="Hauler name"
                      value={truckDraft.hauler}
                      onChange={(e) =>
                        updateTruckDraft("hauler", e.target.value)
                      }
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={4}>
                  <Form.Item label="Plate Number" {...fieldErr("plateNumber")}>
                    <Input
                      placeholder="e.g. ABC-1234"
                      value={truckDraft.plateNumber}
                      onChange={(e) =>
                        updateTruckDraft("plateNumber", e.target.value)
                      }
                    />
                  </Form.Item>
                </Col>
                <Col xs={12} sm={8} md={3}>
                  <Form.Item label="Truck Capacity">
                    <InputNumber
                      placeholder="Cap."
                      style={{ width: "100%" }}
                      min={0}
                      step={0.1}
                      value={truckDraft.truckCapacity}
                      onChange={(v) => updateTruckDraft("truckCapacity", v)}
                    />
                  </Form.Item>
                </Col>
                <Col xs={12} sm={4} md={2}>
                  <Form.Item label="Unit">
                    <Select
                      value={truckDraft.truckCapacityUnit}
                      onChange={(v) => updateTruckDraft("truckCapacityUnit", v)}
                    >
                      <Option value="m3">m³</Option>
                      <Option value="tons">Tons</Option>
                    </Select>
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={[12, 0]} align="bottom">
                <Col xs={12} sm={8} md={3}>
                  <Form.Item
                    label="Actual Waste Vol."
                    {...fieldErr("actualVolume")}
                  >
                    <InputNumber
                      placeholder="Volume"
                      style={{ width: "100%" }}
                      min={0}
                      step={0.01}
                      value={truckDraft.actualVolume}
                      onChange={(v) => updateTruckDraft("actualVolume", v)}
                    />
                  </Form.Item>
                </Col>
                <Col xs={12} sm={4} md={2}>
                  <Form.Item label="Unit">
                    <Select
                      value={truckDraft.actualVolumeUnit}
                      onChange={(v) => updateTruckDraft("actualVolumeUnit", v)}
                    >
                      <Option value="tons">Tons</Option>
                      <Option value="m3">m³</Option>
                    </Select>
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={4}>
                  <Form.Item label="Waste Type" {...fieldErr("wasteType")}>
                    <Select
                      placeholder="Select"
                      value={truckDraft.wasteType}
                      onChange={(v) => updateTruckDraft("wasteType", v)}
                    >
                      <Option value="Residual">Residual</Option>
                      <Option value="Hazardous Waste">Hazardous Waste</Option>
                    </Select>
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12} md={5}>
                  <Form.Item>
                    <Space>
                      <Button
                        type="primary"
                        icon={
                          editingTruckKey ? (
                            <EditOutlined />
                          ) : (
                            <PlusOutlined />
                          )
                        }
                        className="slf-primary-btn"
                        onClick={handleAddTruck}
                      >
                        {editingTruckKey ? "Update" : "Add Entry"}
                      </Button>
                      {editingTruckKey && (
                        <Button onClick={cancelEditTruck}>Cancel</Button>
                      )}
                    </Space>
                  </Form.Item>
                </Col>
              </Row>

              {/* Truck table */}
              <Table
                dataSource={trucks}
                columns={truckColumns}
                rowKey="key"
                size="small"
                pagination={false}
                scroll={{ x: 800 }}
                locale={{
                  emptyText: (
                    <Text type="secondary" style={{ fontSize: 13 }}>
                      No entries added.
                    </Text>
                  ),
                }}
              />
            </div>

            {/* Submit button */}
            <Row style={{ marginTop: 12 }}>
              <Col xs={24}>
                <Form.Item>
                  <Button
                    type="primary"
                    htmlType="submit"
                    icon={<SendOutlined />}
                    block
                    size="large"
                    loading={loading}
                    className="slf-primary-btn"
                    style={{ height: 48 }}
                  >
                    Submit
                  </Button>
                </Form.Item>
              </Col>
            </Row>
          </Form>
        </Card>
      </div>

      {/* Footer */}
      <div className="slf-footer">
        <Text className="slf-footer-text">
          © 2026 EMBR3 — Ecological Solid Waste Management Pipeline. All
          rights reserved.
        </Text>
      </div>
    </div>
  );
}
