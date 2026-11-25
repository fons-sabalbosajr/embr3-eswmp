import { useState } from "react";
import { Button, InputNumber, Space, Typography } from "antd";
import { CloseOutlined, SwapOutlined } from "@ant-design/icons";
import { describeConversion, enteredVolumePatch, factorText, otherUnit } from "./enteredVolume";

const { Text } = Typography;

// "Weighed in tons?" — lets the operator type the value as weighed in the other
// unit and fills Waste Volume with it converted to the SLF's unit (the original
// is kept on the vehicle). Shown under each vehicle's Waste Volume.
export default function EnteredVolumeField({ vehicle, slfUnit, onPatch }) {
  const other = otherUnit(slfUnit);
  const converted = describeConversion(vehicle, slfUnit);
  const [open, setOpen] = useState(Boolean(converted));

  if (!open) {
    return (
      <Button
        type="link"
        size="small"
        icon={<SwapOutlined />}
        style={{ padding: 0, height: "auto", fontSize: 12 }}
        onClick={() => setOpen(true)}
      >
        Weighed in {other}? Enter the weight
      </Button>
    );
  }

  return (
    <Space direction="vertical" size={2} style={{ width: "100%" }}>
      <Space size={6} wrap>
        <InputNumber
          size="small"
          min={0}
          step={0.01}
          placeholder={`Weight in ${other}`}
          style={{ width: 170 }}
          addonAfter={other}
          value={vehicle?.enteredVolumeUnit ? vehicle.enteredVolume : null}
          onChange={(value) => onPatch(enteredVolumePatch(value, other, slfUnit))}
          aria-label={`Volume as weighed, in ${other}`}
        />
        <Button
          size="small"
          type="text"
          icon={<CloseOutlined />}
          aria-label="Stop converting"
          onClick={() => {
            setOpen(false);
            onPatch({ enteredVolume: undefined, enteredVolumeUnit: undefined });
          }}
        />
      </Space>
      <Text type="secondary" style={{ fontSize: 11.5 }}>
        {converted
          ? `Saved as ${converted.split("→")[1].trim()} (converted from ${converted.split("→")[0].trim()}; ${factorText(slfUnit)}).`
          : `Waste Volume is filled in ${slfUnit} for you (${factorText(slfUnit)}).`}
      </Text>
    </Space>
  );
}
