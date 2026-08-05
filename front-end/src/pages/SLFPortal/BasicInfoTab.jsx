import { Form, Divider, Row, Col, Input, Select, Spin } from "antd";
import { EnvironmentOutlined } from "@ant-design/icons";

const { Option } = Select;

// ── Data Entry · Basic Information tab ──
// Presentational form for company name + PSGC address cascade. The antd Form
// instances (companyForm/entryForm), the address option lists, and the cascade
// fetch handlers are container-owned and passed as props; prop names mirror the
// container variables so the JSX body is unchanged from its inline original.
export default function BasicInfoTab({
  companyForm,
  entryForm,
  regions,
  provinces,
  municipalities,
  barangays,
  loadingAddress,
  fetchProvinces,
  fetchMunicipalities,
  fetchBarangays,
  addressLocked = false,
}) {
  return (
                      <Form
                        form={companyForm}
                        layout="vertical"
                        requiredMark={false}
                        onValuesChange={(changed) => {
                          const vals = companyForm.getFieldsValue();
                          if ("lguCompanyName" in changed) {
                            entryForm.setFieldsValue({
                              lguCompanyName: changed.lguCompanyName,
                            });
                          }
                          if (
                            "companyRegion" in changed ||
                            "companyProvince" in changed ||
                            "companyMunicipality" in changed ||
                            "companyBarangay" in changed
                          ) {
                            const parts = [
                              barangays.find(
                                (b) => b.code === vals.companyBarangay,
                              )?.name,
                              municipalities.find(
                                (m) => m.code === vals.companyMunicipality,
                              )?.name,
                              provinces.find(
                                (p) => p.code === vals.companyProvince,
                              )?.name,
                              regions.find((r) => r.code === vals.companyRegion)
                                ?.name,
                            ].filter(Boolean);
                            entryForm.setFieldsValue({
                              address: parts.join(", "),
                            });
                          }
                        }}
                      >
                        <Divider
                          titlePlacement="left"
                          className="slf-category-divider"
                        >
                          <EnvironmentOutlined /> Company Information
                        </Divider>
                        <Row gutter={[12, 0]}>
                          <Col xs={24} sm={12}>
                            <Form.Item
                              name="lguCompanyName"
                              label="Company Name"
                              rules={[{ required: true, message: "Required" }]}
                            >
                              <Input placeholder="Enter company name" />
                            </Form.Item>
                          </Col>
                        </Row>
                        <Row gutter={[12, 0]}>
                          <Col xs={24} sm={12} md={6}>
                            <Form.Item
                              name="companyRegion"
                              label="Region"
                              rules={[{ required: true, message: "Required" }]}
                            >
                              <Select
                                placeholder="Select Region"
                                showSearch
                                optionFilterProp="children"
                                onChange={(val) => !addressLocked && fetchProvinces(val)}
                                disabled={addressLocked}
                              >
                                {regions.map((r) => (
                                  <Option key={r.code} value={r.code}>
                                    {r.name}
                                  </Option>
                                ))}
                              </Select>
                            </Form.Item>
                          </Col>
                          <Col xs={24} sm={12} md={6}>
                            <Form.Item
                              name="companyProvince"
                              label="Province"
                              rules={[{ required: true, message: "Required" }]}
                            >
                              <Select
                                placeholder="Select Province"
                                showSearch
                                optionFilterProp="children"
                                onChange={(val) => !addressLocked && fetchMunicipalities(val)}
                                disabled={
                                  addressLocked ||
                                  provinces.length === 0 &&
                                  loadingAddress !== "province"
                                }
                                loading={loadingAddress === "province"}
                                notFoundContent={
                                  loadingAddress === "province" ? (
                                    <Spin size="small" />
                                  ) : undefined
                                }
                              >
                                {provinces.map((p) => (
                                  <Option key={p.code} value={p.code}>
                                    {p.name}
                                  </Option>
                                ))}
                              </Select>
                            </Form.Item>
                          </Col>
                          <Col xs={24} sm={12} md={6}>
                            <Form.Item
                              name="companyMunicipality"
                              label="City/Municipality"
                              rules={[{ required: true, message: "Required" }]}
                            >
                              <Select
                                placeholder="Select City/Municipality"
                                showSearch
                                optionFilterProp="children"
                                onChange={(val) => !addressLocked && fetchBarangays(val)}
                                disabled={
                                  addressLocked ||
                                  municipalities.length === 0 &&
                                  loadingAddress !== "municipality"
                                }
                                loading={loadingAddress === "municipality"}
                                notFoundContent={
                                  loadingAddress === "municipality" ? (
                                    <Spin size="small" />
                                  ) : undefined
                                }
                              >
                                {municipalities.map((m) => (
                                  <Option key={m.code} value={m.code}>
                                    {m.name}
                                  </Option>
                                ))}
                              </Select>
                            </Form.Item>
                          </Col>
                          <Col xs={24} sm={12} md={6}>
                            <Form.Item name="companyBarangay" label="Barangay">
                              <Select
                                placeholder="Select Barangay"
                                showSearch
                                optionFilterProp="children"
                                disabled={
                                  addressLocked ||
                                  barangays.length === 0 &&
                                  loadingAddress !== "barangay"
                                }
                                loading={loadingAddress === "barangay"}
                                notFoundContent={
                                  loadingAddress === "barangay" ? (
                                    <Spin size="small" />
                                  ) : undefined
                                }
                              >
                                {barangays.map((b) => (
                                  <Option key={b.code} value={b.code}>
                                    {b.name}
                                  </Option>
                                ))}
                              </Select>
                            </Form.Item>
                          </Col>
                        </Row>
                      </Form>
  );
}
