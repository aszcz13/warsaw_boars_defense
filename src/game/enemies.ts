import type { Enemy, EnemyKind, GameState, Level } from './types';
import { ENEMY_STATS } from './config';
import { distM, lerp } from './geo';
import { edgeBetween } from './graph';
import { say } from './state';
import { planRoute, recordDamage, recordOutcome, recordSpawn, recordWalk } from './ai';

/** Wzrost HP na falę (bot-sim: 0.11, żeby przewaga zagęszczenia/ulepszeń nie dawała zwycięstwa bez strat). */
const HP_GROWTH = 0.10;
const seedOf = (e: Enemy): number | undefined => e.leaderId ?? (ENEMY_STATS[e.kind].pack ? e.id : undefined);

export function spawnEnemy(
  state: GameState, level: Level, kind: EnemyKind, entranceIdx: number, leader: Enemy | null = null, hpMul = 1,
): Enemy | null {
  const st = ENEMY_STATS[kind];
  const id = state.nextId++;
  const start = level.entrances[entranceIdx].node;
  const path = planRoute(state, level, kind, start, leader ? leader.id : st.pack ? id : undefined);
  if (!path) return null;
  const hp = st.hp * (1 + HP_GROWTH * Math.max(0, state.wave - 1)) * hpMul;
  const e: Enemy = {
    id, kind, pos: level.nodes[start], hp, maxHp: hp, speed: st.speed, slowUntil: 0,
    entrance: entranceIdx, path, pathIdx: 0, progress: 0, curEdge: -1, walked: [], dmgTaken: 0,
    leaderId: leader ? leader.id : null, attackingWall: null, animT: Math.random() * 2, facing: 1,
  };
  state.enemies.push(e);
  recordSpawn(state.ai, entranceIdx);
  return e;
}

/** Zadaje obrażenia i zapisuje je w pamięci stada na bieżącej krawędzi. */
export function damageEnemy(state: GameState, e: Enemy, dmg: number): void {
  e.hp -= dmg;
  e.dmgTaken += dmg;
  recordDamage(state.ai, e.curEdge >= 0 ? e.curEdge : e.walked.length ? e.walked[e.walked.length - 1] : -1, dmg);
}

/** Przelicza ścieżki; wróg najpierw dochodzi do węzła, do którego zmierza (bez teleportacji). */
export function repathAll(state: GameState, level: Level): void {
  const walled = new Set(state.walls.map((w) => w.edge));
  for (const e of state.enemies) {
    e.attackingWall = null;
    const cur = e.path[e.pathIdx];
    if (e.progress > 0 && e.pathIdx + 1 < e.path.length) {
      const nxt = e.path[e.pathIdx + 1];
      const ei = edgeBetween(level, cur, nxt);
      // Wróg przed murem na swojej krawędzi: jeśli jest objazd, zawraca (bez teleportu:
      // ta sama krawędź w przeciwnym kierunku, progress = len - progress).
      if (ei >= 0 && walled.has(ei) && e.progress < level.edges[ei][2] / 2) {
        const back = planRoute(state, level, e.kind, cur, seedOf(e));
        const detour = back && back.length > 1 && back.every((n, i) => {
          if (i + 1 >= back.length) return true;
          const bi = edgeBetween(level, n, back[i + 1]);
          return bi !== ei && !walled.has(bi);
        });
        if (back && detour) {
          e.progress = level.edges[ei][2] - e.progress;
          e.path = [nxt, ...back];
          e.pathIdx = 0;
          continue;
        }
      }
      const rest = planRoute(state, level, e.kind, e.path[e.pathIdx + 1], seedOf(e));
      if (!rest) continue;
      e.path = [cur, ...rest];
      e.pathIdx = 0;
    } else {
      const p = planRoute(state, level, e.kind, cur, seedOf(e));
      if (!p) continue;
      e.path = p;
      e.pathIdx = 0;
      e.progress = 0;
    }
  }
}

function removeDead(state: GameState, level: Level): void {
  if (!state.enemies.some((e) => e.hp <= 0)) return;
  state.enemies = state.enemies.filter((e) => {
    if (e.hp > 0) return true;
    state.gold += ENEMY_STATS[e.kind].bounty;
    state.effects.push(
      { kind: e.kind === 'lis' || e.kind === 'jelen' ? 'feathers' : 'blood', pos: e.pos, t: 0, dur: 0.6 },
      { kind: 'coin', pos: e.pos, t: 0, dur: 0.9 },
    );
    recordOutcome(state, level, e, false);
    return false;
  });
}

export function updateEnemies(state: GameState, level: Level, dt: number): void {
  removeDead(state, level);
  const walls = new Map(state.walls.map((w) => [w.edge, w]));
  const reached: Enemy[] = [];
  let wallBroken = false;

  for (const e of state.enemies) {
    e.animT += dt;
    let remaining = e.speed * dt * (state.time < e.slowUntil ? 0.5 : 1);
    e.attackingWall = null;
    while (remaining > 0) {
      if (e.pathIdx >= e.path.length - 1) {
        reached.push(e);
        break;
      }
      const a = e.path[e.pathIdx], b = e.path[e.pathIdx + 1];
      const ei = edgeBetween(level, a, b);
      const len = ei >= 0 ? level.edges[ei][2] : distM(level.nodes[a], level.nodes[b]);
      const wall = ei >= 0 ? walls.get(ei) : undefined;
      const mid = len / 2;
      // Mur stoi w środku krawędzi: blokuje tylko, jeśli jest przed wrogiem (w obu kierunkach).
      const ahead = wall !== undefined && e.progress <= mid + 1e-6;
      if (wall && ahead && e.progress >= mid - 1e-6) {
        e.progress = mid;
        e.attackingWall = wall.id;
        wall.hp -= ENEMY_STATS[e.kind].wallDamage * dt;
        if (wall.hp <= 0) wallBroken = true;
        break;
      }
      if (ei >= 0) state.tracks.set(ei, state.time);
      const limit = ahead ? mid : len;
      const step = Math.min(remaining, limit - e.progress);
      e.progress += step;
      remaining -= step;
      if (e.progress >= len - 1e-6) {
        if (ei >= 0) {
          e.walked.push(ei);
          recordWalk(state.ai, ei, len);
        }
        e.pathIdx++;
        e.progress = 0;
      }
    }
    if (e.pathIdx < e.path.length - 1) {
      const a = e.path[e.pathIdx], b = e.path[e.pathIdx + 1];
      const ei = edgeBetween(level, a, b);
      const len = ei >= 0 ? level.edges[ei][2] : distM(level.nodes[a], level.nodes[b]);
      const onEdge = e.progress > 0 && len > 0;
      e.curEdge = onEdge ? ei : -1;
      e.pos = onEdge ? lerp(level.nodes[a], level.nodes[b], e.progress / len) : level.nodes[a];
    } else {
      e.curEdge = -1;
      e.pos = level.nodes[e.path[e.path.length - 1]];
    }
  }

  if (wallBroken) {
    for (const w of state.walls) if (w.hp <= 0) state.effects.push({ kind: 'puff', pos: w.pos, t: 0, dur: 0.8 });
    state.walls = state.walls.filter((w) => w.hp > 0);
    repathAll(state, level);
  }

  if (reached.length) {
    const set = new Set(reached);
    state.enemies = state.enemies.filter((e) => !set.has(e));
    for (const e of reached) {
      state.lives -= ENEMY_STATS[e.kind].livesCost;
      recordOutcome(state, level, e, true);
      state.effects.push({ kind: 'puff', pos: e.pos, t: 0, dur: 0.6 });
    }
    const k = reached[0].kind;
    say(state, k === 'krol_dzik' ? 'Dzik Królewski dotarł do Syrenki!' : k === 'jelen' ? 'Jeleń dotarł do Syrenki!' : `${ENEMY_STATS[k].name} dopadł Syrenkę!`);
    if (state.lives <= 0) {
      state.lives = 0;
      state.phase = 'lost';
      say(state, 'Syrenka padła! Zwierzyna wygrała.', 60);
    }
  }
  removeDead(state, level);
}
