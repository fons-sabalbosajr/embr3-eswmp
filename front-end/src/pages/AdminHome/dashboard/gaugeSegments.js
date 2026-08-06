// Volume-contribution colours and the per-cell segment builder now live in the
// shared palette so the dashboard, the SLF edit modal and the Portal all render
// the same metric in the same colour. Re-exported here so existing imports in
// DashboardContent keep resolving.
export {
  cellVolumeSegments,
  storedVolumeOf,
  VOLUME_METRICS,
  BASELINE_COLOR as BASELINE_SEGMENT_COLOR,
  SUBMITTED_COLOR as SUBMITTED_SEGMENT_COLOR,
} from "../../../utils/volumeMetrics";
