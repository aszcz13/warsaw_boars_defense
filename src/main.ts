import { createMap, createProjector, fitMap } from './map';
import { loadLevel } from './game/graph';
import {
  createGame,
  nextWavePreview,
  occupiedCells,
  selectAt,
  sellAt,
  repairWall,
  sellTower,
  sellWall,
  snapBuild,
  startNextWave,
  step,
  totalWaves,
  tryBuild,
  upgradeTower,
} from './game/game';
import { setSpeed, startLoop } from './game/loop';
import { createRenderer } from './gfx/render';
import { createOverlays } from './gfx/overlays';
import { createHud } from './ui/hud';
import { showIntro } from './ui/intro';
import type { GameState, LngLat } from './game/types';

async function main() {
  const level = await loadLevel();
  const map = await createMap('map', level);
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const renderer = createRenderer(canvas, createProjector(map));
  renderer.resize();
  window.addEventListener('resize', () => renderer.resize());
  const overlays = createOverlays(map, level);

  let state: GameState = createGame(level);
  let lastMouse: LngLat | null = null;

  // Podgląd budowy: przyciągnięcie do pola / krawędzi.
  const refreshHover = () => {
    if (!state.selectedBuild || !lastMouse) {
      state.hover = null;
      state.hoverValid = false;
      state.hoverCell = -1;
      state.hoverEdge = -1;
      return;
    }
    const snap = snapBuild(state, level, state.selectedBuild, lastMouse);
    state.hover = snap.pos;
    state.hoverValid = snap.error === null;
    state.hoverCell = snap.cell;
    state.hoverEdge = snap.edge;
  };

  const hud = createHud(
    document.getElementById('hud')!,
    level,
    {
      onSelect: (kind) => {
        state.selectedBuild = kind;
        if (kind) { state.selectedTowerId = null; state.selectedWallId = null; }
        refreshHover();
      },
      onNextWave: () => startNextWave(state),
      onRestart: () => {
        state = createGame(level);
      },
      onSpeed: setSpeed,
      onUpgrade: (id) => upgradeTower(state, id),
      onSell: (id, via) => sellTower(state, level, id, via),
      onRepairWall: (id) => repairWall(state, id),
      onSellWall: (id) => sellWall(state, level, id),
      onDeselect: () => {
        state.selectedTowerId = null;
        state.selectedWallId = null;
      },
    },
    { preview: (s) => nextWavePreview(s), totalWaves: totalWaves() },
  );

  // Kadr uwzględnia faktyczną wysokość HUD (po jego zbudowaniu i przy zmianie rozmiaru okna).
  fitMap(map, level);
  let fitTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(fitTimer);
    fitTimer = window.setTimeout(() => fitMap(map, level), 120);
  });

  const toLngLat = (e: { lngLat: { lng: number; lat: number } }): LngLat => [e.lngLat.lng, e.lngLat.lat];

  const BODY_PX = 25;
  const bodyShift = (e: { point: { x: number; y: number } }): LngLat => {
    const q = map.unproject([e.point.x, e.point.y + BODY_PX]);
    return [q.lng, q.lat];
  };

  map.on('mousemove', (e) => {
    lastMouse = toLngLat(e);
    refreshHover();
  });
  map.on('mouseout', () => {
    lastMouse = null;
    refreshHover();
  });
  map.on('click', (e) => {
    const p = toLngLat(e);
    // Wybór budowli zostaje aktywny po postawieniu (jak w klasycznych TD); PPM/Esc anuluje.
    if (state.selectedBuild) {
      tryBuild(state, level, state.selectedBuild, p);
    } else {
      selectAt(state, level, p);
      // Klik w korpus sprite'a wieży (rysowany ~BODY_PX nad środkiem pola) też zaznacza wieżę.
      if (state.selectedTowerId === null && state.selectedWallId === null) {
        selectAt(state, level, bodyShift(e));
      }
    }
    refreshHover();
  });
  map.on('contextmenu', (e) => {
    if (state.selectedBuild) {
      // PPM w trybie budowy = anuluj (klasyczne RTS).
      state.selectedBuild = null;
    } else {
      if (!sellAt(state, level, toLngLat(e))) sellAt(state, level, bodyShift(e));
    }
    refreshHover();
  });

  // Podgląd stanu w konsoli przy debugowaniu (tylko dev).
  if (import.meta.env.DEV) Object.defineProperty(window, '__game', { get: () => ({ state, level, map }) });

  // Ekran startowy: do kliknięcia OK symulacja stoi (czas przerwy przed 1. falą nie płynie).
  let paused = true;
  showIntro(totalWaves()).then(() => { paused = false; });

  startLoop(
    (dt) => { if (!paused) step(state, level, dt); },
    () => {
      renderer.render(state, level);
      overlays.update(state, occupiedCells(state));
      hud.update(state);
    },
  );
}

main().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML(
    'beforeend',
    `<pre style="position:absolute;top:10px;left:10px;color:#f88;z-index:9">Błąd startu: ${String(err)}</pre>`,
  );
});
