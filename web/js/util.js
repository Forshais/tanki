import * as THREE from 'three';

export const rng = s => () => (s = (s * 16807) % 2147483647) / 2147483647;
export const rand = (a, b) => a + Math.random() * (b - a);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

export function canvasTex(w, h, draw, o = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (o.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// world <-> model transforms for a body with heading `h` (model faces +Z)
export function toLocal(dx, dz, h) {
  const c = Math.cos(h), s = Math.sin(h);
  return [dx * c - dz * s, dx * s + dz * c];
}
export function toWorld(lx, lz, h) {
  const c = Math.cos(h), s = Math.sin(h);
  return [lx * c + lz * s, -lx * s + lz * c];
}

// Ray vs axis-aligned box (slab test). Returns {t, axis, sign} of the entry or null.
export function rayBox(o, d, min, max, tMax) {
  let t0 = 0, t1 = tMax, axis = -1, sign = 0;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-9) { if (o[k] < min[k] || o[k] > max[k]) return null; continue; }
    let a = (min[k] - o[k]) / d[k], b = (max[k] - o[k]) / d[k], s = -1;
    if (a > b) { [a, b] = [b, a]; s = 1; }
    if (a > t0) { t0 = a; axis = k; sign = s; }
    if (b < t1) t1 = b;
    if (t0 > t1) return null;
  }
  return axis < 0 ? null : { t: t0, axis, sign };
}
