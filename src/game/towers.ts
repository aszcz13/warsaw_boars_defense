import type { Enemy, GameState, Level } from './types';
import { TOWER_STATS } from './config';
import { distM } from './geo';
import { distToGoal } from './graph';
import { damageEnemy } from './enemies';

export function updateTowers(state: GameState, level: Level, dt: number): void {
  const dist = distToGoal(level);
  const rem = (e: Enemy): number => {
    const a = e.path[e.pathIdx];
    if (e.curEdge < 0 || e.pathIdx + 1 >= e.path.length) return dist[a];
    return dist[e.path[e.pathIdx + 1]] + level.edges[e.curEdge][2] - e.progress;
  };
  for (const t of state.towers) {
    t.cooldown -= dt;
    if (t.cooldown > 0) continue;
    const st = TOWER_STATS[t.kind];
    const lv = st.levels[t.level - 1];
    let best: Enemy | null = null;
    let bestRem = Infinity;
    for (const e of state.enemies) {
      if (e.hp <= 0 || distM(t.pos, e.pos) > lv.range) continue;
      const r = rem(e);
      if (r < bestRem) { bestRem = r; best = e; }
    }
    if (!best) { t.cooldown = 0; continue; }
    t.cooldown = lv.reload;
    t.lastTarget = best.id;
    state.projectiles.push({
      id: state.nextId++,
      kind: st.projectile,
      from: t.pos,
      to: best.pos,
      targetId: best.id,
      t: 0,
      dur: Math.max(0.05, distM(t.pos, best.pos) / st.projectileSpeed),
      damage: lv.damage,
      splash: st.splash,
      slow: st.slow,
    });
  }
}

export function updateProjectiles(state: GameState, dt: number): void {
  if (!state.projectiles.length) return;
  const byId = new Map(state.enemies.map((e) => [e.id, e]));
  const alive = [];
  for (const p of state.projectiles) {
    p.t += dt;
    const target = byId.get(p.targetId);
    if (target && target.hp > 0) p.to = target.pos;
    if (p.t < p.dur) { alive.push(p); continue; }
    if (p.splash > 0) {
      for (const e of state.enemies) {
        if (e.hp <= 0 || distM(e.pos, p.to) > p.splash) continue;
        damageEnemy(state, e, p.damage);
        if (p.slow) e.slowUntil = state.time + p.slow;
      }
      state.effects.push({ kind: 'splash', pos: p.to, t: 0, dur: 0.6 });
    } else if (target && target.hp > 0) {
      damageEnemy(state, target, p.damage);
      if (p.slow) target.slowUntil = state.time + p.slow;
    }
  }
  state.projectiles = alive;
}
