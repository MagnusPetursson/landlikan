"""Build js/geoid.js: EGM2008 geoid heights over Iceland on a coarse grid.

Needs numpy and tifffile, and the 2.5 arc-minute grid from the PROJ CDN next to
this script: https://cdn.proj.org/us_nga_egm08_25.tif

    python tools/build_geoid.py 3
"""
import json
import os
import sys

import numpy as np
import tifffile

HERE = os.path.dirname(os.path.abspath(__file__))
G = tifffile.imread(os.path.join(HERE, 'us_nga_egm08_25.tif'))
step = 1 / 24
W, E, S, N = -25.5, -12.5, 62.75, 67.25
i0 = round((90 - N) / step)
i1 = round((90 - S) / step)
j0 = round((W + 180) / step)
j1 = round((E + 180) / step)
full = G[i0:i1 + 1, j0:j1 + 1].astype(float)
print('full', full.shape, full.min(), full.max())


def bilin(sub, k):
    H, Wd = full.shape
    out = np.zeros_like(full)
    for a in range(H):
        fa = a / k
        ia = min(int(fa), sub.shape[0] - 2)
        v = fa - ia
        for b in range(Wd):
            fb = b / k
            ib = min(int(fb), sub.shape[1] - 2)
            u = fb - ib
            out[a, b] = (sub[ia, ib] * (1 - u) + sub[ia, ib + 1] * u) * (1 - v) + (sub[ia + 1, ib] * (1 - u) + sub[ia + 1, ib + 1] * u) * v
    return out


for k in (2, 3, 4, 6, 12):
    if (full.shape[0] - 1) % k or (full.shape[1] - 1) % k:
        print(k, 'grid not aligned', full.shape)
        continue
    sub = np.round(full[::k, ::k] * 10) / 10
    err = bilin(sub, k) - full
    print(f'k={k} step={k * 2.5:.1f} arcmin nodes={sub.shape} n={sub.size} maxerr={np.abs(err).max():.2f} rms={err.std():.3f}')

k = int(sys.argv[1]) if len(sys.argv) > 1 else 3
vals = np.round(full[::k, ::k] * 10).astype(int)
print('chosen', k, vals.shape, vals.min(), vals.max())
rows = [' '.join(str(v) for v in r) for r in vals]
js = f"""// Geoid height (EGM2008, NGA, public domain) over Iceland, in decimetres.
// The elevation tiles hold heights above the WGS84 ellipsoid here; subtracting the
// geoid height gives height above mean sea level. Grid of {k * 2.5:g} arc-minute nodes,
// rows north to south from {N}°N, columns west to east from {abs(W)}°W.

const WEST = {W};
const NORTH = {N};
const STEP = {k} / 24;
const COLS = {vals.shape[1]};
const ROWS = {vals.shape[0]};
const DM = new Int16Array(`
{chr(10).join(rows)}
`.trim().split(/\\s+/).map(Number));

// Geoid height in metres at a point; clamped to the grid edge outside it.
export function geoidHeight(lat, lon) {{
  let fx = (lon - WEST) / STEP;
  let fy = (NORTH - lat) / STEP;
  if (fx < 0) fx = 0; else if (fx > COLS - 1) fx = COLS - 1;
  if (fy < 0) fy = 0; else if (fy > ROWS - 1) fy = ROWS - 1;
  const i = Math.min(COLS - 2, Math.floor(fx));
  const j = Math.min(ROWS - 2, Math.floor(fy));
  const u = fx - i;
  const v = fy - j;
  const o = j * COLS + i;
  return ((DM[o] * (1 - u) + DM[o + 1] * u) * (1 - v) + (DM[o + COLS] * (1 - u) + DM[o + COLS + 1] * u) * v) / 10;
}}
"""
out = os.path.join(HERE, '..', 'js', 'geoid.js')
open(out, 'w').write(js)
print(len(js), 'bytes ->', out)


def g(lat, lon):
    fi = (90 - lat) / step
    fj = (lon + 180) / step
    i = int(fi)
    j = int(fj)
    u = fj - j
    v = fi - i
    return float((G[i, j] * (1 - u) + G[i, j + 1] * u) * (1 - v) + (G[i + 1, j] * (1 - u) + G[i + 1, j + 1] * u) * v)


print(json.dumps([[la, lo, round(g(la, lo), 2)] for la, lo in [(64.1445, -21.9415), (65.6, -17.0), (64.0142, -16.6767), (66.07, -23.12), (63.43, -20.28), (65.15, -14.68), (64.62, -19.85)]]))
