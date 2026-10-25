// Bezgłowa symulacja rozgrywki: `npx tsx scripts/sim.ts`
import { readFileSync } from 'node:fs';
import { spawnEnemy } from '../src/game/enemies';
import { createGame, startNextWave, step, tryBuild, upgradeTower, totalWaves } from '../src/game/game';
import { edgeMid } from '../src/game/walls';
import { edgeBetween, findPath, findPathWeighted } from '../src/game/graph';
import { WAVES } from '../src/game/waves';
import { TOWER_STATS } from '../src/game/config';
import type { GameState, Level, LevelFile, LngLat, TowerKind } from '../src/game/types';

const file: LevelFile = JSON.parse(readFileSync('public/data/oldtown.json', 'utf8'));
const adj: Level['adj'] = file.nodes.map(() => []);
file.edges.forEach(([a, b], edge) => {
  adj[a].push({ to: b, edge });
  adj[b].push({ to: a, edge });
});
const level: Level = { ...file, adj };

const lat0 = level.goal.pos[1], lng0 = level.goal.pos[0];
const KX = 111320 * Math.cos((lat0 * Math.PI) / 180), KY = 110574;
const xy = (p: LngLat): [number, number] => [(p[0] - lng0) * KX, (p[1] - lat0) * KY];
const cellXY = level.cells.centers.map(xy);
const d2 = (a: [number, number], b: [number, number]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

const W: number[] = [];
function edgeSamples(edges: Iterable<number> | Map<number, number>): [number, number][] {
  const out: [number, number][] = [];
  W.length = 0;
  const m = edges instanceof Map ? edges : new Map([...edges].map((e) => [e, 1] as [number, number]));
  for (const [e, w] of m) {
    const [a, b, len] = level.edges[e];
    const pa = xy(level.nodes[a]), pb = xy(level.nodes[b]);
    const n = Math.max(1, Math.ceil(len / 8));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      out.push([pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t]);
      W.push((w * 100) / (40 + Math.hypot(...out[out.length - 1])));
    }
  }
  return out;
}

function routeEdges(from: number): number[] {
  const p = findPath(level, from, level.goal.node) ?? [];
  const out: number[] = [];
  for (let i = 0; i + 1 < p.length; i++) out.push(level.adj[p[i]].find((n) => n.to === p[i + 1])!.edge);
  return out;
}

// Asercja: żaden wróg nie mija żywego muru na swojej trasie (mur w środku krawędzi).
let wallViolations = 0, wallStops = 0;
function stepChecked(s: GameState, dt: number): void {
  const before = new Map<number, { ei: number; idx: number; p: number; wid: number }>();
  const wallOf = new Map(s.walls.map((w) => [w.edge, w.id]));
  for (const e of s.enemies) {
    if (e.pathIdx >= e.path.length - 1) continue;
    const ei = edgeBetween(level, e.path[e.pathIdx], e.path[e.pathIdx + 1]);
    if (ei >= 0 && wallOf.has(ei)) before.set(e.id, { ei, idx: e.pathIdx, p: e.progress, wid: wallOf.get(ei)! });
  }
  step(s, level, dt);
  const alive = new Set(s.walls.map((w) => w.id));
  for (const e of s.enemies) {
    const b = before.get(e.id);
    if (!b || !alive.has(b.wid) || b.p > level.edges[b.ei][2] / 2 + 1e-6) continue;
    if (e.attackingWall === b.wid) wallStops++;
    const mid = level.edges[b.ei][2] / 2;
    const passed = e.pathIdx > b.idx || e.progress > mid + 1e-3;
    if (passed && e.path.length > 0) { wallViolations++; if (wallViolations < 5) console.log('NARUSZENIE: wróg', e.id, 'minął mur na krawędzi', b.ei); }
  }
}

function runWaves(s: GameState, upto: number, onBuild?: () => void, onWaveEnd?: (w: number) => void): void {
  let lastWave = 0;
  for (let i = 0; i < 20 * 60 * 120 && s.phase !== 'lost' && s.phase !== 'won'; i++) {
    if (s.phase === 'build') {
      if (s.wave >= upto) return;
      if (s.wave > lastWave) { onWaveEnd?.(s.wave); lastWave = s.wave; }
      onBuild?.();
      startNextWave(s);
    }
    stepChecked(s, 0.05);
  }
  if (s.wave > lastWave) onWaveEnd?.(s.wave);
}

const fmt = (a: number[]) => a.map((x) => (x * 100).toFixed(0).padStart(3)).join(' ');
const WS = Number(process.env.WS ?? 1);
if (WS !== 1) for (const w of WAVES) for (const g of w) if (g.kind !== 'krol_dzik') g.count = Math.max(1, Math.round(g.count * WS));
const t0 = performance.now();

// 1. bez wież
{
  const s = createGame(level);
  s.lives = 1e9;
  console.log('== 1. bez wież (wejścia:', level.entrances.length, ')');
  runWaves(s, 5);
  for (const l of s.ai.log) console.log(`fala ${l.wave} share% [${fmt(l.entranceShare)}] meanDanger ${l.meanDanger.toFixed(2)} reached ${l.reached}`);
}

// ocena pokrycia: tropy/trasy -> gdzie postawić wieżę
function placeBest(s: GameState, kind: TowerKind, pts: [number, number][], covered: number[], cands?: Set<number>): boolean {
  const r = TOWER_STATS[kind].levels[0].range;
  const occ = new Set(s.towers.map((t) => t.cell));
  let best = -1, bs = 0;
  for (let c = 0; c < cellXY.length; c++) {
    if (occ.has(c) || (cands && !cands.has(c))) continue;
    if (s.towers.some((t) => d2(cellXY[t.cell], cellXY[c]) < 100)) continue;
    let sc = 0;
    for (let i = 0; i < pts.length; i++) if (d2(cellXY[c], pts[i]) <= r * r) sc += W[i] * (covered[i] > 0 ? 0.7 : 1);
    if (sc > bs) { bs = sc; best = c; }
  }
  if (best < 0) { if (process.env.DBG) console.log('placeBest: brak pola', kind, 'gold', Math.round(s.gold), 'wieże', s.towers.length); return false; }
  if (!tryBuild(s, level, kind, level.cells.centers[best])) return false;
  for (let i = 0; i < pts.length; i++) if (d2(cellXY[best], pts[i]) <= r * r) covered[i]++;
  return true;
}

// 2. uczenie
{
  const s = createGame(level);
  s.lives = 1e9;
  s.gold = 1e6;
  const defended = [0, 1];
  const goalXY: [number, number] = [0, 0];
  const edges = new Set<number>();
  for (const i of defended) for (const e of routeEdges(level.entrances[i].node)) edges.add(e);
  // tylko odcinki dalej niż 60 m od Syrenki (wspólny finisz nie jest "wejściem")
  const far = [...edges].filter((e) => d2(xy(level.nodes[level.edges[e][0]]), goalXY) > 60 * 60);
  const pts = edgeSamples(far);
  const covered = pts.map(() => 0);
  const kinds: TowerKind[] = ['lucznik', 'kusznik', 'lucznik', 'kusznik', 'lucznik', 'smola'];
  let n = 0;
  for (const k of kinds) n += +placeBest(s, k, pts, covered);
  for (const t of s.towers) { upgradeTower(s, t.id); upgradeTower(s, t.id); }
  console.log(`\n== 2. uczenie (wieże ${n}, bronione wejścia ${defended}, odcinki ${far.length})`);
  const sent = WAVES.map((w) => w.reduce((a, g) => a + g.count, 0));
  const wts: number[][] = [];
  runWaves(s, 8, () => { const w = s.ai.entranceW; const t = w.reduce((a, b) => a + b, 0); wts.push(w.map((x) => x / t)); });
  s.ai.log.forEach((l, i) =>
    console.log(`fala ${l.wave} share% [${fmt(l.entranceShare)}] bronione ${(defended.reduce((a, d) => a + l.entranceShare[d], 0) * 100).toFixed(0)}% meanDanger ${l.meanDanger.toFixed(2)} reached ${l.reached}/${sent[i]} kills ${sent[i] - l.reached}`));
  console.log('oczekiwany udział wejść (przed falą), bronione%:', wts.map((w) => (defended.reduce((a, d) => a + w[d], 0) * 100).toFixed(0)).join(' '));
  const sh = wts.map((w) => defended.reduce((a, d) => a + w[d], 0));
  const lastTwo = (sh[sh.length - 1] + sh[sh.length - 2]) / 2;
  console.log(sh.length >= 4 && lastTwo < sh[0] ? 'UCZENIE OK' : 'UCZENIE SŁABE', `(start ${(sh[0] * 100).toFixed(0)}% -> końcówka ${(lastTwo * 100).toFixed(0)}%)`);
}

// 3. pełna gra z botami (strategie: dobra / skoncentrowana / rozproszona / średnia)
type Strategy = 'dobra' | 'skoncentrowana' | 'rozproszona' | 'srednia';
interface Result { phase: string; wave: number; lives: number }
const baseEdges = new Map<number, number>();
for (const en of level.entrances) for (const e of routeEdges(en.node)) baseEdges.set(e, (baseEdges.get(e) ?? 0) + 1);
const ORDER: TowerKind[] = ['lucznik', 'kusznik', 'lucznik', 'smola', 'kusznik', 'lucznik', 'balista', 'kusznik', 'lucznik', 'bombarda'];
const STRONG: TowerKind[] = ['balista', 'kusznik', 'bombarda', 'kusznik', 'smola', 'balista', 'lucznik', 'kusznik', 'lucznik', 'bombarda'];
const entXY = level.entrances.map((e) => xy(e.pos));

function play(strategy: Strategy, verbose = false): Result {
  const s = createGame(level);
  const MAXT = strategy === 'dobra' ? Number(process.env.MAXT ?? 12) : strategy === 'srednia' ? 7 : strategy === 'rozproszona' ? 8 : 9;
  const maxUpg = strategy === 'srednia' ? 2 : 3;
  let ki = 0, ent = 0;
  const botWalls = () => {
    if (strategy === 'srednia') return;
    const disp = strategy === 'rozproszona';
    if (s.walls.length >= (disp ? 6 : 3) || s.towers.length < (disp ? 2 : 4) || s.gold < (disp ? 60 : 150)) return;
    let best = -1, bs = 0;
    for (const [e, w] of baseEdges) {
      if (s.walls.some((x) => x.edge === e)) continue;
      const [a, b] = level.edges[e];
      const mid = xy(level.nodes[a]).map((v, i) => (v + xy(level.nodes[b])[i]) / 2) as [number, number];
      if (Math.hypot(...mid) < 30) continue;
      let sc = 0;
      for (const t of s.towers) if (d2(cellXY[t.cell], mid) < 30 * 30) sc++;
      if (sc * w > bs) { bs = sc * w; best = e; }
    }
    if (best >= 0) tryBuild(s, level, 'wall', edgeMid(level, best));
  };
  // Kandydaci: skoncentrowana = pola do 80 m od Syrenki.
  const candSet = (f: (r: number) => boolean) => new Set(cellXY.map((c, i) => [c, i] as const).filter(([c]) => f(Math.hypot(...c))).map(([, i]) => i));
  const cands = strategy === 'skoncentrowana' ? candSet((r) => r < 80) : undefined;
  const coreC = candSet((r) => r < 80), outerC = candSet((r) => r > 50 && r < 140);
  const placeNearEntrance = (k: TowerKind): boolean => {
    // Gracz reaguje na to, którymi wejściami faktycznie idą dziki (ostatnie fale), reszta po kolei.
    const last = s.ai.log[s.ai.log.length - 1];
    const order = level.entrances.map((_, i) => i);
    const towersAt = (i: number) => s.towers.filter((t) => d2(cellXY[t.cell], entXY[i]) < 45 * 45).length;
    order.sort((a, b) => ((last ? last.entranceShare[b] : 0) - towersAt(b) * 0.03) - ((last ? last.entranceShare[a] : 0) - towersAt(a) * 0.03) || a - b);
    for (const i of order) {
      const occ = new Set(s.towers.map((t) => t.cell));
      let best = -1, bd = Infinity;
      for (let c = 0; c < cellXY.length; c++) {
        if (occ.has(c) || s.towers.some((t) => d2(cellXY[t.cell], cellXY[c]) < 100)) continue;
        const d = d2(cellXY[c], entXY[i]);
        if (d < bd) { bd = d; best = c; }
      }
      if (best >= 0 && tryBuild(s, level, k, level.cells.centers[best])) return true;
    }
    return false;
  };
  const bot = () => {
    botWalls();
    for (let guard = 0; guard < 60; guard++) {
      const es = new Map(baseEdges);
      for (const [e, t] of s.tracks) if (s.time - t < 40) es.set(e, (es.get(e) ?? 0) + 1);
      const pts = edgeSamples(es);
      const covered = pts.map(() => 0);
      for (const t of s.towers) {
        const r = TOWER_STATS[t.kind].levels[t.level - 1].range;
        for (let i = 0; i < pts.length; i++) if (d2(cellXY[t.cell], pts[i]) <= r * r) covered[i]++;
      }
      // skoncentrowana: najpierw 5 wież, potem ulepszanie przed kolejnymi
      const buildFirst = strategy !== 'skoncentrowana' || s.towers.length < 5 || s.towers.every((x) => x.level >= 3);
      if (s.towers.length < MAXT && buildFirst) {
        const k = (strategy === 'skoncentrowana' ? STRONG : ORDER)[ki % ORDER.length];
        if (s.gold >= TOWER_STATS[k].levels[0].cost) {
          const ok = process.env.NEARENT && strategy === 'rozproszona' ? placeNearEntrance(k) : placeBest(s, k, pts, covered, strategy === 'rozproszona' ? (s.towers.length < Number(process.env.CORE ?? 3) ? coreC : outerC) : cands);
          ki++;
          if (ok) continue;
        }
      }
      const t = [...s.towers].filter((x) => x.level < maxUpg).sort((a, b) => a.level - b.level)[0];
      if (!t || s.gold < TOWER_STATS[t.kind].levels[t.level].cost) return;
      upgradeTower(s, t.id);
    }
  };
  const waveInfo: string[] = [];
  let prevLives = s.lives;
  runWaves(s, totalWaves(), bot, (w) => {
    waveInfo.push(`fala ${w}: życia ${s.lives} (-${prevLives - s.lives}) złoto ${Math.round(s.gold)} wieże ${s.towers.length} śr.poz ${(s.towers.reduce((a, t) => a + t.level, 0) / Math.max(1, s.towers.length)).toFixed(1)}`);
    prevLives = s.lives;
  });
  if (verbose) waveInfo.forEach((l) => console.log(l));
  return { phase: s.phase, wave: s.wave, lives: s.lives };
}
{
  console.log('\n== 3. pełna gra (boty)');
  const RUNS = Number(process.env.RUNS ?? 6);
  const strategies: Strategy[] = process.env.STRAT ? [process.env.STRAT as Strategy] : ['dobra', 'skoncentrowana', 'rozproszona', 'srednia'];
  for (const st of strategies) {
    const rs: Result[] = [];
    for (let i = 0; i < RUNS; i++) rs.push(play(st, !!process.env.DBG && i === 0));
    const won = rs.filter((r) => r.phase === 'won').length;
    console.log(`${st.padEnd(15)} wygrane ${won}/${RUNS} | ` + rs.map((r) => (r.phase === 'won' ? `W(${r.lives})` : `P${r.wave}`)).join(' '));
  }
}
// 4. test muru: wróg zatrzymuje się przy murze w środku krawędzi, w obu kierunkach
{
  for (const dir of [0, 1]) {
    const s = createGame(level);
    s.gold = 1e6; s.lives = 1e9;
    const route = findPath(level, level.entrances[0].node, level.goal.node)!;
    const i = Math.floor(route.length / 2);
    tryBuild(s, level, 'wall', [(level.nodes[route[i]][0] + level.nodes[route[i + 1]][0]) / 2, (level.nodes[route[i]][1] + level.nodes[route[i + 1]][1]) / 2]);
    const wall = s.walls[0];
    if (!wall) { console.log('TEST MURU: nie udało się postawić'); wallViolations++; continue; }
    const len = level.edges[wall.edge][2];
    const e = spawnEnemy(s, level, 'dzik', 0)!;
    // ustaw wroga na krawędzi muru, w danym kierunku
    const [ea, eb] = dir === 0 ? [level.edges[wall.edge][0], level.edges[wall.edge][1]] : [level.edges[wall.edge][1], level.edges[wall.edge][0]];
    e.path = [ea, eb, ...(findPath(level, eb, level.goal.node) ?? [eb]).slice(1)]; e.pathIdx = 0; e.progress = 0;
    for (let k = 0; k < 400; k++) stepChecked(s, 0.05);
    const d = Math.hypot(...[0, 1].map((c) => (e.pos[c] - wall.pos[c]) * (c ? 110574 : KX)));
    const ok = s.walls.length === 0 || e.attackingWall === wall.id;
    console.log(`TEST MURU kier.${dir}: krawędź ${wall.edge} (${len.toFixed(1)} m), wróg ${ok ? 'zatrzymany/zniszczył' : 'MINĄŁ'} mur, odl. od muru ${d.toFixed(2)} m`);
    if (!ok) wallViolations++;
  }
}
// 5. zawracanie: wróg przed środkiem krawędzi, na której powstaje mur, zawraca gdy jest objazd (bez teleportu)
{
  const route = findPath(level, level.entrances[0].node, level.goal.node)!;
  let turned = 0, stayed = 0, bad = 0;
  for (let i = 1; i + 2 < route.length; i++) {
    const s = createGame(level);
    s.gold = 1e6; s.lives = 1e9;
    const a = route[i], b = route[i + 1];
    const ei = edgeBetween(level, a, b);
    const len = level.edges[ei][2];
    const e = spawnEnemy(s, level, 'dzik', 0)!;
    e.path = [a, b, ...route.slice(i + 2)]; e.pathIdx = 0; e.progress = len * 0.25;
    e.pos = [level.nodes[a][0] + (level.nodes[b][0] - level.nodes[a][0]) * 0.25, level.nodes[a][1] + (level.nodes[b][1] - level.nodes[a][1]) * 0.25];
    const before = e.pos;
    const detour = findPathWeighted(level, a, level.goal.node, (x) => (x === ei ? Infinity : 1), 0) !== null;
    if (!tryBuild(s, level, 'wall', edgeMid(level, ei))) continue;
    const back = e.path[0] === b && e.path[1] === a;
    const fwd = e.path[0] === a && e.path[1] === b;
    const t = e.progress / len;
    const [p0, p1] = [level.nodes[e.path[0]], level.nodes[e.path[1]]];
    const np: [number, number] = [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t];
    const jump = Math.hypot((np[0] - before[0]) * KX, (np[1] - before[1]) * KY);
    const ok = (detour ? back : fwd) && jump < 0.05 && e.pathIdx === 0;
    if (!ok) { bad++; console.log(`ZAWRACANIE BŁĄD: krawędź ${ei} objazd ${detour} back ${back} fwd ${fwd} skok ${jump.toFixed(2)} m`); }
    else if (detour) turned++; else stayed++;
    for (let k = 0; k < 60; k++) stepChecked(s, 0.05);
  }
  console.log(`TEST ZAWRACANIA: zawrócone ${turned}, zostały przy murze ${stayed}, błędy ${bad}`);
  if (bad || turned === 0) wallViolations += bad || 1;
}
console.log(wallViolations === 0 ? `ASERCJA MURÓW OK (zatrzymań: ${wallStops})` : `ASERCJA MURÓW BŁĄD: ${wallViolations} naruszeń`);
if (wallViolations) process.exitCode = 1;
console.log(`\nsim: ${Math.round(performance.now() - t0)} ms`);
