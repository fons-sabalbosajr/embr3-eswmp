/**
 * My Documents (routes/portalDocuments.js, utils/portalDocuments.js,
 * utils/zipStream.js).
 *
 *   • A MOV that every submission's baseline snapshot repeats is listed ONCE,
 *     with the Submission IDs it appears in.
 *   • Only storage this app writes can be bundled; admin-restricted media and
 *     foreign URLs are listed but never fetched.
 *   • The .zip is a valid archive (read back with the CRCs checked).
 *
 * Run: node --test tests/portalDocuments.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const { PassThrough } = require("node:stream");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
delete process.env.REDIS_URL;
delete process.env.REDIS_HOST;

const DataSLF = require("../models/DataSLF");
const HaulerDeleteRequest = require("../models/HaulerDeleteRequest");
const SupportTicket = require("../models/SupportTicket");
const docs = require("../utils/portalDocuments");
const { ZipStream, crc32 } = require("../utils/zipStream");

const OWNER = "operator@example.com";
const DRIVE_MOV = "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view";
const LOCAL_MOV = "/eswm-pipeline/api/upload/files/1700000000-abc.pdf";

function stubSources({ records = [], letters = [], tickets = [] } = {}) {
  const query = (rows) => ({
    select() { return this; },
    sort() { return this; },
    maxTimeMS() { return this; },
    lean: async () => rows,
    then(resolve, reject) { return this.lean().then(resolve, reject); },
  });
  DataSLF.aggregate = () => ({ option: async () => records });
  HaulerDeleteRequest.find = () => query(letters);
  SupportTicket.find = () => query(tickets);
}

test("a MOV repeated in every snapshot is listed once with its Submission IDs", async () => {
  const mov = { url: DRIVE_MOV, fileName: "Active Cells (Cell 2).pdf", uploadedAt: "2026-11-12T01:00:00Z" };
  stubSources({
    records: [
      { idNo: "", hasTrucks: false, slfName: "Demo SLF", activeCellEntries: [{ cellName: "Cell 2", movAttachments: [mov] }] },
      { idNo: "SLF-PVT-PA-0001", hasTrucks: true, slfName: "Demo SLF", activeCellEntries: [{ cellName: "Cell 2", movAttachments: [mov] }] },
      { idNo: "SLF-PVT-PA-0002", hasTrucks: true, slfName: "Demo SLF", activeCellEntries: [{ cellName: "Cell 2", movAttachments: [mov] }] },
    ],
  });
  const list = await docs.collectPortalDocuments(OWNER);
  assert.equal(list.length, 1);
  assert.equal(list[0].type, "mov");
  assert.equal(list[0].section, "Active Cells");
  assert.equal(list[0].cellName, "Cell 2");
  assert.deepEqual(list[0].submissionIds, ["SLF-PVT-PA-0001", "SLF-PVT-PA-0002"]);
  assert.equal(list[0].downloadable, true);
});

test("section MOVs, Letters of Intent and the user's own ticket attachments are listed", async () => {
  stubSources({
    records: [{ idNo: "", hasTrucks: false, baselineMov: { haulers: [{ url: LOCAL_MOV, fileName: "haulers.pdf" }] } }],
    letters: [{ requestNo: "HDR-00012", haulerName: "Northwind", letterOfIntentUrl: DRIVE_MOV.replace("012345", "999999"), letterOfIntentFileName: "loi.pdf" }],
    tickets: [{
      ticketNo: "TCK-0001",
      subject: "Help",
      attachments: [{ url: "https://drive.google.com/file/d/1TicketAttachmentAbcdefghijklmno/view", name: "a.png" }],
      replies: [
        { isAdmin: true, attachments: [{ url: "https://drive.google.com/file/d/1AdminReplyAbcdefghijklmnopqrs/view", name: "admin.pdf" }] },
        { isAdmin: false, attachments: [{ url: "https://drive.google.com/file/d/1UserReplyAbcdefghijklmnopqrst/view", name: "mine.pdf" }] },
      ],
    }],
  });
  const list = await docs.collectPortalDocuments(OWNER);
  const names = list.map((d) => d.fileName).sort();
  assert.deepEqual(names, ["a.png", "haulers.pdf", "loi.pdf", "mine.pdf"], "an admin's reply attachment is not the user's document");
  assert.equal(list.find((d) => d.fileName === "haulers.pdf").section, "Accredited Haulers");
  assert.equal(list.find((d) => d.fileName === "loi.pdf").reference, "HDR-00012");
});

test("only app storage can be bundled", () => {
  assert.deepEqual(docs.resolveDocumentSource(LOCAL_MOV), { kind: "local", fileName: "1700000000-abc.pdf" });
  assert.equal(docs.resolveDocumentSource(DRIVE_MOV).kind, "drive");
  assert.equal(docs.resolveDocumentSource("/api/upload/secure/local/x.pdf.enc?sig=1"), null, "admin media");
  assert.equal(docs.resolveDocumentSource("/api/upload/files/x.pdf.enc"), null, "encrypted file");
  assert.equal(docs.resolveDocumentSource("https://evil.example.com/file.pdf"), null, "foreign URL");
  assert.equal(docs.resolveDocumentSource("http://169.254.169.254/latest"), null, "metadata endpoint");
  assert.equal(docs.resolveDocumentSource("/api/upload/files/..%2F..%2Fsecrets"), null, "traversal");
});

test("the client view does not expose storage internals", async () => {
  stubSources({ records: [{ idNo: "", hasTrucks: false, baselineMov: { activeCells: [{ url: LOCAL_MOV }] } }] });
  const [doc] = await docs.collectPortalDocuments(OWNER);
  assert.equal("source" in docs.publicDocument(doc), false);
});

test("zip paths are grouped by type and safe", () => {
  assert.equal(
    docs.zipPathFor({ type: "mov", section: "Active Cells", cellName: "Cell 2", fileName: "x.pdf" }),
    "MOV/Active Cells - Cell 2/x.pdf",
  );
  assert.equal(
    docs.zipPathFor({ type: "letter", reference: "HDR-1", fileName: "../../etc/passwd" }),
    "Letters of Intent/HDR-1 - _.._etc_passwd",
  );
});

// Minimal reader: walk the central directory and inflate each entry.
function readZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let i = 0; i < count; i += 1) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString("utf8");
    const localNameLen = buf.readUInt16LE(local + 26);
    const start = local + 30 + localNameLen;
    const body = buf.slice(start, start + csize);
    const data = method === 8 ? zlib.inflateRawSync(body) : body;
    assert.equal(crc32(data), crc, `CRC of ${name}`);
    out[name] = data.toString("utf8");
    p += 46 + nameLen;
  }
  return out;
}

test("ZipStream writes an archive that reads back intact", async () => {
  const sink = new PassThrough();
  const chunks = [];
  sink.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve) => sink.on("end", resolve));
  const zip = new ZipStream(sink);
  await zip.addFile("MOV/Active Cells - Cell 2/report.pdf", Buffer.from("a".repeat(5000)));
  await zip.addFile("MOV/Active Cells - Cell 2/report.pdf", Buffer.from("second copy"));
  await zip.addFile("Letters of Intent/ñame.txt", Buffer.from("x"));
  await zip.finalize();
  await done;
  const files = readZip(Buffer.concat(chunks));
  assert.deepEqual(Object.keys(files), [
    "MOV/Active Cells - Cell 2/report.pdf",
    "MOV/Active Cells - Cell 2/report (2).pdf",
    "Letters of Intent/ñame.txt",
  ]);
  assert.equal(files["MOV/Active Cells - Cell 2/report.pdf"].length, 5000);
  assert.equal(files["MOV/Active Cells - Cell 2/report (2).pdf"], "second copy");
});

test("the download route takes ids, never URLs", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "routes", "portalDocuments.js"), "utf8");
  assert.doesNotMatch(source, /req\.body\??\.urls?\b/);
  assert.match(source, /collectPortalDocuments\(ctx\.email\)/);
});
