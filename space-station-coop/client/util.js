export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
export function angDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export const dampAngle = (a, b, k, dt) => a + angDiff(a, b) * (1 - Math.exp(-k * dt));
export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

// Push a circle out of AABB colliders (XZ plane). Returns [x, z].
export function resolveCircle(x, z, r, cols) {
  for (let it = 0; it < 2; it++) {
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (x < c.minX - r || x > c.maxX + r || z < c.minZ - r || z > c.maxZ + r) continue;
      const cx = clamp(x, c.minX, c.maxX), cz = clamp(z, c.minZ, c.maxZ);
      let dx = x - cx, dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2), p = r - d;
          x += (dx / d) * p; z += (dz / d) * p;
        } else {
          const l = x - c.minX, rr = c.maxX - x, t = z - c.minZ, b = c.maxZ - z;
          const m = Math.min(l, rr, t, b);
          if (m === l) x = c.minX - r; else if (m === rr) x = c.maxX + r;
          else if (m === t) z = c.minZ - r; else z = c.maxZ + r;
        }
      }
    }
  }
  return [x, z];
}

// Is the 2D segment blocked by any collider? (Liang–Barsky)
export function segBlocked(ax, az, bx, bz, cols, minHeight = 0) {
  const dx = bx - ax, dz = bz - az;
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    if (c.low) continue; // low props don't block sight
    let t0 = 0, t1 = 1;
    const p = [-dx, dx, -dz, dz];
    const q = [ax - c.minX, c.maxX - ax, az - c.minZ, c.maxZ - az];
    let hit = true;
    for (let k = 0; k < 4; k++) {
      if (p[k] === 0) { if (q[k] < 0) { hit = false; break; } }
      else {
        const t = q[k] / p[k];
        if (p[k] < 0) { if (t > t1) { hit = false; break; } if (t > t0) t0 = t; }
        else { if (t < t0) { hit = false; break; } if (t < t1) t1 = t; }
      }
    }
    if (hit && t0 <= t1) return true;
  }
  return false;
}

export function playerColor(id) {
  const hues = [8, 200, 48, 130, 280, 24, 170, 330];
  return `hsl(${hues[id % hues.length]}, 55%, 46%)`;
}
