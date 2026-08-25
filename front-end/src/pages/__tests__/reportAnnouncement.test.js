/**
 * Which announcement a report presents as current.
 *
 * A report is a statement of record. It used to list up to six announcements,
 * which reads as history rather than as the notice in force — and the PDF and the
 * DOCX export selected them separately, so the two documents could disagree about
 * what was current. One selector now feeds both.
 *
 * The rule delegates to resolveAnnouncementStatus rather than re-deriving
 * "enabled", because that module owns the lifecycle and duplicating it is how the
 * report would end up calling something active that the announcements console
 * does not.
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveAnnouncementStatus,
  selectLatestAnnouncement,
} from "../../utils/announcementLifecycle.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const NOW = new Date("2026-08-25T00:00:00Z").getTime();
const day = (n) => new Date(NOW + n * 86400000).toISOString();

test("nothing to show returns null, not an empty object", () => {
  assert.equal(selectLatestAnnouncement([], NOW), null);
  assert.equal(selectLatestAnnouncement(null, NOW), null);
  assert.equal(selectLatestAnnouncement(undefined, NOW), null);
  // An entry with neither a title nor a message is not an announcement.
  assert.equal(selectLatestAnnouncement([{ enabled: true }], NOW), null);
});

test("the ACTIVE announcement wins over everything else", () => {
  const items = [
    { title: "Draft note", message: "x" },
    { title: "Expired note", message: "x", enabled: true, endAt: day(-5) },
    { title: "Live note", message: "x", enabled: true, startAt: day(-1) },
    { title: "Scheduled note", message: "x", enabled: true, startAt: day(+5) },
  ];
  assert.equal(resolveAnnouncementStatus(items[2], NOW), "active");
  assert.equal(selectLatestAnnouncement(items, NOW).title, "Live note");
});

test("with no active one, a scheduled notice is preferred to a draft", () => {
  const items = [
    { title: "Draft note", message: "x" },
    { title: "Scheduled note", message: "x", enabled: true, startAt: day(+5) },
  ];
  assert.equal(selectLatestAnnouncement(items, NOW).title, "Scheduled note");
});

test("an expired notice is shown only when there is nothing else", () => {
  const expired = { title: "Expired note", message: "x", enabled: true, endAt: day(-5) };
  assert.equal(selectLatestAnnouncement([expired], NOW).title, "Expired note");
  // …but never in preference to something still current.
  const withDraft = [expired, { title: "Draft note", message: "x" }];
  assert.equal(selectLatestAnnouncement(withDraft, NOW).title, "Draft note");
});

test("within one status, the most recent wins", () => {
  const items = [
    { title: "Older", message: "x", enabled: true, startAt: day(-10) },
    { title: "Newer", message: "x", enabled: true, startAt: day(-2) },
    { title: "Oldest", message: "x", enabled: true, startAt: day(-30) },
  ];
  assert.equal(selectLatestAnnouncement(items, NOW).title, "Newer");
});

test("an announcement with no dates still resolves rather than being skipped", () => {
  // Publishing sets `enabled`; the dates are optional, and a notice saved without
  // them must not fall out of the selection entirely.
  const items = [{ title: "Undated", message: "x", enabled: true }];
  assert.equal(selectLatestAnnouncement(items, NOW).title, "Undated");
});

test("it returns exactly one announcement — never a list", () => {
  const items = [
    { title: "A", message: "x", enabled: true, startAt: day(-1) },
    { title: "B", message: "x", enabled: true, startAt: day(-2) },
    { title: "C", message: "x", enabled: true, startAt: day(-3) },
  ];
  const picked = selectLatestAnnouncement(items, NOW);
  assert.ok(!Array.isArray(picked));
  assert.equal(picked.title, "A");
});

test("the report and the DOCX export read the SAME selector", () => {
  // They are required to agree and had already drifted apart once: the export
  // dropped live announcements entirely while the on-screen report showed them.
  const src = fs.readFileSync(path.join(here, "..", "admin", "SlfSubmissionReport.jsx"), "utf8");
  assert.match(
    src,
    /import \{ selectLatestAnnouncement \} from "\.\.\/\.\.\/utils\/announcementLifecycle"/,
  );
  // One call site — a memo both paths read — rather than one selection each.
  assert.equal((src.match(/selectLatestAnnouncement\(/g) || []).length, 1);
  assert.match(src, /const latestAnnouncement = useMemo\(/);
  // And neither path may re-introduce a multi-announcement list.
  assert.doesNotMatch(src, /announcements[\s\S]{0,80}\.slice\(0, 6\)/);
});
