// ── Streaming .zip writer ──
//
// Writes a standard ZIP archive straight to a writable stream (an HTTP
// response), one file at a time, so a bundle of many documents never has to sit
// in memory as a whole. Each file is added as a complete Buffer — its CRC and
// sizes are known before its header is written, so no data descriptors are
// needed and every unzip tool reads the result.
//
// Deliberately small instead of a dependency: no ZIP64 (callers cap the bundle
// far below 4 GB) and no encryption. Names are written as UTF-8 (flag bit 11).
const zlib = require("zlib");

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  if (typeof zlib.crc32 === "function") return zlib.crc32(buffer) >>> 0;
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// MS-DOS date/time, local time (what unzip tools display).
function dosDateTime(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const MAX_ENTRIES = 65535;
const MAX_ZIP_BYTES = 0xffffffff;

class ZipStream {
  constructor(out) {
    this.out = out;
    this.offset = 0;
    this.entries = [];
    this.names = new Set();
  }

  async write(chunk) {
    this.offset += chunk.length;
    if (this.offset > MAX_ZIP_BYTES) throw new Error("Archive exceeds 4 GB.");
    if (!this.out.write(chunk)) {
      await new Promise((resolve, reject) => {
        const onDrain = () => { cleanup(); resolve(); };
        const onClose = () => { cleanup(); reject(new Error("Connection closed while writing the archive.")); };
        const cleanup = () => {
          this.out.off("drain", onDrain);
          this.out.off("close", onClose);
        };
        this.out.on("drain", onDrain);
        this.out.on("close", onClose);
      });
    }
  }

  /** A name that is not already in the archive ("a.pdf" → "a (2).pdf"). */
  uniqueName(name) {
    if (!this.names.has(name.toLowerCase())) return name;
    const slash = name.lastIndexOf("/");
    const dir = slash >= 0 ? name.slice(0, slash + 1) : "";
    const base = name.slice(slash + 1);
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : "";
    for (let n = 2; ; n += 1) {
      const candidate = `${dir}${stem} (${n})${ext}`;
      if (!this.names.has(candidate.toLowerCase())) return candidate;
    }
  }

  /** Add one file. Returns the name it was stored under. */
  async addFile(rawName, data, modified = new Date()) {
    if (this.entries.length >= MAX_ENTRIES) throw new Error("Too many files for one archive.");
    const name = this.uniqueName(rawName);
    this.names.add(name.toLowerCase());
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    // Deflate, unless it does not help (PDFs and images are usually compressed already).
    const deflated = zlib.deflateRawSync(data);
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;
    const { time, date } = dosDateTime(modified);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(0x0800, 6); // UTF-8 names
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28);

    const localOffset = this.offset;
    await this.write(header);
    await this.write(nameBuf);
    await this.write(body);
    this.entries.push({ nameBuf, crc, method, time, date, compressed: body.length, size: data.length, localOffset });
    return name;
  }

  async finalize() {
    const cdStart = this.offset;
    for (const e of this.entries) {
      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50, 0);
      cd.writeUInt16LE(20, 4); // version made by
      cd.writeUInt16LE(20, 6); // version needed
      cd.writeUInt16LE(0x0800, 8);
      cd.writeUInt16LE(e.method, 10);
      cd.writeUInt16LE(e.time, 12);
      cd.writeUInt16LE(e.date, 14);
      cd.writeUInt32LE(e.crc, 16);
      cd.writeUInt32LE(e.compressed, 20);
      cd.writeUInt32LE(e.size, 24);
      cd.writeUInt16LE(e.nameBuf.length, 28);
      // extra, comment, disk start, internal attrs = 0
      cd.writeUInt32LE(0, 38); // external attrs
      cd.writeUInt32LE(e.localOffset, 42);
      await this.write(cd);
      await this.write(e.nameBuf);
    }
    const cdSize = this.offset - cdStart;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(cdSize, 12);
    end.writeUInt32LE(cdStart, 16);
    await this.write(end);
    this.out.end();
  }
}

module.exports = { ZipStream, crc32 };
