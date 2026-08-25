import { isHazardousWasteType } from "../../utils/wasteCategories";
import { CarOutlined, DeleteOutlined, EditOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import { Badge, Button, Checkbox, Col, Collapse, DatePicker, Form, Pagination, Row, Select, Space, Tag, Typography } from "antd";

const { Text } = Typography;

// "Waste Generator Information" pane of the Data Entry tabs: the disposal form,
// the truck/transport table with its paging and selection, and bulk cell
// assignment.
//
// Purely presentational — every value and handler is supplied by the container,
// which still owns the state. The signature is long because of that: this pane
// reads 23 distinct pieces of container state. Folding the truck-table slice
// (paging, selection, bulk cell) into a `useTruckTable()` hook would collapse
// most of it, but that is a state move and deliberately out of scope here.
export default function WasteGeneratorPane({
  // form + reference data
  entryForm,
  trucks,
  haulers,
  slfUnit,
  activeCellOptions,
  isMobile,
  isRequired,
  fl,
  // validation state (drives the required-dot and inline warnings)
  missingDisposalInfo,
  missingHazardousCodeTrucks,
  // truck table: paging, selection, bulk cell assignment
  truckPage,
  setTruckPage,
  truckPageSize,
  setTruckPageSize,
  selectedTruckKeys,
  setSelectedTruckKeys,
  truckBulkCell,
  setTruckBulkCell,
  // actions
  openTruckModal,
  removeTruck,
  assignSelectedTrucksToCell,
  openUploadGuide,
  setActiveTab,
  // Feature-tour anchors, owned by index.jsx (the tour lives there); this pane
  // only attaches them to the elements the steps point at.
  truckUploadRef,
  truckTableRef,
}) {
  return (
  <Form
    form={entryForm}
    layout="vertical"
    requiredMark={false}
  >
    <Row gutter={[12, 0]}>
      <Col xs={24} sm={12} md={8}>
        <Form.Item
          name="dateOfDisposal"
          label={fl("dateOfDisposal", "Date of Disposal")}
          rules={[
            {
              required: isRequired("dateOfDisposal", true),
              message: "Required",
            },
          ]}
        >
          <DatePicker
            format="MM/DD/YYYY"
            style={{ width: "100%" }}
          />
        </Form.Item>
      </Col>
    </Row>

    {/* #7: the Data-Entry Notes moved to the right-side panel,
        directly below the Encoding Guide. */}

    {/* ── Transport & Disposal Information ── */}
    <div
      style={{
        background: "#fff",
        border: "1px solid #e8e8e8",
        borderRadius: 10,
        overflow: "hidden",
        marginTop: 4,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 16px",
          background:
            "linear-gradient(90deg, #1a3353 0%, #244b7a 100%)",
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 7,
            background: "rgba(255,255,255,0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <CarOutlined
            style={{ color: "#fff", fontSize: 14 }}
          />
        </div>
        <Text
          strong
          style={{ color: "#fff", fontSize: 13 }}
        >
          Transport &amp; Disposal Information
        </Text>
        <Badge
          count={trucks.length}
          showZero
          style={{
            backgroundColor:
              trucks.length > 0
                ? "rgba(255,255,255,0.25)"
                : "rgba(255,255,255,0.12)",
            color: "#fff",
            border: "none",
            boxShadow: "none",
          }}
        />
        {trucks.length > 0 && (
          <Text
            style={{
              color: "rgba(255,255,255,0.65)",
              fontSize: 11,
              marginLeft: 2,
            }}
          >
            · Total:{" "}
            <strong style={{ color: "#fff" }}>
              {trucks
                .reduce(
                  (s, t) => s + (t.actualVolume || 0),
                  0,
                )
                .toLocaleString()}
            </strong>{" "}
            {trucks[0]?.actualVolumeUnit || slfUnit}
          </Text>
        )}
        <Space style={{ marginLeft: "auto" }} wrap>
          <Button
            size="small"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => openTruckModal(null)}
          >
            Add Entry
          </Button>
          <span ref={truckUploadRef}>
            <Button
              size="small"
              icon={<UploadOutlined />}
              style={{
                background: "rgba(255,255,255,0.12)",
                border: "1px solid rgba(255,255,255,0.3)",
                color: "#fff",
              }}
              onClick={() => openUploadGuide("truck")}
            >
              Upload Excel/CSV
            </Button>
          </span>
        </Space>
      </div>
      <div
        ref={truckTableRef}
        style={{
          padding: trucks.length === 0 ? 0 : "10px 12px",
        }}
      >
        {trucks.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "28px 16px",
              background: "#fafafa",
            }}
          >
            <CarOutlined
              style={{
                fontSize: 28,
                color: "#d9d9d9",
                display: "block",
                marginBottom: 8,
              }}
            />
            <Text type="secondary" style={{ fontSize: 13 }}>
              No entries added. Click &quot;Add Entry&quot;
              to add transport data.
            </Text>
          </div>
        ) : (
          <>
            {/* Multi-select + assign-to-cell toolbar */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
                marginBottom: 8,
              }}
            >
              <Checkbox
                indeterminate={
                  selectedTruckKeys.length > 0 &&
                  selectedTruckKeys.length < trucks.length
                }
                checked={
                  trucks.length > 0 &&
                  selectedTruckKeys.length === trucks.length
                }
                onChange={(e) =>
                  setSelectedTruckKeys(
                    e.target.checked
                      ? trucks.map((t) => t.key)
                      : [],
                  )
                }
              >
                <Text style={{ fontSize: 12 }}>
                  Select all ({selectedTruckKeys.length}/
                  {trucks.length})
                </Text>
              </Checkbox>
              <Select
                size="small"
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder={
                  activeCellOptions.length
                    ? "Choose a cell"
                    : "No open cells"
                }
                value={truckBulkCell}
                onChange={setTruckBulkCell}
                options={activeCellOptions.map((o) => ({
                  label: o.label,
                  value: o.value,
                }))}
                disabled={activeCellOptions.length === 0}
                style={{ minWidth: 200 }}
                notFoundContent="No open cells configured"
              />
              <Button
                size="small"
                type="primary"
                className="slf-primary-btn"
                disabled={
                  !truckBulkCell ||
                  selectedTruckKeys.length === 0
                }
                onClick={() =>
                  assignSelectedTrucksToCell(truckBulkCell)
                }
              >
                Place{" "}
                {selectedTruckKeys.length
                  ? `${selectedTruckKeys.length} `
                  : ""}
                in cell
              </Button>
            </div>
            <Collapse
              bordered={false}
              style={{ background: "transparent" }}
              expandIconPlacement="start"
              items={trucks
                .slice(
                  (truckPage - 1) * truckPageSize,
                  truckPage * truckPageSize,
                )
                .map((t, localI) => {
              const i =
                (truckPage - 1) * truckPageSize + localI;
              const vehs = t.vehicles || [];
              const plateNos =
                vehs
                  .map((v) => v.plateNumber)
                  .filter(Boolean)
                  .join(", ") ||
                t.plateNumber ||
                "—";
              const capacities =
                vehs.length > 0
                  ? vehs
                      .filter((v) => v.capacity != null)
                      .map(
                        (v) =>
                          `${v.capacity} ${(v.capacityUnit || slfUnit).replace("m3", "m³")}`,
                      )
                      .join(", ")
                  : t.truckCapacity != null
                    ? `${t.truckCapacity} ${(t.truckCapacityUnit || slfUnit).replace("m3", "m³")}`
                    : "—";
              const isHaz = isHazardousWasteType(t.wasteType);
              const allClients = vehs.flatMap(
                (v) => v.selectedClients || [],
              );
              return {
                key: t.key,
                style: {
                  marginBottom: 6,
                  borderRadius: 8,
                  border: "1px solid #e8e8e8",
                  background: "#fff",
                  overflow: "hidden",
                },
                label: (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                      width: "100%",
                      paddingRight: 4,
                    }}
                  >
                    <Checkbox
                      checked={selectedTruckKeys.includes(
                        t.key,
                      )}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setSelectedTruckKeys((prev) =>
                          checked
                            ? [...new Set([...prev, t.key])]
                            : prev.filter(
                                (k) => k !== t.key,
                              ),
                        );
                      }}
                    />
                    <div
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 5,
                        background: "#1a3353",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <Text
                        style={{
                          color: "#fff",
                          fontSize: 10,
                          fontWeight: 700,
                        }}
                      >
                        {i + 1}
                      </Text>
                    </div>
                    {t.cellName && (
                      <Tag
                        color="purple"
                        style={{ margin: 0, fontSize: 11 }}
                      >
                        {t.cellName}
                      </Tag>
                    )}
                    <Text
                      strong
                      style={{
                        fontSize: 13,
                        color: "#1a3353",
                        flexShrink: 0,
                        maxWidth: 160,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t.disposalTicketNo || (
                        <Text
                          type="secondary"
                          style={{
                            fontWeight: 400,
                            fontSize: 12,
                          }}
                        >
                          No Ticket No.
                        </Text>
                      )}
                    </Text>
                    {t.hauler && (
                      <Tag
                        color="blue"
                        style={{ margin: 0, fontSize: 11 }}
                      >
                        {t.hauler}
                      </Tag>
                    )}
                    {t.wasteType && (
                      <Tag
                        color={isHaz ? "red" : "green"}
                        style={{ margin: 0, fontSize: 11 }}
                      >
                        {t.wasteType}
                      </Tag>
                    )}
                    {t.actualVolume != null && (
                      <Tag
                        color="orange"
                        style={{
                          margin: 0,
                          fontSize: 11,
                          marginLeft: "auto",
                        }}
                      >
                        {t.actualVolume}{" "}
                        {t.actualVolumeUnit || slfUnit}
                      </Tag>
                    )}
                  </div>
                ),
                extra: (
                  <Space
                    size={0}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      type="text"
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => openTruckModal(t)}
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
                children: (
                  <div style={{ padding: "4px 4px 8px" }}>
                    <Row gutter={[10, 8]}>
                      {t.lguCompanyName && (
                        <Col xs={24} sm={12} md={8}>
                          <div
                            style={{
                              background: "#f8faff",
                              borderRadius: 6,
                              padding: "6px 10px",
                            }}
                          >
                            <div
                              style={{
                                fontSize: 10,
                                color: "#8c8c8c",
                                textTransform: "uppercase",
                                letterSpacing: 0.5,
                                fontWeight: 600,
                              }}
                            >
                              LGU / Company
                            </div>
                            <div
                              style={{
                                fontSize: 13,
                                fontWeight: 600,
                                color: "#262626",
                                marginTop: 2,
                              }}
                            >
                              {t.lguCompanyName}
                            </div>
                          </div>
                        </Col>
                      )}
                      {t.companyType && (
                        <Col xs={12} sm={6} md={4}>
                          <div
                            style={{
                              background: "#f8faff",
                              borderRadius: 6,
                              padding: "6px 10px",
                            }}
                          >
                            <div
                              style={{
                                fontSize: 10,
                                color: "#8c8c8c",
                                textTransform: "uppercase",
                                letterSpacing: 0.5,
                                fontWeight: 600,
                              }}
                            >
                              Type
                            </div>
                            <Tag
                              color={
                                t.companyType === "LGU"
                                  ? "blue"
                                  : "green"
                              }
                              style={{
                                margin: "4px 0 0",
                                fontWeight: 600,
                              }}
                            >
                              {t.companyType}
                            </Tag>
                          </div>
                        </Col>
                      )}
                      <Col xs={12} sm={6} md={4}>
                        <div
                          style={{
                            background: "#f8faff",
                            borderRadius: 6,
                            padding: "6px 10px",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 10,
                              color: "#8c8c8c",
                              textTransform: "uppercase",
                              letterSpacing: 0.5,
                              fontWeight: 600,
                            }}
                          >
                            Plate No.
                          </div>
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              color: "#262626",
                              marginTop: 2,
                            }}
                          >
                            {plateNos}
                          </div>
                        </div>
                      </Col>
                      <Col xs={12} sm={6} md={4}>
                        <div
                          style={{
                            background: "#f8faff",
                            borderRadius: 6,
                            padding: "6px 10px",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 10,
                              color: "#8c8c8c",
                              textTransform: "uppercase",
                              letterSpacing: 0.5,
                              fontWeight: 600,
                            }}
                          >
                            Capacity
                          </div>
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              color: "#262626",
                              marginTop: 2,
                            }}
                          >
                            {capacities}
                          </div>
                        </div>
                      </Col>
                      <Col xs={12} sm={6} md={4}>
                        <div
                          style={{
                            background: "#fff7e6",
                            borderRadius: 6,
                            padding: "6px 10px",
                            border: "1px solid #ffe7ba",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 10,
                              color: "#8c8c8c",
                              textTransform: "uppercase",
                              letterSpacing: 0.5,
                              fontWeight: 600,
                            }}
                          >
                            Actual Volume
                          </div>
                          <div
                            style={{
                              fontSize: 14,
                              fontWeight: 700,
                              color: "#fa8c16",
                              marginTop: 2,
                            }}
                          >
                            {t.actualVolume != null
                              ? `${t.actualVolume} ${t.actualVolumeUnit || slfUnit}`
                              : "—"}
                          </div>
                        </div>
                      </Col>
                      {isHaz &&
                        t.hazWasteCode &&
                        (Array.isArray(t.hazWasteCode)
                          ? t.hazWasteCode
                          : [t.hazWasteCode]
                        ).length > 0 && (
                          <Col xs={24}>
                            <div
                              style={{
                                background: "#fff1f0",
                                borderRadius: 6,
                                padding: "6px 10px",
                                border: "1px solid #ffa39e",
                              }}
                            >
                              <div
                                style={{
                                  fontSize: 10,
                                  color: "#8c8c8c",
                                  textTransform:
                                    "uppercase",
                                  letterSpacing: 0.5,
                                  fontWeight: 600,
                                  marginBottom: 4,
                                }}
                              >
                                Haz. Waste Code(s)
                              </div>
                              {(Array.isArray(
                                t.hazWasteCode,
                              )
                                ? t.hazWasteCode
                                : [t.hazWasteCode]
                              ).map((code) => (
                                <Tag
                                  key={code}
                                  color="red"
                                  style={{
                                    fontSize: 11,
                                    marginBottom: 2,
                                  }}
                                >
                                  {code}
                                </Tag>
                              ))}
                            </div>
                          </Col>
                        )}
                      {allClients.length > 0 && (
                        <Col xs={24}>
                          <div
                            style={{
                              background: "#f6ffed",
                              borderRadius: 6,
                              padding: "6px 10px",
                              border: "1px solid #b7eb8f",
                            }}
                          >
                            <div
                              style={{
                                fontSize: 10,
                                color: "#8c8c8c",
                                textTransform: "uppercase",
                                letterSpacing: 0.5,
                                fontWeight: 600,
                                marginBottom: 4,
                              }}
                            >
                              Clients ({allClients.length})
                            </div>
                            {allClients.map((c, ci) => {
                              const name =
                                typeof c === "string"
                                  ? c
                                  : c.clientName;
                              const type =
                                typeof c === "string"
                                  ? null
                                  : c.clientType;
                              return (
                                <Tag
                                  key={ci}
                                  color={
                                    type === "LGU"
                                      ? "blue"
                                      : "green"
                                  }
                                  style={{
                                    fontSize: 11,
                                    marginBottom: 2,
                                  }}
                                >
                                  {name}
                                  {type ? ` (${type})` : ""}
                                </Tag>
                              );
                            })}
                          </div>
                        </Col>
                      )}
                    </Row>
                  </div>
                ),
              };
            })}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginTop: 8,
              }}
            >
              <Pagination
                size="small"
                current={truckPage}
                pageSize={truckPageSize}
                total={trucks.length}
                showSizeChanger
                pageSizeOptions={["10", "20", "50", "100"]}
                showTotal={(total) =>
                  `${total} entr${total === 1 ? "y" : "ies"}`
                }
                onChange={(p, size) => {
                  setTruckPage(p);
                  setTruckPageSize(size || truckPageSize);
                }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  </Form>
  );
}
