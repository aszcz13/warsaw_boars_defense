import type { GameState, Level, LngLat, Wall } from './types';
import { WALL_STATS } from './config';
import { lerp } from './geo';
import { repathAll } from './enemies';
import { say } from './state';

/** Środek krawędzi — tu stoi sprite muru i tu wróg się zatrzymuje. */
export function edgeMid(level: Level, edge: number): LngLat {
  const [a, b] = level.edges[edge];
  return lerp(level.nodes[a], level.nodes[b], 0.5);
}

/** Czy z wejścia da się dojść do Syrenki bez przebijania murów. */
function reachable(level: Level, from: number, blocked: Set<number>): boolean {
  const seen = new Set<number>([from]);
  const q = [from];
  while (q.length) {
    const n = q.pop()!;
    if (n === level.goal.node) return true;
    for (const { to, edge } of level.adj[n]) {
      if (blocked.has(edge) || seen.has(to)) continue;
      seen.add(to);
      q.push(to);
    }
  }
  return false;
}

/** Stawia mur na całej krawędzi (bez walidacji i opłaty); przelicza ścieżki. */
export function placeWall(state: GameState, level: Level, edge: number): Wall {
  const w: Wall = { id: state.nextId++, edge, pos: edgeMid(level, edge), hp: WALL_STATS.hp, maxHp: WALL_STATS.hp };
  state.walls.push(w);
  state.effects.push({ kind: 'puff', pos: w.pos, t: 0, dur: 0.6 });
  repathAll(state, level);
  const blocked = new Set(state.walls.map((x) => x.edge));
  const open = level.entrances.filter((en) => reachable(level, en.node, blocked)).length;
  if (open === 0) say(state, 'Uwaga: mury odcinają wszystkie trasy — zwierzęta będą rozbijać mury!', 6);
  return w;
}
