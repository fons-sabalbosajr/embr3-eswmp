import { useMemo, useState } from "react";
import { Card, Space, Typography, Button, Table, Empty, Select, DatePicker, Input, Tag, Badge, Tooltip, Grid } from "antd";
import { HistoryOutlined, ReloadOutlined, SearchOutlined, WarningOutlined, ClearOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { groupSubmissions } from "./submissionGrouping";

const { Text } = Typography;
const { RangePicker } = DatePicker;

// Human labels for the raw backend status values. Only statuses that actually
// appear in the loaded data become filter options, so nothing unused is hardcoded.
const STATUS_LABELS = {
  pending: "Pending",
  submitted: "Submitted",
  acknowledged: "Acknowledged",
  approved: "Approved",
  reverted: "Reverted",
  revert_requested: "Revert Requested",
  editApproved: "Edit Approved",
  resubmitted: "Resubmitted",
  rejected: "Rejected",
};
const statusLabel = (s) => STATUS_LABELS[s] || String(s || "—").replace(/_/g, " ");

// A record needs action while it is reverted (or an edit was approved to re-encode).
const isActionRequired = (s) => s?.status === "reverted" || s?.status === "editApproved";

// ── Narrow-screen column widths ───────────────────────────────────────────────
// Below md only four columns survive (see `responsive` in columns/historyColumns),
// but they kept their DESKTOP widths — 150 + 140 + 150 + 150 = 590px of declared
// track on a ~360px phone. The table could not fit, so every row was dragged
// sideways, and because the global table rule forces `table-layout: auto` the
// declared widths were not even honoured on the way: columns landed wherever the
// content pushed them and `ellipsis` never clipped anything.
//
// These widths re-proportion the same four columns for the space actually
// available. `.slf-history-table` (SLFPortal.css) restores `table-layout: fixed`
// so they are respected rather than treated as hints.
const COMPACT_WIDTHS = { idNo: 104, dateOfDisposal: 82, status: 108, actions: 96 };
const COMPACT_TOTAL = Object.values(COMPACT_WIDTHS).reduce((a, b) => a + b, 0);

// Waste types carried on a submission (truck/vehicle level).
const wasteTypesOf = (sub) => {
  const out = new Set();
  (sub?.trucks || []).forEach((t) => {
    if (t?.wasteType) out.add(t.wasteType);
    (t?.vehicles || []).forEach((v) => v?.wasteType && out.add(v.wasteType));
  });
  return [...out];
};

// ── Submission History ──
// Client-side filtering over the portal user's OWN submissions (the whole set is
// already loaded — tens of rows). The total badge, filters, page size and the
// reverted-first ordering all derive from the FULL filtered dataset, never from the
// current page.
export default function HistoryPanel({
  submissions = [],
  historyColumns,
  loadingSubmissions,
  onRefresh,
}) {
  // Drives the table's scroll width so it tracks the columns antd is actually
  // rendering at this size (see the `responsive` flags in columns/historyColumns).
  const screens = Grid.useBreakpoint();
  const [statusFilter, setStatusFilter] = useState(null);
  const [dateRange, setDateRange] = useState(null);
  const [wasteType, setWasteType] = useState(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Options derived from the actual data so no unsupported value is offered.
  const statusOptions = useMemo(() => {
    const seen = new Set();
    submissions.forEach((s) => s?.status && seen.add(s.status));
    return [...seen].sort().map((v) => ({ value: v, label: statusLabel(v) }));
  }, [submissions]);
  const wasteTypeOptions = useMemo(() => {
    const seen = new Set();
    submissions.forEach((s) => wasteTypesOf(s).forEach((w) => seen.add(w)));
    return [...seen].sort().map((v) => ({ value: v, label: v }));
  }, [submissions]);

  const hasFilters = !!(statusFilter || (dateRange && dateRange[0]) || wasteType || search.trim());
  const activeFilterCount =
    (statusFilter ? 1 : 0) + (dateRange && dateRange[0] ? 1 : 0) + (wasteType ? 1 : 0) + (search.trim() ? 1 : 0);

  // Filter the FULL dataset first (the total badge and paging both read from this).
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return submissions.filter((s) => {
      if (statusFilter && s.status !== statusFilter) return false;
      if (wasteType && !wasteTypesOf(s).includes(wasteType)) return false;
      if (dateRange && dateRange[0] && dateRange[1]) {
        const d = dayjs(s.dateOfDisposal || s.createdAt);
        if (!d.isValid() || d.isBefore(dateRange[0], "day") || d.isAfter(dateRange[1], "day")) return false;
      }
      if (q) {
        const hay = [s.idNo, s.submissionId, s.lguCompanyName, s.slfName]
          .map((v) => String(v || "").toLowerCase())
          .join(" ");
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [submissions, statusFilter, wasteType, dateRange, search]);

  const revertedCount = useMemo(
    () => filtered.filter(isActionRequired).length,
    [filtered],
  );

  // Below md, swap in the compact widths for the four columns that remain.
  // Untouched at md and up, where the wider columns come back.
  const columns = useMemo(() => {
    if (screens.md) return historyColumns;
    return (historyColumns || []).map((col) =>
      COMPACT_WIDTHS[col.key] ? { ...col, width: COMPACT_WIDTHS[col.key] } : col,
    );
  }, [historyColumns, screens.md]);

  // Group, then float action-required (reverted) rows to the top, then by newest.
  const rows = useMemo(() => {
    const grouped = groupSubmissions(filtered);
    // Item #3: latest relevant activity (resubmittedAt else submittedAt); groups
    // carry `latestActivityAt`, fall back to the record dates for safety.
    const ts = (r) =>
      Number(r.latestActivityAt) || new Date(r.updatedAt || r.createdAt || r.dateOfDisposal || 0).getTime();
    const needs = (r) =>
      r.isGroup ? (r.children || []).some(isActionRequired) : isActionRequired(r);
    return grouped.sort((a, b) => {
      const na = needs(a) ? 0 : 1;
      const nb = needs(b) ? 0 : 1;
      if (na !== nb) return na - nb;
      return ts(b) - ts(a);
    });
  }, [filtered]);

  const resetFilters = () => {
    setStatusFilter(null);
    setDateRange(null);
    setWasteType(null);
    setSearch("");
    setPage(1);
  };
  // Any filter change returns to page 1 (keeps paging semantics predictable).
  const onFilterChange = (setter) => (val) => {
    setter(val);
    setPage(1);
  };

  return (
    <div style={{ maxWidth: 1680, margin: "0 auto" }}>
      <Card
        className="slf-section"
        title={
          <Space wrap>
            <HistoryOutlined style={{ color: "#1a3353" }} />
            <Text strong style={{ fontSize: 16, color: "#1a3353" }}>
              Submission History
            </Text>
            <Tooltip title={hasFilters ? "Total matching the active filters" : "Total submissions"}>
              <Tag color="blue">{filtered.length} total</Tag>
            </Tooltip>
            {revertedCount > 0 && (
              <Tag icon={<WarningOutlined />} color="volcano">
                {revertedCount} action required
              </Tag>
            )}
          </Space>
        }
        extra={
          <Button size="small" icon={<ReloadOutlined />} onClick={onRefresh} loading={loadingSubmissions} disabled={loadingSubmissions}>
            Refresh
          </Button>
        }
      >
        {/* Compact filter bar. The fixed control widths below (150/200px) are
            desktop sizes; on a phone they overflowed the card, so
            `.slf-history-filters` (SLFPortal.css) relaxes them to fluid tracks. */}
        <Space wrap size={8} className="slf-history-filters" style={{ marginBottom: 12, width: "100%" }}>
          <Badge count={activeFilterCount} size="small">
            <Select
              allowClear
              size="small"
              placeholder="Status"
              style={{ minWidth: 150 }}
              value={statusFilter}
              onChange={onFilterChange(setStatusFilter)}
              options={statusOptions}
            />
          </Badge>
          <RangePicker
            size="small"
            value={dateRange}
            onChange={onFilterChange(setDateRange)}
            allowClear
          />
          {wasteTypeOptions.length > 0 && (
            <Select
              allowClear
              size="small"
              placeholder="Waste type"
              style={{ minWidth: 150 }}
              value={wasteType}
              onChange={onFilterChange(setWasteType)}
              options={wasteTypeOptions}
            />
          )}
          <Input
            size="small"
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Reference / SLF"
            style={{ width: 200 }}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          {hasFilters && (
            <Button size="small" type="link" danger icon={<ClearOutlined />} onClick={resetFilters}>
              Reset filters
            </Button>
          )}
        </Space>

        <Table
          className="slf-history-table"
          dataSource={rows}
          columns={columns}
          rowKey={(r) => (r.isGroup ? r.key : r._id)}
          loading={loadingSubmissions}
          size="small"
          // Reverted/action-required rows get a subtle highlight so they read as
          // "not completed" even before the user scans the status column.
          rowClassName={(r) =>
            (r.isGroup ? (r.children || []).some(isActionRequired) : isActionRequired(r))
              ? "slf-history-action-row"
              : ""
          }
          pagination={{
            current: page,
            pageSize,
            total: rows.length,
            showSizeChanger: true,
            pageSizeOptions: ["10", "20", "50", "100"],
            showTotal: (t) => `${t} record(s)`,
            onChange: (p, size) => {
              // A page-size change resets to page 1; a page change keeps filters.
              if (size !== pageSize) {
                setPageSize(size);
                setPage(1);
              } else {
                setPage(p);
              }
            },
          }}
          scroll={{ x: screens.lg ? 1100 : screens.md ? 760 : COMPACT_TOTAL }}
          expandable={{
            rowExpandable: (r) => !!r.isGroup,
            expandedRowRender: (r) => (
              <Table
                className="slf-history-table"
                dataSource={r.children}
                columns={columns}
                rowKey="_id"
                size="small"
                pagination={false}
                showHeader={false}
                // The child table must track the parent's tracks, or the two grids
                // drift apart and an expanded group reads as a different table.
                scroll={{ x: screens.lg ? 1100 : screens.md ? 760 : COMPACT_TOTAL }}
              />
            ),
          }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={hasFilters ? "No submissions match the filters" : "No submissions yet"}
              />
            ),
          }}
        />
      </Card>
      <style>{`
        .slf-history-action-row > td { background: rgba(250, 84, 28, 0.06) !important; }
        .slf-history-action-row:hover > td { background: rgba(250, 84, 28, 0.12) !important; }
      `}</style>
    </div>
  );
}
