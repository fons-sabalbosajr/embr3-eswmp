import { getCellTypeConfig } from "../../../utils/cellVisuals";
import { MASK_PLACEHOLDER } from "../../../utils/sensitiveMask";
import { formatStatusSummary } from "../submissionGrouping";
import { CheckCircleOutlined, CloseCircleOutlined, DeleteOutlined, EditOutlined, EyeOutlined, SyncOutlined, UndoOutlined } from "@ant-design/icons";
import { Button, Space, Tag, Tooltip, Typography } from "antd";
import dayjs from "dayjs";

const { Text } = Typography;

// Column definitions for the Submission History table.
//
// `maskSensitive` mirrors the portal setting that hides volumes/capacity; the
// four callbacks open the detail modal, raise a revert request, edit a reverted
// row, and hide an entry from the portal user’s own history.
export function makeHistoryColumns({
  submissions,
  trucks,
  maskSensitive,
  openHistoryDetail,
  openRevertModal,
  handleEditRevertedRow,
  handleHideSubmission,
}) {
  // ── Responsive column priority ──────────────────────────────────────────────
  // The table declared a fixed `scroll.x` of 1100px with several unsized columns,
  // so on a phone (~375px) every row had to be dragged sideways through roughly
  // three screens, and the unsized columns collapsed to unreadable slivers on the
  // way. antd hides a column entirely below the breakpoints listed in
  // `responsive`, which shrinks the table to fit rather than scrolling it.
  //
  // What survives on the smallest screen is what an operator acts on: which
  // submission it is, when it was for, what state it is in, and what they can do
  // about it. Everything hidden here is still reachable — the row opens the same
  // detail modal, which shows the full record.
  //
  //   xs  (<576)  ID No. · Date · Status · Actions
  //   md  (>=768) + # · Entries · Remarks
  //   lg  (>=992) + Type · Submitted
  //   xl  (>=1200) + Company/Address · Cell Assigned
  const FROM_MD = ["md", "lg", "xl", "xxl"];
  const FROM_LG = ["lg", "xl", "xxl"];
  const FROM_XL = ["xl", "xxl"];

  return [
      { title: "#", key: "index", width: 50, align: "left", responsive: FROM_MD, render: (_, __, i) => i + 1 },
      {
        title: "ID No.",
        dataIndex: "idNo",
        key: "idNo",
        // Sized and clipped so it cannot stretch the table on a narrow screen.
        width: 150,
        ellipsis: true,
        // A group row shows the batch identifier + how many submissions it holds.
        render: (v, r) =>
          r.isGroup ? (
            <Space direction="vertical" size={0}>
              <Text strong style={{ fontSize: 11 }}>
                {r.groupId || "Submission group"}
              </Text>
              <Tag color="geekblue" style={{ fontSize: 11 }}>
                {r.count} submissions
              </Tag>
            </Space>
          ) : (
            v || "—"
          ),
      },
      {
        title: "Date of Disposal",
        dataIndex: "dateOfDisposal",
        key: "dateOfDisposal",
        width: 140,
        // For a group, show the reporting period its children actually span.
        render: (v, r) => {
          if (!r.isGroup) return v ? dayjs(v).format("MM/DD/YYYY") : "—";
          if (!r.periodStart) return "—";
          const from = dayjs(r.periodStart).format("MM/DD/YYYY");
          const to = dayjs(r.periodEnd).format("MM/DD/YYYY");
          return from === to ? from : `${from} – ${to}`;
        },
      },
      {
        title: "Company / Address",
        key: "companyAddr",
        // An operator's own company — the least useful cell on a small screen.
        responsive: FROM_XL,
        width: 220,
        ellipsis: true,
        render: (_, r) => (
          <div>
            <Text strong style={{ fontSize: 13 }}>
              {r.lguCompanyName}
            </Text>
          </div>
        ),
      },
      {
        title: "Type",
        dataIndex: "companyType",
        key: "companyType",
        width: 80,
        responsive: FROM_LG,
        render: (v) => <Tag color={v === "LGU" ? "blue" : "green"}>{v}</Tag>,
      },
      {
        title: "Entries",
        key: "truckCount",
        width: 70,
        responsive: FROM_MD,
        align: "center",
        // Denormalized on the record; the list no longer ships trucks[].
        render: (_, r) => Number(r.truckCount || 0),
      },
      {
        title: "Cell Assigned",
        key: "cellsAssigned",
        width: 200,
        responsive: FROM_XL,
        // Which cells this submission's waste was actually placed into. Resolved
        // SERVER-side from each truck/vehicle's canonical cellIndex, so a cell an
        // admin has since renamed shows its CURRENT name, not the copy frozen at
        // submit time. A group row unions its children's cells.
        render: (_, r) => {
          const cells = r.isGroup
            ? Object.values(
                (r.children || []).reduce((acc, child) => {
                  (child.cellsAssigned || []).forEach((c) => {
                    if (acc[c.cellName]) acc[c.cellName].count += c.count;
                    else acc[c.cellName] = { ...c };
                  });
                  return acc;
                }, {}),
              )
            : r.cellsAssigned || [];
          const unplaced = r.isGroup
            ? (r.children || []).reduce((n, c) => n + Number(c.unplacedCount || 0), 0)
            : Number(r.unplacedCount || 0);

          if (!cells.length && !unplaced) {
            return <Text type="secondary" style={{ fontSize: 12 }}>—</Text>;
          }
          return (
            <Space size={4} wrap>
              {cells.map((c) => (
                <Tag
                  key={c.cellName}
                  color={getCellTypeConfig(c.cellType).tag}
                  style={{ marginInlineEnd: 0, fontSize: 11 }}
                >
                  {c.cellName}
                  {c.count > 1 ? ` ×${c.count}` : ""}
                </Tag>
              ))}
              {unplaced > 0 && (
                <Tooltip title="Waste in this submission has not been assigned to a cell yet.">
                  <Tag color="warning" style={{ marginInlineEnd: 0, fontSize: 11 }}>
                    {unplaced} unassigned
                  </Tag>
                </Tooltip>
              )}
            </Space>
          );
        },
      },
      {
        title: "Status",
        dataIndex: "status",
        key: "status",
        width: 150,
        filters: [
          { text: "Pending", value: "pending" },
          { text: "Approved", value: "acknowledged" },
          { text: "Rejected", value: "rejected" },
          { text: "Reverted", value: "reverted" },
        ],
        onFilter: (value, record) =>
          // A group matches the filter when ANY child has that status, so filtering
          // never hides a group that genuinely contains the status you asked for.
          record.isGroup
            ? Object.keys(record.statusCounts || {}).includes(value)
            : record.status === value,
        render: (v, r) => {
          // Mixed-status group: list each status with its count rather than
          // stamping the whole group with one child's status.
          if (r.isGroup) {
            return (
              <Space direction="vertical" size={2}>
                {formatStatusSummary(r.statusCounts).map((line) => (
                  <Tag key={line} color={r.isMixedStatus ? "default" : "blue"} style={{ fontSize: 11 }}>
                    {line.toUpperCase()}
                  </Tag>
                ))}
              </Space>
            );
          }
          if (v === "acknowledged") {
            return (
              <Space direction="vertical" size={2}>
                <Tag icon={<CheckCircleOutlined />} color="success">
                  APPROVED
                </Tag>
                {r.revertRequested && (
                  <Tag color="orange" style={{ fontSize: 11 }}>
                    Revert Requested
                  </Tag>
                )}
              </Space>
            );
          }
          if (v === "rejected") {
            return (
              <Tag icon={<CloseCircleOutlined />} color="error">
                REJECTED
              </Tag>
            );
          }
          if (v === "reverted" || v === "editApproved") {
            // Labelled. This was an icon-only tag, so the one status that needs the
            // operator to act read as a blank orange chip. The revert reason now
            // lives in the Remarks column.
            return (
              <Tag icon={<UndoOutlined />} color="volcano">
                {v === "editApproved" ? "EDIT APPROVED" : "REVERTED"}
              </Tag>
            );
          }
          if (v === "revert_requested") {
            return (
              <Tag icon={<SyncOutlined />} color="orange">
                REVERT REQUESTED
              </Tag>
            );
          }
          return (
            <Tag
              icon={<SyncOutlined spin />}
              color="warning"
              className="status-pending"
            >
              PENDING REVIEW
            </Tag>
          );
        },
      },
      {
        title: "Remarks",
        key: "remarks",
        width: 220,
        responsive: FROM_MD,
        // What the operator needs to know about the row, in words: why it was
        // reverted (and that it is waiting on them), or that it is a RESUBMISSION
        // with the note they sent back. Same `resubmission` summary the admin
        // Submissions Remarks column reads (server utils/resubmission.js).
        render: (_, r) => {
          const rows = r.isGroup ? r.children || [] : [r];
          const reverted = rows.filter(
            (c) => c.status === "reverted" || c.status === "editApproved",
          );
          const resubmitted = rows.filter((c) => c.resubmission);
          if (!reverted.length && !resubmitted.length) {
            return <Text type="secondary" style={{ fontSize: 12 }}>—</Text>;
          }
          if (r.isGroup) {
            return (
              <Space size={4} wrap>
                {reverted.length > 0 && (
                  <Tag color="volcano" style={{ marginInlineEnd: 0, fontSize: 11 }}>
                    {reverted.length} need correction
                  </Tag>
                )}
                {resubmitted.length > 0 && (
                  <Tag color="gold" style={{ marginInlineEnd: 0, fontSize: 11 }}>
                    <SyncOutlined /> {resubmitted.length} resubmitted
                  </Tag>
                )}
              </Space>
            );
          }
          const resub = r.resubmission;
          return (
            <Space direction="vertical" size={2} style={{ width: "100%" }}>
              {reverted.length > 0 && (
                <>
                  <Tag color="volcano" style={{ marginInlineEnd: 0, fontSize: 11, width: "fit-content" }}>
                    Needs correction — Edit &amp; Resubmit
                  </Tag>
                  {r.revertReason && (
                    <Text type="secondary" style={{ fontSize: 11 }} ellipsis={{ tooltip: r.revertReason }}>
                      Reason: {r.revertReason}
                    </Text>
                  )}
                </>
              )}
              {resub && (
                <>
                  <Tooltip
                    title={
                      [
                        resub.at ? `Resubmitted ${dayjs(resub.at).format("MMM D, YYYY h:mm A")}` : "Resubmitted after revert",
                        resub.previousIdNo ? `was ${resub.previousIdNo}` : "",
                        resub.revertReason ? `Reverted for: ${resub.revertReason}` : "",
                      ].filter(Boolean).join(" · ")
                    }
                  >
                    <Tag color="gold" style={{ marginInlineEnd: 0, fontSize: 11, width: "fit-content" }}>
                      <SyncOutlined /> Resubmission{resub.count > 1 ? ` ×${resub.count}` : ""}
                    </Tag>
                  </Tooltip>
                  {resub.comment && (
                    <Text type="secondary" style={{ fontSize: 11 }} ellipsis={{ tooltip: resub.comment }}>
                      “{resub.comment}”
                    </Text>
                  )}
                </>
              )}
            </Space>
          );
        },
      },
      {
        title: "Submitted",
        dataIndex: "createdAt",
        width: 200,
        key: "createdAt",
        responsive: FROM_LG,
        // NO `defaultSortOrder` here.
        //
        // It used to default to descending, which made antd re-sort the rows by
        // date — silently discarding the order HistoryPanel had already applied,
        // where REVERTED rows are floated to the top because they are the only ones
        // waiting on the operator (and the only ones blocking their next
        // submission). A revert then sank underneath every submission made since:
        // SLF-LGU-NE-0111, reverted on 2026-08-12, sat below newer approved rows.
        //
        // The incoming order is now what renders: action-required first, then
        // newest. The column stays sortable, so clicking it still gives a pure
        // date order when that is what the operator wants.
        sorter: (a, b) => {
          // Missing/invalid dates sort to the bottom instead of being treated
          // as the epoch, which would park them above real submissions when the
          // order is flipped to ascending.
          const at = a?.createdAt ? new Date(a.createdAt).getTime() : NaN;
          const bt = b?.createdAt ? new Date(b.createdAt).getTime() : NaN;
          if (Number.isNaN(at) && Number.isNaN(bt)) return 0;
          if (Number.isNaN(at)) return -1;
          if (Number.isNaN(bt)) return 1;
          return at - bt;
        },
        render: (v) => (v ? dayjs(v).format("MMM D, YYYY h:mm A") : "—"),
      },
      {
        title: "Actions",
        key: "actions",
        width: 150,
        align: "center",
        render: (_, r) => {
          // A GROUP row is a synthetic parent (its _id is "sid:<submissionId>"),
          // not a record. When every child shares one status the group inherits
          // it, so an all-reverted batch used to show Edit & Resubmit and Remove
          // on the parent — both of which sent that synthetic id to the server.
          // The per-record actions live on the child rows of the expanded group.
          if (r.isGroup) {
            const pending = (r.children || []).filter(
              (c) => c.status === "reverted" || c.status === "editApproved",
            ).length;
            return pending ? (
              <Tooltip title="Expand this group to correct and resubmit each reverted entry">
                <Tag color="volcano" style={{ fontSize: 11 }}>
                  {pending} to resubmit
                </Tag>
              </Tooltip>
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>—</Text>
            );
          }
          const needsResubmit = r.status === "reverted" || r.status === "editApproved";
          return (
          <Space size="small">
            <Tooltip title="View Details">
              <Button
                type="text"
                size="small"
                icon={<EyeOutlined />}
                onClick={() => openHistoryDetail(r)}
                style={{ color: "#1a3353" }}
              />
            </Tooltip>
            {r.status === "acknowledged" &&
              !r.revertRequested &&
              !r.editRequested && (
                <Tooltip title="Request Edit">
                  <Button
                    type="text"
                    size="small"
                    icon={<UndoOutlined />}
                    onClick={() => openRevertModal(r)}
                    style={{ color: "#fa8c16" }}
                  />
                </Tooltip>
              )}
            {r.editRequested &&
              r.status !== "reverted" &&
              r.status !== "editApproved" && (
                <Tag color="processing" style={{ fontSize: 11 }}>
                  Edit Pending
                </Tag>
              )}
            {needsResubmit && (
              <Tooltip title="Correct this entry and send it back for review">
                <Button
                  type="primary"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => handleEditRevertedRow(r)}
                  style={{ background: "#fa541c", borderColor: "#fa541c" }}
                >
                  Resubmit
                </Button>
              </Tooltip>
            )}
            {/* Not offered on a reverted row: the server refuses to hide one (it
                is waiting on this operator), and offering the button anyway is
                how operators ended up trying to delete the entry they were meant
                to resubmit (rtabella@piwsi.ph, SLF-PVT-PA-0202, 5 attempts). */}
            {!needsResubmit && (
              <Tooltip title="Remove from my history (admin keeps a record)">
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => handleHideSubmission(r)}
                />
              </Tooltip>
            )}
          </Space>
          );
        },
      },
  ];
}
