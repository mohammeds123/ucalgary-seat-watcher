/**
 * Generates the extension icon set as PNGs, with no image dependencies.
 *
 * The mark: a dark rounded square with an off-centre green dot — the "seat
 * open" signal the whole extension exists to deliver. Regenerate with
 * `node scripts/make-icons.mjs` if the palette changes.
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icon");

const BG = [22, 24, 29]; // near-black, matches the popup's dark ground
const DOT = [74, 222, 128]; // the "open" green from the popup palette

function crc32(buf) {
  let c;
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  let crc = -1;
  for (const byte of buf) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Rounded-square coverage test, so the icon does not look like a raw block. */
function inRoundedSquare(x, y, size) {
  const r = size * 0.22;
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r || (x >= r && x <= size - r) || (y >= r && y <= size - r);
}

function makePng(size) {
  const dotR = size * 0.2;
  const dotX = size * 0.66;
  const dotY = size * 0.34;

  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const inside = inRoundedSquare(x + 0.5, y + 0.5, size);
      if (!inside) {
        raw[p++] = 0;
        raw[p++] = 0;
        raw[p++] = 0;
        raw[p++] = 0; // transparent corner
        continue;
      }
      const dx = x + 0.5 - dotX;
      const dy = y + 0.5 - dotY;
      const isDot = dx * dx + dy * dy <= dotR * dotR;
      const [r, g, b] = isDot ? DOT : BG;
      raw[p++] = r;
      raw[p++] = g;
      raw[p++] = b;
      raw[p++] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour + alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const size of [16, 32, 48, 96, 128]) {
  writeFileSync(join(OUT, `${size}.png`), makePng(size));
  console.log(`icon/${size}.png`);
}
