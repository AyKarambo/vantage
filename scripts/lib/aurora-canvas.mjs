// The shared pure-Node rendering engine for Vantage's brand graphics: a tiny
// anti-aliased RGBA canvas, the Aurora palette, the "V" chevron mark, and a PNG
// encoder. Used by both the app icon (make-tray-icon) and the store assets
// (make-store-assets) so the brand mark has a single source of truth. No deps —
// everything is drawn at SS× and box-downsampled for clean edges.
import { deflateSync } from 'node:zlib';

export const SS = 3; // supersample factor for anti-aliasing

// Vantage — Aurora palette (mirrors renderer/styles/tokens.css).
export const BG = [11, 11, 15];
export const BG_DEEP = [5, 5, 6];
export const ACCENT_BRIGHT = [136, 120, 255]; // #8878ff
export const ACCENT_DEEP = [98, 80, 230]; // #6250e6
export const ACCENT = [124, 108, 245]; // #7c6cf5
export const INK = [242, 242, 244]; // near-white mark

export class Canvas {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.buf = new Float32Array(w * h * 4); // straight RGBA 0..255
  }
  // Source-over blend a straight-alpha colour at (x,y). Coords are floored so
  // callers may pass fractional positions without hitting ignored TypedArray
  // (fractional) indices.
  blend(x, y, [r, g, b], a) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (a <= 0 || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    const ia = 1 - a;
    this.buf[i] = r * a + this.buf[i] * ia;
    this.buf[i + 1] = g * a + this.buf[i + 1] * ia;
    this.buf[i + 2] = b * a + this.buf[i + 2] * ia;
    this.buf[i + 3] = Math.min(255, a * 255 + this.buf[i + 3] * ia);
  }
  fill(color, a = 1) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.blend(x, y, color, a);
  }
  linear(deg, stops) {
    const rad = (deg * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    const corners = [[0, 0], [this.w, 0], [0, this.h], [this.w, this.h]].map(([x, y]) => x * dx + y * dy);
    const lo = Math.min(...corners);
    const hi = Math.max(...corners);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        this.blend(x, y, lerpStops(stops, ((x * dx + y * dy) - lo) / (hi - lo)), 1);
      }
    }
  }
  glow(cx, cy, r, color, strength) {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const d = Math.hypot(x - cx, y - cy) / r;
        if (d >= 1) continue;
        this.blend(x, y, color, (1 - d) * (1 - d) * strength);
      }
    }
  }
  fillPolygon(pts, color, a = 1) {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, py] of pts) {
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }
    for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(this.h - 1, Math.ceil(maxY)); y++) {
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[(i + 1) % pts.length];
        if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.max(0, Math.ceil(xs[k])); x <= Math.min(this.w - 1, Math.floor(xs[k + 1])); x++) {
          this.blend(x, y, color, a);
        }
      }
    }
  }
  gradientRoundRect(x0, y0, w, h, rad, deg, stops) {
    const rad2 = (deg * Math.PI) / 180;
    const dx = Math.cos(rad2);
    const dy = Math.sin(rad2);
    for (let y = Math.max(0, y0); y < Math.min(this.h, y0 + h); y++) {
      for (let x = Math.max(0, x0); x < Math.min(this.w, x0 + w); x++) {
        if (!insideRound(x - x0, y - y0, w, h, rad)) continue;
        const t = ((x - x0) * dx + (y - y0) * dy) / (w * Math.abs(dx) + h * Math.abs(dy));
        this.blend(x, y, lerpStops(stops, t), 1);
      }
    }
  }
  downsample(factor) {
    const out = new Canvas(this.w / factor, this.h / factor);
    for (let y = 0; y < out.h; y++) {
      for (let x = 0; x < out.w; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let sy = 0; sy < factor; sy++) {
          for (let sx = 0; sx < factor; sx++) {
            const i = ((y * factor + sy) * this.w + (x * factor + sx)) * 4;
            r += this.buf[i];
            g += this.buf[i + 1];
            b += this.buf[i + 2];
            a += this.buf[i + 3];
          }
        }
        const n = factor * factor;
        const o = (y * out.w + x) * 4;
        out.buf[o] = r / n;
        out.buf[o + 1] = g / n;
        out.buf[o + 2] = b / n;
        out.buf[o + 3] = a / n;
      }
    }
    return out;
  }
  toPngBuffer() {
    const { w, h } = this;
    const stride = w * 4;
    const raw = Buffer.alloc((stride + 1) * h);
    for (let y = 0; y < h; y++) {
      raw[y * (stride + 1)] = 0; // filter: none
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const o = y * (stride + 1) + 1 + x * 4;
        raw[o] = clamp8(this.buf[i]);
        raw[o + 1] = clamp8(this.buf[i + 1]);
        raw[o + 2] = clamp8(this.buf[i + 2]);
        raw[o + 3] = clamp8(this.buf[i + 3]);
      }
    }
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // RGBA
    return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
  }
}

// The Vantage mark: an upward chevron ("vantage point / peak"), a thick V.
export function drawChevron(cv, cx, cy, s, thickness, color) {
  const half = s / 2;
  const t = thickness;
  cv.fillPolygon([[cx - half, cy - half], [cx - half + t, cy - half], [cx + t * 0.5, cy + half], [cx - t * 0.5, cy + half]], color);
  cv.fillPolygon([[cx + half - t, cy - half], [cx + half, cy - half], [cx + t * 0.5, cy + half], [cx - t * 0.5, cy + half]], color);
}

// A subtle rising line + node motif to hint at stats tracking.
export function drawStatsMotif(cv, x0, y0, w, h, color, alpha) {
  const pts = [0.05, 0.35, 0.2, 0.55, 0.42, 0.7, 0.62, 0.85, 1.0];
  const line = pts.map((v, i) => [x0 + (i / (pts.length - 1)) * w, y0 + h - v * h]);
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, ay] = line[i];
    const [bx, by] = line[i + 1];
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay));
    for (let k = 0; k <= steps; k++) {
      const px = ax + (bx - ax) * (k / steps);
      const py = ay + (by - ay) * (k / steps);
      for (let ty = -2 * SS; ty <= 2 * SS; ty++) cv.blend(px, py + ty, color, alpha);
    }
  }
  for (const [px, py] of line) {
    for (let dy = -3 * SS; dy <= 3 * SS; dy++) {
      for (let dx = -3 * SS; dx <= 3 * SS; dx++) {
        if (dx * dx + dy * dy <= (3 * SS) * (3 * SS)) cv.blend(px + dx, py + dy, color, alpha * 1.2);
      }
    }
  }
}

// Fill an aurora background (near-black with a diagonal deepen).
export function auroraBase(cv) {
  cv.fill(BG_DEEP);
  cv.linear(120, [[0, BG_DEEP], [1, BG]]);
}

// The app/store icon: a rounded-square aurora badge with the white "V" mark.
// Rendered at SS× and downsampled to `size`. Reads well on dark and light.
export function renderBadgeIcon(size) {
  const S = size * SS;
  const cv = new Canvas(S, S);
  const pad = Math.max(1, Math.round(size * 0.04)) * SS;
  cv.gradientRoundRect(pad, pad, S - pad * 2, S - pad * 2, size * 0.26 * SS, 135, [
    [0, ACCENT_BRIGHT],
    [1, ACCENT_DEEP],
  ]);
  cv.glow(S * 0.32, S * 0.1, S * 0.7, [200, 190, 255], 0.35);
  drawChevron(cv, S / 2, S / 2 - size * 0.02 * SS, size * 0.47 * SS, size * 0.13 * SS, INK);
  return cv.downsample(SS);
}

// --- geometry / colour helpers -----------------------------------------------
export function insideRound(x, y, w, h, rad) {
  const cx = Math.min(Math.max(x, rad), w - rad);
  const cy = Math.min(Math.max(y, rad), h - rad);
  return Math.hypot(x - cx, y - cy) <= rad;
}
export function lerp(a, b, t) {
  return a + (b - a) * t;
}
export function lerpColor(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
export function lerpStops(stops, t) {
  const c = Math.min(Math.max(t, 0), 1);
  for (let i = 0; i + 1 < stops.length; i++) {
    const [p0, c0] = stops[i];
    const [p1, c1] = stops[i + 1];
    if (c >= p0 && c <= p1) return lerpColor(c0, c1, (c - p0) / (p1 - p0));
  }
  return stops[stops.length - 1][1];
}
function clamp8(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}
function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
