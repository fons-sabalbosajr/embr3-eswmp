import { useEffect, useRef, useState } from "react";
import { Button, Spin, Typography } from "antd";
import { FilePdfOutlined, ReloadOutlined } from "@ant-design/icons";

const { Text } = Typography;

/**
 * Deferred `<iframe>` for PDFs and other embedded documents.
 *
 * A PDF embed blocks on the network before it paints anything, so a bare
 * `<iframe>` inside a modal shows an empty grey panel and reads as a frozen UI.
 * This wraps the embed with three things it lacks on its own:
 *
 *   • a spinner that covers the frame until the document's `load` event fires
 *   • `loading="lazy"` plus mount-on-open, so nothing is fetched until the
 *     modal is actually shown (pair with `destroyOnHidden` on the Modal)
 *   • a timeout → retry path, because a cross-origin embed that fails silently
 *     otherwise leaves the spinner up forever
 *
 * The iframe itself always stays mounted underneath the overlay — hiding it
 * until load would restart the fetch and the document would never appear.
 *
 * @param {string}  src        resolved preview URL
 * @param {string}  title      accessible frame title
 * @param {boolean} [active]   render the frame at all (defaults true)
 * @param {number}  [timeoutMs] how long before offering a retry
 */
export default function LazyDocumentFrame({
  src,
  title = "Document preview",
  active = true,
  timeoutMs = 20000,
  style,
}) {
  const [loaded, setLoaded] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  // Bumping this remounts the iframe, which is what actually re-requests the
  // document — reassigning the same src would be a no-op.
  const [attempt, setAttempt] = useState(0);
  const timerRef = useRef(null);

  // Callers rescale an already-loaded PDF by changing only the URL FRAGMENT
  // (`#zoom=…`), which the browser applies in place without refetching. Keying
  // the loading state on the fragment-stripped URL is what stops every zoom
  // step from flashing the spinner over a document that never went away.
  const documentKey = String(src || "").split("#")[0];

  useEffect(() => {
    setLoaded(false);
    setTimedOut(false);
  }, [documentKey, attempt]);

  useEffect(() => {
    if (!active || loaded) return undefined;
    timerRef.current = setTimeout(() => setTimedOut(true), timeoutMs);
    return () => clearTimeout(timerRef.current);
  }, [active, loaded, timeoutMs, documentKey, attempt]);

  if (!active || !src) return null;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", ...style }}>
      <iframe
        // Remount on retry OR on a genuinely different document; a fragment-only
        // change keeps the same element so the PDF is not re-downloaded.
        key={`${documentKey}-${attempt}`}
        title={title}
        src={src}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        style={{ width: "100%", height: "100%", border: "none" }}
        allow="autoplay"
      />
      {!loaded && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            background: "#525659",
            // Let clicks through once the document has painted underneath.
            pointerEvents: timedOut ? "auto" : "none",
          }}
        >
          {timedOut ? (
            <>
              <FilePdfOutlined style={{ fontSize: 28, color: "#ffffffa6" }} />
              <Text style={{ color: "#ffffffd9", fontSize: 12 }}>
                This document is taking longer than usual to load.
              </Text>
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => setAttempt((n) => n + 1)}
              >
                Retry
              </Button>
            </>
          ) : (
            <>
              <Spin />
              <Text style={{ color: "#ffffffd9", fontSize: 12 }}>Loading document…</Text>
            </>
          )}
        </div>
      )}
    </div>
  );
}
