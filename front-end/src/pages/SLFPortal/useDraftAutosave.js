import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AUTOSAVE_POLL_MS, autosaveDecision } from "./draftAutosave.js";

// ── Draft autosave hook ──
//
// Saves the Data Entry draft on its own while the operator works, through the
// same queue endpoint as Save as Draft (the container's `save`). The hook only
// decides WHEN; `getSignature` says what the entry currently is and `save`
// persists it.
//
// Polling, not change events: the entry lives in three AntD forms plus truck
// state, and a bulk upload, a loaded draft or a modal can all change it. Reading
// one signature every tick catches every source without wiring each one.
//
// Returns:
//   status   "idle" | "pending" | "saving" | "saved" | "error"
//   savedAt  Date of the last successful autosave
//   settle() resolves once any save in flight has finished — call it before
//            deleting the open draft on submit, so a save that was already
//            running cannot re-create it afterwards.
//   adoptNext() treats whatever the entry holds on the NEXT tick as already
//            saved. Call it after loading a draft or a reverted record into the
//            forms (state settles a render later), so opening one does not
//            immediately save it back unchanged.
export default function useDraftAutosave({ enabled, getSignature, save }) {
  const [status, setStatus] = useState("idle");
  const [savedAt, setSavedAt] = useState(null);

  // The latest callbacks, for the interval and in-flight saves to call. Updated
  // after each commit (before the next tick or event can run).
  const getSignatureRef = useRef(getSignature);
  const saveRef = useRef(save);
  useLayoutEffect(() => {
    getSignatureRef.current = getSignature;
    saveRef.current = save;
  });

  const savedRef = useRef(null);
  const seenRef = useRef(null);
  const changedAtRef = useRef(0);
  const failedRef = useRef({ signature: null, at: 0 });
  const inFlightRef = useRef(null);
  const adoptRef = useRef(false);

  const runSave = useCallback(async (signature) => {
    setStatus("saving");
    const pending = Promise.resolve().then(() => saveRef.current());
    inFlightRef.current = pending;
    try {
      await pending;
      savedRef.current = signature;
      failedRef.current = { signature: null, at: 0 };
      setSavedAt(new Date());
      setStatus("saved");
    } catch {
      failedRef.current = { signature, at: Date.now() };
      setStatus("error");
    } finally {
      if (inFlightRef.current === pending) inFlightRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const tick = () => {
      if (inFlightRef.current) return;
      let signature;
      try {
        signature = getSignatureRef.current();
      } catch {
        return; // a form mid-update — try again next tick
      }
      if (adoptRef.current) {
        adoptRef.current = false;
        savedRef.current = signature;
        seenRef.current = signature;
        setStatus("idle");
        return;
      }
      const now = Date.now();
      const { action } = autosaveDecision({
        signature,
        savedSignature: savedRef.current,
        seenSignature: seenRef.current,
        changedAt: changedAtRef.current,
        failedSignature: failedRef.current.signature,
        failedAt: failedRef.current.at,
        now,
      });
      if (action === "empty") {
        seenRef.current = null;
        setStatus("idle");
      } else if (action === "changed") {
        seenRef.current = signature;
        changedAtRef.current = now;
        setStatus((s) => (s === "error" ? s : "pending"));
      } else if (action === "save") {
        runSave(signature);
      }
    };
    const timer = setInterval(tick, AUTOSAVE_POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, runSave]);

  const settle = useCallback(
    () => (inFlightRef.current ? inFlightRef.current.catch(() => {}) : Promise.resolve()),
    [],
  );
  const adoptNext = useCallback(() => {
    adoptRef.current = true;
  }, []);

  return { status, savedAt, settle, adoptNext };
}
