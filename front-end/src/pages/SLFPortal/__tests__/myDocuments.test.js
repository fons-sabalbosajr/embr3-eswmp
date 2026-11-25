/**
 * My Documents list filtering (myDocuments.js).
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  countByType,
  fileNameFromDisposition,
  filterDocuments,
  formatSize,
  placeOptions,
} from "../myDocuments.js";

const DOCS = [
  { id: "1", type: "mov", section: "Active Cells", cellName: "Cell 2", fileName: "Active Cells (Cell 2).pdf", submissionIds: ["SLF-2026-0342"] },
  { id: "2", type: "mov", section: "Closed Cells", cellName: "", fileName: "Closed Cells.pdf", submissionIds: [] },
  { id: "3", type: "letter", section: "Hauler deletion · Northwind", fileName: "loi.pdf", reference: "HDR-00012", submissionIds: [] },
  { id: "4", type: "attachment", section: "Support ticket · Help", fileName: "photo.png", reference: "TCK-0001", submissionIds: [] },
];

test("type filter", () => {
  assert.deepEqual(filterDocuments(DOCS, { type: "mov" }).map((d) => d.id), ["1", "2"]);
  assert.equal(filterDocuments(DOCS, { type: "all" }).length, 4);
});

test("cell / section filter", () => {
  assert.deepEqual(filterDocuments(DOCS, { place: "Active Cells · Cell 2" }).map((d) => d.id), ["1"]);
  assert.deepEqual(filterDocuments(DOCS, { place: "Closed Cells" }).map((d) => d.id), ["2"]);
});

test("search matches file name, Submission ID and request number", () => {
  assert.deepEqual(filterDocuments(DOCS, { search: "0342" }).map((d) => d.id), ["1"]);
  assert.deepEqual(filterDocuments(DOCS, { search: "hdr-00012" }).map((d) => d.id), ["3"]);
  assert.deepEqual(filterDocuments(DOCS, { search: "PHOTO" }).map((d) => d.id), ["4"]);
});

test("cell / section options list MOV places first", () => {
  assert.deepEqual(placeOptions(DOCS).map((o) => o.value), [
    "Active Cells · Cell 2",
    "Closed Cells",
    "Hauler deletion · Northwind",
    "Support ticket · Help",
  ]);
});

test("counts per type", () => {
  assert.deepEqual(countByType(DOCS), { all: 4, mov: 2, letter: 1, attachment: 1 });
});

test("zip file name comes from Content-Disposition", () => {
  assert.equal(
    fileNameFromDisposition(`attachment; filename="My Documents - Demo.zip"; filename*=UTF-8''My%20Documents%20-%20Se%C3%B1or.zip`),
    "My Documents - Señor.zip",
  );
  assert.equal(fileNameFromDisposition(`attachment; filename="a.zip"`), "a.zip");
  assert.equal(fileNameFromDisposition(""), "My Documents.zip");
});

test("sizes", () => {
  assert.equal(formatSize(512), "512 B");
  assert.equal(formatSize(2048), "2 KB");
  assert.equal(formatSize(5 * 1024 * 1024), "5.0 MB");
  assert.equal(formatSize(null), "");
});
