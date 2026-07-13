// Consistent page-size-changer configuration for Ant Design tables.
//
// Spread `withSizeChanger()` into a Table's `pagination` prop so the size
// changer always appears and works. For uncontrolled tables Ant Design updates
// the visible rows immediately when the size changes; for controlled tables,
// keep handling `pageSize` in your own `onChange`/`onShowSizeChange`.
//
// Usage:
//   pagination={withSizeChanger({ pageSize: 10, size: "small" })}

export const PAGE_SIZE_OPTIONS = ["10", "20", "50", "100"];

export function withSizeChanger(overrides = {}) {
  return {
    showSizeChanger: true,
    pageSizeOptions: PAGE_SIZE_OPTIONS,
    showTotal: (total, range) =>
      total ? `${range[0]}-${range[1]} of ${total}` : "0 records",
    ...overrides,
  };
}

export default withSizeChanger;
