import { Badge } from "antd";

// Small red dot shown next to a tab label when that tab has missing required
// input. Pure: driven entirely by the `show` prop.
export default function RequiredDot({ show }) {
  return show ? (
    <Badge dot offset={[2, -2]} style={{ backgroundColor: "#ff4d4f" }} />
  ) : null;
}
