import type { BuildKind, EnemyKind, GameState, Level, LngLat, SpriteId, TowerKind } from '../game/types';
import { SELL_RATIO, START_LIVES, TOWER_STATS, WALL_STATS, wallRepairCost } from '../game/config';
import { spriteIcon } from '../gfx/sprites';

interface Handlers {
  onSelect(kind: BuildKind | null): void;
  onNextWave(): void;
  onRestart(): void;
  onSpeed(n: number): void;
  onUpgrade(id: number): void;
  onSell(id: number, via?: string): void;
  onRepairWall(id: number): void;
  onSellWall(id: number): void;
  onDeselect(): void;
}

interface Data {
  preview(state: GameState): { kind: EnemyKind; count: number }[];
  totalWaves: number;
}

const fmtN = (n: number, d = 1) => n.toFixed(d).replace('.', ',');
const dpsOf = (l: { damage: number; reload: number }) => l.damage / l.reload;
const buildTip = (kind: BuildKind): string => {
  if (kind === 'wall') return '';
  const ts = TOWER_STATS[kind as TowerKind];
  return ` · ok. ${fmtN(dpsOf(ts.levels[0]))} obr./s${ts.splash > 0 ? ' na cel w obszarze' : ''}`;
};

const BUILDS: { kind: BuildKind; name: string; icon: SpriteId; cost: number; tip: string }[] = [
  { kind: 'lucznik', name: 'Łucznik', icon: 'lucznik_1', cost: TOWER_STATS.lucznik.levels[0].cost, tip: 'Tani i szybki, dobry na lisy i wilki.' },
  { kind: 'kusznik', name: 'Kusznik', icon: 'kusznik_1', cost: TOWER_STATS.kusznik.levels[0].cost, tip: 'Wolny, ale mocny strzał w pojedynczy cel.' },
  { kind: 'smola', name: 'Smoła', icon: 'smola_1', cost: TOWER_STATS.smola.levels[0].cost, tip: 'Krótki zasięg, obszar i spowolnienie grup.' },
  { kind: 'balista', name: 'Balista', icon: 'balista_1', cost: TOWER_STATS.balista.levels[0].cost, tip: 'Pojedynczy cel, duże obrażenia, wolne przeładowanie.' },
  { kind: 'bombarda', name: 'Bombarda', icon: 'bombarda_1', cost: TOWER_STATS.bombarda.levels[0].cost, tip: 'Daleki zasięg, obszarowe obrażenia, bardzo wolna.' },
  { kind: 'wall', name: 'Mur', icon: 'wall', cost: WALL_STATS.cost, tip: 'Blokuje uliczkę; dziki potrafią go rozbić.' },
];

const rnd = (() => { let s = 12345; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();

function texture(kind: 'wood' | 'stone' | 'parch'): string {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const base = kind === 'wood' ? [74, 46, 24] : kind === 'stone' ? [96, 92, 86] : [226, 205, 158];
  const img = g.createImageData(S, S);
  const colV = new Float32Array(S).map(() => rnd() * 18 - 9);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let v = (rnd() - 0.5) * (kind === 'parch' ? 10 : 16);
      if (kind === 'wood') v += colV[x] + Math.sin(y * 0.08 + colV[x] * 0.3 + x * 0.05) * 6;
      if (kind === 'stone') {
        const row = Math.floor(y / 16), off = row % 2 ? 16 : 0;
        if (y % 16 === 0 || (x + off) % 32 === 0) v -= 26;
        else v += ((Math.floor((x + off) / 32) * 7 + row * 13) % 5) * 3 - 6;
      }
      if (kind === 'parch') v += Math.sin(x * 0.07) * Math.cos(y * 0.09) * 9;
      const i = (y * S + x) * 4;
      img.data[i] = base[0] + v; img.data[i + 1] = base[1] + v; img.data[i + 2] = base[2] + v; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  if (kind === 'wood') {
    g.fillStyle = 'rgba(20,10,4,.5)';
    for (let i = 0; i < 4; i++) g.fillRect((rnd() * S) | 0, 0, 1, S);
  }
  return c.toDataURL();
}

function pix(rows: string[], pal: Record<string, string>, scale: number): string {
  const c = document.createElement('canvas');
  c.width = rows[0].length * scale;
  c.height = rows.length * scale;
  const g = c.getContext('2d')!;
  rows.forEach((r, y) => [...r].forEach((ch, x) => {
    if (pal[ch]) { g.fillStyle = pal[ch]; g.fillRect(x * scale, y * scale, scale, scale); }
  }));
  return c.toDataURL();
}

const CSS = `
.hud{position:absolute;inset:0;pointer-events:none;font-family:'HudNum','Pixelify Sans','Courier New',monospace;color:#f0e0b0;user-select:none;font-size:14px;image-rendering:pixelated}
.hud *{box-sizing:border-box}
.hud .pn{pointer-events:auto;border:4px solid #1c1008;box-shadow:inset 0 0 0 2px #8a6a3c,inset 0 0 0 4px #2a1a0a,0 4px 0 rgba(0,0,0,.55)}
.hud .wood{background:var(--wood) #4a2e18}
.hud .stone{background:var(--stone) #606056;box-shadow:inset 0 0 0 2px #9a968a,inset 0 0 0 4px #2c2a26,0 -2px 0 rgba(0,0,0,.4),0 4px 0 rgba(0,0,0,.55)}
.hud .parch{background:var(--parch) #e2cd9e;color:#2e1c0a;border:3px solid #3a2410;box-shadow:inset 0 0 0 2px #b8985a}
.hud .top{position:absolute;top:0;left:0;right:0;height:50px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 12px;border-top:0;border-left:0;border-right:0;font-weight:700;font-size:16px;text-shadow:1px 1px 0 #000}
.hud .grp{display:flex;align-items:center;gap:6px;white-space:nowrap}
.hud .grp img{width:20px;height:20px}
.hud .lbar{position:relative;width:120px;height:20px;flex:none;background:#1c0e08;border:2px solid #0a0503;box-shadow:inset 0 0 0 1px #6a4a2a;overflow:hidden}
.hud .lbar span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;line-height:1;color:#fff;text-shadow:0 0 3px #000,1px 1px 0 #000,-1px -1px 0 #000}
.hud .wavebox{margin-left:14px;padding:3px 12px;background:rgba(0,0,0,.32);border:2px solid #1c1008;box-shadow:inset 0 0 0 1px #8a6a3c}
.hud .chg{color:#7a1a08}
.hud .btn.poor{filter:grayscale(.6) brightness(.8)}
.hud .lbar i{display:block;height:100%;background:linear-gradient(#e04a3a,#a02418)}
.hud .prev{display:flex;align-items:center;gap:8px;min-width:0;overflow:hidden;background:rgba(0,0,0,.28);padding:2px 10px;border:2px solid #1c1008}
.hud .prev .it{display:flex;align-items:center;gap:2px}
.hud .prev img{width:28px;height:28px}
.hud .btn{font:inherit;font-weight:700;color:#f6e6b4;background:linear-gradient(#7a5630,#4a2e14);border:3px solid #1c1008;box-shadow:inset 0 0 0 2px #c9a24a,0 2px 0 rgba(0,0,0,.6);padding:4px 10px;cursor:pointer;text-shadow:1px 1px 0 #000;border-radius:0}
.hud .btn:hover:not(:disabled){filter:brightness(1.2)}
.hud .btn:active:not(:disabled){transform:translateY(1px)}
.hud .btn:disabled{filter:grayscale(1) brightness(.7);cursor:default}
.hud .btn.go{background:linear-gradient(#b03a20,#6a1608);font-size:16px;padding:6px 14px}
.hud .btn.sel{background:linear-gradient(#c9a227,#7a5a10);color:#fff}
.hud .spd{display:flex;gap:3px}
.hud .spd .btn{padding:2px 8px}
.hud .bottom{position:absolute;left:50%;bottom:0;transform:translateX(-50%);width:min(1060px,100%);padding:0 8px}
.hud .panel{display:flex;gap:10px;height:132px;padding:6px 8px}
.hud .info{flex:1 1 0;min-width:0;padding:6px 8px;overflow:hidden;font-size:13px;line-height:1.3;display:flex;gap:8px}
.hud .info .tx{flex:1 1 0;min-width:0;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-rows:auto minmax(0,1fr);column-gap:8px}
.hud .info .tx h3{grid-column:1/3}
.hud .info .tx>.desc:last-child{grid-column:1/3}
.hud .info .desc{min-height:0;overflow-y:auto;overflow-wrap:anywhere;word-break:break-word;scrollbar-width:thin}
.hud .info .pt{width:64px;height:64px;flex:none;background:rgba(60,35,10,.18);border:2px solid #3a2410;display:flex;align-items:center;justify-content:center}
.hud .info .pt img{max-width:56px;max-height:56px}
.hud .info h3{margin:0 0 2px;font-size:16px;flex:none}
.hud .info .acts{display:flex;flex-direction:column;gap:5px;align-self:end;min-width:112px}
.hud .info .acts .btn{font-size:12px;padding:3px 8px}
.hud .builds{display:flex;gap:8px;align-items:center}
.hud .slot{position:relative;width:76px;height:116px;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:6px 2px 4px;cursor:pointer;background:linear-gradient(#5a3c20,#35210e);border:3px solid #1c1008;box-shadow:inset 0 0 0 2px #8a6a3c;font-size:12px;text-shadow:1px 1px 0 #000;font-weight:700;text-align:center}
.hud .slot:hover{filter:brightness(1.18)}
.hud .slot .tip{display:none;position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);width:190px;padding:6px 8px;background:#1c1008;border:2px solid #8a6a3c;color:#f0e0c0;font-size:12px;font-weight:400;text-align:left;text-shadow:none;pointer-events:none;z-index:50}
.hud .slot .tip b{color:#ffd24a}
.hud .slot .tip i{color:#c9a24a;font-style:normal}
.hud .slot:hover .tip{display:block}
.hud .slot img{width:48px;height:48px}
.hud .slot .hk{position:absolute;top:1px;left:4px;font-size:11px;color:#c9a24a}
.hud .slot .co{color:#ffd24a}
.hud .slot.sel{border-color:#ffd24a;box-shadow:inset 0 0 0 2px #ffd24a,0 0 10px 2px rgba(255,210,74,.85);background:linear-gradient(#7a5a28,#4a3012)}
.hud .slot.poor{filter:saturate(.25) brightness(.8)}
.hud .slot.poor .co{color:#ff5a4a}
.hud .mini{flex:none;align-self:center;border:3px solid #1c1008;box-shadow:inset 0 0 0 2px #8a6a3c;background:#2e2a1c;pointer-events:none;width:140px;height:120px}
.hud .help{font-size:12px;text-align:center;color:#f0e0b0;text-shadow:1px 1px 0 #000;padding:3px 6px 4px;background:rgba(20,12,6,.88);margin-top:4px;line-height:1.3;pointer-events:auto}
.hud .help b{color:#ffd24a}
.hud .flash{animation:goldflash .9s ease-out}
@keyframes goldflash{0%,40%{color:#ff4a3a;transform:scale(1.35);text-shadow:0 0 8px #f00}100%{transform:scale(1)}}
.hud .toast{position:absolute;top:62px;left:50%;transform:translateX(-50%);padding:8px 24px;font-weight:700;font-size:17px;display:none;pointer-events:none;max-width:90%;text-align:center}
.hud .end{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(10,5,0,.6);pointer-events:auto}
.hud .end .parch{padding:28px 48px;text-align:center;display:flex;flex-direction:column;gap:14px;align-items:center;font-size:18px;border-width:5px}
.hud .end h1{margin:0;font-size:34px}
@media (max-height:700px){
.hud .panel{height:118px;gap:8px;padding:4px 6px}
.hud .slot{height:104px;padding:4px 2px 3px}
.hud .slot img{width:40px;height:40px}
.hud .mini{height:100px;width:120px}
.hud .info .pt{width:52px;height:52px}
.hud .info .pt img{max-width:46px;max-height:46px}
.hud .help{font-size:11px;padding:2px 6px 3px;margin-top:3px}
}
@media (max-width:760px){
.hud .mini{display:none}
.hud .prev{display:none}
.hud .top{font-size:13px;gap:6px;padding:0 6px}
.hud .panel{height:118px;gap:6px}
.hud .slot{width:62px;height:96px;font-size:10px}
.hud .slot img{width:36px;height:36px}
.hud .info{font-size:11px}
.hud .help{display:none}
}
`;

function esc(s: string): string { return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!); }

export function createHud(root: HTMLElement, level: Level, h: Handlers, data: Data): { update(state: GameState): void } {
  const st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);
  root.style.setProperty('--wood', `url(${texture('wood')})`);
  root.style.setProperty('--stone', `url(${texture('stone')})`);
  root.style.setProperty('--parch', `url(${texture('parch')})`);

  const coinUrl = pix(['..oooo..', '.ohhYYo.', 'ohYYYYYo', 'oYYYddYo', 'oYYYddYo', 'oYYYYYYo', '.oYYYYo.', '..oooo..'],
    { o: '#5a3a00', h: '#fff2a0', Y: '#f0b820', d: '#c08810' }, 3);
  const heartUrl = pix(['.oo..oo.', 'oRRooRRo', 'oRhRRRRo', 'oRRRRRRo', '.oRRRRo.', '..oRRo..', '...oo...'],
    { o: '#3a0808', R: '#e03a30', h: '#ffb0a0' }, 3);

  root.innerHTML = `
<div class="hud">
 <div class="top pn wood">
  <div class="grp"><div class="grp"><img src="${coinUrl}"><span data-r="gold">0</span></div>
   <div class="grp" style="margin-left:6px"><img src="${heartUrl}"><div class="lbar"><i data-r="lifebar"></i><span data-r="life">0</span></div></div>
   <div class="grp wavebox" data-r="wave">Fala 0 / ${data.totalWaves}</div></div>
  <div class="prev"><span data-r="ptitle">Nadciąga:</span><span class="grp" data-r="plist"></span></div>
  <div class="grp"><span data-r="count"></span><button class="btn go" data-r="go">Wypuść dziki!</button>
   <div class="spd"><button class="btn" data-sp="1">×1</button><button class="btn" data-sp="2">×2</button><button class="btn" data-sp="3">×3</button></div></div>
 </div>
 <div class="toast pn parch" data-r="toast"></div>
 <div class="bottom">
  <div class="panel pn stone">
   <div class="info pn parch" data-r="info"></div>
   <div class="builds">${BUILDS.map((b, i) => `<div class="slot" data-b="${b.kind}"><span class="hk">${i + 1}</span><span>${b.name}</span><img src="${spriteIcon(b.icon, 48)}"><span class="co">${b.cost}</span><div class="tip"><b>${b.name}</b> – ${b.tip}<br><i>Koszt: ${b.cost} zł${buildTip(b.kind)}</i></div></div>`).join('')}</div>
   <canvas class="mini" width="140" height="120" data-r="mini"></canvas>
  </div>
  <div class="help">LPM – buduj / zaznacz · <b>PPM / Delete – sprzedaj</b> (wieża poz. 3: potwierdź drugim kliknięciem) · 1–6 – budowle · U – ulepsz · R – napraw mur · Spacja – fala · Esc – anuluj · kółko – zoom</div>
 </div>
 <div class="end" data-r="end"><div class="parch"><h1 data-r="etitle"></h1><div data-r="etext"></div><button class="btn go" data-r="restart">Zagraj ponownie</button></div></div>
</div>`;

  const q = <T extends HTMLElement>(r: string) => root.querySelector<T>(`[data-r="${r}"]`)!;
  const el = {
    gold: q('gold'), life: q('life'), lifebar: q('lifebar'), wave: q('wave'), ptitle: q('ptitle'), plist: q('plist'),
    count: q('count'), go: q<HTMLButtonElement>('go'), toast: q('toast'), info: q('info'), mini: q<HTMLCanvasElement>('mini'),
    end: q('end'), etitle: q('etitle'), etext: q('etext'), restart: q('restart'),
  };
  const slots = [...root.querySelectorAll<HTMLElement>('.slot')];
  const spdBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-sp]')];

  for (const ev of ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'wheel', 'pointerdown', 'touchstart'])
    root.querySelectorAll('.pn, .end').forEach((n) => n.addEventListener(ev, (e) => { e.stopPropagation(); if (ev === 'contextmenu') e.preventDefault(); }, { passive: true } as AddEventListenerOptions));

  let cur: GameState | null = null;
  let speed = 1;
  const setSpeed = (n: number) => { speed = n; h.onSpeed(n); spdBtns.forEach((b) => b.classList.toggle('sel', Number(b.dataset.sp) === n)); };
  spdBtns.forEach((b) => b.addEventListener('click', () => setSpeed(Number(b.dataset.sp))));
  setSpeed(speed);
  el.go.addEventListener('click', () => h.onNextWave());
  el.restart.addEventListener('click', () => h.onRestart());
  const toggle = (k: BuildKind) => h.onSelect(cur?.selectedBuild === k ? null : k);
  slots.forEach((s) => s.addEventListener('click', () => toggle(s.dataset.b as BuildKind)));
  el.info.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'repair' || act === 'sellwall') {
      const wid = cur?.selectedWallId;
      if (wid == null) return;
      if (act === 'repair') h.onRepairWall(wid); else h.onSellWall(wid);
      return;
    }
    const id = cur?.selectedTowerId;
    if (!act || id == null) return;
    if (act === 'up') h.onUpgrade(id); else if (act === 'sell') h.onSell(id, 'Sprzedaj');
  });

  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const n = Number(e.key);
    if (n >= 1 && n <= BUILDS.length && !e.ctrlKey && !e.metaKey) toggle(BUILDS[n - 1].kind);
    else if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && cur?.selectedWallId != null) h.onRepairWall(cur.selectedWallId);
    else if (e.key === 'Escape') { h.onSelect(null); h.onDeselect(); }
    else if (e.key === ' ') { e.preventDefault(); h.onNextWave(); }
    else if ((e.key === 'u' || e.key === 'U') && cur?.selectedTowerId != null) h.onUpgrade(cur.selectedTowerId);
    else if ((e.key === 'Delete' || e.key === 'Backspace') && cur?.selectedTowerId != null) h.onSell(cur.selectedTowerId, e.key);
    else if ((e.key === 'Delete' || e.key === 'Backspace') && cur?.selectedWallId != null) h.onSellWall(cur.selectedWallId);
  });

  // --- minimapa ---
  const mm = el.mini;
  const mg = mm.getContext('2d')!;
  let mx0 = Infinity, my0 = Infinity, mx1 = -Infinity, my1 = -Infinity;
  for (const [x, y] of level.polygon) { mx0 = Math.min(mx0, x); mx1 = Math.max(mx1, x); my0 = Math.min(my0, y); my1 = Math.max(my1, y); }
  const kx = Math.cos(((my0 + my1) / 2) * Math.PI / 180);
  const pad = 6;
  const sc = Math.min((mm.width - pad * 2) / ((mx1 - mx0) * kx), (mm.height - pad * 2) / (my1 - my0));
  const offx = (mm.width - (mx1 - mx0) * kx * sc) / 2, offy = (mm.height - (my1 - my0) * sc) / 2;
  const toM = (p: LngLat): [number, number] => [offx + (p[0] - mx0) * kx * sc, mm.height - offy - (p[1] - my0) * sc];
  const stat = document.createElement('canvas');
  stat.width = mm.width; stat.height = mm.height;
  {
    const g = stat.getContext('2d')!;
    g.fillStyle = '#2e2a1c'; g.fillRect(0, 0, stat.width, stat.height);
    g.beginPath(); level.polygon.forEach((p, i) => { const [x, y] = toM(p); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.closePath(); g.fillStyle = '#d8c394'; g.fill();
    g.strokeStyle = '#7a6a56'; g.lineWidth = 2; g.stroke();
    g.strokeStyle = '#7a5530'; g.lineWidth = 1; g.beginPath();
    for (const [a, b] of level.edges) { const p = toM(level.nodes[a]), r = toM(level.nodes[b]); g.moveTo(p[0], p[1]); g.lineTo(r[0], r[1]); }
    g.stroke();
    g.fillStyle = '#d02a20';
    for (const en of level.entrances) { const [x, y] = toM(en.pos); g.fillRect(x - 3, y - 3, 6, 6); }
    const [gx, gy] = toM(level.goal.pos);
    g.fillStyle = '#ffd24a'; g.beginPath(); g.arc(gx, gy, 4, 0, 7); g.fill();
    g.strokeStyle = '#5a3a00'; g.lineWidth = 1; g.stroke();
  }
  const drawMini = (s: GameState) => {
    mg.drawImage(stat, 0, 0);
    mg.fillStyle = '#8a8a8a';
    for (const w of s.walls) { const [x, y] = toM(w.pos); mg.fillRect(x - 1, y - 1, 3, 3); }
    mg.fillStyle = '#3a78e0';
    for (const t of s.towers) { const [x, y] = toM(t.pos); mg.fillRect(x - 2, y - 2, 4, 4); }
    mg.fillStyle = '#e02a2a';
    for (const e of s.enemies) { const [x, y] = toM(e.pos); mg.fillRect(x - 1, y - 1, 2, 2); }
  };
  // --- update (diffowanie) ---
  const cache = new Map<HTMLElement, string>();
  const text = (n: HTMLElement, v: string) => { if (cache.get(n) !== v) { cache.set(n, v); n.textContent = v; } };
  const html = (n: HTMLElement, v: string) => { if (cache.get(n) !== v) { cache.set(n, v); n.innerHTML = v; } };
  const disp = (n: HTMLElement, v: string) => { if (n.style.display !== v) n.style.display = v; };
  let lastMini = 0;
  let lastMsgObj: GameState['message'] = null;
  let shownMsg = '';
  let shownUntil = 0;

  const infoHtml = (s: GameState): string => {
    const t = s.selectedTowerId != null ? s.towers.find((x) => x.id === s.selectedTowerId) : undefined;
    const w = !t && s.selectedWallId != null ? s.walls.find((x) => x.id === s.selectedWallId) : undefined;
    if (w) {
      const cost = wallRepairCost(w.hp, w.maxHp);
      const refund = Math.floor(WALL_STATS.cost * SELL_RATIO);
      const full = cost === 0;
      const tip = full ? 'Mur jest cały' : `Przywraca pełne HP muru za ${cost} zł (R)`;
      return `<div class="pt"><img src="${spriteIcon(w.hp < w.maxHp * 0.5 ? 'wall_damaged' : 'wall', 64)}"></div><div class="tx"><h3>${WALL_STATS.name} · ${Math.ceil(w.hp)} / ${w.maxHp} HP</h3><div class="desc">${full ? 'Mur w pełni sprawny.' : 'Uszkodzony - naprawa kosztuje proporcjonalnie do zniszczeń (R). Można naprawiać w trakcie fali.'}</div><div class="acts"><button class="btn${!full && s.gold < cost ? ' poor' : ''}" data-act="repair" title="${tip}" ${full ? 'disabled' : ''}>${full ? 'Mur cały' : `Napraw (${cost} zł)`}</button><button class="btn" data-act="sellwall">Sprzedaj (+${refund})</button></div></div>`;
    }
    if (t) {
      const ts = TOWER_STATS[t.kind];
      const lv = ts.levels[t.level - 1];
      const next = t.level < 3 ? ts.levels[t.level] : null;
      const refund = Math.floor(t.spent * SELL_RATIO);
      const area = ts.splash > 0 ? ` na cel w obszarze (promień ${ts.splash} m)` : '';
      const cmp = (a: number, b: number, d: number, unit = '') =>
        a === b ? `${fmtN(a, d)}${unit}` : `${fmtN(a, d)} → <b class="chg">${fmtN(b, d)}</b>${unit}`;
      const cmpTxt = (a: number, b: number, d: number, unit = '') => `${fmtN(a, d)} → ${fmtN(b, d)}${unit}`;
      let nextHtml = '<br><b>Maks. poziom</b>';
      let tip = 'Maks. poziom';
      if (next) {
        const nd = dpsOf(next), cd = dpsOf(lv);
        nextHtml = `<br>Poz. ${t.level + 1}: obrażenia ${cmp(lv.damage, next.damage, 0)}, zasięg ${cmp(lv.range, next.range, 0, ' m')}, przeładowanie ${cmp(lv.reload, next.reload, 1, ' s')}, ok. ${cmp(cd, nd, 1)} obr./s${area}, koszt ${next.cost} zł`;
        tip = `Poz. ${t.level + 1}: obrażenia ${cmpTxt(lv.damage, next.damage, 0)}, zasięg ${cmpTxt(lv.range, next.range, 0, ' m')}, przeładowanie ${cmpTxt(lv.reload, next.reload, 1, ' s')}, ok. ${cmpTxt(cd, nd, 1)} obr./s${area}, koszt ${next.cost} zł (U)`;
      }
      const up = next
        ? `<button class="btn${s.gold < next.cost ? ' poor' : ''}" data-act="up" title="${tip}">Ulepsz (${next.cost})</button>`
        : `<button class="btn" disabled title="Maks. poziom">Maks. poziom</button>`;
      return `<div class="pt"><img src="${spriteIcon(`${t.kind}_${t.level as 1 | 2 | 3}`, 64)}"></div><div class="tx"><h3>${ts.name} · poz. ${t.level}/3</h3><div class="desc">Obrażenia ${lv.damage} · zasięg ${lv.range} m · przeładowanie ${fmtN(lv.reload)} s<br>ok. ${fmtN(dpsOf(lv))} obr./s${area}${nextHtml}</div><div class="acts">${up}<button class="btn" data-act="sell">Sprzedaj (+${refund})</button></div></div>`;
    }
    const b = s.selectedBuild;
    if (b === 'wall') return `<div class="pt"><img src="${spriteIcon('wall', 64)}"></div><div class="tx"><h3>${WALL_STATS.name}</h3><div class="desc">${esc(WALL_STATS.desc)}<br>Koszt: ${WALL_STATS.cost} · Wytrzymałość: ${WALL_STATS.hp}<br>Kliknij na uliczkę. Uszkodzony mur zaznacz LPM, by go naprawić.</div></div>`;
    if (b) {
      const ts = TOWER_STATS[b as TowerKind];
      const lv = ts.levels[0];
      return `<div class="pt"><img src="${spriteIcon(`${b as TowerKind}_1`, 64)}"></div><div class="tx"><h3>${ts.name}</h3><div class="desc">${esc(ts.desc)}<br>Koszt: ${lv.cost} · Obrażenia: ${lv.damage}<br>Zasięg: ${lv.range} m · ${(1 / lv.reload).toFixed(1)}/s</div></div>`;
    }
    return `<div class="tx"><h3>Starówka</h3><div class="desc">Wybierz budowlę. Stawiaj wieże na zielonych polach przy uliczkach. Mury blokują uliczki.</div></div>`;
  };

  return {
    update(s) {
      cur = s;
      text(el.gold, String(Math.floor(s.gold)));
      text(el.life, `${Math.max(0, Math.ceil(s.lives))} / ${START_LIVES}`);
      const pct = Math.max(0, Math.min(100, (s.lives / START_LIVES) * 100));
      const lb = el.lifebar;
      if (cache.get(lb) !== String(pct)) { cache.set(lb, String(pct)); lb.style.width = pct + '%'; }
      text(el.wave, `Fala ${s.wave} / ${data.totalWaves}`);
      const inWave = s.phase === 'wave';
      text(el.ptitle, inWave ? 'Fala trwa:' : 'Nadciąga:');
      const pv = data.preview(s);
      html(el.plist, pv.map((p) => `<span class="it"><img src="${spriteIcon(`${p.kind}_0`, 28)}">×${p.count}</span>`).join(''));
      text(el.count, inWave ? `Zwierzyna: ${s.enemies.length}` : s.phase === 'build' ? `Następna fala za ${Math.ceil(s.nextWaveIn)}s` : '');
      disp(el.go, s.phase === 'build' ? '' : 'none');

      slots.forEach((n, i) => {
        const b = BUILDS[i];
        n.classList.toggle('sel', s.selectedBuild === b.kind);
        n.classList.toggle('poor', s.gold < b.cost);
      });
      html(el.info, infoHtml(s));

      // Komunikaty żyją w czasie rzeczywistym (min. 2,2 s także przy ×3), nawet gdy gra już je wyczyściła.
      if (s.message !== lastMsgObj) {
        lastMsgObj = s.message;
        if (s.message) {
          let m = s.message.text;
          if (m === 'Za mało złota!') {
            const tw = s.selectedTowerId != null ? s.towers.find((x) => x.id === s.selectedTowerId) : undefined;
            let cost = 0;
            if (s.selectedBuild) cost = BUILDS.find((x) => x.kind === s.selectedBuild)?.cost ?? 0;
            else if (tw && tw.level < 3) cost = TOWER_STATS[tw.kind].levels[tw.level].cost;
            else if (!tw && s.selectedWallId != null) { const sw = s.walls.find((x) => x.id === s.selectedWallId); if (sw) cost = wallRepairCost(sw.hp, sw.maxHp); }
            if (cost > 0) m = `Brakuje ${Math.ceil(cost - s.gold)} zł (koszt ${cost}, masz ${Math.floor(s.gold)})`;
            const g = el.gold.parentElement!;
            g.classList.remove('flash'); void g.offsetWidth; g.classList.add('flash');
          }
          shownMsg = m;
          shownUntil = performance.now() + Math.max(2200, (s.message.until - s.time) * 1000);
        }
      }
      const msg = performance.now() < shownUntil ? shownMsg : '';
      text(el.toast, msg);
      disp(el.toast, msg ? 'block' : 'none');

      const over = s.phase === 'lost' || s.phase === 'won';
      disp(el.end, over ? 'flex' : 'none');
      if (over) {
        text(el.etitle, s.phase === 'lost' ? 'Syrenka padła!' : 'Starówka obroniona!');
        text(el.etext, `Dotarto do fali ${s.wave} z ${data.totalWaves}`);
      }

      const now = performance.now();
      if (now - lastMini >= 200 && getComputedStyle(mm).display !== 'none') { lastMini = now; drawMini(s); }
    },
  };
}
