import { Form, Input } from "antd";

// "Your name for this cell" on a baseline cell entry. The entry stays bound to
// the cell EMB declared on the admin side (chosen above, by its admin name);
// this is the operator's own label for it, shown first in the Baseline tables
// with the admin's name under it. Optional — blank keeps the admin's name.
export default function CellLabelField({ value, adminName, onChange }) {
  return (
    <Form.Item
      label="Your name for this cell (optional)"
      extra={
        <span style={{ fontSize: 11 }}>
          {adminName
            ? `Stays linked to EMB's "${adminName}". Leave blank to use EMB's name.`
            : "Choose the cell first. Leave blank to use EMB's name."}
        </span>
      }
    >
      <Input
        value={value || ""}
        maxLength={80}
        allowClear
        placeholder={adminName ? `e.g. ${adminName} – North Slope` : "e.g. Cell A – North Slope"}
        onChange={(e) => onChange(e.target.value)}
        disabled={!adminName}
      />
    </Form.Item>
  );
}
