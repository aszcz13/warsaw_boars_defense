import type { Level, LevelFile, LngLat, RoadGraph } from './types';
import { distM, projectOnSegment } from './geo';

export async function loadLevel(url = '/data/oldtown.json'): Promise<Level> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`loadLevel: HTTP ${res.status}`);
  const f = (await res.json()) as LevelFile;
  const adj: RoadGraph['adj'] = f.nodes.map(() => []);
  f.edges.forEach(([a, b], edge) => {
    adj[a].push({ to: b, edge });
    adj[b].push({ to: a, edge });
  });
  return { ...f, adj };
}

// Siatka przestrzenna ~100 m, cache per graf.
const CELL = 0.001;
interface Grid { cells: Map<number, number[]>; minX: number; minY: number; w: number }
const gridCache = new WeakMap<RoadGraph, Grid>();

function getGrid(g: RoadGraph): Grid {
  let gr = gridCache.get(g);
  if (gr) return gr;
  let minX = Infinity, minY = Infinity, maxX = -Infinity;
  for (const [x, y] of g.nodes) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
  }
  const w = Math.floor((maxX - minX) / CELL) + 3;
  gr = { cells: new Map(), minX, minY, w };
  g.nodes.forEach(([x, y], i) => {
    const k = cellKey(gr!, x, y);
    const l = gr!.cells.get(k);
    if (l) l.push(i);
    else gr!.cells.set(k, [i]);
  });
  gridCache.set(g, gr);
  return gr;
}

const cx = (gr: Grid, x: number) => Math.floor((x - gr.minX) / CELL) + 1;
const cy = (gr: Grid, y: number) => Math.floor((y - gr.minY) / CELL) + 1;
const cellKey = (gr: Grid, x: number, y: number) => cy(gr, y) * gr.w + cx(gr, x);

/** Węzły z komórek w pierścieniu r wokół punktu (r=0: sama komórka). */
function ringNodes(gr: Grid, p: LngLat, r: number, out: number[]): void {
  const x0 = cx(gr, p[0]), y0 = cy(gr, p[1]);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const l = gr.cells.get((y0 + dy) * gr.w + x0 + dx);
      if (l) for (const i of l) out.push(i);
    }
  }
}

export function nearestNode(g: RoadGraph, p: LngLat): number {
  const gr = getGrid(g);
  let best = -1, bd = Infinity;
  const buf: number[] = [];
  for (let r = 0; r < 40; r++) {
    buf.length = 0;
    ringNodes(gr, p, r, buf);
    for (const i of buf) {
      const d = distM(p, g.nodes[i]);
      if (d < bd) { bd = d; best = i; }
    }
    // Znaleziony kandydat jest pewny, gdy kolejny pierścień jest dalej niż bd (komórka ≥ ~68 m w lng).
    if (best >= 0 && bd < r * 60) break;
  }
  if (best < 0) {
    for (let i = 0; i < g.nodes.length; i++) {
      const d = distM(p, g.nodes[i]);
      if (d < bd) { bd = d; best = i; }
    }
  }
  return best;
}

export function nearestEdge(g: RoadGraph, p: LngLat): { edge: number; point: LngLat; dist: number } {
  let best = { edge: -1, point: p, dist: Infinity };
  const { nodes, edges } = g;
  for (let e = 0; e < edges.length; e++) {
    const a = nodes[edges[e][0]], b = nodes[edges[e][1]];
    // Szybkie odrzucenie po bboxie (~0.003° ≈ 200 m od najlepszego wyniku).
    const m = best.dist === Infinity ? Infinity : best.dist / 60000 + 1e-5;
    if (
      p[0] < Math.min(a[0], b[0]) - m * 1.7 || p[0] > Math.max(a[0], b[0]) + m * 1.7 ||
      p[1] < Math.min(a[1], b[1]) - m || p[1] > Math.max(a[1], b[1]) + m
    ) continue;
    const r = projectOnSegment(p, a, b);
    if (r.dist < best.dist) best = { edge: e, point: r.point, dist: r.dist };
  }
  return best;
}

export function edgeBetween(g: RoadGraph, a: number, b: number): number {
  for (const n of g.adj[a]) if (n.to === b) return n.edge;
  return -1;
}

/** Kopiec binarny (min) na parach (priorytet, węzeł). */
class MinHeap {
  private f: number[] = [];
  private n: number[] = [];
  get size(): number { return this.f.length; }
  push(f: number, n: number): void {
    const hf = this.f, hn = this.n;
    let i = hf.length;
    hf.push(f);
    hn.push(n);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hf[p] <= f) break;
      hf[i] = hf[p]; hn[i] = hn[p];
      i = p;
    }
    hf[i] = f; hn[i] = n;
  }
  pop(): number {
    const hf = this.f, hn = this.n;
    const top = hn[0];
    const lf = hf.pop()!, ln = hn.pop()!;
    const len = hf.length;
    if (len > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= len) break;
        if (c + 1 < len && hf[c + 1] < hf[c]) c++;
        if (hf[c] >= lf) break;
        hf[i] = hf[c]; hn[i] = hn[c];
        i = c;
      }
      hf[i] = lf; hn[i] = ln;
    }
    return top;
  }
}

/** Dijkstra/A* z własnym kosztem krawędzi (koszt >= 0). hScale*distM to heurystyka (0 = czysta Dijkstra). */
export function findPathWeighted(
  g: RoadGraph,
  from: number,
  to: number,
  edgeCost: (edge: number) => number,
  hScale = 0,
): number[] | null {
  if (from === to) return [from];
  const { nodes, adj } = g;
  const N = nodes.length;
  const gs = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const target = nodes[to];
  const h = (i: number) => (hScale > 0 ? hScale * distM(nodes[i], target) : 0);
  const heap = new MinHeap();
  gs[from] = 0;
  heap.push(h(from), from);
  while (heap.size) {
    const u = heap.pop();
    if (closed[u]) continue;
    if (u === to) {
      const path = [u];
      for (let c = u; prev[c] >= 0; c = prev[c]) path.push(prev[c]);
      return path.reverse();
    }
    closed[u] = 1;
    for (const { to: v, edge } of adj[u]) {
      if (closed[v]) continue;
      const c = edgeCost(edge);
      if (!(c < Infinity)) continue;
      const ng = gs[u] + c;
      if (ng < gs[v]) {
        gs[v] = ng;
        prev[v] = u;
        heap.push(ng + h(v), v);
      }
    }
  }
  return null;
}

/** A* po długości krawędzi, heurystyka distM do celu. */
export function findPath(
  g: RoadGraph,
  from: number,
  to: number,
  opts: { blocked?: Set<number>; penalized?: Map<number, number> } = {},
): number[] | null {
  const { blocked, penalized } = opts;
  const { edges } = g;
  return findPathWeighted(
    g,
    from,
    to,
    (e) => (blocked && blocked.has(e) ? Infinity : edges[e][2] + (penalized ? penalized.get(e) ?? 0 : 0)),
    1,
  );
}

// Lookup pól hex: axial (q,r) -> indeks, cache per level.
const hexCache = new WeakMap<Level, Map<number, number>>();
const SQ3 = Math.sqrt(3);
const hexKey = (q: number, r: number) => (q + 5000) * 10007 + (r + 5000);

/** Zaokrąglenie ułamkowych współrzędnych axial do najbliższego sześciokąta. */
function hexRound(qf: number, rf: number): [number, number] {
  const xf = qf, zf = rf, yf = -xf - zf;
  let rx = Math.round(xf), ry = Math.round(yf), rz = Math.round(zf);
  const dx = Math.abs(rx - xf), dy = Math.abs(ry - yf), dz = Math.abs(rz - zf);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return [rx, rz];
}

function cellLocal(level: Level, p: LngLat): [number, number] {
  const c = level.cells;
  return [(p[0] - c.origin[0]) * c.mx, (p[1] - c.origin[1]) * c.my];
}

function getHexMap(level: Level): Map<number, number> {
  let m = hexCache.get(level);
  if (m) return m;
  m = new Map();
  const R = level.cells.radius;
  level.cells.centers.forEach((p, i) => {
    const [x, y] = cellLocal(level, p);
    const [q, r] = hexRound(((SQ3 / 3) * x - y / 3) / R, ((2 / 3) * y) / R);
    m!.set(hexKey(q, r), i);
  });
  hexCache.set(level, m);
  return m;
}

/** Indeks pola budowy (hex) pod punktem, albo -1. */
export function cellAt(level: Level, p: LngLat): number {
  const R = level.cells.radius;
  const [x, y] = cellLocal(level, p);
  const [q, r] = hexRound(((SQ3 / 3) * x - y / 3) / R, ((2 / 3) * y) / R);
  return getHexMap(level).get(hexKey(q, r)) ?? -1;
}

/** Wierzchołki (6) sześciokąta pola o danym indeksie, jako [lng,lat]; `scale` zmniejsza promień (przerwy między polami). */
export function cellPolygon(level: Level, i: number, scale = 1): LngLat[] {
  const c = level.cells;
  const [cx0, cy0] = c.centers[i];
  const out: LngLat[] = [];
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 180) * (60 * k - 30);
    out.push([cx0 + (c.radius * scale * Math.cos(a)) / c.mx, cy0 + (c.radius * scale * Math.sin(a)) / c.my]);
  }
  return out;
}

const goalCache = new WeakMap<Level, Float64Array>();

/** Odległości (m) od Syrenki do każdego węzła po grafie (Dijkstra), cache per level. */
export function distToGoal(level: Level): Float64Array {
  let d = goalCache.get(level);
  if (d) return d;
  const { nodes, adj, edges } = level;
  d = new Float64Array(nodes.length).fill(Infinity);
  const heap = new MinHeap();
  d[level.goal.node] = 0;
  heap.push(0, level.goal.node);
  while (heap.size) {
    const u = heap.pop();
    const du = d[u];
    for (const { to, edge } of adj[u]) {
      const nd = du + edges[edge][2];
      if (nd < d[to]) { d[to] = nd; heap.push(nd, to); }
    }
  }
  goalCache.set(level, d);
  return d;
}
