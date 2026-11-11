// Interface text. Icelandic and English are kept side by side per key.

const TEXT = {
  title: { is: 'Landlíkan – 3D-prentanlegt landslag af Íslandi', en: 'Landlíkan – 3D-printable terrain of Iceland' },
  about: { is: 'Um gögnin', en: 'About the data' },
  language: { is: 'Tungumál', en: 'Language' },
  theme: { is: 'Ljóst eða dökkt útlit', en: 'Light or dark theme' },
  close: { is: 'Loka', en: 'Close' },

  // Area
  area: { is: 'Svæði', en: 'Area' },
  search: { is: 'Leita að stað', en: 'Search for a place' },
  searchPlaceholder: { is: 't.d. Herðubreið', en: 'e.g. Herðubreið' },
  searching: { is: 'Leita…', en: 'Searching…' },
  searchEmpty: { is: 'Enginn staður fannst með þessu nafni.', en: 'No place found with that name.' },
  searchFailed: {
    is: 'Leit mistókst: leitarþjónninn svaraði ekki. Athugaðu nettenginguna og reyndu aftur.',
    en: 'Search failed: the search server did not respond. Check the connection and try again.',
  },
  clearSearch: { is: 'Hreinsa leit', en: 'Clear search' },
  draw: { is: 'Teikna rétthyrning', en: 'Draw rectangle' },
  drawCancel: { is: 'Hætta við teikningu', en: 'Cancel drawing' },
  drawHint: { is: 'Dragðu á kortinu til að afmarka svæðið. Esc hættir við.', en: 'Drag on the map to mark the area. Esc cancels.' },
  areaSize: { is: 'Stærð svæðis', en: 'Area size' },
  areaCentre: { is: 'Miðja', en: 'Centre' },
  noArea: { is: 'Ekkert svæði valið. Teiknaðu rétthyrning á kortinu.', en: 'No area selected. Draw a rectangle on the map.' },
  baseMap: { is: 'Kort', en: 'Map' },
  baseSatellite: { is: 'Gervihnattamynd', en: 'Satellite' },
  baseLayer: { is: 'Grunnkort', en: 'Base map' },
  west: { is: 'V', en: 'W' },
  north: { is: 'N', en: 'N' },

  // Model
  model: { is: 'Líkan', en: 'Model' },
  width: { is: 'Breidd', en: 'Width' },
  exaggeration: { is: 'Hæðarýkjur', en: 'Vertical exaggeration' },
  detail: { is: 'Upplausn', en: 'Resolution' },
  detailStandard: { is: 'Venjuleg', en: 'Standard' },
  detailHigh: { is: 'Há', en: 'High' },
  detailMax: { is: 'Mesta', en: 'Maximum' },
  size: { is: 'Stærð', en: 'Size' },
  scale: { is: 'Mælikvarði', en: 'Scale' },
  elevation: { is: 'Hæð yfir sjó', en: 'Elevation' },
  spacing: { is: 'Punktabil', en: 'Point spacing' },
  spacingValue: { is: '{mm} mm ({m} m)', en: '{mm} mm ({m} m)' },
  detailLimited: {
    is: 'Upplausnin takmarkast af hæðargögnunum (um 4 m milli punkta).',
    en: 'Resolution is limited by the elevation data (about 4 m between points).',
  },
  flat: { is: 'Allt svæðið er við sjávarmál. Líkanið verður flöt plata.', en: 'The whole area is at sea level. The model will be a flat plate.' },

  // Output
  output: { is: 'Úttak', en: 'Output' },
  print: { is: '3D-prentun', en: '3D printing' },
  laser: { is: 'Laserskurður', en: 'Laser cutting' },
  base: { is: 'Þykkt botns', en: 'Base thickness' },
  triangles: { is: 'Þríhyrningar', en: 'Triangles' },
  fileSize: { is: 'Skráarstærð', en: 'File size' },
  volume: { is: 'Rúmmál', en: 'Volume' },
  exportStl: { is: 'Flytja út STL', en: 'Export STL' },
  thickness: { is: 'Efnisþykkt', en: 'Material thickness' },
  sheet: { is: 'Plata', en: 'Sheet' },
  sheetWidth: { is: 'Breidd plötu', en: 'Sheet width' },
  sheetHeight: { is: 'Hæð plötu', en: 'Sheet height' },
  layers: { is: 'Lög', en: 'Layers' },
  interval: { is: 'Hæðarbil milli laga', en: 'Contour interval' },
  stack: { is: 'Hæð stafla', en: 'Stack height' },
  sheets: { is: 'Plötur', en: 'Sheets' },
  cutLength: { is: 'Skurðarlengd', en: 'Cut length' },
  viewTab: { is: 'Sýn', en: 'View' },
  viewModel: { is: 'Þrívídd', en: '3D' },
  viewSheets: { is: 'Plötur', en: 'Sheets' },
  sheetPreview: { is: 'Plata {n} af {total}', en: 'Sheet {n} of {total}' },
  prevSheet: { is: 'Fyrri plata', en: 'Previous sheet' },
  nextSheet: { is: 'Næsta plata', en: 'Next sheet' },
  legendCut: { is: 'Rautt: skurður', en: 'Red: cut' },
  legendScore: { is: 'Blátt: merking (útlínur næsta lags og númer lagsins)', en: 'Blue: score (outline of the next layer and the layer number)' },
  exportSvg: { is: 'Flytja út SVG', en: 'Export SVG' },
  zipNote: { is: '{n} plötur í einni ZIP-skrá.', en: '{n} sheets in one ZIP file.' },
  sheetTooSmall: {
    is: 'Líkanið ({w} × {h} mm með spássíu) kemst ekki á plötuna. Stækkaðu plötuna eða minnkaðu breidd líkansins.',
    en: 'The model ({w} × {h} mm with margin) does not fit the sheet. Use a larger sheet or reduce the model width.',
  },
  tooManyLayers: {
    is: 'Lögin yrðu {n} en hámarkið er {max}. Auktu efnisþykktina eða minnkaðu hæðarýkjurnar.',
    en: 'This needs {n} layers; the limit is {max}. Increase the material thickness or lower the vertical exaggeration.',
  },
  exported: { is: 'Flutt út kl. {time}: {file} ({size})', en: 'Exported at {time}: {file} ({size})' },
  exportFailed: {
    is: 'Útflutningur mistókst: ekki nægt minni. Veldu lægri upplausn og reyndu aftur.',
    en: 'Export failed: not enough memory. Choose a lower resolution and try again.',
  },
  waitModel: { is: 'Líkanið er í vinnslu. Útflutningur opnast þegar það er tilbúið.', en: 'The model is being built. Export becomes available when it is ready.' },
  waitData: { is: 'Hæðargögnin bárust ekki, svo ekkert er til að flytja út enn.', en: 'The elevation data did not load, so there is nothing to export yet.' },
  waitArea: { is: 'Teiknaðu svæði á kortinu til að flytja út.', en: 'Draw an area on the map to export.' },

  // 3D view
  surface: { is: 'Yfirborð', en: 'Surface' },
  surfaceSatellite: { is: 'Gervihnattamynd', en: 'Satellite image' },
  surfacePlain: { is: 'Einlitt', en: 'Plain' },
  sun: { is: 'Sólarátt', en: 'Sun direction' },
  resetView: { is: 'Endurstilla sjónarhorn', en: 'Reset view' },
  viewHint: { is: 'Dragðu til að snúa, skrunaðu til að þysja, hægri smelltu og dragðu til að færa.', en: 'Drag to rotate, scroll to zoom, right-drag to pan.' },

  // Progress and errors
  stageElevation: { is: 'Sæki hæðargögn', en: 'Loading elevation data' },
  stageTiles: { is: '{done} af {total} flísum', en: '{done} of {total} tiles' },
  stageImage: { is: 'Sæki gervihnattamynd', en: 'Loading satellite image' },
  stageBuild: { is: 'Byggi líkan', en: 'Building model' },
  elapsed: { is: '{s} s', en: '{s} s' },
  cancel: { is: 'Hætta við', en: 'Cancel' },
  slow: {
    is: 'Gagnaþjónninn svarar hægt. Þú getur beðið áfram eða hætt við.',
    en: 'The data server is responding slowly. You can keep waiting or cancel.',
  },
  cancelled: { is: 'Hætt var við. Líkanið var ekki uppfært.', en: 'Cancelled. The model was not updated.' },
  errorElevation: {
    is: 'Ekki tókst að sækja hæðargögn: gagnaþjónninn svaraði ekki. Athugaðu nettenginguna og reyndu aftur.',
    en: 'Could not load elevation data: the data server did not respond. Check the connection and try again.',
  },
  errorImage: {
    is: 'Gervihnattamyndin fékkst ekki. Líkanið er sýnt einlitt; útflutningur virkar eins og venjulega.',
    en: 'The satellite image could not be loaded. The model is shown plain; export works as usual.',
  },
  errorWebgl: {
    is: 'Þrívíddarsýnin ræsist ekki: vafrinn styður ekki WebGL. Útflutningur virkar samt.',
    en: 'The 3D view cannot start: this browser does not support WebGL. Export still works.',
  },
  retry: { is: 'Reyna aftur', en: 'Try again' },

  // About
  aboutElevationHead: { is: 'Hæðargögn', en: 'Elevation' },
  aboutElevation: {
    is: 'Terrain Tiles (Mapzen) úr AWS Open Data. Á Íslandi byggja þau á ArcticDEM, um 5 m upplausn. Hæðirnar eru gefnar yfir sporvölu og eru hér færðar í hæð yfir sjávarmáli með EGM2008-láfletinum (um 60–68 m á Íslandi). Sjór er settur í 0 m. Yfirborð stöðuvatna getur skeikað um nokkra metra.',
    en: 'Terrain Tiles (Mapzen) from AWS Open Data. In Iceland they are based on ArcticDEM, about 5 m resolution. The heights are given above the ellipsoid and are converted here to height above sea level with the EGM2008 geoid (about 60–68 m in Iceland). Sea is set to 0 m. Lake surfaces can be off by a few metres.',
  },
  aboutImageHead: { is: 'Gervihnattamynd', en: 'Satellite image' },
  aboutImage: {
    is: 'Sentinel-2 cloudless 2016 frá EOX IT Services GmbH, 10 m upplausn, CC BY 4.0. Inniheldur breytt Copernicus Sentinel-gögn 2016. Birta og skerpa eru stillt eftir svæði í þrívíddarsýninni.',
    en: 'Sentinel-2 cloudless 2016 by EOX IT Services GmbH, 10 m resolution, CC BY 4.0. Contains modified Copernicus Sentinel data 2016. Brightness and contrast are adjusted per area in the 3D view.',
  },
  aboutMapHead: { is: 'Kort og örnefni', en: 'Map and place names' },
  aboutMap: {
    is: 'Kort: © OpenStreetMap og þeir sem leggja því til gögn (ODbL). Örnefni: IS 50V frá Náttúrufræðistofnun (áður Landmælingar Íslands) og Photon-leit í gögnum OpenStreetMap.',
    en: 'Map: © OpenStreetMap contributors (ODbL). Place names: IS 50V from Náttúrufræðistofnun (formerly the National Land Survey of Iceland) and Photon search of OpenStreetMap data.',
  },
  aboutScaleHead: { is: 'Mælikvarði', en: 'Scale' },
  aboutScale: {
    is: 'Mælikvarðinn miðast við miðju svæðisins. Á mjög stórum svæðum skekkist hann um fáein prósent milli norður- og suðurbrúnar.',
    en: 'The scale is taken at the centre of the area. Over very large areas it drifts by a few per cent between the north and south edges.',
  },
  aboutPrivacyHead: { is: 'Vinnsla', en: 'Processing' },
  aboutPrivacy: {
    is: 'Líkanið er reiknað í vafranum. Ekkert er sent annað en fyrirspurnir til gagnaþjónanna.',
    en: 'The model is computed in the browser. Nothing is sent anywhere except requests to the data servers.',
  },
  aboutSoftwareHead: { is: 'Hugbúnaður', en: 'Software' },
  aboutSoftware: {
    is: 'three.js (MIT), Leaflet (BSD-2-Clause), IBM Plex (OFL 1.1), Lucide (ISC).',
    en: 'three.js (MIT), Leaflet (BSD-2-Clause), IBM Plex (OFL 1.1), Lucide (ISC).',
  },
  credits: {
    is: 'Hæðargögn: ArcticDEM, Mapzen Terrain Tiles · Mynd: Sentinel-2 cloudless 2016, EOX',
    en: 'Elevation: ArcticDEM, Mapzen Terrain Tiles · Imagery: Sentinel-2 cloudless 2016, EOX',
  },
};

let lang = 'en';
const listeners = new Set();

export const getLang = () => lang;

export function setLang(next) {
  lang = next === 'is' ? 'is' : 'en';
  document.documentElement.lang = lang;
  applyText();
  listeners.forEach((fn) => fn(lang));
}

export const onLang = (fn) => listeners.add(fn);

export function t(key, vars) {
  const entry = TEXT[key];
  let s = entry ? entry[lang] : key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

export function applyText(root = document) {
  root.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
  root.querySelectorAll('[data-t-label]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.tLabel)); });
  root.querySelectorAll('[data-t-title]').forEach((el) => { el.title = t(el.dataset.tTitle); });
  root.querySelectorAll('[data-t-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.tPlaceholder); });
  document.title = t('title');
}

// Number formatting follows the interface language. Written out by hand because
// Chromium ships no Icelandic locale data and would fall back to English.
export function num(value, digits = 0) {
  const fixed = Math.abs(value).toFixed(digits);
  const [whole, frac] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'is' ? '.' : ',');
  const sign = value < 0 && Number(fixed) !== 0 ? '−' : '';
  return sign + grouped + (frac ? (lang === 'is' ? ',' : '.') + frac : '');
}

export function clock(date = new Date()) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
