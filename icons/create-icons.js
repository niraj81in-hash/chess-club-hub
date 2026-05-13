#!/usr/bin/env node
// Generates solid-color PNG icons using only Node.js built-ins (no npm packages).
// Run once from the project root: node icons/create-icons.js
const zlib = require('zlib');
const fs   = require('fs');

function makeCRCTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
}
const CRC_TABLE = makeCRCTable();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const crcVal = crc32(Buffer.concat([t, data]));
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crcVal, 0);
  return Buffer.concat([len, t, data, crc]);
}

function solidPNG(w, h, r, g, b) {
  const sig = Buffer.from([137,80,78,71,13,10,26,10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(w, 0); ihdrData.writeUInt32BE(h, 4);
  ihdrData.writeUInt8(8, 8); ihdrData.writeUInt8(2, 9); // 8-bit RGB

  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    row[0] = 0; // filter: None
    for (let x = 0; x < w; x++) {
      const o = 1 + x * 3;
      row[o] = r; row[o+1] = g; row[o+2] = b;
    }
    rows.push(row);
  }
  const idat = zlib.deflateSync(Buffer.concat(rows));

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdrData),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// Electric violet #8b5cf6 = rgb(139, 92, 246)
const [R, G, B] = [0x8b, 0x5c, 0xf6];

fs.mkdirSync('icons', { recursive: true });
fs.writeFileSync('icons/icon-192.png', solidPNG(192, 192, R, G, B));
fs.writeFileSync('icons/icon-512.png', solidPNG(512, 512, R, G, B));
fs.writeFileSync('icons/og-image.png', solidPNG(1200, 630, R, G, B));
console.log('✅ icons/icon-192.png, icons/icon-512.png, icons/og-image.png created');
