import { EnvironmentOutlined, LinkOutlined } from "@ant-design/icons";
import { Button, Modal, Space, Typography } from "antd";

const { Text } = Typography;

// Read-only Google Maps preview for a facility's plotted coordinates.
export default function MapPreviewModal({
  mapPreview,
  setMapPreview,
}) {
  return (
    <Modal
      title={
        <Space>
          <EnvironmentOutlined />
          <span>{mapPreview?.label || "SLF Location"}</span>
        </Space>
      }
      open={!!mapPreview}
      onCancel={() => setMapPreview(null)}
      footer={
        <Space>
          {mapPreview && (
            <Button
              icon={<LinkOutlined />}
              href={`https://www.google.com/maps/search/?api=1&query=${mapPreview.latitude},${mapPreview.longitude}`}
              target="_blank"
              rel="noreferrer"
            >
              Open Google Maps
            </Button>
          )}
          <Button onClick={() => setMapPreview(null)}>Close</Button>
        </Space>
      }
      width={820}
      destroyOnHidden
    >
      {mapPreview && (
        <div>
          <Text
            type="secondary"
            style={{ display: "block", marginBottom: 8 }}
          >
            {mapPreview.latitude}, {mapPreview.longitude}
          </Text>
          <iframe
            title="SLF map preview"
            src={`https://maps.google.com/maps?q=${mapPreview.latitude},${mapPreview.longitude}&z=16&output=embed`}
            style={{
              width: "100%",
              height: 420,
              border: 0,
              borderRadius: 8,
            }}
            loading="lazy"
          />
        </div>
      )}
    </Modal>
  );
}
