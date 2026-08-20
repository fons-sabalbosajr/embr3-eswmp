/**
 * REGRESSION — the upload preview's Clients picker crashed the whole modal.
 *
 *   TypeError: Cannot read properties of undefined (reading 'options')
 *     at dig (antd) → useOptions → Select
 *
 * The cause was `new Map([...optionObjects, ...pairs])`. Map's constructor takes
 * an iterable of [key, value] PAIRS; handed an option OBJECT it reads index 0
 * and 1 — both `undefined` — so every option in that group collapsed into one
 * `undefined → undefined` entry and `.values()` emitted `undefined` as an
 * option. antd then dereferenced `.options` on it and threw.
 *
 * It only fired when the baseline ALREADY had haulers with clients, because
 * that is the only time the object-shaped group is non-empty — which is why it
 * survived until the preview was exercised against real data.
 *
 * These tests assert the property that matters to antd: every emitted option is
 * a usable { label, value } object. Never undefined, never a hole.
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { mergeSelectOptions } from "../helpers.js";

const here = path.dirname(fileURLToPath(import.meta.url));

// The shape uploadClientOptions really produces — objects, with an extra `key`.
const stored = [
  { label: "ABC Manufacturing", value: "ABC Manufacturing", key: "ABC Manufacturing" },
  { label: "DEF Foods", value: "DEF Foods", key: "DEF Foods" },
];

const assertUsable = (options) => {
  assert.ok(Array.isArray(options));
  options.forEach((option, index) => {
    assert.notEqual(option, undefined, `option ${index} is undefined — antd will throw on it`);
    assert.notEqual(option, null, `option ${index} is null`);
    assert.equal(typeof option, "object");
    assert.equal(typeof option.value, "string");
    assert.ok(option.value.length > 0, `option ${index} has an empty value`);
    assert.ok(option.label, `option ${index} has no label`);
  });
};

test("REGRESSION — stored client options never produce an undefined option", () => {
  // The exact crash condition: a non-empty group of option OBJECTS.
  const options = mergeSelectOptions(stored, []);
  assertUsable(options);
  assert.equal(options.length, 2);
  assert.deepEqual(options.map((o) => o.value), ["ABC Manufacturing", "DEF Foods"]);
});

test("the row's own client names are merged with the stored ones", () => {
  // A name typed into the file that is not on the baseline yet must still be
  // offered, or the preview would show a selected tag with no matching option.
  const options = mergeSelectOptions(
    stored,
    ["ABC Manufacturing", "Brand New Client"].map((name) => ({ label: name, value: name })),
  );
  assertUsable(options);
  assert.deepEqual(
    options.map((o) => o.value),
    ["ABC Manufacturing", "DEF Foods", "Brand New Client"],
    "existing first, new appended, no duplicate",
  );
});

test("duplicates collapse case- and whitespace-insensitively, first wins", () => {
  const options = mergeSelectOptions(stored, [
    { label: "  abc   manufacturing  ", value: "  ABC Manufacturing  " },
    { label: "def foods", value: "DEF FOODS" },
  ]);
  assert.equal(options.length, 2, "the same client must not be offered twice");
  assert.equal(options[0].label, "ABC Manufacturing", "the stored spelling is kept");
});

test("blank and malformed entries are dropped, not passed through", () => {
  // Each of these would render as an empty, unselectable row — and `undefined`
  // is the one that actually crashed antd.
  const options = mergeSelectOptions(
    [undefined, null, {}, { value: "" }, { value: "   " }, { label: "No value" }],
    [{ label: "Real Client", value: "Real Client" }],
  );
  assertUsable(options);
  assert.deepEqual(options, [{ label: "Real Client", value: "Real Client" }]);
});

test("an option with a value but no label is still usable", () => {
  const [option] = mergeSelectOptions([{ value: "Unlabelled Co" }]);
  assert.equal(option.label, "Unlabelled Co", "the value stands in as the label");
});

test("no groups, empty groups and non-array input do not throw", () => {
  assert.deepEqual(mergeSelectOptions(), []);
  assert.deepEqual(mergeSelectOptions([], []), []);
  assert.doesNotThrow(() => mergeSelectOptions(undefined, null));
});

test("REGRESSION — the broken construction is gone from the modal", () => {
  // Pinning the call site too: reintroducing `new Map([...options])` anywhere
  // near the preview would bring the crash straight back, and it looks correct
  // at a glance.
  const modals = fs.readFileSync(path.join(here, "..", "SLFPortalModals.jsx"), "utf8");
  assert.match(modals, /options=\{mergeSelectOptions\(/, "the picker uses the safe helper");
  assert.doesNotMatch(
    modals,
    /new Map\(\s*\[\s*\n\s*\.\.\.uploadClientOptions/,
    "option objects must never be fed to the Map constructor again",
  );
});
