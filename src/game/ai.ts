import type { AiMemory, Enemy, EnemyKind, GameState, Level, LngLat } from './types';
import { AI, ENEMY_STATS, TOWER_STATS, WALL_PATH_PENALTY } from './config';
import { distM, lerp } from './geo';
import { distToGoal, findPathWeighted } from './graph';

/** Zagrożenie 1.0 ~ jedna wieża (łucznik 1. poziomu) pokrywająca całą krawędź. */
export const DANGER_SCALE = 1;
const DMG_REF = 40;
const DPS_REF = 10;
const Q = 1;
const DMG_PENALTY = 0.3;
const EMA = 0.6;
const BASE_REWARD = 0.5;

interface Pending {
  dmg: Float32Array;
  dep: Float32Array;
  dangerSum: number;
  lenSum: number;
  rew: number[];
}
const pend = new WeakMap<AiMemory, Pending>();

export function createAi(level: Level): AiMemory {
  const E = level.edges.length;
  const n = level.entrances.length;
  const ai: AiMemory = {
    danger: new Float32Array(E),
    tau: new Float32Array(E),
    entranceW: level.entrances.map(() => 1),
    entranceStats: level.entrances.map(() => ({ sent: 0, reached: 0, progress: 0, dmg: 0 })),
    log: [],
  };
  pend.set(ai, { dmg: new Float32Array(E), dep: new Float32Array(E), dangerSum: 0, lenSum: 0, rew: new Array(n).fill(BASE_REWARD) });
  return ai;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Trasa dla zwierzęcia; `seed` daje stadu wspólny szum (ta sama trasa). */
export function planRoute(state: GameState, level: Level, kind: EnemyKind, fromNode: number, seed?: number): number[] | null {
  const to = level.goal.node;
  if (fromNode === to) return [fromNode];
  const { danger, tau } = state.ai;
  const risk = ENEMY_STATS[kind].risk;
  const E = level.edges.length;
  const rnd = seed === undefined ? Math.random : mulberry(seed * 7919 + 13);
  const noise = new Float32Array(E);
  for (let i = 0; i < E; i++) noise[i] = 1 - AI.noise + 2 * AI.noise * rnd();
  const base = (e: number) =>
    (level.edges[e][2] * (1 + (risk * danger[e]) / DANGER_SCALE)) / (1 + AI.tauWeight * tau[e]) * noise[e];
  if (!state.walls.length) return findPathWeighted(level, fromNode, to, base, 0);
  const walled = new Set(state.walls.map((w) => w.edge));
  return (
    findPathWeighted(level, fromNode, to, (e) => (walled.has(e) ? Infinity : base(e)), 0) ??
    findPathWeighted(level, fromNode, to, (e) => base(e) + (walled.has(e) ? WALL_PATH_PENALTY : 0), 0)
  );
}

export function chooseEntrance(state: GameState, _level: Level): number {
  const w = state.ai.entranceW;
  let sum = 0;
  for (const x of w) sum += x;
  let r = Math.random() * sum;
  for (let i = 0; i < w.length; i++) {
    r -= w[i];
    if (r <= 0) return i;
  }
  return w.length - 1;
}

export function recordSpawn(ai: AiMemory, entrance: number): void {
  ai.entranceStats[entrance].sent++;
}

export function recordDamage(ai: AiMemory, edge: number, dmg: number): void {
  if (edge >= 0) pend.get(ai)!.dmg[edge] += dmg;
}

export function recordWalk(ai: AiMemory, edge: number, len: number): void {
  const p = pend.get(ai)!;
  p.dangerSum += ai.danger[edge] * len;
  p.lenSum += len;
}

export function progressFrac(level: Level, e: Enemy): number {
  const d = distToGoal(level);
  const d0 = d[level.entrances[e.entrance].node];
  const dc = d[e.path[Math.min(e.pathIdx, e.path.length - 1)]];
  if (!(d0 > 0) || !isFinite(dc)) return 0;
  return Math.max(0, Math.min(1, 1 - dc / d0));
}

/** Zwierzę skończyło bieg (dotarło albo zginęło) — statystyki i feromon. */
export function recordOutcome(state: GameState, level: Level, e: Enemy, reached: boolean): void {
  const ai = state.ai;
  const s = ai.entranceStats[e.entrance];
  const frac = reached ? 1 : progressFrac(level, e);
  s.progress += frac;
  s.dmg += Math.min(1, e.dmgTaken / e.maxHp);
  if (reached) s.reached++;
  const q = reached ? Q : Q * frac * frac * 0.3;
  const dep = pend.get(ai)!.dep;
  for (const edge of e.walked) dep[edge] += q;
}

interface Samples { pts: LngLat[][] }
const sampleCache = new WeakMap<Level, Samples>();
function samples(level: Level): Samples {
  let s = sampleCache.get(level);
  if (!s) {
    s = {
      pts: level.edges.map(([a, b, len]) => {
        const n = Math.max(1, Math.ceil(len / 8));
        const out: LngLat[] = [];
        for (let i = 0; i < n; i++) out.push(lerp(level.nodes[a], level.nodes[b], (i + 0.5) / n));
        return out;
      }),
    };
    sampleCache.set(level, s);
  }
  return s;
}

/** Pokrycie krawędzi wieżami w jednostkach "łucznik 1 poz.". */
function coverage(state: GameState, level: Level): Float32Array {
  const cov = new Float32Array(level.edges.length);
  const { pts } = samples(level);
  for (const t of state.towers) {
    const st = TOWER_STATS[t.kind];
    const lv = st.levels[t.level - 1];
    const w = ((lv.damage / lv.reload) * (t.kind === 'smola' ? 1.5 : 1)) / DPS_REF;
    for (let e = 0; e < pts.length; e++) {
      let n = 0;
      for (const p of pts[e]) if (distM(t.pos, p) <= lv.range) n++;
      if (n) cov[e] += (w * n) / pts[e].length;
    }
  }
  return cov;
}

/** Koniec fali: log, bandyta wejść, zagrożenie, feromon. */
export function endWaveLearning(state: GameState, level: Level): void {
  const ai = state.ai;
  const p = pend.get(ai)!;
  const st = ai.entranceStats;
  const n = st.length;
  let total = 0, reached = 0;
  for (const s of st) { total += s.sent; reached += s.reached; }
  ai.log.push({
    wave: state.wave,
    entranceShare: st.map((s) => (total ? s.sent / total : 0)),
    meanDanger: p.lenSum ? p.dangerSum / p.lenSum : 0,
    reached,
  });

  st.forEach((s, i) => {
    if (!s.sent) return;
    const r = s.progress / s.sent - DMG_PENALTY * (s.dmg / s.sent);
    p.rew[i] = p.rew[i] * (1 - EMA) + r * EMA;
  });
  const ex = p.rew.map((r) => Math.exp(r / AI.temperature));
  const sum = ex.reduce((a, b) => a + b, 0);
  // przy wielu wejściach podłoga nie może zjeść całego rozkładu
  const m = Math.min(AI.minEntranceShare, 0.3 / n);
  ai.entranceW = ex.map((x) => m + (1 - n * m) * (x / sum));

  const cov = coverage(state, level);
  const k = Math.max(1, total);
  for (let e = 0; e < ai.danger.length; e++) {
    ai.danger[e] = ai.danger[e] * AI.dangerDecay + p.dmg[e] / (DMG_REF * k) + cov[e];
    ai.tau[e] = ai.tau[e] * AI.tauDecay + p.dep[e] / k;
  }
  p.dmg.fill(0);
  p.dep.fill(0);
  p.dangerSum = 0;
  p.lenSum = 0;
  for (const s of st) { s.sent = 0; s.reached = 0; s.progress = 0; s.dmg = 0; }
}
