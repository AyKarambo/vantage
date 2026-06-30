// Generates assets/tray.png (32px tray icon) and assets/appicon.png (256px app
// icon, which ow-electron-builder converts to .ico) — an Overwatch-orange disc.
// Pure Node built-ins, so no binary assets are committed to the repo.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const FG = [240, 100, 20]; // #f06414

function buildPixels(size) {
  const data = Buffer.alloc(size * size * 4, 0); // transparent
  const c = (size - 1) / 2;
  const r = size / 2 - 1;
  const edge = Math.max(1, size / 32);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.hypot(x - c, y - c);
      const alpha = dist <= r ? 255 : dist <= r + edge ? 140 : 0;
      if (alpha === 0) continue;
      const i = (y * size + x) * 4;
      data[i] = FG[0];
      data[i + 1] = FG[1];
      data[i + 2] = FG[2];
      data[i + 3] = alpha;
    }
  }
  return data;
}

function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size) {
  const pixels = buildPixels(size);
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw);

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const assets = path.join(__dirname, '..', 'assets');
fs.mkdirSync(assets, { recursive: true });
fs.writeFileSync(path.join(assets, 'tray.png'), encodePng(32));
fs.writeFileSync(path.join(assets, 'appicon.png'), encodePng(256));
console.log('wrote assets/tray.png (32) and assets/appicon.png (256)');
