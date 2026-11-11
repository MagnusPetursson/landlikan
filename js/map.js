// Map: base layers, rectangle drawing and editing. Leaflet is loaded as a global.

import { ICELAND, clampBounds, lonToX, latToY, xToLon, yToLat } from './geo.js';
import { IMAGERY_URL } from './imagery.js';

const L = window.L;
const MIN_PIXELS = 10;

const toLeaflet = (b) => L.latLngBounds([b.south, b.west], [b.north, b.east]);
const fromLatLngs = (a, b) => clampBounds({ west: a.lng, east: b.lng, south: a.lat, north: b.lat });

export function createMap(el, { onBounds, onDraft, onDrawState }) {
  const limits = L.latLngBounds([ICELAND.south - 1.2, ICELAND.west - 3], [ICELAND.north + 1.2, ICELAND.east + 3]);
  const map = L.map(el, {
    zoomControl: false,
    minZoom: 5,
    maxZoom: 16,
    maxBounds: limits,
    maxBoundsViscosity: 0.9,
    worldCopyJump: false,
  });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');

  const layers = {
    map: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 16,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }),
    satellite: L.tileLayer(IMAGERY_URL, {
      maxZoom: 16,
      maxNativeZoom: 14,
      attribution: '<a href="https://s2maps.eu">Sentinel-2 cloudless 2016</a> by EOX (CC BY 4.0)',
    }),
  };
  let base = null;
  const setBase = (name) => {
    if (base) map.removeLayer(base);
    base = layers[name] || layers.map;
    base.addTo(map);
    el.dataset.base = layers[name] ? name : 'map';
  };
  setBase('map');
  map.fitBounds([[ICELAND.south + 0.3, ICELAND.west + 0.6], [ICELAND.north - 0.3, ICELAND.east - 0.6]]);

  let bounds = null;
  let rect = null;
  let handles = [];
  let marker = null;
  let drawing = false;

  const style = { color: 'var(--accent)', weight: 2, fillColor: 'var(--accent)', fillOpacity: 0.07, className: 'selection' };

  function placeHandles() {
    if (!bounds) return;
    const corners = [[bounds.north, bounds.west], [bounds.north, bounds.east], [bounds.south, bounds.east], [bounds.south, bounds.west]];
    corners.forEach((c, i) => handles[i] && handles[i].setLatLng(c));
  }

  function show(b) {
    bounds = b;
    if (!rect) {
      rect = L.rectangle(toLeaflet(b), style).addTo(map);
      rect.on('mousedown', startMove);
      const icon = L.divIcon({ className: 'handle', iconSize: [14, 14] });
      handles = [0, 1, 2, 3].map((i) => {
        const h = L.marker([0, 0], { icon, draggable: true, keyboard: false, zIndexOffset: 500 }).addTo(map);
        h.on('drag', () => {
          const opposite = handles[(i + 2) % 4].getLatLng();
          const next = fromLatLngs(h.getLatLng(), opposite);
          rect.setBounds(toLeaflet(next));
          bounds = next;
          // Corners run NW, NE, SE, SW. Each neighbour shares one coordinate with
          // the dragged corner and one with the fixed opposite corner.
          const here = h.getLatLng();
          const a = [here.lat, opposite.lng];
          const b = [opposite.lat, here.lng];
          handles[(i + 1) % 4].setLatLng(i % 2 === 0 ? a : b);
          handles[(i + 3) % 4].setLatLng(i % 2 === 0 ? b : a);
          onDraft && onDraft(next);
        });
        h.on('dragend', () => commit(bounds));
        return h;
      });
    } else {
      rect.setBounds(toLeaflet(b));
    }
    placeHandles();
  }

  function commit(b) {
    const next = clampBounds(b);
    show(next);
    onBounds && onBounds(next);
  }

  // Move the whole rectangle. Shifting in Mercator metres keeps its shape.
  function startMove(e) {
    if (drawing) return;
    L.DomEvent.stop(e);
    map.dragging.disable();
    const start = e.latlng;
    const origin = { ...bounds };
    let moved = false;
    const move = (ev) => {
      moved = true;
      let dx = lonToX(ev.latlng.lng) - lonToX(start.lng);
      let dy = latToY(ev.latlng.lat) - latToY(start.lat);
      dx = Math.max(lonToX(ICELAND.west) - lonToX(origin.west), Math.min(lonToX(ICELAND.east) - lonToX(origin.east), dx));
      dy = Math.max(latToY(ICELAND.south) - latToY(origin.south), Math.min(latToY(ICELAND.north) - latToY(origin.north), dy));
      // Keep the size on the ground: the Mercator extent grows towards the north.
      const cx = (lonToX(origin.west) + lonToX(origin.east)) / 2 + dx;
      const cy0 = (latToY(origin.south) + latToY(origin.north)) / 2;
      const cy = cy0 + dy;
      const f = Math.cos((yToLat(cy0) * Math.PI) / 180) / Math.cos((yToLat(cy) * Math.PI) / 180);
      const hw = ((lonToX(origin.east) - lonToX(origin.west)) / 2) * f;
      const hh = ((latToY(origin.north) - latToY(origin.south)) / 2) * f;
      const next = clampBounds({ west: xToLon(cx - hw), east: xToLon(cx + hw), south: yToLat(cy - hh), north: yToLat(cy + hh) });
      rect.setBounds(toLeaflet(next));
      bounds = next;
      placeHandles();
      onDraft && onDraft(next);
    };
    const up = () => {
      map.off('mousemove', move);
      document.removeEventListener('mouseup', up);
      map.dragging.enable();
      if (moved) commit(bounds);
    };
    map.on('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  // Drawing a new rectangle.
  let draft = null;
  let anchor = null;
  const container = map.getContainer();

  function setDrawing(on) {
    drawing = on;
    container.classList.toggle('drawing', on);
    if (on) map.dragging.disable(); else map.dragging.enable();
    if (!on && draft) { map.removeLayer(draft); draft = null; }
    anchor = null;
    onDrawState && onDrawState(on);
  }

  container.addEventListener('pointerdown', (e) => {
    if (!drawing || e.button !== 0) return;
    if (e.target.closest('.leaflet-control')) return;
    e.preventDefault();
    e.stopPropagation();
    anchor = { latlng: map.mouseEventToLatLng(e), x: e.clientX, y: e.clientY };
    container.setPointerCapture(e.pointerId);
  }, true);
  container.addEventListener('pointermove', (e) => {
    if (!drawing || !anchor) return;
    const next = fromLatLngs(anchor.latlng, map.mouseEventToLatLng(e));
    if (!draft) draft = L.rectangle(toLeaflet(next), { ...style, dashArray: '6 4', interactive: false }).addTo(map);
    else draft.setBounds(toLeaflet(next));
    onDraft && onDraft(next);
  }, true);
  container.addEventListener('pointerup', (e) => {
    if (!drawing || !anchor) return;
    const big = Math.abs(e.clientX - anchor.x) >= MIN_PIXELS && Math.abs(e.clientY - anchor.y) >= MIN_PIXELS;
    const next = fromLatLngs(anchor.latlng, map.mouseEventToLatLng(e));
    if (container.hasPointerCapture(e.pointerId)) container.releasePointerCapture(e.pointerId);
    if (!big || next.east - next.west < 1e-4 || next.north - next.south < 1e-4) {
      // Too small to be a rectangle: stay in drawing mode for another try.
      if (draft) { map.removeLayer(draft); draft = null; }
      anchor = null;
      onDraft && onDraft(bounds);
      return;
    }
    setDrawing(false);
    commit(next);
  }, true);

  return {
    map,
    setBase,
    setBounds(b, { fit = false } = {}) {
      show(b);
      if (fit) map.fitBounds(toLeaflet(b), { padding: [60, 60], maxZoom: 13 });
    },
    startDraw: () => setDrawing(true),
    cancelDraw: () => { setDrawing(false); onDraft && onDraft(bounds); },
    isDrawing: () => drawing,
    goTo(place) {
      if (marker) { map.removeLayer(marker); marker = null; }
      marker = L.marker([place.lat, place.lon], {
        icon: L.divIcon({ className: 'place-pin', iconSize: [12, 12] }),
        interactive: false,
        keyboard: false,
      }).addTo(map);
      marker.bindTooltip(place.name, { permanent: true, direction: 'top', offset: [0, -8], className: 'place-label' }).openTooltip();
      if (place.bbox) {
        map.fitBounds([[place.bbox[1], place.bbox[0]], [place.bbox[3], place.bbox[2]]], { padding: [80, 80], maxZoom: 13 });
      } else {
        map.setView([place.lat, place.lon], 12);
      }
    },
    clearPlace() {
      if (marker) { map.removeLayer(marker); marker = null; }
    },
    invalidate: () => map.invalidateSize(),
  };
}
