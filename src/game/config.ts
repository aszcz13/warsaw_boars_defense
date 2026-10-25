import type { EnemyKind, ProjectileKind, TowerKind } from './types';

export interface EnemyStats {
  name: string;
  hp: number;
  /** m/s */
  speed: number;
  bounty: number;
  /** Obrażenia zadawane murowi na sekundę. */
  wallDamage: number;
  /** Ile życia Syrenki zabiera po dotarciu. */
  livesCost: number;
  /** Waga zagrożenia w koszcie trasy AI (0 = ignoruje wieże, 3 = bardzo ostrożny). */
  risk: number;
  /** Czy chodzi stadem za przewodnikiem. */
  pack: boolean;
}

// Trasy po Starówce mają 100–300 m, więc prędkości są małe.
export const ENEMY_STATS: Record<EnemyKind, EnemyStats> = {
  dzik: { name: 'Dzik', hp: 100, speed: 4.5, bounty: 10, wallDamage: 30, livesCost: 1, risk: 0.3, pack: false },
  lis: { name: 'Lis', hp: 34, speed: 8, bounty: 5, wallDamage: 3, livesCost: 1, risk: 2.5, pack: false },
  jelen: { name: 'Jeleń', hp: 66, speed: 6.5, bounty: 8, wallDamage: 8, livesCost: 1, risk: 1.2, pack: false },
  wilk: { name: 'Wilk', hp: 50, speed: 7, bounty: 6, wallDamage: 10, livesCost: 1, risk: 1.0, pack: true },
  krol_dzik: { name: 'Dzik Królewski', hp: 1800, speed: 3, bounty: 150, wallDamage: 150, livesCost: 8, risk: 0.1, pack: false },
};

export interface TowerLevel {
  /** Koszt: levels[0] = budowa, levels[1..] = ulepszenie do tego poziomu. */
  cost: number;
  damage: number;
  /** Zasięg w metrach. */
  range: number;
  /** Sekundy między strzałami. */
  reload: number;
}

export interface TowerStats {
  name: string;
  desc: string;
  /** Promień obszarowy w metrach (0 = pojedynczy cel). */
  splash: number;
  /** Sekundy spowolnienia (0 = brak). Spowolnienie = połowa prędkości. */
  slow: number;
  projectile: ProjectileKind;
  /** m/s */
  projectileSpeed: number;
  levels: [TowerLevel, TowerLevel, TowerLevel];
}

export const TOWER_STATS: Record<TowerKind, TowerStats> = {
  lucznik: {
    name: 'Łucznik', desc: 'Tani i szybki. Dobry na lisy.', splash: 0, slow: 0, projectile: 'strzala', projectileSpeed: 60,
    levels: [
      { cost: 50, damage: 7, range: 27, reload: 0.7 },
      { cost: 45, damage: 11, range: 31, reload: 0.6 },
      { cost: 100, damage: 16, range: 34, reload: 0.5 },
    ],
  },
  kusznik: {
    name: 'Kusznik', desc: 'Wolny, ale przebija dziczą skórę.', splash: 0, slow: 0, projectile: 'belt', projectileSpeed: 90,
    levels: [
      { cost: 90, damage: 32, range: 36, reload: 2.0 },
      { cost: 80, damage: 50, range: 39, reload: 1.8 },
      { cost: 165, damage: 68, range: 42, reload: 1.6 },
    ],
  },
  balista: {
    name: 'Balista', desc: 'Dalekiego zasięgu, miażdży pojedynczy cel (dziki, Dzik Królewski).', splash: 0, slow: 0, projectile: 'belt', projectileSpeed: 110,
    levels: [
      { cost: 170, damage: 110, range: 49, reload: 3.4 },
      { cost: 140, damage: 170, range: 54, reload: 3.1 },
      { cost: 265, damage: 222, range: 56, reload: 2.8 },
    ],
  },
  bombarda: {
    name: 'Bombarda', desc: 'Kamienne kule rażą obszar z daleka. Wolna.', splash: 11, slow: 0, projectile: 'smola', projectileSpeed: 40,
    levels: [
      { cost: 200, damage: 60, range: 41, reload: 4.2 },
      { cost: 160, damage: 95, range: 44, reload: 3.8 },
      { cost: 290, damage: 145, range: 49, reload: 3.4 },
    ],
  },
  smola: {
    name: 'Kocioł ze smołą', desc: 'Oblewa grupy wrzątkiem i spowalnia.', splash: 9, slow: 2.5, projectile: 'smola', projectileSpeed: 25,
    levels: [
      { cost: 120, damage: 16, range: 19, reload: 2.8 },
      { cost: 100, damage: 26, range: 20, reload: 2.5 },
      { cost: 190, damage: 40, range: 23, reload: 2.2 },
    ],
  },
};

export const WALL_STATS = { name: 'Mur', desc: 'Blokuje uliczkę. Dziki potrafią go rozbić.', cost: 30, hp: 550 };

/** Mnożnik kosztu naprawy muru (1 = pełna naprawa kosztuje tyle, co budowa). */
export const WALL_REPAIR_RATIO = 1.0;
/** Koszt naprawy muru proporcjonalny do obrażeń (min. 1 zł gdy uszkodzony, 0 gdy cały). */
export function wallRepairCost(hp: number, maxHp: number): number {
  if (hp >= maxHp) return 0;
  return Math.max(1, Math.ceil((1 - hp / maxHp) * WALL_STATS.cost * WALL_REPAIR_RATIO));
}

export const SELL_RATIO = 0.6;
export const START_GOLD = 320;
export const START_LIVES = 20;
/** Przerwa między falami (s). */
export const WAVE_BREAK = 20;

/** Mur: max odległość kliknięcia od krawędzi drogi (m). */
export const WALL_MAX_ROAD_DIST = 3;
/** Kara do A* (metry) za przejście przez krawędź z murem, gdy nie ma objazdu. */
export const WALL_PATH_PENALTY = 300;

// --- AI stada (ukryte) ---
export const AI = {
  /** Wygaszanie zagrożenia między falami. */
  dangerDecay: 0.6,
  /** Parowanie feromonu między falami. */
  tauDecay: 0.8,
  /** Waga feromonu w koszcie trasy. */
  tauWeight: 0.8,
  /** Zakres szumu kosztu krawędzi (eksploracja). */
  noise: 0.15,
  /** Minimalny udział każdego wejścia w fali. */
  minEntranceShare: 0.03,
  /** Temperatura softmaxu wejść. */
  temperature: 0.35,
};
