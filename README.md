# Landlíkan

Select an area of Iceland on a map and turn it into a physical model: a watertight STL for 3D printing, or stacked contour layers as SVG for laser cutting. Everything runs in the browser. The interface is in Icelandic and English.

## What it does

- Search for a place by name (Icelandic place names from IS 50V, plus OpenStreetMap), or pan the map.
- Draw a rectangle. Drag its corners to resize it, drag inside it to move it.
- See the terrain in 3D with the satellite image draped over it. Change the sun direction, or switch to a plain surface.
- Set the model width in mm, the vertical exaggeration and the resolution.
- **3D printing:** set the base thickness and export a binary STL in millimetres. The mesh is a closed solid with a flat underside.
- **Laser cutting:** set the material thickness and sheet size. Each layer is a contour slice one material thickness high. Layers are laid out on sheets in stacking order; red lines are cuts, blue lines are scores showing where the next layer sits and the layer number. One sheet exports as SVG, several as a ZIP of SVGs.
- The address bar holds the area and settings, so a link reopens the same model.

## Data

| | Source | Licence |
|---|---|---|
| Elevation | [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen) on AWS Open Data; ArcticDEM in Iceland | open, attribution |
| Geoid | EGM2008 (NGA), reduced to a 7.5′ grid in `js/geoid.js` | public domain |
| Satellite image | [Sentinel-2 cloudless 2016](https://s2maps.eu) by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016) | CC BY 4.0 |
| Map | OpenStreetMap standard tiles | ODbL |
| Place names | IS 50V from Náttúrufræðistofnun (WFS); Photon search of OpenStreetMap data | open, attribution |

None of the services needs a key or a login. The elevation tiles hold ArcticDEM heights above the WGS84 ellipsoid, which in Iceland is 60–68 m above sea level; the tool subtracts the geoid height per point and sets the sea to 0 m. Lake surfaces can be off by a few metres. The finest elevation spacing is about 4 m.

## Run it

It is a static site with no build step. Serve the folder and open it:

```sh
python3 -m http.server 8000
```

`./deploy-preview.sh <dir>` copies only the files the site needs (`index.html`, `css/`, `js/`, `vendor/`) to a web root.

## Check it

```sh
npm test
```

runs the geometry checks in Node: the solid is closed and consistently wound for several grid sizes, contour layers are closed and shrink with height, sheets pack without overlap, and the geoid grid matches EGM2008 reference values.

## Layout

- `js/app.js` state, controls and export
- `js/dem.js`, `js/geoid.js` elevation tiles and height correction
- `js/imagery.js` satellite drape
- `js/model.js` solid mesh and STL writer
- `js/contours.js` contour tracing, layer labels, sheet layout, SVG writer
- `js/viewer.js` three.js view
- `js/map.js`, `js/search.js`, `js/towns.js` map, rectangle and place search
- `js/i18n.js` all interface text in both languages
- `tools/` scripts that regenerate `js/geoid.js` and `js/towns.js`
- `vendor/` three.js (MIT), Leaflet (BSD-2-Clause), IBM Plex (OFL 1.1), Lucide icons (ISC), each with its licence file
