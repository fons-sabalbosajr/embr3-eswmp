import dayjs from "dayjs";
import {
  Avatar, Button, Col, Collapse, DatePicker, Descriptions, Divider,
  Drawer, Empty, Form, Input, InputNumber, List,
  Modal, Progress, Row, Select, Space, Spin, Table, Tabs, Tag, Upload,
  Typography,
} from "antd";
import {
  AuditOutlined, BankOutlined, BarChartOutlined, CarOutlined, CheckCircleOutlined,
  CloseCircleOutlined, ContainerOutlined, DatabaseOutlined, DeleteOutlined,
  EditOutlined, EnvironmentOutlined, EyeOutlined, FileTextOutlined,
  InfoCircleOutlined, MailOutlined, MessageOutlined, PieChartOutlined,
  PlusOutlined, QuestionCircleOutlined, SaveOutlined, SendOutlined,
  TeamOutlined, UndoOutlined, UploadOutlined, UserOutlined, WifiOutlined,
} from "@ant-design/icons";
import { EMPTY_VEHICLE } from "./constants";
import api from "../../api";

const { Text } = Typography;
const { Option } = Select;
const { TextArea } = Input;

// All SLF Portal modals — receives all state/handlers via props
export default function SLFPortalModals({
  // Form instances
  entryForm, baselineForm, companyForm,
  // State
  haulerModalOpen, setHaulerModalOpen,
  haulerDraft, setHaulerDraft,
  editingHaulerKey, setEditingHaulerKey,
  haulerErrors, setHaulerErrors,
  haulerProvinces, setHaulerProvinces,
  haulerCities, setHaulerCities,
  haulerBarangayList, setHaulerBarangayList,
  loadingHaulerAddress, setLoadingHaulerAddress,
  fetchHaulerProvinces, fetchHaulerCities, fetchHaulerBarangays,
  clientModalOpen, setClientModalOpen,
  editingClientKey, setEditingClientKey,
  clientDraft, setClientDraft,
  clientProvinces, setClientProvinces,
  clientMunicipalities, setClientMunicipalities,
  loadingClientAddress, setLoadingClientAddress,
  truckModalOpen, setTruckModalOpen,
  truckDraft, setTruckDraft,
  editingTruckKey, setEditingTruckKey,
  truckErrors, setTruckErrors,
  historyDetailModal, setHistoryDetailModal,
  reviewModalOpen, setReviewModalOpen,
  revertModalOpen, setRevertModalOpen,
  revertRecord, setRevertRecord,
  revertReason, setRevertReason,
  revertLoading,
  profileModalOpen, setProfileModalOpen,
  supportDrawerOpen, setSupportDrawerOpen,
  supportTab, setSupportTab,
  supportTickets,
  supportLoading,
  supportSubmitting,
  fetchSupportTickets,
  faqActiveKey, setFaqActiveKey,
  supportDetailModal, setSupportDetailModal,
  supportReplyText, setSupportReplyText,
  uploadModalOpen, setUploadModalOpen,
  uploadType, setUploadType,
  uploadGuideOpen, setUploadGuideOpen,
  uploadGuideType, setUploadGuideType,
  uploadPreviewData,
  uploadPreviewColumns,
  setUploadPreviewData,
  setUploadPreviewColumns,
  activeCellModalOpen, setActiveCellModalOpen,
  activeCellDraft, setActiveCellDraft,
  editingActiveCellKey, setEditingActiveCellKey,
  closedCellModalOpen, setClosedCellModalOpen,
  closedCellDraft, setClosedCellDraft,
  editingClosedCellKey, setEditingClosedCellKey,
  haulerDeleteModal, setHaulerDeleteModal,
  haulerDeleteReason, setHaulerDeleteReason,
  haulerDeleteFile, setHaulerDeleteFile,
  haulerDeleteLoading,
  setHaulerDeleteLoading,
  leachateModalOpen, setLeachateModalOpen,
  leachateDetails, setLeachateDetails,
  gasVentModalOpen, setGasVentModalOpen,
  gasVentDetails, setGasVentDetails,
  trashSlideModalOpen, setTrashSlideModalOpen,
  trashSlideDetails, setTrashSlideDetails,
  firePrevModalOpen, setFirePrevModalOpen,
  firePrevDetails, setFirePrevDetails,
  facilityMgmtSaving,
  wasteReceivedModalOpen, setWasteReceivedModalOpen,
  wasteReceivedData,
  wasteReceivedLoading,
  activeCellEntries,
  closedCellEntries,
  haulers,
  trucks,
  baselineUnit,
  baselineSaved,
  submissions,
  portalUser,
  activeSlfId,
  activeSlfName,
  slfInfo,
  regions,
  provinces,
  municipalities,
  barangays,
  extraTransportFields,
  acceptsHazardousWaste,
  hazWasteCodes,
  isMobile,
  // Handlers
  handleSaveHauler,
  updateHaulerDraft,
  updateHaulerDraftAddr,
  openHaulerModal,
  handleSaveClient,
  handleSaveTruck,
  updateTruckDraft,
  updateVehicle,
  openRevertModal,
  handleRequestRevert,
  handleConfirmSubmit,
  handleReviewOpen,
  handleSubmitTicket,
  handleSupportReply,
  handleSaveActiveCellEntry,
  handleSaveClosedCellEntry,
  handleConfirmUpload,
  proceedToFilePicker,
  updateUploadCell,
  handleOpenWasteReceived,
  handleSaveFacilityDetails,
  handleEditReverted,
  handleResubmitReverted,
  renderStatusTag,
  fl, isRequired, opts, fieldErr,
  loading,
  resubmitComment, setResubmitComment,
  editingRevertedId, setEditingRevertedId,
}) {
  const haulerFieldErr = (name) =>
    haulerErrors[name]
      ? { validateStatus: "error", help: haulerErrors[name] }
      : {};

  return (
    <>
      {/* ── Hauler Modal ── */}
      <Modal
        title={
          editingHaulerKey ? "Edit Accredited Hauler" : "Add Accredited Hauler"
        }
        open={haulerModalOpen}
        onCancel={() => {
          setHaulerModalOpen(false);
          setHaulerErrors({});
        }}
        onOk={handleSaveHauler}
        okText={editingHaulerKey ? "Update" : "Add"}
        okButtonProps={{ className: "slf-primary-btn" }}
        destroyOnHidden
        width={1100}
      >
        <Collapse
          defaultActiveKey={["basic", "vehicle", "clients"]}
          bordered={false}
          expandIconPlacement="end"
          style={{ background: "transparent" }}
          items={[
            {
              key: "basic",
              label: (
                <Text strong style={{ color: "#1a3353" }}>
                  <TeamOutlined /> Basic Information
                </Text>
              ),
              children: (
                <>
                  <Row gutter={[12, 0]}>
                    <Col xs={24} sm={14}>
                      <Form.Item
                        label="Accredited Hauler"
                        required
                        {...haulerFieldErr("haulerName")}
                      >
                        <Input
                          placeholder="Hauler name"
                          value={haulerDraft.haulerName}
                          onChange={(e) =>
                            updateHaulerDraft("haulerName", e.target.value)
                          }
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={10}>
                      <Form.Item
                        label="Number of Trucks"
                        required
                        {...haulerFieldErr("numberOfTrucks")}
                      >
                        <InputNumber
                          placeholder="Count"
                          style={{ width: "100%" }}
                          min={1}
                          value={haulerDraft.numberOfTrucks}
                          onChange={(v) =>
                            updateHaulerDraft("numberOfTrucks", v)
                          }
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={[12, 0]}>
                    <Col xs={24} sm={12}>
                      <Form.Item label="Region">
                        <Select
                          showSearch
                          placeholder="Select region"
                          value={haulerDraft.officeRegion || undefined}
                          onChange={(code) => {
                            updateHaulerDraft("officeRegion", code);
                            fetchHaulerProvinces(code);
                          }}
                          filterOption={(input, opt) =>
                            opt?.label
                              ?.toLowerCase()
                              .includes(input.toLowerCase())
                          }
                          options={regions.map((r) => ({
                            value: r.code,
                            label: r.name,
                          }))}
                          allowClear
                          style={{ width: "100%" }}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item label="Province">
                        <Select
                          showSearch
                          placeholder="Select province"
                          value={haulerDraft.officeProvince || undefined}
                          loading={loadingHaulerAddress === "province"}
                          disabled={!haulerDraft.officeRegion}
                          onChange={(code) => {
                            updateHaulerDraft("officeProvince", code);
                            fetchHaulerCities(code);
                          }}
                          filterOption={(input, opt) =>
                            opt?.label
                              ?.toLowerCase()
                              .includes(input.toLowerCase())
                          }
                          options={haulerProvinces.map((p) => ({
                            value: p.code,
                            label: p.name,
                          }))}
                          allowClear
                          style={{ width: "100%" }}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item label="City / Municipality">
                        <Select
                          showSearch
                          placeholder="Select city/municipality"
                          value={haulerDraft.officeCity || undefined}
                          loading={loadingHaulerAddress === "city"}
                          disabled={!haulerDraft.officeProvince}
                          onChange={(code) => {
                            updateHaulerDraft("officeCity", code);
                            fetchHaulerBarangays(code);
                          }}
                          filterOption={(input, opt) =>
                            opt?.label
                              ?.toLowerCase()
                              .includes(input.toLowerCase())
                          }
                          options={haulerCities.map((c) => ({
                            value: c.code,
                            label: c.name,
                          }))}
                          allowClear
                          style={{ width: "100%" }}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item label="Barangay">
                        <Select
                          showSearch
                          placeholder="Select barangay"
                          value={haulerDraft.officeBarangay || undefined}
                          loading={loadingHaulerAddress === "barangay"}
                          disabled={!haulerDraft.officeCity}
                          onChange={(code) =>
                            updateHaulerDraft("officeBarangay", code)
                          }
                          filterOption={(input, opt) =>
                            opt?.label
                              ?.toLowerCase()
                              .includes(input.toLowerCase())
                          }
                          options={haulerBarangayList.map((b) => ({
                            value: b.code,
                            label: b.name,
                          }))}
                          allowClear
                          style={{ width: "100%" }}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                </>
              ),
            },
            {
              key: "vehicle",
              label: (
                <Text strong style={{ color: "#1a3353" }}>
                  <CarOutlined /> Vehicle Details
                  {haulerDraft.vehicles?.length > 0 && (
                    <Tag color="blue" style={{ marginLeft: 8 }}>
                      {haulerDraft.vehicles.length}
                    </Tag>
                  )}
                </Text>
              ),
              children:
                haulerDraft.vehicles?.length > 0 ? (
                  haulerDraft.vehicles.map((v, i) => (
                    <div
                      key={i}
                      style={{
                        marginBottom: 12,
                        padding: "8px 12px",
                        background: "#fafafa",
                        borderRadius: 6,
                        border: "1px solid #f0f0f0",
                      }}
                    >
                      <Text
                        strong
                        style={{
                          fontSize: 12,
                          color: "#1a3353",
                          display: "block",
                          marginBottom: 8,
                        }}
                      >
                        Vehicle {i + 1}
                      </Text>
                      <Row gutter={[12, 0]}>
                        <Col xs={24} sm={8}>
                          <Form.Item
                            label="Plate Number"
                            style={{ marginBottom: 8 }}
                          >
                            <Input
                              placeholder="e.g. ABC-1234"
                              value={v.plateNumber}
                              onChange={(e) =>
                                updateVehicle(i, "plateNumber", e.target.value)
                              }
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={8}>
                          <Form.Item
                            label="Vehicle Type"
                            style={{ marginBottom: 8 }}
                          >
                            <Input
                              placeholder="e.g. Dump Truck"
                              value={v.vehicleType}
                              onChange={(e) =>
                                updateVehicle(i, "vehicleType", e.target.value)
                              }
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={12} sm={5}>
                          <Form.Item
                            label="Capacity"
                            style={{ marginBottom: 8 }}
                          >
                            <InputNumber
                              placeholder="Cap."
                              style={{ width: "100%" }}
                              min={0}
                              step={0.1}
                              value={v.capacity}
                              onChange={(val) =>
                                updateVehicle(i, "capacity", val)
                              }
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={12} sm={3}>
                          <Form.Item label="Unit" style={{ marginBottom: 8 }}>
                            <Select
                              value={v.capacityUnit}
                              onChange={(val) =>
                                updateVehicle(i, "capacityUnit", val)
                              }
                            >
                              <Option value="m³">
                                m<sup>3</sup>
                              </Option>
                              <Option value="tons">tons</Option>
                            </Select>
                          </Form.Item>
                        </Col>
                      </Row>
                    </div>
                  ))
                ) : (
                  <Text type="secondary" style={{ fontSize: 13 }}>
                    Set the Number of Trucks above to add vehicle details.
                  </Text>
                ),
            },
            {
              key: "clients",
              label: (
                <Text strong style={{ color: "#1a3353" }}>
                  <EnvironmentOutlined /> Clients
                </Text>
              ),
              children: (
                <div>
                  <div style={{ marginBottom: 8 }}>
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      className="slf-primary-btn"
                      size="small"
                      onClick={() => {
                        setEditingClientKey(null);
                        setClientDraft({
                          clientName: "",
                          clientType: "Private",
                          region: "",
                          province: "",
                          municipality: "",
                        });
                        setClientProvinces([]);
                        setClientMunicipalities([]);
                        setClientModalOpen(true);
                      }}
                    >
                      Add Client
                    </Button>
                  </div>
                  <Table
                    dataSource={haulerDraft.privateSectorClients || []}
                    rowKey="key"
                    size="small"
                    pagination={false}
                    locale={{
                      emptyText: (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          No clients added yet.
                        </Text>
                      ),
                    }}
                    columns={[
                      {
                        title: "Client Name",
                        dataIndex: "clientName",
                        key: "clientName",
                        render: (v) => v || "—",
                      },
                      {
                        title: "Type",
                        dataIndex: "clientType",
                        key: "clientType",
                        width: 80,
                        render: (v) => (
                          <Tag color={v === "LGU" ? "blue" : "green"}>{v}</Tag>
                        ),
                      },
                      {
                        title: "Location",
                        key: "location",
                        render: (_, r) =>
                          [
                            r.regionName || r.region,
                            r.provinceName || r.province,
                            r.municipalityName || r.municipality,
                          ]
                            .filter(Boolean)
                            .join(" / ") || "—",
                      },
                      {
                        title: "Actions",
                        key: "act",
                        width: 80,
                        render: (_, r) => (
                          <Space size="small">
                            <Button
                              type="text"
                              size="small"
                              icon={<EditOutlined />}
                              onClick={async () => {
                                setEditingClientKey(r.key);
                                setClientDraft({
                                  clientName: r.clientName,
                                  clientType: r.clientType,
                                  region: r.region,
                                  province: r.province,
                                  municipality: r.municipality,
                                });
                                setClientProvinces([]);
                                setClientMunicipalities([]);
                                if (r.region) {
                                  setLoadingClientAddress("province");
                                  try {
                                    const res = await fetch(
                                      `https://psgc.gitlab.io/api/regions/${r.region}/provinces/`,
                                    );
                                    setClientProvinces(await res.json());
                                  } catch (_) {}
                                  setLoadingClientAddress("");
                                }
                                if (r.province) {
                                  setLoadingClientAddress("municipality");
                                  try {
                                    const res = await fetch(
                                      `https://psgc.gitlab.io/api/provinces/${r.province}/cities-municipalities/`,
                                    );
                                    setClientMunicipalities(await res.json());
                                  } catch (_) {}
                                  setLoadingClientAddress("");
                                }
                                setClientModalOpen(true);
                              }}
                              style={{ color: "#1a3353" }}
                            />
                            <Button
                              type="text"
                              danger
                              size="small"
                              icon={<DeleteOutlined />}
                              onClick={() =>
                                updateHaulerDraft(
                                  "privateSectorClients",
                                  (
                                    haulerDraft.privateSectorClients || []
                                  ).filter((c) => c.key !== r.key),
                                )
                              }
                            />
                          </Space>
                        ),
                      },
                    ]}
                  />
                </div>
              ),
            },
          ]}
        />
      </Modal>

      {/* ── Truck Entry Modal ── */}
      <Modal
        title={
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              paddingRight: 32,
            }}
          >
            <div
              style={{
                background: "linear-gradient(135deg, #1a3353 0%, #1e4a7a 100%)",
                borderRadius: 10,
                width: 42,
                height: 42,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                boxShadow: "0 2px 8px rgba(26,51,83,0.35)",
              }}
            >
              <CarOutlined style={{ color: "#fff", fontSize: 20 }} />
            </div>
            <div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: "#1a3353",
                  lineHeight: 1.3,
                  letterSpacing: 0.2,
                }}
              >
                {editingTruckKey
                  ? "Edit Transport Entry"
                  : "Add Transport Entry"}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "#8c8c8c",
                  fontWeight: 400,
                  marginTop: 2,
                }}
              >
                Complete all sections below for this transport trip
              </div>
            </div>
          </div>
        }
        open={truckModalOpen}
        onCancel={() => {
          setTruckModalOpen(false);
          setTruckErrors({});
        }}
        onOk={handleSaveTruck}
        okText={editingTruckKey ? "Update Entry" : "Add Entry"}
        okButtonProps={{
          className: "slf-primary-btn",
          icon: editingTruckKey ? <EditOutlined /> : <PlusOutlined />,
        }}
        cancelButtonProps={{ icon: <CloseCircleOutlined /> }}
        destroyOnHidden
        width={880}
        styles={{
          body: { paddingTop: 16, maxHeight: "72vh", overflowY: "auto" },
        }}
      >
        {/* ── Section 2: Trip Information ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "linear-gradient(90deg, #135200 0%, #237804 100%)",
            borderRadius: "8px 8px 0 0",
            padding: "9px 16px",
          }}
        >
          <AuditOutlined style={{ color: "#fff", fontSize: 14 }} />
          <Text
            strong
            style={{ color: "#fff", fontSize: 13, letterSpacing: 0.3 }}
          >
            Trip Information
          </Text>
        </div>
        <div
          style={{
            background: "#f6ffed",
            border: "1px solid #b7eb8f",
            borderTop: "none",
            borderRadius: "0 0 8px 8px",
            padding: "16px 16px 4px",
            marginBottom: 14,
          }}
        >
          <Row gutter={[12, 0]}>
            <Col xs={24} sm={12}>
              <Form.Item
                label={fl("disposalTicketNo", "Disposal/Trip Ticket No.")}
                required
                {...fieldErr("disposalTicketNo")}
              >
                <Input
                  placeholder="e.g. TK-2024-001"
                  value={truckDraft.disposalTicketNo}
                  onChange={(e) =>
                    updateTruckDraft("disposalTicketNo", e.target.value)
                  }
                  prefix={<FileTextOutlined style={{ color: "#bfbfbf" }} />}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                label={fl("hauler", "Hauler")}
                required={isRequired("hauler", true)}
                {...fieldErr("hauler")}
              >
                <Select
                  showSearch
                  allowClear
                  placeholder="Select accredited hauler"
                  value={truckDraft.hauler || undefined}
                  onChange={(v) => {
                    updateTruckDraft("hauler", v || "");
                    updateTruckDraft("plateNumber", "");
                    updateTruckDraft("truckCapacity", null);
                    updateTruckDraft("vehicles", [
                      {
                        ...EMPTY_VEHICLE,
                        key: Date.now(),
                        capacityUnit: baselineUnit || "m³",
                      },
                    ]);
                  }}
                  filterOption={(input, option) =>
                    (option?.children ?? "")
                      .toLowerCase()
                      .includes(input.toLowerCase())
                  }
                  notFoundContent={
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      No haulers registered in baseline
                    </Text>
                  }
                >
                  {haulers.map((h) => (
                    <Option key={h.key || h.haulerName} value={h.haulerName}>
                      {h.haulerName}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
        </div>

        {/* ── Section 3: Vehicle & Capacity ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "linear-gradient(90deg, #612500 0%, #873800 100%)",
            borderRadius: "8px 8px 0 0",
            padding: "9px 16px",
          }}
        >
          <CarOutlined style={{ color: "#fff", fontSize: 14 }} />
          <Text
            strong
            style={{ color: "#fff", fontSize: 13, letterSpacing: 0.3 }}
          >
            Vehicle & Capacity
          </Text>
        </div>
        <div
          style={{
            background: "#fff7e6",
            border: "1px solid #ffd591",
            borderTop: "none",
            borderRadius: "0 0 8px 8px",
            padding: "16px 16px 4px",
            marginBottom: 14,
          }}
        >
          {truckErrors.plateNumber && (
            <Text
              type="danger"
              style={{ fontSize: 12, display: "block", marginBottom: 8 }}
            >
              {truckErrors.plateNumber}
            </Text>
          )}
          {(truckDraft.vehicles || []).map((veh, vi) => {
            const selectedHauler = haulers.find(
              (h) => h.haulerName === truckDraft.hauler,
            );
            const haulerVehicles = selectedHauler?.vehicles || [];
            return (
              <div
                key={veh.key || vi}
                style={{
                  background: "#fff",
                  borderRadius: 8,
                  padding: "12px 14px",
                  marginBottom: 10,
                  border: "1px solid #ffd591",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 8,
                  }}
                >
                  <Text
                    type="secondary"
                    style={{
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                    }}
                  >
                    Vehicle {vi + 1}
                  </Text>
                  {(truckDraft.vehicles || []).length > 1 && (
                    <Button
                      type="text"
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      onClick={() => {
                        const updated = (truckDraft.vehicles || []).filter(
                          (_, idx) => idx !== vi,
                        );
                        updateTruckDraft("vehicles", updated);
                      }}
                    />
                  )}
                </div>
                <Row gutter={[12, 0]} align="middle">
                  <Col xs={24} sm={10}>
                    <Form.Item
                      label={fl("plateNumber", "Plate Number")}
                      style={{ marginBottom: 4 }}
                    >
                      <Select
                        showSearch
                        allowClear
                        placeholder="Select or type plate number"
                        value={veh.plateNumber || undefined}
                        onChange={(val) => {
                          const updated = [...(truckDraft.vehicles || [])];
                          updated[vi] = {
                            ...updated[vi],
                            plateNumber: val || "",
                            selectedClients: [],
                          };
                          const match = haulerVehicles.find(
                            (hv) => hv.plateNumber === val,
                          );
                          if (match) {
                            updated[vi].capacity = match.capacity || null;
                            updated[vi].capacityUnit =
                              match.capacityUnit || baselineUnit || "m³";
                          }
                          updateTruckDraft("vehicles", updated);
                        }}
                        filterOption={(input, option) =>
                          (option?.children ?? "")
                            .toLowerCase()
                            .includes(input.toLowerCase())
                        }
                        notFoundContent={
                          truckDraft.hauler
                            ? "No vehicles for this hauler"
                            : "Select a hauler first"
                        }
                      >
                        {haulerVehicles.map((hv) => (
                          <Option key={hv.plateNumber} value={hv.plateNumber}>
                            {hv.plateNumber}
                          </Option>
                        ))}
                      </Select>
                    </Form.Item>
                  </Col>
                  <Col xs={14} sm={9}>
                    <Form.Item
                      label="Truck Capacity"
                      style={{ marginBottom: 4 }}
                    >
                      <InputNumber
                        placeholder="Capacity"
                        style={{ width: "100%" }}
                        min={0}
                        step={0.1}
                        value={veh.capacity}
                        onChange={(val) => {
                          const updated = [...(truckDraft.vehicles || [])];
                          updated[vi] = { ...updated[vi], capacity: val };
                          updateTruckDraft("vehicles", updated);
                        }}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={10} sm={5}>
                    <Form.Item label="Unit" style={{ marginBottom: 4 }}>
                      <Select
                        value={veh.capacityUnit || baselineUnit || "m³"}
                        onChange={(val) => {
                          const updated = [...(truckDraft.vehicles || [])];
                          updated[vi] = { ...updated[vi], capacityUnit: val };
                          updateTruckDraft("vehicles", updated);
                        }}
                      >
                        <Option value="m³">m³</Option>
                        <Option value="tons">tons</Option>
                      </Select>
                    </Form.Item>
                  </Col>
                  {(() => {
                    const selectedHauler = haulers.find(
                      (h) => h.haulerName === truckDraft.hauler,
                    );
                    const haulerClients =
                      selectedHauler?.privateSectorClients || [];
                    if (!haulerClients.length || !veh.plateNumber) return null;
                    return (
                      <Col xs={24}>
                        <Form.Item
                          label={
                            <Text style={{ fontSize: 12 }}>
                              <TeamOutlined style={{ marginRight: 4 }} />
                              Clients for this Vehicle
                            </Text>
                          }
                          style={{ marginBottom: 4, marginTop: 4 }}
                        >
                          <Select
                            mode="multiple"
                            placeholder="Select clients for this vehicle"
                            value={(veh.selectedClients || []).map((c) =>
                              typeof c === "object" ? c.clientName : c,
                            )}
                            onChange={(vals) => {
                              const selected = vals.map((name) => {
                                const found = haulerClients.find(
                                  (c) => (c.clientName || c) === name,
                                );
                                if (found && typeof found === "object")
                                  return { ...found, key: found.key || name };
                                return {
                                  clientName: name,
                                  clientType: "Private",
                                  region: "",
                                  province: "",
                                  municipality: "",
                                  key: name,
                                };
                              });
                              const updated = [...(truckDraft.vehicles || [])];
                              updated[vi] = {
                                ...updated[vi],
                                selectedClients: selected,
                              };
                              updateTruckDraft("vehicles", updated);
                            }}
                            options={haulerClients.map((c) => ({
                              label:
                                typeof c === "object" ? (
                                  <span>
                                    {c.clientName}{" "}
                                    <Tag
                                      color={
                                        c.clientType === "LGU"
                                          ? "blue"
                                          : "green"
                                      }
                                      style={{ fontSize: 10, marginLeft: 4 }}
                                    >
                                      {c.clientType}
                                    </Tag>
                                  </span>
                                ) : (
                                  c
                                ),
                              value: typeof c === "object" ? c.clientName : c,
                            }))}
                          />
                        </Form.Item>
                      </Col>
                    );
                  })()}
                </Row>
              </div>
            );
          })}
          <Button
            type="dashed"
            size="small"
            icon={<PlusOutlined />}
            onClick={() => {
              const updated = [
                ...(truckDraft.vehicles || []),
                {
                  ...EMPTY_VEHICLE,
                  key: Date.now(),
                  capacityUnit: baselineUnit || "m³",
                  selectedClients: [],
                },
              ];
              updateTruckDraft("vehicles", updated);
            }}
            style={{ marginTop: 4, borderColor: "#fa8c16", color: "#fa8c16" }}
          >
            Add Vehicle
          </Button>
        </div>

        {/* ── Section 4: Waste Details ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "linear-gradient(90deg, #391085 0%, #531dab 100%)",
            borderRadius: "8px 8px 0 0",
            padding: "9px 16px",
          }}
        >
          <DatabaseOutlined style={{ color: "#fff", fontSize: 14 }} />
          <Text
            strong
            style={{ color: "#fff", fontSize: 13, letterSpacing: 0.3 }}
          >
            Waste Details
          </Text>
        </div>
        <div
          style={{
            background: "#f9f0ff",
            border: "1px solid #d3adf7",
            borderTop: "none",
            borderRadius: "0 0 8px 8px",
            padding: "16px 16px 4px",
            marginBottom: extraTransportFields.length > 0 ? 14 : 0,
          }}
        >
          <Row gutter={[12, 0]}>
            <Col xs={12} sm={8}>
              <Form.Item
                label={fl("actualVolume", "Actual Waste Volume")}
                required={isRequired("actualVolume", true)}
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
            <Col xs={12} sm={4}>
              <Form.Item label="Unit">
                <Select
                  value={truckDraft.actualVolumeUnit}
                  onChange={(v) => updateTruckDraft("actualVolumeUnit", v)}
                >
                  <Option value="tons">tons</Option>
                  <Option value="m³">m³</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                label={fl("wasteType", "Waste Type")}
                required={isRequired("wasteType", true)}
                {...fieldErr("wasteType")}
              >
                <Select
                  placeholder="Select waste classification"
                  value={truckDraft.wasteType}
                  onChange={(v) => updateTruckDraft("wasteType", v)}
                >
                  {opts("wasteType", [
                    "Residual",
                    "Treated Hazardous Waste",
                  ]).map((o) => (
                    <Option key={o} value={o}>
                      {o}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={[12, 0]}>
            <Col xs={24} sm={14}>
              <Form.Item
                label="Hazardous Waste Code (DENR EMB)"
                tooltip="Applicable only for Treated Hazardous Waste"
              >
                <Select
                  mode="multiple"
                  placeholder="Select DENR EMB hazardous waste code(s)"
                  value={truckDraft.hazWasteCode}
                  onChange={(v) => updateTruckDraft("hazWasteCode", v)}
                  disabled={
                    !truckDraft.wasteType?.toLowerCase().includes("hazardous")
                  }
                  showSearch
                  allowClear
                >
                  {hazWasteCodes.map((code) => (
                    <Option key={code} value={code}>
                      {code}
                    </Option>
                  ))}
                </Select>
                {!truckDraft.wasteType?.toLowerCase().includes("hazardous") && (
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    Select &quot;Treated Hazardous Waste&quot; as Waste Type to
                    enable this field.
                  </Text>
                )}
              </Form.Item>
            </Col>
          </Row>
        </div>

        {/* ── Section 5: Additional Fields (if any) ── */}
        {extraTransportFields.length > 0 && (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "linear-gradient(90deg, #003a8c 0%, #0050b3 100%)",
                borderRadius: "8px 8px 0 0",
                padding: "9px 16px",
              }}
            >
              <ContainerOutlined style={{ color: "#fff", fontSize: 14 }} />
              <Text
                strong
                style={{ color: "#fff", fontSize: 13, letterSpacing: 0.3 }}
              >
                Additional Fields
              </Text>
            </div>
            <div
              style={{
                background: "#f0f5ff",
                border: "1px solid #adc6ff",
                borderTop: "none",
                borderRadius: "0 0 8px 8px",
                padding: "16px 16px 4px",
              }}
            >
              <Row gutter={[12, 0]}>
                {extraTransportFields.map((f) => (
                  <Col xs={24} sm={12} key={f.fieldKey}>
                    <Form.Item
                      label={f.fieldName}
                      required={f.required}
                      {...fieldErr(f.fieldKey)}
                    >
                      {f.fieldType === "number" ? (
                        <InputNumber
                          placeholder={f.fieldName}
                          style={{ width: "100%" }}
                          min={0}
                          step={0.01}
                          value={truckDraft[f.fieldKey]}
                          onChange={(v) => updateTruckDraft(f.fieldKey, v)}
                        />
                      ) : f.fieldType === "select" ? (
                        <Select
                          placeholder={`Select ${f.fieldName}`}
                          value={truckDraft[f.fieldKey] || undefined}
                          onChange={(v) => updateTruckDraft(f.fieldKey, v)}
                          allowClear
                        >
                          {(f.options || []).map((o) => (
                            <Option key={o} value={o}>
                              {o}
                            </Option>
                          ))}
                        </Select>
                      ) : f.fieldType === "date" ? (
                        <DatePicker
                          style={{ width: "100%" }}
                          value={truckDraft[f.fieldKey]}
                          onChange={(v) => updateTruckDraft(f.fieldKey, v)}
                        />
                      ) : f.fieldType === "textarea" ? (
                        <TextArea
                          rows={2}
                          placeholder={f.fieldName}
                          value={truckDraft[f.fieldKey]}
                          onChange={(e) =>
                            updateTruckDraft(f.fieldKey, e.target.value)
                          }
                        />
                      ) : (
                        <Input
                          placeholder={f.fieldName}
                          value={truckDraft[f.fieldKey]}
                          onChange={(e) =>
                            updateTruckDraft(f.fieldKey, e.target.value)
                          }
                        />
                      )}
                    </Form.Item>
                  </Col>
                ))}
              </Row>
            </div>
          </>
        )}
      </Modal>

      {/* ── Submission Detail Modal ── */}
      <Modal
        title={null}
        open={!!historyDetailModal}
        onCancel={() => setHistoryDetailModal(null)}
        footer={null}
        width={900}
        destroyOnHidden
        styles={{ body: { padding: 0 } }}
        closeIcon={
          <span
            style={{
              color: "#fff",
              fontSize: 18,
              fontWeight: 700,
              position: "relative",
              zIndex: 1,
            }}
          >
            ✕
          </span>
        }
      >
        {historyDetailModal &&
          (() => {
            const d = historyDetailModal;
            const totalVolume = (d.trucks || []).reduce(
              (s, t) => s + (t.actualVolume || 0),
              0,
            );
            const sectionTitle = (icon, text) => (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 16,
                }}
              >
                <span style={{ fontSize: 15, color: "#1a3353" }}>{icon}</span>
                <Text
                  strong
                  style={{ fontSize: 14, color: "#1a3353", letterSpacing: 0.3 }}
                >
                  {text}
                </Text>
              </div>
            );
            const fieldRow = (label, value, opts = {}) => (
              <Col
                xs={opts.span === 2 ? 24 : 12}
                sm={opts.span === 2 ? 24 : 12}
                key={label}
              >
                <div style={{ marginBottom: 14 }}>
                  <Text
                    type="secondary"
                    style={{
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                      display: "block",
                      marginBottom: 2,
                    }}
                  >
                    {label}
                  </Text>
                  <div
                    style={{ fontSize: 13, fontWeight: 600, color: "#262626" }}
                  >
                    {value || "—"}
                  </div>
                </div>
              </Col>
            );
            return (
              <div>
                {/* Header Banner */}
                <div
                  style={{
                    background:
                      "linear-gradient(135deg, #0e1e35 0%, #1a3353 100%)",
                    padding: "24px 28px 20px",
                    paddingRight: 48,
                    borderRadius: "8px 8px 0 0",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                    }}
                  >
                    <div>
                      <Text
                        style={{
                          color: "rgba(255,255,255,0.6)",
                          fontSize: 11,
                          textTransform: "uppercase",
                          letterSpacing: 1,
                        }}
                      >
                        Submission Details
                      </Text>
                      <div style={{ marginTop: 4 }}>
                        <Text
                          style={{
                            color: "#fff",
                            fontSize: 20,
                            fontWeight: 700,
                            letterSpacing: 0.5,
                          }}
                        >
                          {d.idNo}
                        </Text>
                      </div>
                      <Text
                        style={{
                          color: "rgba(255,255,255,0.7)",
                          fontSize: 12,
                          marginTop: 4,
                          display: "block",
                        }}
                      >
                        {d.lguCompanyName} &middot;{" "}
                        {d.dateOfDisposal
                          ? dayjs(d.dateOfDisposal).format("MMMM D, YYYY")
                          : "No date"}
                      </Text>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      {renderStatusTag(d.status, d)}
                      <div style={{ marginTop: 8 }}>
                        <Text
                          style={{
                            color: "rgba(255,255,255,0.5)",
                            fontSize: 11,
                          }}
                        >
                          Submitted{" "}
                          {dayjs(d.createdAt).format("MMM D, YYYY h:mm A")}
                        </Text>
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ padding: "24px 28px" }}>
                  {/* Summary Stats Bar */}
                  <Row gutter={16} style={{ marginBottom: 24 }}>
                    <Col xs={8}>
                      <div
                        style={{
                          background: "#f0f5ff",
                          borderRadius: 8,
                          padding: "12px 16px",
                          border: "1px solid #d6e4ff",
                          minHeight: 72,
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between",
                        }}
                      >
                        <Text
                          type="secondary"
                          style={{
                            fontSize: 11,
                            textTransform: "uppercase",
                            letterSpacing: 0.5,
                          }}
                        >
                          Company Type
                        </Text>
                        <div style={{ marginTop: 4 }}>
                          <Tag
                            color={d.companyType === "LGU" ? "blue" : "green"}
                            style={{ margin: 0, fontWeight: 600 }}
                          >
                            {d.companyType}
                          </Tag>
                        </div>
                      </div>
                    </Col>
                    <Col xs={8}>
                      <div
                        style={{
                          background: "#f6ffed",
                          borderRadius: 8,
                          padding: "12px 16px",
                          border: "1px solid #d9f7be",
                          minHeight: 72,
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between",
                        }}
                      >
                        <Text
                          type="secondary"
                          style={{
                            fontSize: 11,
                            textTransform: "uppercase",
                            letterSpacing: 0.5,
                          }}
                        >
                          Truck Entries
                        </Text>
                        <div style={{ marginTop: 4 }}>
                          <Text
                            strong
                            style={{ fontSize: 18, color: "#52c41a" }}
                          >
                            {d.trucks?.length || 0}
                          </Text>
                        </div>
                      </div>
                    </Col>
                    <Col xs={8}>
                      <div
                        style={{
                          background: "#fff7e6",
                          borderRadius: 8,
                          padding: "12px 16px",
                          border: "1px solid #ffe7ba",
                          minHeight: 72,
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between",
                        }}
                      >
                        <Text
                          type="secondary"
                          style={{
                            fontSize: 11,
                            textTransform: "uppercase",
                            letterSpacing: 0.5,
                          }}
                        >
                          Total Volume
                        </Text>
                        <div style={{ marginTop: 4 }}>
                          <Text
                            strong
                            style={{ fontSize: 18, color: "#fa8c16" }}
                          >
                            {totalVolume > 0
                              ? totalVolume.toLocaleString()
                              : "0"}
                          </Text>{" "}
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            tons
                          </Text>
                        </div>
                      </div>
                    </Col>
                  </Row>

                  <Collapse
                    defaultActiveKey={["company", "transport"]}
                    bordered={false}
                    size="small"
                    style={{ background: "transparent" }}
                    items={[
                      {
                        key: "company",
                        label: (
                          <Text strong style={{ fontSize: 13 }}>
                            <EnvironmentOutlined
                              style={{ color: "#1a3353", marginRight: 6 }}
                            />
                            Company & Disposal Information
                          </Text>
                        ),
                        children: (
                          <Row gutter={16}>
                            {fieldRow("Company / LGU Name", d.lguCompanyName)}
                            {fieldRow(
                              "Company Type",
                              <Tag
                                color={
                                  d.companyType === "LGU" ? "blue" : "green"
                                }
                                bordered={false}
                              >
                                {d.companyType}
                              </Tag>,
                            )}
                            {fieldRow("Address", d.address, { span: 2 })}
                            {fieldRow(
                              "Date of Disposal",
                              d.dateOfDisposal
                                ? dayjs(d.dateOfDisposal).format("MMMM D, YYYY")
                                : null,
                            )}
                            {fieldRow(
                              "Submission ID",
                              <Text
                                copyable
                                style={{
                                  fontSize: 12,
                                  fontFamily: "monospace",
                                }}
                              >
                                {d.submissionId || "—"}
                              </Text>,
                            )}
                          </Row>
                        ),
                      },
                      {
                        key: "baseline",
                        label: (
                          <Text strong style={{ fontSize: 13 }}>
                            <DatabaseOutlined
                              style={{ color: "#1a3353", marginRight: 6 }}
                            />
                            Baseline Data
                          </Text>
                        ),
                        children: (
                          <Row gutter={16}>
                            {fieldRow(
                              "Total Volume Accepted",
                              d.totalVolumeAccepted != null
                                ? `${d.totalVolumeAccepted.toLocaleString()} ${(d.totalVolumeAcceptedUnit || "m³").replace("m3", "m³")}`
                                : null,
                            )}
                            {fieldRow(
                              "Active Cell — Residual",
                              d.activeCellResidualVolume != null
                                ? `${d.activeCellResidualVolume.toLocaleString()} ${(d.activeCellResidualUnit || "m³").replace("m3", "m³")}`
                                : null,
                            )}
                            {fieldRow(
                              "Active Cell — Inert",
                              d.activeCellInertVolume != null
                                ? `${d.activeCellInertVolume.toLocaleString()} ${(d.activeCellInertUnit || "m³").replace("m3", "m³")}`
                                : null,
                            )}
                            {d.acceptsHazardousWaste &&
                              fieldRow(
                                "Active Cell — Hazardous",
                                d.activeCellHazardousVolume != null
                                  ? `${d.activeCellHazardousVolume.toLocaleString()} ${(d.activeCellHazardousUnit || "m³").replace("m3", "m³")}`
                                  : null,
                              )}
                            {fieldRow(
                              "Closed Cell — Residual",
                              d.closedCellResidualVolume != null
                                ? `${d.closedCellResidualVolume.toLocaleString()} ${(d.closedCellResidualUnit || "m³").replace("m3", "m³")}`
                                : null,
                            )}
                            {fieldRow(
                              "Closed Cell — Inert",
                              d.closedCellInertVolume != null
                                ? `${d.closedCellInertVolume.toLocaleString()} ${(d.closedCellInertUnit || "m³").replace("m3", "m³")}`
                                : null,
                            )}
                            {d.acceptsHazardousWaste &&
                              fieldRow(
                                "Closed Cell — Hazardous",
                                d.closedCellHazardousVolume != null
                                  ? `${d.closedCellHazardousVolume.toLocaleString()} ${(d.closedCellHazardousUnit || "m³").replace("m3", "m³")}`
                                  : null,
                              )}
                          </Row>
                        ),
                      },
                      {
                        key: "operations",
                        label: (
                          <Text strong style={{ fontSize: 13 }}>
                            <PieChartOutlined
                              style={{ color: "#13c2c2", marginRight: 6 }}
                            />
                            Cell Capacity
                          </Text>
                        ),
                        children: (() => {
                          const fac = d.slfGenerator || {};
                          const facilityCapacity = fac.volumeCapacity || 0;
                          const baselineVol = d.totalVolumeAccepted || 0;
                          const truckVol = (d.trucks || []).reduce(
                            (s, t) => s + (t.actualVolume || 0),
                            0,
                          );
                          const filledVol = baselineVol + truckVol;
                          const pct =
                            facilityCapacity > 0
                              ? Math.min(
                                  Math.round(
                                    (filledVol / facilityCapacity) * 100,
                                  ),
                                  100,
                                )
                              : 0;
                          return (
                            <div>
                              <Row gutter={16}>
                                {fieldRow(
                                  "Current Cell Volume",
                                  d.currentCellVolume != null
                                    ? `${d.currentCellVolume.toLocaleString()} ${(d.currentCellVolumeUnit || "m³").replace("m3", "m³")}`
                                    : null,
                                )}
                                {fieldRow(
                                  "Cell Status",
                                  <Tag
                                    color={
                                      d.cellStatus === "Closed"
                                        ? "red"
                                        : "green"
                                    }
                                    bordered={false}
                                  >
                                    {d.cellStatus || "Active"}
                                  </Tag>,
                                )}
                                {fieldRow(
                                  "Number of Cells",
                                  fac.numberOfCell || "—",
                                )}
                                {fieldRow(
                                  "Facility Capacity",
                                  facilityCapacity > 0
                                    ? `${facilityCapacity.toLocaleString()} m³`
                                    : "—",
                                )}
                              </Row>
                              <Divider style={{ margin: "4px 0 16px" }} />
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 24,
                                }}
                              >
                                <Progress
                                  type="dashboard"
                                  percent={pct}
                                  size={110}
                                  strokeColor={
                                    pct >= 90
                                      ? "#ff4d4f"
                                      : pct >= 70
                                        ? "#faad14"
                                        : "#52c41a"
                                  }
                                  format={() => (
                                    <div
                                      style={{
                                        textAlign: "center",
                                        lineHeight: 1.3,
                                      }}
                                    >
                                      <div
                                        style={{
                                          fontSize: 18,
                                          fontWeight: 700,
                                          color:
                                            pct >= 90
                                              ? "#ff4d4f"
                                              : pct >= 70
                                                ? "#faad14"
                                                : "#52c41a",
                                        }}
                                      >
                                        {pct}%
                                      </div>
                                      <div
                                        style={{
                                          fontSize: 10,
                                          color: "#8c8c8c",
                                        }}
                                      >
                                        filled
                                      </div>
                                    </div>
                                  )}
                                />
                                <div style={{ flex: 1 }}>
                                  <Text
                                    strong
                                    style={{
                                      fontSize: 13,
                                      display: "block",
                                      marginBottom: 8,
                                    }}
                                  >
                                    Cell Capacity Usage
                                  </Text>
                                  <Row gutter={8}>
                                    <Col xs={12}>
                                      <Text
                                        type="secondary"
                                        style={{ fontSize: 11 }}
                                      >
                                        Baseline Volume
                                      </Text>
                                      <div>
                                        <Text style={{ fontSize: 13 }}>
                                          {baselineVol > 0
                                            ? `${baselineVol.toLocaleString()} ${(d.totalVolumeAcceptedUnit || "m³").replace("m3", "m³")}`
                                            : "0"}
                                        </Text>
                                      </div>
                                    </Col>
                                    <Col xs={12}>
                                      <Text
                                        type="secondary"
                                        style={{ fontSize: 11 }}
                                      >
                                        Transport & Disposal
                                      </Text>
                                      <div>
                                        <Text style={{ fontSize: 13 }}>
                                          {truckVol > 0
                                            ? `${truckVol.toLocaleString()} tons`
                                            : "0"}
                                        </Text>
                                      </div>
                                    </Col>
                                    <Col xs={12}>
                                      <Text
                                        type="secondary"
                                        style={{
                                          fontSize: 11,
                                          marginTop: 8,
                                          display: "block",
                                        }}
                                      >
                                        Total Filled
                                      </Text>
                                      <div>
                                        <Text
                                          strong
                                          style={{
                                            fontSize: 14,
                                            color: "#1a3353",
                                          }}
                                        >
                                          {filledVol > 0
                                            ? filledVol.toLocaleString()
                                            : "0"}
                                        </Text>
                                      </div>
                                    </Col>
                                    <Col xs={12}>
                                      <Text
                                        type="secondary"
                                        style={{
                                          fontSize: 11,
                                          marginTop: 8,
                                          display: "block",
                                        }}
                                      >
                                        Remaining
                                      </Text>
                                      <div>
                                        <Text
                                          strong
                                          style={{
                                            fontSize: 14,
                                            color:
                                              facilityCapacity - filledVol <= 0
                                                ? "#ff4d4f"
                                                : "#52c41a",
                                          }}
                                        >
                                          {facilityCapacity > 0
                                            ? (
                                                facilityCapacity - filledVol
                                              ).toLocaleString()
                                            : "No capacity set"}
                                        </Text>
                                      </div>
                                    </Col>
                                  </Row>
                                </div>
                              </div>
                            </div>
                          );
                        })(),
                      },
                      ...(d.accreditedHaulers?.length > 0
                        ? [
                            {
                              key: "haulers",
                              label: (
                                <Text strong style={{ fontSize: 13 }}>
                                  <TeamOutlined
                                    style={{ color: "#1a3353", marginRight: 6 }}
                                  />
                                  Accredited Haulers (
                                  {d.accreditedHaulers.length})
                                </Text>
                              ),
                              children: (
                                <div
                                  style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 10,
                                  }}
                                >
                                  {d.accreditedHaulers.map((h, i) => {
                                    const clients = Array.isArray(
                                      h.privateSectorClients,
                                    )
                                      ? h.privateSectorClients
                                      : h.privateSectorClients
                                        ? [h.privateSectorClients]
                                        : [];
                                    const vehicles =
                                      h.vehicles?.length > 0
                                        ? h.vehicles
                                        : h.plateNumber ||
                                            h.vehicleType ||
                                            h.capacity != null
                                          ? [
                                              {
                                                plateNumber: h.plateNumber,
                                                vehicleType: h.vehicleType,
                                                capacity: h.capacity,
                                                capacityUnit: h.capacityUnit,
                                              },
                                            ]
                                          : [];
                                    return (
                                      <div
                                        key={i}
                                        style={{
                                          background: "#fff",
                                          borderRadius: 6,
                                          padding: "14px 16px",
                                          border: "1px solid #e8e8e8",
                                        }}
                                      >
                                        <div
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 8,
                                            marginBottom: 10,
                                          }}
                                        >
                                          <div
                                            style={{
                                              width: 24,
                                              height: 24,
                                              borderRadius: "50%",
                                              background: "#1a3353",
                                              color: "#fff",
                                              display: "flex",
                                              alignItems: "center",
                                              justifyContent: "center",
                                              fontSize: 11,
                                              fontWeight: 700,
                                            }}
                                          >
                                            {i + 1}
                                          </div>
                                          <Text strong style={{ fontSize: 13 }}>
                                            {h.haulerName || "Unnamed Hauler"}
                                          </Text>
                                        </div>
                                        <Row gutter={16}>
                                          {fieldRow(
                                            "No. of Trucks",
                                            h.numberOfTrucks ?? "—",
                                          )}
                                          {fieldRow(
                                            "Office Address",
                                            h.officeAddress || "—",
                                            { span: 2 },
                                          )}
                                          {fieldRow(
                                            "Private Sector/LGU Clients",
                                            clients.length > 0
                                              ? clients.join(", ")
                                              : "—",
                                            { span: 2 },
                                          )}
                                        </Row>
                                        {vehicles.length > 0 && (
                                          <Table
                                            dataSource={vehicles}
                                            rowKey={(_, vi) => vi}
                                            size="small"
                                            pagination={false}
                                            style={{ marginTop: 8 }}
                                            columns={[
                                              {
                                                title: "#",
                                                key: "idx",
                                                width: 40,
                                                render: (_, __, vi) => vi + 1,
                                              },
                                              {
                                                title: "Plate Number",
                                                dataIndex: "plateNumber",
                                                key: "plate",
                                                render: (v) => v || "—",
                                              },
                                              {
                                                title: "Vehicle Type",
                                                dataIndex: "vehicleType",
                                                key: "type",
                                                render: (v) => v || "—",
                                              },
                                              {
                                                title: "Capacity",
                                                key: "cap",
                                                render: (_, v) =>
                                                  v.capacity != null
                                                    ? `${v.capacity} ${(v.capacityUnit || "m³").replace("m3", "m³")}`
                                                    : "—",
                                              },
                                            ]}
                                          />
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              ),
                            },
                          ]
                        : []),
                      {
                        key: "transport",
                        label: (
                          <Text strong style={{ fontSize: 13 }}>
                            <CarOutlined
                              style={{ color: "#1a3353", marginRight: 6 }}
                            />
                            Transport & Disposal ({(d.trucks || []).length}{" "}
                            entries)
                          </Text>
                        ),
                        children:
                          (d.trucks || []).length > 0 ? (
                            <Table
                              dataSource={d.trucks}
                              rowKey={(_, i) => i}
                              size="small"
                              pagination={false}
                              columns={[
                                {
                                  title: "#",
                                  key: "idx",
                                  width: 40,
                                  render: (_, __, i) => (
                                    <Text type="secondary">{i + 1}</Text>
                                  ),
                                },
                                {
                                  title: "Ticket No.",
                                  dataIndex: "disposalTicketNo",
                                  key: "ticket",
                                  render: (v) => v || "—",
                                },
                                {
                                  title: "Hauler",
                                  dataIndex: "hauler",
                                  key: "hauler",
                                  render: (v) => <Text strong>{v || "—"}</Text>,
                                },
                                {
                                  title: "Plate No.",
                                  dataIndex: "plateNumber",
                                  key: "plate",
                                  render: (v) => v || "—",
                                },
                                {
                                  title: "Capacity",
                                  key: "cap",
                                  render: (_, t) =>
                                    t.truckCapacity
                                      ? `${t.truckCapacity} ${(t.truckCapacityUnit || "m³").replace("m3", "m³")}`
                                      : "—",
                                },
                                {
                                  title: "Volume",
                                  key: "vol",
                                  render: (_, t) =>
                                    t.actualVolume != null ? (
                                      <Text strong style={{ color: "#52c41a" }}>
                                        {t.actualVolume}{" "}
                                        {t.actualVolumeUnit || "tons"}
                                      </Text>
                                    ) : (
                                      "—"
                                    ),
                                },
                                {
                                  title: "Waste Type",
                                  dataIndex: "wasteType",
                                  key: "waste",
                                  render: (v) =>
                                    v ? (
                                      <Tag
                                        color={
                                          v === "Residual" ? "blue" : "volcano"
                                        }
                                        bordered={false}
                                      >
                                        {v}
                                      </Tag>
                                    ) : (
                                      "—"
                                    ),
                                },
                                {
                                  title: "HW Code",
                                  key: "hw",
                                  render: (_, t) => {
                                    const codes = Array.isArray(t.hazWasteCode)
                                      ? t.hazWasteCode
                                      : t.hazWasteCode
                                        ? [t.hazWasteCode]
                                        : [];
                                    return codes.length > 0
                                      ? codes.join(", ")
                                      : "—";
                                  },
                                },
                              ]}
                            />
                          ) : (
                            <div
                              style={{ textAlign: "center", padding: "20px 0" }}
                            >
                              <Text type="secondary">
                                No transport entries recorded.
                              </Text>
                            </div>
                          ),
                      },
                    ]}
                  />

                  {/* Revert Info Banner */}
                  {d.status === "reverted" && d.revertReason && (
                    <div
                      style={{
                        background: "#fff2e8",
                        border: "1px solid #ffbb96",
                        borderRadius: 8,
                        padding: "12px 16px",
                        marginTop: 20,
                      }}
                    >
                      <Space align="start">
                        <UndoOutlined
                          style={{ color: "#fa541c", marginTop: 2 }}
                        />
                        <div>
                          <Text
                            strong
                            style={{ color: "#fa541c", fontSize: 13 }}
                          >
                            Reverted by Administrator
                          </Text>
                          <div style={{ marginTop: 4 }}>
                            <Text style={{ fontSize: 12, color: "#8c8c8c" }}>
                              Reason: {d.revertReason}
                            </Text>
                          </div>
                          {d.revertedAt && (
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              {dayjs(d.revertedAt).format("MMM D, YYYY h:mm A")}
                            </Text>
                          )}
                        </div>
                      </Space>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
      </Modal>

      {/* ── Review Submission Modal ── */}
      <Modal
        title={
          <Space>
            <EyeOutlined style={{ color: "#1a3353" }} />
            <span>
              {editingRevertedId ? "Review Resubmission" : "Review Submission"}
            </span>
          </Space>
        }
        open={reviewModalOpen}
        onCancel={() => setReviewModalOpen(false)}
        onOk={editingRevertedId ? handleResubmitReverted : handleConfirmSubmit}
        okText={editingRevertedId ? "Confirm & Resubmit" : "Confirm & Submit"}
        okButtonProps={{
          className: "slf-primary-btn",
          loading,
          icon: <SendOutlined />,
        }}
        cancelText="Go Back"
        width={860}
        destroyOnHidden
      >
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
            Please review all information below before confirming your
            submission.
          </Text>
        </div>
        {editingRevertedId && (
          <div style={{ marginBottom: 16 }}>
            <Text
              strong
              style={{ display: "block", marginBottom: 6, fontSize: 13 }}
            >
              <MessageOutlined style={{ marginRight: 6 }} />
              Comment / Message (optional)
            </Text>
            <Input.TextArea
              rows={3}
              maxLength={500}
              showCount
              placeholder="Add a comment about the changes you made or any message for the admin..."
              value={resubmitComment}
              onChange={(e) => setResubmitComment(e.target.value)}
              style={{ borderRadius: 6 }}
            />
          </div>
        )}
        <Collapse
          defaultActiveKey={[
            "company",
            "baseline",
            "disposal",
            "haulers",
            "transport",
          ]}
          bordered={false}
          expandIconPlacement="end"
          style={{ background: "transparent" }}
          items={[
            {
              key: "company",
              label: (
                <Text strong style={{ color: "#1a3353" }}>
                  <EnvironmentOutlined /> Company Information
                </Text>
              ),
              children: (
                <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
                  <Descriptions.Item label="Company Name">
                    {companyForm.getFieldValue("lguCompanyName") || "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label="Region">
                    {regions.find(
                      (r) =>
                        r.code === companyForm.getFieldValue("companyRegion"),
                    )?.name || "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label="Province">
                    {provinces.find(
                      (p) =>
                        p.code === companyForm.getFieldValue("companyProvince"),
                    )?.name || "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label="City/Municipality">
                    {municipalities.find(
                      (m) =>
                        m.code ===
                        companyForm.getFieldValue("companyMunicipality"),
                    )?.name || "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label="Barangay">
                    {barangays.find(
                      (b) =>
                        b.code === companyForm.getFieldValue("companyBarangay"),
                    )?.name || "—"}
                  </Descriptions.Item>
                </Descriptions>
              ),
            },
            {
              key: "disposal",
              label: (
                <Text strong style={{ color: "#1a3353" }}>
                  <FileTextOutlined /> Waste Generator&apos;s Information
                </Text>
              ),
              children: (
                <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
                  <Descriptions.Item label="Date of Disposal">
                    {entryForm.getFieldValue("dateOfDisposal")
                      ? dayjs(entryForm.getFieldValue("dateOfDisposal")).format(
                          "MM/DD/YYYY",
                        )
                      : "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label="LGU/Company Name">
                    {trucks[0]?.lguCompanyName || "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label="Company Type">
                    {trucks[0]?.companyType || "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label="Address">
                    {trucks[0]?.address || "—"}
                  </Descriptions.Item>
                </Descriptions>
              ),
            },
            {
              key: "baseline",
              label: (
                <Text strong style={{ color: "#1a3353" }}>
                  <DatabaseOutlined /> Baseline Data
                  {!baselineSaved && (
                    <Tag
                      color="volcano"
                      style={{ marginLeft: 8, fontSize: 10 }}
                    >
                      First-time Entry
                    </Tag>
                  )}
                </Text>
              ),
              children: (
                <>
                  {!baselineSaved && (
                    <div
                      style={{
                        background: "#fff7e6",
                        border: "1px solid #ffe58f",
                        borderRadius: 6,
                        padding: "8px 14px",
                        marginBottom: 12,
                      }}
                    >
                      <InfoCircleOutlined
                        style={{ color: "#fa8c16", marginRight: 8 }}
                      />
                      <Text style={{ color: "#ad6800", fontSize: 12 }}>
                        This baseline data will be{" "}
                        <Text strong style={{ color: "#ad6800" }}>
                          locked after submission
                        </Text>{" "}
                        and cannot be changed without requesting an update.
                        Please verify all details carefully.
                      </Text>
                    </div>
                  )}
                  <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
                    <Descriptions.Item label="Total Volume Accepted">
                      {baselineForm.getFieldValue("totalVolumeAccepted") != null
                        ? `${Number(baselineForm.getFieldValue("totalVolumeAccepted")).toLocaleString()} ${(baselineForm.getFieldValue("totalVolumeAcceptedUnit") || "m³").replace("m3", "m³")}`
                        : "—"}
                    </Descriptions.Item>
                    <Descriptions.Item label="Active Cell Entries" span={2}>
                      {activeCellEntries.length === 0 ? (
                        "—"
                      ) : (
                        <Table
                          dataSource={activeCellEntries}
                          rowKey="key"
                          size="small"
                          pagination={false}
                          style={{ marginTop: 4 }}
                          columns={[
                            {
                              title: "Cell Name",
                              dataIndex: "cellName",
                              key: "cellName",
                              render: (v) => v || "—",
                            },
                            {
                              title: "Waste Type",
                              dataIndex: "wasteType",
                              key: "wasteType",
                            },
                            {
                              title: "Volume",
                              key: "vol",
                              render: (_, r) =>
                                r.volume != null
                                  ? `${r.volume} ${baselineUnit || "m³"}`
                                  : "—",
                            },
                          ]}
                        />
                      )}
                    </Descriptions.Item>
                    <Descriptions.Item label="Closed Cell Entries" span={2}>
                      {closedCellEntries.length === 0 ? (
                        "—"
                      ) : (
                        <Table
                          dataSource={closedCellEntries}
                          rowKey="key"
                          size="small"
                          pagination={false}
                          style={{ marginTop: 4 }}
                          columns={[
                            {
                              title: "Cell Name",
                              dataIndex: "cellName",
                              key: "cellName",
                              render: (v) => v || "—",
                            },
                            {
                              title: "Waste Type",
                              dataIndex: "wasteType",
                              key: "wasteType",
                            },
                            {
                              title: "Volume",
                              key: "vol",
                              render: (_, r) =>
                                r.volume != null
                                  ? `${r.volume} ${baselineUnit || "m³"}`
                                  : "—",
                            },
                          ]}
                        />
                      )}
                    </Descriptions.Item>
                  </Descriptions>
                </>
              ),
            },
            ...(haulers.length > 0
              ? [
                  {
                    key: "haulers",
                    label: (
                      <Text strong style={{ color: "#1a3353" }}>
                        <TeamOutlined /> Accredited Haulers ({haulers.length})
                      </Text>
                    ),
                    children: (
                      <Table
                        dataSource={haulers}
                        rowKey="key"
                        size="small"
                        pagination={false}
                        scroll={{ x: 500 }}
                        columns={[
                          {
                            title: "Hauler",
                            dataIndex: "haulerName",
                          },
                          {
                            title: "Trucks",
                            dataIndex: "numberOfTrucks",
                            width: 70,
                          },
                          {
                            title: "Vehicles",
                            key: "vehicles",
                            render: (_, rec) => {
                              const vehs = rec.vehicles || [];
                              if (!vehs.length) return "—";
                              return vehs.map((v, i) => (
                                <div key={i} style={{ whiteSpace: "nowrap" }}>
                                  {v.plateNumber || "N/A"} —{" "}
                                  {v.vehicleType || "N/A"} ({v.capacity ?? "—"}{" "}
                                  {v.capacityUnit || "m³"})
                                </div>
                              ));
                            },
                          },
                          {
                            title: "Clients",
                            dataIndex: "privateSectorClients",
                            render: (v) => {
                              const arr = Array.isArray(v) ? v : v ? [v] : [];
                              return arr.length > 0 ? arr.join(", ") : "—";
                            },
                          },
                        ]}
                      />
                    ),
                  },
                ]
              : []),
            {
              key: "transport",
              label: (
                <Text strong style={{ color: "#1a3353" }}>
                  <CarOutlined /> Transport Entries ({trucks.length})
                </Text>
              ),
              children: (
                <Table
                  dataSource={trucks}
                  rowKey="key"
                  size="small"
                  pagination={false}
                  scroll={{ x: 700 }}
                  columns={[
                    {
                      title: "#",
                      key: "i",
                      width: 40,
                      render: (_, __, i) => i + 1,
                    },
                    {
                      title: "Ticket No.",
                      dataIndex: "disposalTicketNo",
                      render: (v) => v || "—",
                    },
                    { title: "Hauler", dataIndex: "hauler" },
                    {
                      title: "Plate No.",
                      key: "plateNumber",
                      render: (_, t) => {
                        const vehs = t.vehicles || [];
                        if (vehs.length > 1)
                          return (
                            vehs
                              .map((v) => v.plateNumber)
                              .filter(Boolean)
                              .join(", ") ||
                            t.plateNumber ||
                            "—"
                          );
                        return vehs[0]?.plateNumber || t.plateNumber || "—";
                      },
                    },
                    {
                      title: "Capacity",
                      key: "cap",
                      render: (_, t) => {
                        const vehs = t.vehicles || [];
                        if (vehs.length > 1)
                          return (
                            vehs
                              .filter((v) => v.capacity != null)
                              .map(
                                (v) =>
                                  `${v.capacity} ${(v.capacityUnit || "m³").replace("m3", "m³")}`,
                              )
                              .join(", ") || "—"
                          );
                        const cap = vehs[0]?.capacity ?? t.truckCapacity;
                        const unit =
                          vehs[0]?.capacityUnit || t.truckCapacityUnit || "m³";
                        return cap != null
                          ? `${cap} ${unit.replace("m3", "m³")}`
                          : "—";
                      },
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
                      render: (v) => v || "—",
                    },
                    {
                      title: "Haz. Code",
                      dataIndex: "hazWasteCode",
                      render: (v) => v || "—",
                    },
                    {
                      title: "Clients",
                      key: "clients",
                      render: (_, t) => {
                        const vehs = t.vehicles || [];
                        const allClients = vehs.flatMap(
                          (v) => v.selectedClients || [],
                        );
                        if (!allClients.length) return "—";
                        return allClients.map((c, i) => (
                          <Tag
                            key={i}
                            color={c.clientType === "LGU" ? "blue" : "green"}
                            style={{ marginBottom: 2, fontSize: 11 }}
                          >
                            {typeof c === "object" ? c.clientName : c}
                          </Tag>
                        ));
                      },
                    },
                  ]}
                />
              ),
            },
          ]}
        />
      </Modal>

      {/* ── Revert Request Modal ── */}
      <Modal
        title={
          <Space>
            <UndoOutlined style={{ color: "#fa8c16" }} />
            <span>Request Edit — {revertRecord?.idNo}</span>
          </Space>
        }
        open={revertModalOpen}
        onCancel={() => {
          setRevertModalOpen(false);
          setRevertRecord(null);
          setRevertReason("");
        }}
        onOk={handleRequestRevert}
        okText="Submit Request"
        okButtonProps={{
          className: "slf-primary-btn",
          loading: revertLoading,
          disabled: !revertReason.trim(),
        }}
        destroyOnHidden
        width={500}
      >
        <Text style={{ display: "block", marginBottom: 12 }}>
          Please state the reason for requesting changes on this approved
          submission. You may also send an email to{" "}
          <Text strong>emb_region3@emb.gov.ph</Text> for follow-up.
        </Text>
        <TextArea
          rows={4}
          placeholder="Describe the changes you need to make..."
          value={revertReason}
          onChange={(e) => setRevertReason(e.target.value)}
          maxLength={500}
          showCount
        />
        <div style={{ marginTop: 12 }}>
          <Button
            type="link"
            icon={<MailOutlined />}
            href="mailto:emb_region3@emb.gov.ph"
            target="_blank"
            style={{ padding: 0 }}
          >
            Email emb_region3@emb.gov.ph
          </Button>
        </div>
      </Modal>

      {/* ── Profile Modal ── */}
      <Modal
        title={
          <Space>
            <UserOutlined style={{ color: "#1a3353" }} />
            <span>My Profile</span>
          </Space>
        }
        open={profileModalOpen}
        onCancel={() => setProfileModalOpen(false)}
        footer={
          <Button onClick={() => setProfileModalOpen(false)}>Close</Button>
        }
        width={480}
        destroyOnHidden
      >
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <Avatar
            size={72}
            style={{
              background: "linear-gradient(135deg, #1a3353, #2d5f8a)",
              fontSize: 28,
              marginBottom: 10,
            }}
          >
            {portalUser?.firstName?.[0]?.toUpperCase()}
          </Avatar>
          <div>
            <Text strong style={{ fontSize: 18 }}>
              {portalUser?.firstName} {portalUser?.lastName}
            </Text>
          </div>
        </div>
        <Descriptions bordered column={1} size="small">
          <Descriptions.Item label="Email">
            {portalUser?.email || "—"}
          </Descriptions.Item>
          {portalUser?.officeEmail && (
            <Descriptions.Item label="Office Email">
              {portalUser.officeEmail}
            </Descriptions.Item>
          )}
          {portalUser?.pcoEmail && (
            <Descriptions.Item label="PCO Email">
              {portalUser.pcoEmail}
            </Descriptions.Item>
          )}
          <Descriptions.Item label="Contact No.">
            {portalUser?.contactNumber || "—"}
          </Descriptions.Item>
          {portalUser?.companyName && (
            <Descriptions.Item label="Company">
              {portalUser.companyName}
            </Descriptions.Item>
          )}
          <Descriptions.Item label="Assigned SLF">
            {Array.isArray(portalUser?.assignedSlfName) &&
            portalUser.assignedSlfName.length > 0 ? (
              portalUser.assignedSlfName.map((name, i) => (
                <Tag key={i} color="blue" style={{ marginBottom: 2 }}>
                  {name}
                </Tag>
              ))
            ) : portalUser?.assignedSlfName ? (
              <Tag color="blue">{portalUser.assignedSlfName}</Tag>
            ) : (
              "—"
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Account Status">
            <Tag
              color={
                portalUser?.status === "approved"
                  ? "green"
                  : portalUser?.status === "pending"
                    ? "orange"
                    : "red"
              }
            >
              {portalUser?.status?.charAt(0).toUpperCase() +
                portalUser?.status?.slice(1) || "—"}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Email Verified">
            {portalUser?.isVerified ? (
              <Tag color="green">Verified</Tag>
            ) : (
              <Tag color="red">Not Verified</Tag>
            )}
          </Descriptions.Item>
        </Descriptions>
      </Modal>

      {/* ── Support & FAQ Floating Button ── */}
      <Button
        type="primary"
        icon={<QuestionCircleOutlined />}
        onClick={() => {
          setSupportDrawerOpen(true);
          if (supportTickets.length === 0) fetchSupportTickets();
        }}
        style={{
          position: "fixed",
          bottom: 32,
          right: 32,
          zIndex: 999,
          height: 48,
          borderRadius: 24,
          fontSize: 15,
          fontWeight: 600,
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "#1a3353",
          borderColor: "#1a3353",
          boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
          paddingInline: 20,
        }}
      >
        Support &amp; FAQ
      </Button>

      {/* ── Support Drawer ── */}
      <Drawer
        title="Support & FAQ"
        placement="right"
        size={isMobile ? "100%" : 520}
        onClose={() => setSupportDrawerOpen(false)}
        open={supportDrawerOpen}
        styles={{ body: { padding: 0 } }}
      >
        <Tabs
          activeKey={supportTab}
          onChange={setSupportTab}
          style={{ padding: "0 16px" }}
          items={[
            {
              key: "faq",
              label: (
                <span>
                  <QuestionCircleOutlined /> FAQ
                </span>
              ),
              children: (
                <Collapse
                  activeKey={faqActiveKey}
                  onChange={setFaqActiveKey}
                  bordered={false}
                  items={[
                    {
                      key: "1",
                      label: "How do I submit disposal data?",
                      children: (
                        <Text>
                          Navigate to Data Entry, fill in all required tabs
                          (Basic Info, Baseline, Waste Generator Info), add at
                          least one transport entry, then click Submit.
                        </Text>
                      ),
                    },
                    {
                      key: "2",
                      label: "How do I update baseline data?",
                      children: (
                        <Text>
                          Baseline data is locked after your first submission.
                          Click &ldquo;Request Update&rdquo; in the Baseline
                          tab. An admin will review and approve your request.
                        </Text>
                      ),
                    },
                    {
                      key: "3",
                      label: "How do I edit a submitted entry?",
                      children: (
                        <Text>
                          Go to History, find the entry, and click
                          &ldquo;Request Edit&rdquo;. The admin will review and
                          either approve or reject your request.
                        </Text>
                      ),
                    },
                    {
                      key: "4",
                      label: "What file formats are supported for upload?",
                      children: (
                        <Text>
                          You can upload Excel (.xlsx, .xls) or CSV files for
                          bulk hauler and waste generator entries.
                        </Text>
                      ),
                    },
                    {
                      key: "5",
                      label: "Who do I contact for technical issues?",
                      children: (
                        <Text>
                          Submit a support ticket using the &ldquo;New
                          Ticket&rdquo; tab, or email emb_region3@emb.gov.ph
                          directly.
                        </Text>
                      ),
                    },
                  ]}
                />
              ),
            },
            {
              key: "new-ticket",
              label: (
                <span>
                  <SendOutlined /> New Ticket
                </span>
              ),
              children: (
                <Form
                  layout="vertical"
                  onFinish={handleSubmitTicket}
                  style={{ padding: "8px 0" }}
                >
                  <Form.Item
                    name="category"
                    label="Category"
                    rules={[{ required: true, message: "Select a category" }]}
                  >
                    <Select placeholder="Select category">
                      <Option value="Technical Issue">Technical Issue</Option>
                      <Option value="Data Correction">Data Correction</Option>
                      <Option value="Account Issue">Account Issue</Option>
                      <Option value="Feature Request">Feature Request</Option>
                      <Option value="Other">Other</Option>
                    </Select>
                  </Form.Item>
                  <Form.Item
                    name="subject"
                    label="Subject"
                    rules={[{ required: true, message: "Enter a subject" }]}
                  >
                    <Input placeholder="Brief description of your concern" />
                  </Form.Item>
                  <Form.Item
                    name="message"
                    label="Message"
                    rules={[
                      { required: true, message: "Describe your concern" },
                    ]}
                  >
                    <Input.TextArea
                      rows={4}
                      placeholder="Detailed description..."
                    />
                  </Form.Item>
                  <Form.Item>
                    <Button
                      type="primary"
                      htmlType="submit"
                      loading={supportSubmitting}
                      className="slf-primary-btn"
                      block
                    >
                      Submit Ticket
                    </Button>
                  </Form.Item>
                </Form>
              ),
            },
            {
              key: "my-tickets",
              label: (
                <span>
                  <FileTextOutlined /> My Tickets
                </span>
              ),
              children: (
                <div style={{ padding: "8px 0" }}>
                  {supportLoading ? (
                    <div style={{ textAlign: "center", padding: 40 }}>
                      <Spin />
                    </div>
                  ) : supportTickets.length === 0 ? (
                    <Empty description="No support tickets yet" />
                  ) : (
                    <List
                      dataSource={supportTickets}
                      renderItem={(ticket) => (
                        <List.Item
                          style={{ cursor: "pointer", padding: "12px 0" }}
                          onClick={() => setSupportDetailModal(ticket)}
                        >
                          <List.Item.Meta
                            title={
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                }}
                              >
                                <Text strong style={{ fontSize: 13 }}>
                                  {ticket.subject}
                                </Text>
                                <Tag
                                  color={
                                    ticket.status === "open"
                                      ? "blue"
                                      : ticket.status === "in_progress"
                                        ? "orange"
                                        : ticket.status === "resolved"
                                          ? "green"
                                          : "default"
                                  }
                                >
                                  {ticket.status
                                    ?.replace("_", " ")
                                    .toUpperCase()}
                                </Tag>
                              </div>
                            }
                            description={
                              <div>
                                <Text type="secondary" style={{ fontSize: 11 }}>
                                  {ticket.ticketNo} &middot; {ticket.category}{" "}
                                  &middot;{" "}
                                  {dayjs(ticket.createdAt).format(
                                    "MMM D, YYYY h:mm A",
                                  )}
                                </Text>
                              </div>
                            }
                          />
                        </List.Item>
                      )}
                    />
                  )}
                </div>
              ),
            },
          ]}
        />
      </Drawer>

      {/* ── Support Ticket Detail Modal ── */}
      <Modal
        title={
          supportDetailModal
            ? `${supportDetailModal.ticketNo} — ${supportDetailModal.subject}`
            : "Ticket Detail"
        }
        open={!!supportDetailModal}
        onCancel={() => {
          setSupportDetailModal(null);
          setSupportReplyText("");
        }}
        footer={null}
        width={600}
      >
        {supportDetailModal && (
          <>
            <Descriptions
              size="small"
              column={1}
              bordered
              style={{ marginBottom: 16 }}
            >
              <Descriptions.Item label="Status">
                <Tag
                  color={
                    supportDetailModal.status === "open"
                      ? "blue"
                      : supportDetailModal.status === "in_progress"
                        ? "orange"
                        : supportDetailModal.status === "resolved"
                          ? "green"
                          : "default"
                  }
                >
                  {supportDetailModal.status?.replace("_", " ").toUpperCase()}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Category">
                {supportDetailModal.category}
              </Descriptions.Item>
              <Descriptions.Item label="Priority">
                <Tag
                  color={
                    supportDetailModal.priority === "Urgent"
                      ? "red"
                      : supportDetailModal.priority === "High"
                        ? "orange"
                        : supportDetailModal.priority === "Medium"
                          ? "gold"
                          : "default"
                  }
                >
                  {supportDetailModal.priority}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Date">
                {dayjs(supportDetailModal.createdAt).format(
                  "MMM D, YYYY h:mm A",
                )}
              </Descriptions.Item>
            </Descriptions>
            <div
              style={{
                background: "#f5f5f5",
                padding: "12px 16px",
                borderRadius: 6,
                marginBottom: 16,
              }}
            >
              <Text>{supportDetailModal.message}</Text>
            </div>
            {supportDetailModal.replies?.length > 0 && (
              <>
                <Divider style={{ margin: "12px 0" }}>Replies</Divider>
                {supportDetailModal.replies.map((r, i) => (
                  <div
                    key={i}
                    style={{
                      background: r.isAdmin ? "#e6f4ff" : "#f6ffed",
                      padding: "10px 14px",
                      borderRadius: 6,
                      marginBottom: 8,
                      borderLeft: `3px solid ${r.isAdmin ? "#1677ff" : "#52c41a"}`,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginBottom: 4,
                      }}
                    >
                      <Text strong style={{ fontSize: 12 }}>
                        {r.isAdmin ? "Admin" : "You"}
                      </Text>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {dayjs(r.createdAt).format("MMM D, h:mm A")}
                      </Text>
                    </div>
                    <Text style={{ fontSize: 13 }}>{r.message}</Text>
                  </div>
                ))}
              </>
            )}
            {supportDetailModal.status !== "closed" &&
              supportDetailModal.status !== "resolved" && (
                <div style={{ marginTop: 12 }}>
                  <Input.TextArea
                    rows={3}
                    placeholder="Type your reply..."
                    value={supportReplyText}
                    onChange={(e) => setSupportReplyText(e.target.value)}
                  />
                  <Button
                    type="primary"
                    className="slf-primary-btn"
                    style={{ marginTop: 8 }}
                    loading={supportSubmitting}
                    disabled={!supportReplyText.trim()}
                    onClick={() => handleSupportReply(supportDetailModal._id)}
                  >
                    Send Reply
                  </Button>
                </div>
              )}
          </>
        )}
      </Modal>

      {/* ── Upload Format Guide Modal ── */}
      <Modal
        title={
          <Space>
            <InfoCircleOutlined style={{ color: "#1677ff" }} />
            <Text strong>
              {uploadGuideType === "hauler"
                ? "Hauler Upload — Format Guide"
                : "Disposal Entry Upload — Format Guide"}
            </Text>
          </Space>
        }
        open={uploadGuideOpen}
        onCancel={() => setUploadGuideOpen(false)}
        onOk={proceedToFilePicker}
        okText={
          <Space>
            <UploadOutlined /> Proceed to Upload
          </Space>
        }
        okButtonProps={{ className: "slf-primary-btn" }}
        cancelText="Cancel"
        width={600}
        destroyOnHidden
      >
        {uploadGuideType === "hauler" ? (
          <div>
            <Text
              type="secondary"
              style={{ display: "block", marginBottom: 12 }}
            >
              Your Excel or CSV file must contain the following columns (in any
              order):
            </Text>
            <Table
              size="small"
              pagination={false}
              dataSource={[
                {
                  col: "Hauler Name",
                  desc: "Full name of the accredited hauler",
                  required: true,
                },
                {
                  col: "Number of Trucks",
                  desc: "Total number of registered trucks",
                  required: true,
                },
                {
                  col: "Office Address",
                  desc: "Office address of the hauler",
                  required: false,
                },
                {
                  col: "Plate Number",
                  desc: "Plate number of the vehicle",
                  required: false,
                },
                {
                  col: "Vehicle Type",
                  desc: "e.g. Dump Truck, Compactor",
                  required: false,
                },
                {
                  col: "Capacity",
                  desc: "Vehicle capacity in m³ or tons",
                  required: false,
                },
              ]}
              columns={[
                {
                  title: "Column Header",
                  dataIndex: "col",
                  width: 180,
                  render: (v) => <Text code>{v}</Text>,
                },
                { title: "Description", dataIndex: "desc" },
                {
                  title: "Required",
                  dataIndex: "required",
                  width: 80,
                  align: "center",
                  render: (v) =>
                    v ? <Tag color="red">Yes</Tag> : <Tag>No</Tag>,
                },
              ]}
              rowKey="col"
            />
            <div
              style={{
                marginTop: 12,
                padding: "8px 12px",
                background: "#fffbe6",
                borderRadius: 6,
                border: "1px solid #ffe58f",
              }}
            >
              <Text style={{ fontSize: 12 }}>
                <InfoCircleOutlined
                  style={{ color: "#faad14", marginRight: 6 }}
                />
                Each row represents one vehicle entry under a hauler. Rows
                sharing the same Hauler Name will be grouped.
              </Text>
            </div>
          </div>
        ) : (
          <div>
            <Text
              type="secondary"
              style={{ display: "block", marginBottom: 12 }}
            >
              Your Excel or CSV file must contain the following columns (in any
              order):
            </Text>
            <Table
              size="small"
              pagination={false}
              dataSource={[
                {
                  col: "Disposal Ticket No",
                  desc: "Unique ticket/reference number",
                  required: true,
                },
                {
                  col: "Hauler Name",
                  desc: "Name of the hauler who transported the waste",
                  required: true,
                },
                {
                  col: "Plate Number",
                  desc: "Plate number of the truck",
                  required: true,
                },
                {
                  col: "Truck Capacity",
                  desc: "Truck capacity in m³ or tons",
                  required: false,
                },
                {
                  col: "Actual Volume",
                  desc: "Actual volume of waste transported",
                  required: true,
                },
                {
                  col: "Waste Type",
                  desc: "e.g. Residual, Hazardous, Mixed",
                  required: true,
                },
              ]}
              columns={[
                {
                  title: "Column Header",
                  dataIndex: "col",
                  width: 180,
                  render: (v) => <Text code>{v}</Text>,
                },
                { title: "Description", dataIndex: "desc" },
                {
                  title: "Required",
                  dataIndex: "required",
                  width: 80,
                  align: "center",
                  render: (v) =>
                    v ? <Tag color="red">Yes</Tag> : <Tag>No</Tag>,
                },
              ]}
              rowKey="col"
            />
            <div
              style={{
                marginTop: 12,
                padding: "8px 12px",
                background: "#fffbe6",
                borderRadius: 6,
                border: "1px solid #ffe58f",
              }}
            >
              <Text style={{ fontSize: 12 }}>
                <InfoCircleOutlined
                  style={{ color: "#faad14", marginRight: 6 }}
                />
                Each row in the file represents one disposal trip. Volume unit
                defaults to <Text code>m³</Text> unless specified.
              </Text>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Upload Preview Modal ── */}
      <Modal
        title="Preview Uploaded Data"
        open={uploadModalOpen}
        onCancel={() => {
          setUploadModalOpen(false);
          setUploadPreviewData([]);
          setUploadPreviewColumns([]);
          setUploadType(null);
        }}
        onOk={handleConfirmUpload}
        okText={`Import ${uploadPreviewData.length} ${uploadType === "hauler" ? "Hauler(s)" : "Entry/Entries"}`}
        okButtonProps={{ className: "slf-primary-btn" }}
        width={900}
      >
        <div style={{ marginBottom: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Review the data below. Click on any cell to edit before importing.
          </Text>
        </div>
        <Table
          dataSource={uploadPreviewData}
          columns={(uploadPreviewColumns || []).map((col) => {
            // keep the row-number (#) and actions columns as-is
            if (!col.dataIndex || col.key === "actions" || col.title === "#")
              return col;
            return {
              ...col,
              render: (text, record) => (
                <Input
                  size="small"
                  value={text ?? ""}
                  onChange={(e) =>
                    updateUploadCell(record.key, col.dataIndex, e.target.value)
                  }
                  style={{
                    border: "none",
                    background: "transparent",
                    padding: "2px 4px",
                  }}
                />
              ),
            };
          })}
          rowKey={(_, i) => i}
          size="small"
          pagination={false}
          scroll={{ x: 700 }}
        />
      </Modal>

      {/* ── Active Cell Entry Modal ── */}
      <Modal
        title={
          editingActiveCellKey != null ? "Edit Cell Entry" : "Add Cell Entry"
        }
        open={activeCellModalOpen}
        onCancel={() => setActiveCellModalOpen(false)}
        onOk={handleSaveActiveCellEntry}
        okText={editingActiveCellKey != null ? "Update" : "Add"}
        okButtonProps={{ className: "slf-primary-btn" }}
        destroyOnHidden
        width={420}
      >
        <Form layout="vertical" requiredMark={false}>
          <Form.Item label="Cell Name" required>
            <Input
              placeholder="e.g. Cell 1"
              value={activeCellDraft.cellName}
              onChange={(e) =>
                setActiveCellDraft((d) => ({ ...d, cellName: e.target.value }))
              }
            />
          </Form.Item>
          <Form.Item label="Waste Type" required>
            <Select
              value={activeCellDraft.wasteType}
              onChange={(v) =>
                setActiveCellDraft((d) => ({ ...d, wasteType: v }))
              }
              options={[
                { label: "Residual", value: "Residual" },
                {
                  label: "Inert/Hazardous Waste",
                  value: "Inert/Hazardous Waste",
                },
              ]}
            />
          </Form.Item>
          <Form.Item label="Volume" required>
            <Space.Compact style={{ width: "100%" }}>
              <InputNumber
                placeholder="Volume"
                style={{ width: "100%" }}
                min={0}
                step={0.01}
                value={activeCellDraft.volume}
                onChange={(v) =>
                  setActiveCellDraft((d) => ({ ...d, volume: v }))
                }
              />
              <span className="ant-input-group-addon">
                {baselineUnit === "m³" ? (
                  <>
                    m<sup>3</sup>
                  </>
                ) : (
                  "tons"
                )}
              </span>
            </Space.Compact>
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Closed Cell Entry Modal ── */}
      <Modal
        title={
          editingClosedCellKey != null
            ? "Edit Closed Cell Entry"
            : "Add Closed Cell Entry"
        }
        open={closedCellModalOpen}
        onCancel={() => setClosedCellModalOpen(false)}
        onOk={handleSaveClosedCellEntry}
        okText={editingClosedCellKey != null ? "Update" : "Add"}
        okButtonProps={{ className: "slf-primary-btn" }}
        destroyOnHidden
        width={420}
      >
        <Form layout="vertical" requiredMark={false}>
          <Form.Item label="Cell Name" required>
            <Input
              placeholder="e.g. Cell 3"
              value={closedCellDraft.cellName}
              onChange={(e) =>
                setClosedCellDraft((d) => ({ ...d, cellName: e.target.value }))
              }
            />
          </Form.Item>
          <Form.Item label="Waste Type" required>
            <Select
              value={closedCellDraft.wasteType}
              onChange={(v) =>
                setClosedCellDraft((d) => ({ ...d, wasteType: v }))
              }
              options={[
                { label: "Residual", value: "Residual" },
                {
                  label: "Inert/Hazardous Waste",
                  value: "Inert/Hazardous Waste",
                },
              ]}
            />
          </Form.Item>
          <Form.Item label="Volume" required>
            <Space.Compact style={{ width: "100%" }}>
              <InputNumber
                placeholder="Volume"
                style={{ width: "100%" }}
                min={0}
                step={0.01}
                value={closedCellDraft.volume}
                onChange={(v) =>
                  setClosedCellDraft((d) => ({ ...d, volume: v }))
                }
              />
              <span className="ant-input-group-addon">
                {baselineUnit === "m³" ? (
                  <>
                    m<sup>3</sup>
                  </>
                ) : (
                  "tons"
                )}
              </span>
            </Space.Compact>
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Hauler Client Modal ── */}
      <Modal
        title={editingClientKey != null ? "Edit Client" : "Add Client"}
        open={clientModalOpen}
        onCancel={() => setClientModalOpen(false)}
        onOk={handleSaveClient}
        okText={editingClientKey != null ? "Update" : "Add"}
        okButtonProps={{ className: "slf-primary-btn" }}
        destroyOnHidden
        width={480}
      >
        <Form layout="vertical" requiredMark={false}>
          <Form.Item label="Client Name" required>
            <Input
              placeholder="Name of LGU / company"
              value={clientDraft.clientName}
              onChange={(e) =>
                setClientDraft((d) => ({ ...d, clientName: e.target.value }))
              }
            />
          </Form.Item>
          <Form.Item label="Client Type" required>
            <Select
              value={clientDraft.clientType}
              onChange={(v) =>
                setClientDraft((d) => ({
                  ...d,
                  clientType: v,
                  region: "",
                  province: "",
                  municipality: "",
                }))
              }
              options={[
                { label: "Private", value: "Private" },
                { label: "LGU", value: "LGU" },
              ]}
            />
          </Form.Item>
          {clientDraft.clientType === "LGU" && (
            <>
              <Form.Item label="Region">
                <Select
                  placeholder="Select region"
                  value={clientDraft.region || undefined}
                  loading={loadingClientAddress === "region"}
                  showSearch
                  optionFilterProp="label"
                  options={(regions || []).map((r) => ({
                    label: r.name,
                    value: String(r.code),
                  }))}
                  onChange={async (v) => {
                    setClientDraft((d) => ({
                      ...d,
                      region: v,
                      province: "",
                      municipality: "",
                    }));
                    setClientProvinces([]);
                    setClientMunicipalities([]);
                    setLoadingClientAddress("province");
                    try {
                      const res = await fetch(
                        `https://psgc.gitlab.io/api/regions/${v}/provinces/`,
                      );
                      setClientProvinces(await res.json());
                    } catch (_) {}
                    setLoadingClientAddress("");
                  }}
                />
              </Form.Item>
              <Form.Item label="Province">
                <Select
                  placeholder="Select province"
                  value={clientDraft.province || undefined}
                  loading={loadingClientAddress === "province"}
                  showSearch
                  optionFilterProp="label"
                  options={(clientProvinces || []).map((p) => ({
                    label: p.name,
                    value: String(p.code),
                  }))}
                  onChange={async (v) => {
                    setClientDraft((d) => ({
                      ...d,
                      province: v,
                      municipality: "",
                    }));
                    setClientMunicipalities([]);
                    setLoadingClientAddress("municipality");
                    try {
                      const res = await fetch(
                        `https://psgc.gitlab.io/api/provinces/${v}/cities-municipalities/`,
                      );
                      setClientMunicipalities(await res.json());
                    } catch (_) {}
                    setLoadingClientAddress("");
                  }}
                />
              </Form.Item>
              <Form.Item label="Municipality/City">
                <Select
                  placeholder="Select municipality"
                  value={clientDraft.municipality || undefined}
                  loading={loadingClientAddress === "municipality"}
                  showSearch
                  optionFilterProp="label"
                  options={(clientMunicipalities || []).map((m) => ({
                    label: m.name,
                    value: String(m.code),
                  }))}
                  onChange={(v) =>
                    setClientDraft((d) => ({ ...d, municipality: v }))
                  }
                />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>

      {/* ── Hauler Deletion Request Modal ── */}
      <Modal
        title={
          <Space>
            <DeleteOutlined style={{ color: "#ff4d4f" }} />
            <span>Request Hauler Deletion</span>
          </Space>
        }
        open={haulerDeleteModal.open}
        onCancel={() => {
          setHaulerDeleteModal({ open: false, hauler: null });
          setHaulerDeleteReason("");
          setHaulerDeleteFile(null);
        }}
        onOk={async () => {
          if (!haulerDeleteReason.trim()) {
            return;
          }
          setHaulerDeleteLoading(true);
          try {
            const h = haulerDeleteModal.hauler;
            const fd = new FormData();
            fd.append("portalUserEmail", portalUser?.email || "");
            fd.append(
              "portalUserName",
              portalUser
                ? `${portalUser.firstName || ""} ${portalUser.lastName || ""}`.trim()
                : "",
            );
            fd.append("companyName", portalUser?.companyName || "");
            fd.append("slfName", activeSlfName || "");
            fd.append("haulerKey", String(h?.key || ""));
            fd.append("haulerName", h?.haulerName || "");
            fd.append("officeAddress", h?.officeAddress || "");
            fd.append("reason", haulerDeleteReason.trim());
            if (haulerDeleteFile) fd.append("letterOfIntent", haulerDeleteFile);
            await api.post("/hauler-delete-requests", fd, {
              headers: { "Content-Type": "multipart/form-data" },
            });
            setHaulerDeleteModal({ open: false, hauler: null });
            setHaulerDeleteReason("");
            setHaulerDeleteFile(null);
            Modal.success({
              title: "Request Submitted",
              content:
                "Your hauler deletion request has been submitted. EMB Region 3 will review it and you will be notified of the decision.",
            });
          } catch (err) {
            Modal.error({
              title: "Submission Failed",
              content:
                err?.response?.data?.message ||
                "Could not submit the request. Please try again.",
            });
          } finally {
            setHaulerDeleteLoading(false);
          }
        }}
        okText="Submit Request"
        okButtonProps={{
          danger: true,
          loading: haulerDeleteLoading,
          disabled: !haulerDeleteReason.trim(),
        }}
        cancelText="Cancel"
        destroyOnHidden
        width={520}
      >
        <div
          style={{
            background: "#fff2f0",
            border: "1px solid #ffccc7",
            borderRadius: 8,
            padding: "10px 14px",
            marginBottom: 16,
          }}
        >
          <Text style={{ fontSize: 12, color: "#cf1322" }}>
            <strong>Note:</strong> Hauler deletion requires EMB Region 3
            approval. Please provide a valid justification and attach a Letter
            of Intent.
          </Text>
        </div>
        <Form layout="vertical" requiredMark={false}>
          <Form.Item label="Hauler to be Deleted">
            <Input
              value={haulerDeleteModal.hauler?.haulerName || ""}
              disabled
            />
          </Form.Item>
          <Form.Item
            label="Reason / Justification"
            required
            validateStatus={haulerDeleteReason.trim() ? "" : "error"}
            help={!haulerDeleteReason.trim() ? "Please provide a reason." : ""}
          >
            <Input.TextArea
              rows={4}
              placeholder="Explain the reason for requesting this hauler to be deleted..."
              value={haulerDeleteReason}
              onChange={(e) => setHaulerDeleteReason(e.target.value)}
              maxLength={1000}
              showCount
            />
          </Form.Item>
          <Form.Item
            label="Letter of Intent (PDF, DOC, DOCX, JPG, PNG)"
            extra="Maximum 20 MB"
          >
            <input
              type="file"
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
              style={{ display: "none" }}
              id="hauler-loi-file-input"
              onChange={(e) => setHaulerDeleteFile(e.target.files[0] || null)}
            />
            <Space>
              <Button
                icon={<UploadOutlined />}
                onClick={() =>
                  document.getElementById("hauler-loi-file-input").click()
                }
              >
                {haulerDeleteFile ? "Change File" : "Attach File"}
              </Button>
              {haulerDeleteFile && (
                <Space size={4}>
                  <Text style={{ fontSize: 12 }}>{haulerDeleteFile.name}</Text>
                  <Button
                    type="text"
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    onClick={() => {
                      setHaulerDeleteFile(null);
                      document.getElementById("hauler-loi-file-input").value =
                        "";
                    }}
                  />
                </Space>
              )}
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* ══════════════════════ WASTE RECEIVED MODAL ══════════════════════ */}
      <Modal
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "linear-gradient(135deg, #fa8c16, #d46b08)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <BarChartOutlined style={{ color: "#fff", fontSize: 16 }} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#1a3353" }}>
                Waste Received Breakdown
              </div>
              <div style={{ fontSize: 11, color: "#8c8c8c", fontWeight: 400 }}>
                {activeSlfName}
              </div>
            </div>
          </div>
        }
        open={wasteReceivedModalOpen}
        onCancel={() => setWasteReceivedModalOpen(false)}
        footer={
          <Button onClick={() => setWasteReceivedModalOpen(false)}>
            Close
          </Button>
        }
        width={800}
        destroyOnHidden
      >
        <Spin spinning={wasteReceivedLoading}>
          {[
            {
              key: "lguR3",
              label: "LGU Waste — Region III (Central Luzon)",
              color: "#1890ff",
              bg: "#e6f7ff",
              icon: <TeamOutlined />,
            },
            {
              key: "lguOutside",
              label: "LGU Waste — Outside Region III",
              color: "#722ed1",
              bg: "#f9f0ff",
              icon: <TeamOutlined />,
            },
            {
              key: "privateIndustry",
              label: "Waste from Private Industries",
              color: "#52c41a",
              bg: "#f6ffed",
              icon: <BankOutlined />,
            },
          ].map(({ key, label, color, bg, icon }) => {
            const rows = wasteReceivedData[key] || [];
            const total = rows.reduce((s, r) => s + (r.totalVolume || 0), 0);
            return (
              <div key={key} style={{ marginBottom: 20 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 10,
                    padding: "8px 12px",
                    background: bg,
                    borderRadius: 8,
                    border: `1px solid ${color}30`,
                  }}
                >
                  <span style={{ color, fontSize: 14 }}>{icon}</span>
                  <Text strong style={{ color, fontSize: 13 }}>
                    {label}
                  </Text>
                  <Tag
                    color={
                      color === "#1890ff"
                        ? "blue"
                        : color === "#722ed1"
                          ? "purple"
                          : "green"
                    }
                    style={{ marginLeft: "auto" }}
                  >
                    {rows.length} company{rows.length !== 1 ? "ies" : "y"}
                  </Tag>
                  <Text style={{ fontSize: 12, color: "#8c8c8c" }}>
                    Total: {total.toLocaleString()} m³
                  </Text>
                </div>
                {rows.length === 0 ? (
                  <Empty
                    description="No data"
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    style={{ margin: "8px 0" }}
                  />
                ) : (
                  <Table
                    size="small"
                    dataSource={rows}
                    rowKey="company"
                    pagination={false}
                    columns={[
                      { title: "#", render: (_, __, i) => i + 1, width: 40 },
                      {
                        title: "Company",
                        dataIndex: "company",
                        key: "company",
                      },
                      {
                        title: "Entries",
                        dataIndex: "entries",
                        key: "entries",
                        align: "center",
                        width: 80,
                      },
                      {
                        title: "Total Volume",
                        dataIndex: "totalVolume",
                        key: "totalVolume",
                        align: "right",
                        width: 140,
                        render: (v) => (
                          <Text strong style={{ color }}>
                            {(v || 0).toLocaleString()} m³
                          </Text>
                        ),
                      },
                    ]}
                    style={{ marginBottom: 4 }}
                  />
                )}
              </div>
            );
          })}
        </Spin>
      </Modal>

      {/* ══════════════════════ LEACHATE PONDS MODAL ══════════════════════ */}
      <Modal
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "linear-gradient(135deg, #1890ff, #096dd9)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <WifiOutlined style={{ color: "#fff", fontSize: 16 }} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#1a3353" }}>
                Leachate Ponds Management
              </div>
              <div style={{ fontSize: 11, color: "#8c8c8c" }}>
                Count registered: {slfInfo?.noOfLeachatePond ?? "—"}
              </div>
            </div>
          </div>
        }
        open={leachateModalOpen}
        onCancel={() => setLeachateModalOpen(false)}
        footer={[
          <Button
            key="add"
            type="dashed"
            icon={<PlusOutlined />}
            onClick={() =>
              setLeachateDetails((prev) => [
                ...prev,
                {
                  _key: Date.now(),
                  pondNo: prev.length + 1,
                  description: "",
                  status: "Active",
                  attachments: [],
                },
              ])
            }
          >
            Add Pond
          </Button>,
          <Button
            key="save"
            type="primary"
            loading={facilityMgmtSaving}
            icon={<SaveOutlined />}
            onClick={() =>
              handleSaveFacilityDetails("leachate", leachateDetails)
            }
            style={{ background: "#1890ff" }}
          >
            Save
          </Button>,
          <Button key="close" onClick={() => setLeachateModalOpen(false)}>
            Close
          </Button>,
        ]}
        width={750}
        destroyOnHidden
      >
        {leachateDetails.length === 0 ? (
          <Empty
            description="No leachate pond records yet. Click 'Add Pond' to start."
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          leachateDetails.map((pond, idx) => (
            <div
              key={pond._key}
              style={{
                background: "#f8f9fb",
                borderRadius: 10,
                padding: 16,
                marginBottom: 12,
                border: "1px solid #e8e8e8",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 12,
                }}
              >
                <Tag color="blue" style={{ fontWeight: 700 }}>
                  Pond {idx + 1}
                </Tag>
                <Select
                  size="small"
                  value={pond.status || "Active"}
                  onChange={(v) =>
                    setLeachateDetails((p) =>
                      p.map((x, i) => (i === idx ? { ...x, status: v } : x)),
                    )
                  }
                  options={[
                    { label: "Active", value: "Active" },
                    { label: "Inactive", value: "Inactive" },
                    { label: "Under Maintenance", value: "Under Maintenance" },
                  ]}
                  style={{ width: 160 }}
                />
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  style={{ marginLeft: "auto" }}
                  onClick={() =>
                    setLeachateDetails((p) => p.filter((_, i) => i !== idx))
                  }
                />
              </div>
              <Row gutter={[12, 8]}>
                <Col xs={24} sm={8}>
                  <div
                    style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}
                  >
                    Pond No.
                  </div>
                  <InputNumber
                    size="small"
                    min={1}
                    value={pond.pondNo}
                    onChange={(v) =>
                      setLeachateDetails((p) =>
                        p.map((x, i) => (i === idx ? { ...x, pondNo: v } : x)),
                      )
                    }
                    style={{ width: "100%" }}
                  />
                </Col>
                <Col xs={24} sm={16}>
                  <div
                    style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}
                  >
                    Description
                  </div>
                  <Input
                    size="small"
                    value={pond.description}
                    placeholder="Pond description, dimensions, type..."
                    onChange={(e) =>
                      setLeachateDetails((p) =>
                        p.map((x, i) =>
                          i === idx ? { ...x, description: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </Col>
              </Row>
              {/* Attachments */}
              <div style={{ marginTop: 10 }}>
                <div
                  style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}
                >
                  Attachments / Document Links
                </div>
                {(pond.attachments || []).map((url, ai) => (
                  <div
                    key={ai}
                    style={{ display: "flex", gap: 6, marginBottom: 6 }}
                  >
                    <Input
                      size="small"
                      value={url}
                      placeholder="Google Drive link or URL"
                      onChange={(e) =>
                        setLeachateDetails((p) =>
                          p.map((x, i) =>
                            i === idx
                              ? {
                                  ...x,
                                  attachments: x.attachments.map((a, j) =>
                                    j === ai ? e.target.value : a,
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                      addonBefore={<FileTextOutlined />}
                    />
                    {url && (
                      <Button
                        size="small"
                        type="link"
                        icon={<EyeOutlined />}
                        href={url}
                        target="_blank"
                        style={{ padding: 0 }}
                      />
                    )}
                    <Button
                      size="small"
                      danger
                      type="text"
                      icon={<DeleteOutlined />}
                      onClick={() =>
                        setLeachateDetails((p) =>
                          p.map((x, i) =>
                            i === idx
                              ? {
                                  ...x,
                                  attachments: x.attachments.filter(
                                    (_, j) => j !== ai,
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                    />
                  </div>
                ))}
                <Button
                  size="small"
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() =>
                    setLeachateDetails((p) =>
                      p.map((x, i) =>
                        i === idx
                          ? {
                              ...x,
                              attachments: [...(x.attachments || []), ""],
                            }
                          : x,
                      ),
                    )
                  }
                >
                  Add Link
                </Button>
              </div>
            </div>
          ))
        )}
      </Modal>

      {/* ══════════════════════ GAS VENTS MODAL ══════════════════════ */}
      <Modal
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "linear-gradient(135deg, #52c41a, #389e0d)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <EnvironmentOutlined style={{ color: "#fff", fontSize: 16 }} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#1a3353" }}>
                Gas Vents Management
              </div>
              <div style={{ fontSize: 11, color: "#8c8c8c" }}>
                Count registered: {slfInfo?.numberOfGasVents ?? "—"}
              </div>
            </div>
          </div>
        }
        open={gasVentModalOpen}
        onCancel={() => setGasVentModalOpen(false)}
        footer={[
          <Button
            key="add"
            type="dashed"
            icon={<PlusOutlined />}
            onClick={() =>
              setGasVentDetails((prev) => [
                ...prev,
                {
                  _key: Date.now(),
                  ventNo: prev.length + 1,
                  ventType: "",
                  description: "",
                  status: "Active",
                  attachments: [],
                },
              ])
            }
          >
            Add Vent
          </Button>,
          <Button
            key="save"
            type="primary"
            loading={facilityMgmtSaving}
            icon={<SaveOutlined />}
            onClick={() => handleSaveFacilityDetails("gasVent", gasVentDetails)}
            style={{ background: "#52c41a", borderColor: "#52c41a" }}
          >
            Save
          </Button>,
          <Button key="close" onClick={() => setGasVentModalOpen(false)}>
            Close
          </Button>,
        ]}
        width={750}
        destroyOnHidden
      >
        {gasVentDetails.length === 0 ? (
          <Empty
            description="No gas vent records yet. Click 'Add Vent' to start."
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          gasVentDetails.map((vent, idx) => (
            <div
              key={vent._key}
              style={{
                background: "#f6ffed",
                borderRadius: 10,
                padding: 16,
                marginBottom: 12,
                border: "1px solid #b7eb8f",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 12,
                }}
              >
                <Tag color="green" style={{ fontWeight: 700 }}>
                  Vent {idx + 1}
                </Tag>
                <Select
                  size="small"
                  value={vent.status || "Active"}
                  onChange={(v) =>
                    setGasVentDetails((p) =>
                      p.map((x, i) => (i === idx ? { ...x, status: v } : x)),
                    )
                  }
                  options={[
                    { label: "Active", value: "Active" },
                    { label: "Inactive", value: "Inactive" },
                    { label: "Under Maintenance", value: "Under Maintenance" },
                  ]}
                  style={{ width: 160 }}
                />
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  style={{ marginLeft: "auto" }}
                  onClick={() =>
                    setGasVentDetails((p) => p.filter((_, i) => i !== idx))
                  }
                />
              </div>
              <Row gutter={[12, 8]}>
                <Col xs={24} sm={8}>
                  <div
                    style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}
                  >
                    Vent No.
                  </div>
                  <InputNumber
                    size="small"
                    min={1}
                    value={vent.ventNo}
                    onChange={(v) =>
                      setGasVentDetails((p) =>
                        p.map((x, i) => (i === idx ? { ...x, ventNo: v } : x)),
                      )
                    }
                    style={{ width: "100%" }}
                  />
                </Col>
                <Col xs={24} sm={8}>
                  <div
                    style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}
                  >
                    Vent Type
                  </div>
                  <Input
                    size="small"
                    value={vent.ventType}
                    placeholder="e.g. Passive, Active"
                    onChange={(e) =>
                      setGasVentDetails((p) =>
                        p.map((x, i) =>
                          i === idx ? { ...x, ventType: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </Col>
                <Col xs={24} sm={8}>
                  <div
                    style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}
                  >
                    Description
                  </div>
                  <Input
                    size="small"
                    value={vent.description}
                    placeholder="Location, specs..."
                    onChange={(e) =>
                      setGasVentDetails((p) =>
                        p.map((x, i) =>
                          i === idx ? { ...x, description: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </Col>
              </Row>
              <div style={{ marginTop: 10 }}>
                <div
                  style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}
                >
                  Attachments / Document Links
                </div>
                {(vent.attachments || []).map((url, ai) => (
                  <div
                    key={ai}
                    style={{ display: "flex", gap: 6, marginBottom: 6 }}
                  >
                    <Input
                      size="small"
                      value={url}
                      placeholder="Google Drive link or URL"
                      onChange={(e) =>
                        setGasVentDetails((p) =>
                          p.map((x, i) =>
                            i === idx
                              ? {
                                  ...x,
                                  attachments: x.attachments.map((a, j) =>
                                    j === ai ? e.target.value : a,
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                      addonBefore={<FileTextOutlined />}
                    />
                    {url && (
                      <Button
                        size="small"
                        type="link"
                        icon={<EyeOutlined />}
                        href={url}
                        target="_blank"
                        style={{ padding: 0 }}
                      />
                    )}
                    <Button
                      size="small"
                      danger
                      type="text"
                      icon={<DeleteOutlined />}
                      onClick={() =>
                        setGasVentDetails((p) =>
                          p.map((x, i) =>
                            i === idx
                              ? {
                                  ...x,
                                  attachments: x.attachments.filter(
                                    (_, j) => j !== ai,
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                    />
                  </div>
                ))}
                <Button
                  size="small"
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() =>
                    setGasVentDetails((p) =>
                      p.map((x, i) =>
                        i === idx
                          ? {
                              ...x,
                              attachments: [...(x.attachments || []), ""],
                            }
                          : x,
                      ),
                    )
                  }
                >
                  Add Link
                </Button>
              </div>
            </div>
          ))
        )}
      </Modal>

      {/* ══════════════════════ TRASH SLIDE PREVENTION MODAL ══════════════════════ */}
      <Modal
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "linear-gradient(135deg, #fa8c16, #d46b08)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <AuditOutlined style={{ color: "#fff", fontSize: 16 }} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#1a3353" }}>
                Trash Slide Prevention Measures
              </div>
              <div style={{ fontSize: 11, color: "#8c8c8c" }}>
                {trashSlideDetails.length} measure(s) recorded
              </div>
            </div>
          </div>
        }
        open={trashSlideModalOpen}
        onCancel={() => setTrashSlideModalOpen(false)}
        footer={[
          <Button
            key="add"
            type="dashed"
            icon={<PlusOutlined />}
            onClick={() =>
              setTrashSlideDetails((prev) => [
                ...prev,
                {
                  _key: Date.now(),
                  measure: "",
                  description: "",
                  status: "Implemented",
                  attachments: [],
                },
              ])
            }
          >
            Add Measure
          </Button>,
          <Button
            key="save"
            type="primary"
            loading={facilityMgmtSaving}
            icon={<SaveOutlined />}
            onClick={() =>
              handleSaveFacilityDetails("trashSlide", trashSlideDetails)
            }
            style={{ background: "#fa8c16", borderColor: "#fa8c16" }}
          >
            Save
          </Button>,
          <Button key="close" onClick={() => setTrashSlideModalOpen(false)}>
            Close
          </Button>,
        ]}
        width={750}
        destroyOnHidden
      >
        {trashSlideDetails.length === 0 ? (
          <Empty
            description="No trash slide prevention measures yet. Click 'Add Measure' to start."
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          trashSlideDetails.map((item, idx) => (
            <div
              key={item._key}
              style={{
                background: "#fff7e6",
                borderRadius: 10,
                padding: 16,
                marginBottom: 12,
                border: "1px solid #ffd591",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 12,
                }}
              >
                <Tag color="orange" style={{ fontWeight: 700 }}>
                  Measure {idx + 1}
                </Tag>
                <Select
                  size="small"
                  value={item.status || "Implemented"}
                  onChange={(v) =>
                    setTrashSlideDetails((p) =>
                      p.map((x, i) => (i === idx ? { ...x, status: v } : x)),
                    )
                  }
                  options={[
                    { label: "Implemented", value: "Implemented" },
                    { label: "Planned", value: "Planned" },
                    { label: "Not Applicable", value: "Not Applicable" },
                  ]}
                  style={{ width: 160 }}
                />
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  style={{ marginLeft: "auto" }}
                  onClick={() =>
                    setTrashSlideDetails((p) => p.filter((_, i) => i !== idx))
                  }
                />
              </div>
              <Row gutter={[12, 8]}>
                <Col xs={24} sm={12}>
                  <div
                    style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}
                  >
                    Measure Name
                  </div>
                  <Input
                    size="small"
                    value={item.measure}
                    placeholder="e.g. Slope stabilization, Retaining wall..."
                    onChange={(e) =>
                      setTrashSlideDetails((p) =>
                        p.map((x, i) =>
                          i === idx ? { ...x, measure: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </Col>
                <Col xs={24} sm={12}>
                  <div
                    style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}
                  >
                    Description
                  </div>
                  <Input
                    size="small"
                    value={item.description}
                    placeholder="Details, specifications..."
                    onChange={(e) =>
                      setTrashSlideDetails((p) =>
                        p.map((x, i) =>
                          i === idx ? { ...x, description: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </Col>
              </Row>
              <div style={{ marginTop: 10 }}>
                <div
                  style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}
                >
                  Attachments / Document Links
                </div>
                {(item.attachments || []).map((url, ai) => (
                  <div
                    key={ai}
                    style={{ display: "flex", gap: 6, marginBottom: 6 }}
                  >
                    <Input
                      size="small"
                      value={url}
                      placeholder="Google Drive link or URL"
                      onChange={(e) =>
                        setTrashSlideDetails((p) =>
                          p.map((x, i) =>
                            i === idx
                              ? {
                                  ...x,
                                  attachments: x.attachments.map((a, j) =>
                                    j === ai ? e.target.value : a,
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                      addonBefore={<FileTextOutlined />}
                    />
                    {url && (
                      <Button
                        size="small"
                        type="link"
                        icon={<EyeOutlined />}
                        href={url}
                        target="_blank"
                        style={{ padding: 0 }}
                      />
                    )}
                    <Button
                      size="small"
                      danger
                      type="text"
                      icon={<DeleteOutlined />}
                      onClick={() =>
                        setTrashSlideDetails((p) =>
                          p.map((x, i) =>
                            i === idx
                              ? {
                                  ...x,
                                  attachments: x.attachments.filter(
                                    (_, j) => j !== ai,
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                    />
                  </div>
                ))}
                <Button
                  size="small"
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() =>
                    setTrashSlideDetails((p) =>
                      p.map((x, i) =>
                        i === idx
                          ? {
                              ...x,
                              attachments: [...(x.attachments || []), ""],
                            }
                          : x,
                      ),
                    )
                  }
                >
                  Add Link
                </Button>
              </div>
            </div>
          ))
        )}
      </Modal>

      {/* ══════════════════════ FIRE PREVENTION MODAL ══════════════════════ */}
      <Modal
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "linear-gradient(135deg, #ff4d4f, #cf1322)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <CloseCircleOutlined style={{ color: "#fff", fontSize: 16 }} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#1a3353" }}>
                Fire Prevention Measures
              </div>
              <div style={{ fontSize: 11, color: "#8c8c8c" }}>
                {firePrevDetails.length} measure(s) recorded
              </div>
            </div>
          </div>
        }
        open={firePrevModalOpen}
        onCancel={() => setFirePrevModalOpen(false)}
        footer={[
          <Button
            key="add"
            type="dashed"
            icon={<PlusOutlined />}
            onClick={() =>
              setFirePrevDetails((prev) => [
                ...prev,
                {
                  _key: Date.now(),
                  measure: "",
                  description: "",
                  status: "Implemented",
                  attachments: [],
                },
              ])
            }
          >
            Add Measure
          </Button>,
          <Button
            key="save"
            type="primary"
            danger
            loading={facilityMgmtSaving}
            icon={<SaveOutlined />}
            onClick={() =>
              handleSaveFacilityDetails("firePrev", firePrevDetails)
            }
          >
            Save
          </Button>,
          <Button key="close" onClick={() => setFirePrevModalOpen(false)}>
            Close
          </Button>,
        ]}
        width={750}
        destroyOnHidden
      >
        {firePrevDetails.length === 0 ? (
          <Empty
            description="No fire prevention measures yet. Click 'Add Measure' to start."
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          firePrevDetails.map((item, idx) => (
            <div
              key={item._key}
              style={{
                background: "#fff2f0",
                borderRadius: 10,
                padding: 16,
                marginBottom: 12,
                border: "1px solid #ffccc7",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 12,
                }}
              >
                <Tag color="red" style={{ fontWeight: 700 }}>
                  Measure {idx + 1}
                </Tag>
                <Select
                  size="small"
                  value={item.status || "Implemented"}
                  onChange={(v) =>
                    setFirePrevDetails((p) =>
                      p.map((x, i) => (i === idx ? { ...x, status: v } : x)),
                    )
                  }
                  options={[
                    { label: "Implemented", value: "Implemented" },
                    { label: "Planned", value: "Planned" },
                    { label: "Not Applicable", value: "Not Applicable" },
                  ]}
                  style={{ width: 160 }}
                />
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  style={{ marginLeft: "auto" }}
                  onClick={() =>
                    setFirePrevDetails((p) => p.filter((_, i) => i !== idx))
                  }
                />
              </div>
              <Row gutter={[12, 8]}>
                <Col xs={24} sm={12}>
                  <div
                    style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}
                  >
                    Measure Name
                  </div>
                  <Input
                    size="small"
                    value={item.measure}
                    placeholder="e.g. Fire suppression system, Firebreak..."
                    onChange={(e) =>
                      setFirePrevDetails((p) =>
                        p.map((x, i) =>
                          i === idx ? { ...x, measure: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </Col>
                <Col xs={24} sm={12}>
                  <div
                    style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}
                  >
                    Description
                  </div>
                  <Input
                    size="small"
                    value={item.description}
                    placeholder="Details, specifications..."
                    onChange={(e) =>
                      setFirePrevDetails((p) =>
                        p.map((x, i) =>
                          i === idx ? { ...x, description: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </Col>
              </Row>
              <div style={{ marginTop: 10 }}>
                <div
                  style={{ fontSize: 11, color: "#8c8c8c", marginBottom: 4 }}
                >
                  Attachments / Document Links
                </div>
                {(item.attachments || []).map((url, ai) => (
                  <div
                    key={ai}
                    style={{ display: "flex", gap: 6, marginBottom: 6 }}
                  >
                    <Input
                      size="small"
                      value={url}
                      placeholder="Google Drive link or URL"
                      onChange={(e) =>
                        setFirePrevDetails((p) =>
                          p.map((x, i) =>
                            i === idx
                              ? {
                                  ...x,
                                  attachments: x.attachments.map((a, j) =>
                                    j === ai ? e.target.value : a,
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                      addonBefore={<FileTextOutlined />}
                    />
                    {url && (
                      <Button
                        size="small"
                        type="link"
                        icon={<EyeOutlined />}
                        href={url}
                        target="_blank"
                        style={{ padding: 0 }}
                      />
                    )}
                    <Button
                      size="small"
                      danger
                      type="text"
                      icon={<DeleteOutlined />}
                      onClick={() =>
                        setFirePrevDetails((p) =>
                          p.map((x, i) =>
                            i === idx
                              ? {
                                  ...x,
                                  attachments: x.attachments.filter(
                                    (_, j) => j !== ai,
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                    />
                  </div>
                ))}
                <Button
                  size="small"
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() =>
                    setFirePrevDetails((p) =>
                      p.map((x, i) =>
                        i === idx
                          ? {
                              ...x,
                              attachments: [...(x.attachments || []), ""],
                            }
                          : x,
                      ),
                    )
                  }
                >
                  Add Link
                </Button>
              </div>
            </div>
          ))
        )}
      </Modal>
    </>
  );
}
