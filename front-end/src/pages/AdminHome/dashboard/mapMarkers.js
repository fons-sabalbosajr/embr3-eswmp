import L from "leaflet";

// Leaflet marker icons shared by more than one dashboard tab.
//
// Tab-specific icon builders live inside their own tab component; this module is
// only for the ones two tabs genuinely share, so neither has to import from the
// other (which would create a cycle through the container).

/** Green ✓ operational · red ✕ non-operational · grey ● unknown. */
export function mrfStatusIcon(statusOfMRF) {
  const isOp = /operational/i.test(statusOfMRF) && !/non/i.test(statusOfMRF);
  const isNonOp = /non/i.test(statusOfMRF);
  const bg = isOp ? "#52c41a" : isNonOp ? "#ff4d4f" : "#8c8c8c";
  const icon = isOp ? "✓" : isNonOp ? "✕" : "●";
  return L.divIcon({
    className: "",
    html: `<div style="width:20px;height:20px;border-radius:50%;background:${bg};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:bold">${icon}</div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    popupAnchor: [0, -12],
  });
}
