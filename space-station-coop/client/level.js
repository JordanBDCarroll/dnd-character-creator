import * as THREE from 'three';
import { mulberry32 } from './util.js';
import { wallTextures, floorTextures, ceilingTexture, hazardTexture, stainTexture, signTexture, ledTexture } from './textures.js';

export const CELL = 12, N = 6, H = 4.2, DW = 3.6, DH = 3.2, WT = 0.4;
const HALF = CELL / 2;

const geoCache = new Map();
function boxGeo(sx, sy, sz, ts = 4) {
  const key = `${sx}|${sy}|${sz}|${ts}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const g = new THREE.BoxGeometry(sx, sy, sz), uv = g.attributes.uv;
  const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v; uv.setXY(i, (uv.getX(i) * dims[f][0]) / ts, (uv.getY(i) * dims[f][1]) / ts);
  }
  geoCache.set(key, g); return g;
}

export function buildLevel(seed) {
  const rng = mulberry32(seed);
  const pick = (a) => a[Math.floor(rng() * a.length)];
  const group = new THREE.Group();
  const colliders = [], fixtures = [], doors = [];

  // ---------------- materials ----------------
  const wallMats = [['#3b4249', '#e0a02a'], ['#3a4a43', '#d8c020'], ['#4a3b3b', '#e06a2a']].map(([c, t]) => {
    const { map, bump } = wallTextures(c, t);
    return new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 1.5, roughness: 0.82, metalness: 0.35 });
  });
  const fl = floorTextures();
  const floorMat = new THREE.MeshStandardMaterial({ map: fl.map, bumpMap: fl.bump, bumpScale: 2, roughness: 0.55, metalness: 0.6 });
  const ceilMat = new THREE.MeshStandardMaterial({ map: ceilingTexture(), roughness: 0.9, metalness: 0.3 });
  const hazMat = new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.7, metalness: 0.2 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x23282d, roughness: 0.45, metalness: 0.85 });
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x4b545c, roughness: 0.4, metalness: 0.8 });
  const crateTex = wallTextures('#5a4a32', '#222');
  const crateMat = new THREE.MeshStandardMaterial({ map: crateTex.map, bumpMap: crateTex.bump, roughness: 0.8, metalness: 0.2 });
  const barrelMats = [0xb8922a, 0x9c2f26, 0x2c5f8f, 0x3d7a4a].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.7 }));
  const tankMat = new THREE.MeshStandardMaterial({ color: 0x59656d, roughness: 0.3, metalness: 0.9 });
  const bedMat = new THREE.MeshStandardMaterial({ color: 0x6d7c8a, roughness: 0.9 });
  const emissive = (c, i = 1.5) => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(c), emissiveIntensity: i });

  const mesh = (geo, mat, x, y, z, { cast = true, rx = 0, ry = 0, rz = 0 } = {}) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    m.castShadow = cast; m.receiveShadow = true; group.add(m); return m;
  };
  const box = (cx, cy, cz, sx, sy, sz, mat, opts) => mesh(boxGeo(sx, sy, sz, opts?.ts), mat, cx, cy, cz, opts);
  const collide = (cx, cz, sx, sz, low = false) => colliders.push({ minX: cx - sx / 2, maxX: cx + sx / 2, minZ: cz - sz / 2, maxZ: cz + sz / 2, low });

  // ---------------- maze ----------------
  const E = Array.from({ length: N }, () => Array(N).fill(false)); // (i,j)-(i+1,j)
  const S = Array.from({ length: N }, () => Array(N).fill(false)); // (i,j)-(i,j+1)
  const seen = Array.from({ length: N }, () => Array(N).fill(false));
  (function carve(i, j) {
    seen[i][j] = true;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].sort(() => rng() - 0.5);
    for (const [dx, dy] of dirs) {
      const a = i + dx, b = j + dy;
      if (a < 0 || b < 0 || a >= N || b >= N || seen[a][b]) continue;
      if (dx === 1) E[i][j] = true; else if (dx === -1) E[a][j] = true; else if (dy === 1) S[i][j] = true; else S[i][b] = true;
      carve(a, b);
    }
  })(0, 0);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    if (i < N - 1 && !E[i][j] && rng() < 0.28) E[i][j] = true;
    if (j < N - 1 && !S[i][j] && rng() < 0.28) S[i][j] = true;
  }
  const adj = (i, j) => {
    const r = [];
    if (i < N - 1 && E[i][j]) r.push([i + 1, j]);
    if (i > 0 && E[i - 1][j]) r.push([i - 1, j]);
    if (j < N - 1 && S[i][j]) r.push([i, j + 1]);
    if (j > 0 && S[i][j - 1]) r.push([i, j - 1]);
    return r;
  };

  // ---------------- floor / ceiling ----------------
  const W = N * CELL;
  box(W / 2, -0.1, W / 2, W, 0.2, W, floorMat, { cast: false, ts: 4 });
  box(W / 2, H + 0.1, W / 2, W, 0.2, W, ceilMat, { cast: false, ts: 3 });

  // ---------------- cell moods ----------------
  const mood = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => {
    if (i === 0 && j === 0) return 'ship';
    const r = rng(); return r < 0.5 ? 'normal' : r < 0.68 ? 'warm' : r < 0.8 ? 'red' : 'dead';
  }));
  const theme = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => (i === 0 && j === 0) ? 'ship' : pick(['cargo', 'cargo', 'reactor', 'server', 'quarters', 'med', 'debris'])));

  // ---------------- walls & doors ----------------
  const hazPost = (x, z, axis) => axis === 'x' ? box(x, DH / 2, z, 0.26, DH, WT + 0.16, hazMat, { ts: 2 }) : box(x, DH / 2, z, WT + 0.16, DH, 0.26, hazMat, { ts: 2 });
  function wallSeg(axis, fixed, a, b, mat) {
    if (b - a < 0.05) return;
    const mid = (a + b) / 2, len = b - a;
    if (axis === 'x') { box(mid, H / 2, fixed, len, H, WT, mat); collide(mid, fixed, len, WT); }
    else { box(fixed, H / 2, mid, WT, H, len, mat); collide(fixed, mid, WT, len); }
  }
  function borderWall(axis, fixed, a, door, mat) {
    const b = a + CELL, c = (a + b) / 2;
    if (!door) return wallSeg(axis, fixed, a, b, mat);
    wallSeg(axis, fixed, a, c - DW / 2, mat); wallSeg(axis, fixed, c + DW / 2, b, mat);
    // lintel + frame
    if (axis === 'x') {
      box(c, (DH + H) / 2, fixed, DW, H - DH, WT, mat);
      hazPost(c - DW / 2 - 0.13, fixed, 'x'); hazPost(c + DW / 2 + 0.13, fixed, 'x');
    } else {
      box(fixed, (DH + H) / 2, c, WT, H - DH, DW, mat);
      hazPost(fixed, c - DW / 2 - 0.13, 'z'); hazPost(fixed, c + DW / 2 + 0.13, 'z');
    }
    // status light
    const light = emissive(0x2cff7a, 2.2);
    if (axis === 'x') box(c, DH + 0.12, fixed, 1.0, 0.1, WT + 0.2, light, { cast: false });
    else box(fixed, DH + 0.12, c, WT + 0.2, 0.1, 1.0, light, { cast: false });
    // sliding panels
    const mk = () => {
      const g = axis === 'x' ? boxGeo(DW / 2, DH, 0.18, 2) : boxGeo(0.18, DH, DW / 2, 2);
      const m = new THREE.Mesh(g, doorMat); m.castShadow = true; m.receiveShadow = true; group.add(m); return m;
    };
    doors.push({ axis, x: axis === 'x' ? c : fixed, z: axis === 'x' ? fixed : c, a: mk(), b: mk(), t: 0, target: 0, light });
  }
  for (let j = 0; j <= N; j++) for (let i = 0; i < N; i++) {
    const door = j > 0 && j < N && S[i][j - 1];
    borderWall('x', j * CELL, i * CELL, door, wallMats[(i * 7 + j * 13) % 3]);
  }
  for (let i = 0; i <= N; i++) for (let j = 0; j < N; j++) {
    const door = i > 0 && i < N && E[i - 1][j];
    borderWall('z', i * CELL, j * CELL, door, wallMats[(i * 11 + j * 5) % 3]);
  }

  // ---------------- lights ----------------
  const moodCfg = {
    ship: { color: 0xcfe8ff, int: 1.3, n: 4, p: 16 },
    normal: { color: 0xdfe9f2, int: 1.1, n: 2, p: 11 },
    warm: { color: 0xffc27a, int: 1.2, n: 2, p: 12 },
    red: { color: 0xff3a2a, int: 1.4, n: 2, p: 14 },
    dead: { color: 0xc8d6e2, int: 1.0, n: 1, p: 9 },
  };
  function addFixture(x, z, m) {
    const cfg = moodCfg[m];
    const mat = emissive(cfg.color, cfg.int);
    const mode = m === 'red' ? 'pulse' : m === 'dead' ? 'dead' : rng() < 0.3 ? 'flicker' : 'steady';
    box(x, H - 0.06, z, 1.6, 0.1, 0.5, mat, { cast: false });
    box(x, H - 0.02, z, 1.9, 0.06, 0.8, darkMetal, { cast: false });
    fixtures.push({ x, y: H - 0.5, z, color: new THREE.Color(cfg.color), intensity: cfg.p, mat, base: cfg.int, mode, phase: rng() * 100, f: 1 });
  }
  const lightSpots = [[-3, -3], [3, 3], [-3, 3], [3, -3]];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const cx = i * CELL + HALF, cz = j * CELL + HALF, m = mood[i][j];
    for (let k = 0; k < moodCfg[m].n; k++) addFixture(cx + lightSpots[k][0], cz + lightSpots[k][1], m);
  }

  // ---------------- props ----------------
  const quadrants = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  const P = {
    crates(x, z) {
      box(x, 0.6, z, 1.6, 1.2, 1.6, crateMat); collide(x, z, 1.6, 1.6);
      if (rng() < 0.7) box(x + (rng() - 0.5) * 0.3, 1.7, z + (rng() - 0.5) * 0.3, 1.0, 1.0, 1.0, crateMat, { ry: rng() * 0.7 });
      if (rng() < 0.4) { box(x + 1.5, 0.45, z - 0.2, 0.9, 0.9, 0.9, crateMat, { ry: rng() }); }
    },
    barrels(x, z) {
      for (const [dx, dz] of [[-0.5, -0.4], [0.5, -0.3], [0.0, 0.5]]) {
        const m = mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.1, 14), pick(barrelMats), x + dx, 0.55, z + dz);
        if (rng() < 0.15) { m.rotation.z = Math.PI / 2; m.position.y = 0.42; }
        mesh(new THREE.TorusGeometry(0.43, 0.03, 6, 16), darkMetal, x + dx, 0.75, z + dz, { rx: Math.PI / 2 });
      }
      collide(x, z, 1.9, 1.7, true);
    },
    console(x, z, sx, sz) {
      const ry = Math.atan2(-sx, -sz);
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; group.add(g);
      const add = (m) => { m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
      add(new THREE.Mesh(boxGeo(2.2, 0.95, 0.9), darkMetal)).position.set(0, 0.475, 0);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.8), new THREE.MeshStandardMaterial({ color: 0, emissive: 0xffffff, emissiveMap: ledTexture(pick(['#38f0ff', '#5dff8a', '#ffb43a'])), emissiveIntensity: 1.4 }));
      scr.position.set(0, 1.3, -0.05); scr.rotation.x = -0.35; g.add(scr);
      collide(x, z, 2.2, 1.4, true);
    },
    tank(x, z) {
      mesh(new THREE.CylinderGeometry(0.85, 0.85, H - 0.4, 20), tankMat, x, (H - 0.4) / 2, z);
      for (const y of [0.9, 2.0, 3.0]) mesh(new THREE.TorusGeometry(0.86, 0.05, 8, 24), emissive(rng() < 0.5 ? 0x35ff9a : 0x35c8ff, 2.2), x, y, z, { rx: Math.PI / 2, cast: false });
      mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.2, 8), darkMetal, x + 0.6, H - 0.6, z);
      collide(x, z, 1.8, 1.8);
    },
    rack(x, z, sx, sz) {
      const ry = Math.atan2(-sx, -sz);
      for (let k = -1; k <= 1; k += 2) {
        const g = new THREE.Group(); g.position.set(x + (Math.abs(sz) > Math.abs(sx) ? k * 0.6 : 0), 0, z + (Math.abs(sz) > Math.abs(sx) ? 0 : k * 0.6)); g.rotation.y = ry; group.add(g);
        const body = new THREE.Mesh(boxGeo(0.9, 2.5, 0.8), darkMetal); body.position.y = 1.25; body.castShadow = true; g.add(body);
        const face = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 2.3), new THREE.MeshStandardMaterial({ color: 0, emissive: 0xffffff, emissiveMap: ledTexture(pick(['#38f0ff', '#5dff8a', '#ffb43a']), 64, 128), emissiveIntensity: 1.6 }));
        face.position.set(0, 1.25, -0.41); face.rotation.y = Math.PI; g.add(face);
      }
      collide(x, z, 2.0, 1.8);
    },
    bunk(x, z) {
      box(x, 0.35, z, 2.0, 0.3, 1.0, bedMat); box(x, 1.25, z, 2.0, 0.3, 1.0, bedMat);
      for (const [dx, dz] of [[-0.95, -0.45], [0.95, -0.45], [-0.95, 0.45], [0.95, 0.45]]) box(x + dx, 0.8, z + dz, 0.08, 1.6, 0.08, darkMetal, { cast: false });
      collide(x, z, 2.0, 1.0);
    },
    med(x, z) {
      box(x, 0.55, z, 1.9, 0.12, 0.8, tankMat); box(x - 0.7, 0.27, z, 0.12, 0.54, 0.7, darkMetal); box(x + 0.7, 0.27, z, 0.12, 0.54, 0.7, darkMetal);
      box(x + 0.4, 0.62, z, 0.6, 0.05, 0.6, bedMat);
      mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.8, 6), darkMetal, x - 1.0, 0.9, z + 0.4);
      mesh(new THREE.BoxGeometry(0.1, 0.5, 0.1), emissive(0xff3030, 1.2), x - 1.0, 1.7, z + 0.4, { cast: false });
      collide(x, z, 2.0, 1.0, true);
    },
    pillar(x, z) {
      mesh(new THREE.CylinderGeometry(0.4, 0.4, H, 14), darkMetal, x, H / 2, z);
      mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.5, 14), hazMat, x, 0.5, z);
      collide(x, z, 0.8, 0.8);
    },
    debris(x, z) {
      for (let k = 0; k < 5; k++) box(x + (rng() - 0.5) * 2.2, 0.15 + rng() * 0.2, z + (rng() - 0.5) * 2.2, 0.6 + rng(), 0.1 + rng() * 0.2, 0.5 + rng() * 0.6, pick([darkMetal, crateMat, doorMat]), { ry: rng() * 6.28, rz: (rng() - 0.5) * 0.4, cast: false });
    },
  };
  const themeProps = {
    cargo: ['crates', 'crates', 'barrels', 'pillar'], reactor: ['tank', 'tank', 'console', 'pillar'], server: ['rack', 'rack', 'console'],
    quarters: ['bunk', 'bunk', 'barrels', 'pillar'], med: ['med', 'console', 'med'], debris: ['debris', 'crates', 'pillar'], ship: ['crates', 'console'],
  };
  const stainTex = stainTexture();
  const stainMat = new THREE.MeshBasicMaterial({ map: stainTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const signs = ['SECTOR', 'CARGO BAY', 'CAUTION', 'BIOHAZARD', 'NO ACCESS', 'COOLANT', 'DECK'];
  const signMats = {};
  const hazGeo = new THREE.PlaneGeometry(2.4, 0.6);

  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const cx = i * CELL + HALF, cz = j * CELL + HALF, th = theme[i][j];
    if (th !== 'ship') {
      for (const [qx, qz] of quadrants) {
        if (rng() < 0.28) continue;
        const kind = pick(themeProps[th]);
        const x = cx + qx * (3.9 + (rng() - 0.5) * 0.4), z = cz + qz * (3.9 + (rng() - 0.5) * 0.4);
        P[kind](x, z, -qx, -qz);
      }
    } else {
      P.crates(cx + 4.2, cz + 4.2); P.console(cx - 4.4, cz + 4.4, 1, -1); P.barrels(cx - 4, cz - 4.2);
    }
    if (rng() < 0.3) { // floor stain
      const s = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), stainMat);
      s.rotation.x = -Math.PI / 2; s.rotation.z = rng() * 6.28; s.position.set(cx + (rng() - 0.5) * 6, 0.02, cz + (rng() - 0.5) * 6); group.add(s);
    }
    // wall sign on a random side, away from the door lane
    if (rng() < 0.7) {
      const side = Math.floor(rng() * 4), off = (rng() < 0.5 ? -1 : 1) * 4.2;
      const label = th === 'ship' ? 'DROPSHIP BAY' : `${pick(signs)} ${String.fromCharCode(65 + j)}-${i + 1}`;
      const sub = th === 'ship' ? 'DELIVER SALVAGE ON THE PAD' : th.toUpperCase();
      if (!signMats[label]) signMats[label] = new THREE.MeshStandardMaterial({ color: 0, emissive: 0xffffff, emissiveMap: signTexture([label, sub], { fg: th === 'ship' ? '#7fffd4' : mood[i][j] === 'red' ? '#ff6a5a' : '#7fe7ff' }), emissiveIntensity: 0.9 });
      const s = new THREE.Mesh(hazGeo, signMats[label]);
      const o = HALF - WT / 2 - 0.02;
      if (side === 0) { s.position.set(cx + off, 2.7, cz - o); }
      else if (side === 1) { s.position.set(cx + off, 2.7, cz + o); s.rotation.y = Math.PI; }
      else if (side === 2) { s.position.set(cx - o, 2.7, cz + off); s.rotation.y = Math.PI / 2; }
      else { s.position.set(cx + o, 2.7, cz + off); s.rotation.y = -Math.PI / 2; }
      group.add(s);
    }
    // overhead pipes
    if (rng() < 0.6) {
      const along = rng() < 0.5, o = (rng() < 0.5 ? -1 : 1) * 5.3;
      mesh(new THREE.CylinderGeometry(0.12, 0.12, CELL, 8), darkMetal, along ? cx : cx + o, H - 0.35, along ? cz + o : cz, { rz: along ? Math.PI / 2 : 0, rx: along ? 0 : Math.PI / 2, cast: false });
    }
  }

  // ---------------- dropship pad ----------------
  const pad = { x: HALF, z: HALF, r: 2.4 };
  mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.06, 40), darkMetal, pad.x, 0.03, pad.z, { cast: false });
  const padRing = emissive(0x34f0d0, 2.4);
  mesh(new THREE.TorusGeometry(2.3, 0.07, 8, 56), padRing, pad.x, 0.09, pad.z, { rx: Math.PI / 2, cast: false });
  const padGlow = emissive(0x34f0d0, 0.5); padGlow.transparent = true; padGlow.opacity = 0.35;
  mesh(new THREE.CircleGeometry(2.3, 40), padGlow, pad.x, 0.075, pad.z, { rx: -Math.PI / 2, cast: false });

  // quota terminal (canvas, redrawn by the game)
  const tc = document.createElement('canvas'); tc.width = 512; tc.height = 256;
  const tctx = tc.getContext('2d'), tTex = new THREE.CanvasTexture(tc); tTex.colorSpace = THREE.SRGBColorSpace;
  const tScreen = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.6), new THREE.MeshStandardMaterial({ color: 0, emissive: 0xffffff, emissiveMap: tTex, emissiveIntensity: 1.1 }));
  tScreen.position.set(HALF + 3.6, 2.3, WT / 2 + 0.03); group.add(tScreen);
  box(HALF + 3.6, 2.3, WT / 2 - 0.01, 3.5, 1.9, 0.12, darkMetal, { cast: false });
  const terminal = {
    draw(info) {
      const c = tctx; c.fillStyle = '#031014'; c.fillRect(0, 0, 512, 256);
      c.strokeStyle = '#34f0d0'; c.lineWidth = 3; c.strokeRect(6, 6, 500, 244);
      c.fillStyle = '#34f0d0'; c.font = 'bold 30px "Courier New", monospace'; c.textAlign = 'left';
      c.fillText(`QUOTA  ROUND ${info.round}`, 24, 50);
      const pct = Math.min(1, info.banked / info.quota);
      c.font = 'bold 64px "Courier New", monospace'; c.fillText(`$${info.banked}`, 24, 125);
      c.font = '28px "Courier New", monospace'; c.fillStyle = '#6fb3a8'; c.fillText(`/ $${info.quota}`, 24, 160);
      c.fillStyle = '#0a2a2a'; c.fillRect(24, 190, 464, 26); c.fillStyle = pct >= 1 ? '#7dff7d' : '#34f0d0'; c.fillRect(24, 190, 464 * pct, 26);
      c.font = '20px "Courier New", monospace'; c.fillStyle = '#6fb3a8'; c.fillText(info.msg || 'BRING SALVAGE TO THE PAD', 24, 238);
      tTex.needsUpdate = true;
    },
  };
  terminal.draw({ round: 1, banked: 0, quota: 600 });

  // ---------------- dynamic pool of real lights ----------------
  const POOL = 7;
  const pool = Array.from({ length: POOL }, () => { const l = new THREE.PointLight(0xffffff, 0, 16, 2); l.castShadow = false; group.add(l); return l; });
  const cand = [];
  function assignLights(p) {
    cand.length = 0;
    for (const f of fixtures) { const dx = f.x - p.x, dz = f.z - p.z, d2 = dx * dx + dz * dz; if (d2 < 900 && f.f > 0.12) cand.push([d2, f]); }
    cand.sort((a, b) => a[0] - b[0]);
    for (let k = 0; k < POOL; k++) {
      const l = pool[k], c = cand[k];
      if (!c) { l.intensity = 0; continue; }
      const f = c[1]; l.position.set(f.x, f.y, f.z); l.color.copy(f.color); l.intensity = f.intensity * f.f;
    }
  }

  // ---------------- per-frame updates ----------------
  function update(dt, time, actors, audio, listener) {
    for (const f of fixtures) {
      let v = 1;
      if (f.mode === 'flicker') v = (Math.sin(time * 37 + f.phase) > 0.7 && Math.sin(time * 2.3 + f.phase) > 0.2) ? 0.1 : 1;
      else if (f.mode === 'pulse') v = 0.55 + 0.45 * Math.sin(time * 2.6 + f.phase);
      else if (f.mode === 'dead') v = (Math.sin(time * 1.3 + f.phase) > 0.93 || Math.sin(time * 29 + f.phase) > 0.97) ? 1 : 0.06;
      f.f = v; f.mat.emissiveIntensity = f.base * v;
    }
    for (const d of doors) {
      let near = false;
      for (const a of actors) { const dx = a.x - d.x, dz = a.z - d.z; if (dx * dx + dz * dz < 3.4 * 3.4) { near = true; break; } }
      const target = near ? 1 : 0;
      if (target !== d.target) {
        d.target = target;
        if (audio && listener) { const dx = listener.x - d.x, dz = listener.z - d.z; if (dx * dx + dz * dz < 625) audio.door({ x: d.x, y: 2, z: d.z }, !!target); }
      }
      d.t += Math.sign(target - d.t) * Math.min(Math.abs(target - d.t), dt / 0.38);
      const e = d.t < 0.5 ? 2 * d.t * d.t : 1 - Math.pow(-2 * d.t + 2, 2) / 2;
      const off = DW / 4 + e * (DW / 2 + 0.05);
      if (d.axis === 'x') { d.a.position.set(d.x - off, DH / 2, d.z); d.b.position.set(d.x + off, DH / 2, d.z); }
      else { d.a.position.set(d.x, DH / 2, d.z - off); d.b.position.set(d.x, DH / 2, d.z + off); }
      d.light.emissive.setHex(d.t > 0.05 ? 0x2cff7a : 0xff5a2a);
    }
    padRing.emissiveIntensity = 2 + Math.sin(time * 2.4) * 0.6;
  }

  // ---------------- helpers ----------------
  const cellOf = (x, z) => [Math.max(0, Math.min(N - 1, Math.floor(x / CELL))), Math.max(0, Math.min(N - 1, Math.floor(z / CELL)))];
  const cellCenter = (i, j) => ({ x: i * CELL + HALF, z: j * CELL + HALF });
  function path(a, b) { // BFS over cells
    const key = (c) => c[0] * N + c[1], prev = new Map([[key(a), null]]), q = [a];
    while (q.length) {
      const c = q.shift(); if (c[0] === b[0] && c[1] === b[1]) break;
      for (const n of adj(c[0], c[1])) if (!prev.has(key(n))) { prev.set(key(n), c); q.push(n); }
    }
    const out = []; let c = b;
    while (c) { out.push(c); c = prev.get(key(c)); }
    return out.reverse();
  }
  const spawnPoints = [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2], [0, 2.8], [0, -2.8], [2.8, 0], [-2.8, 0]].map(([dx, dz]) => ({ x: pad.x + dx, z: pad.z + dz }));

  group.traverse((o) => { if (o.isMesh && !o.material.transparent) o.matrixAutoUpdate = o.matrixAutoUpdate; });
  return { group, colliders, fixtures, doors, adj, cellOf, cellCenter, path, update, assignLights, pad, spawnPoints, terminal, size: W, mood };
}
