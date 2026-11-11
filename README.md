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
| Elevation over water | Copernicus DEM GLO-30, served as tiles by [Mapterhorn](https://mapterhorn.com) | free with attribution (© DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA) |
| Geoid | EGM2008 (NGA), reduced to a 7.5′ grid in `js/geoid.js` | public domain |
| Satellite image | [Sentinel-2 cloudless 2016](https://s2maps.eu) by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016) | CC BY 4.0 |
| Map | OpenStreetMap standard tiles | ODbL |
| Place names | IS 50V from Náttúrufræðistofnun (WFS); Photon search of OpenStreetMap data | open, attribution |

None of the services needs a key or a login.

ArcticDEM gives the terrain, down to about 4 m between points. Its heights in the AWS tiles are above the WGS84 ellipsoid, 60–68 m higher than sea level in Iceland, so the geoid height is subtracted per point. Parts of those tiles are filled from other data in a different height system, and ArcticDEM is noisy over water. Copernicus GLO-30 is coarser and rounds off steep summits, but it is in one height system, with lakes level and the sea at 0 m. `js/merge.js` compares the two and uses Copernicus on water and where ArcticDEM sits far below it over a solid area.

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

runs the geometry checks in Node: the solid is closed and consistently wound for several grid sizes, contour layers are closed and shrink with height, sheets pack without overlap, the geoid grid matches EGM2008 reference values, and the merge of the two elevation sources levels lakes and sea and replaces faulty patches.

## Layout

- `js/app.js` state, controls and export
- `js/dem.js`, `js/merge.js`, `js/geoid.js` elevation tiles, combining the two sources, height correction
- `js/imagery.js` satellite drape
- `js/model.js` solid mesh and STL writer
- `js/contours.js` contour tracing, layer labels, sheet layout, SVG writer
- `js/viewer.js` three.js view
- `js/map.js`, `js/search.js`, `js/towns.js` map, rectangle and place search
- `js/i18n.js` all interface text in both languages
- `tools/` scripts that regenerate `js/geoid.js` and `js/towns.js`
- `vendor/` three.js (MIT), Leaflet (BSD-2-Clause), IBM Plex (OFL 1.1), Lucide icons (ISC), each with its licence file
