// Web Mercator helpers. All tile sources used by the tool share this grid.

const R = 6378137;
const HALF = Math.PI * R;
export const TILE = 256;

// Selection limits: Iceland with its shelf islands.
export const ICELAND = { west: -25.2, south: 63.0, east: -12.8, north: 66.9 };

export const lonToX = (lon) => (R * lon * Math.PI) / 180;
export const latToY = (lat) => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
export const xToLon = (x) => (x / R) * (180 / Math.PI);
export const yToLat = (y) => (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI);

// Mercator metres -> global pixel coordinates at zoom z (y grows southwards).
export const xToPx = (x, z) => ((x + HALF) / (2 * HALF)) * TILE * 2 ** z;
export const yToPx = (y, z) => ((HALF - y) / (2 * HALF)) * TILE * 2 ** z;

export function clampBounds(b) {
  const west = Math.max(ICELAND.west, Math.min(b.west, b.east));
  const east = Math.min(ICELAND.east, Math.max(b.west, b.east));
  const south = Math.max(ICELAND.south, Math.min(b.south, b.north));
  const north = Math.min(ICELAND.north, Math.max(b.south, b.north));
  return { west, south, east, north };
}

// Geometry of a lon/lat rectangle. Mercator is conformal, so the rectangle keeps
// its shape on the ground; k is the local scale (ground metres per Mercator metre)
// at the middle latitude.
export function describeBounds(b) {
  const x0 = lonToX(b.west);
  const x1 = lonToX(b.east);
  const y0 = latToY(b.south);
  const y1 = latToY(b.north);
  const lat = yToLat((y0 + y1) / 2);
  const k = Math.cos((lat * Math.PI) / 180);
  return {
    x0, x1, y0, y1, k,
    lat,
    lon: (b.west + b.east) / 2,
    widthM: (x1 - x0) * k,
    heightM: (y1 - y0) * k,
    aspect: (y1 - y0) / (x1 - x0),
  };
}

// Pixel span of the rectangle at zoom z.
export function pixelSpan(d, z) {
  return {
    px0: xToPx(d.x0, z),
    px1: xToPx(d.x1, z),
    py0: yToPx(d.y1, z), // north edge
    py1: yToPx(d.y0, z),
  };
}

export function boundsToString(b) {
  return [b.west, b.south, b.east, b.north].map((v) => v.toFixed(5)).join(',');
}

export function boundsFromString(s) {
  const p = String(s || '').split(',').map(Number);
  if (p.length !== 4 || p.some((v) => !Number.isFinite(v))) return null;
  const b = clampBounds({ west: p[0], south: p[1], east: p[2], north: p[3] });
  if (b.east - b.west < 1e-4 || b.north - b.south < 1e-4) return null;
  return b;
}
