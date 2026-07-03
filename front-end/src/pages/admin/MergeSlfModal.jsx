import { useEffect, useState } from "react";
import { Modal, Select, Alert, Typography, Space, Button, Tag } from "antd";
import { MergeCellsOutlined } from "@ant-design/icons";
import Swal from "sweetalert2";
import api from "../../api";

const { Text } = Typography;

// Developer-only tool to merge one or more source SLF names into a single
// canonical target SLF. All matching Portal Submissions + baseline records are
// reassigned. Preview shows the affected count before any write.
export default function MergeSlfModal({ open, onClose, onMerged }) {
  const [names, setNames] = useState([]);
  const [loadingNames, setLoadingNames] = useState(false);
  const [sources, setSources] = useState([]);
  const [target, setTarget] = useState(undefined);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSources([]);
    setTarget(undefined);
    setPreview(null);
    setLoadingNames(true);
    api
      .get("/data-slf/slf-names")
      .then(({ data }) => setNames(Array.isArray(data) ? data : []))
      .catch(() => setNames([]))
      .finally(() => setLoadingNames(false));
  }, [open]);

  // Sources exclude whatever is chosen as the target, and vice versa.
  const sourceOptions = names
    .filter((n) => n !== target)
    .map((n) => ({ label: n, value: n }));
  const targetOptions = names
    .filter((n) => !sources.includes(n))
    .map((n) => ({ label: n, value: n }));

  const runPreview = async () => {
    if (!sources.length || !target) return;
    setBusy(true);
    try {
      const { data } = await api.post("/data-slf/merge-slf", {
        sourceNames: sources,
        targetName: target,
        dryRun: true,
      });
      setPreview(data.affected ?? 0);
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Could not preview merge.", "error");
    } finally {
      setBusy(false);
    }
  };

  const runMerge = async () => {
    if (!sources.length || !target) return;
    const confirm = await Swal.fire({
      icon: "warning",
      title: "Merge SLF records?",
      html: `All submissions and baseline records under <b>${sources
        .map((s) => `"${s}"`)
        .join(", ")}</b> will be reassigned to <b>"${target}"</b>. This updates the data directly.`,
      showCancelButton: true,
      confirmButtonText: "Merge Now",
      confirmButtonColor: "#722ed1",
    });
    if (!confirm.isConfirmed) return;
    setBusy(true);
    try {
      const { data } = await api.post("/data-slf/merge-slf", {
        sourceNames: sources,
        targetName: target,
      });
      const archivedNote = data.facilitiesArchived
        ? ` ${data.facilitiesArchived} leftover facility record(s) archived.`
        : "";
      Swal.fire({
        icon: "success",
        title: "Merged",
        text: `${data.message || "SLF records merged."}${archivedNote}`,
        timer: 2600,
        showConfirmButton: false,
      });
      onMerged?.();
      onClose?.();
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Could not merge SLF records.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={
        <Space>
          <MergeCellsOutlined style={{ color: "#722ed1" }} />
          <span>Merge SLF Facilities</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      footer={[
        <Button key="cancel" onClick={onClose}>
          Cancel
        </Button>,
        <Button key="preview" onClick={runPreview} loading={busy} disabled={!sources.length || !target}>
          Preview
        </Button>,
        <Button
          key="merge"
          type="primary"
          onClick={runMerge}
          loading={busy}
          disabled={!sources.length || !target}
          style={{ background: "#722ed1", borderColor: "#722ed1" }}
        >
          Merge
        </Button>,
      ]}
      destroyOnHidden
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 14, borderRadius: 8 }}
        message="Combine duplicate SLF records"
        description="Pick the SLF name(s) to merge FROM (source) and the single SLF name to keep (target). All submissions and baseline records are reassigned to the target. Use Preview to see how many records will change first."
      />
      <div style={{ marginBottom: 12 }}>
        <Text strong style={{ display: "block", marginBottom: 4 }}>
          Merge from (source SLF names)
        </Text>
        <Select
          mode="multiple"
          allowClear
          loading={loadingNames}
          value={sources}
          onChange={(v) => {
            setSources(v);
            setPreview(null);
          }}
          options={sourceOptions}
          placeholder="Select one or more SLF names to merge"
          style={{ width: "100%" }}
          optionFilterProp="label"
          showSearch
        />
      </div>
      <div style={{ marginBottom: 12 }}>
        <Text strong style={{ display: "block", marginBottom: 4 }}>
          Keep as (target SLF name)
        </Text>
        <Select
          allowClear
          loading={loadingNames}
          value={target}
          onChange={(v) => {
            setTarget(v);
            setPreview(null);
          }}
          options={targetOptions}
          placeholder="Select the SLF name to keep"
          style={{ width: "100%" }}
          optionFilterProp="label"
          showSearch
        />
      </div>
      {preview != null && (
        <Alert
          type={preview > 0 ? "warning" : "info"}
          showIcon
          message={
            <span>
              <Tag color="purple">{preview}</Tag> record(s) will be reassigned to{" "}
              <b>{target}</b>.
            </span>
          }
        />
      )}
    </Modal>
  );
}
