import { UNIT_OPTIONS } from "../../slf-monitoring/helpers.jsx";
import { DatabaseOutlined } from "@ant-design/icons";
import { Modal, Select, Space, Typography } from "antd";

const { Text } = Typography;

// "Set Field Units" tool — applies one volume unit across the facility's fields.
export default function UnitToolModal({
  unitToolOpen,
  setUnitToolOpen,
  unitToolValue,
  setUnitToolValue,
  applyUnitTool,
}) {
  return (
    <Modal
      title={
        <Space>
          <DatabaseOutlined />
          <span>Set Field Units</span>
        </Space>
      }
      open={unitToolOpen}
      onCancel={() => setUnitToolOpen(false)}
      onOk={applyUnitTool}
      okText="Apply Units"
      width={460}
      zIndex={1700}
      destroyOnHidden={false}
    >
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Text type="secondary">
          Apply one unit to the SLF capacity, receiving capacity, waste
          received, estimated waste, and all cell capacity/fill unit fields.
        </Text>
        <Select
          value={unitToolValue}
          onChange={setUnitToolValue}
          options={UNIT_OPTIONS}
          style={{ width: "100%" }}
        />
      </Space>
    </Modal>
  );
}
