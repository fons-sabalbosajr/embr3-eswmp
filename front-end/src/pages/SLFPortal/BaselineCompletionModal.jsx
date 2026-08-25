import { useCallback, useMemo, useRef, useState } from "react";
import { Alert, Button, Input, Modal, Select, Space, Table, Tag, Tooltip, Typography } from "antd";
import { CheckCircleOutlined, EditOutlined } from "@ant-design/icons";

import api from "../../api";
import {
  applyBaselineCompletionPatches,
  countCompletionEdits,
  summarizeBaselineCompleteness,
} from "./baselineCompleteness";

const { Text } = Typography;

// ── Complete Baseline Records ────────────────────────────────────────────────
//
// One place to fix everything the baseline is missing.
//
// Before this, the Data Entry pane listed the incomplete records and then sent the
// operator to the Accredited Haulers tab to find each one by hand: open the
// hauler, find the client inside it, fill the field, close, repeat. With a fleet
// of eighty haulers that is the reason the gaps never got closed.
//
// This edits the same records the hauler modal does and by the same rules — a
// blank cell means "leave what is stored", nothing is ever removed — but presents
// them as one work list. It writes into the hauler DRAFT, exactly as Add Client
// and the per-hauler client upload do; "Save Baseline Update" is still what
// persists it, and the modal says so rather than implying it has saved.
//
// The province list is fetched once for the whole modal, not per row: it is the
// flat nationwide list (see GET /settings/address/provinces), because a hauler's
// clients are routinely spread across several regions and making the operator
// pick a region first for every row would defeat the point. Municipalities load
// per province on demand and are cached for the life of the modal.

const REQUIRED_HINT = {
  "Client Type": "Splits LGU from private-sector reporting.",
  Province: "Classifies the client within or outside Region 3.",
  Municipality: "Feeds the served-LGU counts.",
  Clients: "Every disposal row is attributed through Hauler → Client, so this hauler's trips cannot be uploaded until it has one.",
  "Hauler Name": "The key every disposal row is matched on.",
  "Office Address": "Contact detail EMB Region III asks for.",
  "Client Address": "Contact detail EMB Region III asks for.",
  "Vehicle / Plate Number": "Identifies the truck on a disposal entry.",
};

export default function BaselineCompletionModal({
  open,
  onClose,
  haulers = [],
  onApply,
  onOpenHauler,
}) {
  const [patches, setPatches] = useState({});
  const [provinces, setProvinces] = useState([]);
  const [loadingProvinces, setLoadingProvinces] = useState(false);
  const [provinceError, setProvinceError] = useState("");
  // provinceCode → its cities/municipalities. Kept for the life of the modal so
  // completing ten clients in the same province costs one request, not ten.
  const [municipalitiesByProvince, setMunicipalitiesByProvince] = useState({});
  const [loadingMunicipalities, setLoadingMunicipalities] = useState({});

  const completeness = useMemo(
    () => summarizeBaselineCompleteness(haulers),
    [haulers],
  );

  // Re-derived on every render from the CURRENT fleet, so a row completed
  // elsewhere (or a hauler deleted) never leaves a stale editor row behind.
  const rows = completeness.rows;

  // Fetched from the modal's own open EVENT rather than from an effect keyed on
  // `open` — an effect would fire on every re-render that touched its deps, and
  // this is a one-shot load. The ref makes it idempotent across re-opens.
  const provinceFetchStarted = useRef(false);
  const ensureProvinces = useCallback(() => {
    if (provinceFetchStarted.current) return;
    provinceFetchStarted.current = true;
    setLoadingProvinces(true);
    setProvinceError("");
    api
      .get("/settings/address/provinces")
      .then(({ data }) => setProvinces(Array.isArray(data) ? data : []))
      .catch(() => {
        // Retryable: the next open tries again rather than leaving the operator
        // with permanently empty pickers.
        provinceFetchStarted.current = false;
        setProvinceError(
          "The province list could not be loaded. Close and reopen this window to try again.",
        );
      })
      .finally(() => setLoadingProvinces(false));
  }, []);

  // Discarding the draft is part of closing, not a side effect of it.
  const closeAndReset = () => {
    setPatches({});
    onClose();
  };

  const loadMunicipalities = useCallback(
    (provinceCode) => {
      if (!provinceCode || municipalitiesByProvince[provinceCode]) return;
      setLoadingMunicipalities((prev) => ({ ...prev, [provinceCode]: true }));
      api
        .get(`/settings/address/municipalities/${provinceCode}?includeSpecialZones=1`)
        .then(({ data }) =>
          setMunicipalitiesByProvince((prev) => ({
            ...prev,
            [provinceCode]: Array.isArray(data) ? data : [],
          })),
        )
        .catch(() =>
          setMunicipalitiesByProvince((prev) => ({ ...prev, [provinceCode]: [] })),
        )
        .finally(() =>
          setLoadingMunicipalities((prev) => ({ ...prev, [provinceCode]: false })),
        );
    },
    [municipalitiesByProvince],
  );

  const patchRow = (id, next) =>
    setPatches((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), ...next } }));

  // Selecting a province stores the CODE and the NAME together: the name is what
  // every downstream consumer reads (region classification, the LGU matcher, the
  // hauler export), and the code is what re-hydrates this select and the Add
  // Client form next time. Changing it clears the municipality beneath it, which
  // now belongs to a different province.
  const onProvinceChange = (row, code) => {
    const province = provinces.find((p) => String(p.code) === String(code));
    patchRow(row.id, {
      province: code || "",
      provinceName: province?.name || "",
      region: province?.regionCode || "",
      municipality: "",
      municipalityName: "",
    });
    if (code) loadMunicipalities(code);
  };

  const onMunicipalityChange = (row, code) => {
    const list = municipalitiesByProvince[patches[row.id]?.province] || [];
    const municipality = list.find((m) => String(m.code) === String(code));
    patchRow(row.id, {
      municipality: code || "",
      municipalityName: municipality?.name || "",
    });
  };

  const editedCount = countCompletionEdits(patches);

  const handleApply = () => {
    if (!editedCount) return;
    onApply(applyBaselineCompletionPatches(haulers, patches));
    setPatches({});
    onClose();
  };

  const missingTags = (row) => (
    <Space size={[4, 4]} wrap>
      {row.required.map((field) => (
        <Tooltip key={field} title={REQUIRED_HINT[field] || ""}>
          <Tag color="red" style={{ marginInlineEnd: 0, fontSize: 11.5 }}>{field}</Tag>
        </Tooltip>
      ))}
      {row.recommended.map((field) => (
        <Tooltip key={field} title={REQUIRED_HINT[field] || ""}>
          <Tag style={{ marginInlineEnd: 0, fontSize: 11.5 }}>{field}</Tag>
        </Tooltip>
      ))}
    </Space>
  );

  const columns = [
    {
      title: "Record",
      key: "record",
      width: 240,
      render: (_, row) => (
        <div style={{ lineHeight: 1.35 }}>
          <Text strong style={{ fontSize: 13.5 }}>{row.hauler}</Text>
          {row.client ? (
            <div style={{ fontSize: 13.5 }}>
              <Text type="secondary">→ </Text>
              {row.client}
            </div>
          ) : (
            <div>
              <Tag color="blue" style={{ fontSize: 11.5, marginInlineEnd: 0 }}>Hauler</Tag>
            </div>
          )}
        </div>
      ),
    },
    { title: "Missing", key: "missing", width: 210, render: (_, row) => missingTags(row) },
    {
      title: "Complete it here",
      key: "fix",
      render: (_, row) => {
        const patch = patches[row.id] || {};
        // A hauler with NO clients cannot be fixed by filling a field — it needs a
        // client added, which is the Add Client form's job. Send the operator
        // straight into that hauler rather than showing inputs that cannot help.
        if (row.kind === "hauler" && row.required.includes("Clients")) {
          return (
            <Space direction="vertical" size={4} style={{ width: "100%" }}>
              <Text type="secondary" style={{ fontSize: 13 }}>
                This hauler has no clients. Add at least one so its disposal entries can
                be attributed.
              </Text>
              <Space size={6} wrap>
                <Button
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => onOpenHauler?.(row.haulerIndex, "clients")}
                >
                  Add clients
                </Button>
                <Input
                  size="small"
                  placeholder="Office address (optional)"
                  value={patch.officeAddress ?? ""}
                  onChange={(e) => patchRow(row.id, { officeAddress: e.target.value })}
                  style={{ width: 240 }}
                />
              </Space>
            </Space>
          );
        }

        if (row.kind === "hauler") {
          return (
            <Input
              size="small"
              placeholder="Office address"
              value={patch.officeAddress ?? ""}
              onChange={(e) => patchRow(row.id, { officeAddress: e.target.value })}
            />
          );
        }

        const provinceCode = patch.province || "";
        const municipalityOptions = municipalitiesByProvince[provinceCode] || [];
        return (
          <Space direction="vertical" size={6} style={{ width: "100%" }}>
            <Space size={6} wrap>
              {row.required.includes("Client Name") && (
                <Input
                  size="small"
                  placeholder="Client name"
                  value={patch.clientName ?? ""}
                  onChange={(e) => patchRow(row.id, { clientName: e.target.value })}
                  style={{ width: 220 }}
                />
              )}
              <Select
                size="small"
                placeholder="Client type"
                value={patch.clientType || undefined}
                onChange={(value) => patchRow(row.id, { clientType: value })}
                options={[
                  { label: "LGU", value: "LGU" },
                  { label: "Private", value: "Private" },
                ]}
                style={{ width: 124 }}
                status={row.required.includes("Client Type") && !patch.clientType ? "warning" : ""}
              />
              <Select
                size="small"
                showSearch
                placeholder="Province"
                optionFilterProp="label"
                loading={loadingProvinces}
                value={provinceCode || undefined}
                onChange={(value) => onProvinceChange(row, value)}
                options={provinces.map((p) => ({ label: p.name, value: String(p.code) }))}
                style={{ width: 212 }}
                status={row.required.includes("Province") && !provinceCode ? "warning" : ""}
              />
              <Select
                size="small"
                showSearch
                placeholder={provinceCode ? "City/Municipality" : "Pick a province first"}
                optionFilterProp="label"
                disabled={!provinceCode}
                loading={!!loadingMunicipalities[provinceCode]}
                value={patch.municipality || undefined}
                onChange={(value) => onMunicipalityChange(row, value)}
                options={municipalityOptions.map((m) => ({
                  label: m.isSpecialZone ? `${m.name} — special economic zone` : m.name,
                  value: String(m.code),
                }))}
                style={{ width: 232 }}
              />
            </Space>
            <Input
              size="small"
              placeholder="Client address (optional)"
              value={patch.clientAddress ?? ""}
              onChange={(e) => patchRow(row.id, { clientAddress: e.target.value })}
            />
          </Space>
        );
      },
    },
  ];

  return (
    <Modal
      title={
        <Space>
          <CheckCircleOutlined style={{ color: "#1a3353" }} />
          <Text strong>Complete Baseline Records</Text>
        </Space>
      }
      open={open}
      afterOpenChange={(isOpen) => isOpen && ensureProvinces()}
      onCancel={closeAndReset}
      onOk={handleApply}
      okText={editedCount ? `Apply ${editedCount} update(s)` : "Apply updates"}
      okButtonProps={{ className: "slf-primary-btn", disabled: editedCount === 0 }}
      width="min(1200px, 100%)"
      style={{ top: 24 }}
      className="slf-upload-modal"
      destroyOnHidden
    >
      <div style={{ marginBottom: 10 }}>
        <Space wrap size={[6, 6]}>
          <Tag color="blue">{completeness.total} record(s)</Tag>
          {completeness.requiredCount > 0 && (
            <Tag color="red">{completeness.requiredCount} missing required details</Tag>
          )}
          {completeness.recommendedOnlyCount > 0 && (
            <Tag>{completeness.recommendedOnlyCount} missing contact details only</Tag>
          )}
          {completeness.haulersWithoutClients > 0 && (
            <Tag color="orange">{completeness.haulersWithoutClients} hauler(s) with no clients</Tag>
          )}
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 10 }}
        message="Nothing is saved yet."
        description={
          <span style={{ fontSize: 13.5 }}>
            Applying updates the Accredited Haulers table in this form only. Click{" "}
            <b>Save Baseline Update</b> afterwards to persist it. A field left blank keeps
            whatever is already stored — nothing here can clear or remove a record.
          </span>
        }
      />

      {provinceError && (
        <Alert type="warning" showIcon style={{ marginBottom: 10 }} message={provinceError} />
      )}

      <Table
        className="slf-upload-preview-table slf-slim-scroll"
        size="small"
        rowKey="id"
        dataSource={rows}
        columns={columns}
        pagination={{ pageSize: 10, showSizeChanger: false, showTotal: (t) => `${t} record(s)` }}
        scroll={{ y: "clamp(200px, 46vh, 420px)" }}
        locale={{
          emptyText: (
            <Text type="secondary" style={{ fontSize: 14 }}>
              Nothing is missing — every hauler and client is complete.
            </Text>
          ),
        }}
      />
    </Modal>
  );
}
