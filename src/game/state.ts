import type { GameState, Level } from './types';
import { START_GOLD, START_LIVES, WAVE_BREAK } from './config';
import { createAi } from './ai';

export function createGame(level: Level): GameState {
  return {
    gold: START_GOLD,
    lives: START_LIVES,
    wave: 0,
    phase: 'build',
    nextWaveIn: WAVE_BREAK,
    time: 0,
    enemies: [],
    towers: [],
    walls: [],
    projectiles: [],
    effects: [],
    tracks: new Map(),
    ai: createAi(level),
    selectedBuild: null,
    selectedTowerId: null,
    selectedWallId: null,
    hover: null,
    hoverValid: false,
    hoverCell: -1,
    hoverEdge: -1,
    message: null,
    nextId: 1,
  };
}

export function say(state: GameState, text: string, secs = 2.5): void {
  state.message = { text, until: state.time + secs };
}
