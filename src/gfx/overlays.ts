import type * as maplibregl from 'maplibre-gl';
import type { GameState, Level, LngLat } from '../game/types';
import { cellPolygon } from '../game/graph';

type FC = GeoJSON.FeatureCollection;
const EMPTY: FC = { type: 'FeatureCollection', features: [] };
const TRACK_TTL = 40;
const M_LAT = 111320;

const zoomW = (m: number) => [
  'interpolate', ['exponential', 2], ['zoom'],
  14, (m * 2 ** 14) / 48215, 20, (m * 2 ** 20) / 48215,
] as unknown as number;

export function createOverlays(map: maplibregl.Map, level: Level): { update(state: GameState, occupied: Set<number>): void } {
  const layers = map.getStyle().layers ?? [];
  const beforeId = layers.find((l) => l.type === 'fill-extrusion')?.id;
  const add = (l: maplibregl.LayerSpecification) => map.addLayer(l, beforeId);
  const line = (id: string, src: string, paint: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    add({ id, type: 'line', source: src, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint, ...extra } as maplibregl.LayerSpecification);
  const src = (id: string, data: FC, opts: Record<string, unknown> = {}) =>
    map.addSource(id, { type: 'geojson', data, ...opts } as maplibregl.GeoJSONSourceSpecification);
  const setData = (id: string, data: FC) => (map.getSource(id) as maplibregl.GeoJSONSource).setData(data);

  const lat0 = level.goal.pos[1];
  const kLng = M_LAT * Math.cos((lat0 * Math.PI) / 180);

  // Maska: wszystko poza Starówką przyciemnione.
  const c = level.goal.pos;
  const box: LngLat[] = [[c[0] - 0.2, c[1] - 0.12], [c[0] + 0.2, c[1] - 0.12], [c[0] + 0.2, c[1] + 0.12], [c[0] - 0.2, c[1] + 0.12], [c[0] - 0.2, c[1] - 0.12]];
  src('ov-mask', { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [box, level.polygon] } }] });
  add({ id: 'ov-mask', type: 'fill', source: 'ov-mask', paint: { 'fill-color': 'rgb(30,20,10)', 'fill-opacity': 0.55 } });

  src('ov-wall', { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: level.polygon } }] });
  line('ov-wall-casing', 'ov-wall', { 'line-color': '#2a1c10', 'line-width': 9 });
  line('ov-wall-line', 'ov-wall', { 'line-color': '#8a7a66', 'line-width': 5 });

  const streets: FC = {
    type: 'FeatureCollection',
    features: level.edges.map(([a, b], i) => ({
      type: 'Feature', id: i, properties: {}, geometry: { type: 'LineString', coordinates: [level.nodes[a], level.nodes[b]] },
    })),
  };
  src('ov-streets', streets);
  line('ov-streets-casing', 'ov-streets', { 'line-color': '#3a2815', 'line-width': zoomW(6) });
  line('ov-streets-inner', 'ov-streets', { 'line-color': '#c9b48a', 'line-width': zoomW(4.4) });
  line('ov-streets-dash', 'ov-streets', { 'line-color': '#a8926a', 'line-width': zoomW(0.9), 'line-dasharray': [1, 3], 'line-opacity': 0.8 });
  // Podświetlenie krawędzi pod kursorem (tryb muru): na wierzchu, szeroka linia z ciemnym obrysem.
  for (const [id, color, w] of [['ov-wall-hint-casing', '#2a1000', 11], ['ov-wall-hint', '#ffe14a', 7.5]] as const) {
    map.addLayer({
      id, type: 'line', source: 'ov-streets', filter: ['==', ['id'], -1],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': zoomW(w), 'line-opacity': 0.95 },
    } as maplibregl.LayerSpecification);
  }

  src('ov-tracks', EMPTY);
  line('ov-tracks', 'ov-tracks', { 'line-color': '#3b2512', 'line-width': zoomW(1.4), 'line-dasharray': [0.3, 2.2], 'line-opacity': ['get', 'a'] });

  // Pola budowy: sześciokąty, status przez feature-state (s: 1 zajęte, 2 hover ok, 3 hover zły).
  src('ov-cells', {
    type: 'FeatureCollection',
    features: level.cells.centers.map((_, i) => {
      const ring = cellPolygon(level, i, 0.94);
      return { type: 'Feature', id: i, properties: {}, geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] } };
    }),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const st: any = ['feature-state', 's'];
  add({
    id: 'ov-cells-fill', type: 'fill', source: 'ov-cells', layout: { visibility: 'none' },
    paint: {
      'fill-color': ['case', ['==', st, 1], 'rgba(200,70,50,0.35)', ['==', st, 2], 'rgba(255,230,60,0.7)', ['==', st, 3], 'rgba(230,40,40,0.7)', 'rgba(90,200,90,0.35)'],
    },
  });
  add({
    id: 'ov-cells-line', type: 'line', source: 'ov-cells', layout: { visibility: 'none' },
    paint: {
      'line-color': ['case', ['==', st, 1], 'rgba(220,90,70,0.6)', ['==', st, 2], '#fff070', ['==', st, 3], '#ff5050', 'rgba(120,230,120,0.7)'],
      'line-width': 1,
    },
  });

  // Wejścia: kropka + czerwona strzałka-kikut w głąb.
  const stubs: FC = { type: 'FeatureCollection', features: [] };
  const pts: FC = { type: 'FeatureCollection', features: [] };
  for (const en of level.entrances) {
    pts.features.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: en.pos } });
    const goal = level.goal.pos;
    let best: LngLat | null = null, bd = Infinity;
    for (const { to } of level.adj[en.node] ?? []) {
      const p = level.nodes[to];
      const d = Math.hypot((p[0] - goal[0]) * kLng, (p[1] - goal[1]) * M_LAT);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) {
      const n = level.nodes[en.node];
      const len = Math.hypot((best[0] - n[0]) * kLng, (best[1] - n[1]) * M_LAT) || 1;
      const t = Math.min(1, 14 / len);
      stubs.features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [n, [n[0] + (best[0] - n[0]) * t, n[1] + (best[1] - n[1]) * t]] } });
    }
  }
  src('ov-stubs', stubs);
  line('ov-stubs', 'ov-stubs', { 'line-color': '#d02a20', 'line-width': zoomW(2.6), 'line-opacity': 0.9 });
  src('ov-entr', pts);
  add({ id: 'ov-entr', type: 'circle', source: 'ov-entr', paint: { 'circle-color': '#d02a20', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 4, 19, 14], 'circle-stroke-color': '#3a0a06', 'circle-stroke-width': 2, 'circle-pitch-alignment': 'map' } });

  src('ov-goal', { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: level.goal.pos } }] });
  add({ id: 'ov-goal', type: 'circle', source: 'ov-goal', paint: { 'circle-color': '#ffd24a', 'circle-opacity': 0.55, 'circle-blur': 0.8, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 14, 19, 70], 'circle-pitch-alignment': 'map' } });

  // Stan poprzedni — setData / setFeatureState tylko przy zmianie.
  let lastWallEdge = -2, lastWallValid = true;
  let lastShow = false, lastWall = false, lastHover = -1, lastHoverValid = false, lastOcc = '';
  let applied = new Map<number, number>();
  let lastTrack = -1e9, hadTracks = false;

  return {
    update(state, occupied) {
      const showCells = state.selectedBuild !== null && state.selectedBuild !== 'wall';
      if (showCells !== lastShow) {
        lastShow = showCells;
        const v = showCells ? 'visible' : 'none';
        map.setLayoutProperty('ov-cells-fill', 'visibility', v);
        map.setLayoutProperty('ov-cells-line', 'visibility', v);
      }
      const wall = state.selectedBuild === 'wall';
      const he = wall ? state.hoverEdge : -1;
      if (he !== lastWallEdge) {
        lastWallEdge = he;
        map.setFilter('ov-wall-hint', ['==', ['id'], he]);
        map.setFilter('ov-wall-hint-casing', ['==', ['id'], he]);
      }
      if (wall !== lastWall) {
        lastWall = wall;
        map.setPaintProperty('ov-wall-hint', 'line-color', '#ffe14a');
      }
      if (wall && state.hoverValid !== lastWallValid) {
        lastWallValid = state.hoverValid;
        map.setPaintProperty('ov-wall-hint', 'line-color', state.hoverValid ? '#ffe14a' : '#ff3b2a');
      }
      if (showCells) {
        const occ = [...occupied].join(',');
        if (occ !== lastOcc || state.hoverCell !== lastHover || state.hoverValid !== lastHoverValid) {
          lastOcc = occ; lastHover = state.hoverCell; lastHoverValid = state.hoverValid;
          const next = new Map<number, number>();
          for (const i of occupied) next.set(i, 1);
          if (state.hoverCell >= 0) next.set(state.hoverCell, state.hoverValid ? 2 : 3);
          for (const [i, s] of next) if (applied.get(i) !== s) map.setFeatureState({ source: 'ov-cells', id: i }, { s });
          for (const i of applied.keys()) if (!next.has(i)) map.setFeatureState({ source: 'ov-cells', id: i }, { s: 0 });
          applied = next;
        }
      }

      if (state.time - lastTrack >= 0.33 || state.time < lastTrack) {
        lastTrack = state.time;
        const features: GeoJSON.Feature[] = [];
        for (const [edge, t] of state.tracks) {
          const age = state.time - t;
          if (age >= TRACK_TTL) continue;
          const e = level.edges[edge];
          if (!e) continue;
          features.push({ type: 'Feature', properties: { a: 1 - age / TRACK_TTL }, geometry: { type: 'LineString', coordinates: [level.nodes[e[0]], level.nodes[e[1]]] } });
        }
        if (features.length || hadTracks) {
          hadTracks = features.length > 0;
          setData('ov-tracks', { type: 'FeatureCollection', features });
        }
      }
    },
  };
}
