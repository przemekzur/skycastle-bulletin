// Generates icons/icon{16,48,128}.png: gold diamond on a dark rounded square. No dependencies.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size) {
  const SS = 4; // supersampling for anti-aliasing
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const r = size * 0.22, c = size / 2, d = size * 0.34;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let bg = 0, fg = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
        const qx = Math.max(r - px, px - (size - r), 0), qy = Math.max(r - py, py - (size - r), 0);
        if (qx * qx + qy * qy <= r * r) bg++;
        if (Math.abs(px - c) + Math.abs(py - c) <= d) fg++;
      }
      bg /= SS * SS; fg /= SS * SS;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const [br, bgc, bb] = [0x16, 0x16, 0x19], [fr, fgc, fb] = [0xe8, 0xc2, 0x6a];
      raw[o] = Math.round(br + (fr - br) * fg);
      raw[o + 1] = Math.round(bgc + (fgc - bgc) * fg);
      raw[o + 2] = Math.round(bb + (fb - bb) * fg);
      raw[o + 3] = Math.round(255 * bg);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = ihdr[11] = ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const dir = new URL('../icons/', import.meta.url);
mkdirSync(dir, { recursive: true });
for (const s of [16, 48, 128]) writeFileSync(new URL(`icon${s}.png`, dir), png(s));
console.log('icons written');
