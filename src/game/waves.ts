import type { Enemy, EnemyKind, GameState, Level } from './types';
import { WAVE_BREAK } from './config';
import { spawnEnemy } from './enemies';
import { chooseEntrance, endWaveLearning } from './ai';
import { say } from './state';

export interface Group {
  kind: EnemyKind;
  count: number;
  /** Odstęp między osobnikami (s); dla stad odstęp między stadami. */
  interval: number;
  /** Opóźnienie startu grupy (s). */
  delay: number;
  /** Rozmiar stada (wilki): jedno wejście, przewodnik + naśladowcy. */
  pack?: number;
  hpMul?: number;
}

const G = (kind: EnemyKind, count: number, interval: number, delay = 0, pack?: number, hpMul?: number): Group =>
  ({ kind, count, interval, delay, pack, hpMul });

// Mało pól na wieże i 10 wejść => małe, ale rosnące fale (liczebności dostrojone bot-simem, scripts/sim.ts).
export const WAVES: Group[][] = [
  [G('lis', 1, 1.6), G('dzik', 1, 3, 4)],
  [G('dzik', 1, 2.4), G('lis', 1, 1.4, 3)],
  [G('lis', 2, 1.2), G('dzik', 1, 2.4, 3)],
  [G('wilk', 1, 4, 0, 2), G('dzik', 1, 2.4, 2)],
  [G('dzik', 3, 1.2), G('jelen', 1, 2.2, 4)],
  [G('wilk', 3, 5, 0, 2), G('jelen', 2, 1.8, 3), G('lis', 3, 1.2, 6)],
  [G('dzik', 3, 1.8), G('jelen', 3, 1.5, 2), G('wilk', 3, 5, 4, 3)],
  [G('lis', 4, 0.9), G('wilk', 3, 4, 2, 3), G('dzik', 3, 1.8, 5)],
  [G('jelen', 3, 1.5), G('wilk', 3, 4, 2, 3), G('dzik', 3, 1.5, 4)],
  [G('dzik', 4, 0.9), G('krol_dzik', 1, 1, 10, undefined, 0.5), G('jelen', 2, 1.3, 4)],
  [G('wilk', 4, 3.5, 0, 4), G('jelen', 3, 1.3, 2), G('dzik', 4, 1.4, 4)],
  [G('lis', 5, 0.8), G('wilk', 4, 3.2, 2, 4), G('dzik', 4, 1.4, 5), G('jelen', 3, 1.3, 6)],
  [G('dzik', 5, 1.2), G('jelen', 4, 1.1, 2), G('wilk', 4, 3.2, 4, 4)],
  [G('wilk', 5, 3.2, 0, 5), G('jelen', 4, 1.1, 2), G('lis', 5, 0.7, 4), G('dzik', 5, 1.2, 6)],
  [G('dzik', 7, 0.7), G('wilk', 4, 3.2, 2, 5), G('jelen', 3, 1.1, 4), G('krol_dzik', 1, 1, 14, undefined, 1.0), G('dzik', 6, 0.6, 12)],
];

export const totalWaves = (): number => WAVES.length;

interface Item { at: number; kind: EnemyKind; pack: number; first: boolean; hpMul: number }
interface Runner {
  queue: Item[];
  next: number;
  elapsed: number;
  packs: Map<number, { entrance: number; leader: Enemy | null }>;
}
const runners = new WeakMap<GameState, Runner>();

export function nextWavePreview(state: GameState): { kind: EnemyKind; count: number }[] {
  const idx = Math.min(WAVES.length - 1, state.phase === 'wave' ? state.wave - 1 : state.wave);
  const m = new Map<EnemyKind, number>();
  for (const g of WAVES[Math.max(0, idx)]) m.set(g.kind, (m.get(g.kind) ?? 0) + g.count);
  return [...m].map(([kind, count]) => ({ kind, count }));
}

export function startNextWave(state: GameState): void {
  if (state.phase !== 'build' || state.wave >= WAVES.length) return;
  const queue: Item[] = [];
  let packId = 0;
  for (const g of WAVES[state.wave]) {
    const hpMul = g.hpMul ?? 1;
    if (g.pack) {
      for (let s = 0; s * g.pack < g.count; s++) {
        const size = Math.min(g.pack, g.count - s * g.pack);
        packId++;
        for (let i = 0; i < size; i++) queue.push({ at: g.delay + s * g.interval + i * 0.5, kind: g.kind, pack: packId, first: i === 0, hpMul });
      }
    } else {
      for (let i = 0; i < g.count; i++) queue.push({ at: g.delay + i * g.interval, kind: g.kind, pack: 0, first: true, hpMul });
    }
  }
  queue.sort((a, b) => a.at - b.at);
  runners.set(state, { queue, next: 0, elapsed: 0, packs: new Map() });
  state.wave++;
  state.phase = 'wave';
  state.nextWaveIn = 0;
  say(state, `Fala ${state.wave} nadciąga!`);
}

export function updateWaves(state: GameState, level: Level, dt: number): void {
  if (state.phase === 'build') {
    state.nextWaveIn -= dt;
    if (state.nextWaveIn <= 0) startNextWave(state);
    return;
  }
  if (state.phase !== 'wave') return;
  const r = runners.get(state);
  if (!r) return;
  r.elapsed += dt;
  while (r.next < r.queue.length && r.queue[r.next].at <= r.elapsed) {
    const q = r.queue[r.next++];
    if (q.pack) {
      let p = r.packs.get(q.pack);
      if (!p) { p = { entrance: chooseEntrance(state, level), leader: null }; r.packs.set(q.pack, p); }
      const e = spawnEnemy(state, level, q.kind, p.entrance, p.leader, q.hpMul);
      if (e && !p.leader) p.leader = e;
    } else {
      spawnEnemy(state, level, q.kind, chooseEntrance(state, level), null, q.hpMul);
    }
  }
  if (r.next < r.queue.length || state.enemies.length > 0) return;
  endWaveLearning(state, level);
  if (state.wave >= WAVES.length) {
    state.phase = 'won';
    say(state, 'Syrenka obroniona! Zwycięstwo!', 60);
    return;
  }
  const bonus = 50 + 12 * state.wave;
  state.gold += bonus;
  state.phase = 'build';
  state.nextWaveIn = WAVE_BREAK;
  say(state, `Fala ${state.wave} odparta! Premia +${bonus} zł`, 3.5);
}
