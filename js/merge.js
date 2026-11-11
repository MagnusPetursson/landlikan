// Combine two elevation sources on the model grid.
//
//   a: fine detail (ArcticDEM), already reduced to height above sea level on the
//      assumption that it holds ellipsoidal heights
//   c: reference (Copernicus GLO-30): coarser and too low on steep summits, but in
//      one height system everywhere, with level lakes and sea at 0 m
//
// The fine source is used wherever it can be trusted. The reference replaces it
//   - on water, which the reference stores as level;
//   - where the two differ by more than the terrain can explain. The reference
//     smears steep ground, so the allowance grows with its local relief: on a
//     cliff tens of metres are normal, on a plain they are a blunder;
//   - where the fine source lies below the reference by about half the geoid
//     height or more over a solid area, whatever the relief: the mark of a patch
//     filled from data in another height system. Thin bands of that kind (cliff
//     feet, narrow canyons) keep the fine source.

// Opening by reconstruction with a (2k+1)² square: keeps each connected part of
// the mask that contains at least one full square, in its entirety.
export function thickRegions(mask, nx, ny, k) {
  const out = new Uint8Array(nx * ny);
  const W = nx + 1;
  const sum = new Int32Array(W * (ny + 1));
  for (let j = 0; j < ny; j++) {
    let row = 0;
    for (let i = 0; i < nx; i++) {
      row += mask[j * nx + i];
      sum[(j + 1) * W + i + 1] = sum[j * W + i + 1] + row;
    }
  }
  const full = (2 * k + 1) * (2 * k + 1);
  const stack = [];
  for (let j = k; j < ny - k; j++) {
    for (let i = k; i < nx - k; i++) {
      const s = sum[(j + k + 1) * W + i + k + 1] - sum[(j - k) * W + i + k + 1] - sum[(j + k + 1) * W + i - k] + sum[(j - k) * W + i - k];
      if (s === full) { out[j * nx + i] = 1; stack.push(j * nx + i); }
    }
  }
  while (stack.length) {
    const c = stack.pop();
    const i = c % nx;
    let n;
    if (i > 0 && mask[(n = c - 1)] && !out[n]) { out[n] = 1; stack.push(n); }
    if (i < nx - 1 && mask[(n = c + 1)] && !out[n]) { out[n] = 1; stack.push(n); }
    if (c >= nx && mask[(n = c - nx)] && !out[n]) { out[n] = 1; stack.push(n); }
    if (c < nx * (ny - 1) && mask[(n = c + nx)] && !out[n]) { out[n] = 1; stack.push(n); }
  }
  return out;
}

// Chamfer distance, in cells, from each cell to the nearest masked cell.
export function distanceTo(mask, nx, ny) {
  const BIG = 1e6;
  const d = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const o = j * nx + i;
      if (mask[o]) { d[o] = 0; continue; }
      let v = BIG;
      if (i > 0 && d[o - 1] + 1 < v) v = d[o - 1] + 1;
      if (j > 0) {
        if (d[o - nx] + 1 < v) v = d[o - nx] + 1;
        if (i > 0 && d[o - nx - 1] + 1.4142 < v) v = d[o - nx - 1] + 1.4142;
        if (i < nx - 1 && d[o - nx + 1] + 1.4142 < v) v = d[o - nx + 1] + 1.4142;
      }
      d[o] = v;
    }
  }
  for (let j = ny - 1; j >= 0; j--) {
    for (let i = nx - 1; i >= 0; i--) {
      const o = j * nx + i;
      let v = d[o];
      if (i < nx - 1 && d[o + 1] + 1 < v) v = d[o + 1] + 1;
      if (j < ny - 1) {
        if (d[o + nx] + 1 < v) v = d[o + nx] + 1;
        if (i < nx - 1 && d[o + nx + 1] + 1.4142 < v) v = d[o + nx + 1] + 1.4142;
        if (i > 0 && d[o + nx - 1] + 1.4142 < v) v = d[o + nx - 1] + 1.4142;
      }
      d[o] = v;
    }
  }
  return d;
}

// Cells of a raster whose surroundings (radius r) are level to within tol: water
// bodies, which the reference stores as flat.
export function flatMask(data, W, H, r, tol) {
  const lo = new Float32Array(W * H);
  const hi = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let a = Infinity;
      let b = -Infinity;
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(W - 1, x + r);
      for (let k = y * W + x0, e = y * W + x1; k <= e; k++) {
        const v = data[k];
        if (v < a) a = v;
        if (v > b) b = v;
      }
      lo[y * W + x] = a;
      hi[y * W + x] = b;
    }
  }
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(H - 1, y + r);
    for (let x = 0; x < W; x++) {
      let a = Infinity;
      let b = -Infinity;
      for (let k = y0; k <= y1; k++) {
        const v0 = lo[k * W + x];
        const v1 = hi[k * W + x];
        if (v0 < a) a = v0;
        if (v1 > b) b = v1;
      }
      out[y * W + x] = b - a <= tol ? 1 : 0;
    }
  }
  return out;
}

// Height range of a raster within r cells of each cell.
export function localRelief(data, nx, ny, r) {
  const lo = new Float32Array(nx * ny);
  const hi = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      let a = Infinity;
      let b = -Infinity;
      for (let k = j * nx + Math.max(0, i - r), e = j * nx + Math.min(nx - 1, i + r); k <= e; k++) {
        const v = data[k];
        if (v < a) a = v;
        if (v > b) b = v;
      }
      lo[j * nx + i] = a;
      hi[j * nx + i] = b;
    }
  }
  const out = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const j0 = Math.max(0, j - r);
    const j1 = Math.min(ny - 1, j + r);
    for (let i = 0; i < nx; i++) {
      let a = Infinity;
      let b = -Infinity;
      for (let k = j0; k <= j1; k++) {
        if (lo[k * nx + i] < a) a = lo[k * nx + i];
        if (hi[k * nx + i] > b) b = hi[k * nx + i];
      }
      out[j * nx + i] = b - a;
    }
  }
  return out;
}

// Allowance for disagreement, in metres: a base amount on level ground plus a share
// of the reference's local relief. A cliff of height H leaves the smeared
// reference at most about H/2 above its foot, within some 60 m. Summits end up
// further below the truth, over a wider area.
const ABOVE = 40;
const ABOVE_PER_RELIEF = 1.5; // of the relief within 120 m
const BELOW_PER_RELIEF = 0.75; // of the relief within 60 m

// Returns { data, replaced } where replaced is the share of cells taken from the reference.
//   spacing: ground metres between grid points; geoid: geoid height in metres.
export function mergeHeights({ a, c, flat, nx, ny, spacing, geoid }) {
  const n = nx * ny;
  const wide = localRelief(c, nx, ny, Math.max(2, Math.min(30, Math.round(120 / spacing))));
  const near = localRelief(c, nx, ny, Math.max(1, Math.min(15, Math.round(60 / spacing))));
  const below = geoid / 2;
  const low = new Uint8Array(n);
  const useRef = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const e = a[i] - c[i];
    if (e < -below) low[i] = 1;
    if (flat[i] || e < -below - BELOW_PER_RELIEF * near[i] || e > ABOVE + ABOVE_PER_RELIEF * wide[i]) useRef[i] = 1;
  }
  // The reference smears terrain over about 45 m; on coarser grids every cell counts.
  const solid = thickRegions(low, nx, ny, Math.max(0, Math.min(12, Math.round(45 / spacing))));
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (solid[i]) useRef[i] = 1;
    count += useRef[i];
  }
  // Blend towards the reference over a few cells outside each replaced area, so the
  // two sources meet without a step. Inside, the fine source is not used at all.
  const feather = Math.max(2, Math.min(6, Math.round(30 / spacing)));
  const dist = distanceTo(useRef, nx, ny);
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const w = dist[i] >= feather ? 1 : dist[i] / feather;
    const h = c[i] + w * (a[i] - c[i]);
    data[i] = h > 0 ? h : 0;
  }
  return { data, replaced: count / n };
}
