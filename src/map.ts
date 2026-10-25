import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { Level, LngLat, Projector } from './game/types';

// Vite przepakowuje maplibre, więc ścieżkę do workera podajemy jawnie.
maplibregl.setWorkerUrl(workerUrl);

const STYLE = 'https://tiles.openfreemap.org/styles/liberty';

function polyBounds(poly: LngLat[], padM = 0): [[number, number], [number, number]] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of poly) {
    w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y);
  }
  const dLat = padM / 111320;
  const dLng = padM / (111320 * Math.cos(((s + n) / 2) * Math.PI / 180));
  return [[w - dLng, s - dLat], [e + dLng, n + dLat]];
}

const BEARING = -15;
let fitMin: number | null = null;

type Pt = [number, number];

/**
 * Najmniejszy zoom (i środek), przy którym wszystkie punkty (wejścia + Syrenka), zrzutowane
 * przez map.project przy aktualnym pitchu i bearingu, mieszczą się w prostokącie `box` (px).
 */
function solveFit(map: maplibregl.Map, pts: Pt[], box: { l: number; t: number; r: number; b: number }): { zoom: number; center: Pt } {
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const tx = (box.l + box.r) / 2, ty = (box.t + box.b) / 2;
  const bw = box.r - box.l, bh = box.b - box.t;
  const tryZoom = (z: number): { ok: boolean; center: Pt } => {
    let center: Pt = [cx, cy];
    let ok = false;
    for (let it = 0; it < 4; it++) {
      map.jumpTo({ center, zoom: z, bearing: BEARING, pitch: PITCH });
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of pts) {
        const q = map.project(p);
        x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y);
      }
      ok = x1 - x0 <= bw && y1 - y0 <= bh;
      const dx = tx - (x0 + x1) / 2, dy = ty - (y0 + y1) / 2;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) break;
      const c = map.getContainer();
      const n = map.unproject([c.clientWidth / 2 - dx, c.clientHeight / 2 - dy]);
      center = [n.lng, n.lat];
    }
    // sprawdź po ostatnim przesunięciu
    map.jumpTo({ center, zoom: z, bearing: BEARING, pitch: PITCH });
    ok = true;
    for (const p of pts) {
      const q = map.project(p);
      if (q.x < box.l - 0.5 || q.x > box.r + 0.5 || q.y < box.t - 0.5 || q.y > box.b + 0.5) ok = false;
    }
    return { ok, center };
  };
  let lo = 10, hi = 19;
  let best = tryZoom(lo);
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    const r = tryZoom(mid);
    if (r.ok) { lo = mid; best = r; } else hi = mid;
  }
  return { zoom: lo, center: best.center };
}

/**
 * Kadruje tak, by WSZYSTKIE wejścia i Syrenka (zrzutowane przy pitchu/bearingu) mieściły się między
 * górnym paskiem a dolnym HUD-em z marginesem. minZoom = kadr, maxZoom = kadr + 3, statyczna kamera.
 */
export function fitMap(map: maplibregl.Map, level: Level): void {
  const bottomEl = document.querySelector<HTMLElement>('.hud .bottom');
  const topEl = document.querySelector<HTMLElement>('.hud .top');
  map.getContainer().style.setProperty('--hudb', `${bottomEl ? bottomEl.offsetHeight + 4 : 0}px`);
  const c = map.getContainer();
  const W = c.clientWidth, H = c.clientHeight;
  if (!W || !H) return;
  const MARGIN = 30;
  const box = {
    l: MARGIN + 20,
    r: W - MARGIN - 20,
    // wejścia mają wysokie sprite'y (bramy) rysowane nad punktem: więcej miejsca u góry
    t: (topEl ? topEl.offsetHeight : 50) + MARGIN + 25,
    b: H - (bottomEl ? bottomEl.offsetHeight + 8 : 0) - MARGIN,
  };
  const pts: Pt[] = [...level.entrances.map((e) => e.pos as Pt), level.goal.pos as Pt];
  const atMin = fitMin === null || map.getZoom() <= fitMin + 0.02;
  const prev = { center: map.getCenter(), zoom: map.getZoom() };
  map.setMaxBounds(undefined as never);
  map.setMinZoom(0);
  map.setMaxZoom(22);
  const cam = solveFit(map, pts, box);
  fitMin = cam.zoom;
  map.touchZoomRotate.disableRotation();
  map.setMaxZoom(Math.min(19.5, cam.zoom + 3));
  map.setMinZoom(cam.zoom);
  if (atMin) map.jumpTo({ center: cam.center, zoom: cam.zoom, bearing: BEARING, pitch: PITCH });
  else map.jumpTo({ center: prev.center, zoom: Math.max(cam.zoom, prev.zoom), bearing: BEARING, pitch: PITCH });
  // Duży zapas: ograniczenie nie może przesuwać kadru, gdy widok jest szerszy niż granice.
  map.setMaxBounds(polyBounds(level.polygon, 300));
}

export function createMap(container: string, level: Level): Promise<maplibregl.Map> {
  const b = polyBounds(level.polygon);
  const map = new maplibregl.Map({
    container,
    style: STYLE,
    center: [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2],
    zoom: 16,
    pitch: PITCH,
    bearing: BEARING,
    maxZoom: 19.5,
    maxPitch: 75,
    // Kamera statyczna: tylko zoom (kółko / pinch), bez przesuwania i obrotu.
    dragPan: false,
    dragRotate: false,
    keyboard: false,
    doubleClickZoom: false,
    boxZoom: false,
    touchPitch: false,
    attributionControl: { compact: true },
  });

  return new Promise((resolve) => {
    map.on('load', () => {
      try {
        medievalStyle(map);
      } catch (err) {
        console.warn('restyle failed', err);
      }
      fitMap(map, level);
      resolve(map);
    });
  });
}

const BUILDING_SCALE = 0.4;
const PITCH = 40;

function medievalStyle(map: maplibregl.Map) {
  const layers = map.getStyle().layers ?? [];
  const src = Object.keys(map.getStyle().sources)[0] ?? 'openmaptiles';
  const setP = (id: string, prop: string, v: unknown) => {
    try { map.setPaintProperty(id, prop as never, v as never); } catch { /* ignore */ }
  };
  let has3d = false;
  for (const l of layers) {
    const id = l.id;
    const lid = id.toLowerCase();
    if (l.type === 'symbol') {
      map.setLayoutProperty(id, 'visibility', 'none');
    } else if (l.type === 'background') {
      setP(id, 'background-color', '#5d5a3c');
    } else if (l.type === 'fill-extrusion') {
      has3d = true;
      setP(id, 'fill-extrusion-color', [
        'interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 10],
        0, '#c9a98a', 12, '#b9855f', 25, '#a8694b', 50, '#d2bd96', 90, '#9a8a7a',
      ]);
      setP(id, 'fill-extrusion-opacity', 0.95);
      // Makieta: niższe kamienice, żeby uliczki labiryntu były widoczne.
      setP(id, 'fill-extrusion-height', ['*', BUILDING_SCALE, ['coalesce', ['get', 'render_height'], 12]]);
      setP(id, 'fill-extrusion-base', ['*', BUILDING_SCALE, ['coalesce', ['get', 'render_min_height'], 0]]);
    } else if (l.type === 'fill') {
      if (/water/.test(lid)) setP(id, 'fill-color', '#3d4f5a');
      else if (/park|wood|forest|grass|green|garden|pitch|cemetery|natural/.test(lid)) setP(id, 'fill-color', '#56653a');
      else if (/building/.test(lid)) setP(id, 'fill-color', '#8e7458');
      else setP(id, 'fill-color', '#6a5f45');
      setP(id, 'fill-opacity', 1);
    } else if (l.type === 'line') {
      if (/water|river/.test(lid)) setP(id, 'line-color', '#3d4f5a');
      else if (/rail|transit|aeroway|boundary|ferry/.test(lid)) setP(id, 'line-opacity', 0);
      else if (/road|street|path|bridge|tunnel|highway|motorway|trunk|primary|secondary|tertiary|minor|service|link/.test(lid)) {
        setP(id, 'line-color', /casing|case/.test(lid) ? '#4a3f2e' : '#85795e');
      }
    }
  }
  if (!has3d && map.getSource(src)) {
    map.addLayer({
      id: 'buildings-3d',
      type: 'fill-extrusion',
      source: src,
      'source-layer': 'building',
      minzoom: 14,
      paint: {
        'fill-extrusion-color': [
          'interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 10],
          0, '#c9a98a', 12, '#b9855f', 25, '#a8694b', 50, '#d2bd96',
        ],
        'fill-extrusion-height': ['*', BUILDING_SCALE, ['coalesce', ['get', 'render_height'], 12]],
        'fill-extrusion-base': ['*', BUILDING_SCALE, ['coalesce', ['get', 'render_min_height'], 0]],
        'fill-extrusion-opacity': 0.95,
      },
    });
  }
}

export function createProjector(map: maplibregl.Map): Projector {
  return {
    project(p: LngLat) {
      const pt = map.project(p);
      return { x: pt.x, y: pt.y };
    },
    zoom: () => map.getZoom(),
    metersToPixels(m: number, at: LngLat) {
      const dLng = m / (111320 * Math.cos((at[1] * Math.PI) / 180));
      const a = map.project(at);
      const b = map.project([at[0] + dLng, at[1]]);
      return Math.hypot(b.x - a.x, b.y - a.y);
    },
  };
}
