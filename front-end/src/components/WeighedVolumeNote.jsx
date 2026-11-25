import { Tag, Tooltip } from "antd";

// "weighed 12.5 tons" under a volume that was entered in the other unit and
// converted (1 m³ = 0.5 tons). The record keeps the weight as entered for EMB to
// check; this shows it next to the converted figure. Renders nothing otherwise.
// `entry` is a waste entry from utils/submissionEntries (enteredVolume / enteredUnit).
export default function WeighedVolumeNote({ entry }) {
  if (!entry || entry.enteredVolume == null || !entry.enteredUnit) return null;
  const weighed = `${Number(entry.enteredVolume).toLocaleString(undefined, { maximumFractionDigits: 3 })} ${entry.enteredUnit}`;
  return (
    <Tooltip title={`Entered by the operator as ${weighed} and converted to ${entry.unit || "the SLF's unit"} (1 m³ = 0.5 tons).`}>
      <Tag color="gold" style={{ fontSize: 10.5, marginInlineEnd: 0, marginTop: 2 }}>
        weighed {weighed}
      </Tag>
    </Tooltip>
  );
}
