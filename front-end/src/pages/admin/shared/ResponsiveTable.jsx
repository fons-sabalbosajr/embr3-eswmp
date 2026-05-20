import { Table } from "antd";

export default function ResponsiveTable({
  scroll,
  size = "small",
  tableLayout,
  pagination,
  ...props
}) {
  return (
    <Table
      size={size}
      tableLayout={tableLayout || "auto"}
      scroll={{ x: "max-content", ...(scroll || {}) }}
      pagination={
        pagination === false
          ? false
          : {
              responsive: true,
              showSizeChanger: true,
              ...(pagination || {}),
            }
      }
      {...props}
    />
  );
}
