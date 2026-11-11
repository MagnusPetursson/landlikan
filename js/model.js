// Solid terrain block: height grid on top, vertical walls, flat underside.
// Units are millimetres; X east, Y north, Z up, underside at Z = 0.

// Triangle and vertex budget for a grid.
export function solidCounts(nx, ny) {
  const ring = 2 * (nx + ny) - 4;
  return {
    vertices: nx * ny + ring + 1,
    triangles: 2 * (nx - 1) * (ny - 1) + 3 * ring,
    topTriangles: 2 * (nx - 1) * (ny - 1),
  };
}

// Index buffer and static layout. Depends only on the grid size and the heights
// used to pick each cell's diagonal.
export function buildTopology(grid) {
  const { nx, ny, data } = grid;
  const counts = solidCounts(nx, ny);
  const index = new Uint32Array(counts.triangles * 3);
  let o = 0;
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i; // north-west
      const b = a + 1; // north-east
      const c = a + nx; // south-west
      const d = c + 1; // south-east
      // Split along the flatter diagonal; it follows ridges and valleys better.
      if (Math.abs(data[a] - data[d]) <= Math.abs(data[b] - data[c])) {
        index[o++] = a; index[o++] = c; index[o++] = d;
        index[o++] = a; index[o++] = d; index[o++] = b;
      } else {
        index[o++] = a; index[o++] = c; index[o++] = b;
        index[o++] = b; index[o++] = c; index[o++] = d;
      }
    }
  }
  const topIndexCount = o;

  // Perimeter, counter-clockwise seen from above: south edge west->east,
  // east edge south->north, north edge east->west, west edge north->south.
  const ring = [];
  for (let i = 0; i < nx - 1; i++) ring.push((ny - 1) * nx + i);
  for (let j = ny - 1; j > 0; j--) ring.push(j * nx + nx - 1);
  for (let i = nx - 1; i > 0; i--) ring.push(i);
  for (let j = 0; j < ny - 1; j++) ring.push(j * nx);
  const n = ring.length;
  const base = nx * ny;
  const centre = base + n;
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n;
    const at = ring[k];
    const bt = ring[k2];
    const ab = base + k;
    const bb = base + k2;
    index[o++] = at; index[o++] = ab; index[o++] = bb;
    index[o++] = at; index[o++] = bb; index[o++] = bt;
    index[o++] = centre; index[o++] = bb; index[o++] = ab;
  }
  return { index, topIndexCount, ring, counts };
}

// Fill vertex positions for the current size settings.
//   heightAt(i): model height in mm above the lowest terrain point for grid node i.
export function fillPositions(positions, grid, topo, { widthMm, depthMm, baseMm }, heightAt) {
  const { nx, ny } = grid;
  const dx = widthMm / (nx - 1);
  const dy = depthMm / (ny - 1);
  let zMax = 0;
  for (let j = 0; j < ny; j++) {
    const y = depthMm - j * dy;
    for (let i = 0; i < nx; i++) {
      const v = j * nx + i;
      const z = baseMm + heightAt(v);
      positions[v * 3] = i * dx;
      positions[v * 3 + 1] = y;
      positions[v * 3 + 2] = z;
      if (z > zMax) zMax = z;
    }
  }
  const base = nx * ny;
  const { ring } = topo;
  for (let k = 0; k < ring.length; k++) {
    const t = ring[k] * 3;
    const b = (base + k) * 3;
    positions[b] = positions[t];
    positions[b + 1] = positions[t + 1];
    positions[b + 2] = 0;
  }
  const c = (base + ring.length) * 3;
  positions[c] = widthMm / 2;
  positions[c + 1] = depthMm / 2;
  positions[c + 2] = 0;
  return zMax;
}

// Enclosed volume in mm³ (divergence theorem). Positive for outward-facing triangles.
export function meshVolume(positions, index) {
  let v = 0;
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3;
    const b = index[t + 1] * 3;
    const c = index[t + 2] * 3;
    v += positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1])
      - positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c])
      + positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c]);
  }
  return v / 6;
}

export const stlByteLength = (triangles) => 84 + triangles * 50;

// Binary STL.
export function writeStl(positions, index, title = '') {
  const count = index.length / 3;
  const buffer = new ArrayBuffer(stlByteLength(count));
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const head = String(title).replace(/[^\x20-\x7e]/g, '').slice(0, 79);
  for (let i = 0; i < head.length; i++) bytes[i] = head.charCodeAt(i);
  view.setUint32(80, count, true);
  let o = 84;
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3;
    const b = index[t + 1] * 3;
    const c = index[t + 2] * 3;
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    const ux = positions[b] - ax, uy = positions[b + 1] - ay, uz = positions[b + 2] - az;
    const vx = positions[c] - ax, vy = positions[c + 1] - ay, vz = positions[c + 2] - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    view.setFloat32(o, nx, true); view.setFloat32(o + 4, ny, true); view.setFloat32(o + 8, nz, true);
    view.setFloat32(o + 12, ax, true); view.setFloat32(o + 16, ay, true); view.setFloat32(o + 20, az, true);
    view.setFloat32(o + 24, positions[b], true); view.setFloat32(o + 28, positions[b + 1], true); view.setFloat32(o + 32, positions[b + 2], true);
    view.setFloat32(o + 36, positions[c], true); view.setFloat32(o + 40, positions[c + 1], true); view.setFloat32(o + 44, positions[c + 2], true);
    o += 50; // two attribute bytes stay zero
  }
  return buffer;
}
