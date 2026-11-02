import * as THREE from 'three';

function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
const R = (a, b) => a + Math.random() * (b - a);

function tex(c, rx = 1, ry = 1, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.repeat.set(rx, ry);
  return t;
}

function noise(ctx, w, h, amt) {
  const id = ctx.getImageData(0, 0, w, h), d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amt;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(id, 0, 0);
}

// Painted/worn metal wall panels. Returns {map, bump}.
export function wallTextures(base = '#3b4249', trim = '#e0a02a') {
  const S = 512;
  const [c, x] = cv(S, S), [b, y] = cv(S, S);
  x.fillStyle = base; x.fillRect(0, 0, S, S);
  y.fillStyle = '#808080'; y.fillRect(0, 0, S, S);
  // panel layout
  const P = S / 2;
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    const px = i * P, py = j * P;
    const g = x.createLinearGradient(px, py, px, py + P);
    g.addColorStop(0, 'rgba(255,255,255,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0.18)');
    x.fillStyle = g; x.fillRect(px, py, P, P);
    // seams
    x.fillStyle = 'rgba(0,0,0,0.65)'; x.fillRect(px, py, P, 4); x.fillRect(px, py, 4, P);
    x.fillStyle = 'rgba(255,255,255,0.10)'; x.fillRect(px + 4, py + 4, P - 4, 2); x.fillRect(px + 4, py + 4, 2, P - 4);
    y.fillStyle = '#202020'; y.fillRect(px, py, P, 5); y.fillRect(px, py, 5, P);
    // rivets
    for (const [rx, ry] of [[16, 16], [P - 16, 16], [16, P - 16], [P - 16, P - 16]]) {
      x.fillStyle = 'rgba(0,0,0,0.5)'; x.beginPath(); x.arc(px + rx + 1, py + ry + 1, 5, 0, 7); x.fill();
      x.fillStyle = '#69727a'; x.beginPath(); x.arc(px + rx, py + ry, 4, 0, 7); x.fill();
      y.fillStyle = '#d0d0d0'; y.beginPath(); y.arc(px + rx, py + ry, 4, 0, 7); y.fill();
    }
  }
  // hazard trim at bottom
  x.save(); x.beginPath(); x.rect(0, S - 26, S, 26); x.clip();
  x.fillStyle = '#16181a'; x.fillRect(0, S - 26, S, 26);
  x.fillStyle = trim;
  for (let i = -2; i < 24; i++) { x.beginPath(); x.moveTo(i * 28, S); x.lineTo(i * 28 + 14, S); x.lineTo(i * 28 + 40, S - 26); x.lineTo(i * 28 + 26, S - 26); x.fill(); }
  x.restore();
  // grime streaks
  for (let i = 0; i < 70; i++) {
    const sx = R(0, S), len = R(40, 260), w = R(1, 6);
    const g = x.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, 'rgba(10,8,5,0.0)'); g.addColorStop(0.3, `rgba(10,8,5,${R(0.08, 0.28)})`); g.addColorStop(1, 'rgba(10,8,5,0)');
    x.save(); x.translate(sx, R(0, S - len)); x.fillStyle = g; x.fillRect(0, 0, w, len); x.restore();
  }
  // rust blotches
  for (let i = 0; i < 16; i++) {
    const rx = R(0, S), ry = R(0, S), rr = R(15, 70);
    const g = x.createRadialGradient(rx, ry, 0, rx, ry, rr);
    g.addColorStop(0, `rgba(${R(110, 150)},${R(50, 70)},20,${R(0.12, 0.3)})`); g.addColorStop(1, 'rgba(100,50,20,0)');
    x.fillStyle = g; x.fillRect(rx - rr, ry - rr, rr * 2, rr * 2);
  }
  // scratches
  x.strokeStyle = 'rgba(210,215,220,0.12)';
  for (let i = 0; i < 40; i++) { x.beginPath(); const sx = R(0, S), sy = R(0, S); x.moveTo(sx, sy); x.lineTo(sx + R(-40, 40), sy + R(-6, 6)); x.stroke(); }
  noise(x, S, S, 18); noise(y, S, S, 30);
  return { map: tex(c), bump: tex(b, 1, 1, false) };
}

// Grated floor plates.
export function floorTextures() {
  const S = 512;
  const [c, x] = cv(S, S), [b, y] = cv(S, S);
  x.fillStyle = '#23272b'; x.fillRect(0, 0, S, S);
  y.fillStyle = '#808080'; y.fillRect(0, 0, S, S);
  const T = 128;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const px = i * T, py = j * T;
    const shade = R(-8, 10);
    x.fillStyle = `rgb(${46 + shade},${52 + shade},${58 + shade})`; x.fillRect(px + 3, py + 3, T - 6, T - 6);
    // anti-slip diamond pattern
    x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 2;
    for (let k = -T; k < T * 2; k += 12) { x.beginPath(); x.moveTo(px + k, py); x.lineTo(px + k + T, py + T); x.stroke(); }
    x.save(); x.beginPath(); x.rect(px + 3, py + 3, T - 6, T - 6); x.clip();
    x.strokeStyle = 'rgba(255,255,255,0.05)';
    for (let k = -T; k < T * 2; k += 12) { x.beginPath(); x.moveTo(px + k + 4, py); x.lineTo(px + k + T + 4, py + T); x.stroke(); }
    x.restore();
    x.fillStyle = 'rgba(0,0,0,0.8)'; x.fillRect(px, py, T, 3); x.fillRect(px, py, 3, T);
    y.fillStyle = '#101010'; y.fillRect(px, py, T, 4); y.fillRect(px, py, 4, T);
    y.strokeStyle = 'rgba(255,255,255,0.35)'; y.lineWidth = 2;
    for (let k = -T; k < T * 2; k += 12) { y.beginPath(); y.moveTo(px + k, py); y.lineTo(px + k + T, py + T); y.stroke(); }
    for (const [rx, ry] of [[10, 10], [T - 10, 10], [10, T - 10], [T - 10, T - 10]]) {
      x.fillStyle = '#5b636b'; x.beginPath(); x.arc(px + rx, py + ry, 3.5, 0, 7); x.fill();
    }
  }
  for (let i = 0; i < 24; i++) {
    const rx = R(0, S), ry = R(0, S), rr = R(10, 60);
    const g = x.createRadialGradient(rx, ry, 0, rx, ry, rr);
    g.addColorStop(0, `rgba(8,6,4,${R(0.15, 0.4)})`); g.addColorStop(1, 'rgba(8,6,4,0)');
    x.fillStyle = g; x.fillRect(rx - rr, ry - rr, rr * 2, rr * 2);
  }
  noise(x, S, S, 16); noise(y, S, S, 24);
  return { map: tex(c), bump: tex(b, 1, 1, false) };
}

export function ceilingTexture() {
  const S = 256;
  const [c, x] = cv(S, S);
  x.fillStyle = '#1c1f23'; x.fillRect(0, 0, S, S);
  x.fillStyle = 'rgba(0,0,0,0.7)'; x.fillRect(0, 0, S, 4); x.fillRect(0, 0, 4, S);
  x.fillStyle = 'rgba(255,255,255,0.05)'; x.fillRect(4, 4, S, 2);
  for (let i = 0; i < 6; i++) { x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillRect(20 + i * 36, 40, 18, 176); }
  noise(x, S, S, 14);
  return tex(c);
}

export function hazardTexture() {
  const [c, x] = cv(128, 128);
  x.fillStyle = '#17191b'; x.fillRect(0, 0, 128, 128);
  x.fillStyle = '#d99a1c';
  for (let i = -2; i < 8; i++) { x.beginPath(); x.moveTo(i * 32, 128); x.lineTo(i * 32 + 16, 128); x.lineTo(i * 32 + 144, 0); x.lineTo(i * 32 + 128, 0); x.fill(); }
  noise(x, 128, 128, 20);
  return tex(c);
}

export function glowTexture(color = '255,255,255') {
  const [c, x] = cv(128, 128);
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, `rgba(${color},1)`); g.addColorStop(0.25, `rgba(${color},0.45)`); g.addColorStop(1, `rgba(${color},0)`);
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function stainTexture() {
  const [c, x] = cv(256, 256);
  for (let i = 0; i < 9; i++) {
    const rx = 128 + R(-60, 60), ry = 128 + R(-60, 60), rr = R(20, 70);
    const g = x.createRadialGradient(rx, ry, 0, rx, ry, rr);
    g.addColorStop(0, 'rgba(40,4,6,0.85)'); g.addColorStop(0.7, 'rgba(25,3,4,0.5)'); g.addColorStop(1, 'rgba(20,2,3,0)');
    x.fillStyle = g; x.fillRect(rx - rr, ry - rr, rr * 2, rr * 2);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function signTexture(lines, { bg = '#0c1014', fg = '#7fe7ff', w = 512, h = 128, border = true } = {}) {
  const [c, x] = cv(w, h);
  x.fillStyle = bg; x.fillRect(0, 0, w, h);
  if (border) { x.strokeStyle = fg; x.globalAlpha = 0.6; x.lineWidth = 3; x.strokeRect(6, 6, w - 12, h - 12); x.globalAlpha = 1; }
  x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
  const n = lines.length;
  lines.forEach((ln, i) => {
    const size = i === 0 ? h * (n > 1 ? 0.36 : 0.5) : h * 0.2;
    x.font = `bold ${size}px "Courier New", monospace`;
    x.fillText(ln, w / 2, h * ((i + 1) / (n + 1)));
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

// Screen/LED panel for consoles & server racks (emissive).
export function ledTexture(color = '#38f0ff', w = 128, h = 128) {
  const [c, x] = cv(w, h);
  x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
  for (let j = 0; j < h; j += 8) for (let i = 0; i < w; i += 8) {
    if (Math.random() < 0.35) {
      x.fillStyle = Math.random() < 0.15 ? '#ff4030' : color;
      x.globalAlpha = R(0.4, 1); x.fillRect(i + 1, j + 1, 5, 5);
    }
  }
  x.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
