/**
 * Draft autosave timing rules (draftAutosave.js).
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTOSAVE_IDLE_MS,
  AUTOSAVE_RETRY_MS,
  autosaveDecision,
} from "../draftAutosave.js";

const base = {
  savedSignature: null,
  seenSignature: null,
  changedAt: 0,
  failedSignature: null,
  failedAt: 0,
  now: 100000,
};

test("an empty entry is never saved", () => {
  assert.equal(autosaveDecision({ ...base, signature: null }).action, "empty");
});

test("content matching the last save is clean", () => {
  assert.equal(
    autosaveDecision({ ...base, signature: "a", savedSignature: "a", seenSignature: "a" }).action,
    "clean",
  );
});

test("a new edit restarts the idle timer instead of saving at once", () => {
  assert.equal(
    autosaveDecision({ ...base, signature: "b", savedSignature: "a", seenSignature: "a" }).action,
    "changed",
  );
});

test("an edit is saved only after it has been unchanged for the idle delay", () => {
  const edited = { ...base, signature: "b", savedSignature: "a", seenSignature: "b" };
  assert.equal(
    autosaveDecision({ ...edited, changedAt: base.now - AUTOSAVE_IDLE_MS + 1 }).action,
    "wait",
  );
  assert.equal(
    autosaveDecision({ ...edited, changedAt: base.now - AUTOSAVE_IDLE_MS }).action,
    "save",
  );
});

test("the first save of a fresh entry happens after the idle delay", () => {
  assert.equal(
    autosaveDecision({
      ...base,
      signature: "first",
      seenSignature: "first",
      changedAt: base.now - AUTOSAVE_IDLE_MS,
    }).action,
    "save",
  );
});

test("a failed save is not retried on every tick", () => {
  const failed = {
    ...base,
    signature: "b",
    savedSignature: "a",
    seenSignature: "b",
    changedAt: base.now - 60000,
    failedSignature: "b",
  };
  assert.equal(autosaveDecision({ ...failed, failedAt: base.now - 1000 }).action, "wait");
  assert.equal(
    autosaveDecision({ ...failed, failedAt: base.now - AUTOSAVE_RETRY_MS }).action,
    "save",
  );
});

test("a new edit after a failure is saved without waiting out the retry delay", () => {
  assert.equal(
    autosaveDecision({
      ...base,
      signature: "c",
      savedSignature: "a",
      seenSignature: "c",
      changedAt: base.now - AUTOSAVE_IDLE_MS,
      failedSignature: "b",
      failedAt: base.now - 1000,
    }).action,
    "save",
  );
});
