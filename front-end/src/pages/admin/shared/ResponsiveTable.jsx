import { Table } from "antd";

const enableFilterSearch = (columns) =>
  columns?.map((column) => ({
    ...column,
    ...(column.filters && column.filterSearch == null ? { filterSearch: true } : {}),
    ...(column.children ? { children: enableFilterSearch(column.children) } : {}),
  }));

export default function ResponsiveTable({
  scroll,
  size = "small",
  tableLayout,
  columns,
  pagination,
  ...props
}) {
  const mergedPagination =
    pagination === false
      ? false
      : {
          responsive: true,
          showSizeChanger: true,
          pageSizeOptions: ["10", "15", "20", "30", "50", "100"],
          showTotal: (total, range) =>
            total ? `${range[0]}-${range[1]} of ${total}` : "0 records",
          ...(pagination || {}),
        };

  return (
    <Table
      size={size}
      tableLayout={tableLayout || "auto"}
      scroll={{ x: "max-content", ...(scroll || {}) }}
      columns={enableFilterSearch(columns)}
      pagination={mergedPagination}
      {...props}
    />
  );
}
