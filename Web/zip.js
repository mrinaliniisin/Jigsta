'use strict';
// Minimal zip reader/writer — enough for Instagram exports (deflate, ZIP64) and our own backups (stored).
const Zip = (() => {
  const u16 = (v, o) => v.getUint16(o, true);
  const u32 = (v, o) => v.getUint32(o, true);
  const u64 = (v, o) => Number(v.getBigUint64(o, true));
  const MAX32 = 0xffffffff;
  const view = async (file, start, end) => new DataView(await file.slice(start, end).arrayBuffer());

  /** Reads only the central directory up front; entry data is sliced from the File on demand. */
  async function read(file) {
    const tailStart = Math.max(0, file.size - 65557);   // EOCD (22 bytes) + max comment (65535)
    const tail = await view(file, tailStart, file.size);
    let eocd = -1;
    for (let i = tail.byteLength - 22; i >= 0; i--) {
      if (u32(tail, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error(`${file.name} is not a zip file`);

    let count = u16(tail, eocd + 10);
    let cdSize = u32(tail, eocd + 12);
    let cdOffset = u32(tail, eocd + 16);
    if (count === 0xffff || cdSize === MAX32 || cdOffset === MAX32) {   // ZIP64: exports over 4 GB
      const locator = eocd - 20;
      if (locator < 0 || u32(tail, locator) !== 0x07064b50) throw new Error('Unsupported zip layout');
      const at = u64(tail, locator + 8);
      const rec = await view(file, at, at + 56);
      count = u64(rec, 32);
      cdSize = u64(rec, 40);
      cdOffset = u64(rec, 48);
    }

    const cd = await view(file, cdOffset, cdOffset + cdSize);
    const utf8 = new TextDecoder();
    const entries = new Map();
    for (let p = 0, i = 0; i < count && u32(cd, p) === 0x02014b50; i++) {
      const method = u16(cd, p + 10);
      let csize = u32(cd, p + 20);
      let size = u32(cd, p + 24);
      let offset = u32(cd, p + 42);
      const nameLen = u16(cd, p + 28);
      const extraLen = u16(cd, p + 30);
      const commentLen = u16(cd, p + 32);
      const name = utf8.decode(new Uint8Array(cd.buffer, p + 46, nameLen));
      // ZIP64 extra field carries the real values for any header field saturated at 0xFFFFFFFF.
      for (let x = p + 46 + nameLen, end = x + extraLen; x + 4 <= end; x += 4 + u16(cd, x + 2)) {
        if (u16(cd, x) !== 1) continue;
        let q = x + 4;
        if (size === MAX32) { size = u64(cd, q); q += 8; }
        if (csize === MAX32) { csize = u64(cd, q); q += 8; }
        if (offset === MAX32) offset = u64(cd, q);
      }
      if (!name.endsWith('/')) entries.set(name, { method, csize, offset });
      p += 46 + nameLen + extraLen + commentLen;
    }

    return {
      names: [...entries.keys()],
      async blob(name, type = '') {
        const e = entries.get(name);
        const local = await view(file, e.offset, e.offset + 30);
        const start = e.offset + 30 + u16(local, 26) + u16(local, 28);
        const raw = file.slice(start, start + e.csize);
        if (e.method === 0) return new Blob([raw], { type });
        if (e.method !== 8) throw new Error(`Unsupported compression in ${name}`);
        const inflated = await new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
        return new Blob([inflated], { type });
      },
    };
  }

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (bytes) => {
    let c = MAX32;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ MAX32) >>> 0;
  };

  /** Writes an uncompressed zip (photos are already compressed). files: [{ name, blob }] */
  async function write(files) {
    const utf8 = new TextEncoder();
    const body = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const name = utf8.encode(f.name);
      const data = new Uint8Array(await f.blob.arrayBuffer());
      const crc = crc32(data);

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);   // names are UTF-8
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      body.push(local, name, data);

      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true);
      entry.setUint16(4, 20, true);
      entry.setUint16(6, 20, true);
      entry.setUint16(8, 0x0800, true);
      entry.setUint32(16, crc, true);
      entry.setUint32(20, data.length, true);
      entry.setUint32(24, data.length, true);
      entry.setUint16(28, name.length, true);
      entry.setUint32(42, offset, true);
      central.push(entry, name);

      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((n, part) => n + part.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...body, ...central, end], { type: 'application/zip' });
  }

  return { read, write };
})();
