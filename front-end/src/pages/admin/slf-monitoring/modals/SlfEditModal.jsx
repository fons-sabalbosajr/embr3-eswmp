import HaulerClientsEditor from "../../slf-monitoring/HaulerClientsEditor";
import { ACCENT, CELL_STATUS_COLORS, CELL_STATUS_OPTIONS, DP_TYPE_OPTIONS, GALLERY_COMPONENT_OPTIONS, PERMIT_STATUS_OPTIONS, RECEIVING_FACILITY_TYPE_OPTIONS, SLF_DOCUMENT_TYPE_OPTIONS, THREE_DECIMAL_STEP, UNIT_OPTIONS, WWTF_TYPE_OPTIONS, convertVolume, fileUrlFromValue, formatFileSize, formatThreeDecimalInput, getMediaKind, getUploadHeaders, isActiveCellStatus, isCompletedCellStatus, normalizeCellStatus, normalizeUnit, parseDecimalInput, renderUploadStatusCell, resolveMediaOpenUrl, resolveMediaUrl, resolveUploadName, slfUploadProps, uploadEventToFileList, uploadFileFromValue } from "../../slf-monitoring/helpers.jsx";
import { AlertOutlined, BankOutlined, BarChartOutlined, CalculatorOutlined, DatabaseOutlined, DeleteOutlined, DownloadOutlined, EditOutlined, EnvironmentOutlined, ExperimentOutlined, EyeOutlined, FileImageOutlined, FilePdfOutlined, FileTextOutlined, FolderOutlined, InfoCircleOutlined, LinkOutlined, PlusOutlined, SafetyCertificateOutlined, TeamOutlined, UploadOutlined, WarningOutlined } from "@ant-design/icons";
// `Image` MUST be imported from antd. Without it, JSX <Image> resolves to the
// browser's global Image constructor and React throws "Please use the 'new'
// operator, this DOM object constructor cannot be called as a function".
// eslint's no-undef cannot catch this — window.Image is a legitimate global.
import { Button, Card, Checkbox, Col, Collapse, DatePicker, Divider, Empty, Form, Image, Input, InputNumber, Modal, Popconfirm, Progress, Row, Select, Space, Spin, Switch, Table, Tabs, Tag, Tooltip, Typography, Upload, message } from "antd";
import CellGaugeLegend from "../CellGaugeLegend";
import { Cell as RCell, Pie, PieChart, Tooltip as RTooltip } from "recharts";

const { Text } = Typography;

// Add / edit facility form — the SLF Data Table's write path.
//
// The most connected region of the container: profile fields, cell
// infrastructure, permits, gallery, documents and preventive measures, each
// with its own option list and save handler. 28 explicit props is a lot, but
// nothing is closed over, so nothing can go stale.
// Every per-cell array on the facility form. The Cell Infrastructure panel
// re-renders when any of their references change (see shouldUpdate below).
const CELL_ARRAY_FIELDS = [
  "cellNames",
  "cellCapacities",
  "cellStatuses",
  "cellTypes",
  "cellSubmissionAllowed",
  "cellNotes",
  "cellFillValues",
  "cellCapacityUnits",
  "cellFillUnits",
];

export default function SlfEditModal({
  isDark,
  canEdit,
  driveDisabled,
  modalOpen,
  setModalOpen,
  editing,
  form,
  saving,
  handleSave,
  loading,
  records,
  provinceOptions,
  districtOptions,
  categoryOptions,
  ownershipOptions,
  mbaOptions,
  slfStatusOptions,
  cellActionSaving,
  handleCellFillValueChange,
  saveCellStatusNow,
  saveCellSubmissionAllowedNow,
  preventiveUploadEventToFileList,
  openFilePreview,
  openMapPreview,
  setUnitToolOpen,
  setConvModalOpen,
  setConvArea,
  setConvDepth,
  setConvVol,
  setConvDensity,
  setConvM3ToTons,
}) {
  return (
    <Modal
      title={
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingRight: 36,
          }}
        >
          <Space size={6}>
            {editing?._id ? (
              <>
                <EditOutlined style={{ color: ACCENT }} />
                <span>Edit SLF Facility</span>
                <Text
                  type="secondary"
                  style={{ fontWeight: 400, fontSize: 13 }}
                >
                  —
                </Text>
                <Text strong style={{ color: ACCENT, fontSize: 14 }}>
                  {editing.lgu || ""}
                </Text>
                {editing.province && (
                  <Text
                    type="secondary"
                    style={{ fontSize: 12, fontWeight: 400 }}
                  >
                    {editing.province}
                  </Text>
                )}
              </>
            ) : (
              <span>Add SLF Facility</span>
            )}
          </Space>
          <Space size={6}>
            <Button
              size="small"
              icon={<CalculatorOutlined />}
              onClick={() => setConvModalOpen(true)}
              style={{
                fontSize: 11,
                borderRadius: 6,
                background: isDark ? "rgba(82,196,26,0.15)" : "#f6ffed",
                borderColor: "#b7eb8f",
                color: "#389e0d",
              }}
            >
              Converter
            </Button>
            <Button
              size="small"
              icon={<DatabaseOutlined />}
              onClick={() => setUnitToolOpen(true)}
              style={{ fontSize: 11, borderRadius: 6 }}
            >
              Set Units
            </Button>
          </Space>
        </div>
      }
      open={modalOpen}
      onCancel={() => {
        setModalOpen(false);
        form.resetFields();
        setConvArea(null);
        setConvDepth(null);
        setConvVol(null);
        setConvDensity(0.2);
        setConvM3ToTons(null);
        setConvModalOpen(false);
        setUnitToolOpen(false);
      }}
      onOk={handleSave}
      width={1400}
      okText="Save"
      confirmLoading={saving}
      okButtonProps={{
        loading: saving,
        style: { background: ACCENT, borderColor: ACCENT },
      }}
      mask={{ closable: !saving }}
      keyboard={!saving}
      destroyOnHidden
    >
      <Spin spinning={saving} tip="Saving SLF data records..." size="large">
        <Form form={form} layout="vertical" size="small">
          <Tabs
            defaultActiveKey="location"
            tabPosition="left"
            size="small"
            style={{ minHeight: 400 }}
            tabBarStyle={{
              background: isDark ? "rgba(22,119,255,0.08)" : "#f0f5ff",
              borderRight: `1px solid ${isDark ? "#1d3a6b" : "#d6e4ff"}`,
              borderRadius: "8px 0 0 8px",
              padding: "8px 0",
            }}
            items={[
              {
                // Replaces the removed "Reconcile Unlinked" module. Edits here write
                // straight into the portal user's baseline (accreditedHaulers), which
                // is what makes an admin's correction visible to that portal user —
                // the common case being a client submitted with no type or address.
                key: "hauler-clients",
                label: (
                  <span style={{ color: "#13c2c2" }}>
                    <TeamOutlined /> Hauler Clients
                  </span>
                ),
                children: editing?._id ? (
                  <HaulerClientsEditor
                    slfGeneratorId={editing?._id}
                    slfLabel={editing?.lgu || editing?.slfName}
                    canEdit={canEdit}
                  />
                ) : (
                  // Hauler/client rows hang off the saved facility's baseline
                  // records, so there is nothing to attach them to until the
                  // record exists. The editor previously bailed out silently
                  // here and rendered an empty pane with no explanation.
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="Save this facility first — haulers and clients attach to a saved record."
                  />
                ),
              },
              {
                key: "location",
                label: (
                  <span style={{ color: "#1677ff" }}>
                    <EnvironmentOutlined /> Location
                  </span>
                ),
                children: (
                  <Row gutter={[12, 0]}>
                    {/* Province and Barangay side by side */}
                    <Col span={12}>
                      <Form.Item
                        name="province"
                        label="Province"
                        rules={[{ required: true }]}
                      >
                        <Select
                          options={provinceOptions}
                          placeholder="Select Province"
                        />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name="barangay" label="Barangay">
                        <Input placeholder="Enter barangay name" />
                      </Form.Item>
                    </Col>
                    {/* LGU full-width textarea */}
                    <Col span={24}>
                      <Form.Item
                        name="lgu"
                        label="LGU Name"
                        rules={[{ required: true }]}
                      >
                        <Input.TextArea
                          rows={2}
                          placeholder="Enter full LGU name"
                          autoSize={{ minRows: 2, maxRows: 3 }}
                          style={{ resize: "none" }}
                        />
                      </Form.Item>
                    </Col>
                    {/* Manila Bay Area | Congressional District | Ownership */}
                    <Col span={8}>
                      <Form.Item name="manilaBayArea" label="Manila Bay Area">
                        <Select
                          options={mbaOptions}
                          allowClear
                          placeholder="Select"
                        />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item
                        name="congressionalDistrict"
                        label="Congressional District"
                      >
                        <Select
                          allowClear
                          showSearch
                          placeholder="Select District"
                          options={districtOptions}
                        />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="ownership" label="Ownership">
                        <Select
                          allowClear
                          placeholder="Select Ownership"
                          options={(() => {
                            const defaults = ["Public", "Private"];
                            const existing = ownershipOptions.map(
                              (o) => o.value,
                            );
                            const merged = [
                              ...defaults,
                              ...existing.filter(
                                (v) => !defaults.includes(v),
                              ),
                            ];
                            return merged.map((v) => ({
                              label: v,
                              value: v,
                            }));
                          })()}
                        />
                      </Form.Item>
                    </Col>
                    {/* Coordinates */}
                    <Col span={12}>
                      <Form.Item name="latitude" label="Latitude">
                        <InputNumber
                          style={{ width: "100%" }}
                          step={0.001}
                          precision={3}
                        />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name="longitude" label="Longitude">
                        <InputNumber
                          style={{ width: "100%" }}
                          step={0.001}
                          precision={3}
                        />
                      </Form.Item>
                    </Col>
                    <Col span={24}>
                      <Button
                        size="small"
                        icon={<EnvironmentOutlined />}
                        onClick={openMapPreview}
                      >
                        View in Maps
                      </Button>
                    </Col>
                  </Row>
                ),
              },
              {
                key: "facility",
                label: (
                  <span style={{ color: "#fa8c16" }}>
                    <BankOutlined /> Facility Details
                  </span>
                ),
                children: (
                  <>
                    <Row gutter={12}>
                      <Col span={6}>
                        <Form.Item
                          name="yearStartedOperation"
                          label="Year Started"
                        >
                          <InputNumber style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item name="category" label="SLF Category">
                          <Select
                            allowClear
                            showSearch
                            placeholder="Select Category"
                            options={categoryOptions}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item
                          label="Capacity per day"
                          style={{ marginBottom: 0 }}
                        >
                          <Space.Compact style={{ width: "100%" }}>
                            <Form.Item name="receivingVolumeCapacity" noStyle>
                              <InputNumber
                                style={{ width: "calc(100% - 80px)" }}
                                min={0}
                                placeholder="Receiving capacity"
                              />
                            </Form.Item>
                            <Form.Item
                              name="receivingVolumeCapacityUnit"
                              noStyle
                            >
                              <Select
                                style={{ width: 80 }}
                                options={UNIT_OPTIONS}
                                defaultValue="m³"
                              />
                            </Form.Item>
                          </Space.Compact>
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item noStyle dependencies={["ownership"]}>
                          {() => {
                            const own = form.getFieldValue("ownership") || "";
                            const isPrivate = /private/i.test(own);
                            return isPrivate ? (
                              <Form.Item
                                name="privateCompaniesServed"
                                label="Private Companies Served"
                              >
                                <Select
                                  mode="tags"
                                  placeholder="Type & press Enter to add companies"
                                  style={{ width: "100%" }}
                                  tokenSeparators={[","]}
                                />
                              </Form.Item>
                            ) : (
                              <Form.Item
                                name="lguServedList"
                                label="LGUs Served"
                              >
                                <Select
                                  mode="tags"
                                  placeholder="Type & press Enter to add LGUs"
                                  style={{ width: "100%" }}
                                  tokenSeparators={[","]}
                                />
                              </Form.Item>
                            );
                          }}
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item name="statusOfSLF" label="Status">
                          <Select
                            options={slfStatusOptions}
                            allowClear
                            placeholder="Select Status"
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Divider
                      orientation="left"
                      style={{
                        fontSize: 13,
                        color: "#fa8c16",
                        marginTop: 18,
                      }}
                    >
                      <BankOutlined style={{ marginRight: 6 }} />
                      Receiving Facility Table
                    </Divider>
                    <Form.List name="receivingFacilities">
                      {(fields, { add, remove }) => (
                        <>
                          <Table
                            size="small"
                            pagination={false}
                            dataSource={fields}
                            rowKey="key"
                            locale={{
                              emptyText: "No receiving facilities added yet",
                            }}
                            scroll={{ x: 880 }}
                            style={{ marginBottom: 8 }}
                            columns={[
                              {
                                title: "No.",
                                width: 64,
                                align: "center",
                                render: (_, __, index) => index + 1,
                              },
                              {
                                title: "MRF Type",
                                width: 260,
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "mrfTypes"]}
                                    style={{ margin: 0 }}
                                  >
                                    <Select
                                      mode="multiple"
                                      size="small"
                                      placeholder="Select type"
                                      options={
                                        RECEIVING_FACILITY_TYPE_OPTIONS
                                      }
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "MRF Name",
                                width: 220,
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "mrfName"]}
                                    style={{ margin: 0 }}
                                  >
                                    <Input
                                      size="small"
                                      placeholder="Facility name"
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "Status",
                                width: 150,
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "status"]}
                                    style={{ margin: 0 }}
                                  >
                                    <Select
                                      size="small"
                                      allowClear
                                      placeholder="Status"
                                      options={[
                                        { label: "Active", value: "Active" },
                                        {
                                          label: "Inactive",
                                          value: "Inactive",
                                        },
                                        {
                                          label: "Proposed",
                                          value: "Proposed",
                                        },
                                        {
                                          label: "Under Construction",
                                          value: "Under Construction",
                                        },
                                      ]}
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "Description",
                                width: 260,
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "description"]}
                                    style={{ margin: 0 }}
                                  >
                                    <Input.TextArea
                                      rows={1}
                                      placeholder="Description"
                                      autoSize={{ minRows: 1, maxRows: 3 }}
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "",
                                width: 56,
                                align: "center",
                                render: (_, field) => (
                                  <Button
                                    size="small"
                                    type="text"
                                    danger
                                    icon={<DeleteOutlined />}
                                    onClick={() => remove(field.name)}
                                  />
                                ),
                              },
                            ]}
                          />
                          <Button
                            type="dashed"
                            onClick={() =>
                              add({ mrfTypes: [], status: "Active" })
                            }
                            block
                            icon={<PlusOutlined />}
                          >
                            Add Receiving Facility
                          </Button>
                        </>
                      )}
                    </Form.List>
                  </>
                ),
              },
              {
                key: "leachate-gas",
                label: (
                  <span style={{ color: "#1677ff" }}>
                    <AlertOutlined /> Leachate &amp; Gas Management
                  </span>
                ),
                children: (
                  <>
                    {/* Counts summary — auto-synced from form list entries */}
                    {/* shouldUpdate, NOT dependencies. A render-prop Form.Item with
                        `dependencies` and no `name` only re-renders on an EXACT
                        name-path match, but editing a row inside these lists emits
                        ["leachatePondDetails", i, field] — which never matches
                        ["leachatePondDetails"] — so the counts silently froze.
                        Comparing the array reference catches every nested edit. */}
                    <Form.Item
                      noStyle
                      shouldUpdate={(prev, cur) =>
                        prev.leachatePondDetails !== cur.leachatePondDetails ||
                        prev.gasVentDetails !== cur.gasVentDetails
                      }
                    >
                      {() => {
                        const ponds =
                          form.getFieldValue("leachatePondDetails") || [];
                        const vents =
                          form.getFieldValue("gasVentDetails") || [];
                        const savedPondCount =
                          editing?.noOfLeachatePond ?? null;
                        const savedVentCount =
                          editing?.numberOfGasVents ?? null;
                        const pondStatusMap = ponds.reduce((acc, p) => {
                          const s = p?.status || "Active";
                          acc[s] = (acc[s] || 0) + 1;
                          return acc;
                        }, {});
                        const ventStatusMap = vents.reduce((acc, v) => {
                          const s = v?.status || "Active";
                          acc[s] = (acc[s] || 0) + 1;
                          return acc;
                        }, {});
                        const statusColor = {
                          Active: "#52c41a",
                          Inactive: "#8c8c8c",
                          "Under Maintenance": "#fa8c16",
                          Decommissioned: "#ff4d4f",
                        };
                        return (
                          <Row gutter={12} style={{ marginBottom: 16 }}>
                            <Col span={12}>
                              <Card
                                size="small"
                                style={{
                                  borderRadius: 8,
                                  border: `1px solid ${isDark ? "#1d3a6b" : "#bae0ff"}`,
                                  background: isDark
                                    ? "rgba(23,119,255,0.06)"
                                    : "#e6f4ff",
                                }}
                                title={
                                  <Space size={6}>
                                    <AlertOutlined
                                      style={{ color: "#1677ff" }}
                                    />
                                    <Text
                                      strong
                                      style={{
                                        fontSize: 12,
                                        color: isDark ? "#69b1ff" : "#0958d9",
                                      }}
                                    >
                                      Leachate Treatment Plant
                                    </Text>
                                    <Tag
                                      color="blue"
                                      style={{
                                        fontSize: 11,
                                        borderRadius: 10,
                                      }}
                                    >
                                      {ponds.length} in list
                                    </Tag>
                                    {savedPondCount !== null &&
                                      savedPondCount !== ponds.length && (
                                        <Tag
                                          color="orange"
                                          style={{
                                            fontSize: 11,
                                            borderRadius: 10,
                                          }}
                                        >
                                          {savedPondCount} saved
                                        </Tag>
                                      )}
                                    {savedPondCount !== null &&
                                      savedPondCount === ponds.length && (
                                        <Tag
                                          color="green"
                                          style={{
                                            fontSize: 11,
                                            borderRadius: 10,
                                          }}
                                        >
                                          matches saved
                                        </Tag>
                                      )}
                                  </Space>
                                }
                              >
                                {ponds.length === 0 ? (
                                  <Text
                                    type="secondary"
                                    style={{ fontSize: 11 }}
                                  >
                                    No Leachate Treatment Plant added yet.
                                  </Text>
                                ) : (
                                  <table
                                    style={{
                                      width: "100%",
                                      borderCollapse: "collapse",
                                      fontSize: 11,
                                    }}
                                  >
                                    <thead>
                                      <tr
                                        style={{
                                          background: isDark
                                            ? "rgba(255,255,255,0.04)"
                                            : "#f0f5ff",
                                        }}
                                      >
                                        <th
                                          style={{
                                            padding: "4px 8px",
                                            textAlign: "left",
                                            fontWeight: 600,
                                            borderBottom: "1px solid #d9d9d9",
                                          }}
                                        >
                                          No.
                                        </th>
                                        <th
                                          style={{
                                            padding: "4px 8px",
                                            textAlign: "left",
                                            fontWeight: 600,
                                            borderBottom: "1px solid #d9d9d9",
                                          }}
                                        >
                                          Status
                                        </th>
                                        <th
                                          style={{
                                            padding: "4px 8px",
                                            textAlign: "left",
                                            fontWeight: 600,
                                            borderBottom: "1px solid #d9d9d9",
                                          }}
                                        >
                                          Notes
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {ponds.map((p, idx) => (
                                        <tr
                                          key={idx}
                                          style={{
                                            borderBottom: "1px solid #f0f0f0",
                                          }}
                                        >
                                          <td style={{ padding: "3px 8px" }}>
                                            Pond {p?.pondNo || idx + 1}
                                          </td>
                                          <td style={{ padding: "3px 8px" }}>
                                            <Tag
                                              color={
                                                statusColor[p?.status]
                                                  ? undefined
                                                  : "default"
                                              }
                                              style={{
                                                fontSize: 10,
                                                color: statusColor[p?.status],
                                                borderColor:
                                                  statusColor[p?.status],
                                                background: "transparent",
                                              }}
                                            >
                                              {p?.status || "Active"}
                                            </Tag>
                                          </td>
                                          <td
                                            style={{
                                              padding: "3px 8px",
                                              color: "#8c8c8c",
                                              maxWidth: 120,
                                              overflow: "hidden",
                                              textOverflow: "ellipsis",
                                              whiteSpace: "nowrap",
                                            }}
                                          >
                                            {p?.description || "—"}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                                {Object.keys(pondStatusMap).length > 0 && (
                                  <div
                                    style={{
                                      marginTop: 6,
                                      display: "flex",
                                      gap: 6,
                                      flexWrap: "wrap",
                                    }}
                                  >
                                    {Object.entries(pondStatusMap).map(
                                      ([s, c]) => (
                                        <Tag
                                          key={s}
                                          style={{
                                            fontSize: 10,
                                            color: statusColor[s],
                                            borderColor: statusColor[s],
                                            background: "transparent",
                                          }}
                                        >
                                          {c} {s}
                                        </Tag>
                                      ),
                                    )}
                                  </div>
                                )}
                              </Card>
                            </Col>
                            <Col span={12}>
                              <Card
                                size="small"
                                style={{
                                  borderRadius: 8,
                                  border: `1px solid ${isDark ? "#1a3d20" : "#b7eb8f"}`,
                                  background: isDark
                                    ? "rgba(82,196,26,0.06)"
                                    : "#f6ffed",
                                }}
                                title={
                                  <Space size={6}>
                                    <ExperimentOutlined
                                      style={{ color: "#52c41a" }}
                                    />
                                    <Text
                                      strong
                                      style={{
                                        fontSize: 12,
                                        color: isDark ? "#95de64" : "#389e0d",
                                      }}
                                    >
                                      Gas Management
                                    </Text>
                                    <Tag
                                      color="green"
                                      style={{
                                        fontSize: 11,
                                        borderRadius: 10,
                                      }}
                                    >
                                      {vents.length} in list
                                    </Tag>
                                    {savedVentCount !== null &&
                                      savedVentCount !== vents.length && (
                                        <Tag
                                          color="orange"
                                          style={{
                                            fontSize: 11,
                                            borderRadius: 10,
                                          }}
                                        >
                                          {savedVentCount} saved
                                        </Tag>
                                      )}
                                    {savedVentCount !== null &&
                                      savedVentCount === vents.length && (
                                        <Tag
                                          color="green"
                                          style={{
                                            fontSize: 11,
                                            borderRadius: 10,
                                          }}
                                        >
                                          matches saved
                                        </Tag>
                                      )}
                                  </Space>
                                }
                              >
                                {vents.length === 0 ? (
                                  <Text
                                    type="secondary"
                                    style={{ fontSize: 11 }}
                                  >
                                    No gas management records added yet.
                                  </Text>
                                ) : (
                                  <table
                                    style={{
                                      width: "100%",
                                      borderCollapse: "collapse",
                                      fontSize: 11,
                                    }}
                                  >
                                    <thead>
                                      <tr
                                        style={{
                                          background: isDark
                                            ? "rgba(255,255,255,0.04)"
                                            : "#f6ffed",
                                        }}
                                      >
                                        <th
                                          style={{
                                            padding: "4px 8px",
                                            textAlign: "left",
                                            fontWeight: 600,
                                            borderBottom: "1px solid #d9d9d9",
                                          }}
                                        >
                                          No.
                                        </th>
                                        <th
                                          style={{
                                            padding: "4px 8px",
                                            textAlign: "left",
                                            fontWeight: 600,
                                            borderBottom: "1px solid #d9d9d9",
                                          }}
                                        >
                                          Type
                                        </th>
                                        <th
                                          style={{
                                            padding: "4px 8px",
                                            textAlign: "left",
                                            fontWeight: 600,
                                            borderBottom: "1px solid #d9d9d9",
                                          }}
                                        >
                                          Status
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {vents.map((v, idx) => (
                                        <tr
                                          key={idx}
                                          style={{
                                            borderBottom: "1px solid #f0f0f0",
                                          }}
                                        >
                                          <td style={{ padding: "3px 8px" }}>
                                            Vent {v?.ventNo || idx + 1}
                                          </td>
                                          <td style={{ padding: "3px 8px" }}>
                                            {v?.ventType || "—"}
                                          </td>
                                          <td style={{ padding: "3px 8px" }}>
                                            <Tag
                                              color={
                                                statusColor[v?.status]
                                                  ? undefined
                                                  : "default"
                                              }
                                              style={{
                                                fontSize: 10,
                                                color: statusColor[v?.status],
                                                borderColor:
                                                  statusColor[v?.status],
                                                background: "transparent",
                                              }}
                                            >
                                              {v?.status || "Active"}
                                            </Tag>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                                {Object.keys(ventStatusMap).length > 0 && (
                                  <div
                                    style={{
                                      marginTop: 6,
                                      display: "flex",
                                      gap: 6,
                                      flexWrap: "wrap",
                                    }}
                                  >
                                    {Object.entries(ventStatusMap).map(
                                      ([s, c]) => (
                                        <Tag
                                          key={s}
                                          style={{
                                            fontSize: 10,
                                            color: statusColor[s],
                                            borderColor: statusColor[s],
                                            background: "transparent",
                                          }}
                                        >
                                          {c} {s}
                                        </Tag>
                                      ),
                                    )}
                                  </div>
                                )}
                              </Card>
                            </Col>
                          </Row>
                        );
                      }}
                    </Form.Item>
                    <Card
                      size="small"
                      style={{ borderRadius: 8, marginBottom: 16 }}
                    >
                      <Row gutter={[12, 12]} align="middle">
                        <Col xs={24} md={8}>
                          <Form.Item
                            name="hasWastewaterTreatmentFacility"
                            valuePropName="checked"
                            style={{ marginBottom: 0 }}
                          >
                            <Checkbox>Wastewater Treatment Facility</Checkbox>
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                          <Form.Item
                            noStyle
                            dependencies={["hasWastewaterTreatmentFacility"]}
                          >
                            {() => (
                              <Form.Item
                                name="wastewaterTreatmentFacilityType"
                                label="Treatment Type"
                                style={{ marginBottom: 0 }}
                              >
                                <Select
                                  mode="multiple"
                                  allowClear
                                  placeholder="Select treatment type(s)"
                                  disabled={
                                    !form.getFieldValue(
                                      "hasWastewaterTreatmentFacility",
                                    )
                                  }
                                  options={WWTF_TYPE_OPTIONS}
                                />
                              </Form.Item>
                            )}
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                          <Form.Item
                            noStyle
                            dependencies={["hasWastewaterTreatmentFacility"]}
                          >
                            {() => (
                              <Form.Item
                                name="wastewaterTreatmentFacilityRemarks"
                                label="Remarks"
                                style={{ marginBottom: 0 }}
                              >
                                <Input.TextArea
                                  rows={2}
                                  placeholder="Add WWTF remarks"
                                  disabled={
                                    !form.getFieldValue(
                                      "hasWastewaterTreatmentFacility",
                                    )
                                  }
                                />
                              </Form.Item>
                            )}
                          </Form.Item>
                        </Col>
                      </Row>
                    </Card>

                    <Divider
                      orientation="left"
                      style={{ fontSize: 13, color: "#1677ff", marginTop: 0 }}
                    >
                      <AlertOutlined style={{ marginRight: 6 }} />
                      Leachate Treatment Plant
                    </Divider>
                    <Form.List name="leachatePondDetails">
                      {(fields, { add, remove }) => (
                        <>
                          <Table
                            size="small"
                            pagination={false}
                            dataSource={fields}
                            rowKey="key"
                            locale={{
                              emptyText:
                                "No Leachate Treatment Plant added yet",
                            }}
                            scroll={{ x: 760 }}
                            style={{ marginBottom: 8 }}
                            columns={[
                              {
                                title: "Pond No.",
                                width: 100,
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "pondNo"]}
                                    style={{ margin: 0 }}
                                  >
                                    <InputNumber
                                      size="small"
                                      style={{ width: "100%" }}
                                      min={1}
                                      precision={0}
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "Status",
                                width: 180,
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "status"]}
                                    style={{ margin: 0 }}
                                  >
                                    <Select
                                      size="small"
                                      placeholder="Select status"
                                      options={[
                                        { label: "Active", value: "Active" },
                                        {
                                          label: "Inactive",
                                          value: "Inactive",
                                        },
                                        {
                                          label: "Under Maintenance",
                                          value: "Under Maintenance",
                                        },
                                        {
                                          label: "Decommissioned",
                                          value: "Decommissioned",
                                        },
                                      ]}
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "Description / Condition Notes",
                                width: 320,
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "description"]}
                                    style={{ margin: 0 }}
                                  >
                                    <Input.TextArea
                                      rows={1}
                                      placeholder="Pond dimensions, lining type, current condition..."
                                      autoSize={{ minRows: 1, maxRows: 3 }}
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "",
                                width: 56,
                                align: "center",
                                render: (_, field) => (
                                  <Button
                                    size="small"
                                    type="text"
                                    danger
                                    icon={<DeleteOutlined />}
                                    onClick={() => remove(field.name)}
                                  />
                                ),
                              },
                            ]}
                          />
                          <Button
                            type="dashed"
                            onClick={() =>
                              add({
                                pondNo: fields.length + 1,
                                status: "Active",
                              })
                            }
                            block
                            icon={<PlusOutlined />}
                            style={{ marginBottom: 4 }}
                          >
                            Add Leachate Treatment Plant
                          </Button>
                        </>
                      )}
                    </Form.List>

                    <Divider
                      orientation="left"
                      style={{
                        fontSize: 13,
                        color: "#52c41a",
                        marginTop: 16,
                      }}
                    >
                      <ExperimentOutlined style={{ marginRight: 6 }} />
                      Gas Management
                    </Divider>
                    <Form.List name="gasVentDetails">
                      {(fields, { add, remove }) => (
                        <>
                          <Table
                            size="small"
                            pagination={false}
                            dataSource={fields}
                            rowKey="key"
                            locale={{
                              emptyText:
                                "No gas management records added yet",
                            }}
                            scroll={{ x: 770 }}
                            style={{ marginBottom: 8 }}
                            columns={[
                              {
                                title: "Vent No.",
                                width: 100,
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "ventNo"]}
                                    style={{ margin: 0 }}
                                  >
                                    <InputNumber
                                      size="small"
                                      style={{ width: "100%" }}
                                      min={1}
                                      precision={0}
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "Type",
                                width: 170,
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "ventType"]}
                                    style={{ margin: 0 }}
                                  >
                                    <Select
                                      size="small"
                                      placeholder="Select type"
                                      allowClear
                                      options={[
                                        {
                                          label: "Passive",
                                          value: "Passive",
                                        },
                                        { label: "Flare", value: "Flare" },
                                        {
                                          label: "LFG Recovery",
                                          value: "LFG Recovery",
                                        },
                                        { label: "Other", value: "Other" },
                                      ]}
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "Status",
                                width: 180,
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "status"]}
                                    style={{ margin: 0 }}
                                  >
                                    <Select
                                      size="small"
                                      placeholder="Select status"
                                      options={[
                                        { label: "Active", value: "Active" },
                                        {
                                          label: "Inactive",
                                          value: "Inactive",
                                        },
                                        {
                                          label: "Under Maintenance",
                                          value: "Under Maintenance",
                                        },
                                        {
                                          label: "Decommissioned",
                                          value: "Decommissioned",
                                        },
                                      ]}
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "Description / Notes",
                                width: 320,
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "description"]}
                                    style={{ margin: 0 }}
                                  >
                                    <Input.TextArea
                                      rows={1}
                                      placeholder="Pipe diameter, depth, condition..."
                                      autoSize={{ minRows: 1, maxRows: 3 }}
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "",
                                width: 56,
                                align: "center",
                                render: (_, field) => (
                                  <Button
                                    size="small"
                                    type="text"
                                    danger
                                    icon={<DeleteOutlined />}
                                    onClick={() => remove(field.name)}
                                  />
                                ),
                              },
                            ]}
                          />
                          <Button
                            type="dashed"
                            onClick={() =>
                              add({
                                ventNo: fields.length + 1,
                                status: "Active",
                              })
                            }
                            block
                            icon={<PlusOutlined />}
                            style={{ marginBottom: 4 }}
                          >
                            Add Gas Management Record
                          </Button>
                        </>
                      )}
                    </Form.List>
                  </>
                ),
              },
              {
                key: "cell-infra",
                label: (
                  <span style={{ color: "#13c2c2" }}>
                    <BarChartOutlined /> Cell Infrastructure
                  </span>
                ),
                children: (
                  <>
                    <Row gutter={12}>
                      <Col span={8}>
                        <Form.Item name="numberOfCell" label="No. of Cells">
                          <Select
                            placeholder="Select"
                            allowClear
                            options={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(
                              (n) => ({ label: `${n}`, value: n }),
                            )}
                            onChange={(val) => {
                              const cur =
                                form.getFieldValue("cellCapacities") || [];
                              const curUnits =
                                form.getFieldValue("cellCapacityUnits") || [];
                              const curSt =
                                form.getFieldValue("cellStatuses") || [];
                              const curTy =
                                form.getFieldValue("cellTypes") || [];
                              const curSubAllowed =
                                form.getFieldValue("cellSubmissionAllowed") ||
                                [];
                              const curNotes =
                                form.getFieldValue("cellNotes") || [];
                              const curFill =
                                form.getFieldValue("cellFillValues") || [];
                              const curFillUnits =
                                form.getFieldValue("cellFillUnits") || [];
                              const declaredUnit = normalizeUnit(
                                form.getFieldValue("wasteReceivedUnit") ||
                                  form.getFieldValue("volumeCapacityUnit") ||
                                  curUnits.find(Boolean) ||
                                  curFillUnits.find(Boolean) ||
                                  "tons",
                              );
                              const next = Array.from(
                                { length: val || 0 },
                                (_, i) => cur[i] ?? null,
                              );
                              const nextUnits = Array.from(
                                { length: val || 0 },
                                (_, i) => curUnits[i] || declaredUnit,
                              );
                              const nextSt = Array.from(
                                { length: val || 0 },
                                (_, i) => normalizeCellStatus(curSt[i]),
                              );
                              const nextTy = Array.from(
                                { length: val || 0 },
                                (_, i) => curTy[i] || "Residual",
                              );
                              const nextSubAllowed = Array.from(
                                { length: val || 0 },
                                (_, i) =>
                                  curSubAllowed[i] === undefined
                                    ? true
                                    : curSubAllowed[i],
                              );
                              const nextNotes = Array.from(
                                { length: val || 0 },
                                (_, i) => curNotes[i] || "",
                              );
                              const nextFill = Array.from(
                                { length: val || 0 },
                                (_, i) => curFill[i] ?? null,
                              );
                              const nextFillUnits = Array.from(
                                { length: val || 0 },
                                (_, i) =>
                                  curFillUnits[i] || nextUnits[i] || declaredUnit,
                              );
                              form.setFieldsValue({
                                cellCapacities: next,
                                cellCapacityUnits: nextUnits,
                                cellStatuses: nextSt,
                                cellTypes: nextTy,
                                cellSubmissionAllowed: nextSubAllowed,
                                cellNotes: nextNotes,
                                cellFillValues: nextFill,
                                cellFillUnits: nextFillUnits,
                                volumeCapacityUnit: declaredUnit,
                                receivingVolumeCapacityUnit: declaredUnit,
                                wasteReceivedUnit: declaredUnit,
                                estimatedVolumeWasteUnit: declaredUnit,
                              });
                            }}
                          />
                        </Form.Item>
                      </Col>
                      {/* #3: editable Waste Received under Cell Infrastructure.
                          Binds to the EXISTING facility field `actualResidualWasteReceived`
                          (no duplicate field is created) + its `wasteReceivedUnit`.
                          The unit follows the facility's declared baseline unit
                          (locked addon, mirroring the per-cell unit rule). Feeds the
                          utilization preview when no per-cell fill values are set. */}
                      <Col xs={24} sm={16} md={10}>
                        <Form.Item
                          noStyle
                          dependencies={["wasteReceivedUnit", "volumeCapacityUnit"]}
                        >
                          {() => {
                            const wrUnit = normalizeUnit(
                              form.getFieldValue("wasteReceivedUnit") ||
                                form.getFieldValue("volumeCapacityUnit") ||
                                "m³",
                            );
                            return (
                              <Form.Item
                                name="actualResidualWasteReceived"
                                label="Waste Received"
                                tooltip="Total waste this facility has received (since start of operation). Used for capacity utilization when no per-cell fill values are recorded. 0 is a valid value."
                                rules={[
                                  {
                                    type: "number",
                                    min: 0,
                                    message: "Must be 0 or greater",
                                  },
                                ]}
                              >
                                <InputNumber
                                  style={{ width: "100%" }}
                                  min={0}
                                  step={THREE_DECIMAL_STEP}
                                  precision={3}
                                  placeholder="0.000"
                                  addonAfter={wrUnit}
                                  formatter={formatThreeDecimalInput}
                                  parser={parseDecimalInput}
                                />
                              </Form.Item>
                            );
                          }}
                        </Form.Item>
                      </Col>
                    </Row>

                    {/* THE cell-rename bug lived here.
                        `dependencies` on a render-prop Form.Item (no `name`) only
                        re-renders when a changed field's name path matches EXACTLY.
                        Renaming a cell writes ["cellNames", i], which never matches
                        the declared ["cellNames"], so this whole panel — headers,
                        gauges, capacity readouts — kept rendering the previous
                        value until some unrelated top-level field happened to
                        change. That is why renames appeared to apply inconsistently.
                        shouldUpdate is consulted on every store change; the cell
                        arrays are replaced immutably on write, so a reference
                        comparison catches every per-cell edit. */}
                    <Form.Item
                      noStyle
                      shouldUpdate={(prev, cur) =>
                        prev.numberOfCell !== cur.numberOfCell ||
                        CELL_ARRAY_FIELDS.some((field) => prev[field] !== cur[field])
                      }
                    >
                      {() => {
                        const cellCount =
                          form.getFieldValue("numberOfCell") || 0;
                        if (cellCount < 1) return null;
                        // #5/#7: cells use the facility's single declared baseline
                        // unit (shown as a locked addon), not a per-cell picker.
                        const cellBaselineUnit =
                          normalizeUnit(
                            form.getFieldValue("wasteReceivedUnit") ||
                              form.getFieldValue("volumeCapacityUnit") ||
                              (form.getFieldValue("cellCapacityUnits") || []).find(Boolean) ||
                              (form.getFieldValue("cellFillUnits") || []).find(Boolean) ||
                              "tons",
                          ) || "tons";
                        return (
                          <>
                            <Divider
                              plain
                              orientation="left"
                              style={{ fontSize: 12, margin: "8px 0 12px" }}
                            >
                              Cell Capacities, Status &amp; Type{" "}
                              <Text
                                type="secondary"
                                style={{ fontSize: 11, fontWeight: 400 }}
                              >
                                (units in {cellBaselineUnit})
                              </Text>
                            </Divider>
                            <Row gutter={[12, 12]}>
                              {Array.from({ length: cellCount }, (_, i) => {
                                const cellStatus = normalizeCellStatus(
                                  form.getFieldValue(["cellStatuses", i]),
                                );
                                const needsNote =
                                  cellStatus === "Under Construction" ||
                                  cellStatus === "Reserved Area" ||
                                  cellStatus === "Not Existed";
                                const sc =
                                  CELL_STATUS_COLORS[cellStatus] ||
                                  CELL_STATUS_COLORS["Active Cell"];
                                return (
                                  // 3 cards per row on large desktop, 2 on medium,
                                  // 1 on small — consistent height + spacing.
                                  <Col xs={24} sm={24} md={12} lg={8} key={i}>
                                    <Collapse
                                      size="small"
                                      variant="filled"
                                      defaultActiveKey={[]}
                                      destroyOnHidden
                                      expandIconPosition="end"
                                      style={{
                                        borderRadius: 8,
                                        borderLeft: `4px solid ${sc.border}`,
                                        background: isDark ? sc.dark : sc.bg,
                                        height: "100%",
                                      }}
                                      styles={{
                                        header: { padding: "8px 10px" },
                                        body: { padding: "10px 12px" },
                                      }}
                                      items={[
                                        {
                                          key: `cell-${i}`,
                                          label: (
                                            <Space size={6} wrap>
                                              <div
                                                style={{
                                                  width: 10,
                                                  height: 10,
                                                  borderRadius: "50%",
                                                  background: sc.border,
                                                  flexShrink: 0,
                                                }}
                                              />
                                              <Text
                                                strong
                                                style={{ fontSize: 12 }}
                                              >
                                                {String(
                                                  form.getFieldValue([
                                                    "cellNames",
                                                    i,
                                                  ]) || "",
                                                ).trim() || `Cell ${i + 1}`}
                                              </Text>
                                              <Tag
                                                color={sc.tag}
                                                style={{
                                                  fontSize: 10,
                                                  margin: 0,
                                                }}
                                              >
                                                {cellStatus}
                                              </Tag>
                                            </Space>
                                          ),
                                          children: (
                                            <>
                                              {/* #5: related fields grouped into rows to cut
                                        wasted vertical space; units locked to the
                                        facility baseline unit (addon), no per-cell
                                        picker. */}
                                              <Form.Item
                                                label="Cell Name"
                                                name={["cellNames", i]}
                                                style={{ marginBottom: 8 }}
                                                tooltip={`Optional custom name for this cell. Leave blank to use the default "Cell ${i + 1}". Renaming updates how this cell appears in the SLF Portal, baseline, breakdown, and reports.`}
                                              >
                                                <Input
                                                  placeholder={`Cell ${i + 1}`}
                                                  maxLength={60}
                                                  allowClear
                                                />
                                              </Form.Item>
                                              <Row gutter={8}>
                                                <Col span={12}>
                                                  <Form.Item
                                                    label="Capacity"
                                                    name={[
                                                      "cellCapacities",
                                                      i,
                                                    ]}
                                                    style={{
                                                      marginBottom: 8,
                                                    }}
                                                  >
                                                    <InputNumber
                                                      style={{
                                                        width: "100%",
                                                      }}
                                                      min={0}
                                                      step={THREE_DECIMAL_STEP}
                                                      precision={3}
                                                      placeholder="Capacity"
                                                      addonAfter={
                                                        cellBaselineUnit
                                                      }
                                                      formatter={formatThreeDecimalInput}
                                                      parser={parseDecimalInput}
                                                    />
                                                  </Form.Item>
                                                </Col>
                                                <Col span={12}>
                                                  <Form.Item
                                                    label="Waste in Cell"
                                                    name={[
                                                      "cellFillValues",
                                                      i,
                                                    ]}
                                                    style={{
                                                      marginBottom: 8,
                                                    }}
                                                  >
                                                    <InputNumber
                                                      style={{
                                                        width: "100%",
                                                      }}
                                                      min={0}
                                                      step={THREE_DECIMAL_STEP}
                                                      precision={3}
                                                      placeholder="Deposited"
                                                      addonAfter={
                                                        cellBaselineUnit
                                                      }
                                                      formatter={formatThreeDecimalInput}
                                                      parser={parseDecimalInput}
                                                      onChange={(value) =>
                                                        handleCellFillValueChange(
                                                          i,
                                                          value,
                                                        )
                                                      }
                                                    />
                                                  </Form.Item>
                                                </Col>
                                              </Row>
                                              <Row gutter={8}>
                                                <Col span={12}>
                                                  <Form.Item
                                                    name={["cellStatuses", i]}
                                                    label="Status"
                                                    initialValue="Active Cell"
                                                    style={{
                                                      marginBottom: 8,
                                                    }}
                                                  >
                                                    <Select
                                                      options={
                                                        CELL_STATUS_OPTIONS
                                                      }
                                                    />
                                                  </Form.Item>
                                                </Col>
                                                <Col span={12}>
                                                  <Form.Item
                                                    name={["cellTypes", i]}
                                                    label="Type"
                                                    initialValue="Residual"
                                                    style={{
                                                      marginBottom: 8,
                                                    }}
                                                  >
                                                    <Select
                                                      options={[
                                                        {
                                                          label:
                                                            "Residual Cell",
                                                          value: "Residual",
                                                        },
                                                        {
                                                          label:
                                                            "Treated Haz Waste Cell",
                                                          value:
                                                            "Treated Haz Waste",
                                                        },
                                                      ]}
                                                    />
                                                  </Form.Item>
                                                </Col>
                                              </Row>
                                              <Row gutter={8} align="bottom">
                                                <Col span={12}>
                                                  <Form.Item
                                                    label="Cell ON/OFF"
                                                    style={{
                                                      marginBottom: 0,
                                                    }}
                                                  >
                                                    <Switch
                                                      checked={isActiveCellStatus(
                                                        cellStatus,
                                                      )}
                                                      loading={!!cellActionSaving[`status-${i}`]}
                                                      checkedChildren="ON"
                                                      unCheckedChildren="OFF"
                                                      onChange={(checked) =>
                                                        saveCellStatusNow(
                                                          i,
                                                          checked ? "Active Cell" : "Used/Completed",
                                                        )
                                                      }
                                                    />
                                                  </Form.Item>
                                                </Col>
                                                <Col span={12}>
                                                  <Form.Item
                                                    name={[
                                                      "cellSubmissionAllowed",
                                                      i,
                                                    ]}
                                                    label={
                                                      <Tooltip title="When ON, SLF/portal users can select this cell when disposing their volume-waste submissions in the Add Transport Entry form. Only Active/Open cells appear in the portal.">
                                                        <span>
                                                          Allow Portal
                                                          Submissions{" "}
                                                          <InfoCircleOutlined
                                                            style={{
                                                              color:
                                                                "#13c2c2",
                                                            }}
                                                          />
                                                        </span>
                                                      </Tooltip>
                                                    }
                                                    valuePropName="checked"
                                                    initialValue={true}
                                                    style={{
                                                      marginBottom: 0,
                                                    }}
                                                  >
                                                    <Switch
                                                      checkedChildren="Open"
                                                      unCheckedChildren="Off"
                                                      loading={!!cellActionSaving[`portal-${i}`]}
                                                      disabled={
                                                        !isActiveCellStatus(
                                                          cellStatus,
                                                        )
                                                      }
                                                      onChange={(checked) =>
                                                        saveCellSubmissionAllowedNow(i, checked)
                                                      }
                                                    />
                                                  </Form.Item>
                                                </Col>
                                              </Row>
                                              {needsNote && (
                                                <Form.Item
                                                  name={["cellNotes", i]}
                                                  label="Notes"
                                                  style={{
                                                    marginBottom: 0,
                                                    marginTop: 8,
                                                  }}
                                                >
                                                  <Input.TextArea
                                                    rows={2}
                                                    placeholder={
                                                      cellStatus ===
                                                      "Under Construction"
                                                        ? "Target completion date, contractor, current progress..."
                                                        : "Planned use, estimated activation date, reserved for..."
                                                    }
                                                    style={{ resize: "none" }}
                                                  />
                                                </Form.Item>
                                              )}
                                            </>
                                          ),
                                        },
                                      ]}
                                    />
                                  </Col>
                                );
                              })}
                            </Row>
                          </>
                        );
                      }}
                    </Form.Item>
                    <Form.Item
                      noStyle
                      dependencies={[
                        "numberOfCell",
                        "cellCapacities",
                        "cellCapacityUnits",
                        "cellStatuses",
                        "cellTypes",
                        "cellSubmissionAllowed",
                        "cellNotes",
                        "cellFillValues",
                        "cellFillUnits",
                        "volumeCapacity",
                        "actualResidualWasteReceived",
                        "wasteReceivedUnit",
                      ]}
                    >
                      {() => {
                        const cellCount =
                          form.getFieldValue("numberOfCell") || 0;
                        const caps =
                          form.getFieldValue("cellCapacities") || [];
                        const capUnits =
                          form.getFieldValue("cellCapacityUnits") || [];
                        const statuses =
                          form.getFieldValue("cellStatuses") || [];
                        const types = form.getFieldValue("cellTypes") || [];
                        const cellNotes =
                          form.getFieldValue("cellNotes") || [];
                        const fills =
                          form.getFieldValue("cellFillValues") || [];
                        const fillUnits =
                          form.getFieldValue("cellFillUnits") || [];
                        const cellDisplayUnit = normalizeUnit(
                          form.getFieldValue("wasteReceivedUnit") ||
                            form.getFieldValue("volumeCapacityUnit") ||
                            capUnits.find(Boolean) ||
                            fillUnits.find(Boolean) ||
                            form.getFieldValue("wasteReceivedUnit") ||
                            "m³",
                        );
                        const cellCapacityTotal = Array.from(
                          { length: cellCount },
                          (_, index) =>
                            convertVolume(
                              caps[index] || 0,
                              capUnits[index] || cellDisplayUnit,
                              cellDisplayUnit,
                            ),
                        ).reduce((sum, value) => sum + value, 0);
                        const cellFillTotal = Array.from(
                          { length: cellCount },
                          (_, index) => {
                            const fill = fills[index];
                            if (fill == null) return 0;
                            return convertVolume(
                              fill,
                              fillUnits[index] || cellDisplayUnit,
                              cellDisplayUnit,
                            );
                          },
                        ).reduce((sum, value) => sum + value, 0);
                        const fallbackCapacity = convertVolume(
                          form.getFieldValue("volumeCapacity") || 0,
                          form.getFieldValue("volumeCapacityUnit") ||
                            cellDisplayUnit,
                          cellDisplayUnit,
                        );
                        const fallbackWaste = convertVolume(
                          form.getFieldValue("actualResidualWasteReceived") ||
                            0,
                          form.getFieldValue("wasteReceivedUnit") ||
                            cellDisplayUnit,
                          cellDisplayUnit,
                        );
                        const totalCap =
                          cellCapacityTotal || fallbackCapacity;
                        const wasteRaw = cellFillTotal || fallbackWaste;
                        const wasteUnit = cellDisplayUnit;
                        const pct =
                          totalCap > 0
                            ? Math.min(
                                Math.round((wasteRaw / totalCap) * 100),
                                100,
                              )
                            : 0;
                        if (cellCount < 1)
                          return (
                            <Empty description="Select number of cells to see infrastructure preview" />
                          );

                        const STATUS_STROKE = {
                          "Active Cell": (p) =>
                            p >= 90
                              ? "#ff4d4f"
                              : p >= 70
                                ? "#faad14"
                                : "#52c41a",
                          "Used/Completed": () => "#8c8c8c",
                          "Under Construction": () => "#fa8c16",
                          "Reserved Area": () => "#722ed1",
                          "Not Existed": () => "#bfbfbf",
                        };
                        const STATUS_TAG = Object.fromEntries(
                          Object.entries(CELL_STATUS_COLORS).map(
                            ([key, value]) => [key, value.tag],
                          ),
                        );

                        // Use per-cell fill values; fall back to overall pct if no fill entered for the cell
                        const cellDonutData = Array.from(
                          { length: cellCount },
                          (_, i) => {
                            const cap = caps[i] || 0;
                            const capUnit = normalizeUnit(
                              capUnits[i] || "m³",
                            );
                            const st = normalizeCellStatus(statuses[i]);
                            const ty = types[i] || "Residual";
                            const note = cellNotes[i] || "";
                            const isInactive = !isActiveCellStatus(st);
                            const fillRaw =
                              fills[i] != null ? fills[i] : null;
                            const fillUnit = normalizeUnit(
                              fillUnits[i] || capUnit,
                            );
                            const fillInCapacityUnit =
                              fillRaw != null
                                ? convertVolume(fillRaw, fillUnit, capUnit)
                                : null;
                            let displayPct = 0;
                            let usedInCapacityUnit = 0;
                            if (!isInactive) {
                              if (fillInCapacityUnit != null && cap > 0) {
                                usedInCapacityUnit = fillInCapacityUnit;
                                displayPct = Math.min(
                                  Math.round(
                                    (fillInCapacityUnit / cap) * 100,
                                  ),
                                  100,
                                );
                              } else if (cap > 0) {
                                displayPct = pct;
                                usedInCapacityUnit = (pct / 100) * cap;
                              }
                            }
                            return {
                              index: i,
                              // Resolved from the SAME live form value the cell
                              // Card header uses, so a renamed cell reads
                              // identically in the card and on its gauge. The
                              // gauge previously hardcoded `Cell {index + 1}` and
                              // silently ignored the custom name.
                              name:
                                String(
                                  form.getFieldValue(["cellNames", i]) || "",
                                ).trim() || `Cell ${i + 1}`,
                              capacity: cap,
                              capacityUnit: capUnit,
                              fillUnit,
                              status: st,
                              cellType: ty,
                              note,
                              pct: displayPct,
                              used: Math.min(usedInCapacityUnit, cap),
                              remaining: Math.max(
                                0,
                                cap - Math.min(usedInCapacityUnit, cap),
                              ),
                              hasCellFill: fillRaw != null,
                            };
                          },
                        );

                        return (
                          <Card
                            size="small"
                            style={{
                              borderRadius: 10,
                              marginTop: 8,
                              background: isDark ? "#1f1f1f" : "#fafafa",
                            }}
                          >
                            {/* Overall facility gauge + per-cell gauges */}
                            <Row gutter={16} align="middle">
                              <Col
                                xs={24}
                                md={6}
                                style={{ textAlign: "center" }}
                              >
                                <Progress
                                  type="dashboard"
                                  percent={pct}
                                  size={110}
                                  strokeLinecap="butt"
                                  strokeColor={
                                    pct >= 90
                                      ? "#ff4d4f"
                                      : pct >= 70
                                        ? "#faad14"
                                        : "#52c41a"
                                  }
                                  format={() => (
                                    <div style={{ lineHeight: 1.3 }}>
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
                                        overall
                                      </div>
                                    </div>
                                  )}
                                />
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: "#8c8c8c",
                                    marginTop: 4,
                                  }}
                                >
                                  {wasteRaw > 0
                                    ? wasteRaw.toLocaleString()
                                    : "0"}{" "}
                                  {cellDisplayUnit} /{" "}
                                  {totalCap > 0
                                    ? totalCap.toLocaleString()
                                    : "—"}{" "}
                                  {cellDisplayUnit}
                                  {cellDisplayUnit === "tons" &&
                                    wasteRaw > 0 && (
                                      <div
                                        style={{
                                          fontSize: 10,
                                          color: "#8c8c8c",
                                        }}
                                      >
                                        approx.{" "}
                                        {convertVolume(
                                          wasteRaw,
                                          wasteUnit,
                                          "m³",
                                        ).toLocaleString(undefined, {
                                          maximumFractionDigits: 0,
                                        })}{" "}
                                        m³ (at 0.50 t/m³)
                                      </div>
                                    )}
                                </div>
                              </Col>
                              <Col xs={24} md={18}>
                                {(() => {
                                  const residualGauges = cellDonutData.filter(
                                    (c) => c.cellType !== "Treated Haz Waste",
                                  );
                                  const hazGauges = cellDonutData.filter(
                                    (c) => c.cellType === "Treated Haz Waste",
                                  );
                                  const renderGaugeGroup = (cells) => (
                                    <Row gutter={[8, 8]} justify="start">
                                      {cells.map((cell) => {
                                        const isInactive =
                                          !isActiveCellStatus(cell.status);
                                        const isHaz =
                                          cell.cellType ===
                                          "Treated Haz Waste";
                                        const strokeFn =
                                          STATUS_STROKE[cell.status] ||
                                          STATUS_STROKE["Active Cell"];
                                        const strokeColor = isInactive
                                          ? strokeFn(0)
                                          : isHaz
                                            ? "#f5222d"
                                            : strokeFn(cell.pct);
                                        const tagColor =
                                          STATUS_TAG[cell.status] ||
                                          "default";
                                        return (
                                          <Col
                                            xs={12}
                                            sm={8}
                                            md={6}
                                            key={cell.index}
                                            style={{ textAlign: "center" }}
                                          >
                                            <Progress
                                              type="dashboard"
                                              percent={
                                                isInactive ? 0 : cell.pct
                                              }
                                              size={65}
                                              strokeLinecap="butt"
                                              strokeColor={strokeColor}
                                              trailColor={
                                                isCompletedCellStatus(
                                                  cell.status,
                                                )
                                                  ? "#bfbfbf"
                                                  : undefined
                                              }
                                              format={() => (
                                                <div
                                                  style={{ lineHeight: 1.2 }}
                                                >
                                                  <div
                                                    style={{
                                                      fontSize: 11,
                                                      fontWeight: 700,
                                                      color: strokeColor,
                                                    }}
                                                  >
                                                    {isCompletedCellStatus(
                                                      cell.status,
                                                    )
                                                      ? "Done"
                                                      : isInactive
                                                        ? "—"
                                                        : `${cell.pct}%`}
                                                  </div>
                                                </div>
                                              )}
                                            />
                                            <div
                                              style={{
                                                fontSize: 11,
                                                fontWeight: 600,
                                                marginTop: 2,
                                              }}
                                            >
                                              {cell.name}
                                            </div>
                                            <Tag
                                              color={tagColor}
                                              style={{
                                                fontSize: 9,
                                                marginTop: 2,
                                                marginBottom: 2,
                                              }}
                                            >
                                              {cell.status}
                                            </Tag>
                                            <Tag
                                              color={isHaz ? "red" : "blue"}
                                              style={{
                                                fontSize: 9,
                                                marginBottom: 2,
                                              }}
                                            >
                                              {isHaz ? "Haz" : "Res"}
                                            </Tag>
                                            <div
                                              style={{
                                                fontSize: 10,
                                                color: "#8c8c8c",
                                              }}
                                            >
                                              {cell.capacity > 0
                                                ? `${cell.capacity.toLocaleString()} ${cell.capacityUnit}`
                                                : "—"}
                                            </div>
                                            {cell.hasCellFill &&
                                              cell.used > 0 && (
                                                <div
                                                  style={{
                                                    fontSize: 9,
                                                    color: "#1677ff",
                                                  }}
                                                >
                                                  {cell.used.toLocaleString()}{" "}
                                                  {cell.capacityUnit} filled
                                                </div>
                                              )}
                                            {cell.note && (
                                              <Tooltip title={cell.note}>
                                                <div
                                                  style={{
                                                    fontSize: 9,
                                                    color: "#595959",
                                                    fontStyle: "italic",
                                                    marginTop: 2,
                                                    maxWidth: 80,
                                                    overflow: "hidden",
                                                    textOverflow: "ellipsis",
                                                    whiteSpace: "nowrap",
                                                  }}
                                                >
                                                  {cell.note}
                                                </div>
                                              </Tooltip>
                                            )}
                                          </Col>
                                        );
                                      })}
                                    </Row>
                                  );
                                  return (
                                    <>
                                      {residualGauges.length > 0 && (
                                        <>
                                          {hazGauges.length > 0 && (
                                            <div
                                              style={{
                                                fontSize: 10,
                                                fontWeight: 600,
                                                color: "#1677ff",
                                                marginBottom: 4,
                                              }}
                                            >
                                              Residual Cells
                                            </div>
                                          )}
                                          {renderGaugeGroup(residualGauges)}
                                        </>
                                      )}
                                      {hazGauges.length > 0 && (
                                        <>
                                          <div
                                            style={{
                                              fontSize: 10,
                                              fontWeight: 600,
                                              color: "#f5222d",
                                              marginTop:
                                                residualGauges.length > 0
                                                  ? 8
                                                  : 0,
                                              marginBottom: 4,
                                            }}
                                          >
                                            Treated Haz Waste Cells
                                          </div>
                                          {renderGaugeGroup(hazGauges)}
                                        </>
                                      )}
                                    </>
                                  );
                                })()}
                              </Col>
                            </Row>

                            {/* Colour key for the gauges above. Until this existed
                                the arcs carried no explanation of what green/amber/
                                red meant, nor what volume the percentage was made
                                of. Colours come from the shared palette so they
                                match every other gauge in the app. */}
                            <CellGaugeLegend isDark={isDark} />

                            {/* Per-cell donut breakdown — grouped by cell type */}
                            {cellCount >= 2 &&
                              cellDonutData.some((c) => c.capacity > 0) &&
                              (() => {
                                const residualDonuts = cellDonutData.filter(
                                  (c) =>
                                    c.capacity > 0 &&
                                    c.cellType !== "Treated Haz Waste",
                                );
                                const hazDonuts = cellDonutData.filter(
                                  (c) =>
                                    c.capacity > 0 &&
                                    c.cellType === "Treated Haz Waste",
                                );
                                const renderDonutGroup = (cells) => (
                                  <Row gutter={[4, 4]} justify="center">
                                    {cells.map((cell) => {
                                      const isInactive = !isActiveCellStatus(
                                        cell.status,
                                      );
                                      const isHaz =
                                        cell.cellType === "Treated Haz Waste";
                                      const chartData = isInactive
                                        ? [
                                            {
                                              name: cell.status,
                                              value: cell.capacity,
                                            },
                                          ]
                                        : cell.used > 0
                                          ? [
                                              {
                                                name: "Used",
                                                value: cell.used,
                                              },
                                              {
                                                name: "Remaining",
                                                value: cell.remaining,
                                              },
                                            ]
                                          : [
                                              {
                                                name: "Empty",
                                                value: cell.capacity,
                                              },
                                            ];
                                      const inactiveColor =
                                        isCompletedCellStatus(cell.status)
                                          ? "#d9d9d9"
                                          : cell.status ===
                                              "Under Construction"
                                            ? "#fa8c16"
                                            : cell.status === "Reserved Area"
                                              ? "#722ed1"
                                              : "#bfbfbf";
                                      const colors = isInactive
                                        ? [inactiveColor]
                                        : isHaz
                                          ? ["#f5222d", "#d9d9d9"]
                                          : ["#ff4d4f", "#52c41a"];
                                      return (
                                        <Col
                                          xs={12}
                                          sm={8}
                                          md={6}
                                          key={cell.index}
                                          style={{ textAlign: "center" }}
                                        >
                                          <Text
                                            style={{
                                              fontSize: 11,
                                              fontWeight: 600,
                                            }}
                                          >
                                            {/* Same resolved name as the cell card
                                                and the gauge — this pie carried the
                                                positional label too. */}
                                            {cell.name}
                                          </Text>
                                          <PieChart width={110} height={88}>
                                            <Pie
                                              data={chartData}
                                              cx={55}
                                              cy={44}
                                              innerRadius={20}
                                              outerRadius={36}
                                              paddingAngle={
                                                chartData.length > 1 ? 2 : 0
                                              }
                                              dataKey="value"
                                              isAnimationActive={false}
                                              animationBegin={80}
                                              animationDuration={650}
                                            >
                                              {chartData.map((_, j) => (
                                                <RCell
                                                  key={j}
                                                  fill={
                                                    colors[j % colors.length]
                                                  }
                                                />
                                              ))}
                                            </Pie>
                                            <RTooltip
                                              formatter={(v) =>
                                                `${Number(v).toLocaleString()} ${cell.capacityUnit}`
                                              }
                                            />
                                          </PieChart>
                                        </Col>
                                      );
                                    })}
                                  </Row>
                                );
                                return (
                                  <>
                                    {/* <Divider
                                    plain
                                    style={{
                                      fontSize: 11,
                                      margin: "10px 0 6px",
                                    }}
                                  >
                                    Per-Cell Capacity Breakdown
                                  </Divider>
                                  {residualDonuts.length > 0 && (
                                    <>
                                      {hazDonuts.length > 0 && (
                                        <Divider
                                          plain
                                          style={{
                                            fontSize: 10,
                                            margin: "6px 0 4px",
                                            borderColor: "#1677ff",
                                          }}
                                        >
                                          <span style={{ color: "#1677ff" }}>
                                            Residual Cells
                                          </span>
                                        </Divider>
                                      )}
                                      {renderDonutGroup(residualDonuts)}
                                    </>
                                  )}
                                  {hazDonuts.length > 0 && (
                                    <>
                                      <Divider
                                        plain
                                        style={{
                                          fontSize: 10,
                                          margin: "8px 0 4px",
                                          borderColor: "#f5222d",
                                        }}
                                      >
                                        <span style={{ color: "#f5222d" }}>
                                          Treated Haz Waste Cells
                                        </span>
                                      </Divider>
                                      {renderDonutGroup(hazDonuts)}
                                    </>
                                  )} */}
                                  </>
                                );
                              })()}
                          </Card>
                        );
                      }}
                    </Form.Item>
                  </>
                ),
              },
              {
                key: "permits",
                label: (
                  <span style={{ color: "#faad14" }}>
                    <SafetyCertificateOutlined /> Permits
                  </span>
                ),
                children: (
                  <>
                    <Row gutter={[12, 0]}>
                      <Col span={12}>
                        <Form.Item name="eccNo" label="ECC No.">
                          <Input placeholder="Environmental Compliance Certificate number" />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item
                          name="hazwasteGenerationId"
                          label="Hazwaste Gen. ID"
                        >
                          <Input placeholder="Hazardous Waste Generation ID" />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Divider
                      orientation="left"
                      plain
                      style={{ margin: "4px 0 12px", fontSize: 12 }}
                    >
                      <SafetyCertificateOutlined
                        style={{ color: "#1677ff", marginRight: 6 }}
                      />
                      Discharge Permits
                    </Divider>
                    <Form.List name="dischargePermits">
                      {(fields, { add, remove }) => (
                        <>
                          <Table
                            size="small"
                            pagination={false}
                            dataSource={fields}
                            rowKey="key"
                            locale={{
                              emptyText: "No discharge permits added yet",
                            }}
                            columns={[
                              {
                                title: "Permit No.",
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "permitNo"]}
                                    style={{ margin: 0 }}
                                  >
                                    <Input
                                      size="small"
                                      placeholder="Permit number"
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "DP Type",
                                width: 150,
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "permitType"]}
                                    style={{ margin: 0 }}
                                  >
                                    <Select
                                      size="small"
                                      allowClear
                                      placeholder="Type"
                                      options={DP_TYPE_OPTIONS}
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "Validity",
                                width: 170,
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "validity"]}
                                    style={{ margin: 0 }}
                                  >
                                    <DatePicker
                                      size="small"
                                      format="MM/DD/YYYY"
                                      style={{ width: "100%" }}
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "Status",
                                width: 140,
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "status"]}
                                    style={{ margin: 0 }}
                                  >
                                    <Select
                                      size="small"
                                      allowClear
                                      placeholder="Status"
                                      options={PERMIT_STATUS_OPTIONS}
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "",
                                width: 48,
                                render: (_, field) => (
                                  <Button
                                    size="small"
                                    type="text"
                                    danger
                                    icon={<DeleteOutlined />}
                                    onClick={() => remove(field.name)}
                                  />
                                ),
                              },
                            ]}
                          />
                          <Button
                            type="dashed"
                            onClick={() => add({})}
                            block
                            icon={<PlusOutlined />}
                            size="small"
                            style={{ marginTop: 8 }}
                          >
                            Add Discharge Permit
                          </Button>
                        </>
                      )}
                    </Form.List>
                    <Divider
                      orientation="left"
                      plain
                      style={{ margin: "16px 0 12px", fontSize: 12 }}
                    >
                      <SafetyCertificateOutlined
                        style={{ color: "#52c41a", marginRight: 6 }}
                      />
                      Permits to Operate
                    </Divider>
                    <Form.List name="permitToOperatePermits">
                      {(fields, { add, remove }) => (
                        <>
                          <Table
                            size="small"
                            pagination={false}
                            dataSource={fields}
                            rowKey="key"
                            locale={{
                              emptyText: "No permits to operate added yet",
                            }}
                            columns={[
                              {
                                title: "Permit No.",
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "permitNo"]}
                                    style={{ margin: 0 }}
                                  >
                                    <Input
                                      size="small"
                                      placeholder="Permit number"
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "Validity",
                                width: 170,
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "validity"]}
                                    style={{ margin: 0 }}
                                  >
                                    <DatePicker
                                      size="small"
                                      format="MM/DD/YYYY"
                                      style={{ width: "100%" }}
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "Status",
                                width: 140,
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "status"]}
                                    style={{ margin: 0 }}
                                  >
                                    <Select
                                      size="small"
                                      allowClear
                                      placeholder="Status"
                                      options={PERMIT_STATUS_OPTIONS}
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "",
                                width: 48,
                                render: (_, field) => (
                                  <Button
                                    size="small"
                                    type="text"
                                    danger
                                    icon={<DeleteOutlined />}
                                    onClick={() => remove(field.name)}
                                  />
                                ),
                              },
                            ]}
                          />
                          <Button
                            type="dashed"
                            onClick={() => add({})}
                            block
                            icon={<PlusOutlined />}
                            size="small"
                            style={{ marginTop: 8 }}
                          >
                            Add Permit to Operate
                          </Button>
                        </>
                      )}
                    </Form.List>
                  </>
                ),
              },
              {
                key: "preventive",
                label: (
                  <span style={{ color: "#fa8c16" }}>
                    <WarningOutlined /> Preventive Measures
                  </span>
                ),
                children: (
                  <>
                    <Divider orientation="left" plain>
                      Preventive Measure Files
                    </Divider>
                    <Form.Item
                      name="preventiveMeasureFiles"
                      valuePropName="fileList"
                      getValueFromEvent={preventiveUploadEventToFileList}
                    >
                      <Upload
                        {...slfUploadProps}
                        action={
                          driveDisabled
                            ? undefined
                            : "/eswm-pipeline/api/upload"
                        }
                        disabled={driveDisabled}
                        headers={getUploadHeaders()}
                        multiple
                        accept=".pdf,.doc,.docx,.xls,.xlsx,image/*"
                        showUploadList={false}
                      >
                        <Button icon={<UploadOutlined />} disabled={driveDisabled}>
                          Upload Preventive Measure Files (max 200 MB)
                        </Button>
                      </Upload>
                    </Form.Item>
                    <Form.Item
                      noStyle
                      shouldUpdate={(prev, cur) =>
                        prev.preventiveMeasureFiles !== cur.preventiveMeasureFiles
                      }
                    >
                      {() => {
                        const files =
                          form.getFieldValue("preventiveMeasureFiles") || [];
                        if (!files.length) return null;
                        return (
                          <Table
                            size="small"
                            dataSource={files}
                            rowKey={(f) => f.uid || f.url || f.name}
                            pagination={false}
                            tableLayout="fixed"
                            scroll={{ x: 760 }}
                            style={{ marginTop: 8 }}
                            columns={[
                              {
                                title: "File",
                                width: 260,
                                render: (_, f) => {
                                  const url = f.url || f.response?.url;
                                  const kind = getMediaKind(url || f.name || "");
                                  return (
                                    <Space size={6} style={{ width: "100%" }}>
                                      <Tag
                                        icon={kind === "pdf" ? <FilePdfOutlined /> : kind === "image" ? <FileImageOutlined /> : <FileTextOutlined />}
                                        color={url ? "orange" : "default"}
                                        style={{ margin: 0, flex: "0 0 auto" }}
                                      >
                                        {kind || "file"}
                                      </Tag>
                                      <Tooltip title={f.name}>
                                        <Text ellipsis style={{ display: "block", maxWidth: 180, fontSize: 11, whiteSpace: "nowrap" }}>
                                          {f.name || "—"}
                                        </Text>
                                      </Tooltip>
                                    </Space>
                                  );
                                },
                              },
                              {
                                title: "Size",
                                width: 80,
                                render: (_, f) =>
                                  f.size ? (
                                    <Text type="secondary" style={{ fontSize: 11 }}>
                                      {formatFileSize(f.size)}
                                    </Text>
                                  ) : (
                                    "—"
                                  ),
                              },
                              {
                                title: "Progress",
                                width: 190,
                                render: (_, f) => {
                                  if (f.status === "uploading") {
                                    const pct = Math.round(f.percent || 0);
                                    return (
                                      <Tooltip title={`Uploading ${f.name || "file"}: ${pct}%`}>
                                        <Progress
                                          percent={pct}
                                          size="small"
                                          status="active"
                                          style={{ width: 150 }}
                                        />
                                      </Tooltip>
                                    );
                                  }
                                  const url = f.url || f.response?.url;
                                  return (
                                    <Tag
                                      color={
                                        f.status === "error"
                                          ? "red"
                                          : url
                                            ? "green"
                                            : "default"
                                      }
                                    >
                                      {f.status === "error"
                                        ? "Error"
                                        : url
                                          ? "Ready"
                                          : "Pending"}
                                    </Tag>
                                  );
                                },
                              },
                              {
                                title: "Description",
                                width: 260,
                                render: (_, f) => (
                                  <Input.TextArea
                                    autoSize={{ minRows: 1, maxRows: 3 }}
                                    placeholder="Describe this file"
                                    value={f.description || ""}
                                    onChange={(event) => {
                                      const nextDescription = event.target.value;
                                      const cur = form.getFieldValue("preventiveMeasureFiles") || [];
                                      form.setFieldsValue({
                                        preventiveMeasureFiles: cur.map((item) =>
                                          (item.uid || item.url || item.response?.url) === (f.uid || f.url || f.response?.url)
                                            ? { ...item, description: nextDescription }
                                            : item,
                                        ),
                                      });
                                    }}
                                  />
                                ),
                              },
                              {
                                title: "",
                                width: 64,
                                render: (_, f) => {
                                  const url = f.url || f.response?.url;
                                  return (
                                    <Space size={4}>
                                      <Tooltip title="Preview">
                                        <Button
                                          size="small"
                                          icon={<EyeOutlined />}
                                          disabled={!url}
                                          onClick={() =>
                                            openFilePreview(url, f.name)
                                          }
                                        />
                                      </Tooltip>
                                      <Tooltip title="Remove">
                                        <Button
                                          size="small"
                                          danger
                                          icon={<DeleteOutlined />}
                                          onClick={() => {
                                            const cur =
                                              form.getFieldValue(
                                                "preventiveMeasureFiles",
                                              ) || [];
                                            form.setFieldsValue({
                                              preventiveMeasureFiles: cur.filter(
                                                (item) => item.uid !== f.uid,
                                              ),
                                            });
                                          }}
                                        />
                                      </Tooltip>
                                    </Space>
                                  );
                                },
                              },
                            ]}
                          />
                        );
                      }}
                    </Form.Item>
                    <Divider
                      orientation="left"
                      plain
                      style={{ marginTop: 16 }}
                    >
                      Safe Closure and Rehabilitation Plan (SCRP)
                    </Divider>
                    <Form.List name="scrpDetails">
                      {(fields, { add, remove }) => (
                        <>
                          <Table
                            size="small"
                            pagination={false}
                            dataSource={fields}
                            rowKey="key"
                            locale={{ emptyText: "No SCRP entries yet" }}
                            columns={[
                              {
                                title: "Plan / Activity",
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "planTitle"]}
                                    style={{ margin: 0 }}
                                  >
                                    <Input
                                      size="small"
                                      placeholder="SCRP plan or activity"
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "Status",
                                width: 160,
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "status"]}
                                    style={{ margin: 0 }}
                                  >
                                    <Select
                                      size="small"
                                      allowClear
                                      options={[
                                        "Prepared",
                                        "For Revision",
                                        "Submitted",
                                        "Approved",
                                        "Implemented",
                                      ].map((value) => ({
                                        label: value,
                                        value,
                                      }))}
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "Remarks",
                                render: (_, field) => (
                                  <Form.Item
                                    name={[field.name, "remarks"]}
                                    style={{ margin: 0 }}
                                  >
                                    <Input
                                      size="small"
                                      placeholder="Remarks"
                                    />
                                  </Form.Item>
                                ),
                              },
                              {
                                title: "Upload",
                                width: 270,
                                render: (_, field) => (
                                  <Space direction="vertical" size={4} style={{ width: "100%" }}>
                                    <Form.Item
                                      name={[field.name, "attachments"]}
                                      valuePropName="fileList"
                                      getValueFromEvent={uploadEventToFileList}
                                      style={{ margin: 0 }}
                                    >
                                      <Upload
                                        {...slfUploadProps}
                                        action={
                                          driveDisabled
                                            ? undefined
                                            : "/eswm-pipeline/api/upload"
                                        }
                                        disabled={driveDisabled}
                                        headers={getUploadHeaders()}
                                        multiple
                                        accept=".pdf,.doc,.docx,.xls,.xlsx,image/*"
                                        showUploadList={false}
                                      >
                                        <Button size="small" icon={<UploadOutlined />}>
                                          Upload (max 200 MB)
                                        </Button>
                                      </Upload>
                                    </Form.Item>
                                    <Form.Item
                                      noStyle
                                      shouldUpdate={(prev, cur) =>
                                        prev.scrpDetails !== cur.scrpDetails
                                      }
                                    >
                                      {() => {
                                        const files =
                                          form.getFieldValue([
                                            "scrpDetails",
                                            field.name,
                                            "attachments",
                                          ]) || [];
                                        if (!files.length) return null;
                                        return (
                                          <Space
                                            direction="vertical"
                                            size={2}
                                            style={{ width: "100%" }}
                                          >
                                            {files.map((f, fi) => {
                                              const url =
                                                f.url || f.response?.url;
                                              const pct = Math.round(
                                                f.percent || 0,
                                              );
                                              return (
                                                <div
                                                  key={f.uid || fi}
                                                  style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: 4,
                                                    background: "#fafafa",
                                                    borderRadius: 4,
                                                    padding: "2px 6px",
                                                  }}
                                                >
                                                  <Tooltip title={f.name}>
                                                    <Text
                                                      ellipsis
                                                      style={{
                                                        maxWidth: 80,
                                                        fontSize: 11,
                                                        flex: 1,
                                                      }}
                                                    >
                                                      {f.name ||
                                                        `File ${fi + 1}`}
                                                    </Text>
                                                  </Tooltip>
                                                  {f.status ===
                                                  "uploading" ? (
                                                    <>
                                                      <Progress
                                                        percent={pct}
                                                        size="small"
                                                        showInfo={false}
                                                        style={{
                                                          flex: 1,
                                                          minWidth: 50,
                                                        }}
                                                      />
                                                      <Text
                                                        style={{
                                                          fontSize: 10,
                                                          color: "#1677ff",
                                                          whiteSpace:
                                                            "nowrap",
                                                        }}
                                                      >
                                                        {pct}%
                                                      </Text>
                                                    </>
                                                  ) : (
                                                    <Tag
                                                      color={
                                                        f.status === "error"
                                                          ? "red"
                                                          : url
                                                            ? "green"
                                                            : "default"
                                                      }
                                                      style={{
                                                        fontSize: 10,
                                                        padding: "0 4px",
                                                        margin: 0,
                                                      }}
                                                    >
                                                      {f.status === "error"
                                                        ? "Err"
                                                        : url
                                                          ? "OK"
                                                          : "?"}
                                                    </Tag>
                                                  )}
                                                  {url && (
                                                    <Button
                                                      size="small"
                                                      type="text"
                                                      icon={<EyeOutlined />}
                                                      style={{
                                                        padding: 0,
                                                        height: 18,
                                                        width: 18,
                                                      }}
                                                      onClick={() =>
                                                        openFilePreview(
                                                          url,
                                                          f.name,
                                                        )
                                                      }
                                                    />
                                                  )}
                                                  <Button
                                                    size="small"
                                                    type="text"
                                                    danger
                                                    icon={<DeleteOutlined />}
                                                    style={{
                                                      padding: 0,
                                                      height: 18,
                                                      width: 18,
                                                    }}
                                                    onClick={() => {
                                                      const scrpDetails = [
                                                        ...(form.getFieldValue(
                                                          "scrpDetails",
                                                        ) || []),
                                                      ];
                                                      const row =
                                                        scrpDetails[
                                                          field.name
                                                        ]
                                                          ? {
                                                              ...scrpDetails[
                                                                field.name
                                                              ],
                                                            }
                                                          : {};
                                                      row.attachments = (
                                                        row.attachments || []
                                                      ).filter(
                                                        (_, i) => i !== fi,
                                                      );
                                                      scrpDetails[
                                                        field.name
                                                      ] = row;
                                                      form.setFieldsValue({
                                                        scrpDetails,
                                                      });
                                                    }}
                                                  />
                                                </div>
                                              );
                                            })}
                                          </Space>
                                        );
                                      }}
                                    </Form.Item>
                                  </Space>
                                ),
                              },
                              {
                                title: "",
                                width: 48,
                                render: (_, field) => (
                                  <Button
                                    size="small"
                                    type="text"
                                    danger
                                    icon={<DeleteOutlined />}
                                    onClick={() => remove(field.name)}
                                  />
                                ),
                              },
                            ]}
                          />
                          <Button
                            type="dashed"
                            onClick={() => add({})}
                            block
                            icon={<PlusOutlined />}
                            size="small"
                            style={{ marginTop: 8 }}
                          >
                            Add SCRP Entry
                          </Button>
                        </>
                      )}
                    </Form.List>
                  </>
                ),
              },
              {
                key: "gallery",
                label: (
                  <span style={{ color: "#1677ff" }}>
                    <FileImageOutlined /> Gallery
                  </span>
                ),
                children: (
                  <>
                    {/* <Alert
                      type="info"
                      showIcon
                      style={{ marginBottom: 12 }}
                      message="Gallery images are managed in a table. Upload or replace a photo from the Actions column, then save the SLF record."
                    /> */}
                    <Form.List name="galleryItems">
                      {(fields, { add, remove }) => (
                        <>
                          {/* Form.List skips re-rendering its children for value updates, so
                              these cells (preview, file name, size, status, action buttons) read a
                              STALE form store and kept showing "Missing" with View/Download
                              disabled after a file had uploaded fine. shouldUpdate re-renders the
                              table whenever the list value changes. */}
                          <Form.Item
                            noStyle
                            shouldUpdate={(prev, cur) => prev.galleryItems !== cur.galleryItems}
                          >
                            {() => (
                            <Table
                              size="small"
                              rowKey="key"
                              dataSource={fields}
                              pagination={false}
                              tableLayout="fixed"
                              scroll={{ x: 820, y: fields.length > 5 ? 420 : undefined }}
                              locale={{ emptyText: <Empty description="No gallery images added" /> }}
                              columns={[
                                {
                                  title: "File",
                                  width: 230,
                                  render: (_, field) => {
                                    const value = form.getFieldValue(["galleryItems", field.name, "url"]);
                                    const url = fileUrlFromValue(value);
                                    const file = uploadFileFromValue(value);
                                    const persistedName = form.getFieldValue(["galleryItems", field.name, "fileName"]);
                                    const fileName = resolveUploadName(value, persistedName, "photo");
                                    return (
                                      <Space size={8} align="start" style={{ width: "100%" }}>
                                        {url ? <Image src={resolveMediaUrl(url)} width={48} height={38} style={{ objectFit: "cover", borderRadius: 6, flex: "0 0 auto" }} /> : <FileImageOutlined style={{ fontSize: 24, color: "#8c8c8c", marginTop: 6 }} />}
                                        <div style={{ minWidth: 0, flex: 1 }}>
                                          <Tooltip title={fileName}>
                                            <Text ellipsis style={{ display: "block", maxWidth: 150 }}>{fileName}</Text>
                                          </Tooltip>
                                          <Space size={4} wrap>
                                            {file?.size ? <Text type="secondary" style={{ fontSize: 11 }}>{formatFileSize(file.size)}</Text> : null}
                                            {renderUploadStatusCell(file, url)}
                                          </Space>
                                        </div>
                                      </Space>
                                    );
                                  },
                                },
                                {
                                  title: "Category",
                                  width: 170,
                                  render: (_, field) => (
                                    <Form.Item name={[field.name, "component"]} style={{ margin: 0 }}>
                                      <Select allowClear showSearch placeholder="Component" options={GALLERY_COMPONENT_OPTIONS} />
                                    </Form.Item>
                                  ),
                                },
                                {
                                  title: "Details",
                                  width: 260,
                                  render: (_, field) => (
                                    <Space direction="vertical" size={6} style={{ width: "100%" }}>
                                      <Form.Item name={[field.name, "caption"]} style={{ margin: 0 }}>
                                        <Input placeholder="Photo caption" />
                                      </Form.Item>
                                      <Form.Item name={[field.name, "folder"]} style={{ margin: 0 }}>
                                        <Select mode="tags" maxTagCount="responsive" placeholder="Folder" tokenSeparators={[","]} />
                                      </Form.Item>
                                    </Space>
                                  ),
                                },
                                { title: "Uploaded", width: 90, render: () => <Text type="secondary" style={{ fontSize: 11 }}>—</Text> },
                                {
                                  title: "Actions",
                                  fixed: "right",
                                  width: 150,
                                  render: (_, field) => {
                                    const value = form.getFieldValue(["galleryItems", field.name, "url"]);
                                    const file = uploadFileFromValue(value);
                                    const uploading = file?.status === "uploading";
                                    const url = fileUrlFromValue(value);
                                    return (
                                      <Space size={4}>
                                        <Form.Item name={[field.name, "url"]} valuePropName="fileList" getValueFromEvent={uploadEventToFileList} style={{ margin: 0 }}>
                                          <Upload {...slfUploadProps} maxCount={1} accept="image/*" action={driveDisabled ? undefined : "/eswm-pipeline/api/upload"} disabled={driveDisabled || uploading} headers={getUploadHeaders()} showUploadList={false}>
                                            <Tooltip title={uploading ? "Upload in progress" : url ? "Replace image" : "Upload image"}><Button size="small" icon={<UploadOutlined />} loading={uploading} disabled={driveDisabled || uploading} /></Tooltip>
                                          </Upload>
                                        </Form.Item>
                                        <Tooltip title="View / preview"><Button size="small" icon={<EyeOutlined />} disabled={!url} onClick={() => window.open(resolveMediaOpenUrl(url), "_blank", "noopener,noreferrer")} /></Tooltip>
                                        <Tooltip title="Open in new tab"><Button size="small" icon={<LinkOutlined />} disabled={!url} onClick={() => window.open(resolveMediaOpenUrl(url), "_blank", "noopener,noreferrer")} /></Tooltip>
                                        <Popconfirm title="Delete this gallery image?" okText="Delete" okButtonProps={{ danger: true }} onConfirm={() => remove(field.name)}>
                                          <Tooltip title="Delete"><Button size="small" danger icon={<DeleteOutlined />} /></Tooltip>
                                        </Popconfirm>
                                      </Space>
                                    );
                                  },
                                },
                              ]}
                            />
                            )}
                          </Form.Item>
                          <Space style={{ width: "100%", marginTop: 4 }} direction="vertical" size={8}>
                            <Upload
                              {...slfUploadProps}
                              action={driveDisabled ? undefined : "/eswm-pipeline/api/upload"}
                              headers={getUploadHeaders()}
                              multiple
                              showUploadList={false}
                              accept="image/*"
                              disabled={driveDisabled}
                              onChange={({ file }) => {
                                if (file.status === "done") {
                                  const url = file.response?.url || file.url;
                                  if (url)
                                    add({
                                      fileName: file.name,
                                      url: [{ uid: file.uid, name: file.name, status: "done", url, response: file.response }],
                                    });
                                } else if (file.status === "error") {
                                  message.error(`${file.name} failed to upload.`);
                                }
                              }}
                            >
                              <Button type="primary" ghost icon={<UploadOutlined />} block disabled={driveDisabled}>
                                Upload Multiple Images
                              </Button>
                            </Upload>
                            <Button
                              type="dashed"
                              onClick={() => add({})}
                              block
                              icon={<PlusOutlined />}
                            >
                              Add Gallery Item
                            </Button>
                          </Space>
                        </>
                      )}
                    </Form.List>
                    <Divider orientation="left" plain style={{ marginTop: 16 }}>Legacy Photo Uploads</Divider>
                    <Form.Item name="galleryPhotos" valuePropName="fileList" getValueFromEvent={uploadEventToFileList}>
                      <Upload {...slfUploadProps} listType="picture" accept="image/*" multiple action={driveDisabled ? undefined : "/eswm-pipeline/api/upload"} disabled={driveDisabled} headers={getUploadHeaders()}>
                        <Button icon={<UploadOutlined />} disabled={driveDisabled}>Upload Legacy Photos</Button>
                      </Upload>
                    </Form.Item>
                  </>
                ),
              },
              {
                key: "documents",
                label: (
                  <span style={{ color: "#722ed1" }}>
                    <FolderOutlined /> Documents
                  </span>
                ),
                children: (
                  <>
                    {/* <Alert
                      type="info"
                      showIcon
                      style={{ marginBottom: 12 }}
                      message="Documents are managed in a table. Edit metadata inline, upload or replace a file from the Actions column, then save the SLF record."
                    /> */}
                    <Form.List name="slfDocuments">
                      {(fields, { add, remove }) => (
                        <>
                          <Form.Item
                            noStyle
                            shouldUpdate={(prev, cur) => prev.slfDocuments !== cur.slfDocuments}
                          >
                            {() => (
                            <Table
                              size="small"
                              rowKey="key"
                              dataSource={fields}
                              pagination={false}
                              tableLayout="fixed"
                              scroll={{ x: 860, y: fields.length > 6 ? 460 : undefined }}
                              locale={{ emptyText: <Empty description="No SLF documents added" /> }}
                              columns={[
                                {
                                  title: "File",
                                  width: 260,
                                  render: (_, field) => {
                                    const value = form.getFieldValue(["slfDocuments", field.name, "url"]);
                                    const url = fileUrlFromValue(value);
                                    const file = uploadFileFromValue(value);
                                    const kind = getMediaKind(url);
                                    const persistedName = form.getFieldValue(["slfDocuments", field.name, "fileName"]);
                                    const fileName = resolveUploadName(value, persistedName, "document");
                                    return (
                                      <Space direction="vertical" size={6} style={{ width: "100%" }}>
                                        <Space size={6} wrap>
                                          <Tag icon={kind === "image" ? <FileImageOutlined /> : <FilePdfOutlined />} color={url ? "purple" : "default"}>{kind || "document"}</Tag>
                                          {file?.size ? <Text type="secondary" style={{ fontSize: 11 }}>{formatFileSize(file.size)}</Text> : null}
                                          {renderUploadStatusCell(file, url)}
                                        </Space>
                                        <Tooltip title={fileName}>
                                          <Text ellipsis style={{ maxWidth: 220, fontSize: 11 }}>{fileName}</Text>
                                        </Tooltip>
                                        <Form.Item name={[field.name, "title"]} rules={[{ required: true, message: "Title required" }]} style={{ margin: 0 }}>
                                          <Input placeholder="Document title" />
                                        </Form.Item>
                                      </Space>
                                    );
                                  },
                                },
                                {
                                  title: "Category",
                                  width: 170,
                                  render: (_, field) => (
                                    <Form.Item name={[field.name, "docType"]} style={{ margin: 0 }}>
                                      <Select allowClear placeholder="Type" options={SLF_DOCUMENT_TYPE_OPTIONS} />
                                    </Form.Item>
                                  ),
                                },
                                {
                                  title: "Description",
                                  width: 260,
                                  render: (_, field) => (
                                    <Form.Item name={[field.name, "description"]} style={{ margin: 0 }}>
                                      <Input placeholder="Description" />
                                    </Form.Item>
                                  ),
                                },
                                { title: "Uploaded", width: 90, render: () => <Text type="secondary" style={{ fontSize: 11 }}>—</Text> },
                                {
                                  title: "Actions",
                                  fixed: "right",
                                  width: 170,
                                  render: (_, field) => {
                                    const value = form.getFieldValue(["slfDocuments", field.name, "url"]);
                                    const file = uploadFileFromValue(value);
                                    const uploading = file?.status === "uploading";
                                    const url = fileUrlFromValue(value);
                                    const docTitle = form.getFieldValue(["slfDocuments", field.name, "title"]);
                                    const previewName = resolveUploadName(value, form.getFieldValue(["slfDocuments", field.name, "fileName"]), docTitle || "document");
                                    return (
                                      <Space size={4}>
                                        <Form.Item name={[field.name, "url"]} valuePropName="fileList" getValueFromEvent={uploadEventToFileList} style={{ margin: 0 }}>
                                          <Upload {...slfUploadProps} maxCount={1} accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.tif,.tiff,image/*" action={driveDisabled ? undefined : "/eswm-pipeline/api/upload"} disabled={driveDisabled || uploading} headers={getUploadHeaders()} showUploadList={false}>
                                            <Tooltip title={uploading ? "Upload in progress" : url ? "Replace file" : "Upload file"}><Button size="small" icon={<UploadOutlined />} loading={uploading} disabled={driveDisabled || uploading} /></Tooltip>
                                          </Upload>
                                        </Form.Item>
                                        <Tooltip title="View / preview"><Button size="small" icon={<EyeOutlined />} disabled={!url} onClick={() => openFilePreview(url, previewName)} /></Tooltip>
                                        <Tooltip title="Open in new tab"><Button size="small" icon={<LinkOutlined />} disabled={!url} onClick={() => window.open(resolveMediaOpenUrl(url), "_blank", "noopener,noreferrer")} /></Tooltip>
                                        <Tooltip title="Download"><Button size="small" icon={<DownloadOutlined />} disabled={!url} onClick={() => window.open(resolveMediaOpenUrl(url), "_blank", "noopener,noreferrer")} /></Tooltip>
                                        <Popconfirm title="Delete this document?" okText="Delete" okButtonProps={{ danger: true }} onConfirm={() => remove(field.name)}>
                                          <Tooltip title="Delete"><Button size="small" danger icon={<DeleteOutlined />} /></Tooltip>
                                        </Popconfirm>
                                      </Space>
                                    );
                                  },
                                },
                              ]}
                            />
                            )}
                          </Form.Item>
                          <Space style={{ width: "100%", marginTop: 4 }} direction="vertical" size={8}>
                            <Upload
                              {...slfUploadProps}
                              action={driveDisabled ? undefined : "/eswm-pipeline/api/upload"}
                              headers={getUploadHeaders()}
                              multiple
                              showUploadList={false}
                              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.tif,.tiff,image/*"
                              disabled={driveDisabled}
                              onChange={({ file }) => {
                                if (file.status === "done") {
                                  const url = file.response?.url || file.url;
                                  if (url)
                                    add({
                                      docType: "Monitoring Report",
                                      title: String(file.name || "").replace(/\.[^.]+$/, ""),
                                      fileName: file.name,
                                      url: [{ uid: file.uid, name: file.name, status: "done", url, response: file.response }],
                                    });
                                } else if (file.status === "error") {
                                  message.error(`${file.name} failed to upload.`);
                                }
                              }}
                            >
                              <Button type="primary" ghost icon={<UploadOutlined />} block disabled={driveDisabled}>
                                Upload Multiple Documents
                              </Button>
                            </Upload>
                            <Button
                              type="dashed"
                              onClick={() =>
                                add({ docType: "Monitoring Report" })
                              }
                              block
                              icon={<PlusOutlined />}
                            >
                              Add Document
                            </Button>
                          </Space>
                        </>
                      )}
                    </Form.List>
                  </>
                ),
              },
            ]}
          />
        </Form>
      </Spin>
    </Modal>
  );
}
