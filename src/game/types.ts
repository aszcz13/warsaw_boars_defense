// Wspólny kontrakt typów dla wszystkich modułów gry (v2: Starówka + Syrenka).

export type LngLat = [number, number];

// --- Poziom (Starówka) ---

/** Wejście na Starówkę — tu rodzi się zwierzyna. */
export interface Entrance {
  name: string;
  node: number;
  pos: LngLat;
}

/** Format pliku public/data/oldtown.json. */
export interface LevelFile {
  /** Obrys Starówki (zamknięty pierścień, ostatni punkt = pierwszy). */
  polygon: LngLat[];
  nodes: LngLat[];
  /** [węzełA, węzełB, długość w metrach] */
  edges: [number, number, number][];
  entrances: Entrance[];
  /** Syrenka na Rynku. */
  goal: { name: string; node: number; pos: LngLat };
  /**
   * Pola budowy: sześciokąty (axial, wierzchołek do góry) o promieniu `radius` m.
   * Metry: x = (lng-origin[0])*mx, y = (lat-origin[1])*my; środek pola (q,r): x = radius*sqrt3*(q+r/2), y = radius*1.5*r.
   */
  cells: { kind: 'hex'; size: number; radius: number; origin: LngLat; mx: number; my: number; centers: LngLat[] };
}

export interface RoadGraph {
  nodes: LngLat[];
  edges: [number, number, number][];
  /** adj[node] = lista sąsiadów z indeksem krawędzi. */
  adj: { to: number; edge: number }[][];
}

export interface Level extends LevelFile, RoadGraph {}

// --- Encje ---

export type EnemyKind = 'dzik' | 'lis' | 'jelen' | 'wilk' | 'krol_dzik';
export type TowerKind = 'lucznik' | 'kusznik' | 'smola' | 'balista' | 'bombarda';
export type BuildKind = TowerKind | 'wall';
export type ProjectileKind = 'strzala' | 'belt' | 'smola';
export type EffectKind = 'puff' | 'blood' | 'coin' | 'splash' | 'feathers' | 'levelup';

export interface Enemy {
  id: number;
  kind: EnemyKind;
  pos: LngLat;
  hp: number;
  maxHp: number;
  /** Bazowa prędkość w m/s. */
  speed: number;
  /** state.time (s) do kiedy jest spowolniony smołą. */
  slowUntil: number;
  /** Indeks wejścia (level.entrances), z którego wyszedł. */
  entrance: number;
  /** Ścieżka jako lista indeksów węzłów, od startu do Syrenki. */
  path: number[];
  /** Indeks w `path` węzła, z którego aktualnie idzie (do path[pathIdx+1]). */
  pathIdx: number;
  /** Metry przebyte na bieżącym odcinku. */
  progress: number;
  /** Indeks krawędzi grafu, po której teraz idzie (-1 = stoi w węźle). */
  curEdge: number;
  /** Krawędzie już przebyte (do nauki AI i tropów). */
  walked: number[];
  /** Obrażenia otrzymane łącznie (do nauki AI). */
  dmgTaken: number;
  /** Id przewodnika stada (wilki) albo null. */
  leaderId: number | null;
  /** Id muru, który aktualnie rozwala, albo null. */
  attackingWall: number | null;
  /** Licznik animacji (s). */
  animT: number;
  /** 1 = patrzy w prawo na ekranie, -1 = w lewo. Ustawia render. */
  facing: 1 | -1;
}

export interface Tower {
  id: number;
  kind: TowerKind;
  /** 1..3 */
  level: number;
  /** Indeks pola budowy (level.cells.centers). */
  cell: number;
  pos: LngLat;
  cooldown: number;
  /** Ile złota łącznie w nią włożono (do sprzedaży). */
  spent: number;
  /** Id celu, w który ostatnio strzelała (dla renderu: obrót łucznika). */
  lastTarget: number | null;
}

export interface Wall {
  id: number;
  /** Indeks krawędzi grafu, którą blokuje. */
  edge: number;
  pos: LngLat;
  hp: number;
  maxHp: number;
}

export interface Projectile {
  id: number;
  kind: ProjectileKind;
  from: LngLat;
  to: LngLat;
  targetId: number;
  t: number;
  dur: number;
  damage: number;
  /** Promień obrażeń obszarowych w metrach (0 = pojedynczy cel). */
  splash: number;
  /** Sekundy spowolnienia (0 = brak). */
  slow: number;
}

export interface Effect {
  kind: EffectKind;
  pos: LngLat;
  t: number;
  dur: number;
}

/** Pamięć stada — ukryta przed graczem. Indeksowana krawędziami / wejściami. */
export interface AiMemory {
  /** Zagrożenie na krawędzi (obrażenia + pokrycie wież), wygaszane między falami. */
  danger: Float32Array;
  /** Feromon sukcesu na krawędzi, paruje między falami. */
  tau: Float32Array;
  /** Wagi wyboru wejścia (bandyta). */
  entranceW: number[];
  /** Statystyki bieżącej fali per wejście. */
  entranceStats: { sent: number; reached: number; progress: number; dmg: number }[];
  /** Log do testów: per fala rozkład wejść i średnie zagrożenie tras. */
  log: { wave: number; entranceShare: number[]; meanDanger: number; reached: number }[];
}

export type Phase = 'build' | 'wave' | 'lost' | 'won';

export interface GameState {
  gold: number;
  /** Życie Syrenki. */
  lives: number;
  wave: number;
  phase: Phase;
  nextWaveIn: number;
  time: number;
  enemies: Enemy[];
  towers: Tower[];
  walls: Wall[];
  projectiles: Projectile[];
  effects: Effect[];
  /** Tropy: krawędź -> state.time ostatniego przejścia zwierzęcia. */
  tracks: Map<number, number>;
  ai: AiMemory;
  /** Co gracz ma wybrane do budowy (null = nic). */
  selectedBuild: BuildKind | null;
  /** Zaznaczona wieża (panel info: ulepsz/sprzedaj). */
  selectedTowerId: number | null;
  /** Zaznaczony mur (panel: napraw/sprzedaj); wyklucza zaznaczoną wieżę. */
  selectedWallId: number | null;
  /** Podgląd budowy: pozycja już przyciągnięta do pola/krawędzi. */
  hover: LngLat | null;
  hoverValid: boolean;
  /** Pole pod kursorem (-1 = brak) — do podświetlenia. */
  hoverCell: number;
  /** Krawędź pod kursorem przy budowie muru (-1 = brak). */
  hoverEdge: number;
  message: { text: string; until: number } | null;
  nextId: number;
}

// --- Render ---

export interface Projector {
  project(p: LngLat): { x: number; y: number };
  zoom(): number;
  metersToPixels(m: number, at: LngLat): number;
}

export type SpriteId =
  | `${EnemyKind}_${0 | 1 | 2 | 3}`
  | 'dzik_atk_0'
  | 'dzik_atk_1'
  | `${TowerKind}_${1 | 2 | 3}`
  | 'wall'
  | 'wall_damaged'
  | ProjectileKind
  | 'syrenka'
  | 'gate';
