// Stacked contour layers for laser cutting.
// Input: model heights in mm above the lowest terrain point, on the model grid.
// Output: per-layer cut outlines, score guides and sheet layouts as SVG.

const PAD = -1e9;

// --- contour tracing (marching squares) -------------------------------------

// Closed rings of the region where value >= threshold. The grid is padded with a
// ring of "outside" nodes at the same coordinates as the border, so every ring
// closes along the model edge. Coordinates: x right, y down (grid rows), in mm.
function traceRings(h, nx, ny, dx, dy, threshold, work) {
  const PW = nx + 2;
  const PH = ny + 2;
  const next = work.next;
  next.fill(-1);
  const val = (i, j) => (i < 1 || j < 1 || i > nx || j > ny ? PAD : h[(j - 1) * nx + (i - 1)]);
  const T = (i, j) => 2 * (j * PW + i);
  const B = (i, j) => 2 * ((j + 1) * PW + i);
  const L = (i, j) => 2 * (j * PW + i) + 1;
  const R = (i, j) => 2 * (j * PW + i + 1) + 1;
  let segments = 0;
  for (let j = 0; j < PH - 1; j++) {
    for (let i = 0; i < PW - 1; i++) {
      const tl = val(i, j);
      const tr = val(i + 1, j);
      const br = val(i + 1, j + 1);
      const bl = val(i, j + 1);
      const code = (tl >= threshold ? 8 : 0) | (tr >= threshold ? 4 : 0) | (br >= threshold ? 2 : 0) | (bl >= threshold ? 1 : 0);
      if (code === 0 || code === 15) continue;
      switch (code) {
        case 1: next[L(i, j)] = B(i, j); break;
        case 2: next[B(i, j)] = R(i, j); break;
        case 3: next[L(i, j)] = R(i, j); break;
        case 4: next[R(i, j)] = T(i, j); break;
        case 6: next[B(i, j)] = T(i, j); break;
        case 7: next[L(i, j)] = T(i, j); break;
        case 8: next[T(i, j)] = L(i, j); break;
        case 9: next[T(i, j)] = B(i, j); break;
        case 11: next[T(i, j)] = R(i, j); break;
        case 12: next[R(i, j)] = L(i, j); break;
        case 13: next[R(i, j)] = B(i, j); break;
        case 14: next[B(i, j)] = L(i, j); break;
        case 5: {
          const centre = (tl + tr + br + bl) / 4 >= threshold;
          if (centre) { next[L(i, j)] = T(i, j); next[R(i, j)] = B(i, j); }
          else { next[R(i, j)] = T(i, j); next[L(i, j)] = B(i, j); }
          segments++;
          break;
        }
        case 10: {
          const centre = (tl + tr + br + bl) / 4 >= threshold;
          if (centre) { next[T(i, j)] = R(i, j); next[B(i, j)] = L(i, j); }
          else { next[T(i, j)] = L(i, j); next[B(i, j)] = R(i, j); }
          segments++;
          break;
        }
        default: break;
      }
      segments++;
    }
  }
  if (!segments) return [];

  const xAt = (i) => Math.min(nx - 1, Math.max(0, i - 1)) * dx;
  const yAt = (j) => Math.min(ny - 1, Math.max(0, j - 1)) * dy;
  const point = (edge) => {
    const vertical = edge & 1;
    const cell = edge >> 1;
    const i = cell % PW;
    const j = (cell - i) / PW;
    const a = val(i, j);
    if (vertical) {
      const b = val(i, j + 1);
      const t = (threshold - a) / (b - a);
      return [xAt(i), yAt(j) + t * (yAt(j + 1) - yAt(j))];
    }
    const b = val(i + 1, j);
    const t = (threshold - a) / (b - a);
    return [xAt(i) + t * (xAt(i + 1) - xAt(i)), yAt(j)];
  };

  const rings = [];
  for (let start = 0; start < next.length; start++) {
    if (next[start] < 0) continue;
    const ring = [];
    let e = start;
    while (e >= 0 && next[e] >= 0) {
      const p = point(e);
      const q = ring[ring.length - 1];
      if (!q || Math.abs(q[0] - p[0]) > 1e-9 || Math.abs(q[1] - p[1]) > 1e-9) ring.push(p);
      const n = next[e];
      next[e] = -1;
      e = n;
    }
    if (ring.length > 1) {
      const a = ring[0];
      const b = ring[ring.length - 1];
      if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) ring.pop();
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

export function ringArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function ringLength(ring) {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    s += Math.hypot(q[0] - p[0], q[1] - p[1]);
  }
  return s;
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

// Douglas-Peucker on a closed ring.
function simplifyRing(ring, tolerance) {
  const n = ring.length;
  if (n < 5) return ring;
  // Anchor at the two points furthest apart along x to split the ring into two open runs.
  let a = 0;
  let b = 0;
  for (let i = 1; i < n; i++) {
    if (ring[i][0] < ring[a][0]) a = i;
    if (ring[i][0] > ring[b][0]) b = i;
  }
  if (a === b) return ring;
  const keep = new Uint8Array(n);
  keep[a] = 1;
  keep[b] = 1;
  const tol2 = tolerance * tolerance;
  const stack = [[a, b], [b, a]];
  while (stack.length) {
    const [s, e] = stack.pop();
    const len = (e - s + n) % n;
    if (len < 2) continue;
    const p = ring[s];
    const q = ring[e];
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const d2 = dx * dx + dy * dy;
    let worst = -1;
    let worstAt = -1;
    for (let k = 1; k < len; k++) {
      const idx = (s + k) % n;
      const r = ring[idx];
      let dist;
      if (d2 === 0) {
        dist = (r[0] - p[0]) ** 2 + (r[1] - p[1]) ** 2;
      } else {
        let t = ((r[0] - p[0]) * dx + (r[1] - p[1]) * dy) / d2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        dist = (r[0] - p[0] - t * dx) ** 2 + (r[1] - p[1] - t * dy) ** 2;
      }
      if (dist > worst) { worst = dist; worstAt = idx; }
    }
    if (worst > tol2) {
      keep[worstAt] = 1;
      stack.push([s, worstAt], [worstAt, e]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(ring[i]);
  return out.length >= 3 ? out : ring;
}

// --- label placement ---------------------------------------------------------

// Chamfer distance (in grid cells) to the nearest cell outside the mask.
function distanceInside(mask, nx, ny, out) {
  const BIG = 1e7;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const o = j * nx + i;
      if (!mask[o]) { out[o] = 0; continue; }
      if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1) { out[o] = 1; continue; }
      let d = BIG;
      const w = out[o - 1] + 1; if (w < d) d = w;
      const n = out[o - nx] + 1; if (n < d) d = n;
      const nw = out[o - nx - 1] + 1.4142; if (nw < d) d = nw;
      const ne = out[o - nx + 1] + 1.4142; if (ne < d) d = ne;
      out[o] = d;
    }
  }
  for (let j = ny - 1; j >= 0; j--) {
    for (let i = nx - 1; i >= 0; i--) {
      const o = j * nx + i;
      if (!mask[o] || i === 0 || j === 0 || i === nx - 1 || j === ny - 1) continue;
      let d = out[o];
      const e = out[o + 1] + 1; if (e < d) d = e;
      const s = out[o + nx] + 1; if (s < d) d = s;
      const se = out[o + nx + 1] + 1.4142; if (se < d) d = se;
      const sw = out[o + nx - 1] + 1.4142; if (sw < d) d = sw;
      out[o] = d;
    }
  }
}

// Single-stroke digits on a 4 x 6 unit box, y down.
const DIGITS = {
  0: [[[1, 0], [3, 0], [4, 1], [4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0]]],
  1: [[[1, 1], [2, 0], [2, 6]], [[1, 6], [3, 6]]],
  2: [[[0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [0, 6], [4, 6]]],
  3: [[[0, 0], [4, 0], [2, 2.5], [3, 2.5], [4, 3.5], [4, 5], [3, 6], [1, 6], [0, 5]]],
  4: [[[3, 6], [3, 0], [0, 4], [4, 4]]],
  5: [[[4, 0], [0, 0], [0, 2.5], [3, 2.5], [4, 3.5], [4, 5], [3, 6], [1, 6], [0, 5]]],
  6: [[[4, 1], [3, 0], [1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 3.5], [3, 2.5], [0, 2.5]]],
  7: [[[0, 0], [4, 0], [1.5, 6]]],
  8: [[[1, 0], [3, 0], [4, 1], [4, 1.7], [3, 2.7], [1, 2.7], [0, 1.7], [0, 1], [1, 0]], [[1, 2.7], [0, 3.7], [0, 5], [1, 6], [3, 6], [4, 5], [4, 3.7], [3, 2.7]]],
  9: [[[0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0], [0, 1], [0, 2.5], [1, 3.5], [4, 3.5]]],
};
const LABEL_HEIGHT = 3; // mm
const UNIT = LABEL_HEIGHT / 6;
const ADVANCE = 5.6 * UNIT;

function labelSize(text) {
  return { w: (text.length - 1) * ADVANCE + 4 * UNIT, h: LABEL_HEIGHT };
}

function labelStrokes(text, cx, cy) {
  const { w, h } = labelSize(text);
  const strokes = [];
  [...text].forEach((ch, n) => {
    const ox = cx - w / 2 + n * ADVANCE;
    const oy = cy - h / 2;
    for (const line of DIGITS[ch] || []) strokes.push(line.map(([x, y]) => [ox + x * UNIT, oy + y * UNIT]));
  });
  return strokes;
}

// --- layers ------------------------------------------------------------------

export const MAX_LAYERS = 120;

export function layerCount(maxHeightMm, thickness) {
  return Math.floor(maxHeightMm / thickness + 1e-9) + 1;
}

// Build the layers. Layer 0 is the full rectangle; layer k holds everything at or
// above k * thickness.
//   opts: { nx, ny, widthMm, depthMm, thickness, minPieceArea, minHoleArea, tolerance }
export function buildLayers(h, opts) {
  const { nx, ny, widthMm, depthMm, thickness } = opts;
  const minPiece = opts.minPieceArea ?? 8;
  const minHole = opts.minHoleArea ?? 4;
  const tolerance = opts.tolerance ?? 0.04;
  const dx = widthMm / (nx - 1);
  const dy = depthMm / (ny - 1);
  let hMax = 0;
  for (let i = 0; i < h.length; i++) if (h[i] > hMax) hMax = h[i];
  const count = Math.min(MAX_LAYERS, layerCount(hMax, thickness));
  const work = { next: new Int32Array(2 * (nx + 2) * (ny + 2)) };

  const layers = [];
  for (let k = 0; k < count; k++) {
    let rings;
    if (k === 0) {
      rings = [[[0, 0], [widthMm, 0], [widthMm, depthMm], [0, depthMm]]];
    } else {
      rings = traceRings(h, nx, ny, dx, dy, k * thickness, work).map((r) => simplifyRing(r, tolerance));
    }
    const measured = rings.map((ring) => ({ ring, area: ringArea(ring) })).filter((r) => Math.abs(r.area) > 1e-6);
    if (!measured.length) { layers.push({ index: k, pieces: [] }); continue; }
    const biggest = measured.reduce((m, r) => (Math.abs(r.area) > Math.abs(m.area) ? r : m));
    const outerSign = Math.sign(biggest.area);
    const pieces = measured
      .filter((r) => Math.sign(r.area) === outerSign && Math.abs(r.area) >= minPiece)
      .map((r) => ({ outer: r.ring, area: Math.abs(r.area), holes: [] }));
    for (const hole of measured) {
      if (Math.sign(hole.area) === outerSign || Math.abs(hole.area) < minHole) continue;
      const [x, y] = hole.ring[0];
      let owner = null;
      for (const piece of pieces) {
        if (piece.area > Math.abs(hole.area) && (!owner || piece.area < owner.area) && pointInRing(x, y, piece.outer)) owner = piece;
      }
      if (owner) owner.holes.push(hole.ring);
    }
    layers.push({ index: k, pieces });
  }
  while (layers.length > 1 && !layers[layers.length - 1].pieces.length) layers.pop();

  // Guides: the outlines of the next layer up, scored where its pieces sit.
  // Labels: the layer number, scored where the next layer will cover it.
  const cells = nx * ny;
  const mask = new Uint8Array(cells);
  const dist = new Float32Array(cells);
  const seen = new Uint8Array(cells);
  const stack = new Int32Array(cells);
  const cell = Math.min(dx, dy);
  for (let k = 0; k < layers.length; k++) {
    const layer = layers[k];
    const above = layers[k + 1];
    layer.guides = above ? above.pieces.map((p) => p.outer) : [];
    layer.labels = [];
    if (!above || !above.pieces.length) continue;
    const text = String(k + 1);
    const size = labelSize(text);
    const need = Math.hypot(size.w, size.h) / 2 + 0.8; // mm clear radius
    const own = k * thickness;
    const level = own + thickness;
    for (let i = 0; i < cells; i++) mask[i] = h[i] >= level ? 1 : 0;
    distanceInside(mask, nx, ny, dist);
    // One label per connected part of this layer, at its most deeply covered cell.
    seen.fill(0);
    const taken = new Set();
    for (let start = 0; start < cells; start++) {
      if (seen[start] || !(k === 0 || h[start] >= own)) continue;
      let top = 0;
      let best = start;
      stack[top++] = start;
      seen[start] = 1;
      while (top) {
        const c = stack[--top];
        if (dist[c] > dist[best]) best = c;
        const i = c % nx;
        let n;
        if (i > 0 && !seen[(n = c - 1)] && (k === 0 || h[n] >= own)) { seen[n] = 1; stack[top++] = n; }
        if (i < nx - 1 && !seen[(n = c + 1)] && (k === 0 || h[n] >= own)) { seen[n] = 1; stack[top++] = n; }
        if (c >= nx && !seen[(n = c - nx)] && (k === 0 || h[n] >= own)) { seen[n] = 1; stack[top++] = n; }
        if (c < cells - nx && !seen[(n = c + nx)] && (k === 0 || h[n] >= own)) { seen[n] = 1; stack[top++] = n; }
      }
      if (dist[best] * cell < need) continue;
      const x = (best % nx) * dx;
      const y = Math.floor(best / nx) * dy;
      const owner = layer.pieces.findIndex((p, n) => !taken.has(n) && pointInRing(x, y, p.outer));
      if (owner < 0) continue;
      taken.add(owner);
      layer.labels.push(...labelStrokes(text, x, y));
    }
  }
  return layers;
}

// --- sheet layout ------------------------------------------------------------

function layerExtent(layer) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const piece of layer.pieces) {
    for (const [x, y] of piece.outer) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { x0, y0, w: x1 - x0, h: y1 - y0 };
}

// Shelf packing in layer order. Returns { sheets: [[placement...]], unfit: boolean }.
// A placement is { layer, x, y, w, h, rotated, ext }.
export function layoutSheets(layers, sheetW, sheetH, margin = 5, gap = 4) {
  const innerW = sheetW - 2 * margin;
  const innerH = sheetH - 2 * margin;
  const sheets = [];
  let current = null;
  let x = 0, y = 0, rowH = 0;
  const open = () => { current = []; sheets.push(current); x = 0; y = 0; rowH = 0; };
  for (const layer of layers) {
    if (!layer.pieces.length) continue;
    const ext = layerExtent(layer);
    let w = ext.w, h = ext.h, rotated = false;
    const fits = (a, b) => a <= innerW + 1e-6 && b <= innerH + 1e-6;
    if (!fits(w, h)) {
      if (fits(h, w)) { rotated = true; [w, h] = [h, w]; }
      else return { sheets: [], unfit: true, need: { w: ext.w + 2 * margin, h: ext.h + 2 * margin } };
    }
    if (!current) open();
    if (x > 0 && x + w > innerW + 1e-6) { x = 0; y += rowH + gap; rowH = 0; }
    if (y > 0 && y + h > innerH + 1e-6) open();
    current.push({ layer, x: margin + x, y: margin + y, w, h, rotated, ext });
    x += w + gap;
    if (h > rowH) rowH = h;
  }
  return { sheets, unfit: false };
}

const fmt = (v) => (Math.round(v * 1000) / 1000).toString();

function pathData(ring, map, close) {
  let d = '';
  for (let i = 0; i < ring.length; i++) {
    const [x, y] = map(ring[i]);
    d += `${i ? 'L' : 'M'}${fmt(x)} ${fmt(y)}`;
  }
  return close ? `${d}Z` : d;
}

export const CUT_COLOUR = '#ff0000';
export const SCORE_COLOUR = '#0000ff';

// One SVG document per sheet, sized in mm. Red = cut, blue = score.
export function sheetSvg(placements, sheetW, sheetH, title, strokeWidth = 0.025) {
  const parts = [];
  let cutLength = 0;
  for (const p of placements) {
    const { ext } = p;
    const map = p.rotated
      ? ([x, y]) => [p.x + (y - ext.y0), p.y + (ext.w - (x - ext.x0))]
      : ([x, y]) => [p.x + (x - ext.x0), p.y + (y - ext.y0)];
    const score = [
      ...p.layer.guides.map((ring) => pathData(ring, map, true)),
      ...p.layer.labels.map((line) => pathData(line, map, false)),
    ].join('');
    let cut = '';
    for (const piece of p.layer.pieces) {
      for (const hole of piece.holes) { cut += pathData(hole, map, true); cutLength += ringLength(hole); }
      cut += pathData(piece.outer, map, true);
      cutLength += ringLength(piece.outer);
    }
    const id = `layer-${String(p.layer.index + 1).padStart(2, '0')}`;
    parts.push(
      `<g id="${id}">`
      + (score ? `<path d="${score}" fill="none" stroke="${SCORE_COLOUR}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>` : '')
      + `<path d="${cut}" fill="none" stroke="${CUT_COLOUR}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>`
      + '</g>',
    );
  }
  const svg = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(sheetW)}mm" height="${fmt(sheetH)}mm" viewBox="0 0 ${fmt(sheetW)} ${fmt(sheetH)}">\n`
    + `<title>${title}</title>\n${parts.join('\n')}\n</svg>\n`;
  return { svg, cutLength };
}
