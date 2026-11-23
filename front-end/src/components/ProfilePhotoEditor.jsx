import { useEffect, useRef, useState } from "react";
import { Avatar, Button, Dropdown, Modal, Slider, Space, Tooltip, Typography, message } from "antd";
import { CameraOutlined, DeleteOutlined, UserOutlined } from "@ant-design/icons";
import api from "../api";

const { Text } = Typography;

// Profile picture: avatar + "Change photo" for the signed-in account (admin or
// portal — the server picks the account from the token). The chosen image is
// cropped to a square and resized to 512×512 JPEG IN THE BROWSER, so a 12 MB
// phone photo uploads as ~60 KB and every picture in Drive has the same shape.
// Stored by the server in Google Drive › images › "Profile Pictures".

const OUTPUT_PX = 512;
const MAX_INPUT_MB = 15;
const ACCEPT = "image/jpeg,image/png,image/webp";

/** The avatar used everywhere: the picture when there is one, else the icon. */
export function ProfileAvatar({ photoUrl, size = "default", style, fallback, ...rest }) {
  // The URL that failed to load (a picture removed from Drive, an expired
  // session…) falls back to the icon; a new URL is tried afresh.
  const [brokenUrl, setBrokenUrl] = useState("");
  const src = photoUrl && photoUrl !== brokenUrl ? photoUrl : undefined;
  return (
    <Avatar
      size={size}
      src={src}
      icon={src || fallback ? undefined : <UserOutlined />}
      onError={() => {
        setBrokenUrl(photoUrl);
        return true;
      }}
      style={style}
      {...rest}
    >
      {src ? null : fallback}
    </Avatar>
  );
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file could not be read as an image."));
    };
    img.src = url;
  });
}

/** Square crop of `img`: zoom ≥ 1, offsets −1..1 across the spare width/height. */
function cropRect(img, zoom, offX, offY) {
  const side = Math.min(img.naturalWidth, img.naturalHeight) / zoom;
  const spareX = img.naturalWidth - side;
  const spareY = img.naturalHeight - side;
  return { sx: (spareX / 2) * (1 + offX), sy: (spareY / 2) * (1 + offY), side };
}

function renderCrop(canvas, img, zoom, offX, offY, px) {
  const { sx, sy, side } = cropRect(img, zoom, offX, offY);
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#ffffff"; // transparent PNGs get a white background in JPEG
  ctx.fillRect(0, 0, px, px);
  ctx.drawImage(img, sx, sy, side, side, 0, 0, px, px);
}

// `cameraOnly` (portal My Profile): the camera button on the avatar is the ONLY
// control — no "Add/Change photo · Remove" links underneath. With a photo set,
// the button opens a small menu (Change photo / Remove photo).
export default function ProfilePhotoEditor({ photoUrl, size = 88, color = "#1a3353", fallback, onChange, disabled = false, disabledReason = "", cameraOnly = false }) {
  const inputRef = useRef(null);
  const previewRef = useRef(null);
  const [source, setSource] = useState(null); // { img, url }
  const [zoom, setZoom] = useState(1);
  const [offX, setOffX] = useState(0);
  const [offY, setOffY] = useState(0);
  const [busy, setBusy] = useState(false);

  // Redraw the preview on every adjustment.
  useEffect(() => {
    if (source && previewRef.current) renderCrop(previewRef.current, source.img, zoom, offX, offY, 220);
  }, [source, zoom, offX, offY]);

  useEffect(() => () => source && URL.revokeObjectURL(source.url), [source]);

  const pick = () => inputRef.current?.click();

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // the same file can be picked again
    if (!file) return;
    if (!ACCEPT.split(",").includes(file.type)) {
      message.error("Choose a JPEG, PNG or WebP image.");
      return;
    }
    if (file.size > MAX_INPUT_MB * 1024 * 1024) {
      message.error(`Choose an image under ${MAX_INPUT_MB} MB.`);
      return;
    }
    try {
      const loaded = await loadImage(file);
      setZoom(1);
      setOffX(0);
      setOffY(0);
      setSource(loaded);
    } catch (err) {
      message.error(err.message);
    }
  };

  const close = () => setSource(null);

  const save = async () => {
    if (!source) return;
    setBusy(true);
    try {
      const canvas = document.createElement("canvas");
      renderCrop(canvas, source.img, zoom, offX, offY, OUTPUT_PX);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
      if (!blob) throw new Error("The picture could not be prepared.");
      const form = new FormData();
      form.append("photo", blob, "profile.jpg");
      const { data } = await api.post("/profile-photo", form);
      onChange?.(data.profilePhoto);
      message.success("Profile picture updated.");
      setSource(null);
    } catch (err) {
      message.error(err.response?.data?.message || err.message || "The picture could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const remove = () =>
    Modal.confirm({
      title: "Remove your profile picture?",
      okText: "Remove",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const { data } = await api.delete("/profile-photo");
          onChange?.(data.profilePhoto);
          message.success("Profile picture removed.");
        } catch (err) {
          message.error(err.response?.data?.message || "The picture could not be removed.");
        }
      },
    });

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <div style={{ position: "relative" }}>
        <ProfileAvatar
          photoUrl={photoUrl}
          size={size}
          fallback={fallback}
          style={{ background: color, fontSize: typeof size === "number" ? Math.round(size * 0.38) : undefined }}
        />
        {!disabled && cameraOnly && (
          <Tooltip title={photoUrl ? "Change profile picture" : "Add a profile picture"}>
            {photoUrl ? (
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: [
                    { key: "change", icon: <CameraOutlined />, label: "Change photo" },
                    { key: "remove", icon: <DeleteOutlined />, label: "Remove photo", danger: true },
                  ],
                  onClick: ({ key }) => (key === "remove" ? remove() : pick()),
                }}
              >
                <Button
                  type="primary"
                  shape="circle"
                  icon={<CameraOutlined />}
                  aria-label="Change profile picture"
                  style={{ position: "absolute", right: -4, bottom: -4, background: "#1a3353", border: "2px solid #fff", boxShadow: "0 1px 4px rgba(0,0,0,.3)" }}
                />
              </Dropdown>
            ) : (
              <Button
                type="primary"
                shape="circle"
                icon={<CameraOutlined />}
                onClick={pick}
                aria-label="Add a profile picture"
                style={{ position: "absolute", right: -4, bottom: -4, background: "#1a3353", border: "2px solid #fff", boxShadow: "0 1px 4px rgba(0,0,0,.3)" }}
              />
            )}
          </Tooltip>
        )}
        {!disabled && !cameraOnly && (
          <Button
            shape="circle"
            size="small"
            icon={<CameraOutlined />}
            onClick={pick}
            aria-label="Change profile picture"
            style={{ position: "absolute", right: -2, bottom: -2, boxShadow: "0 1px 4px rgba(0,0,0,.25)" }}
          />
        )}
      </div>
      {disabled ? (
        disabledReason ? <Text type="secondary" style={{ fontSize: 12 }}>{disabledReason}</Text> : null
      ) : cameraOnly ? null : (
        <Space size={4}>
          <Button size="small" type="link" icon={<CameraOutlined />} onClick={pick}>
            {photoUrl ? "Change photo" : "Add photo"}
          </Button>
          {photoUrl && (
            <Button size="small" type="link" danger icon={<DeleteOutlined />} onClick={remove}>
              Remove
            </Button>
          )}
        </Space>
      )}
      <input ref={inputRef} type="file" accept={ACCEPT} style={{ display: "none" }} onChange={onFile} />

      <Modal
        title="Profile picture"
        open={!!source}
        onCancel={close}
        onOk={save}
        okText="Save picture"
        confirmLoading={busy}
        destroyOnHidden
        width={360}
      >
        <div style={{ display: "flex", justifyContent: "center", margin: "8px 0 16px" }}>
          <canvas
            ref={previewRef}
            width={220}
            height={220}
            style={{ width: 220, height: 220, borderRadius: "50%", boxShadow: "0 0 0 1px rgba(0,0,0,.1)" }}
          />
        </div>
        <Text type="secondary" style={{ fontSize: 12 }}>Zoom</Text>
        <Slider min={1} max={3} step={0.01} value={zoom} onChange={setZoom} tooltip={{ open: false }} />
        <Text type="secondary" style={{ fontSize: 12 }}>Left / right</Text>
        <Slider min={-1} max={1} step={0.01} value={offX} onChange={setOffX} tooltip={{ open: false }} />
        <Text type="secondary" style={{ fontSize: 12 }}>Up / down</Text>
        <Slider min={-1} max={1} step={0.01} value={offY} onChange={setOffY} tooltip={{ open: false }} />
        <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 4 }}>
          Saved as a 512 × 512 picture in the system&apos;s Google Drive.
        </Text>
      </Modal>
    </div>
  );
}
