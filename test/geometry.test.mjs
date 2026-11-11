// Node checks for the geometry code: node test/geometry.test.mjs [outDir]
import { writeFileSync, mkdirSync } from 'node:fs';
import { buildTopology, fillPositions, solidCounts, meshVolume, writeStl, stlByteLength } from '../js/model.js';
import { geoidHeight } from '../js/geoid.js';
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
