// Node checks for the geometry code: node test/geometry.test.mjs [outDir]
import { writeFileSync, mkdirSync } from 'node:fs';
import { buildTopology, fillPositions, solidCounts, meshVolume, writeStl, stlByteLength } from '../js/model.js';
import { geoidHeight } from '../js/geoid.js';
import { mergeHeights, thickRegions, flatMask, distanceTo } from '../js/merge.js';
import { describePlace, fold } from '../js/search.js';
import { num, setLang } from '../js/i18n.js';
import { buildLayers, layoutSheets, sheetSvg, ringArea, layerCount } from '../js/contours.js';

const out = process.argv[2] || 'test/out';
mkdirSync(out, { recursive: true });
let failed = 0;
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${info ? ` — ${info}` : ''}`);
  if (!ok) failed++;
};

// Synthetic terrain: two peaks, a crater and a flat sea corner.
function terrain(nx, ny) {
  const data = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = i / (nx - 1);
      const y = j / (ny - 1);
      const peak = (cx, cy, r, h) => h * Math.exp(-(((x - cx) ** 2 + (y - cy) ** 2) / (r * r)));
      let h = 120 + peak(0.32, 0.4, 0.16, 900) + peak(0.72, 0.62, 0.1, 520) - peak(0.32, 0.4, 0.045, 380);
      h += 25 * Math.sin(x * 37) * Math.cos(y * 29);
      if (x + y < 0.35) h = 0;
      data[j * nx + i] = Math.max(0, h);
    }
  }
  let min = Infinity, max = -Infinity;
  for (const v of data) { if (v < min) min = v; if (v > max) max = v; }
  return { data, nx, ny, min, max };
}

function edgeManifold(index) {
  const edges = new Map();
  for (let t = 0; t < index.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = index[t + e];
      const b = index[t + ((e + 1) % 3)];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const rec = edges.get(key) || [0, 0];
      rec[a < b ? 0 : 1]++;
      edges.set(key, rec);
    }
  }
  let bad = 0;
  for (const rec of edges.values()) if (rec[0] !== 1 || rec[1] !== 1) bad++;
  return bad;
}

for (const [nx, ny] of [[2, 2], [3, 2], [97, 61], [240, 320]]) {
  const grid = terrain(nx, ny);
  const topo = buildTopology(grid);
  const counts = solidCounts(nx, ny);
  const positions = new Float32Array(counts.vertices * 3);
  const size = { widthMm: 150, depthMm: (150 * (ny - 1)) / (nx - 1), baseMm: 2 };
  const scale = 0.03;
  const zMax = fillPositions(positions, grid, topo, size, (v) => (grid.data[v] - grid.min) * scale);
  check(`solid ${nx}x${ny}: index count`, topo.index.length === counts.triangles * 3);
  check(`solid ${nx}x${ny}: every edge shared by two opposed triangles`, edgeManifold(topo.index) === 0);
  const volume = meshVolume(positions, topo.index);
  const floor = size.widthMm * size.depthMm * size.baseMm;
  check(`solid ${nx}x${ny}: volume positive and above the base slab`, volume >= floor - 1e-3, `${volume.toFixed(1)} mm3 vs slab ${floor.toFixed(1)}`);
  const stl = writeStl(positions, topo.index, 'test');
  check(`solid ${nx}x${ny}: STL size`, stl.byteLength === stlByteLength(counts.triangles));
  check(`solid ${nx}x${ny}: z range`, Math.abs(zMax - (2 + (grid.max - grid.min) * scale)) < 1e-3);
  writeFileSync(`${out}/solid_${nx}x${ny}.stl`, Buffer.from(stl));
}

// Geoid: reference values read from the full 2.5' EGM2008 grid.
{
  const ref = [[64.1445, -21.9415, 66.48], [65.6, -17.0, 66.21], [64.0142, -16.6767, 66.89], [66.07, -23.12, 64.62], [63.43, -20.28, 65.43], [65.15, -14.68, 65.64], [64.62, -19.85, 67.53]];
  const worst = Math.max(...ref.map(([lat, lon, n]) => Math.abs(geoidHeight(lat, lon) - n)));
  check('geoid: within 0.3 m of EGM2008 at reference points', worst < 0.3, `worst ${worst.toFixed(2)} m`);
  check('geoid: clamps outside the grid', Number.isFinite(geoidHeight(70, -30)) && Number.isFinite(geoidHeight(60, -5)));
}

// Merging the detail source with the reference
{
  const nx = 200, ny = 160, spacing = 8, geoid = 66;
  const truth = new Float32Array(nx * ny);
  const c = new Float32Array(nx * ny);
  const a = new Float32Array(nx * ny);
  const flat = new Uint8Array(nx * ny);
  const kind = new Uint8Array(nx * ny); // 1 sea, 2 lake, 3 wrong-datum patch, 4 cliff band, 5 blunder
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const o = j * nx + i;
      let h = 40 + 0.9 * i + 30 * Math.sin(j / 17);
      const sea = i < 30;
      const lake = (i - 120) ** 2 + (j - 50) ** 2 < 22 * 22;
      if (sea) h = 0;
      if (lake) h = 150;
      truth[o] = h;
      c[o] = Math.round(h * 2) / 2; // the reference is quantised to 0.5 m
      a[o] = h + rnd() * 4; // fine detail
      if (sea) { kind[o] = 1; flat[o] = i < 27 ? 1 : 0; a[o] = rnd() * 6; }
      if (lake) { kind[o] = 2; flat[o] = (i - 120) ** 2 + (j - 50) ** 2 < 18 * 18 ? 1 : 0; a[o] = 150 + rnd() * 8; }
      if (i >= 60 && i < 95 && j >= 100 && j < 140) { kind[o] = 3; a[o] = h - 66 + rnd() * 10; } // other height system
      if (i >= 150 && i < 152 && j > 20 && j < 140) { kind[o] = 4; a[o] = h - 45; } // cliff foot the reference smears
      if (i >= 152 && i < 160 && j > 20 && j < 140) { truth[o] = h + 80; c[o] = h + 80; a[o] = h + 80 + rnd() * 4; } // the cliff itself
      if (i >= 165 && i < 185 && j >= 110 && j < 135) { kind[o] = 5; truth[o] = h + 60; a[o] = h + 60 + rnd() * 4; } // summit the reference rounds off
      if (i >= 100 && i < 103 && j >= 120 && j < 123) { kind[o] = 6; a[o] = h + 250; } // blunder on open ground
      if (i >= 70 && i < 72 && j >= 60 && j < 62) { kind[o] = 6; a[o] = h - 66; } // small patch in the other height system
    }
  }
  // A lake whose surface the detail source filled from the other height system.
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const o = j * nx + i;
    if (kind[o] === 2 && j < 50) a[o] = 150 - 66;
  }
  const { data, replaced } = mergeHeights({ a, c, flat, nx, ny, spacing, geoid });
  const worst = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  let cliffKept = 0, cliffCells = 0;
  for (let o = 0; o < data.length; o++) {
    const err = Math.abs(data[o] - truth[o]);
    if (kind[o] === 4) { cliffCells++; if (Math.abs(data[o] - a[o]) < 1e-6) cliffKept++; continue; }
    if (err > worst[kind[o]]) worst[kind[o]] = err;
  }
  check('merge: open land keeps the fine detail within its noise', worst[0] <= 2.5, `worst ${worst[0].toFixed(1)} m`);
  check('merge: sea is level', worst[1] <= 3.1 && data[10] === 0 && data[5 * nx + 3] === 0, `worst ${worst[1].toFixed(1)} m near the shore`);
  check('merge: lake is level, also where it was 66 m too low', worst[2] <= 4.1 && data[50 * nx + 120] === 150 && data[40 * nx + 120] === 150, `worst ${worst[2].toFixed(1)} m at the shore`);
  check('merge: patch in the other height system is replaced', worst[3] <= 0.5, `worst ${worst[3].toFixed(2)} m`);
  check('merge: a summit the reference rounds off keeps the fine source', worst[5] <= 2.5, `worst ${worst[5].toFixed(1)} m`);
  check('merge: small blunders and small wrong-system patches on open ground are replaced', worst[6] <= 0.5, `worst ${worst[6].toFixed(2)} m`);
  check('merge: a thin cliff band keeps the fine source', cliffKept === cliffCells, `${cliffKept}/${cliffCells}`);
  check('merge: replaced share reported', replaced > 0.2 && replaced < 0.5, replaced.toFixed(3));

  const m = new Uint8Array(100);
  for (const o of [11, 12, 13, 21, 22, 23, 31, 32, 33, 34, 35, 77]) m[o] = 1; // 3x3 block with a tail, and a lone cell
  const t = thickRegions(m, 10, 10, 1);
  check('thickRegions: keeps a block with its tail, drops a lone cell', t[22] === 1 && t[35] === 1 && t[77] === 0 && t.reduce((s, v) => s + v, 0) === 11);
  const dd = distanceTo(m, 10, 10);
  check('distanceTo: zero on the mask, grows outside', dd[22] === 0 && dd[14] === 1 && Math.abs(dd[99] - 2.8284) < 1e-3, String(dd[99]));
  const f = flatMask(Float32Array.from({ length: 100 }, (_, o) => (o % 10 < 6 ? 5 : o % 10)), 10, 10, 1, 0.01);
  check('flatMask: level interior only', f[22] === 1 && f[24] === 1 && f[25] === 0 && f[28] === 0);
}

// Number formatting
{
  globalThis.document = { documentElement: {}, querySelectorAll: () => [], title: '' };
  setLang('is');
  check('numbers: Icelandic separators', num(12345.678, 1) === '12.345,7' && num(1646) === '1.646' && num(0.5, 2) === '0,50', num(12345.678, 1));
  setLang('en');
  check('numbers: English separators', num(12345.678, 1) === '12,345.7' && num(999) === '999' && num(-0.04, 1) === '0.0', num(12345.678, 1));
}

// Search result descriptions
{
  const kirkjufell = { name: 'Kirkjufell', kind: 'fell', lon: -23.309, lat: 64.938 };
  check('search: place described by type and nearest town', describePlace(kirkjufell, 'is') === 'fell · Grundarfjörður 3 km' && describePlace(kirkjufell, 'en') === 'mountain · Grundarfjörður 3 km', describePlace(kirkjufell, 'en'));
  check('search: names compared without diacritics', fold('Reykjavík') === 'reykjavik' && fold('Þjórsá') === 'thjorsa' && fold('Ölfusá').includes(fold('olfus')));
  check('search: a town is not described by itself', describePlace({ name: 'Akureyri', kind: 'byggðarkjarni', lon: -18.104, lat: 65.681 }, 'en') === 'settlement');
}

// Layers
{
  const nx = 240, ny = 320;
  const grid = terrain(nx, ny);
  const widthMm = 150;
  const depthMm = (150 * (ny - 1)) / (nx - 1);
  const scale = 0.03;
  const h = new Float32Array(grid.data.length);
  for (let i = 0; i < h.length; i++) h[i] = (grid.data[i] - grid.min) * scale;
  const thickness = 3;
  const t0 = performance.now();
  const layers = buildLayers(h, { nx, ny, widthMm, depthMm, thickness });
  const ms = performance.now() - t0;
  const hMax = (grid.max - grid.min) * scale;
  check('layers: count', layers.length <= layerCount(hMax, thickness) && layers.length >= layerCount(hMax, thickness) - 1, `${layers.length} layers in ${ms.toFixed(0)} ms`);
  check('layers: base is the full rectangle', layers[0].pieces.length === 1 && Math.abs(layers[0].pieces[0].area - widthMm * depthMm) < 1e-6);
  let monotone = true;
  let prev = Infinity;
  let closed = true;
  for (const layer of layers) {
    const area = layer.pieces.reduce((s, p) => s + p.area - p.holes.reduce((q, r) => q + Math.abs(ringArea(r)), 0), 0);
    if (area > prev + 1e-6) monotone = false;
    prev = area;
    for (const p of layer.pieces) for (const r of [p.outer, ...p.holes]) if (r.length < 3) closed = false;
  }
  check('layers: area shrinks with height', monotone);
  check('layers: rings are closed polygons', closed);
  check('layers: a crater produces a hole', layers.some((l) => l.pieces.some((p) => p.holes.length)));
  check('layers: guides present below the top', layers.slice(0, -1).every((l) => l.guides.length > 0));
  check('layers: labels placed', layers.filter((l) => l.labels.length).length >= layers.length - 3, `${layers.filter((l) => l.labels.length).length} labelled`);
  const inBounds = layers.every((l) => l.pieces.every((p) => p.outer.every(([x, y]) => x >= -1e-6 && y >= -1e-6 && x <= widthMm + 1e-6 && y <= depthMm + 1e-6)));
  check('layers: inside the model rectangle', inBounds);

  const layout = layoutSheets(layers, 600, 300);
  check('layout: fits 600 x 300 sheets', !layout.unfit && layout.sheets.length >= 1, `${layout.sheets.length} sheets`);
  const placed = layout.sheets.flat().length;
  check('layout: every layer placed once', placed === layers.filter((l) => l.pieces.length).length);
  let overlap = false;
  for (const sheet of layout.sheets) {
    for (let a = 0; a < sheet.length; a++) {
      const p = sheet[a];
      if (p.x < 5 - 1e-6 || p.y < 5 - 1e-6 || p.x + p.w > 595 + 1e-6 || p.y + p.h > 295 + 1e-6) overlap = true;
      for (let b = a + 1; b < sheet.length; b++) {
        const q = sheet[b];
        if (p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h) overlap = true;
      }
    }
  }
  check('layout: placements inside margins and not overlapping', !overlap);
  layout.sheets.forEach((sheet, n) => {
    const { svg } = sheetSvg(sheet, 600, 300, `test sheet ${n + 1}`);
    writeFileSync(`${out}/sheet_${n + 1}.svg`, svg);
  });
  const tight = layoutSheets(layers, 215, 180);
  check('layout: rotates when only the turned layer fits', !tight.unfit && tight.sheets.flat().some((p) => p.rotated));
  check('layout: reports a sheet that is too small', layoutSheets(layers, 100, 100).unfit === true);
}

console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
