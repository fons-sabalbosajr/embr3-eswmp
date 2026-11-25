import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { isBaselineDirty } from "./baselineDirty.js";

const POLL_MS = 2000;

// ── Track unsaved baseline edits ──
//
//   dirty        boolean for the UI ("Unsaved changes"), refreshed every 2 s
//   isDirtyNow() the answer right now, for guards (logout, SLF switch, a
//                remote refresh, beforeunload)
//   markClean()  call when the baseline has just been LOADED or SAVED; the
//                snapshot is taken once loading has finished and the new state
//                has rendered
//
// `enabled` is false while the baseline is locked — nothing can be edited, so
// nothing can be unsaved.
export default function useBaselineDirty({ enabled, loading, getSignature }) {
  const [dirty, setDirty] = useState(false);
  const [cleanTick, setCleanTick] = useState(0);
  const snapshotRef = useRef(null);
  const pendingCleanRef = useRef(true);
  const getSignatureRef = useRef(getSignature);
  const enabledRef = useRef(enabled);
  useLayoutEffect(() => {
    getSignatureRef.current = getSignature;
    enabledRef.current = enabled;
  });

  const markClean = useCallback(() => {
    pendingCleanRef.current = true;
    setCleanTick((n) => n + 1);
  }, []);

  // Take the snapshot once the loaded state has rendered.
  useEffect(() => {
    if (loading || !pendingCleanRef.current) return;
    pendingCleanRef.current = false;
    try {
      snapshotRef.current = getSignatureRef.current();
    } catch {
      snapshotRef.current = null;
    }
    setDirty(false);
  }, [loading, cleanTick]);

  const isDirtyNow = useCallback(() => {
    if (!enabledRef.current) return false;
    try {
      return isBaselineDirty(snapshotRef.current, getSignatureRef.current());
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setInterval(() => {
      const next = isDirtyNow();
      setDirty((prev) => (prev === next ? prev : next));
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, isDirtyNow]);

  // Closing or reloading the tab with unsaved edits asks first.
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (event) => {
      if (!isDirtyNow()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, isDirtyNow]);

  // A locked baseline has nothing unsaved, whatever the last poll saw.
  return { dirty: enabled && dirty, isDirtyNow, markClean };
}
