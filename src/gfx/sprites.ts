import type { SpriteId, TowerKind } from '../game/types';

// Pixel art generowana proceduralnie (rampy tonów, światło z lewej-góry, auto-kontur),
// raz rysowana do offscreen canvasów. Deterministyczna (seedowany RNG).

type Ramp = [string, string, string, string]; // ciemny, cień, środek, światło

const hexRgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgbHex = (c: number[]) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (a: string, b: string, t: number) => {
  const x = hexRgb(a), y = hexRgb(b);
  return rgbHex(x.map((v, i) => v + (y[i] - v) * t));
};
const outCache = new Map<string, string>();
const outlineOf = (c: string) => {
  let o = outCache.get(c);
  if (!o) outCache.set(c, (o = mix(c, '#140c0a', 0.68)));
  return o;
};

// --- RNG ---
let rng = (() => 1) as () => number;
function seed(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  let a = h >>> 0;
  rng = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = () => rng();
const hash2 = (a: number, b: number) => {
  let h = Math.imul(a + 374761393, 668265263) ^ Math.imul(b + 1274126177, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// --- rampy ---
const R: Record<string, Ramp> = {
  stone: ['#3d3b40', '#74706a', '#a39e90', '#d2cbb4'],
  stoneDark: ['#2c2a30', '#56524f', '#807a6e', '#aaa391'],
  wood: ['#2a1a0e', '#523319', '#7a4e26', '#a8743a'],
  woodLight: ['#3a2514', '#6b4424', '#98652f', '#c58f4c'],
  boar: ['#1d1713', '#3b312b', '#584b40', '#80705c'],
  boarKing: ['#120e0d', '#2b2321', '#44372f', '#65513f'],
  snout: ['#4a3a34', '#7d675c', '#a88e7e', '#cdb7a4'],
  fox: ['#4e2008', '#a8470f', '#d96a1c', '#f7a04a'],
  white: ['#8e867e', '#c8c1b6', '#eeeadf', '#ffffff'],
  deer: ['#33200f', '#664020', '#8f5d2e', '#b98445'],
  antler: ['#6b5a3a', '#a08f66', '#cdbd90', '#efe2bd'],
  wolf: ['#24272b', '#4e5359', '#7a8088', '#a8aeb5'],
  wolfDark: ['#17191c', '#33373c', '#50565d', '#72797f'],
  tar: ['#07070a', '#16161b', '#2a2a32', '#4d4d58'],
  red: ['#4e0c0c', '#8c1818', '#c8281f', '#ef5a48'],
  gold: ['#5c4210', '#9a7418', '#d4a62a', '#f6dc6a'],
  steel: ['#2a2e36', '#5c6470', '#8f99a8', '#cfd8e4'],
  green: ['#1e3a1a', '#33602a', '#4f8a3c', '#7eb85a'],
  skin: ['#8a5a3a', '#b98660', '#e0b088', '#f4d3b0'],
  patina: ['#143730', '#2a6554', '#4f9c82', '#a0dab8'],
  bronze: ['#35230f', '#76501f', '#b6823a', '#ecc36a'],
  water: ['#12395a', '#24688f', '#46a0c6', '#a6e4f2'],
  dirt: ['#2e2016', '#523a26', '#7a5a3a', '#a07c52'],
};

// --- siatka ---
class Grid {
  d: (string | null)[];
  constructor(public w: number, public h: number) {
    this.d = new Array(w * h).fill(null);
  }
  at(x: number, y: number) {
    return x < 0 || y < 0 || x >= this.w || y >= this.h ? null : this.d[y * this.w + x];
  }
  set(x: number, y: number, c: string | null) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.d[y * this.w + x] = c;
  }
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const tone = (r: Ramp, l: number) => r[l > 0.45 ? 3 : l > -0.2 ? 2 : l > -0.62 ? 1 : 0];

interface SO {
  n?: number; // szum światła (futro)
  edge?: boolean; // wewnętrzny kontur kształtu
  over?: boolean; // maluj tylko tam, gdzie już coś jest
  b?: number; // przesunięcie światła
  flat?: number; // stały indeks tonu
}

function shape(g: Grid, inside: (x: number, y: number) => boolean, bb: [number, number, number, number], ramp: Ramp, o: SO = {}) {
  const [x0, y0, x1, y1] = bb;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.max(0.5, (x1 - x0) / 2), ry = Math.max(0.5, (y1 - y0) / 2);
  const set = new Set<number>();
  const pts: [number, number][] = [];
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++)
    for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
      if (!inside(x + 0.5, y + 0.5)) continue;
      if (o.over && !g.at(x, y)) continue;
      pts.push([x, y]);
      set.add(y * 4096 + x);
    }
  for (const [x, y] of pts) {
    if (o.flat !== undefined) {
      g.set(x, y, ramp[o.flat]);
      continue;
    }
    const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
    const l = -(nx * 0.5 + ny * 0.85) + (o.b ?? 0) + (o.n ? (rnd() - 0.5) * o.n * 2 : 0);
    g.set(x, y, tone(ramp, l));
  }
  if (o.edge)
    for (const [x, y] of pts)
      if (!set.has(y * 4096 + x - 1) || !set.has(y * 4096 + x + 1) || !set.has((y - 1) * 4096 + x) || !set.has((y + 1) * 4096 + x))
        { const c = g.at(x, y); if (c) g.set(x, y, outlineOf(c)); }
}

const ell = (g: Grid, cx: number, cy: number, rx: number, ry: number, ramp: Ramp, o?: SO) =>
  shape(g, (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1, [cx - rx, cy - ry, cx + rx, cy + ry], ramp, o);

function poly(g: Grid, p: [number, number][], ramp: Ramp, o?: SO) {
  const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
  const inside = (x: number, y: number) => {
    let c = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++)
      if (p[i][1] > y !== p[j][1] > y && x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
    return c;
  };
  shape(g, inside, [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], ramp, o);
}

function rect(g: Grid, x: number, y: number, w: number, h: number, c: string) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) g.set(x + i, y + j, c);
}

function line(g: Grid, x0: number, y0: number, x1: number, y1: number, c: string, w = 1) {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
    for (let k = 0; k < w; k++) g.set(x + k, y, c);
  }
}

/** Kontur zewnętrzny: ciemniejszy odcień sąsiedniego materiału. */
function outline(g: Grid) {
  const add: [number, number, string][] = [];
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      if (g.at(x, y)) continue;
      const n = g.at(x - 1, y) ?? g.at(x + 1, y) ?? g.at(x, y - 1) ?? g.at(x, y + 1);
      if (n) add.push([x, y, outlineOf(n)]);
    }
  for (const [x, y, c] of add) g.set(x, y, c);
}

// --- mur kamienny ---
interface BO {
  bw?: number;
  bh?: number;
  ref?: [number, number]; // zakres x do cieniowania walca
  flat?: boolean;
}
function bricks(g: Grid, x0: number, y0: number, w: number, h: number, ramp: Ramp, o: BO = {}) {
  const bw = o.bw ?? 4, bh = o.bh ?? 3;
  const [rx0, rw] = o.ref ?? [x0, w];
  for (let y = 0; y < h; y++) {
    const row = Math.floor(y / bh), yin = y % bh;
    const off = (row % 2) * (bw >> 1);
    for (let x = 0; x < w; x++) {
      const t = (x0 + x + 0.5 - rx0) / rw;
      let base = o.flat ? 2 : t < 0.25 ? 3 : t < 0.66 ? 2 : 1;
      const bi = Math.floor((x + off) / bw), xin = (x + off) % bw;
      let idx = base + (hash2(bi + (x0 | 0), row + (y0 | 0)) < 0.2 ? -1 : hash2(bi + 7, row + 3) > 0.86 ? 1 : 0);
      if (rnd() < 0.04) idx += rnd() < 0.5 ? -1 : 1;
      if (yin === bh - 1 || xin === bw - 1) idx = base - 1;
      else if (yin === 0 && base >= 2) idx += 1;
      g.set(x0 + x, y0 + y, ramp[clamp(idx, 0, 3)]);
    }
  }
}

function merlons(g: Grid, x0: number, y0: number, w: number, h: number, ramp: Ramp, n: number, mw: number, ref: [number, number]) {
  for (let i = 0; i < n; i++) {
    const mx = x0 + Math.round((i * (w - mw)) / (n - 1));
    bricks(g, mx, y0, mw, h, ramp, { bw: 3, bh: 2, ref });
    for (let k = 0; k < mw; k++) g.set(mx + k, y0, ramp[3]);
  }
}

function planks(g: Grid, x0: number, y0: number, w: number, h: number, ramp: Ramp, ref?: [number, number]) {
  const [rx0, rw] = ref ?? [x0, w];
  for (let x = 0; x < w; x++) {
    const t = (x0 + x + 0.5 - rx0) / rw;
    const base = t < 0.25 ? 3 : t < 0.65 ? 2 : 1;
    for (let y = 0; y < h; y++) {
      const seam = x % 3 === 2;
      let idx = seam ? base - 1 : base;
      if (!seam && hash2(x >> 1, y >> 2) < 0.2) idx -= 1;
      g.set(x0 + x, y0 + y, ramp[clamp(idx, 0, 3)]);
    }
  }
}

// --- zwierzęta ---

interface LegSpec {
  hx: number;
  far?: boolean;
  ph: number;
}
function legs(g: Grid, specs: LegSpec[], f: number, hipY: number, footY: number, ramp: Ramp, w: number, amp: number, lift: number, sock?: string, still?: boolean) {
  const order = [...specs].sort((a, b) => +!!b.far - +!!a.far);
  for (const l of order) {
    const phi = f / 4 + l.ph;
    const dx = still ? 0 : Math.sin(phi * Math.PI * 2) * amp;
    const up = still ? 0 : Math.max(0, Math.cos(phi * Math.PI * 2)) * lift;
    const fx = l.hx + dx, fy = footY - up;
    const r = l.far ? [ramp[0], ramp[0], ramp[1], ramp[1]] : ramp;
    const n = Math.ceil(Math.max(Math.abs(fx - l.hx), Math.abs(fy - hipY))) + 1;
    if (!l.far && w >= 2)
      for (let i = 0; i <= n; i++) {
        const t = i / n, y = hipY + (fy - hipY) * t;
        if (y < hipY + 2) continue;
        const x = l.hx + (fx - l.hx) * t;
        g.set(x + w, y, outlineOf(ramp[1]));
      }
    for (let i = 0; i <= n; i++) {
      const t = i / n, y = hipY + (fy - hipY) * t, x = l.hx + (fx - l.hx) * t;
      for (let k = 0; k < w; k++) {
        let c = k === 0 && w > 1 ? r[2] : r[1];
        if (w === 1) c = l.far ? r[1] : r[2];
        if (sock && y > footY - 2) c = sock;
        else if (!sock && i >= n - 0 && y >= footY - 1) c = r[0];
        g.set(x + k, y, c);
      }
    }
    // kopyto/stopa
    g.set(fx, fy, sock ?? r[0]);
    if (w > 1) g.set(fx + 1, fy, sock ?? r[0]);
  }
}

/** Ciemne szczeciny / futro wystające nad grzbiet. */
function bristles(g: Grid, x0: number, x1: number, step: number, hmax: number, dark: string, tip: string) {
  for (let x = Math.floor(x0); x <= x1; x += step) {
    let top = -1;
    for (let y = 0; y < g.h; y++) if (g.at(x, y)) { top = y; break; }
    if (top < 0) continue;
    const hh = 1 + Math.floor(rnd() * hmax);
    for (let k = 1; k <= hh; k++) g.set(x, top - k, k === hh ? tip : dark);
  }
}

function boar(f: number, o: { k?: number; king?: boolean; atk?: number }): Grid {
  const k = o.k ?? 1, king = !!o.king;
  const oy = king ? 4 : 0;
  const W = Math.round(28 * k), H = Math.round(18 * k) + oy + (king ? 1 : 0);
  const g = new Grid(W, H);
  const X = (v: number) => v * k, Y = (v: number) => v * k + oy;
  const ramp = king ? R.boarKing : R.boar;
  const atk = o.atk !== undefined;
  const bob = atk ? 0 : f % 2 === 0 ? -1 : 0;
  const bx = atk ? o.atk! * 1.5 : 0; // wyrzut do przodu
  const hdx = atk ? 1 + bx : 0, hdy = atk ? 4.6 - bx * 1.2 : 0;
  const lw = Math.max(2, Math.round(2 * k));
  const hipY = Y(10) + bob;
  const foot = Y(16);
  const lr = king ? R.boarKing : R.boar;
  const sp: LegSpec[] = atk
    ? [{ hx: X(17) + bx, ph: 0 }, { hx: X(19) + bx, far: true, ph: 0 }, { hx: X(6) + bx, ph: 0 }, { hx: X(9) + bx, far: true, ph: 0 }]
    : [{ hx: X(17), ph: 0 }, { hx: X(8), ph: 0.5 }, { hx: X(19), far: true, ph: 0.5 }, { hx: X(10), far: true, ph: 0 }];
  if (atk) {
    legs(g, [sp[1], sp[3]], 0, hipY, foot, lr, lw, 0, 0);
  } else legs(g, sp.filter((s) => s.far), f, hipY, foot, lr, lw, 2.2 * k, 2 * k);
  // tułów
  ell(g, X(12.5 + bx), Y(8) + bob, X(10), X(4.6), ramp, { n: 0.5 });
  ell(g, X(17 + bx), Y(7.2) + bob + (atk ? 2 : 0), X(6.5), X(5.2), ramp, { n: 0.5, b: 0.15 });
  ell(g, X(7.5 + bx), Y(8.4) + bob, X(5.5), X(4.2), ramp, { n: 0.5 });
  bristles(g, X(5 + bx), X(21 + bx), 1, king ? 3 : 2, ramp[0], mix(ramp[3], '#b8a07a', 0.5));
  // grzywa — jaśniejsze końcówki
  for (let x = Math.floor(X(7 + bx)); x < X(20 + bx); x += 2) {
    for (let y = 0; y < g.h; y++) if (g.at(x, y)) { g.set(x, y, ramp[3]); break; }
  }
  if (king) {
    // czerwony strzęp peleryny
    poly(g, [[X(10), Y(3.4)], [X(16), Y(3.4)], [X(16.4), Y(6.4)], [X(14.6), Y(7.4)], [X(13.6), Y(9.4)], [X(12.2), Y(7)], [X(10), Y(7)]], R.red, { n: 0.25, edge: true });
    line(g, X(10.5), Y(7.4), X(9.5), Y(9.4), R.red[1], 2);
    line(g, X(15.5), Y(7.4), X(16.4), Y(8.6), R.red[2]);
  }
  // ogon
  line(g, X(2.4 + bx), Y(6.5) + bob, X(1 + bx), Y(4.5) + bob, ramp[1]);
  g.set(X(1 + bx), Y(3.8) + bob, ramp[2]);
  // głowa
  const hx = X(hdx), hy = Y(hdy);
  const H0 = (a: number, b: number): [number, number] => [X(a) + hx, Y(b) + hy + bob * (atk ? 0 : 1)];
  poly(g, [H0(19, 3.6), H0(23, 4.2), H0(26.4, 7.4), H0(27.4, 10.4), H0(25.6, 12.2), H0(21, 11.8), H0(18.4, 9.4)], ramp, { n: 0.35, edge: true });
  const sn = H0(25.6, 9.9);
  ell(g, sn[0], sn[1], X(2.3), X(1.9), R.snout, { edge: true });
  g.set(sn[0] + X(0.8), sn[1] - 0.4, R.snout[0]);
  const ear = [H0(19.4, 4.2), H0(20, 1.2), H0(22.4, 3.4)];
  poly(g, ear, ramp, { edge: true });
  const eye = H0(22.8, 6.8);
  g.set(eye[0], eye[1], '#0c0806');
  g.set(eye[0] + 1, eye[1] - 1, ramp[3]);
  // kły
  const tu = H0(24.2, 11.8);
  const tw = king ? 2 : 1;
  for (let i = 0; i < tw + 1; i++) g.set(tu[0] + i, tu[1], '#f4efdc');
  g.set(tu[0] + tw + 1, tu[1] - 1, '#fffdf0');
  if (king) g.set(tu[0] + tw + 1, tu[1] - 2, '#fffdf0');
  g.set(tu[0] - 1, tu[1], '#d8d0b4');
  if (atk) legs(g, [sp[0], sp[2]], 0, hipY, foot, lr, lw, 0, 0);
  else legs(g, sp.filter((s) => !s.far), f, hipY, foot, lr, lw, 2.2 * k, 2 * k);
  if (king) {
    // złota korona
    const c0 = H0(18.8, 4.2);
    const cx = Math.round(c0[0]), cy = Math.round(c0[1]);
    for (let i = 0; i < 7; i++) g.set(cx + i, cy - 1, i % 2 ? R.gold[2] : R.gold[1]);
    for (let i = 0; i < 7; i++) g.set(cx + i, cy, R.gold[1 + (i < 3 ? 1 : 0)]);
    for (const i of [0, 3, 6]) { g.set(cx + i, cy - 2, R.gold[3]); g.set(cx + i, cy - 3, R.gold[2]); }
    g.set(cx + 3, cy - 1, R.red[3]);
  }
  outline(g);
  return g;
}

function fox(f: number): Grid {
  const g = new Grid(24, 14);
  const bob = f % 2 === 0 ? -1 : 0;
  const sp: LegSpec[] = [{ hx: 16, ph: 0 }, { hx: 6, ph: 0.5 }, { hx: 18, far: true, ph: 0.5 }, { hx: 8, far: true, ph: 0 }];
  const ink = '#16100d';
  const hip = 8 + bob;
  legs(g, sp.filter((s) => s.far), f, hip, 12, R.fox, 1, 1.8, 1.5, ink);
  // ogon (puszysty, biała końcówka)
  poly(g, [[8, 6.4 + bob], [5.4, 3 + bob], [2.4, 0.6 + bob], [0.2, 1.4 + bob], [0.4, 4.4 + bob], [2.6, 7 + bob], [5.4, 8.2 + bob]], R.fox, { n: 0.2, edge: true, b: 0.25 });
  poly(g, [[0, 1 + bob], [2.4, 0.4 + bob], [3.2, 2.4 + bob], [1.6, 4 + bob], [0.4, 4.6 + bob], [0, 3 + bob]], R.white, { edge: true, over: true });
  ell(g, 11.5, 6.4 + bob, 6.6, 3, R.fox, { n: 0.2 });
  ell(g, 16, 8 + bob, 3, 2, R.white, { over: true });
  // głowa
  poly(g, [[16, 4.2 + bob], [20, 4 + bob], [23.4, 6.8 + bob], [20.6, 8.6 + bob], [17, 8.8 + bob]], R.fox, { edge: true, b: 0.15 });
  poly(g, [[16.6, 4 + bob], [17, 0.6 + bob], [18.8, 3.8 + bob]], R.fox, { edge: true });
  poly(g, [[18.8, 4 + bob], [20, 1 + bob], [21, 4.4 + bob]], R.fox, { edge: true });
  g.set(17, 1.8 + bob, ink);
  g.set(17, 2.8 + bob, ink);
  g.set(20, 1.8 + bob, ink);
  poly(g, [[18, 7.2 + bob], [21.5, 6.6 + bob], [22.8, 7.4 + bob], [20.5, 8.8 + bob], [18, 8.8 + bob]], R.white, { over: true });
  g.set(22, 5.8 + bob, ink);
  g.set(22.2, 6.2 + bob, ink);
  g.set(19.4, 5.6 + bob, ink);
  legs(g, sp.filter((s) => !s.far), f, hip, 12, R.fox, 1, 1.8, 1.5, ink);
  outline(g);
  return g;
}

function deer(f: number): Grid {
  const g = new Grid(26, 24);
  const bob = f % 2 === 0 ? -1 : 0;
  const ink = '#1a110a';
  const sp: LegSpec[] = [{ hx: 16, ph: 0 }, { hx: 6, ph: 0.5 }, { hx: 18, far: true, ph: 0.5 }, { hx: 8, far: true, ph: 0 }];
  legs(g, sp.filter((s) => s.far), f, 15 + bob, 22, R.deer, 1, 2.2, 2.5, ink);
  ell(g, 10.5, 12 + bob, 8.6, 4.4, R.deer, { n: 0.25 });
  ell(g, 10, 14.6 + bob, 6.5, 1.8, R.antler, { over: true, flat: 3, n: 0 });
  ell(g, 2.6, 11 + bob, 2.4, 3, R.white, { over: true });
  // szyja i głowa
  poly(g, [[13.5, 9 + bob], [16.5, 4.6 + bob], [20, 6 + bob], [19, 13 + bob], [13, 13.5 + bob]], R.deer, { n: 0.2, edge: false });
  poly(g, [[17.4, 5 + bob], [21, 4.8 + bob], [24.6, 8 + bob], [24.4, 9.6 + bob], [21, 9.4 + bob], [17.6, 8.6 + bob]], R.deer, { edge: true });
  poly(g, [[18.4, 5.2 + bob], [19.8, 3 + bob], [20.6, 5.4 + bob]], R.deer, { edge: true });
  g.set(21.4, 6.4 + bob, ink);
  g.set(24.2, 8.6 + bob, ink);
  for (let x = 21; x < 24; x++) g.set(x, 9 + bob, R.antler[3]);
  // poroże
  const A = (a: number, b: number, c: number, d: number) => line(g, a, b + bob, c, d + bob, R.antler[2]);
  A(19.4, 4.6, 18.4, 1.4);
  A(18.4, 1.4, 19.6, 0);
  A(18.9, 3, 16.8, 2);
  A(21.2, 4.8, 22.4, 1.2);
  A(22.4, 1.2, 24.4, 0);
  A(21.9, 2.8, 24.6, 3);
  g.set(18.4, 1.4 + bob, R.antler[3]);
  g.set(22.4, 1.2 + bob, R.antler[3]);
  legs(g, sp.filter((s) => !s.far), f, 15 + bob, 22, R.deer, 1, 2.2, 2.5, ink);
  outline(g);
  return g;
}

function wolf(f: number): Grid {
  const g = new Grid(26, 16);
  const bob = f % 2 === 0 ? -1 : 0;
  const ink = '#101214';
  const sp: LegSpec[] = [{ hx: 17, ph: 0 }, { hx: 7, ph: 0.5 }, { hx: 19, far: true, ph: 0.5 }, { hx: 9, far: true, ph: 0 }];
  legs(g, sp.filter((s) => s.far), f, 10 + bob, 14, R.wolf, 2, 2.4, 2, undefined);
  poly(g, [[5, 5.6 + bob], [2, 7 + bob], [0.4, 10 + bob], [1.5, 12 + bob], [3.5, 11 + bob], [5.5, 8.6 + bob]], R.wolf, { n: 0.3, edge: true });
  ell(g, 11.5, 7.4 + bob, 8.6, 3.9, R.wolf, { n: 0.3 });
  ell(g, 11.5, 4.6 + bob, 8.6, 2.2, R.wolfDark, { over: true, n: 0.3 });
  ell(g, 11, 10 + bob, 7, 1.7, R.white, { over: true, flat: 2, n: 0 });
  ell(g, 16.5, 6.6 + bob, 4, 3.6, R.wolf, { n: 0.4, b: 0.1 });
  poly(g, [[18, 4.4 + bob], [22, 4.6 + bob], [25.4, 7.4 + bob], [25, 9 + bob], [21.6, 9.4 + bob], [18, 9.4 + bob]], R.wolf, { n: 0.2, edge: true });
  poly(g, [[19, 4.6 + bob], [19.4, 1.4 + bob], [21.4, 4.2 + bob]], R.wolfDark, { edge: true });
  poly(g, [[21, 8 + bob], [24.4, 8 + bob], [24.4, 9.2 + bob], [21, 9.2 + bob]], R.white, { over: true, flat: 2 });
  g.set(25, 7.8 + bob, ink);
  g.set(21.8, 6 + bob, '#f0c830');
  g.set(22.6, 6.3 + bob, ink);
  legs(g, sp.filter((s) => !s.far), f, 10 + bob, 14, R.wolf, 2, 2.4, 2, undefined);
  void ink;
  outline(g);
  return g;
}

// --- postacie na wieżach ---

function archer(g: Grid, cx: number, fy: number, dir: 0 | 1 = 0) {
  void dir;
  rect(g, cx - 2, fy - 6, 4, 6, R.green[2]);
  rect(g, cx - 2, fy - 6, 1, 6, R.green[3]);
  rect(g, cx + 1, fy - 6, 1, 6, R.green[1]);
  rect(g, cx - 2, fy - 3, 4, 1, '#5a3c1e');
  rect(g, cx - 3, fy - 8, 1, 4, '#6a4426'); // kołczan
  g.set(cx - 3, fy - 9, '#e8e0c0');
  g.set(cx - 4, fy - 9, '#c83c2c');
  ell(g, cx, fy - 8.4, 1.9, 1.9, R.skin);
  poly(g, [[cx - 2.4, fy - 8], [cx - 1.6, fy - 10.6], [cx + 1.2, fy - 10.6], [cx + 2, fy - 8]], R.green, { flat: 1 });
  g.set(cx + 1, fy - 8, '#1a110a');
  // ręka i łuk
  line(g, cx + 1, fy - 5, cx + 4, fy - 6, R.skin[2]);
  for (let t = -4; t <= 4; t++) g.set(cx + 5 + Math.round(1.6 - (t * t) / 8), fy - 6 + t, R.woodLight[2]);
  for (let t = -3; t <= 3; t++) g.set(cx + 4, fy - 6 + t, '#ece4c8');
  g.set(cx + 5, fy - 6, '#ece4c8');
}

function xbowman(g: Grid, cx: number, fy: number) {
  rect(g, cx - 2, fy - 6, 5, 6, R.red[1]);
  rect(g, cx - 2, fy - 6, 1, 6, R.red[2]);
  rect(g, cx - 2, fy - 3, 5, 1, '#3a2a1a');
  ell(g, cx, fy - 8.4, 1.9, 1.9, R.skin);
  poly(g, [[cx - 3, fy - 8.2], [cx - 1.6, fy - 11], [cx + 1.6, fy - 11], [cx + 3, fy - 8.2]], R.steel, { edge: true });
  g.set(cx + 1, fy - 8, '#1a110a');
  line(g, cx - 1, fy - 5, cx + 6, fy - 5, R.woodLight[1], 1);
  line(g, cx - 1, fy - 4, cx + 6, fy - 4, R.wood[1], 1);
  for (let t = -3; t <= 3; t++) g.set(cx + 6, fy - 5 + t, R.wood[0]);
  g.set(cx + 6, fy - 5, R.steel[3]);
  g.set(cx + 7, fy - 5, R.steel[3]);
  g.set(cx + 3, fy - 6, R.skin[2]);
}

function ballista(g: Grid, cx: number, fy: number, lv: number) {
  // rama na kołach, wielkie ramiona łuku i bełt
  rect(g, cx - 5, fy - 3, 11, 3, R.wood[1]);
  rect(g, cx - 5, fy - 3, 11, 1, R.wood[3]);
  rect(g, cx - 4, fy, 3, 2, R.steel[1]);
  rect(g, cx + 2, fy, 3, 2, R.steel[1]);
  line(g, cx - 7 - lv, fy - 9, cx, fy - 6, R.wood[2], 1);
  line(g, cx + 7 + lv, fy - 9, cx, fy - 6, R.wood[2], 1);
  line(g, cx - 7 - lv, fy - 9, cx + 7 + lv, fy - 9, R.steel[3], 1);
  rect(g, cx - 1, fy - 7, 9, 2, R.wood[1]);
  rect(g, cx + 8, fy - 7, 2, 2, R.steel[3]);
  g.set(cx + 10, fy - 7, '#ffffff');
  g.set(cx - 1, fy - 8, R.gold[3]);
}

function bombard(g: Grid, cx: number, fy: number, lv: number) {
  // lufa na lawecie, stos kul
  rect(g, cx - 6, fy - 2, 13, 3, R.wood[1]);
  rect(g, cx - 6, fy - 2, 13, 1, R.wood[3]);
  const len = 9 + lv;
  for (let i = 0; i < len; i++) {
    const x = cx - 4 + i, y = fy - 4 - Math.floor(i / 5);
    rect(g, x, y - 2, 1, 5, i < 2 ? R.steel[1] : R.steel[i % 4 === 0 ? 2 : 1]);
    g.set(x, y - 2, R.steel[3]);
  }
  rect(g, cx - 4 + len, fy - 4 - Math.floor((len - 1) / 5) - 3, 2, 7, '#15151a');
  for (let i = 0; i < 3; i++) ell(g, cx - 5 + i * 3, fy - 4, 1.5, 1.5, R.steel, { b: 0.1 });
}

function flame(g: Grid, x0: number, x1: number, by: number, hh: number) {
  for (let x = x0; x <= x1; x++) {
    const h = 1 + Math.floor(rnd() * hh);
    for (let k = 0; k < h; k++) g.set(x, by - k, k === h - 1 && h > 1 ? '#d8421a' : k > 0 ? '#f08a20' : '#ffd23c');
  }
}

function cauldron(g: Grid, cx: number, bottomY: number, rx: number, ry: number, level: number) {
  const cy = bottomY - ry + 0.5;
  // hak/nóżki
  rect(g, cx - rx + 1, bottomY - 1, 2, 2, R.tar[1]);
  rect(g, cx + rx - 2, bottomY - 1, 2, 2, R.tar[1]);
  ell(g, cx, cy, rx, ry, R.tar, { b: 0.1 });
  // połysk
  g.set(cx - rx * 0.55, cy - ry * 0.3, '#9a9aa8');
  g.set(cx - rx * 0.55, cy - ry * 0.3 + 1, '#6a6a78');
  g.set(cx - rx * 0.55 + 1, cy - ry * 0.3 - 1, '#c8c8d4');
  // rant
  ell(g, cx, cy - ry + 1, rx + 1, 2.2, R.steel, { flat: 1 });
  ell(g, cx, cy - ry + 1.2, rx - 0.5, 1.3, R.tar, { flat: 0 });
  g.set(cx - 2, cy - ry + 1, '#d8641c');
  g.set(cx + 1, cy - ry + 1.3, '#b04a14');
  for (let i = 0; i < rx * 2 + 2; i++) g.set(cx - rx - 0.5 + i, cy - ry - 0.5, R.steel[3 - (i > rx ? 1 : 0)]);
  void level;
}

function smoke(g: Grid, cx: number, y: number, n: number) {
  const cols = ['#8a8680', '#a7a39b', '#6c6965'];
  for (let i = 0; i < n; i++) g.set(cx - 3 + Math.floor(rnd() * 8) + (i % 2), y - i * 2, cols[i % 3]);
}

function banner(g: Grid, px: number, topY: number) {
  line(g, px, topY, px, topY + 12, R.wood[1]);
  rect(g, px - 1, topY, 3, 1, R.gold[2]);
  g.set(px, topY - 1, R.gold[3]);
  for (let y = 0; y < 8; y++)
    for (let x = 1; x <= 5; x++) {
      if (y > 5 && (x === 3 || (y === 7 && x < 4 && x > 1))) continue;
      g.set(px + x, topY + 1 + y, x === 1 ? R.red[3] : x > 4 ? R.red[1] : R.red[2]);
    }
  g.set(px + 3, topY + 3, R.gold[3]);
  g.set(px + 3, topY + 4, R.gold[2]);
  g.set(px + 2, topY + 4, R.gold[2]);
  g.set(px + 4, topY + 4, R.gold[2]);
}

function polishFlag(g: Grid, px: number, topY: number) {
  line(g, px, topY, px, topY + 15, R.wood[1]);
  g.set(px, topY - 1, R.gold[3]);
  g.set(px, topY - 2, R.gold[2]);
  for (let x = 1; x <= 10; x++) {
    const wv = Math.round(Math.sin(x * 0.7) * 0.9);
    for (let y = 0; y < 6; y++) {
      const top = y < 3;
      const sh = (x > 7 ? 1 : 0) + (Math.sin(x * 0.7) < -0.4 ? 1 : 0);
      g.set(px + x, topY + 1 + y + wv, top ? ['#ffffff', '#ece8dc', '#cfcabb'][Math.min(2, sh)] : [R.red[2], R.red[1], R.red[0]][Math.min(2, sh)]);
    }
  }
}

interface TS {
  w: number;
  h: number;
  bw: number;
  yTop: number;
}
const TSPEC: Record<TowerKind, TS[]> = {
  lucznik: [{ w: 24, h: 34, bw: 14, yTop: 12 }, { w: 26, h: 40, bw: 16, yTop: 13 }, { w: 28, h: 46, bw: 18, yTop: 16 }],
  kusznik: [{ w: 26, h: 36, bw: 18, yTop: 12 }, { w: 28, h: 42, bw: 20, yTop: 13 }, { w: 30, h: 48, bw: 22, yTop: 16 }],
  smola: [{ w: 24, h: 34, bw: 18, yTop: 13 }, { w: 26, h: 38, bw: 20, yTop: 13 }, { w: 28, h: 46, bw: 22, yTop: 18 }],
  balista: [{ w: 28, h: 38, bw: 18, yTop: 14 }, { w: 30, h: 44, bw: 20, yTop: 15 }, { w: 32, h: 50, bw: 22, yTop: 18 }],
  bombarda: [{ w: 28, h: 34, bw: 20, yTop: 13 }, { w: 30, h: 40, bw: 22, yTop: 14 }, { w: 32, h: 46, bw: 24, yTop: 17 }],
};

function tower(kind: TowerKind, lv: 1 | 2 | 3): Grid {
  const { w, h, bw, yTop } = TSPEC[kind][lv - 1];
  const g = new Grid(w, h);
  const bx = Math.floor((w - bw) / 2), gy = h - 2;
  const ref: [number, number] = [bx, bw];
  const stone = kind === 'kusznik' || kind === 'bombarda' ? R.stoneDark : R.stone;
  const heavy = kind === 'kusznik' || kind === 'balista' || kind === 'bombarda';
  const corbel = lv === 3 || heavy;
  const bodyTop = yTop + 5 + (corbel ? 2 : 0);
  const plinth = heavy ? 4 : 3;
  const bodyBot = gy - plinth;
  // trzon
  const wood = kind === 'lucznik' && lv === 1;
  if (wood) {
    const stoneH = 8;
    planks(g, bx, bodyTop, bw, bodyBot - bodyTop - stoneH + 1, R.wood, ref);
    rect(g, bx, bodyTop, bw, 1, R.wood[3]);
    for (let i = 0; i < 2; i++) rect(g, bx + 1, bodyTop + 1 + i * 3, bw - 2, 1, R.wood[0]);
    line(g, bx + 1, bodyTop + 1, bx + bw - 2, bodyBot - stoneH, R.wood[0]);
    bricks(g, bx, bodyBot - stoneH + 1, bw, stoneH, stone, { ref });
  } else bricks(g, bx, bodyTop, bw, bodyBot - bodyTop + 1, stone, { ref });
  // cokół
  bricks(g, bx - 1, bodyBot + 1, bw + 2, plinth, R.stoneDark, { bw: 5, ref: [bx - 1, bw + 2] });
  rect(g, bx - 1, bodyBot + 1, bw + 2, 1, R.stoneDark[3]);
  if (heavy) {
    for (const px of [bx, bx + bw - 3]) bricks(g, px, bodyTop, 3, bodyBot - bodyTop + 1, R.stoneDark, { bw: 3, ref: [px, 3], flat: true });
    rect(g, bx + 3, Math.floor((bodyTop + bodyBot) / 2), bw - 6, 1, R.stoneDark[3]);
  }
  // wspornik (machikuły)
  if (corbel) {
    for (let x = bx - 1; x <= bx + bw; x++) {
      const t = (x - bx) / bw;
      g.set(x, yTop + 5, stone[t < 0.25 ? 3 : t < 0.7 ? 2 : 1]);
      g.set(x, yTop + 6, (x - bx) % 3 === 1 ? stone[0] : stone[t < 0.5 ? 2 : 1]);
    }
  } else rect(g, bx, yTop + 5, bw, 1, stone[1]);
  // szczeliny strzelnicze i drzwi
  const sx = bx + Math.round(bw * 0.42);
  const slitY = bodyTop + 3;
  const slits = lv + (heavy ? 0 : 0);
  for (let i = 0; i < Math.min(slits, 3); i++) {
    const y = slitY + i * 5;
    if (y + 4 >= bodyBot - 6) break;
    rect(g, sx, y, 1, 4, '#120c0a');
    g.set(sx + 1, y + 1, stone[1]);
    g.set(sx - 1, y, stone[3]);
  }
  const dx = bx + Math.floor(bw / 2) - 2;
  rect(g, dx, bodyBot - 6, 5, 7, '#150d09');
  g.set(dx, bodyBot - 6, null);
  g.set(dx + 4, bodyBot - 6, null);
  rect(g, dx + 1, bodyBot - 5, 3, 6, R.wood[1]);
  rect(g, dx + 1, bodyBot - 5, 1, 6, R.wood[2]);
  g.set(dx + 3, bodyBot - 2, R.gold[3]);
  rect(g, dx + 1, bodyBot - 3, 3, 1, R.steel[1]);
  // wnętrze za blankami
  const mw = bw <= 16 ? 3 : 4, n = bw <= 18 ? 3 : 4;
  rect(g, bx, yTop + 3, bw, 2, stone[0]);
  rect(g, bx, yTop + 3, bw, 1, stone[1]);
  const cx = bx + Math.floor(bw / 2);
  if (kind === 'smola') {
    // ogień w prześwitach
    flame(g, bx + 1, bx + bw - 2, yTop + 4, 4);
    const rx = 5 + lv;
    cauldron(g, cx, yTop + 2, rx, 4 + (lv > 1 ? 1 : 0), lv);
    smoke(g, cx, yTop - 10, 3 + lv);
    for (let i = 0; i < 3; i++) g.set(cx - 4 + Math.floor(rnd() * 9), yTop - 8 - Math.floor(rnd() * 3), i ? '#f08a20' : '#ffd23c');
  }
  if (lv === 2) banner(g, bx + 2, yTop - 9);
  if (lv === 3) polishFlag(g, bx + 3, yTop - 14);
  if (kind === 'lucznik') archer(g, cx, yTop + 2);
  if (kind === 'kusznik') xbowman(g, cx, yTop + 2);
  if (kind === 'balista') ballista(g, cx, yTop + 2, lv);
  if (kind === 'bombarda') bombard(g, cx, yTop + 2, lv);
  merlons(g, bx, yTop, bw, 5, stone, n, mw, ref);
  // odsłonięte światło na wierzchu murków
  outline(g);
  return g;
}

// --- mury ---

function wall(damaged: boolean): Grid {
  const g = new Grid(22, 16);
  const st = R.stone;
  seed(damaged ? 'wall_d' : 'wall');
  const ref: [number, number] = [-14, 50];
  bricks(g, 0, 7, 22, 8, st, { bw: 5, bh: 3, ref });
  rect(g, 0, 14, 22, 1, st[0]);
  // wierzch (chodnik)
  rect(g, 0, 5, 22, 2, st[2]);
  rect(g, 0, 5, 22, 1, st[3]);
  rect(g, 0, 6, 22, 1, st[1]);
  const pos = [0, 9, 17];
  pos.forEach((mx, i) => {
    if (damaged && i === 1) {
      bricks(g, mx, 4, 5, 3, st, { bw: 3, bh: 2, ref });
      g.set(mx, 4, null); g.set(mx + 4, 4, null); g.set(mx + 1, 3, st[2]); g.set(mx + 3, 4, st[1]);
      return;
    }
    bricks(g, mx, 0, 5, 7, st, { bw: 3, bh: 2, ref });
    for (let k = 0; k < 5; k++) g.set(mx + k, 0, st[3]);
  });
  if (damaged) {
    const dk = '#1a1412';
    // pęknięcia
    [[11, 7], [12, 8], [11, 9], [12, 10], [13, 11], [12, 12], [13, 13]].forEach(([x, y]) => g.set(x, y, dk));
    [[3, 8], [4, 9], [3, 10]].forEach(([x, y]) => g.set(x, y, dk));
    rect(g, 5, 10, 3, 3, dk);
    rect(g, 6, 11, 1, 1, st[0]);
    g.set(5, 10, st[1]);
    for (let y = 11; y < 15; y++) for (let x = 18; x < 22; x++) g.set(x, y, null);
    for (const [x, y, t] of [[18, 11, 1], [19, 12, 2], [20, 11, 1], [19, 10, 0]] as [number, number, number][]) g.set(x, y, st[t]);
    // gruz
    for (const [x, y, t] of [[8, 14, 2], [9, 14, 1], [9, 13, 3], [14, 14, 2], [15, 13, 1], [15, 14, 0], [20, 14, 2], [3, 14, 1], [19, 14, 1]] as [number, number, number][]) g.set(x, y, st[t]);
    g.set(13, 14, st[3]);
  }
  outline(g);
  return g;
}

// --- pociski ---

function strzala(): Grid {
  const g = new Grid(9, 3);
  for (let x = 1; x < 7; x++) g.set(x, 1, x % 2 ? '#7a4e26' : '#9a6a36');
  g.set(7, 1, '#cfd8e4');
  g.set(8, 1, '#ffffff');
  g.set(7, 0, '#8f99a8');
  g.set(7, 2, '#8f99a8');
  g.set(0, 0, '#e8e0c0');
  g.set(1, 0, '#c83c2c');
  g.set(0, 2, '#e8e0c0');
  g.set(1, 2, '#c83c2c');
  g.set(0, 1, '#e8e0c0');
  return g;
}

function belt(): Grid {
  const g = new Grid(9, 3);
  for (let x = 0; x < 6; x++) {
    g.set(x, 1, x % 2 ? '#3a2514' : '#523319');
  }
  g.set(0, 0, '#8a7a5a');
  g.set(0, 2, '#8a7a5a');
  g.set(1, 0, '#6a5a3a');
  g.set(1, 2, '#6a5a3a');
  for (let y = 0; y < 3; y++) g.set(6, y, '#5c6470');
  g.set(7, 0, '#8f99a8');
  g.set(7, 1, '#cfd8e4');
  g.set(7, 2, '#8f99a8');
  g.set(8, 1, '#ffffff');
  return g;
}

function smolaBlob(): Grid {
  const g = new Grid(5, 5);
  ell(g, 2.5, 2.6, 2.4, 2.3, R.tar, { b: 0.1 });
  g.set(1, 1, '#b4b4c4');
  g.set(1, 2, '#6a6a78');
  g.set(2, 1, '#6a6a78');
  g.set(3, 4, '#0a0a0e');
  return g;
}

// --- Syrenka ---

function syrenka(): Grid {
  const g = new Grid(28, 46);
  const P = R.patina, B = R.bronze, S = R.stone;
  // misa fontanny
  ell(g, 14, 40.8, 13.5, 3.8, R.stoneDark, { flat: 1 });
  ell(g, 14, 39.6, 13.5, 3.8, S, { b: 0.1 });
  ell(g, 14, 39.4, 11.4, 2.5, R.water, { flat: 2 });
  ell(g, 14, 38.9, 8.6, 1.3, R.water, { flat: 1 });
  for (const [x, y] of [[5, 39], [20, 40], [9, 41], [18, 38], [23, 39]]) g.set(x, y, R.water[3]);
  // postument
  bricks(g, 7, 35, 14, 4, S, { bw: 5, ref: [7, 14] });
  rect(g, 7, 35, 14, 1, S[3]);
  bricks(g, 9, 29, 10, 6, S, { bw: 5, ref: [9, 10] });
  rect(g, 8, 27, 12, 3, S[2]);
  rect(g, 8, 27, 12, 1, S[3]);
  rect(g, 8, 29, 12, 1, S[0]);
  rect(g, 13, 31, 2, 3, B[2]);
  g.set(13, 31, B[3]);
  for (const [x, y] of [[5, 36], [4, 37], [4, 38], [6, 35], [22, 36], [23, 37], [23, 38], [21, 35]]) g.set(x, y, R.water[3 - (x % 2)]);
  // włosy (za postacią)
  ell(g, 14, 7.6, 3.9, 4.2, B, { n: 0.2 });
  poly(g, [[10.4, 8], [9.8, 17], [12.6, 15]], B, { n: 0.15 });
  poly(g, [[17.6, 8], [18.2, 17], [15.4, 15]], B, { n: 0.15 });
  // ogon: łańcuch elips po krzywej + płetwa
  const tail: [number, number, number, number][] = [[14, 16.6, 3.4, 2.4], [14.2, 19, 3.1, 2.4], [15, 21.6, 2.7, 2.3], [16.8, 23.8, 2.3, 2], [19.2, 24.8, 1.9, 1.6]];
  for (const [x, y, rx, ry] of tail) ell(g, x, y, rx, ry, P, { b: 0.1 });
  poly(g, [[19.5, 25.6], [21.5, 27], [25, 26.2], [26, 22.4], [24, 23.8], [22.4, 21.2], [21.4, 24.2]], P, { edge: true, b: 0.1 });
  for (let y = 15; y < 28; y++)
    for (let x = 10; x < 27; x++) {
      const c = g.at(x, y);
      if (c && (x + 2 * (y & 1)) % 4 === 0 && (c === P[2] || c === P[3])) g.set(x, y, P[1]);
    }
  // tors
  ell(g, 14, 12, 3.3, 4, P, { b: 0.1 });
  g.set(13, 11, P[3]);
  g.set(15, 11, P[3]);
  rect(g, 11, 14, 6, 1, B[1]);
  // głowa
  ell(g, 14, 7, 2.5, 2.9, P, { b: 0.2 });
  g.set(13, 7, '#0e2a24');
  g.set(15, 7, '#0e2a24');
  g.set(14, 9, P[1]);
  // prawa ręka z mieczem
  line(g, 11, 10, 8, 6.4, P[2], 2);
  line(g, 11, 11, 8, 7.2, P[1], 1);
  ell(g, 8, 6.2, 1.2, 1.2, P);
  line(g, 8, 5, 8, 0, '#f6efc0', 1);
  line(g, 9, 4.6, 9, 1.4, '#b0a878', 1);
  g.set(8, 0, '#ffffff');
  rect(g, 5, 4, 6, 1, B[3]);
  g.set(5, 4, B[2]);
  g.set(10, 4, B[2]);
  // lewa ręka z tarczą
  line(g, 17, 10, 19.4, 12.5, P[1], 2);
  ell(g, 20.8, 13.6, 4, 4.6, B, { b: 0.1 });
  ell(g, 20.8, 13.6, 2.7, 3.3, B, { flat: 2 });
  ell(g, 20.4, 13.2, 1.1, 1.3, B, { flat: 3 });
  g.set(23, 11, B[3]);
  g.set(18, 9, B[3]);
  outline(g);
  return g;
}

// --- brama ---

function gate(): Grid {
  const g = new Grid(22, 22);
  ell(g, 11, 19.4, 10.6, 2.6, R.dirt, { n: 0.2 });
  // wnętrze jaskini
  poly(g, [[6, 19.4], [6, 12], [8, 9.6], [14, 9.6], [16, 12], [16, 19.4]], ['#030202', '#0c0807', '#191110', '#2a1c16'], { flat: 1 });
  for (let y = 13; y < 19; y++) for (let x = 7; x < 16; x++) if (g.at(x, y) && (x + y) % 3 === 0) g.set(x, y, '#030202');
  g.set(9, 15, '#e8c030');
  g.set(13, 15, '#e8c030');
  // zaostrzony pal
  const stake = (x: number, y0: number, w: number) => {
    for (let y = y0 + 2; y < 20; y++) for (let i = 0; i < w; i++) g.set(x + i, y, i === 0 ? R.wood[3 - (y % 5 === 0 ? 1 : 0)] : i === w - 1 ? R.wood[1] : R.wood[2]);
    for (let i = 0; i < w; i++) g.set(x + i, y0 + 1, i === 0 ? R.wood[3] : R.wood[2]);
    const m = Math.floor(w / 2);
    g.set(x + m, y0, R.wood[3]);
    if (w > 2) { g.set(x + m - 1, y0 + 1, R.wood[3]); }
  };
  [[0, 10, 2], [2, 8, 2], [4, 3, 3]].forEach(([x, y, w]) => stake(x, y, w));
  [[15, 3, 3], [18, 8, 2], [20, 10, 2]].forEach(([x, y, w]) => stake(x, y, w));
  // nadproże
  planks(g, 4, 9, 14, 3, R.woodLight);
  rect(g, 4, 9, 14, 1, R.woodLight[3]);
  rect(g, 4, 11, 14, 1, R.woodLight[0]);
  for (const x of [5, 16]) { g.set(x, 10, R.steel[3]); }
  // proporzec
  line(g, 17, 0, 17, 4, R.wood[1]);
  g.set(17, 0, R.gold[3]);
  poly(g, [[16.4, 0.8], [16.4, 4.6], [9.4, 2.6]], R.red, { edge: true });
  g.set(12, 2, R.red[3]);
  outline(g);
  return g;
}

// --- rejestr ---

function build(id: SpriteId): Grid {
  seed(id);
  let m: RegExpMatchArray | null;
  if ((m = id.match(/^dzik_atk_(\d)$/))) return boar(0, { atk: +m[1] });
  if ((m = id.match(/^(\w+?)_(\d)$/)) && !id.startsWith('krol')) {
    const f = +m[2];
    switch (m[1]) {
      case 'dzik': return boar(f, {});
      case 'lis': return fox(f);
      case 'jelen': return deer(f);
      case 'wilk': return wolf(f);
      case 'lucznik': case 'kusznik': case 'smola': case 'balista': case 'bombarda': return tower(m[1], f as 1 | 2 | 3);
    }
  }
  if ((m = id.match(/^krol_dzik_(\d)$/))) return boar(+m[1], { k: 1.36, king: true });
  switch (id) {
    case 'wall': return wall(false);
    case 'wall_damaged': return wall(true);
    case 'strzala': return strzala();
    case 'belt': return belt();
    case 'smola': return smolaBlob();
    case 'syrenka': return syrenka();
    case 'gate': return gate();
  }
  throw new Error('sprite? ' + id);
}

const cache = new Map<SpriteId, HTMLCanvasElement>();
const flipped = new Map<SpriteId, HTMLCanvasElement>();
const icons = new Map<string, string>();

const makeCanvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

export function getSprite(id: SpriteId): HTMLCanvasElement {
  let c = cache.get(id);
  if (c) return c;
  const g = build(id);
  c = makeCanvas(g.w, g.h);
  const ctx = c.getContext('2d')!;
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      const col = g.at(x, y);
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  cache.set(id, c);
  return c;
}

export function spriteSize(id: SpriteId): { w: number; h: number } {
  const c = getSprite(id);
  return { w: c.width, h: c.height };
}

export function getFlipped(id: SpriteId): HTMLCanvasElement {
  let c = flipped.get(id);
  if (c) return c;
  const src = getSprite(id);
  c = makeCanvas(src.width, src.height);
  const ctx = c.getContext('2d')!;
  ctx.translate(src.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(src, 0, 0);
  flipped.set(id, c);
  return c;
}

/** Ikona do HUD: sprite przeskalowany całkowitą krotnością tak, by zmieścić się w size px. */
export function spriteIcon(id: SpriteId, size: number): string {
  const key = id + '@' + size;
  let u = icons.get(key);
  if (u) return u;
  const src = getSprite(id);
  const k = Math.max(1, Math.floor(size / Math.max(src.width, src.height)));
  const c = makeCanvas(src.width * k, src.height * k);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  icons.set(key, (u = c.toDataURL()));
  return u;
}
