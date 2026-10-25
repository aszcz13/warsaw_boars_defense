// Generuje public/data/oldtown.json: uliczki Starego Miasta (OSM/Overpass), wejścia, Syrenkę i pola budowy.
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const UA = 'warsaw-boars-defense/0.2 (level generator)';

// Obrys Starówki [lng,lat], zgodnie z ruchem wskazówek zegara od Barbakanu.
// Wyprowadzony z danych OSM: mury (historic=citywalls / barrier=city_wall, bbox 52.2455,21.0060,52.2535,21.0185)
// i ulic dookoła; biegnie tuż NA ZEWNĄTRZ murów (Podwale jest już poza), skarpą nad Wisłą (Brzozowa, Gnojna Góra)
// i przez Plac Zamkowy (włącznie z początkiem Świętojańskiej). Ok. 350 x 390 m.
const POLYGON = [
  [21.01128, 52.25131], [21.01174, 52.25121], [21.01217, 52.25096], [21.01291, 52.25055], [21.01364, 52.25012],
  [21.01416, 52.24977], [21.0145, 52.24943], [21.01456, 52.24898], [21.01453, 52.24861], [21.01437, 52.24831],
  [21.01404, 52.24808], [21.01382, 52.24782], [21.01339, 52.24765], [21.01312, 52.24752], [21.01205, 52.24788],
  [21.01092, 52.24821], [21.01052, 52.24842], [21.00975, 52.249], [21.00948, 52.24921], [21.00941, 52.24958],
  [21.00951, 52.24984], [21.00975, 52.2501], [21.01003, 52.25052], [21.0103, 52.25083], [21.01055, 52.25108],
  [21.01092, 52.25122],
];
const GOAL_FALLBACK = [21.01222, 52.24966];
const HIGHWAYS = 'footway|pedestrian|living_street|residential|service|steps|path|unclassified|tertiary|cycleway';
const HW_RANK = { tertiary: 5, unclassified: 4, residential: 4, living_street: 3, pedestrian: 3, service: 2, cycleway: 2, footway: 1, path: 1, steps: 1 };

const MIN_D = 4, MAX_D = 10;

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
function dist(a, b) {
  const dLat = rad(b[1] - a[1]), dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Odpowiedzi są cache'owane w katalogu tymczasowym (powtarzalność; `--refresh` pobiera od nowa).
async function overpass(query) {
  const cache = resolve(tmpdir(), 'oldtown-' + createHash('sha1').update(query).digest('hex').slice(0, 12) + '.json');
  if (!process.argv.includes('--refresh') && existsSync(cache)) {
    console.log('cache:', cache);
    return JSON.parse(readFileSync(cache, 'utf8'));
  }
  const j = await overpassFetch(query);
  writeFileSync(cache, JSON.stringify(j));
  return j;
}
// Mirrory różnią się świeżością danych (kumi bywa kilka miesięcy w tyle): odpowiedź starsza niż 14 dni jest tylko zapasową.
async function overpassFetch(query) {
  let stale = null;
  for (let round = 0; round < 3; round++) {
    for (const url of ENDPOINTS) {
      try {
        console.log('POST', url);
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
          body: 'data=' + encodeURIComponent(query),
        });
        if (!res.ok) { console.log('  HTTP', res.status); continue; }
        const j = await res.json();
        const ts = j.osm3s?.timestamp_osm_base;
        console.log('  OK, elementów:', j.elements?.length, ts);
        if (!ts || Date.now() - Date.parse(ts) < 14 * 864e5) return j;
        stale ??= j;
      } catch (e) {
        console.log('  błąd:', e.message);
      }
    }
    if (stale && round >= 1) return stale;
    await sleep(3000 * (round + 1));
  }
  if (stale) return stale;
  throw new Error('Overpass niedostępny');
}

function inPoly(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

const lngs = POLYGON.map((p) => p[0]), lats = POLYGON.map((p) => p[1]);
const PAD = 0.0006;
const [w, s, e, n] = [Math.min(...lngs) - PAD, Math.min(...lats) - PAD, Math.max(...lngs) + PAD, Math.max(...lats) + PAD];
const bbox = `${s},${w},${n},${e}`;
const lat0 = (s + n) / 2;
const MX = 111320 * Math.cos(rad(lat0)), MY = 111320;
const toXY = (p) => [(p[0] - w) * MX, (p[1] - s) * MY];

// --- ulice ---
const q = `[out:json][timeout:90];
way["highway"~"^(${HIGHWAYS})$"]["area"!="yes"]["access"!~"^(private|no)$"]["indoor"!="yes"]["tunnel"!~"^(yes|culvert)$"](${bbox});
out body; >; out skel qt;`;
const data = await overpass(q);
const osmNode = new Map();
for (const el of data.elements) if (el.type === 'node') osmNode.set(el.id, [el.lon, el.lat]);

const ids = new Map(); // osm node id -> idx
const nodes = [];
const idx = (id) => {
  let i = ids.get(id);
  if (i === undefined) { i = nodes.length; ids.set(id, i); nodes.push(osmNode.get(id)); }
  return i;
};
let edges = []; // {a,b,len,name,rank}
const seen = new Set();
for (const el of data.elements) {
  if (el.type !== 'way' || !el.tags) continue;
  const t = el.tags;
  if (t.footway === 'sidewalk' || t.footway === 'crossing' || t.footway === 'traffic_island') continue;
  if (t.area === 'yes') continue;
  if (el.nodes[0] === el.nodes[el.nodes.length - 1] && t.area === 'yes') continue;
  const rank = HW_RANK[t.highway] ?? 1;
  for (let i = 1; i < el.nodes.length; i++) {
    const A = osmNode.get(el.nodes[i - 1]), B = osmNode.get(el.nodes[i]);
    if (!A || !B || el.nodes[i - 1] === el.nodes[i]) continue;
    const a = idx(el.nodes[i - 1]), b = idx(el.nodes[i]);
    const key = a < b ? a * 1e7 + b : b * 1e7 + a;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ a, b, len: dist(A, B), name: t.name || null, rank });
  }
}
console.log('surowe: węzły', nodes.length, 'krawędzie', edges.length);

// --- przycięcie do obrysu ---
const inside = nodes.map((p) => inPoly(p, POLYGON));
edges = edges.filter((E) => {
  const mid = [(nodes[E.a][0] + nodes[E.b][0]) / 2, (nodes[E.a][1] + nodes[E.b][1]) / 2];
  return inPoly(mid, POLYGON) || inside[E.a] || inside[E.b];
});
// odrzuć krawędzie całkowicie na zewnątrz (oba końce poza, środek poza) - już zrobione; zostaje: co najmniej jedno wewnątrz lub środek.

// --- największa składowa spójna ---
function components(edgeList, N) {
  const adj = Array.from({ length: N }, () => []);
  for (const E of edgeList) { adj[E.a].push(E.b); adj[E.b].push(E.a); }
  const comp = new Int32Array(N).fill(-1);
  const sizes = [];
  for (let i = 0; i < N; i++) {
    if (comp[i] >= 0 || !adj[i].length) continue;
    const c = sizes.length;
    let cnt = 0;
    const st = [i];
    comp[i] = c;
    while (st.length) {
      const u = st.pop();
      cnt++;
      for (const v of adj[u]) if (comp[v] < 0) { comp[v] = c; st.push(v); }
    }
    sizes.push(cnt);
  }
  return { comp, sizes };
}
{
  const { comp, sizes } = components(edges, nodes.length);
  const best = sizes.indexOf(Math.max(...sizes));
  edges = edges.filter((E) => comp[E.a] === best);
}
// --- Syrenka ---
let goalPos = GOAL_FALLBACK, goalName = 'Syrenka';
try {
  const gq = `[out:json][timeout:30];(node["name"~"Syren",i](52.2488,21.0108,52.2506,21.0138);way["name"~"Syren",i](52.2488,21.0108,52.2506,21.0138););out center;`;
  const g = await overpass(gq);
  const c = g.elements
    .map((el) => ({ el, p: el.type === 'node' ? [el.lon, el.lat] : [el.center.lon, el.center.lat] }))
    .filter((x) => !x.el.tags?.shop && !x.el.tags?.amenity)
    .sort((x, y) => dist(x.p, GOAL_FALLBACK) - dist(y.p, GOAL_FALLBACK))[0];
  if (c) { goalPos = c.p; goalName = c.el.tags.name; console.log('Syrenka z OSM:', goalName, goalPos); }
  else console.log('Syrenka: brak w OSM, fallback');
} catch (err) { console.log('Syrenka: fallback (' + err.message + ')'); }
// --- budynki -> pola budowy ---
const bq = `[out:json][timeout:90];(way["building"](${bbox});relation["building"](${bbox}););out geom;`;
const bdata = await overpass(bq);
const rings = [];
for (const el of bdata.elements) {
  if (el.type === 'way' && el.geometry) rings.push(el.geometry.map((g) => [g.lon, g.lat]));
  else if (el.type === 'relation')
    for (const m of el.members || [])
      if (m.role === 'outer' && m.geometry && m.geometry.length > 3) rings.push(m.geometry.map((g) => [g.lon, g.lat]));
}
const bRings = rings.map((r) => ({ r, minX: Math.min(...r.map((p) => p[0])), maxX: Math.max(...r.map((p) => p[0])), minY: Math.min(...r.map((p) => p[1])), maxY: Math.max(...r.map((p) => p[1])) }));
console.log('budynki:', bRings.length);
const inBuilding = (p) => bRings.some((b) => p[0] >= b.minX && p[0] <= b.maxX && p[1] >= b.minY && p[1] <= b.maxY && inPoly(p, b.r));

// ===== Graf w metrach: Rynek (siatka hex-dróg), planaryzacja, scalanie, podział =====
const SNAP_T = 2.5;        // węzeł bliżej niż tyle od wnętrza krawędzi = T-skrzyżowanie (krawędź jest dzielona)
const MERGE_D = 3;         // węzły bliższe niż tyle są zlewane
const MAX_EDGE = 15;       // dłuższe krawędzie są dzielone na równe odcinki

const goalXY = toXY(goalPos);
const fromXY = (x, y) => [w + x / MX, s + y / MY];
const inBuildingXY = (x, y) => inBuilding(fromXY(x, y));
const clearSeg = (A, B) => {
  for (const t of [0.15, 0.3, 0.5, 0.7, 0.85]) if (inBuildingXY(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t)) return false;
  return true;
};

const usedOld = [...new Set(edges.flatMap((E) => [E.a, E.b]))];
const mapOld = new Map(usedOld.map((o, i) => [o, i]));
let P = usedOld.map((o) => toXY(nodes[o]));
let G = edges.map((E) => ({ a: mapOld.get(E.a), b: mapOld.get(E.b), name: E.name, rank: E.rank }));

// Rynek jest placem bez uliczek w OSM: Syrenka dostaje własny węzeł połączony "szprychami" (max 6) z okolicznymi węzłami.
{
  const gi = P.length;
  P.push(goalXY.slice());
  const near = P.slice(0, gi).map((p, i) => ({ i, d: Math.hypot(p[0] - goalXY[0], p[1] - goalXY[1]), a: Math.atan2(p[1] - goalXY[1], p[0] - goalXY[0]) }))
    .filter((x) => inPoly(fromXY(...P[x.i]), POLYGON)).sort((x, y) => x.d - y.d);
  const gmin = near[0].d;
  const picked = [];
  for (const c of near) {
    if (c.d > Math.max(gmin * 1.8, 30) || picked.length >= 6) break;
    if (picked.every((q) => { const da = Math.abs(c.a - q.a); return Math.min(da, 2 * Math.PI - da) > 0.9; })) picked.push(c);
  }
  for (const c of picked) G.push({ a: gi, b: c.i, name: null, rank: 1 });
  console.log('szprychy do Syrenki:', picked.map((c) => c.d.toFixed(0) + ' m').join(', '));
}

function planarize() {
  const queue = G.map((_, i) => i);
  let splits = 0;
  const pk = (a, b) => (a < b ? a * 1e7 + b : b * 1e7 + a);
  const have = new Set(G.map((e) => pk(e.a, e.b)));
  const split = (ei, n) => {
    const e = G[ei];
    e.dead = true;
    have.delete(pk(e.a, e.b)); have.add(pk(e.a, n)); have.add(pk(n, e.b));
    G.push({ a: e.a, b: n, name: e.name, rank: e.rank }, { a: n, b: e.b, name: e.name, rank: e.rank });
    queue.push(G.length - 2, G.length - 1);
    splits++;
  };
  let guard = 0;
  while (queue.length) {
    if (++guard > 200000) throw new Error('planarize: zapętlenie');
    const ei = queue.pop();
    const e = G[ei];
    if (e.dead) continue;
    const [ax, ay] = P[e.a], [bx, by] = P[e.b];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    if (l2 < 1e-9) { e.dead = true; continue; }
    let done = false;
    for (let n = 0; n < P.length && !done; n++) {
      if (n === e.a || n === e.b) continue;
      const t = ((P[n][0] - ax) * dx + (P[n][1] - ay) * dy) / l2;
      if (t <= 0 || t >= 1 || have.has(pk(e.a, n)) || have.has(pk(n, e.b))) continue;
      if (Math.hypot(P[n][0] - ax - t * dx, P[n][1] - ay - t * dy) <= SNAP_T) { split(ei, n); done = true; }
    }
    if (done) continue;
    for (let fi = 0; fi < G.length && !done; fi++) {
      const f = G[fi];
      if (f.dead || fi === ei || f.a === e.a || f.a === e.b || f.b === e.a || f.b === e.b) continue;
      const [cx, cy] = P[f.a], [ex, ey] = P[f.b];
      const fx = ex - cx, fy = ey - cy;
      const den = dx * fy - dy * fx;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((cx - ax) * fy - (cy - ay) * fx) / den;
      const u = ((cx - ax) * dy - (cy - ay) * dx) / den;
      if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) continue;
      const X = P.length;
      P.push([ax + t * dx, ay + t * dy]);
      split(ei, X);
      split(fi, X);
      done = true;
    }
  }
  G = G.filter((e) => !e.dead);
  return splits;
}

function mergeClose() {
  const N = P.length;
  const par = Array.from({ length: N }, (_, i) => i);
  const find = (x) => { while (par[x] !== x) x = par[x] = par[par[x]]; return x; };
  let unions = 0;
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
    if (Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1]) < MERGE_D) {
      const a = find(i), b = find(j);
      if (a !== b) { par[a] = b; unions++; }
    }
  }
  if (!unions) return 0;
  const sum = new Map();
  for (let i = 0; i < N; i++) {
    const r = find(i);
    const c = sum.get(r) ?? { x: 0, y: 0, n: 0, goal: false };
    c.x += P[i][0]; c.y += P[i][1]; c.n++;
    if (Math.hypot(P[i][0] - goalXY[0], P[i][1] - goalXY[1]) < 0.01) c.goal = true;
    sum.set(r, c);
  }
  const idxOf = new Map();
  const NP = [];
  for (const [r, c] of sum) { idxOf.set(r, NP.length); NP.push(c.goal ? goalXY.slice() : [c.x / c.n, c.y / c.n]); }
  const seenE = new Map();
  for (const e of G) {
    const a = idxOf.get(find(e.a)), b = idxOf.get(find(e.b));
    if (a === b) continue;
    const k = a < b ? a * 1e7 + b : b * 1e7 + a;
    const o = seenE.get(k);
    if (o) { o.name ??= e.name; o.rank = Math.max(o.rank, e.rank); continue; }
    seenE.set(k, { a, b, name: e.name, rank: e.rank });
  }
  P = NP;
  G = [...seenE.values()];
  return unions;
}

mergeClose();
for (let it = 0; it < 6; it++) {
  const sp = planarize(), mg = mergeClose();
  console.log(`planaryzacja #${it + 1}: podziałów ${sp}, zlanych węzłów ${mg}`);
  if (!sp && !mg) break;
}

// uproszczenie: scal węzły stopnia 2 leżące na prostej (<=1.5 m)
function simplify() {
  const adjS = new Map();
  const add = (n, E) => { let l = adjS.get(n); if (!l) adjS.set(n, (l = new Set())); l.add(E); };
  for (const E of G) { add(E.a, E); add(E.b, E); }
  const pairKey = (a, b) => (a < b ? a * 1e7 + b : b * 1e7 + a);
  const have = new Set(G.map((E) => pairKey(E.a, E.b)));
  let merged = 0;
  for (const [nd, set] of [...adjS]) {
    if (set.size !== 2 || !inPoly(fromXY(...P[nd]), POLYGON)) continue;
    if (Math.hypot(P[nd][0] - goalXY[0], P[nd][1] - goalXY[1]) < 0.5) continue;
    const [E1, E2] = [...set];
    const p = E1.a === nd ? E1.b : E1.a, qn = E2.a === nd ? E2.b : E2.a;
    if (p === qn || have.has(pairKey(p, qn))) continue;
    if (E1.name && E2.name && E1.name !== E2.name) continue;
    const [px, py] = P[p], [qx, qy] = P[qn], [x, y] = P[nd];
    const dx = qx - px, dy = qy - py, l2 = dx * dx + dy * dy;
    const t = l2 ? ((x - px) * dx + (y - py) * dy) / l2 : 0;
    if (t <= 0 || t >= 1 || Math.hypot(x - (px + t * dx), y - (py + t * dy)) > 1.5) continue;
    E1.dead = E2.dead = true;
    have.delete(pairKey(E1.a, E1.b)); have.delete(pairKey(E2.a, E2.b));
    const NE = { a: p, b: qn, name: E1.name || E2.name, rank: Math.max(E1.rank, E2.rank) };
    have.add(pairKey(p, qn));
    G.push(NE);
    adjS.get(p).delete(E1); adjS.get(p).delete(E2); adjS.get(p).add(NE);
    adjS.get(qn).delete(E1); adjS.get(qn).delete(E2); adjS.get(qn).add(NE);
    adjS.delete(nd);
    merged++;
  }
  G = G.filter((E) => !E.dead);
  return merged;
}
let totalMerged = 0;
for (let m; (m = simplify()) > 0; ) totalMerged += m;
console.log('scalono węzłów współliniowych:', totalMerged);

// tylko składowa z Syrenką
{
  const gi0 = P.reduce((b, p, i) => (Math.hypot(p[0] - goalXY[0], p[1] - goalXY[1]) < Math.hypot(P[b][0] - goalXY[0], P[b][1] - goalXY[1]) ? i : b), 0);
  const ad = Array.from({ length: P.length }, () => []);
  for (const E of G) { ad[E.a].push(E.b); ad[E.b].push(E.a); }
  const seenN = new Uint8Array(P.length);
  const st = [gi0];
  seenN[gi0] = 1;
  while (st.length) { const u = st.pop(); for (const v of ad[u]) if (!seenN[v]) { seenN[v] = 1; st.push(v); } }
  const before = G.length;
  G = G.filter((E) => seenN[E.a]);
  console.log('odrzucono krawędzi spoza składowej Syrenki:', before - G.length);
}

// podział długich krawędzi
{
  const out = [];
  let cuts = 0;
  for (const E of G) {
    const len = Math.hypot(P[E.a][0] - P[E.b][0], P[E.a][1] - P[E.b][1]);
    const k = Math.ceil(len / MAX_EDGE);
    if (k <= 1) { out.push(E); continue; }
    let prev = E.a;
    for (let i = 1; i <= k; i++) {
      let nx = E.b;
      if (i < k) { nx = P.length; P.push([P[E.a][0] + ((P[E.b][0] - P[E.a][0]) * i) / k, P[E.a][1] + ((P[E.b][1] - P[E.a][1]) * i) / k]); cuts++; }
      out.push({ a: prev, b: nx, name: E.name, rank: E.rank });
      prev = nx;
    }
  }
  G = out;
  console.log('dodano węzłów przy podziale długich krawędzi:', cuts);
}

// sprzątanie po podziale: węzły <3 m i ewentualne nowe przecięcia
for (let it = 0; it < 4; it++) {
  const mg = mergeClose(), sp = planarize();
  if (!mg && !sp) break;
}
// pozostałe odcinki >15 m (po zlaniu) dzielimy jeszcze raz
{
  const out = [];
  for (const E of G) {
    const len = Math.hypot(P[E.a][0] - P[E.b][0], P[E.a][1] - P[E.b][1]);
    if (len <= MAX_EDGE * 1.05) { out.push(E); continue; }
    const k = Math.ceil(len / MAX_EDGE);
    let prev = E.a;
    for (let i = 1; i <= k; i++) {
      let nx = E.b;
      if (i < k) { nx = P.length; P.push([P[E.a][0] + ((P[E.b][0] - P[E.a][0]) * i) / k, P[E.a][1] + ((P[E.b][1] - P[E.a][1]) * i) / k]); }
      out.push({ a: prev, b: nx, name: E.name, rank: E.rank });
      prev = nx;
    }
  }
  G = out;
}

// --- przenumeruj węzły ---
const usedN = [...new Set(G.flatMap((E) => [E.a, E.b]))].sort((a, b) => a - b);
const remap = new Map(usedN.map((o, i) => [o, i]));
const NODES = usedN.map((o) => fromXY(...P[o]));
const INSIDE = NODES.map((p) => inPoly(p, POLYGON));
const EDGES = G.map((E) => ({ a: remap.get(E.a), b: remap.get(E.b), len: Math.hypot(P[E.a][0] - P[E.b][0], P[E.a][1] - P[E.b][1]), name: E.name, rank: E.rank }));
const adj = Array.from({ length: NODES.length }, () => []);
EDGES.forEach((E, i) => { adj[E.a].push({ to: E.b, edge: i }); adj[E.b].push({ to: E.a, edge: i }); });
function dijkstra(src) {
  const N = NODES.length;
  const d = new Float64Array(N).fill(Infinity);
  d[src] = 0;
  const done = new Uint8Array(N);
  for (;;) {
    let u = -1, bd = Infinity;
    for (let i = 0; i < N; i++) if (!done[i] && d[i] < bd) { bd = d[i]; u = i; }
    if (u < 0) break;
    done[u] = 1;
    for (const { to, edge } of adj[u]) if (d[u] + EDGES[edge].len < d[to]) d[to] = d[u] + EDGES[edge].len;
  }
  return d;
}
let goalNode = -1, gd = Infinity;
NODES.forEach((p, i) => { const d = dist(p, goalPos); if (d < gd) { gd = d; goalNode = i; } });
console.log(`węzeł Syrenki: ${goalNode}, odległość od punktu Syrenki ${gd.toFixed(2)} m`);
const goalDist = dijkstra(goalNode);

// --- wejścia ---
const cand = new Map(); // node -> name/rank
for (const E of EDGES) {
  for (const [o, i] of [[E.a, E.b], [E.b, E.a]]) {
    if (!INSIDE[o] && (INSIDE[i] || inPoly([(NODES[o][0] + NODES[i][0]) / 2, (NODES[o][1] + NODES[i][1]) / 2], POLYGON))) {
      const c = cand.get(o) ?? { name: null, rank: 0 };
      if (E.name && !c.name) c.name = E.name;
      c.rank = Math.max(c.rank, E.rank);
      cand.set(o, c);
    }
  }
}
let cl = [...cand].map(([node, c]) => ({ node, ...c, deg: adj[node].length, pos: NODES[node] }));
cl.sort((a, b) => b.deg - a.deg || b.rank - a.rank);
let ent = [];
for (const c of cl) if (ent.every((x) => dist(x.pos, c.pos) >= 25)) ent.push(c);
console.log('kandydaci wejść:', cl.length, 'po klastrowaniu:', ent.length);
if (ent.length > 12) {
  const score = (c) => c.rank * 10 + c.deg;
  const pick = [ent.sort((a, b) => score(b) - score(a))[0]];
  while (pick.length < 10) {
    let best = null, bs = -1;
    for (const c of ent) if (!pick.includes(c)) {
      const sc = Math.min(...pick.map((p) => dist(p.pos, c.pos))) + score(c);
      if (sc > bs) { bs = sc; best = c; }
    }
    pick.push(best);
  }
  ent = pick;
}
ent = ent.filter((c) => isFinite(goalDist[c.node]));
// nazwy: znane miejsca (wejście w promieniu 40 m) mają pierwszeństwo przed tagiem OSM
const LANDMARKS = [
  ['Podwale', [21.011584, 52.247998]],
  ['Piwna', [21.012609, 52.247678]],
  ['Kanonia', [21.014536, 52.248479]],
  ['Gnojna Góra', [21.014286, 52.249663]],
  ['Kamienne Schodki', [21.013044, 52.250505]],
];
const nameCount = new Map();
let anon = 0;
const ENTRANCES = ent
  .sort((a, b) => Math.atan2(a.pos[1] - goalPos[1], a.pos[0] - goalPos[0]) - Math.atan2(b.pos[1] - goalPos[1], b.pos[0] - goalPos[0]))
  .map((c) => {
    const lm = LANDMARKS.find(([, p]) => dist(p, c.pos) < 40);
    let name = lm?.[0] ?? c.name ?? `Brama ${++anon}`;
    const k = (nameCount.get(name) ?? 0) + 1;
    nameCount.set(name, k);
    if (k > 1) name += ` ${k}`;
    return { name, node: c.node, pos: c.pos.map((v) => +v.toFixed(6)) };
  });

// --- pola budowy: sześciokąty (axial, ostrym wierzchołkiem do góry) ---
const HEX_R = 3;                 // promień sześciokąta (m)
const RYNEK_NO_BUILD_R = 50;     // promień (m) wokół Syrenki (Rynek), w którym pól jest mało
const RYNEK_KEEP = 12;           // na Rynku zostaje co N-te pole (poza nim wszystkie)
const SQ3 = Math.sqrt(3);
const segs = EDGES.map((E) => [toXY(NODES[E.a]), toXY(NODES[E.b])]);
function distEdge(x, y) {
  let best = Infinity;
  for (const [[ax, ay], [bx, by]] of segs) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = l2 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - ax - t * dx, y - ay - t * dy);
    if (d < best) best = d;
  }
  return best;
}
const keepAxial = (q, r) => RYNEK_KEEP <= 1 || (((q - r) % RYNEK_KEEP) + RYNEK_KEEP) % RYNEK_KEEP === 0;
function buildCells(minD, maxD, goalR) {
  const out = [];
  const [x0, y0] = toXY([Math.min(...lngs), Math.min(...lats)]), [x1, y1] = toXY([Math.max(...lngs), Math.max(...lats)]);
  const rMax = Math.ceil(y1 / (1.5 * HEX_R)) + 1, qMax = Math.ceil(x1 / (SQ3 * HEX_R)) + rMax;
  for (let r = -2; r <= rMax; r++) {
    for (let q = -rMax - 2; q <= qMax; q++) {
      const x = HEX_R * SQ3 * (q + r / 2), y = HEX_R * 1.5 * r;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      const p = fromXY(x, y);
      if (!inPoly(p, POLYGON)) continue;
      const dg = Math.hypot(x - goalXY[0], y - goalXY[1]);
      if (dg < goalR) continue;
      if (dg < RYNEK_NO_BUILD_R && !keepAxial(q, r)) continue;
      const d = distEdge(x, y);
      if (d < minD || d > maxD) continue;
      let blocked = inBuilding(p);
      for (let k = 0; k < 6 && !blocked; k++) {
        const a = (Math.PI / 180) * (60 * k - 30);
        if (inBuildingXY(x + HEX_R * Math.cos(a), y + HEX_R * Math.sin(a))) blocked = true;
      }
      if (blocked) continue;
      out.push([+p[0].toFixed(6), +p[1].toFixed(6)]);
    }
  }
  return out;
}
let centers = buildCells(MIN_D, MAX_D, 6);
console.log(`pola hex (${MIN_D}-${MAX_D} m, r=${HEX_R} m):`, centers.length);
if (centers.length < 120) {
  centers = buildCells(3, 28, 6);
  console.log('RELAKSACJA: pola hex (3-28 m):', centers.length);
}

// --- zapis ---
const level = {
  polygon: [...POLYGON, POLYGON[0]],
  nodes: NODES.map((p) => [+p[0].toFixed(6), +p[1].toFixed(6)]),
  edges: EDGES.map((E) => [E.a, E.b, +E.len.toFixed(1)]),
  entrances: ENTRANCES,
  goal: { name: 'Syrenka', node: goalNode, pos: goalPos.map((v) => +v.toFixed(6)) },
  // origin + mx/my: [lng,lat] -> metry = ((lng-origin[0])*mx, (lat-origin[1])*my); centrum hex: x = r*sqrt3*(q+rr/2), y = r*1.5*rr.
  cells: { kind: 'hex', size: HEX_R, radius: HEX_R, origin: [+w.toFixed(8), +s.toFixed(8)], mx: +MX.toFixed(4), my: MY, centers },
};
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../public/data/oldtown.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(level));
console.log(`\nwęzły ${NODES.length}, krawędzie ${EDGES.length}, wielokąt ${POLYGON.length} wierzchołków, pola ${centers.length}, plik ${(statSync(out).size / 1024).toFixed(1)} KB`);
console.log('wejścia:');
let bad = 0;
for (const en of ENTRANCES) {
  const d = goalDist[en.node];
  if (!isFinite(d)) bad++;
  console.log(`  ${en.name.padEnd(24)} node ${String(en.node).padStart(4)}  do Syrenki ${d.toFixed(0)} m`);
}
console.log(bad ? `BŁĄD: ${bad} wejść bez drogi do Syrenki` : 'OK: każde wejście dochodzi do Syrenki');
