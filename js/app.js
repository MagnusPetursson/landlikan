import { hydrateIcons, icon } from './icons.js';
import { t, num, setLang, getLang, onLang, clock } from './i18n.js';
import { describeBounds, boundsToString, boundsFromString } from './geo.js';
import { planGrid, loadElevation } from './dem.js';
import { loadDrape } from './imagery.js';
import { buildTopology, fillPositions, solidCounts, meshVolume, writeStl, stlByteLength } from './model.js';
import { buildLayers, layoutSheets, sheetSvg, layerCount, MAX_LAYERS } from './contours.js';
import { zipFiles } from './zip.js';
import { searchPlaces, describePlace } from './search.js';
import { createMap } from './map.js';
import { Viewer } from './viewer.js';

const $ = (id) => document.getElementById(id);

const LIMITS = {
  width: [40, 400],
  exag: [0.5, 5],
  base: [0.4, 20],
  thickness: [0.5, 20],
  sheetW: [100, 3000],
  sheetH: [100, 3000],
};
const SAMPLES = { standard: 300, high: 500, max: 800 };
const LASER_GRID_LIMIT = 420; // points along the longer side used for contour tracing
const START = {
  bounds: { west: -16.47, south: 65.13, east: -16.22, north: 65.225 },
  place: { name: 'Herðubreið', lon: -16.345, lat: 65.178 },
};

const state = {
  bounds: null,
  loaded: null, // bounds of the model on screen
  draft: null,
  place: null,
  geo: null,
  grid: null,
  topo: null,
  positions: null,
  width: 150,
  exag: 1.5,
  base: 2,
  detail: 'standard',
  thickness: 3,
  sheetW: 600,
  sheetH: 300,
  mode: 'print',
  surface: 'satellite',
  sun: 315,
  baseLayer: 'map',
  job: null,
  progress: null,
  laser: null,
  sheetIndex: 0,
  viewTab: 'model',
  notices: { view: null, model: [], print: null, laser: null },
};

let viewer = null;
let map = null;

// --- helpers -------------------------------------------------------------------

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
const decimals = (key) => (key === 'width' || key === 'sheetW' || key === 'sheetH' ? 0 : 1);
const round = (v, key) => Number(v.toFixed(decimals(key) + (key === 'base' || key === 'thickness' ? 1 : 0)));

function geometry() {
  const d = state.geo;
  const widthMm = state.width;
  const depthMm = widthMm * d.aspect;
  const mmPerM = widthMm / d.widthM;
  return { widthMm, depthMm, mmPerM, k: mmPerM * state.exag };
}

function slug(text) {
  const map = { þ: 'th', Þ: 'th', ð: 'd', Ð: 'd', æ: 'ae', Æ: 'ae', ö: 'o', Ö: 'o' };
  return text
    .replace(/[þÞðÐæÆöÖ]/g, (c) => map[c])
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function areaName() {
  const b = state.loaded;
  const p = state.place;
  if (p && p.lon >= b.west && p.lon <= b.east && p.lat >= b.south && p.lat <= b.north) return slug(p.name);
  const d = state.geo;
  return `${d.lat.toFixed(3)}n-${Math.abs(d.lon).toFixed(3)}w`;
}

function bytes(n) {
  if (n < 1024 * 1024) return `${num(n / 1024, 0)} kB`;
  return `${num(n / (1024 * 1024), 1)} MB`;
}

function km(m) {
  return m >= 10000 ? num(m / 1000, 1) : num(m / 1000, 2);
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function notice(n) {
  if (!n) return '';
  const icons = { warn: 'triangle-alert', danger: 'triangle-alert', ok: 'circle-check', info: 'info' };
  const action = n.action ? `<button type="button" class="btn" data-action="${n.action}">${t(n.actionLabel)}</button>` : '';
  const text = t(n.key, n.vars).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<div class="notice ${n.kind}">${icon(icons[n.kind])}<p>${text}</p>${action}</div>`;
}

// --- rendering -----------------------------------------------------------------

function renderArea() {
  const b = state.draft || state.bounds;
  $('areaStats').hidden = !b;
  $('areaEmpty').hidden = !!b;
  if (b) {
    const d = describeBounds(b);
    const size = `${km(d.widthM)} × ${km(d.heightM)} km`;
    $('areaSize').textContent = size;
    $('areaCentre').textContent = `${num(d.lat, 4)}° ${t('north')}, ${num(Math.abs(d.lon), 4)}° ${t('west')}`;
    $('draftSize').textContent = state.draft ? size : '';
  } else {
    $('draftSize').textContent = '';
  }
  $('drawLabel').textContent = t(map && map.isDrawing() ? 'drawCancel' : 'draw');
}

function renderModel() {
  const ready = !!state.grid;
  const dash = '–';
  const notices = [];
  if (ready) {
    const g = geometry();
    const { grid } = state;
    const relief = (grid.max - grid.min) * g.k;
    const height = state.mode === 'laser'
      ? Math.min(laserCap(), Math.floor(relief / state.thickness + 1e-9) + 1) * state.thickness
      : state.base + relief;
    $('statSize').textContent = `${num(g.widthMm, 1)} × ${num(g.depthMm, 1)} × ${num(height, 1)} mm`;
    $('statScale').textContent = `1:${num(Math.round(1000 / g.mmPerM / 10) * 10)}`;
    $('statElevation').textContent = `${num(grid.min)}–${num(grid.max)} m`;
    const spacingMm = g.widthMm / (grid.nx - 1);
    $('statSpacing').textContent = t('spacingValue', { mm: num(spacingMm, 2), m: num(spacingMm / g.mmPerM, spacingMm / g.mmPerM < 20 ? 1 : 0) });
    if (state.plan && state.plan.limited) notices.push({ kind: 'info', key: 'detailLimited' });
    if (grid.max - grid.min < 0.5) notices.push({ kind: 'warn', key: 'flat' });
  } else {
    for (const id of ['statSize', 'statScale', 'statElevation', 'statSpacing']) $(id).textContent = dash;
  }
  $('modelNotice').innerHTML = notices.map(notice).join('');
}

// Why export is unavailable, or null when it is available.
function exportBlock() {
  if (state.progress) return { kind: 'info', key: 'waitModel' };
  if (state.grid) return null;
  return { kind: 'info', key: state.bounds ? 'waitData' : 'waitArea' };
}

function renderPrint() {
  const ready = !!state.grid;
  $('exportStl').disabled = !!exportBlock();
  if (ready) {
    const counts = state.topo.counts;
    $('statTriangles').textContent = num(counts.triangles);
    $('statFile').textContent = bytes(stlByteLength(counts.triangles));
    $('statVolume').textContent = state.volume != null ? `${num(state.volume / 1000, 1)} cm³` : '–';
  } else {
    for (const id of ['statTriangles', 'statFile', 'statVolume']) $(id).textContent = '–';
  }
  $('printNotice').innerHTML = notice(exportBlock() || state.notices.print);
}

function renderLaser() {
  const ready = !!state.grid;
  const L = state.laser;
  const ok = ready && L && !L.problem;
  $('exportSvg').disabled = !ok || !!exportBlock();
  const showSheets = state.mode === 'laser' && state.viewTab === 'sheets' && ok && !state.progress;
  $('sheetFigure').hidden = !showSheets;
  $('view').style.visibility = state.mode === 'laser' && state.viewTab === 'sheets' && ok ? 'hidden' : '';
  const ids = ['statLayers', 'statInterval', 'statStack', 'statSheets', 'statCut'];
  if (ready && L) {
    const g = geometry();
    $('statLayers').textContent = num(L.count);
    const interval = state.thickness / g.k;
    $('statInterval').textContent = `${num(interval, interval < 20 ? 1 : 0)} m`;
    $('statStack').textContent = `${num(L.count * state.thickness, 1)} mm`;
    $('statSheets').textContent = ok ? num(L.sheets.length) : '–';
    $('statCut').textContent = ok ? `${num(L.cutLength / 1000, 1)} m` : '–';
  } else {
    for (const id of ids) $(id).textContent = '–';
  }
  if (ok) {
    state.sheetIndex = Math.min(state.sheetIndex, L.sheets.length - 1);
    if (showSheets) {
      $('sheetArt').innerHTML = L.previews[state.sheetIndex];
      fitSheet();
    }
    $('sheetCaption').textContent = t('sheetPreview', { n: state.sheetIndex + 1, total: L.sheets.length });
    const many = L.sheets.length > 1;
    $('sheetPrev').hidden = !many;
    $('sheetNext').hidden = !many;
    $('sheetPrev').disabled = state.sheetIndex === 0;
    $('sheetNext').disabled = state.sheetIndex === L.sheets.length - 1;
  }
  let n = null;
  if (exportBlock()) n = exportBlock();
  else if (L && L.problem) n = L.problem;
  else n = state.notices.laser;
  $('laserNotice').innerHTML = notice(n);
}

function renderView() {
  const pane = document.querySelector('.view-pane');
  const p = state.progress;
  pane.classList.toggle('busy', !!p);
  $('progress').hidden = !p;
  if (p) {
    $('progressStage').textContent = t(p.stage);
    $('progressDetail').textContent = p.total ? t('stageTiles', { done: num(p.done), total: num(p.total) }) : '';
    $('progressFill').style.width = p.total ? `${Math.round((p.done / p.total) * 100)}%` : '100%';
    const s = Math.floor((performance.now() - p.started) / 1000);
    $('progressTime').textContent = t('elapsed', { s: num(s) });
    $('progressSlow').hidden = s < 15;
  }
  const hasModel = !!state.grid;
  const sheets = state.mode === 'laser' && state.viewTab === 'sheets';
  $('viewEmpty').hidden = hasModel || !!p || !!state.notices.view;
  $('viewTools').hidden = !hasModel;
  $('viewSeg').hidden = state.mode !== 'laser';
  for (const id of ['surfaceSeg', 'sunSlider', 'resetView']) $(id).hidden = sheets || !viewer;
  $('compass').hidden = !hasModel || !viewer || sheets;
  $('viewHint').hidden = !hasModel || !viewer || sheets;
  $('imageChip').hidden = !state.drapePending || !!p;
  $('viewNotice').innerHTML = notice(state.notices.view);
  $('sunValue').textContent = `${num(state.sun)}°`;
  updateInsets();
}

// Size the sheet preview to the room above its caption.
function fitSheet() {
  const figure = $('sheetFigure');
  const svg = figure.querySelector('svg');
  if (figure.hidden || !svg) return;
  const caption = figure.querySelector('figcaption');
  const roomW = figure.clientWidth;
  const roomH = figure.clientHeight - caption.offsetHeight - 12;
  const k = Math.min(roomW / state.sheetW, roomH / state.sheetH);
  svg.setAttribute('width', Math.max(40, Math.floor(state.sheetW * k)));
  svg.setAttribute('height', Math.max(40, Math.floor(state.sheetH * k)));
  caption.style.width = `${Math.max(280, Math.floor(state.sheetW * k))}px`;
}

// Tell the 3D view how much room the toolbar leaves, so the model is framed below it.
function updateInsets() {
  if (!viewer) return;
  const tools = $('viewTools');
  const top = tools.hidden ? 16 : tools.offsetTop + tools.offsetHeight + 12;
  viewer.setInsets({ top, right: 16, bottom: 16, left: 16 });
}

function renderControls() {
  document.querySelectorAll('#langSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === getLang())));
  document.querySelectorAll('#detailSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.detail === state.detail)));
  document.querySelectorAll('#surfaceSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.surface === state.surface)));
  document.querySelectorAll('#viewSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === state.viewTab)));
  document.querySelectorAll('#baseSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.base === state.baseLayer)));
  document.querySelectorAll('#modeSeg button').forEach((b) => {
    const on = b.dataset.mode === state.mode;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  $('panePrint').hidden = state.mode !== 'print';
  $('paneLaser').hidden = state.mode !== 'laser';
  $('exportStl').hidden = state.mode !== 'print';
  $('exportSvg').hidden = state.mode !== 'laser';
  $('printNotice').hidden = state.mode !== 'print';
  $('laserNotice').hidden = state.mode !== 'laser';
  $('themeIcon').innerHTML = icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon');
  $('draw').classList.toggle('active', !!(map && map.isDrawing()));
  $('drawHint').hidden = !(map && map.isDrawing());
}

function renderAll() {
  renderControls();
  renderArea();
  renderModel();
  renderPrint();
  renderLaser();
  renderView();
}

// --- model ---------------------------------------------------------------------

function fillPrint(positions) {
  const { grid, topo } = state;
  const g = geometry();
  const min = grid.min;
  const data = grid.data;
  return fillPositions(positions, grid, topo, { widthMm: g.widthMm, depthMm: g.depthMm, baseMm: state.base }, (v) => (data[v] - min) * g.k);
}

// Settings the layer set depends on; a computed set is only used while they match.
const laserSig = () => `${state.width}|${state.exag}|${state.thickness}|${state.loaded ? boundsToString(state.loaded) : ''}|${state.detail}`;

// Number of layers actually cut, once known. Tiny top pieces are left out of the
// cut set, so the stack can be a layer lower than the terrain suggests.
function laserCap() {
  const L = state.laser;
  return L && !L.problem && L.sig === laserSig() ? L.count : Infinity;
}

function fillLaser(positions) {
  const { grid, topo } = state;
  const g = geometry();
  const min = grid.min;
  const data = grid.data;
  const tk = state.thickness;
  const cap = laserCap();
  return fillPositions(positions, grid, topo, { widthMm: g.widthMm, depthMm: g.depthMm, baseMm: 0 }, (v) => Math.min(cap, Math.floor(((data[v] - min) * g.k) / tk + 1e-9) + 1) * tk);
}

function refreshModel({ fresh = false } = {}) {
  if (!state.grid) return;
  const g = geometry();
  const zMax = state.mode === 'laser' ? fillLaser(state.positions) : fillPrint(state.positions);
  if (state.mode === 'print') state.volume = meshVolume(state.positions, state.topo.index);
  const model = {
    positions: state.positions,
    index: state.topo.index,
    topIndexCount: state.topo.topIndexCount,
    nx: state.grid.nx,
    ny: state.grid.ny,
    widthMm: g.widthMm,
    depthMm: g.depthMm,
    zMax,
  };
  if (viewer) {
    if (fresh) viewer.setModel(model, { refit: true });
    else viewer.updateModel(model);
  }
  renderModel();
  renderPrint();
}

let modelQueued = false;
function scheduleModel() {
  state.notices.print = null;
  state.notices.laser = null;
  if (modelQueued) return;
  modelQueued = true;
  requestAnimationFrame(() => {
    modelQueued = false;
    refreshModel();
    scheduleLaser();
    saveHash();
  });
}

// --- laser layers --------------------------------------------------------------

let laserTimer = 0;
function scheduleLaser() {
  clearTimeout(laserTimer);
  if (state.mode !== 'laser' || !state.grid) return;
  laserTimer = setTimeout(computeLaser, 140);
}

function computeLaser() {
  const { grid } = state;
  if (!grid) return;
  const g = geometry();
  const relief = (grid.max - grid.min) * g.k;
  const wanted = layerCount(relief, state.thickness);
  const laser = { count: wanted, sheets: [], previews: [], cutLength: 0, problem: null, sig: laserSig() };
  state.laser = laser;
  if (wanted > MAX_LAYERS) {
    laser.problem = { kind: 'warn', key: 'tooManyLayers', vars: { n: num(wanted), max: num(MAX_LAYERS) } };
    renderLaser();
    return;
  }
  // Trace on a grid of at most LASER_GRID_LIMIT points per side.
  const stride = Math.max(1, Math.ceil((Math.max(grid.nx, grid.ny) - 1) / LASER_GRID_LIMIT));
  const nx = Math.floor((grid.nx - 1) / stride) + 1;
  const ny = Math.floor((grid.ny - 1) / stride) + 1;
  const h = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) h[j * nx + i] = (grid.data[j * stride * grid.nx + i * stride] - grid.min) * g.k;
  }
  const widthMm = (g.widthMm * (nx - 1) * stride) / (grid.nx - 1);
  const depthMm = (g.depthMm * (ny - 1) * stride) / (grid.ny - 1);
  const layers = buildLayers(h, { nx, ny, widthMm, depthMm, thickness: state.thickness });
  laser.count = layers.length;
  const layout = layoutSheets(layers, state.sheetW, state.sheetH);
  if (layout.unfit) {
    laser.problem = { kind: 'warn', key: 'sheetTooSmall', vars: { w: num(Math.ceil(layout.need.w)), h: num(Math.ceil(layout.need.h)) } };
    renderLaser();
    return;
  }
  const scale = Math.round(1000 / g.mmPerM / 10) * 10;
  layout.sheets.forEach((placements, n) => {
    const title = `Landlikan ${areaName()} 1:${scale}, ${state.thickness} mm, sheet ${n + 1}/${layout.sheets.length}`;
    const { svg, cutLength } = sheetSvg(placements, state.sheetW, state.sheetH, title);
    laser.sheets.push(svg);
    laser.cutLength += cutLength;
    const preview = sheetSvg(placements, state.sheetW, state.sheetH, title, Math.max(state.sheetW, state.sheetH) / 900).svg;
    laser.previews.push(preview.slice(preview.indexOf('<svg')).replace('<svg ', '<svg role="img" '));
  });
  renderLaser();
  if (state.mode === 'laser' && layers.length !== wanted) refreshModel(); // show the stack as cut
}

// --- loading an area -----------------------------------------------------------

let ticker = 0;
function setProgress(p) {
  state.progress = p;
  clearInterval(ticker);
  if (p) ticker = setInterval(renderView, 500);
  renderView();
  renderPrint();
  renderLaser();
}

async function loadArea() {
  if (!state.bounds) return;
  if (state.job) state.job.abort();
  const job = new AbortController();
  job.userCancelled = false;
  state.job = job;
  const bounds = state.bounds;
  const d = describeBounds(bounds);
  const plan = planGrid(d, SAMPLES[state.detail]);
  state.notices.view = null;
  state.notices.print = null;
  state.notices.laser = null;
  state.drapePending = false;
  const started = performance.now();
  setProgress({ stage: 'stageElevation', done: 0, total: plan.tileCount, started });
  renderPrint();
  renderLaser();

  const drape = loadDrape(d, { signal: job.signal }).then((canvas) => ({ canvas }), (error) => ({ error }));
  let grid;
  try {
    grid = await loadElevation(d, plan, {
      signal: job.signal,
      onProgress: (done, total) => {
        if (state.job !== job) return;
        state.progress = { stage: 'stageElevation', done, total, started };
        renderView();
      },
    });
  } catch (error) {
    if (state.job !== job) return; // replaced by a newer request
    state.job = null;
    setProgress(null);
    if (job.signal.aborted) {
      // Cancelled by the user: go back to the model that is on screen.
      if (state.loaded) {
        state.bounds = state.loaded;
        state.detail = state.loadedDetail;
        map.setBounds(state.loaded);
        state.notices.view = { kind: 'info', key: 'cancelled' };
      } else {
        state.notices.view = { kind: 'info', key: 'cancelled', action: 'retry', actionLabel: 'retry' };
      }
    } else {
      state.notices.view = { kind: 'danger', key: 'errorElevation', action: 'retry', actionLabel: 'retry' };
    }
    renderAll();
    return;
  }
  if (state.job !== job) return;

  setProgress({ stage: 'stageBuild', done: 0, total: 0, started });
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  if (state.job !== job) return;

  state.geo = d;
  state.plan = plan;
  state.grid = grid;
  state.loaded = bounds;
  state.loadedDetail = state.detail;
  state.topo = buildTopology(grid);
  state.positions = new Float32Array(solidCounts(grid.nx, grid.ny).vertices * 3);
  state.laser = null;
  state.sheetIndex = 0;
  if (viewer) viewer.setDrape(null);
  refreshModel({ fresh: true });
  state.drapePending = true;
  setProgress(null);
  renderAll();
  scheduleLaser();
  saveHash();

  const result = await drape;
  if (state.job !== job) return;
  state.job = null;
  state.drapePending = false;
  if (result.canvas) {
    if (viewer) viewer.setDrape(result.canvas);
  } else if (!job.signal.aborted) {
    state.notices.view = { kind: 'warn', key: 'errorImage' };
  }
  renderView();
}

function setBounds(bounds, { fit = false } = {}) {
  state.bounds = bounds;
  state.draft = null;
  map.setBounds(bounds, { fit });
  renderArea();
  loadArea();
}

// --- export --------------------------------------------------------------------

function exportStl() {
  if (!state.grid) return;
  try {
    const positions = state.mode === 'print' ? state.positions : new Float32Array(state.positions.length);
    if (state.mode !== 'print') fillPrint(positions);
    const g = geometry();
    const scale = Math.round(1000 / g.mmPerM / 10) * 10;
    const buffer = writeStl(positions, state.topo.index, `Landlikan ${areaName()} 1:${scale} x${state.exag}`);
    const name = `landlikan-${areaName()}-${Math.round(g.widthMm)}mm.stl`;
    download(new Blob([buffer], { type: 'model/stl' }), name);
    state.notices.print = { kind: 'ok', key: 'exported', vars: { time: clock(), file: name, size: bytes(buffer.byteLength) } };
  } catch (error) {
    state.notices.print = { kind: 'danger', key: 'exportFailed' };
  }
  renderPrint();
}

function exportSvg() {
  const L = state.laser;
  if (!L || L.problem || !L.sheets.length) return;
  const stem = `landlikan-${areaName()}-${Math.round(state.width)}mm-${String(state.thickness).replace('.', '_')}mm`;
  let blob;
  let name;
  if (L.sheets.length === 1) {
    name = `${stem}.svg`;
    blob = new Blob([L.sheets[0]], { type: 'image/svg+xml' });
  } else {
    name = `${stem}.zip`;
    const pad = String(L.sheets.length).length;
    blob = zipFiles(L.sheets.map((text, n) => ({ name: `${stem}-${String(n + 1).padStart(pad, '0')}.svg`, text })));
  }
  download(blob, name);
  state.notices.laser = { kind: 'ok', key: 'exported', vars: { time: clock(), file: name, size: bytes(blob.size) } };
  renderLaser();
}

// --- URL state -----------------------------------------------------------------

function saveHash() {
  if (!state.loaded) return;
  const p = new URLSearchParams();
  p.set('b', boundsToString(state.loaded));
  p.set('w', state.width);
  p.set('x', state.exag);
  p.set('t', state.base);
  p.set('m', state.thickness);
  p.set('d', state.detail);
  p.set('o', state.mode);
  const b = state.loaded;
  const place = state.place;
  if (place && place.lon >= b.west && place.lon <= b.east && place.lat >= b.south && place.lat <= b.north) p.set('n', place.name);
  history.replaceState(null, '', `#${p}`);
}

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const number = (key, name) => {
    const v = Number(p.get(name));
    if (p.has(name) && Number.isFinite(v)) state[key] = clamp(v, LIMITS[key]);
  };
  number('width', 'w');
  number('exag', 'x');
  number('base', 't');
  number('thickness', 'm');
  if (SAMPLES[p.get('d')]) state.detail = p.get('d');
  if (p.get('o') === 'laser' || p.get('o') === 'print') state.mode = p.get('o');
  const bounds = boundsFromString(p.get('b'));
  const name = (p.get('n') || '').slice(0, 80);
  if (bounds && name) state.place = { name, lon: (bounds.west + bounds.east) / 2, lat: (bounds.south + bounds.north) / 2 };
  return bounds;
}

// --- wiring --------------------------------------------------------------------

function bindNumber(key, onChange) {
  const input = $(key);
  const range = $(`${key}Range`);
  const limits = LIMITS[key];
  const show = (from) => {
    if (from !== input) input.value = String(state[key]);
    if (range && from !== range) range.value = String(state[key]);
  };
  const set = (v, from) => {
    state[key] = round(clamp(v, limits), key);
    show(from);
    onChange();
  };
  show(null);
  if (range) range.addEventListener('input', () => set(Number(range.value), range));
  input.addEventListener('input', () => {
    const v = Number(input.value);
    if (input.value !== '' && Number.isFinite(v) && v >= limits[0] && v <= limits[1]) set(v, input);
  });
  input.addEventListener('change', () => {
    const v = Number(input.value);
    set(input.value === '' || !Number.isFinite(v) ? state[key] : v, null);
  });
}

function setupSearch() {
  const input = $('search');
  const list = $('results');
  const status = $('searchStatus');
  const clear = $('searchClear');
  let items = [];
  let active = -1;
  let timer = 0;
  let request = null;
  let statusKey = null;

  const setStatus = (key) => {
    statusKey = key;
    status.hidden = !key;
    status.textContent = key ? t(key) : '';
  };
  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };
  const paint = () => {
    list.innerHTML = '';
    items.forEach((item, n) => {
      const li = document.createElement('li');
      li.id = `result-${n}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(n === active));
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = item.name;
      const note = document.createElement('span');
      note.className = 'note';
      note.textContent = describePlace(item, getLang());
      li.append(name, note);
      li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(n); });
      list.appendChild(li);
    });
    list.hidden = !items.length;
    input.setAttribute('aria-expanded', String(items.length > 0));
    if (active >= 0) {
      input.setAttribute('aria-activedescendant', `result-${active}`);
      list.children[active].scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  };
  const choose = (n) => {
    const item = items[n];
    if (!item) return;
    state.place = { name: item.name, lon: item.lon, lat: item.lat };
    input.value = item.name;
    close();
    setStatus(null);
    map.goTo(item);
  };
  const run = async () => {
    const query = input.value.trim();
    if (request) request.abort();
    if (query.length < 2) { items = []; close(); setStatus(null); return; }
    request = new AbortController();
    const mine = request;
    setStatus('searching');
    try {
      const found = await searchPlaces(query, mine.signal);
      if (mine !== request) return;
      items = found;
      active = -1;
      paint();
      setStatus(items.length ? null : 'searchEmpty');
    } catch (error) {
      if (mine !== request || mine.signal.aborted) return;
      items = [];
      close();
      setStatus('searchFailed');
    }
  };
  input.addEventListener('input', () => {
    clear.hidden = !input.value;
    clearTimeout(timer);
    timer = setTimeout(run, 280);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!items.length) return;
      e.preventDefault();
      if (list.hidden) { paint(); }
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      paint();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!list.hidden && items.length) choose(active >= 0 ? active : 0);
      else { clearTimeout(timer); run(); }
    } else if (e.key === 'Escape') {
      close();
    }
  });
  input.addEventListener('focus', () => { if (items.length && input.value.trim().length >= 2) paint(); });
  input.addEventListener('blur', () => setTimeout(close, 120));
  clear.addEventListener('click', () => {
    input.value = '';
    clear.hidden = true;
    items = [];
    close();
    setStatus(null);
    state.place = null;
    map.clearPlace();
    input.focus();
  });
  onLang(() => {
    if (statusKey) status.textContent = t(statusKey);
    if (!list.hidden) paint();
  });
}

function init() {
  hydrateIcons();
  let storedLang = null;
  try { storedLang = localStorage.getItem('landlikan.lang'); } catch (e) { /* private mode */ }
  const queryLang = new URLSearchParams(location.search).get('lang');
  const lang = queryLang || storedLang || ((navigator.language || '').toLowerCase().startsWith('is') ? 'is' : 'en');
  const hashBounds = readHash();

  map = createMap($('map'), {
    onBounds: (b) => setBounds(b),
    onDraft: (b) => { state.draft = b && map.isDrawing() ? b : (b && b !== state.bounds ? b : null); renderArea(); },
    onDrawState: () => { renderControls(); renderArea(); },
  });

  try {
    viewer = new Viewer($('view'), $('compassNeedle'));
    viewer.setSun(state.sun);
    viewer.setSurface(state.surface);
    viewer.setMode(state.mode);
  } catch (error) {
    viewer = null;
    state.noWebgl = true;
  }

  onLang(renderAll);
  setLang(lang);

  bindNumber('width', scheduleModel);
  bindNumber('exag', scheduleModel);
  bindNumber('base', scheduleModel);
  bindNumber('thickness', scheduleModel);
  bindNumber('sheetW', () => { state.notices.laser = null; scheduleLaser(); });
  bindNumber('sheetH', () => { state.notices.laser = null; scheduleLaser(); });
  $('sun').value = String(state.sun);
  setupSearch();

  $('langSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-lang]');
    if (!b) return;
    try { localStorage.setItem('landlikan.lang', b.dataset.lang); } catch (err) { /* private mode */ }
    setLang(b.dataset.lang);
  });
  $('themeToggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('landlikan.theme', next); } catch (err) { /* private mode */ }
    if (viewer) viewer.setTheme();
    renderControls();
  });
  $('aboutOpen').addEventListener('click', () => $('about').showModal());
  $('aboutClose').addEventListener('click', () => $('about').close());
  $('about').addEventListener('click', (e) => { if (e.target === $('about')) $('about').close(); });

  $('draw').addEventListener('click', () => { if (map.isDrawing()) map.cancelDraw(); else map.startDraw(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && map.isDrawing()) map.cancelDraw(); });

  $('detailSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-detail]');
    if (!b || b.dataset.detail === state.detail) return;
    state.detail = b.dataset.detail;
    renderControls();
    if (state.bounds) loadArea(); else saveHash();
  });
  $('baseSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-base]');
    if (!b) return;
    state.baseLayer = b.dataset.base;
    map.setBase(state.baseLayer);
    renderControls();
  });
  const setMode = (mode) => {
    if (mode === state.mode) return;
    state.mode = mode;
    if (viewer) viewer.setMode(mode);
    renderControls();
    refreshModel();
    renderLaser();
    renderView();
    scheduleLaser();
    saveHash();
    $(mode === 'laser' ? 'paneLaser' : 'panePrint').scrollIntoView({ block: 'nearest' });
  };
  $('modeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (b) setMode(b.dataset.mode);
  });
  $('modeSeg').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setMode(state.mode === 'print' ? 'laser' : 'print');
    document.querySelector(`#modeSeg button[data-mode="${state.mode}"]`).focus();
  });
  $('viewSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (!b) return;
    state.viewTab = b.dataset.view;
    renderControls();
    renderLaser();
    renderView();
  });
  $('surfaceSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-surface]');
    if (!b) return;
    state.surface = b.dataset.surface;
    if (viewer) viewer.setSurface(state.surface);
    renderControls();
  });
  $('sun').addEventListener('input', () => {
    state.sun = Number($('sun').value);
    if (viewer) viewer.setSun(state.sun);
    $('sunValue').textContent = `${num(state.sun)}°`;
  });
  $('resetView').addEventListener('click', () => viewer && viewer.resetView());
  $('progressCancel').addEventListener('click', () => { if (state.job) state.job.abort(); });
  $('viewNotice').addEventListener('click', (e) => {
    if (e.target.closest('[data-action="retry"]')) loadArea();
  });
  $('exportStl').addEventListener('click', exportStl);
  $('exportSvg').addEventListener('click', exportSvg);
  $('sheetPrev').addEventListener('click', () => { state.sheetIndex = Math.max(0, state.sheetIndex - 1); renderLaser(); });
  $('sheetNext').addEventListener('click', () => { state.sheetIndex++; renderLaser(); });

  new ResizeObserver(() => { updateInsets(); fitSheet(); }).observe($('viewStage'));
  if (state.noWebgl) state.notices.view = { kind: 'warn', key: 'errorWebgl' };
  renderAll();

  if (hashBounds) {
    setBounds(hashBounds, { fit: true });
  } else {
    state.place = START.place;
    setBounds(START.bounds, { fit: true });
  }
}

init();

// Handle for automated checks and the console.
window.landlikan = { state, get viewer() { return viewer; }, get map() { return map; } };
