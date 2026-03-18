import { useState, useEffect } from "react";
import {
  Layout,
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
  Menu,
  Avatar,
  Dropdown,
  Tag,
  Grid,
  Drawer,
  Tabs,
} from "antd";
import {
  CheckCircleOutlined,
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  SendOutlined,
  FileTextOutlined,
  HistoryOutlined,
  LogoutOutlined,
  MenuOutlined,
  DatabaseOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import Swal from "sweetalert2";
import dayjs from "dayjs";
import api from "../api";
import secureStorage from "../utils/secureStorage";
import embLogo from "../assets/emblogo.svg";
import "./SLFPortal.css";

const { Text } = Typography;
const { Option } = Select;
const { Header, Sider, Content } = Layout;
const { useBreakpoint } = Grid;

const EMPTY_TRUCK = {
  disposalTicketNo: "",
  hauler: "",
  plateNumber: "",
  truckCapacity: null,
  truckCapacityUnit: "m³",
  actualVolume: null,
  actualVolumeUnit: "tons",
  wasteType: undefined,
};

export default function SLFPortal() {
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const [portalUser, setPortalUser] = useState(null);
  const [activeMenu, setActiveMenu] = useState("data-entry");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingUser, setLoadingUser] = useState(true);
  const [entryForm] = Form.useForm();
  const [trucks, setTrucks] = useState([]);
  const [truckDraft, setTruckDraft] = useState({ ...EMPTY_TRUCK });
  const [editingTruckKey, setEditingTruckKey] = useState(null);
  const [truckErrors, setTruckErrors] = useState({});
  const [submissions, setSubmissions] = useState([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileDrawer, setMobileDrawer] = useState(false);
  const [activeTab, setActiveTab] = useState("baseline");
  const [baselineForm] = Form.useForm();
  const [haulers, setHaulers] = useState([]);
  const [haulerDraft, setHaulerDraft] = useState({ haulerName: "", numberOfTrucks: null, privateSectorClients: "" });
  const [editingHaulerKey, setEditingHaulerKey] = useState(null);
  const [haulerErrors, setHaulerErrors] = useState({});
  const [baselineSaved, setBaselineSaved] = useState(false);
  const [fieldLabels, setFieldLabels] = useState({});

  const isMobile = !screens.md;

  // Fetch portal field settings (labels, required, active) for real-time updates
  useEffect(() => {
    api
      .get("/settings/fields")
      .then(({ data }) => {
        const map = {};
        data.forEach((f) => {
          map[f.fieldKey] = { label: f.fieldName, required: f.required, options: f.options || [] };
        });
        setFieldLabels(map);
      })
      .catch(() => {});
  }, []);

  // Helper to get field label from settings, fallback to default
  const fl = (key, fallback) => fieldLabels[key]?.label || fallback;

  // Load portal user from storage
  useEffect(() => {
    const token = secureStorage.get("portal_token");
    const user = secureStorage.getJSON("portal_user");
    if (!token || !user) {
      navigate("/slfportal/login");
      return;
    }
    setPortalUser(user);
    setLoadingUser(false);
  }, [navigate]);

  // Fetch existing baseline when user is loaded
  useEffect(() => {
    if (!portalUser?.assignedSlfName) return;
    api
      .get(`/data-slf/baseline/${encodeURIComponent(portalUser.assignedSlfName)}`)
      .then(({ data }) => {
        if (data && data.totalVolumeAccepted != null) {
          baselineForm.setFieldsValue({
            totalVolumeAccepted: data.totalVolumeAccepted,
            totalVolumeAcceptedUnit: data.totalVolumeAcceptedUnit || "m³",
            activeCellResidualVolume: data.activeCellResidualVolume,
            activeCellResidualUnit: data.activeCellResidualUnit || "m³",
            activeCellInertVolume: data.activeCellInertVolume,
            activeCellInertUnit: data.activeCellInertUnit || "m³",
            closedCellResidualVolume: data.closedCellResidualVolume,
            closedCellResidualUnit: data.closedCellResidualUnit || "m³",
            closedCellInertVolume: data.closedCellInertVolume,
            closedCellInertUnit: data.closedCellInertUnit || "m³",
          });
          if (data.accreditedHaulers?.length > 0) {
            setHaulers(
              data.accreditedHaulers.map((h, i) => ({ key: Date.now() + i, ...h })),
            );
          }
          setBaselineSaved(true);
          setActiveTab("disposal");
        }
      })
      .catch(() => {});
  }, [portalUser]);

  // Fetch submission history
  useEffect(() => {
    if (activeMenu === "history" && portalUser) {
      fetchSubmissions();
    }
  }, [activeMenu, portalUser]);

  const fetchSubmissions = async () => {
    setLoadingSubmissions(true);
    try {
      const { data } = await api.get("/portal-auth/my-submissions", {
        headers: {
          Authorization: `Bearer ${secureStorage.get("portal_token")}`,
        },
      });
      setSubmissions(data);
    } catch {
      // silent
    } finally {
      setLoadingSubmissions(false);
    }
  };

  const handleLogout = () => {
    secureStorage.remove("portal_token");
    secureStorage.remove("portal_user");
    navigate("/slfportal/login");
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
      truckCapacityUnit: record.truckCapacityUnit || "m³",
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

  // ── Hauler helpers ──

  const updateHaulerDraft = (field, value) => {
    setHaulerDraft((prev) => ({ ...prev, [field]: value }));
    if (haulerErrors[field]) {
      setHaulerErrors((prev) => { const c = { ...prev }; delete c[field]; return c; });
    }
  };

  const validateHauler = () => {
    const errs = {};
    if (!haulerDraft.haulerName?.trim()) errs.haulerName = "Required";
    if (!haulerDraft.numberOfTrucks && haulerDraft.numberOfTrucks !== 0) errs.numberOfTrucks = "Required";
    setHaulerErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleAddHauler = () => {
    if (!validateHauler()) return;
    if (editingHaulerKey) {
      setHaulers((prev) => prev.map((h) => (h.key === editingHaulerKey ? { ...h, ...haulerDraft } : h)));
      setEditingHaulerKey(null);
    } else {
      setHaulers((prev) => [...prev, { key: Date.now(), ...haulerDraft }]);
    }
    setHaulerDraft({ haulerName: "", numberOfTrucks: null, privateSectorClients: "" });
    setHaulerErrors({});
  };

  const editHauler = (record) => {
    setEditingHaulerKey(record.key);
    setHaulerDraft({ haulerName: record.haulerName, numberOfTrucks: record.numberOfTrucks, privateSectorClients: record.privateSectorClients || "" });
    setHaulerErrors({});
  };

  const removeHauler = (key) => {
    setHaulers((prev) => prev.filter((h) => h.key !== key));
    if (editingHaulerKey === key) {
      setEditingHaulerKey(null);
      setHaulerDraft({ haulerName: "", numberOfTrucks: null, privateSectorClients: "" });
      setHaulerErrors({});
    }
  };

  const cancelEditHauler = () => {
    setEditingHaulerKey(null);
    setHaulerDraft({ haulerName: "", numberOfTrucks: null, privateSectorClients: "" });
    setHaulerErrors({});
  };

  // ── Submit handler ──

  const handleSubmit = async (values) => {
    // Validate baseline tab first
    try {
      await baselineForm.validateFields();
    } catch {
      Swal.fire("Warning", "Please complete the Baseline Information tab first.", "warning");
      setActiveTab("baseline");
      return;
    }

    if (trucks.length === 0) {
      Swal.fire("Warning", "Please add at least one truck entry.", "warning");
      return;
    }

    const confirmed = await Swal.fire({
      title: "Submit Disposal Data?",
      html: `<p>This will submit <b>${trucks.length}</b> truck entry(ies) for <b>${portalUser?.assignedSlfName || "your SLF"}</b>.</p>`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Submit",
      confirmButtonColor: "#1a3353",
    });
    if (!confirmed.isConfirmed) return;

    setLoading(true);
    try {
      const baselineValues = baselineForm.getFieldsValue();
      const entry = {
        ...values,
        ...baselineValues,
        accreditedHaulers: haulers.map(({ key, ...rest }) => rest),
        slfName: portalUser?.assignedSlfName,
        dateOfDisposal: values.dateOfDisposal
          ? values.dateOfDisposal.format("YYYY-MM-DD")
          : null,
        trucks: trucks.map(({ key, ...rest }) => rest),
      };

      await api.post("/data-slf", {
        entries: [entry],
        submittedBy: portalUser?.email,
      });
      Swal.fire({
        icon: "success",
        title: "Submitted Successfully!",
        html: "Your disposal data has been recorded.",
        confirmButtonColor: "#1a3353",
      });
      setSubmitted(true);
      setTrucks([]);
      setTruckDraft({ ...EMPTY_TRUCK });
      setEditingTruckKey(null);
      entryForm.resetFields();
      setBaselineSaved(true);
      setActiveTab("disposal");
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
    { title: "#", key: "index", width: 40, render: (_, __, i) => i + 1 },
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
          ? `${t.truckCapacity} ${t.truckCapacityUnit || "m³"}`
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

  // Hauler table columns
  const haulerColumns = [
    { title: "#", key: "index", width: 40, render: (_, __, i) => i + 1 },
    { title: "Accredited Hauler", dataIndex: "haulerName", key: "haulerName" },
    { title: "Number of Trucks", dataIndex: "numberOfTrucks", key: "numberOfTrucks" },
    { title: "Private Sector Clients", dataIndex: "privateSectorClients", key: "privateSectorClients", render: (v) => v || "—" },
    {
      title: "Actions",
      key: "actions",
      width: 100,
      render: (_, h) => (
        <Space size="small">
          <Button type="text" size="small" icon={<EditOutlined />} onClick={() => editHauler(h)} style={{ color: "#1a3353" }} />
          <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => removeHauler(h.key)} />
        </Space>
      ),
    },
  ];

  // History table columns
  const historyColumns = [
    { title: "#", key: "index", width: 50, render: (_, __, i) => i + 1 },
    { title: "ID No.", dataIndex: "idNo", key: "idNo" },
    {
      title: "Date of Disposal",
      dataIndex: "dateOfDisposal",
      key: "dateOfDisposal",
      render: (v) => (v ? dayjs(v).format("MMM D, YYYY") : "—"),
    },
    { title: "Company", dataIndex: "lguCompanyName", key: "lguCompanyName" },
    {
      title: "Type",
      dataIndex: "companyType",
      key: "companyType",
      render: (v) => <Tag color={v === "LGU" ? "blue" : "green"}>{v}</Tag>,
    },
    {
      title: "Trucks",
      key: "truckCount",
      render: (_, r) => r.trucks?.length || 0,
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      render: (v) => {
        const color =
          v === "acknowledged" ? "green" : v === "rejected" ? "red" : "orange";
        return <Tag color={color}>{v?.toUpperCase()}</Tag>;
      },
    },
    {
      title: "Submitted",
      dataIndex: "createdAt",
      key: "createdAt",
      render: (v) => dayjs(v).format("MMM D, YYYY h:mm A"),
    },
  ];

  if (loadingUser) {
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Spin size="large" />
      </div>
    );
  }

  const fieldErr = (name) =>
    truckErrors[name]
      ? { validateStatus: "error", help: truckErrors[name] }
      : {};

  const haulerFieldErr = (name) =>
    haulerErrors[name]
      ? { validateStatus: "error", help: haulerErrors[name] }
      : {};

  const menuItems = [
    { key: "data-entry", icon: <FileTextOutlined />, label: "Data Entry" },
    { key: "history", icon: <HistoryOutlined />, label: "Submission History" },
  ];

  const siderContent = (
    <div>
      <div className="portal-sider-logo">
        <img src={embLogo} alt="EMBR3" style={{ width: 36, marginRight: collapsed && !isMobile ? 0 : 10 }} />
        {(!collapsed || isMobile) && (
          <div>
            <Text strong style={{ color: "#fff", fontSize: 14, display: "block", lineHeight: 1.2 }}>
              SLF Portal
            </Text>
            <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 11 }}>
              EMBR3 ESWMP
            </Text>
          </div>
        )}
      </div>
      <Menu
        mode="inline"
        selectedKeys={[activeMenu]}
        onClick={({ key }) => {
          setActiveMenu(key);
          if (isMobile) setMobileDrawer(false);
        }}
        items={menuItems}
        style={{ background: "transparent", borderRight: 0, color: "#fff" }}
        theme="dark"
      />
    </div>
  );

  const userDisplay = portalUser
    ? `${portalUser.firstName} ${portalUser.lastName}`
    : "";

  const userMenuItems = [
    {
      key: "info",
      label: (
        <div style={{ padding: "4px 0" }}>
          <Text strong style={{ display: "block" }}>{userDisplay}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{portalUser?.email}</Text>
          <br />
          <Tag color="blue" style={{ marginTop: 4 }}>{portalUser?.assignedSlfName}</Tag>
        </div>
      ),
      disabled: true,
    },
    { type: "divider" },
    { key: "logout", icon: <LogoutOutlined />, label: "Logout", danger: true },
  ];

  // ── Data Entry Content ──
  const renderDataEntry = () => {
    if (submitted) {
      return (
        <Card className="slf-result-card" style={{ maxWidth: 560, margin: "40px auto" }}>
          <Result
            status="success"
            icon={<CheckCircleOutlined style={{ color: "#1a3353" }} />}
            title="Submission Successful!"
            subTitle="Your SLF disposal data has been recorded."
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
      );
    }

    return (
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        {/* SLF Name (read-only, from assigned SLF) */}
        <Card
          className="slf-section"
          title={
            <Space wrap>
              <FileTextOutlined style={{ color: "#1a3353" }} />
              <Text strong style={{ fontSize: isMobile ? 14 : 16, color: "#1a3353" }}>
                {isMobile ? "Assigned SLF" : "Assigned Sanitary Landfill Facility (SLF)"}
              </Text>
            </Space>
          }
        >
          <Text style={{ fontSize: 16 }}>
            <Tag color="blue" style={{ fontSize: 14, padding: "4px 12px" }}>
              {portalUser?.assignedSlfName}
            </Tag>
          </Text>
        </Card>

        {/* Disposal Data Form */}
        <Card
          className="slf-section"
          style={{ marginTop: 20 }}
        >
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={[
              {
                key: "baseline",
                label: (
                  <span>
                    <DatabaseOutlined /> {isMobile ? "Baseline" : "Baseline Information"}
                    {baselineSaved && <CheckCircleOutlined style={{ color: "#52c41a", marginLeft: 6 }} />}
                  </span>
                ),
                children: (
                  <>
                    {baselineSaved && (
                      <div
                        style={{
                          background: "#f6ffed",
                          border: "1px solid #b7eb8f",
                          borderRadius: 6,
                          padding: "8px 14px",
                          marginBottom: 16,
                        }}
                      >
                        <CheckCircleOutlined style={{ color: "#52c41a", marginRight: 8 }} />
                        <Text style={{ color: "#389e0d" }}>
                          Baseline information has been saved. You can update it here or proceed to the Disposal tab.
                        </Text>
                      </div>
                    )}
                    <Form
                      form={baselineForm}
                      layout="vertical"
                      requiredMark={false}
                    >
                    <Divider titlePlacement="left" className="slf-category-divider">
                      Volume of Waste Accepted
                    </Divider>
                    <Row gutter={[12, 0]}>
                      <Col xs={16} sm={10} md={8}>
                        <Form.Item
                          name="totalVolumeAccepted"
                          label={isMobile ? "Total Volume Accepted" : "Total Volume of Waste Accepted (since start of operation)"}
                          rules={[{ required: true, message: "Required" }]}
                        >
                          <InputNumber placeholder="Volume" style={{ width: "100%" }} min={0} step={0.01} />
                        </Form.Item>
                      </Col>
                      <Col xs={8} sm={4} md={3}>
                        <Form.Item name="totalVolumeAcceptedUnit" label="Unit" initialValue="m³">
                          <Select>
                            <Option value="m³">m³</Option>
                            <Option value="tons">Tons</Option>
                          </Select>
                        </Form.Item>
                      </Col>
                    </Row>

                    <Divider titlePlacement="left" className="slf-category-divider">
                      Total Volume Disposed in Active Cells
                    </Divider>
                    <Row gutter={[12, 0]}>
                      <Col xs={16} sm={10} md={5}>
                        <Form.Item
                          name="activeCellResidualVolume"
                          label="Residual"
                          rules={[{ required: true, message: "Required" }]}
                        >
                          <InputNumber placeholder="Volume" style={{ width: "100%" }} min={0} step={0.01} />
                        </Form.Item>
                      </Col>
                      <Col xs={8} sm={4} md={3}>
                        <Form.Item name="activeCellResidualUnit" label="Unit" initialValue="m³">
                          <Select>
                            <Option value="m³">m³</Option>
                            <Option value="tons">Tons</Option>
                          </Select>
                        </Form.Item>
                      </Col>
                      <Col xs={16} sm={10} md={5}>
                        <Form.Item
                          name="activeCellInertVolume"
                          label="Inert"
                          rules={[{ required: true, message: "Required" }]}
                        >
                          <InputNumber placeholder="Volume" style={{ width: "100%" }} min={0} step={0.01} />
                        </Form.Item>
                      </Col>
                      <Col xs={8} sm={4} md={3}>
                        <Form.Item name="activeCellInertUnit" label="Unit" initialValue="m³">
                          <Select>
                            <Option value="m³">m³</Option>
                            <Option value="tons">Tons</Option>
                          </Select>
                        </Form.Item>
                      </Col>
                    </Row>

                    <Divider titlePlacement="left" className="slf-category-divider">
                      Total Volume Disposed in Closed Cells
                    </Divider>
                    <Row gutter={[12, 0]}>
                      <Col xs={16} sm={10} md={5}>
                        <Form.Item
                          name="closedCellResidualVolume"
                          label="Residual"
                          rules={[{ required: true, message: "Required" }]}
                        >
                          <InputNumber placeholder="Volume" style={{ width: "100%" }} min={0} step={0.01} />
                        </Form.Item>
                      </Col>
                      <Col xs={8} sm={4} md={3}>
                        <Form.Item name="closedCellResidualUnit" label="Unit" initialValue="m³">
                          <Select>
                            <Option value="m³">m³</Option>
                            <Option value="tons">Tons</Option>
                          </Select>
                        </Form.Item>
                      </Col>
                      <Col xs={16} sm={10} md={5}>
                        <Form.Item
                          name="closedCellInertVolume"
                          label="Inert"
                          rules={[{ required: true, message: "Required" }]}
                        >
                          <InputNumber placeholder="Volume" style={{ width: "100%" }} min={0} step={0.01} />
                        </Form.Item>
                      </Col>
                      <Col xs={8} sm={4} md={3}>
                        <Form.Item name="closedCellInertUnit" label="Unit" initialValue="m³">
                          <Select>
                            <Option value="m³">m³</Option>
                            <Option value="tons">Tons</Option>
                          </Select>
                        </Form.Item>
                      </Col>
                    </Row>

                    <Divider titlePlacement="left" className="slf-category-divider">
                      Accredited Haulers
                    </Divider>
                    <div className="slf-truck-box">
                      <Row gutter={[12, 0]} align="bottom">
                        <Col xs={24} sm={8} md={7}>
                          <Form.Item label="Accredited Hauler" {...haulerFieldErr("haulerName")}>
                            <Input
                              placeholder="Hauler name"
                              value={haulerDraft.haulerName}
                              onChange={(e) => updateHaulerDraft("haulerName", e.target.value)}
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={12} sm={6} md={5}>
                          <Form.Item label="Number of Trucks" {...haulerFieldErr("numberOfTrucks")}>
                            <InputNumber
                              placeholder="Count"
                              style={{ width: "100%" }}
                              min={0}
                              value={haulerDraft.numberOfTrucks}
                              onChange={(v) => updateHaulerDraft("numberOfTrucks", v)}
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={8} md={7}>
                          <Form.Item label="Private Sector Clients">
                            <Input
                              placeholder="Client names"
                              value={haulerDraft.privateSectorClients}
                              onChange={(e) => updateHaulerDraft("privateSectorClients", e.target.value)}
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={6} md={5}>
                          <Form.Item>
                            <Space>
                              <Button
                                type="primary"
                                icon={editingHaulerKey ? <EditOutlined /> : <PlusOutlined />}
                                className="slf-primary-btn"
                                onClick={handleAddHauler}
                              >
                                {editingHaulerKey ? "Update" : "Add"}
                              </Button>
                              {editingHaulerKey && <Button onClick={cancelEditHauler}>Cancel</Button>}
                            </Space>
                          </Form.Item>
                        </Col>
                      </Row>
                      <Table
                        dataSource={haulers}
                        columns={haulerColumns}
                        rowKey="key"
                        size="small"
                        pagination={false}
                        scroll={{ x: 600 }}
                        locale={{ emptyText: <Text type="secondary" style={{ fontSize: 13 }}>No haulers added.</Text> }}
                      />
                    </div>
                  </Form>
                  </>
                ),
              },
              {
                key: "disposal",
                label: (
                  <span>
                    <FileTextOutlined /> {isMobile ? "Disposal" : "Disposal Data"}
                  </span>
                ),
                children: (
                  <Form
                    form={entryForm}
                    layout="vertical"
                    onFinish={handleSubmit}
                    requiredMark={false}
                  >
                    <Divider titlePlacement="left" className="slf-category-divider">
                      Disposal Information
                    </Divider>
                    <Row gutter={[12, 0]}>
                      <Col xs={24} sm={12} md={8}>
                        <Form.Item
                          name="dateOfDisposal"
                          label={fl("dateOfDisposal", "Date of Disposal")}
                          rules={[{ required: true, message: "Required" }]}
                        >
                          <DatePicker style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                    </Row>

                    <Divider titlePlacement="left" className="slf-category-divider">
                      Company Information
                    </Divider>
                    <Row gutter={[12, 0]}>
                      <Col xs={24} sm={14} md={12}>
                        <Form.Item
                          name="lguCompanyName"
                          label={fl("lguCompanyName", "LGU/Company Name")}
                          rules={[{ required: true, message: "Required" }]}
                        >
                          <Input placeholder="e.g. Dela Cruz, Juan" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} sm={10} md={6}>
                        <Form.Item
                          name="companyType"
                          label={fl("companyType", "Company Type")}
                          rules={[{ required: true, message: "Required" }]}
                        >
                          <Select placeholder="Select type">
                            {(fieldLabels.companyType?.options?.length > 0
                              ? fieldLabels.companyType.options
                              : ["LGU", "Private"]
                            ).map((o) => (
                              <Option key={o} value={o}>{o}</Option>
                            ))}
                          </Select>
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={[12, 0]}>
                      <Col xs={24}>
                        <Form.Item name="address" label={fl("address", "Address")}>
                          <Input placeholder="Complete address" />
                        </Form.Item>
                      </Col>
                    </Row>

                    <Divider titlePlacement="left" className="slf-category-divider">
                      Transport Information &amp; Volume
                    </Divider>

                    <div className="slf-truck-box">
                      <Row gutter={[12, 0]}>
                        <Col xs={24} sm={12} md={5}>
                          <Form.Item
                            label={isMobile ? "Ticket No." : fl("disposalTicketNo", "Disposal/Trip Ticket No.")}
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
                          <Form.Item label={fl("hauler", "Hauler")} {...fieldErr("hauler")}>
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
                          <Form.Item label={fl("plateNumber", "Plate Number")} {...fieldErr("plateNumber")}>
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
                          <Form.Item label={isMobile ? "Capacity" : fl("truckCapacity", "Truck Capacity")}>
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
                              onChange={(v) =>
                                updateTruckDraft("truckCapacityUnit", v)
                              }
                            >
                              <Option value="m³">m³</Option>
                              <Option value="tons">Tons</Option>
                            </Select>
                          </Form.Item>
                        </Col>
                      </Row>
                      <Row gutter={[12, 0]} align="bottom">
                        <Col xs={12} sm={8} md={3}>
                          <Form.Item
                            label={isMobile ? "Waste Vol." : fl("actualVolume", "Actual Waste Vol.")}
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
                              onChange={(v) =>
                                updateTruckDraft("actualVolumeUnit", v)
                              }
                            >
                              <Option value="tons">Tons</Option>
                              <Option value="m³">m³</Option>
                            </Select>
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={12} md={4}>
                          <Form.Item label={fl("wasteType", "Waste Type")} {...fieldErr("wasteType")}>
                            <Select
                              placeholder="Select"
                              value={truckDraft.wasteType}
                              onChange={(v) => updateTruckDraft("wasteType", v)}
                            >
                              {(fieldLabels.wasteType?.options?.length > 0
                                ? fieldLabels.wasteType.options
                                : ["Residual", "Hazardous Waste"]
                              ).map((o) => (
                                <Option key={o} value={o}>{o}</Option>
                              ))}
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
                ),
              },
            ]}
          />
        </Card>
      </div>
    );
  };

  // ── History Content ──
  const renderHistory = () => (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <Card
        className="slf-section"
        title={
          <Space>
            <HistoryOutlined style={{ color: "#1a3353" }} />
            <Text strong style={{ fontSize: 16, color: "#1a3353" }}>
              Submission History
            </Text>
          </Space>
        }
        extra={
          <Button size="small" onClick={fetchSubmissions}>
            Refresh
          </Button>
        }
      >
        <Table
          dataSource={submissions}
          columns={historyColumns}
          rowKey="_id"
          loading={loadingSubmissions}
          size="small"
          pagination={{ pageSize: 15 }}
          scroll={{ x: 900 }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No submissions yet"
              />
            ),
          }}
        />
      </Card>
    </div>
  );

  return (
    <Layout style={{ minHeight: "100vh" }}>
      {/* Desktop Sider */}
      {!isMobile && (
        <Sider
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          width={220}
          collapsedWidth={64}
          className="portal-sider"
          style={{
            background: "linear-gradient(180deg, #0e1e35 0%, #1a3353 100%)",
            overflow: "auto",
            height: "100vh",
            position: "fixed",
            left: 0,
            top: 0,
            bottom: 0,
            zIndex: 10,
          }}
        >
          {siderContent}
        </Sider>
      )}

      {/* Mobile Drawer */}
      {isMobile && (
        <Drawer
          placement="left"
          open={mobileDrawer}
          onClose={() => setMobileDrawer(false)}
          width={240}
          styles={{
            body: {
              padding: 0,
              background:
                "linear-gradient(180deg, #0e1e35 0%, #1a3353 100%)",
            },
          }}
          closable={false}
        >
          {siderContent}
        </Drawer>
      )}

      <Layout
        style={{
          marginLeft: isMobile ? 0 : collapsed ? 64 : 220,
          transition: "margin-left 0.2s",
        }}
      >
        {/* Header */}
        <Header
          className="portal-header"
          style={{
            background: "#fff",
            padding: "0 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
            position: "sticky",
            top: 0,
            zIndex: 9,
            height: 56,
          }}
        >
          <Space>
            {isMobile && (
              <Button
                type="text"
                icon={<MenuOutlined />}
                onClick={() => setMobileDrawer(true)}
              />
            )}
            <Text strong style={{ color: "#1a3353", fontSize: 16 }}>
              SLF Generators Portal
            </Text>
          </Space>
          <Dropdown
            menu={{
              items: userMenuItems,
              onClick: ({ key }) => {
                if (key === "logout") handleLogout();
              },
            }}
            trigger={["click"]}
          >
            <Space style={{ cursor: "pointer" }}>
              <Avatar
                size="small"
                style={{
                  background: "linear-gradient(135deg, #1a3353, #2d5f8a)",
                }}
              >
                {portalUser?.firstName?.[0]?.toUpperCase()}
              </Avatar>
              {!isMobile && (
                <Text style={{ color: "#1a3353", fontWeight: 500 }}>
                  {userDisplay}
                </Text>
              )}
            </Space>
          </Dropdown>
        </Header>

        {/* Content */}
        <Content
          style={{
            padding: isMobile ? "12px 6px" : "24px 24px",
            background: "#f0f2f5",
            minHeight: "calc(100vh - 56px - 52px)",
          }}
        >
          {activeMenu === "data-entry" && renderDataEntry()}
          {activeMenu === "history" && renderHistory()}
        </Content>

        {/* Footer */}
        <div className="slf-footer">
          <Text className="slf-footer-text">
            &copy; 2026 EMBR3 — Ecological Solid Waste Management Pipeline.
            All rights reserved.
          </Text>
        </div>
      </Layout>
    </Layout>
  );
}
