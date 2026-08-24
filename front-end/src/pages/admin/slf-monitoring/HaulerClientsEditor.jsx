// ── Hauler Clients CRUD (SLF Data Table → Edit Modal) ──
//
// Admins maintain the clients stored INSIDE the portal user's baseline
// (accreditedHaulers[].privateSectorClients / .clients), because portal users
// routinely submit clients with no Client Type and no address. Editing here is what
// makes the correction show up in that portal user's own baseline — the backend
// writes to every baseline record for the facility and pushes a "baselines"
// data-refresh to each submitting portal account.
//
// Distinct from the read-only HaulerClientsTab used by the facility DETAILS modal:
// same underlying data, but this one writes.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert, Button, Empty, Form, Input, Modal, Select, Space, Table, Tag, Tooltip, Typography,
} from "antd";
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined, WarningOutlined,
} from "@ant-design/icons";
import Swal from "sweetalert2";
import api from "../../../api";

const { Text } = Typography;

const CLIENT_TYPE_OPTIONS = [
  { label: "LGU", value: "LGU" },
  { label: "Private", value: "Private" },
];

const typeTag = (type) => {
  if (type === "LGU") return <Tag color="blue">LGU</Tag>;
  if (type === "Private") return <Tag color="purple">Private</Tag>;
  return <Tag color="red">Not set</Tag>;
};

export default function HaulerClientsEditor({ slfGeneratorId, slfLabel, canEdit = true }) {
  const [rows, setRows] = useState([]);
  const [haulers, setHaulers] = useState([]);
  const [total, setTotal] = useState(0);
  const [incompleteCount, setIncompleteCount] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState(null);
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null); // null = closed, {} = create
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const fetchRows = useCallback(async () => {
    if (!slfGeneratorId) return;
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get(`/data-slf/hauler-clients/${slfGeneratorId}`, {
        params: {
          page, limit,
          search: search.trim() || undefined,
          type: typeFilter || undefined,
          incompleteOnly: incompleteOnly ? "true" : undefined,
        },
      });
      setRows(Array.isArray(data?.rows) ? data.rows : []);
      setTotal(Number(data?.total || 0));
      setHaulers(Array.isArray(data?.haulers) ? data.haulers : []);
      setIncompleteCount(Number(data?.incompleteCount || 0));
    } catch (err) {
      setError(err?.response?.data?.message || "Could not load hauler clients for this SLF.");
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [slfGeneratorId, page, limit, search, typeFilter, incompleteOnly]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  // Debounced search so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchDraft); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [searchDraft]);

  const haulerOptions = useMemo(
    () => haulers.map((h) => ({ label: h, value: h })),
    [haulers],
  );

  // The form is populated through `initialValues`, NOT by calling setFieldsValue
  // before the modal opens.
  //
  // A Modal does not render its children until it first opens, and this one is
  // destroyed again on close, so at the moment openEdit/openCreate ran there were
  // no mounted Form.Items for the values to land on. antd dropped them (the
  // "Instance created by `useForm` is not connected to any Form element" case) and
  // the modal then mounted a fresh, EMPTY form — which is why Edit opened blank and
  // Save had nothing to submit. Ordering the calls the other way would not fix it
  // either: the state update is async, so the fields still are not mounted yet.
  //
  // initialValues is applied by antd AT MOUNT, which is exactly when the fields
  // exist, so the record's values are there on the first render of the modal.
  const openCreate = () => setEditing({});
  const openEdit = (row) => setEditing(row);

  // Recomputed per open; the modal is destroyed on close, so the form remounts and
  // re-reads these each time rather than reusing the previous record's values.
  const modalInitialValues = useMemo(() => {
    if (!editing) return undefined;
    if (!editing.clientName) return { haulerName: haulers[0], clientType: "LGU" };
    return {
      haulerName: editing.haulerName,
      clientName: editing.clientName,
      clientType: editing.clientType || undefined,
      provinceName: editing.provinceName,
      municipalityName: editing.municipalityName,
      regionName: editing.regionName,
    };
  }, [editing, haulers]);

  const handleSave = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return; // antd shows the field errors
    }
    if (saving) return; // block duplicate submits
    setSaving(true);
    try {
      if (editing?.clientName) {
        await api.put(`/data-slf/hauler-clients/${slfGeneratorId}`, {
          ...values,
          originalClientName: editing.clientName,
        });
      } else {
        await api.post(`/data-slf/hauler-clients/${slfGeneratorId}`, values);
        setPage(1);
      }
      setEditing(null);
      await fetchRows();
      Swal.fire({
        icon: "success",
        title: editing?.clientName ? "Client updated" : "Client added",
        text: "The portal user's baseline has been updated.",
        timer: 1600,
        showConfirmButton: false,
      });
    } catch (err) {
      Swal.fire("Error", err?.response?.data?.message || "Could not save the client.", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row) => {
    const confirm = await Swal.fire({
      title: "Delete client?",
      html: `<b>${row.clientName}</b> will be removed from hauler <b>${row.haulerName}</b> in the portal user's baseline.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Delete",
      confirmButtonColor: "#ff4d4f",
    });
    if (!confirm.isConfirmed) return;
    try {
      await api.delete(`/data-slf/hauler-clients/${slfGeneratorId}`, {
        params: { haulerName: row.haulerName, clientName: row.clientName },
      });
      // Step back a page rather than landing on an empty last page.
      if (rows.length === 1 && page > 1) setPage((p) => p - 1);
      else await fetchRows();
      Swal.fire({ icon: "success", title: "Client deleted", timer: 1300, showConfirmButton: false });
    } catch (err) {
      Swal.fire("Error", err?.response?.data?.message || "Could not delete the client.", "error");
    }
  };

  const columns = [
    {
      title: "Client Name", dataIndex: "clientName", width: 200, ellipsis: true,
      render: (v, r) => (
        <Space size={4}>
          <Text strong style={{ fontSize: 12 }}>{v}</Text>
          {r.incomplete ? (
            <Tooltip title="Missing client type or address — the portal user left it blank">
              <WarningOutlined style={{ color: "#faad14" }} />
            </Tooltip>
          ) : null}
        </Space>
      ),
    },
    // Tag/action columns are centred; free-text columns stay left-aligned so the
    // eye still has a single reading edge for names.
    { title: "Type", dataIndex: "clientType", width: 100, align: "center", render: typeTag },
    {
      title: "Hauler", dataIndex: "haulerName", width: 190, ellipsis: true,
      render: (v) => <Tooltip title={v}><Tag color="blue" bordered={false}>{v || "—"}</Tag></Tooltip>,
    },
    {
      title: "Municipality", dataIndex: "municipalityName", width: 150, ellipsis: true,
      render: (v) => v || <Text type="danger" style={{ fontSize: 11 }}>Not set</Text>,
    },
    {
      title: "Province", dataIndex: "provinceName", width: 130, ellipsis: true,
      render: (v) => v || <Text type="danger" style={{ fontSize: 11 }}>Not set</Text>,
    },
    {
      // Resolved server-side against the Region III masterlist (utils/region3),
      // not by comparing strings here — so this column agrees with the LGU
      // dashboard's served/unserved counts by construction.
      title: "Region", dataIndex: "regionClass", width: 120, align: "center",
      // Values come from region3.REGION_CLASS.
      render: (v) => {
        if (v === "within-region-3") return <Tag color="green" bordered={false}>Region III</Tag>;
        if (v === "outside-region-3") return <Tag color="orange" bordered={false}>Outside R3</Tag>;
        return <Text type="secondary" style={{ fontSize: 11 }}>Unclassified</Text>;
      },
    },
    ...(canEdit ? [{
      title: "Actions", width: 78, fixed: "right", align: "center",
      render: (_, row) => (
        <Space size={0}>
          <Tooltip title="Edit client">
            <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(row)} />
          </Tooltip>
          <Tooltip title="Delete client">
            <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => handleDelete(row)} />
          </Tooltip>
        </Space>
      ),
    }] : []),
  ];

  if (!slfGeneratorId) {
    return (
      <Alert
        type="info"
        showIcon
        message="No linked baseline record"
        description="Hauler clients live inside the portal user's baseline submission. Once this SLF has a baseline, its clients appear here."
      />
    );
  }

  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      {error ? <Alert type="error" showIcon message={error} /> : null}
      {incompleteCount > 0 ? (
        <Alert
          type="warning"
          showIcon
          message={`${incompleteCount} client${incompleteCount === 1 ? "" : "s"} missing a type or address`}
          description="These were submitted without complete details. Editing them here updates the portal user's baseline directly."
          action={
            <Button size="small" onClick={() => { setIncompleteOnly((v) => !v); setPage(1); }}>
              {incompleteOnly ? "Show all" : "Show only these"}
            </Button>
          }
        />
      ) : null}

      <Space wrap style={{ width: "100%", justifyContent: "space-between" }}>
        <Space wrap>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Search client, hauler, municipality"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            style={{ width: 250 }}
          />
          <Select
            allowClear
            placeholder="Client type"
            value={typeFilter}
            onChange={(v) => { setTypeFilter(v); setPage(1); }}
            options={CLIENT_TYPE_OPTIONS}
            style={{ minWidth: 140 }}
          />
        </Space>
        {canEdit ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} disabled={!haulers.length}>
            Add Client
          </Button>
        ) : null}
      </Space>

      <Table
        size="small"
        className="eswmp-table-dense"
        rowKey="key"
        loading={loading}
        dataSource={rows}
        columns={columns}
        tableLayout="fixed"
        scroll={{ x: 1000 }}
        locale={{ emptyText: <Empty description={`No hauler clients recorded for ${slfLabel || "this SLF"}`} /> }}
        pagination={{
          current: page,
          pageSize: limit,
          total,
          showSizeChanger: true,
          pageSizeOptions: ["10", "20", "50", "100"],
          showTotal: (t, range) => `${range[0]}-${range[1]} of ${t} clients`,
          onChange: (p, ps) => { setPage(p); setLimit(ps); },
          size: "small",
        }}
      />

      <Modal
        open={!!editing}
        title={editing?.clientName ? "Edit Hauler Client" : "Add Hauler Client"}
        onCancel={() => setEditing(null)}
        onOk={handleSave}
        okText={editing?.clientName ? "Save Changes" : "Add Client"}
        confirmLoading={saving}
        okButtonProps={{ disabled: saving }}
        // antd v6 name. `destroyOnClose` was renamed and is no longer honoured, so
        // the modal was not actually being destroyed; naming it correctly is what
        // guarantees the form remounts per open and re-applies initialValues.
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="This edits the portal user's baseline data and is visible to them immediately."
        />
        <Form
          form={form}
          layout="vertical"
          preserve={false}
          initialValues={modalInitialValues}
        >
          <Form.Item name="haulerName" label="Hauler" rules={[{ required: true, message: "Select the hauler this client belongs to." }]}>
            <Select
              showSearch
              options={haulerOptions}
              placeholder="Select hauler"
              optionFilterProp="label"
              disabled={!!editing?.clientName}
            />
          </Form.Item>
          <Form.Item
            name="clientName"
            label="Client Name"
            rules={[
              { required: true, message: "Client name is required." },
              { whitespace: true, message: "Client name cannot be blank." },
              { max: 200, message: "Client name is too long." },
            ]}
          >
            <Input placeholder="e.g. Barangay 1" />
          </Form.Item>
          <Form.Item name="clientType" label="Client Type" rules={[{ required: true, message: "Client type is required." }]}>
            <Select options={CLIENT_TYPE_OPTIONS} placeholder="LGU or Private" />
          </Form.Item>
          <Form.Item name="municipalityName" label="Municipality / City">
            <Input placeholder="e.g. Baler" />
          </Form.Item>
          <Form.Item name="provinceName" label="Province">
            <Input placeholder="e.g. Aurora" />
          </Form.Item>
          <Form.Item name="regionName" label="Region">
            <Input placeholder="e.g. Central Luzon" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
