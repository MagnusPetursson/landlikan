// Place search: Icelandic place names (IS 50V, Náttúrufræðistofnun) first,
// then Photon (OpenStreetMap) for towns, addresses and unaccented spellings.

import { ICELAND } from './geo.js';
import { TOWNS } from './towns.js';

const WFS = 'https://gis.natt.is/geoserver/IS_50V/ows';
const PHOTON = 'https://photon.komoot.io/api/';

// English for the feature types that come with IS 50V names. Others stay in Icelandic.
const KINDS = {
  fjall: 'mountain', fell: 'mountain', fjallgarður: 'mountain range', hnjúkur: 'peak', hnúkur: 'peak', tindur: 'peak',
  hóll: 'hill', hæð: 'hill', háls: 'ridge', hryggur: 'ridge', hlíð: 'slope', dalur: 'valley', gil: 'gorge',
  gljúfur: 'canyon', skarð: 'pass', heiði: 'heath', hraun: 'lava field', gígur: 'crater', eldfjall: 'volcano',
  jökull: 'glacier', skriðjökull: 'outlet glacier', á: 'river', lækur: 'stream', kvísl: 'river branch', árós: 'river mouth',
  foss: 'waterfall', stöðuvatn: 'lake', vatn: 'lake', tjörn: 'pond', lón: 'lagoon', lind: 'spring', hver: 'hot spring',
  fjörður: 'fjord', vík: 'bay', vogur: 'cove', flói: 'bay', sund: 'strait', eyja: 'island', ey: 'island', hólmi: 'islet',
  sker: 'skerry', nes: 'peninsula', tangi: 'spit', höfði: 'headland', eyri: 'spit', sandur: 'sands', fjara: 'beach',
  bjarg: 'cliff', klettur: 'rock', hamar: 'crag', mýri: 'bog', skógur: 'forest', graslendi: 'grassland',
  byggðarkjarni: 'settlement', bær: 'farm', eyðibýli: 'abandoned farm', kirkja: 'church', vegur: 'road', slóði: 'track',
};

// Nearest settlement and the distance to it in km.
function nearestTown(lon, lat) {
  const k = Math.cos((lat * Math.PI) / 180);
  let best = null;
  let bestD = Infinity;
  for (const [name, tLon, tLat] of TOWNS) {
    const d = Math.hypot((tLon - lon) * k, tLat - lat) * 111.2;
    if (d < bestD) { bestD = d; best = name; }
  }
  return { name: best, km: bestD };
}

// Second line of a search result: feature type and where it is.
export function describePlace(item, lang) {
  const kind = item.kind ? (lang === 'en' && KINDS[item.kind]) || item.kind : '';
  const town = nearestTown(item.lon, item.lat);
  let where = '';
  if (town.km < 1.5) where = town.name === item.name ? '' : town.name;
  else where = `${town.name} ${Math.round(town.km)} km`;
  return [kind, where].filter(Boolean).join(' · ');
}

const inIceland = (lon, lat) => lon >= ICELAND.west && lon <= ICELAND.east && lat >= ICELAND.south && lat <= ICELAND.north;

function firstCoordinate(geometry) {
  let c = geometry && geometry.coordinates;
  while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
  return Array.isArray(c) ? c : null;
}

async function searchNames(query, signal) {
  const safe = query.replace(/'/g, "''").replace(/[%_\\]/g, '');
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: 'IS_50V:v_ornefni_allt',
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    count: '12',
    sortBy: 'birtingarkvardi D',
    cql_filter: `ornefni ILIKE '${safe}%'`,
  });
  const res = await fetch(`${WFS}?${params}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const out = [];
  for (const f of json.features || []) {
    const p = f.properties || {};
    if (!p.ornefni) continue;
    let bbox = Array.isArray(f.bbox) && f.bbox.length === 4 ? f.bbox : null;
    let lon;
    let lat;
    if (bbox) {
      lon = (bbox[0] + bbox[2]) / 2;
      lat = (bbox[1] + bbox[3]) / 2;
      if (bbox[2] - bbox[0] < 1e-4 && bbox[3] - bbox[1] < 1e-4) bbox = null;
    } else {
      const c = firstCoordinate(f.geometry);
      if (!c) continue;
      [lon, lat] = c;
    }
    if (!inIceland(lon, lat)) continue;
    out.push({ name: p.ornefni, kind: p.nafnberi || '', lon, lat, bbox, rank: p.birtingarkvardi || 0 });
  }
  const q = query.toLocaleLowerCase('is');
  out.sort((a, b) => {
    const ea = a.name.toLocaleLowerCase('is') === q ? 1 : 0;
    const eb = b.name.toLocaleLowerCase('is') === q ? 1 : 0;
    return eb - ea || b.rank - a.rank || a.name.length - b.name.length;
  });
  return out;
}

// Lower case without Icelandic diacritics, so "Reykjavik" finds "Reykjavík".
export function fold(text) {
  const map = { þ: 'th', ð: 'd', æ: 'ae', ö: 'o' };
  return text.toLocaleLowerCase('is').replace(/[þðæö]/g, (c) => map[c]).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

async function searchPhoton(query, signal) {
  const params = new URLSearchParams({
    q: query,
    limit: '8',
    bbox: `${ICELAND.west},${ICELAND.south},${ICELAND.east},${ICELAND.north}`,
  });
  const res = await fetch(`${PHOTON}?${params}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const wanted = fold(query);
  const out = [];
  for (const f of json.features || []) {
    const p = f.properties || {};
    const c = f.geometry && f.geometry.coordinates;
    if (!p.name || !c || !inIceland(c[0], c[1])) continue;
    if (p.countrycode && p.countrycode !== 'IS') continue;
    if (!fold(p.name).includes(wanted)) continue; // Photon also returns loose matches
    const e = p.extent; // [west, north, east, south]
    const bbox = Array.isArray(e) && e.length === 4 ? [e[0], e[3], e[2], e[1]] : null;
    out.push({ name: p.name, kind: '', lon: c[0], lat: c[1], bbox });
  }
  return out;
}

const near = (a, b) => Math.abs(a.lat - b.lat) < 0.05 && Math.abs(a.lon - b.lon) < 0.1;

// Resolves to a merged list; rejects only when both sources fail.
export async function searchPlaces(query, signal) {
  const [names, photon] = await Promise.allSettled([searchNames(query, signal), searchPhoton(query, signal)]);
  if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
  if (names.status === 'rejected' && photon.status === 'rejected') throw names.reason;
  const out = [];
  const add = (item) => {
    if (out.some((o) => o.name.toLocaleLowerCase('is') === item.name.toLocaleLowerCase('is') && near(o, item))) return;
    out.push(item);
  };
  (names.status === 'fulfilled' ? names.value : []).slice(0, 6).forEach(add);
  (photon.status === 'fulfilled' ? photon.value : []).forEach(add);
  return out.slice(0, 9);
}
