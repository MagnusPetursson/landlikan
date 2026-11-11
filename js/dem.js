// Elevation: Mapzen Terrain Tiles (Terrarium encoding) from the AWS Open Data
// registry. In Iceland the source is ArcticDEM. No key, no login.
//
// ArcticDEM heights in these tiles are above the WGS84 ellipsoid, about 60-68 m
// higher than height above sea level in Iceland. The geoid height is subtracted
// per point, which also puts the sea surface at 0 m.

import { TILE, pixelSpan, xToLon, yToLat } from './geo.js';
import { geoidHeight } from './geoid.js';

const DEM_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
export const DEM_MAX_ZOOM = 14; // ~4 m per pixel at 65°N; deeper zooms are upsampled
const MAX_TILES = 220;
const CONCURRENCY = 8;

export class DataError extends Error {
  constructor(code, detail) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

async function fetchBitmap(url, signal, tries = 3) {
  let lastError;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(url, { signal, mode: 'cors' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      return await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    } catch (err) {
      if (signal && signal.aborted) throw err;
      lastError = err;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  throw lastError;
}

export async function runPool(jobs, limit, signal) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    while (next < jobs.length) {
      if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const job = jobs[next++];
      await job();
    }
  });
  await Promise.all(workers);
}

// Choose grid size and tile zoom for a rectangle.
//   samples: requested points along the longer side.
export function planGrid(d, samples) {
  const long = Math.max(d.x1 - d.x0, d.y1 - d.y0);
  const world = 2 * Math.PI * 6378137;
  const pxAt = (z) => (long / world) * TILE * 2 ** z;
  // Never ask for more points than the source holds at its deepest zoom.
  const limit = Math.max(48, Math.round(pxAt(DEM_MAX_ZOOM)));
  const n = Math.max(48, Math.min(samples, limit));
  let z = Math.ceil(Math.log2(((n - 1) * world) / (long * TILE)));
  z = Math.max(4, Math.min(DEM_MAX_ZOOM, z));
  const tiles = (zz) => {
    const s = pixelSpan(d, zz);
    return (Math.floor(s.px1 / TILE) - Math.floor(s.px0 / TILE) + 1) * (Math.floor(s.py1 / TILE) - Math.floor(s.py0 / TILE) + 1);
  };
  while (z > 4 && tiles(z) > MAX_TILES) z--;
  const wide = d.aspect <= 1;
  const nx = wide ? n : Math.max(2, Math.round((n - 1) / d.aspect) + 1);
  const ny = wide ? Math.max(2, Math.round((n - 1) * d.aspect) + 1) : n;
  return { nx, ny, z, tileCount: tiles(z), limited: n < samples };
}

// Returns { data: Float32Array(nx*ny) in metres, row 0 = north, nx, ny, min, max, z }.
export async function loadElevation(d, plan, { signal, onProgress } = {}) {
  const { nx, ny, z } = plan;
  const span = pixelSpan(d, z);
  const tx0 = Math.floor(span.px0 / TILE) - (span.px0 % TILE < 1 ? 1 : 0);
  const ty0 = Math.floor(span.py0 / TILE) - (span.py0 % TILE < 1 ? 1 : 0);
  const tx1 = Math.floor((span.px1 + 1) / TILE);
  const ty1 = Math.floor((span.py1 + 1) / TILE);
  const max = 2 ** z - 1;
  const cols = tx1 - tx0 + 1;
  const rows = ty1 - ty0 + 1;
  const W = cols * TILE;
  const H = rows * TILE;
  const mosaic = new Float32Array(W * H);

  const canvas = document.createElement('canvas');
  canvas.width = TILE;
  canvas.height = TILE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const jobs = [];
  let done = 0;
  const total = cols * rows;
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      jobs.push(async () => {
        const ox = (tx - tx0) * TILE;
        const oy = (ty - ty0) * TILE;
        if (tx < 0 || ty < 0 || tx > max || ty > max) return;
        let bitmap;
        try {
          bitmap = await fetchBitmap(DEM_URL(z, tx, ty), signal);
        } catch (err) {
          if (signal && signal.aborted) throw err;
          throw new DataError('elevation', String(err && err.message || err));
        }
        ctx.clearRect(0, 0, TILE, TILE);
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close && bitmap.close();
        const px = ctx.getImageData(0, 0, TILE, TILE).data;
        for (let y = 0; y < TILE; y++) {
          let o = (oy + y) * W + ox;
          let p = y * TILE * 4;
          for (let x = 0; x < TILE; x++, o++, p += 4) {
            mosaic[o] = px[p] * 256 + px[p + 1] + px[p + 2] / 256 - 32768;
          }
        }
        done++;
        onProgress && onProgress(done, total);
      });
    }
  }
  await runPool(jobs, CONCURRENCY, signal);

  // Resample to the model grid. Pixel centres sit at +0.5.
  const ox = tx0 * TILE;
  const oy = ty0 * TILE;
  const stepX = (span.px1 - span.px0) / (nx - 1);
  const stepY = (span.py1 - span.py0) / (ny - 1);
  const taps = Math.max(stepX, stepY) > 1.3 ? 2 : 1;
  const sample = (fx, fy) => {
    let x = fx - ox - 0.5;
    let y = fy - oy - 0.5;
    if (x < 0) x = 0; else if (x > W - 1.001) x = W - 1.001;
    if (y < 0) y = 0; else if (y > H - 1.001) y = H - 1.001;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const u = x - xi;
    const v = y - yi;
    const i = yi * W + xi;
    return (mosaic[i] * (1 - u) + mosaic[i + 1] * u) * (1 - v) + (mosaic[i + W] * (1 - u) + mosaic[i + W + 1] * u) * v;
  };
  const data = new Float32Array(nx * ny);
  const lons = new Float64Array(nx);
  for (let i = 0; i < nx; i++) lons[i] = xToLon(d.x0 + ((d.x1 - d.x0) * i) / (nx - 1));
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = 0; j < ny; j++) {
    const fy = span.py0 + j * stepY;
    const lat = yToLat(d.y1 - ((d.y1 - d.y0) * j) / (ny - 1));
    for (let i = 0; i < nx; i++) {
      const fx = span.px0 + i * stepX;
      let h;
      if (taps === 1) {
        h = sample(fx, fy);
      } else {
        const ax = stepX / 4;
        const ay = stepY / 4;
        h = (sample(fx - ax, fy - ay) + sample(fx + ax, fy - ay) + sample(fx - ax, fy + ay) + sample(fx + ax, fy + ay)) / 4;
      }
      h -= geoidHeight(lat, lons[i]);
      if (!(h > 0)) h = 0; // sea, sea floor and bad values sit at sea level
      data[j * nx + i] = h;
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
  }
  return { data, nx, ny, min: lo, max: hi, z };
}
