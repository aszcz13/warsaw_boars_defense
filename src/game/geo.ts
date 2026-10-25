import type { LngLat } from './types';

const R = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Odległość w metrach (haversine). */
export function distM(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Interpolacja liniowa między dwoma punktami (t w [0,1]). */
export function lerp(a: LngLat, b: LngLat, t: number): LngLat {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Rzut punktu p na odcinek ab. Zwraca najbliższy punkt, parametr t i odległość w metrach. */
export function projectOnSegment(p: LngLat, a: LngLat, b: LngLat): { point: LngLat; t: number; dist: number } {
  // Lokalnie płaskie przybliżenie: skalujemy długość geograficzną przez cos(lat).
  const k = Math.cos(toRad(p[1]));
  const ax = a[0] * k, ay = a[1];
  const bx = b[0] * k, by = b[1];
  const px = p[0] * k, py = p[1];
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const point = lerp(a, b, t);
  return { point, t, dist: distM(p, point) };
}
