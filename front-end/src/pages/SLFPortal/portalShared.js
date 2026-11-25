// Module-level pieces shared by the SLF Portal container and its extracted
// hooks/components: antd sub-component aliases and the pure save/lock rules.
import { useCallback, useEffect, useRef } from "react";
import { Grid, Input, Layout, Select, Typography } from "antd";

export const { Text } = Typography;
export const { Option } = Select;
export const { Header, Sider, Content } = Layout;
export const { useBreakpoint } = Grid;
export const { TextArea } = Input;

/**
 * Resolve Total Volume Accepted for a save payload.
 *
 * Returns `undefined` when this edit did not actually supply the figure, so the
 * server's Total Volume guard preserves whatever is already stored. Returning a
 * number — including a deliberate 0 — writes it.
 *
 * Shared by all three save paths (Save Baseline, Edit & Resubmit, and
 * buildSubmissionEntry, which backs the Drafts/Scheduled queue) so the rule
 * cannot drift between them.
 *
 * The distinction that matters: `??` does not fall through on 0, so a stale or
 * default 0 sitting in the form STORE used to be sent and would overwrite a
 * real saved total with zero. A 0 that is genuinely on screen is honoured; a 0
 * that exists only because the store had a default is treated as "not provided".
 *
 * @param {boolean} authoritative  cell entries recompute the total (wins outright)
 * @param {number}  computed       the recomputed total
 * @param {*}       mountedValue   value from the RENDERED field, or undefined when
 *                                 its pane is closed/unmounted
 * @param {*}       storeValue     value from the full form store
 */
export function resolveTotalVolumeForSave({
  authoritative,
  computed,
  mountedValue,
  storeValue,
  baselineValue,
}) {
  const candidate = authoritative ? computed : (mountedValue ?? storeValue);
  const explicitlyOnScreen =
    mountedValue !== undefined && mountedValue !== null && mountedValue !== "" && Number(mountedValue) > 0;
  const meaningful = authoritative || explicitlyOnScreen || Number(candidate) > 0;
  if (meaningful) return candidate;
  return Number(baselineValue) > 0 ? baselineValue : undefined;
}

/**
 * Lock state for the Company Information + Baseline tabs.
 *
 * BUSINESS RULE: clicking "Save Baseline Update" locks both tabs IMMEDIATELY and
 * they stay locked — editing them again requires a fresh update request that an
 * admin approves. The lock is a data-security control, so it must not depend on
 * what the record happens to contain.
 *
 * That is why this reads the RECORD, not its payload. The lock used to be decided
 * by hasBaselinePayload(), which only tests for volumes, cell entries and
 * haulers — so a baseline saved with COMPANY INFORMATION ONLY looked "empty",
 * fell through to the not-saved branch and silently unlocked itself a moment
 * after saving.
 *
 * hasBaselinePayload() is still the right test for whether to POPULATE the form;
 * it was only ever wrong as the lock signal.
 *
 * @param {object|null} data GET /data-slf/baseline response (null = no record)
 */
export function resolveBaselineLock(data) {
  // No baseline record at all — first-time entry, tabs open.
  if (!data) return { locked: false, updatePending: false };
  // An approved update request is the ONLY thing that reopens the tabs.
  if (data.baselineUpdateApproved) return { locked: false, updatePending: false };
  return { locked: true, updatePending: !!data.baselineUpdateRequested };
}

/**
 * A handler whose IDENTITY never changes but whose BODY is always the latest one.
 *
 * Memoized children (OverviewPanel) re-render whenever a prop identity changes.
 * An inline `onClick={() => ...}` is a new function on every render, so the child
 * re-renders every time regardless of whether its data moved — which is what made
 * `memo()` on those panels do nothing.
 *
 * `useCallback` would be the usual answer, but it needs an exact dependency list,
 * and a missed dependency here means a handler quietly closing over stale state —
 * a correctness bug traded for a performance win. This keeps the newest closure in
 * a ref and hands out one stable wrapper, so there is no dependency list to get
 * wrong and no stale reads.
 */
export function useStableCallback(fn) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args) => ref.current?.(...args), []);
}
