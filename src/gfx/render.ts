import type { Effect, Enemy, GameState, Level, Projectile, Projector, SpriteId } from '../game/types';
import { lerp } from '../game/geo';
import { TOWER_STATS } from '../game/config';
import { getFlipped, getSprite, spriteSize } from './sprites';

interface Item {
  y: number;
  draw: () => void;
}

const PARCH = '#ecdcae';
const tintCache = new WeakMap<HTMLCanvasElement, Map<string, HTMLCanvasElement>>();

/** Sprite zabarwiony na jednolity kolor z zachowaniem kształtu (source-atop), cache. */
function tint(src: HTMLCanvasElement, color: string): HTMLCanvasElement {
  let m = tintCache.get(src);
  if (!m) tintCache.set(src, (m = new Map()));
  let c = m.get(color);
  if (!c) {
    c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const x = c.getContext('2d')!;
    x.drawImage(src, 0, 0);
    x.globalCompositeOperation = 'source-atop';
    x.fillStyle = color;
    x.fillRect(0, 0, c.width, c.height);
    m.set(color, c);
  }
  return c;
}

export function createRenderer(canvas: HTMLCanvasElement, proj: Projector) {
  const ctx = canvas.getContext('2d')!;
  let dpr = 1;
  let W = 0;
  let H = 0;
  const lastX = new Map<number, number>();
  let prevLives = -1;
  let flashUntil = 0;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
  }

  const onScreen = (x: number, y: number, m = 160) => x > -m && x < W + m && y > -m && y < H + m;

  /** Rysuje sprite środkiem dołu w (x,y), skala całkowita s. */
  function drawImg(img: HTMLCanvasElement, x: number, y: number, s: number, dx = 0, dy = 0) {
    ctx.drawImage(img, Math.round(x - (img.width * s) / 2 + dx), Math.round(y - img.height * s + dy), img.width * s, img.height * s);
  }

  function shadow(x: number, y: number, w: number) {
    const rx = w * 0.46;
    ctx.fillStyle = 'rgba(10,8,4,0.32)';
    ctx.beginPath();
    ctx.ellipse(x + rx * 0.08, y - rx * 0.06, rx, rx * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function outlined(text: string, x: number, y: number, font: string, fill: string, lw = 3) {
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = lw;
    ctx.strokeStyle = '#1a0f08';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
  }

  function hpBar(x: number, topY: number, wPx: number, frac: number, s: number, big = false) {
    const bw = Math.max(10 * s, Math.round(wPx));
    const bh = Math.max(4, Math.round(s * (big ? 2.4 : 1.4)));
    const bx = Math.round(x - bw / 2);
    const by = Math.round(topY - bh - 3 * s);
    const f = Math.max(0, Math.min(1, frac));
    ctx.fillStyle = '#000';
    ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
    ctx.fillStyle = '#3a0f0c';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = `hsl(${Math.round(f * 115)},68%,44%)`;
    const fw = Math.max(2, Math.round(bw * f));
    ctx.fillRect(bx, by, fw, bh);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(bx, by, fw, Math.max(1, Math.floor(bh / 3)));
    if (big) {
      ctx.fillStyle = '#000';
      for (let i = 1; i < 10; i++) ctx.fillRect(bx + Math.round((bw * i) / 10), by, 1, bh);
    }
  }

  function enemyItem(e: Enemy, s: number, state: GameState, bars: (() => void)[]): Item | null {
    const p = proj.project(e.pos);
    const prev = lastX.get(e.id);
    if (prev !== undefined && Math.abs(p.x - prev) > 0.2) e.facing = p.x > prev ? 1 : -1;
    lastX.set(e.id, p.x);
    if (!onScreen(p.x, p.y)) return null;
    return {
      y: p.y,
      draw: () => {
        const attacking = e.attackingWall !== null;
        let id: SpriteId;
        if (attacking && e.kind === 'dzik') id = `dzik_atk_${Math.floor(e.animT * 6) % 2}` as SpriteId;
        else id = `${e.kind}_${Math.floor(e.animT * 8) % 4}` as SpriteId;
        const { w, h } = spriteSize(id);
        let img = e.facing === -1 ? getFlipped(id) : getSprite(id);
        const slowed = state.time < e.slowUntil;
        if (slowed) img = tint(img, 'rgba(14,10,8,0.42)');
        let dx = 0;
        let dy = 0;
        if (attacking) {
          dx = Math.round(Math.sin(e.animT * 38)) * s * e.facing;
          if (e.kind !== 'dzik') dy = -Math.abs(Math.round(Math.sin(e.animT * 12) * 2)) * s;
        }
        shadow(p.x, p.y, w * s);
        drawImg(img, p.x, p.y, s, dx, dy);
        if (slowed) {
          ctx.fillStyle = '#0b0907';
          for (let i = 0; i < 4; i++) {
            const ox = ((e.id * 7 + i * 5) % Math.max(4, w - 6)) - w / 2 + 3;
            const len = ((e.animT * 2.4 + i * 0.37) % 1) * 4 * s;
            ctx.fillRect(Math.round(p.x + ox * s + dx), Math.round(p.y - h * s * 0.45 + dy + (i % 2) * s), s, Math.round(s * 1.5 + len));
          }
        }
        const king = e.kind === 'krol_dzik';
        if (e.hp < e.maxHp || king)
          bars.push(() => {
            const top = p.y - h * s + dy;
            hpBar(p.x + dx, top, w * s * (king ? 0.9 : 0.75), e.hp / e.maxHp, s, king);
            if (king) outlined('Dzik Królewski', p.x + dx, top - 3 * s - Math.max(4, Math.round(s * 2.4)) - 12, 'bold 12px Georgia, serif', '#f3d86a', 4);
          });
      },
    };
  }

  function drawProjectile(pr: Projectile, s: number, state: GameState) {
    const k = Math.min(1, Math.max(0, pr.t / pr.dur));
    const a = proj.project(pr.from);
    const b = proj.project(pr.to);
    const p = proj.project(lerp(pr.from, pr.to, k));
    const src = state.towers.find((t) => t.pos[0] === pr.from[0] && t.pos[1] === pr.from[1]);
    const kind = src?.kind ?? (pr.kind === 'belt' ? 'kusznik' : pr.kind === 'smola' ? 'smola' : 'lucznik');
    const h0 = spriteSize(`${kind}_${src?.level ?? 1}` as SpriteId).h * s * 0.8;
    const h1 = 6 * s;
    const lift = h0 + (h1 - h0) * k;
    const img = getSprite(pr.kind);
    if (pr.kind === 'smola') {
      const arc = Math.sin(Math.PI * k) * (8 * s + Math.hypot(b.x - a.x, b.y - a.y) * 0.3);
      ctx.drawImage(img, Math.round(p.x - 2.5 * s), Math.round(p.y - lift - arc - 2.5 * s), img.width * s, img.height * s);
      return;
    }
    const ang = Math.atan2(b.y - h1 - (a.y - h0), b.x - a.x);
    ctx.save();
    ctx.translate(Math.round(p.x), Math.round(p.y - lift));
    ctx.rotate(ang);
    const sc = Math.max(2, s);
    ctx.drawImage(img, Math.round((-img.width * sc) / 2), Math.round((-img.height * sc) / 2), img.width * sc, img.height * sc);
    ctx.restore();
  }

  function drawEffect(f: Effect, s: number) {
    const k = Math.min(1, Math.max(0, f.t / f.dur));
    const p = proj.project(f.pos);
    if (!onScreen(p.x, p.y)) return;
    const sq = (x: number, y: number, size = s) => ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(size)), Math.max(1, Math.round(size)));
    switch (f.kind) {
      case 'puff':
        for (let i = 0; i < 7; i++) {
          const ang = i * 0.9 + 0.5;
          const r = (2 + k * 9) * s * (0.6 + (i % 3) * 0.25);
          const size = (2 + k * 2.5) * s;
          ctx.fillStyle = `rgba(${i % 2 ? 190 : 150},${i % 2 ? 184 : 144},${i % 2 ? 170 : 134},${(1 - k) * 0.85})`;
          sq(p.x + Math.cos(ang) * r - size / 2, p.y - 5 * s + Math.sin(ang) * r * 0.55 - size / 2 - k * 5 * s, size);
        }
        break;
      case 'blood':
        for (let i = 0; i < 9; i++) {
          const ang = i * 0.7 + 0.3;
          const r = (1 + k * (6 + (i % 3) * 3)) * s;
          ctx.fillStyle = `rgba(${i % 2 ? 140 : 100},14,12,${1 - k * 0.7})`;
          sq(p.x + Math.cos(ang) * r, p.y - 8 * s + Math.sin(ang) * r * 0.6 + k * k * 9 * s, s * (i % 3 === 0 ? 1.5 : 1));
        }
        break;
      case 'feathers':
        for (let i = 0; i < 6; i++) {
          const ang = i * 1.05 + 0.2;
          const x = p.x + Math.cos(ang) * k * (6 + i) * s + Math.sin(k * 9 + i) * s;
          const y = p.y - 8 * s - k * 6 * s + k * k * 10 * s + Math.sin(ang) * k * 3 * s;
          ctx.fillStyle = i % 3 === 0 ? `rgba(240,150,60,${1 - k})` : `rgba(245,242,230,${1 - k})`;
          sq(x, y, s * 1.5);
          sq(x + s, y + s, s);
        }
        break;
      case 'coin': {
        const cy = p.y - 12 * s - k * 16 * s;
        ctx.globalAlpha = 1 - k * k;
        const px = Math.round(p.x - 2 * s);
        const py = Math.round(cy - 2 * s);
        const rows = ['.kkk.', 'kyYyk', 'kyYyk', 'kyyyk', '.kkk.'];
        const pal: Record<string, string> = { k: '#5c3a08', y: '#e8b82a', Y: '#fff0a0' };
        rows.forEach((r, j) => [...r].forEach((c, i) => {
          if (c === '.') return;
          ctx.fillStyle = pal[c];
          ctx.fillRect(px + i * s, py + j * s, s, s);
        }));
        ctx.globalAlpha = 1;
        break;
      }
      case 'splash': {
        const R = (3 + k * 14) * s;
        ctx.fillStyle = `rgba(6,6,8,${(1 - k) * 0.35})`;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y - 2 * s, R, R * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(10,10,14,${(1 - k) * 0.95})`;
        for (let i = 0; i < 20; i++) {
          const ang = (i / 20) * Math.PI * 2;
          sq(p.x + Math.cos(ang) * R, p.y - 2 * s + Math.sin(ang) * R * 0.5, s * (i % 2 ? 1 : 1.5));
        }
        break;
      }
      case 'levelup':
        for (let i = 0; i < 10; i++) {
          const x = p.x + (((i * 37) % 21) - 10) * s * 0.8;
          const y = p.y - 6 * s - k * 22 * s - ((i * 13) % 9) * s;
          const tw = (Math.sin(k * 14 + i * 2) + 1) / 2;
          ctx.fillStyle = i % 2 ? `rgba(255,226,110,${(1 - k) * (0.5 + tw / 2)})` : `rgba(255,255,230,${(1 - k) * (0.5 + tw / 2)})`;
          sq(x, y, s * (tw > 0.6 ? 2 : 1));
          if (tw > 0.6) {
            sq(x - s, y + s / 2, s);
            sq(x + s * 2, y + s / 2, s);
          }
        }
        break;
    }
  }

  function drawGoal(level: Level, state: GameState, s: number, now: number): Item | null {
    const g = proj.project(level.goal.pos);
    if (!onScreen(g.x, g.y)) return null;
    const flash = Math.max(0, (flashUntil - now) / 0.7);
    // miękka złota poświata (pod postumentem)
    const pulse = 0.5 + 0.5 * Math.sin(now * 2.4);
    const R = (17 + pulse * 3) * s;
    const col = flash > 0 ? '255,60,50' : '255,210,90';
    const grad = ctx.createRadialGradient(g.x, g.y, R * 0.15, g.x, g.y, R);
    grad.addColorStop(0, `rgba(${col},${0.32 + 0.12 * pulse + flash * 0.3})`);
    grad.addColorStop(1, `rgba(${col},0)`);
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.scale(1, 0.5);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(${col},${0.55 + 0.3 * pulse})`;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.78, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return {
      y: g.y,
      draw: () => {
        const img = getSprite('syrenka');
        drawImg(img, g.x, g.y, s);
        if (flash > 0) {
          ctx.globalAlpha = Math.min(0.6, flash * 0.7);
          drawImg(tint(img, '#ff2a1a'), g.x, g.y, s);
          ctx.globalAlpha = 1;
        }
      },
    };
  }

  function drawPreview(state: GameState, s: number) {
    const kind = state.selectedBuild;
    if (!kind || !state.hover) return;
    const p = proj.project(state.hover);
    const valid = state.hoverValid;
    if (kind !== 'wall') {
      const r = proj.metersToPixels(TOWER_STATS[kind].levels[0].range, state.hover);
      ctx.save();
      ctx.setLineDash([7, 6]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = valid ? 'rgba(240,232,170,0.85)' : 'rgba(255,110,90,0.85)';
      ctx.fillStyle = valid ? 'rgba(240,230,160,0.08)' : 'rgba(255,60,40,0.08)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    const id: SpriteId = kind === 'wall' ? 'wall' : (`${kind}_1` as SpriteId);
    const img = getSprite(id);
    shadow(p.x, p.y, img.width * s);
    ctx.globalAlpha = 0.65;
    drawImg(tint(img, valid ? 'rgba(70,230,70,0.42)' : 'rgba(240,50,40,0.5)'), p.x, p.y, s);
    ctx.globalAlpha = 1;
  }

  function render(state: GameState, level: Level) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;
    const s = Math.min(8, Math.max(2, Math.round(2 ** (proj.zoom() - 17.6) * 3)));
    const now = performance.now() / 1000;
    if (prevLives >= 0 && state.lives < prevLives) flashUntil = now + 0.7;
    prevLives = state.lives;

    const items: Item[] = [];
    const bars: (() => void)[] = [];

    // zaznaczona wieża: zasięg pod spodem
    const sel = state.selectedTowerId === null ? undefined : state.towers.find((t) => t.id === state.selectedTowerId);
    if (sel) {
      const p = proj.project(sel.pos);
      const r = proj.metersToPixels(TOWER_STATS[sel.kind].levels[sel.level - 1].range, sel.pos);
      ctx.fillStyle = 'rgba(244,226,140,0.10)';
      ctx.strokeStyle = 'rgba(244,230,160,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      const pulse = 0.5 + 0.5 * Math.sin(now * 5);
      const rw = spriteSize(`${sel.kind}_${sel.level}` as SpriteId).w * s * (0.6 + pulse * 0.06);
      ctx.strokeStyle = `rgba(255,224,70,${0.65 + pulse * 0.35})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y - 2, rw, rw * 0.32, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    const goal = drawGoal(level, state, s, now);
    if (goal) items.push(goal);
    const gateImg = getSprite('gate');
    const labels: (() => void)[] = [];
    for (const en of level.entrances) {
      const p = proj.project(en.pos);
      if (!onScreen(p.x, p.y)) continue;
      items.push({
        y: p.y,
        draw: () => {
          shadow(p.x, p.y, gateImg.width * s);
          drawImg(gateImg, p.x, p.y, s);
        },
      });
      labels.push(() => outlined(en.name, p.x, p.y + 12, 'bold 11px Georgia, serif', PARCH, 3));
    }

    for (const w of state.walls) {
      const p = proj.project(w.pos);
      if (!onScreen(p.x, p.y)) continue;
      const id: SpriteId = w.hp < w.maxHp * 0.5 ? 'wall_damaged' : 'wall';
      const { w: sw, h: sh } = spriteSize(id);
      items.push({
        y: p.y,
        draw: () => {
          if (state.selectedWallId === w.id) {
            ctx.strokeStyle = `rgba(255,224,70,${0.65 + 0.35 * Math.sin(now * 5)})`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.ellipse(p.x, p.y - 2, sw * s * 0.6, sw * s * 0.2, 0, 0, Math.PI * 2);
            ctx.stroke();
          }
          shadow(p.x, p.y, sw * s);
          drawImg(getSprite(id), p.x, p.y, s);
          if (w.hp < w.maxHp) bars.push(() => hpBar(p.x, p.y - sh * s, sw * s * 0.8, w.hp / w.maxHp, s));
        },
      });
    }
    const gp = proj.project(level.goal.pos);
    for (const t of state.towers) {
      const p = proj.project(t.pos);
      if (!onScreen(p.x, p.y)) continue;
      const id = `${t.kind}_${t.level}` as SpriteId;
      items.push({
        y: p.y,
        draw: () => {
          shadow(p.x, p.y, spriteSize(id).w * s * 0.95);
          // Wieża stojąca przed Syrenką (niżej na ekranie, zasłaniająca ją) jest półprzezroczysta.
          const hides = p.y > gp.y && p.y - gp.y < 40 * s && Math.abs(p.x - gp.x) < 22 * s;
          if (hides) ctx.globalAlpha = 0.45;
          drawImg(getSprite(id), p.x, p.y, s);
          ctx.globalAlpha = 1;
        },
      });
    }
    const seen = new Set<number>();
    for (const e of state.enemies) {
      seen.add(e.id);
      const it = enemyItem(e, s, state, bars);
      if (it) items.push(it);
    }
    if (lastX.size > seen.size) for (const id of lastX.keys()) if (!seen.has(id)) lastX.delete(id);

    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();

    for (const pr of state.projectiles) {
      const p = proj.project(pr.from);
      const q = proj.project(pr.to);
      if (onScreen(p.x, p.y, 300) || onScreen(q.x, q.y, 300)) drawProjectile(pr, s, state);
    }
    for (const f of state.effects) drawEffect(f, s);
    for (const b of bars) b();
    for (const l of labels) l();
    drawPreview(state, s);
    // Komunikaty i ekran końca gry rysuje HUD.
  }

  return { resize, render };
}
