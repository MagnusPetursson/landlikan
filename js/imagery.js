// Satellite drape: Sentinel-2 cloudless 2016 by EOX (CC BY 4.0), 10 m, no key.

import { TILE, pixelSpan } from './geo.js';
import { runPool } from './dem.js';

export const IMAGERY_URL = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg';
export const IMAGERY_MAX_ZOOM = 14;
const MAX_SIDE = 2048;

function loadImage(url, signal) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    const abort = () => { img.src = ''; reject(new DOMException('Aborted', 'AbortError')); };
    if (signal) signal.addEventListener('abort', abort, { once: true });
    img.onload = () => { signal && signal.removeEventListener('abort', abort); resolve(img); };
    img.onerror = () => { signal && signal.removeEventListener('abort', abort); reject(new Error('tile')); };
    img.src = url;
  });
}

// Returns a canvas cropped to the rectangle, north up.
export async function loadDrape(d, { signal } = {}) {
  const long = Math.max(d.x1 - d.x0, d.y1 - d.y0);
  const world = 2 * Math.PI * 6378137;
  let z = Math.floor(Math.log2((MAX_SIDE * world) / (long * TILE)));
  z = Math.max(4, Math.min(IMAGERY_MAX_ZOOM, z));
  const span = pixelSpan(d, z);
  const w = Math.max(2, Math.round(span.px1 - span.px0));
  const h = Math.max(2, Math.round(span.py1 - span.py0));
  // Small areas are enlarged with smoothing so the 10 m pixels do not show as blocks.
  const up = Math.max(1, Math.min(4, Math.floor(1024 / Math.max(w, h))));
  const canvas = document.createElement('canvas');
  canvas.width = w * up;
  canvas.height = h * up;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const sx = canvas.width / (span.px1 - span.px0);
  const sy = canvas.height / (span.py1 - span.py0);

  const tx0 = Math.floor(span.px0 / TILE);
  const ty0 = Math.floor(span.py0 / TILE);
  const tx1 = Math.floor(span.px1 / TILE);
  const ty1 = Math.floor(span.py1 / TILE);
  const jobs = [];
  let failed = 0;
  let total = 0;
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      total++;
      jobs.push(async () => {
        const url = IMAGERY_URL.replace('{z}', z).replace('{y}', ty).replace('{x}', tx);
        let img;
        try {
          img = await loadImage(url, signal);
        } catch (err) {
          if (signal && signal.aborted) throw err;
          try { img = await loadImage(url, signal); } catch (err2) {
            if (signal && signal.aborted) throw err2;
            failed++;
            return;
          }
        }
        // Overlap neighbours by a fraction of a pixel to hide seams.
        ctx.drawImage(img, (tx * TILE - span.px0) * sx - 0.25, (ty * TILE - span.py0) * sy - 0.25, TILE * sx + 0.5, TILE * sy + 0.5);
      });
    }
  }
  await runPool(jobs, 8, signal);
  if (failed > total / 3) throw new Error('imagery');
  enhance(ctx, canvas.width, canvas.height);
  return canvas;
}

// Levels for the drape. The mosaic is dark over lava and sand, so the range is
// stretched per area: highlights are lifted (gain capped), bright scenes such as
// glaciers are left alone, and a gamma brings the median towards mid-grey.
function enhance(ctx, w, h) {
  const image = ctx.getImageData(0, 0, w, h);
  const px = image.data;
  const hist = new Uint32Array(256);
  let count = 0;
  for (let i = 0; i < px.length; i += 4 * 7) {
    hist[Math.round(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2])]++;
    count++;
  }
  const percentile = (q) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= q * count) return v;
    }
    return 255;
  };
  const black = Math.min(percentile(0.005), 28);
  const white = Math.max(percentile(0.995), 255 / 3, black + 1);
  const span = white - black;
  const median = Math.min(0.99, Math.max(0.01, (percentile(0.5) - black) / span));
  const gamma = Math.min(1, Math.max(0.5, Math.log(0.46) / Math.log(median)));
  const curve = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    const v = Math.min(1, Math.max(0, (i - black) / span));
    curve[i] = 255 * (0.02 + 0.96 * v ** gamma);
  }
  const sat = 1.1;
  for (let i = 0; i < px.length; i += 4) {
    const r = curve[px[i]];
    const g = curve[px[i + 1]];
    const b = curve[px[i + 2]];
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    px[i] = l + (r - l) * sat;
    px[i + 1] = l + (g - l) * sat;
    px[i + 2] = l + (b - l) * sat;
  }
  ctx.putImageData(image, 0, 0);
}
