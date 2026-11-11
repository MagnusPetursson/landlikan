// Elevation from two open tile sets (Terrarium encoding, no key, no login):
//
//   detail     Terrain Tiles on AWS Open Data, which hold ArcticDEM in Iceland,
//              down to about 4 m. It follows peaks and cliffs well. Its heights
//              are above the WGS84 ellipsoid (60-68 m higher than sea level
//              here), so the geoid height is subtracted. Patches of it are
//              filled from other data in another height system, and it is noisy
//              or wrong over water.
//   reference  Copernicus DEM GLO-30 as served by Mapterhorn. 30 m, height above
//              sea level (EGM2008), lakes level, sea at 0 m. It rounds off steep
//              summits, so it only settles what the detail source gets wrong:
//              merge.js uses it on water and where the detail source sits far
//              below it over a solid area.

import { TILE, pixelSpan, xToLon, yToLat } from './geo.js';
import { geoidHeight } from './geoid.js';
import { flatMask, mergeHeights } from './merge.js';

const SOURCES = {
  reference: { size: 512, maxZoom: 12, url: (z, x, y) => `https://tiles.mapterhorn.com/${z}/${x}/${y}.webp` },
  detail: { size: 256, maxZoom: 14, url: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png` },
};
const WORLD = 2 * Math.PI * 6378137;
const MAX_TILES = 220;
const CONCURRENCY = 8;
const REF_MARGIN = 8; // pixels around the rectangle, for the water test

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

// Tile range of a source at tile zoom z that covers the rectangle plus a margin
// in pixels. "Pixel zoom" is the zoom at which one 256 px tile pixel has this size.
function tileRange(source, z, d, margin) {
  const pz = z + Math.log2(source.size / TILE);
  const span = pixelSpan(d, pz);
  const S = source.size;
  return {
    pz,
    span,
    tx0: Math.floor((span.px0 - margin) / S),
    ty0: Math.floor((span.py0 - margin) / S),
    tx1: Math.floor((span.px1 + margin) / S),
    ty1: Math.floor((span.py1 + margin) / S),
  };
}

const tileCount = (r) => (r.tx1 - r.tx0 + 1) * (r.ty1 - r.ty0 + 1);

// Choose grid size, sources and tile zooms for a rectangle.
//   samples: requested points along the longer side.
export function planGrid(d, samples) {
  const long = Math.max(d.x1 - d.x0, d.y1 - d.y0);
  const pxAt = (z) => (long / WORLD) * TILE * 2 ** z;
  // Never ask for more points than the detail source holds at its deepest zoom.
  const limit = Math.max(48, Math.round(pxAt(SOURCES.detail.maxZoom)));
  const n = Math.max(48, Math.min(samples, limit));
  const wide = d.aspect <= 1;
  const nx = wide ? n : Math.max(2, Math.round((n - 1) / d.aspect) + 1);
  const ny = wide ? Math.max(2, Math.round((n - 1) * d.aspect) + 1) : n;
  const spacing = d.widthM / (nx - 1);

  const want = Math.ceil(Math.log2(((n - 1) * WORLD) / (long * TILE))); // pixel zoom matching the grid
  const pick = (source, z, margin) => {
    z = Math.max(2, Math.min(source.maxZoom, z));
    while (z > 2 && tileCount(tileRange(source, z, d, margin)) > MAX_TILES) z--;
    return z;
  };
  const z = pick(SOURCES.detail, want, 2);
  const zr = pick(SOURCES.reference, want - 1, REF_MARGIN);
  const tiles = tileCount(tileRange(SOURCES.detail, z, d, 2)) + tileCount(tileRange(SOURCES.reference, zr, d, REF_MARGIN));
  return { nx, ny, z, zr, spacing, tileCount: tiles, limited: n < samples };
}

// Fetch and decode the tiles of one source into a single raster of metres.
async function loadMosaic(source, z, d, margin, signal, onTile) {
  const r = tileRange(source, z, d, margin);
  const S = source.size;
  const cols = r.tx1 - r.tx0 + 1;
  const rows = r.ty1 - r.ty0 + 1;
  const W = cols * S;
  const H = rows * S;
  const data = new Float32Array(W * H);
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const max = 2 ** z - 1;
  const jobs = [];
  for (let ty = r.ty0; ty <= r.ty1; ty++) {
    for (let tx = r.tx0; tx <= r.tx1; tx++) {
      jobs.push(async () => {
        if (tx < 0 || ty < 0 || tx > max || ty > max) { onTile(); return; }
        let bitmap;
        try {
          bitmap = await fetchBitmap(source.url(z, tx, ty), signal);
        } catch (err) {
          if (signal && signal.aborted) throw err;
          throw new DataError('elevation', String((err && err.message) || err));
        }
        // Decode one tile at a time: draw and read back without yielding in between.
        ctx.clearRect(0, 0, S, S);
        ctx.drawImage(bitmap, 0, 0, S, S);
        if (bitmap.close) bitmap.close();
        const px = ctx.getImageData(0, 0, S, S).data;
        const ox = (tx - r.tx0) * S;
        const oy = (ty - r.ty0) * S;
        for (let y = 0; y < S; y++) {
          let o = (oy + y) * W + ox;
          let p = y * S * 4;
          for (let x = 0; x < S; x++, o++, p += 4) {
            data[o] = px[p] * 256 + px[p + 1] + px[p + 2] / 256 - 32768;
          }
        }
        onTile();
      });
    }
  }
  await runPool(jobs, CONCURRENCY, signal);
  return { data, W, H, ox: r.tx0 * S, oy: r.ty0 * S, span: r.span };
}

// Bilinear lookup at global pixel coordinates. Pixel centres sit at +0.5.
function sampler(m) {
  const { data, W, H, ox, oy } = m;
  return (fx, fy) => {
    let x = fx - ox - 0.5;
    let y = fy - oy - 0.5;
    if (x < 0) x = 0; else if (x > W - 1.001) x = W - 1.001;
    if (y < 0) y = 0; else if (y > H - 1.001) y = H - 1.001;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const u = x - xi;
    const v = y - yi;
    const i = yi * W + xi;
    return (data[i] * (1 - u) + data[i + 1] * u) * (1 - v) + (data[i + W] * (1 - u) + data[i + W + 1] * u) * v;
  };
}

// Resample a mosaic to the model grid, averaging four taps when the grid is coarser.
function resample(m, nx, ny, each) {
  const { span } = m;
  const stepX = (span.px1 - span.px0) / (nx - 1);
  const stepY = (span.py1 - span.py0) / (ny - 1);
  const coarse = Math.max(stepX, stepY) > 1.3;
  const at = sampler(m);
  const ax = stepX / 4;
  const ay = stepY / 4;
  for (let j = 0; j < ny; j++) {
    const fy = span.py0 + j * stepY;
    for (let i = 0; i < nx; i++) {
      const fx = span.px0 + i * stepX;
      const h = coarse
        ? (at(fx - ax, fy - ay) + at(fx + ax, fy - ay) + at(fx - ax, fy + ay) + at(fx + ax, fy + ay)) / 4
        : at(fx, fy);
      each(j * nx + i, h, fx, fy);
    }
  }
}

// Returns { data: Float32Array(nx*ny) in metres above sea level, row 0 = north,
// nx, ny, min, max, replaced }.
export async function loadElevation(d, plan, { signal, onProgress } = {}) {
  const { nx, ny } = plan;
  let done = 0;
  const onTile = () => { done++; if (onProgress) onProgress(Math.min(done, plan.tileCount), plan.tileCount); };
  const [ref, fine] = await Promise.all([
    loadMosaic(SOURCES.reference, plan.zr, d, REF_MARGIN, signal, onTile),
    loadMosaic(SOURCES.detail, plan.z, d, 2, signal, onTile),
  ]);

  // Water in the reference: level to the centimetre over a 7 px window.
  const R = 3;
  const x0 = Math.max(0, Math.floor(ref.span.px0 - ref.ox) - R - 2);
  const y0 = Math.max(0, Math.floor(ref.span.py0 - ref.oy) - R - 2);
  const x1 = Math.min(ref.W - 1, Math.ceil(ref.span.px1 - ref.ox) + R + 2);
  const y1 = Math.min(ref.H - 1, Math.ceil(ref.span.py1 - ref.oy) + R + 2);
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const crop = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) crop.set(ref.data.subarray((y0 + y) * ref.W + x0, (y0 + y) * ref.W + x0 + cw), y * cw);
  const level = flatMask(crop, cw, ch, R, 0.01);

  const c = new Float32Array(nx * ny);
  const flat = new Uint8Array(nx * ny);
  resample(ref, nx, ny, (o, h, fx, fy) => {
    c[o] = h;
    const px = Math.min(cw - 1, Math.max(0, Math.floor(fx - ref.ox) - x0));
    const py = Math.min(ch - 1, Math.max(0, Math.floor(fy - ref.oy) - y0));
    flat[o] = level[py * cw + px];
  });
  const a = new Float32Array(nx * ny);
  const lons = new Float64Array(nx);
  for (let i = 0; i < nx; i++) lons[i] = xToLon(d.x0 + ((d.x1 - d.x0) * i) / (nx - 1));
  let lat = 0;
  let row = -1;
  resample(fine, nx, ny, (o, h) => {
    const j = Math.floor(o / nx);
    if (j !== row) { row = j; lat = yToLat(d.y1 - ((d.y1 - d.y0) * j) / (ny - 1)); }
    a[o] = h - geoidHeight(lat, lons[o - j * nx]);
  });
  const { data, replaced } = mergeHeights({ a, c, flat, nx, ny, spacing: plan.spacing, geoid: geoidHeight(d.lat, d.lon) });

  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const h = data[i];
    if (h < lo) lo = h;
    if (h > hi) hi = h;
  }
  return { data, nx, ny, min: lo, max: hi, replaced };
}
