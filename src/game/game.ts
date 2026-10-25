import type { BuildKind, GameState, Level, LngLat } from './types';
import { SELL_RATIO, TOWER_STATS, WALL_MAX_ROAD_DIST, WALL_STATS, wallRepairCost } from './config';
import { distM } from './geo';
import { cellAt, nearestEdge } from './graph';
import { edgeMid } from './walls';
import { say } from './state';
import { updateWaves } from './waves';
import { repathAll, updateEnemies } from './enemies';
import { updateProjectiles, updateTowers } from './towers';
import { placeWall } from './walls';

export { startNextWave, nextWavePreview, totalWaves } from './waves';
export { createGame } from './state';

const SELECT_RADIUS = 6.5;
const WALL_SELL_RADIUS = 9;
const costOf = (k: BuildKind) => (k === 'wall' ? WALL_STATS.cost : TOWER_STATS[k].levels[0].cost);
const over = (s: GameState) => s.phase === 'lost' || s.phase === 'won';

export function step(state: GameState, level: Level, dt: number): void {
  if (over(state)) return;
  state.time += dt;
  updateWaves(state, level, dt);
  updateEnemies(state, level, dt);
  updateTowers(state, level, dt);
  updateProjectiles(state, dt);
  for (const f of state.effects) f.t += dt;
  state.effects = state.effects.filter((f) => f.t < f.dur);
  if (state.message && state.time > state.message.until) state.message = null;
  for (const [e, t] of state.tracks) if (state.time - t > 40) state.tracks.delete(e);
}

export function occupiedCells(state: GameState): Set<number> {
  return new Set(state.towers.map((t) => t.cell));
}

export function snapBuild(
  state: GameState, level: Level, kind: BuildKind, pos: LngLat,
): { pos: LngLat; cell: number; edge: number; error: string | null } {
  if (over(state)) return { pos, cell: -1, edge: -1, error: 'Gra zakończona' };
  const cost = costOf(kind);
  if (kind === 'wall') {
    const ne = nearestEdge(level, pos);
    if (ne.edge < 0 || ne.dist > WALL_MAX_ROAD_DIST) return { pos, cell: -1, edge: -1, error: 'Mur tylko na drodze' };
    const [a, b] = level.edges[ne.edge];
    const bad = level.entrances.some((en) => en.node === a || en.node === b) || a === level.goal.node || b === level.goal.node;
    const error = bad
      ? 'Nie można zamurować przy wejściu ani przy Syrence'
      : state.walls.some((w) => w.edge === ne.edge) ? 'Ta uliczka jest już zamurowana'
      : state.gold < cost ? 'Za mało złota!' : null;
    return { pos: edgeMid(level, ne.edge), cell: -1, edge: ne.edge, error };
  }
  const cell = cellAt(level, pos);
  if (cell < 0) return { pos, cell: -1, edge: -1, error: 'Wieże stawia się przy drodze' };
  const error = state.towers.some((t) => t.cell === cell) ? 'Pole zajęte' : state.gold < cost ? 'Za mało złota!' : null;
  return { pos: level.cells.centers[cell], cell, edge: -1, error };
}

export function tryBuild(state: GameState, level: Level, kind: BuildKind, pos: LngLat): boolean {
  const r = snapBuild(state, level, kind, pos);
  if (r.error) {
    say(state, r.error);
    return false;
  }
  state.gold -= costOf(kind);
  if (kind === 'wall') placeWall(state, level, r.edge);
  else {
    state.towers.push({
      id: state.nextId++, kind, level: 1, cell: r.cell, pos: r.pos, cooldown: 0, spent: costOf(kind), lastTarget: null,
    });
    state.effects.push({ kind: 'puff', pos: r.pos, t: 0, dur: 0.5 });
  }
  return true;
}

function towerAt(state: GameState, level: Level, pos: LngLat) {
  const cell = cellAt(level, pos);
  const byCell = cell >= 0 ? state.towers.find((t) => t.cell === cell) : undefined;
  if (byCell) return byCell;
  let best: GameState['towers'][number] | undefined;
  let bd = SELECT_RADIUS;
  for (const t of state.towers) {
    const d = distM(t.pos, pos);
    if (d <= bd) { bd = d; best = t; }
  }
  return best;
}

function wallNear(state: GameState, pos: LngLat) {
  let best: GameState['walls'][number] | undefined;
  let bd = WALL_SELL_RADIUS;
  for (const w of state.walls) {
    const d = distM(w.pos, pos);
    if (d <= bd) { bd = d; best = w; }
  }
  return best;
}

/** Zaznacza wieżę, a gdy jej nie ma - mur (zaznaczenia się wykluczają). Zwraca id wieży. */
export function selectAt(state: GameState, level: Level, pos: LngLat): number | null {
  const t = towerAt(state, level, pos);
  state.selectedTowerId = t?.id ?? null;
  state.selectedWallId = t ? null : wallNear(state, pos)?.id ?? null;
  return state.selectedTowerId;
}

export function repairWall(state: GameState, id: number): boolean {
  const w = state.walls.find((x) => x.id === id);
  if (!w || over(state)) return false;
  const cost = wallRepairCost(w.hp, w.maxHp);
  if (cost <= 0) { say(state, 'Mur jest cały'); return false; }
  if (state.gold < cost) { say(state, 'Za mało złota!'); return false; }
  state.gold -= cost;
  w.hp = w.maxHp;
  state.effects.push({ kind: 'levelup', pos: w.pos, t: 0, dur: 0.9 });
  say(state, `Naprawiono mur (-${cost} zł)`);
  return true;
}

export function sellWall(state: GameState, level: Level, id: number): boolean {
  const i = state.walls.findIndex((x) => x.id === id);
  if (i < 0 || over(state)) return false;
  const [w] = state.walls.splice(i, 1);
  const refund = Math.floor(WALL_STATS.cost * SELL_RATIO);
  state.gold += refund;
  state.effects.push({ kind: 'coin', pos: w.pos, t: 0, dur: 0.9 });
  if (state.selectedWallId === id) state.selectedWallId = null;
  say(state, `Sprzedano ${WALL_STATS.name} (+${refund} zł)`);
  repathAll(state, level);
  return true;
}

export function upgradeTower(state: GameState, id: number): boolean {
  const t = state.towers.find((x) => x.id === id);
  if (!t || over(state)) return false;
  if (t.level >= 3) { say(state, 'Maksymalny poziom'); return false; }
  const cost = TOWER_STATS[t.kind].levels[t.level].cost;
  if (state.gold < cost) { say(state, 'Za mało złota!'); return false; }
  state.gold -= cost;
  t.spent += cost;
  t.level++;
  state.effects.push({ kind: 'levelup', pos: t.pos, t: 0, dur: 0.9 });
  return true;
}

/** Potwierdzenie sprzedaży (czas rzeczywisty): wieża 3. poziomu wymaga drugiego kliknięcia w ciągu 2 s. */
let pendingSell: { key: string; until: number } | null = null;
function confirmSell(state: GameState, key: string, what: string, refund: number, via?: string): boolean {
  const now = performance.now();
  if (pendingSell && pendingSell.key === key && now < pendingSell.until) { pendingSell = null; return true; }
  pendingSell = { key, until: now + 2000 };
  say(state, `${via ?? 'PPM'} jeszcze raz, by sprzedać: ${what} (+${refund} zł)`, 2.5);
  return false;
}

export function sellTower(state: GameState, _level: Level, id: number, via?: string): boolean {
  const i = state.towers.findIndex((x) => x.id === id);
  if (i < 0 || over(state)) return false;
  const t = state.towers[i];
  const refund = Math.floor(t.spent * SELL_RATIO);
  const name = TOWER_STATS[t.kind].name;
  if (t.level >= 3 && !confirmSell(state, `t${id}`, `${name} (poz. 3)`, refund, via)) return false;
  state.towers.splice(i, 1);
  state.gold += refund;
  state.effects.push({ kind: 'coin', pos: t.pos, t: 0, dur: 0.9 });
  if (state.selectedTowerId === id) state.selectedTowerId = null;
  say(state, `Sprzedano ${name} (+${refund} zł)`);
  return true;
}

export function sellAt(state: GameState, level: Level, pos: LngLat): boolean {
  if (over(state)) return false;
  const t = towerAt(state, level, pos);
  if (t) return sellTower(state, level, t.id);
  const w = wallNear(state, pos);
  return w ? sellWall(state, level, w.id) : false;
}
