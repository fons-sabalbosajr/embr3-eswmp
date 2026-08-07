import { ACCENT } from "../../slf-monitoring/helpers.jsx";
import { CalculatorOutlined, CopyOutlined } from "@ant-design/icons";
import { Button, Card, Col, Divider, Input, InputNumber, Modal, Row, Space, Tooltip, Typography } from "antd";

const { Text } = Typography;

// Volume conversion helpers (area×depth → m³, m³ ↔ tons).
//
// Every field is a separate container state slice, hence the long signature;
// folding them into one `useConversionTools()` hook would collapse it, but that
// is a state move and out of scope for this pass.
export default function ConversionToolsModal({
  convModalOpen,
  setConvModalOpen,
  convArea,
  setConvArea,
  convDepth,
  setConvDepth,
  convVol,
  setConvVol,
  convDensity,
  setConvDensity,
  convM3ToTons,
  setConvM3ToTons,
  copyText,
  form,
}) {
  return (
    <Modal
      title={
        <Space>
          <CalculatorOutlined style={{ color: ACCENT }} />
          <span>Capacity Converter</span>
        </Space>
      }
      open={convModalOpen}
      onCancel={() => setConvModalOpen(false)}
      footer={<Button onClick={() => setConvModalOpen(false)}>Close</Button>}
      width={680}
      zIndex={1600}
      destroyOnHidden={false}
    >
      <Space direction="vertical" size={14} style={{ width: "100%" }}>
        <Text type="secondary">
          Convert common SLF capacity values. Each result can be copied for
          quick encoding in the form.
        </Text>

        <Card size="small" title="Area x Depth = Volume">
          <Row gutter={[12, 12]} align="middle">
            <Col xs={24} sm={10} md={7}>
              <Text type="secondary">Area</Text>
              <Space.Compact style={{ width: "100%", marginTop: 4 }}>
                <InputNumber
                  style={{ width: "100%" }}
                  min={0}
                  step={0.01}
                  placeholder="0.00"
                  value={convArea}
                  onChange={setConvArea}
                />
                <span className="ant-input-group-addon">m2</span>
              </Space.Compact>
            </Col>
            <Col xs={24} sm={4} md={2} style={{ textAlign: "center" }}>
              <Text strong>x</Text>
            </Col>
            <Col xs={24} sm={10} md={7}>
              <Text type="secondary">Depth</Text>
              <Space.Compact style={{ width: "100%", marginTop: 4 }}>
                <InputNumber
                  style={{ width: "100%" }}
                  min={0}
                  step={0.01}
                  placeholder="0.00"
                  value={convDepth}
                  onChange={setConvDepth}
                />
                <span className="ant-input-group-addon">m</span>
              </Space.Compact>
            </Col>
            <Col xs={24} md={8}>
              <Text type="secondary">Volume</Text>
              <Input
                readOnly
                value={
                  convArea != null && convDepth != null
                    ? `${(convArea * convDepth).toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      })} m3`
                    : ""
                }
                placeholder="Result"
                style={{ marginTop: 4, fontWeight: 600, color: "#389e0d" }}
                addonAfter={
                  <Tooltip title="Copy volume">
                    <Button
                      size="small"
                      type="text"
                      icon={<CopyOutlined />}
                      disabled={convArea == null || convDepth == null}
                      onClick={() =>
                        copyText(
                          `${(convArea * convDepth).toLocaleString(
                            undefined,
                            { maximumFractionDigits: 2 },
                          )} m3`,
                          "Volume",
                        )
                      }
                    />
                  </Tooltip>
                }
              />
            </Col>
          </Row>
        </Card>

        <Card size="small" title="Volume x Density = Weight">
          <Row gutter={[12, 12]} align="middle">
            <Col xs={24} sm={10} md={7}>
              <Text type="secondary">Volume</Text>
              <Space.Compact style={{ width: "100%", marginTop: 4 }}>
                <InputNumber
                  style={{ width: "100%" }}
                  min={0}
                  step={0.01}
                  placeholder="0.00"
                  value={convVol}
                  onChange={setConvVol}
                />
                <span className="ant-input-group-addon">m3</span>
              </Space.Compact>
            </Col>
            <Col xs={24} sm={4} md={2} style={{ textAlign: "center" }}>
              <Text strong>x</Text>
            </Col>
            <Col xs={24} sm={10} md={7}>
              <Text type="secondary">Density</Text>
              <Space.Compact style={{ width: "100%", marginTop: 4 }}>
                <InputNumber
                  style={{ width: "100%" }}
                  min={0}
                  step={0.001}
                  placeholder="0.50"
                  value={convDensity}
                  onChange={setConvDensity}
                />
                <span className="ant-input-group-addon">t/m3</span>
              </Space.Compact>
            </Col>
            <Col xs={24} md={8}>
              <Text type="secondary">Weight</Text>
              <Input
                readOnly
                value={
                  convVol != null && convDensity != null
                    ? `${(convVol * convDensity).toLocaleString(undefined, {
                        maximumFractionDigits: 3,
                      })} tons`
                    : ""
                }
                placeholder="Result"
                style={{ marginTop: 4, fontWeight: 600, color: ACCENT }}
                addonAfter={
                  <Tooltip title="Copy weight">
                    <Button
                      size="small"
                      type="text"
                      icon={<CopyOutlined />}
                      disabled={convVol == null || convDensity == null}
                      onClick={() =>
                        copyText(
                          `${(convVol * convDensity).toLocaleString(
                            undefined,
                            { maximumFractionDigits: 3 },
                          )} tons`,
                          "Weight",
                        )
                      }
                    />
                  </Tooltip>
                }
              />
              <Text type="secondary" style={{ fontSize: 11 }}>
                Typical MSW density starts at 0.50 t/m3.
              </Text>
            </Col>
          </Row>
        </Card>

        <Card size="small" title="m3 to Tons">
          <Row gutter={[12, 12]} align="middle">
            <Col xs={24} sm={10} md={7}>
              <Text type="secondary">Volume</Text>
              <Space.Compact style={{ width: "100%", marginTop: 4 }}>
                <InputNumber
                  style={{ width: "100%" }}
                  min={0}
                  step={0.01}
                  placeholder="0.00"
                  value={convM3ToTons}
                  onChange={setConvM3ToTons}
                />
                <span className="ant-input-group-addon">m3</span>
              </Space.Compact>
            </Col>
            <Col xs={24} sm={4} md={2} style={{ textAlign: "center" }}>
              <Text strong>x</Text>
            </Col>
            <Col xs={24} sm={10} md={7}>
              <Text type="secondary">Density used</Text>
              <Input
                readOnly
                value={`${convDensity ?? 0.2} t/m3`}
                style={{ marginTop: 4, color: "#595959" }}
              />
            </Col>
            <Col xs={24} md={8}>
              <Text type="secondary">Weight</Text>
              <Input
                readOnly
                value={
                  convM3ToTons != null
                    ? `${(convM3ToTons * (convDensity ?? 0.2)).toLocaleString(
                        undefined,
                        {
                          maximumFractionDigits: 3,
                        },
                      )} tons`
                    : ""
                }
                placeholder="Result"
                style={{ marginTop: 4, fontWeight: 600, color: "#fa8c16" }}
                addonAfter={
                  <Tooltip title="Copy weight">
                    <Button
                      size="small"
                      type="text"
                      icon={<CopyOutlined />}
                      disabled={convM3ToTons == null}
                      onClick={() =>
                        copyText(
                          `${(
                            convM3ToTons * (convDensity ?? 0.2)
                          ).toLocaleString(undefined, {
                            maximumFractionDigits: 3,
                          })} tons`,
                          "Weight",
                        )
                      }
                    />
                  </Tooltip>
                }
              />
            </Col>
          </Row>
          <Divider style={{ margin: "12px 0" }} />
          <Text type="secondary" style={{ fontSize: 12 }}>
            Change the density above when using a site-specific conversion
            factor.
          </Text>
        </Card>
      </Space>
    </Modal>
  );
}
