// Small math + DOM helpers shared across the scene modules.

export const TAU = Math.PI * 2;

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (min, max) => min + Math.random() * (max - min);
export const randInt = (min, max) => Math.floor(rand(min, max + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export const damp = (current, target, lambda, dt) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

export const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

// Orientation helpers ------------------------------------------------------
const UP = { x: 0, y: 1, z: 0 };

/** Any unit vector, uniform on the sphere. */
export function randomDirection(target = { x: 0, y: 0, z: 0 }) {
  const u = Math.random() * 2 - 1;
  const theta = Math.random() * TAU;
  const r = Math.sqrt(1 - u * u);
  target.x = r * Math.cos(theta);
  target.y = u;
  target.z = r * Math.sin(theta);
  return target;
}

/** A unit vector roughly opposite to `dir` (for arcs flipping up). */
export function randomPerpendicular(dir, target = { x: 0, y: 0, z: 0 }) {
  const ref = Math.abs(dir.y) > 0.9 ? { x: 1, y: 0, z: 0 } : UP;
  target.x = dir.y * ref.z - dir.z * ref.y;
  target.y = dir.z * ref.x - dir.x * ref.z;
  target.z = dir.x * ref.y - dir.y * ref.x;
  const len = Math.hypot(target.x, target.y, target.z) || 1;
  target.x /= len;
  target.y /= len;
  target.z /= len;
  return target;
}

export const isReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export const isCoarsePointer = () =>
  window.matchMedia?.('(pointer: coarse)').matches ?? false;
