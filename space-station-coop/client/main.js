import * as THREE from 'three';
import { AudioEngine } from './audio.js';
import { buildLevel, CELL } from './level.js';
import { LOOT, LOOT_KINDS, buildLootMesh } from './loot.js';
import { MonsterSim, MonsterView, MON_STATES } from './monster.js';
import { RemotePlayer } from './remote.js';
import { Voice } from './voice.js';
import { Net } from './net.js';
import { Particles, Dust, createComposer } from './fx.js';
import { clamp, damp, lerp, resolveCircle, easeOutBack } from './util.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const audio = new AudioEngine();
const net = new Net();
let voice = null;

// ============================== renderer / scene ==============================
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const lowQ = params.get('q') === 'low';
let pixelRatio = lowQ ? 0.5 : Math.min(devicePixelRatio, 1.5);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x03050a);
scene.fog = new THREE.FogExp2(0x020306, 0.05);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 120);
scene.add(camera);
scene.add(new THREE.HemisphereLight(0x2a3a52, 0x0c0a08, 0.22));

const { composer, grade } = createComposer(renderer, scene, camera, { bloom: !params.has('nobloom'), samples: lowQ ? 0 : 4 });
composer.setPixelRatio(pixelRatio); composer.setSize(innerWidth, innerHeight);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false); composer.setSize(innerWidth, innerHeight);
});

const particles = new Particles(scene);
const dust = new Dust(scene);

// flashlight (world-space so it can lag behind the camera for a nice sway)
const flash = new THREE.SpotLight(0xfff0d8, 95, 38, 0.5, 0.65, 1.6);
flash.castShadow = true; flash.shadow.mapSize.set(lowQ ? 512 : 1024, lowQ ? 512 : 1024);
flash.shadow.camera.near = 0.3; flash.shadow.camera.far = 40; flash.shadow.bias = -0.0006; flash.shadow.normalBias = 0.03;
scene.add(flash, flash.target);

// ============================== game state ==============================
let level = null;
const items = new Map();       // id -> sim/display state
const itemViews = new Map();   // id -> { group, glows }
const peers = new Map();       // id -> { id, name, view: RemotePlayer, last }
const monViews = [];           // MonsterView[]
let monSims = [];              // MonsterSim[] (host only)
const world = { phase: 'play', round: 1, quota: 600, banked: 0, timer: 0 };
let noises = [];               // transient noises for monster hearing (host)
let nextItemId = 1;
let running = false, locked = false;
const keys = new Set();
const mouse = { dx: 0, dy: 0 };
let time = 0, lastSnap = 0, lastState = 0;

const me = {
  id: 0, name: 'Crew', pos: new THREE.Vector3(), vel: new THREE.Vector3(), vy: 0, yaw: 0, pitch: 0, health: 100, stamina: 100, battery: 100,
  fl: true, alive: true, holding: null, onGround: true, bobT: 0, bobAmp: 0, noise: 0, noiseT: 0, shake: 0, dmg: 0, fov: 72, roll: 0,
  grabT: -9, relT: -9, lastStep: 0, sprinting: false, regenDelay: 0, vmKick: 0, vmPop: 0, deadT: 0,
};

// ============================== viewmodel ==============================
const vm = new THREE.Group(); camera.add(vm);
const suitMat = new THREE.MeshStandardMaterial({ color: 0x6f7881, roughness: 0.7, metalness: 0.1 });
const gloveMat = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.8 });
const armGeo = new THREE.CapsuleGeometry(0.045, 0.34, 3, 8);
function mkArm(x) { const g = new THREE.Group(); const a = new THREE.Mesh(armGeo, suitMat); a.rotation.x = Math.PI / 2; a.position.z = 0.2; g.add(a); const h = new THREE.Mesh(new THREE.SphereGeometry(0.058, 10, 8), gloveMat); h.position.z = -0.0; g.add(h); g.position.set(x, -0.3, -0.38); return g; }
const armL = mkArm(-0.3), armR = mkArm(0.3); vm.add(armL, armR);
const torchBody = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.2, 10), new THREE.MeshStandardMaterial({ color: 0x23282c, roughness: 0.4, metalness: 0.8 }));
torchBody.rotation.x = Math.PI / 2; torchBody.position.set(0, 0.0, -0.1); armL.add(torchBody);
const torchLens = new THREE.Mesh(new THREE.CircleGeometry(0.036, 12), new THREE.MeshStandardMaterial({ color: 0, emissive: 0xfff3d0, emissiveIntensity: 3 }));
torchLens.position.set(0, 0, -0.205); armL.add(torchLens);
const heldSlot = new THREE.Group(); heldSlot.position.set(0.0, 0.02, -0.12); armR.add(heldSlot);
let heldMesh = null, heldKind = null;
vm.traverse((o) => { if (o.isMesh) o.castShadow = false; });

function setHeldMesh(kind) {
  if (kind === heldKind) return;
  if (heldMesh) { heldSlot.remove(heldMesh); heldMesh = null; }
  heldKind = kind;
  if (kind) { heldMesh = buildLootMesh(kind); heldMesh.scale.setScalar(0.8); heldMesh.traverse((o) => { if (o.isMesh) o.castShadow = false; if (o.isSprite) o.visible = false; }); heldSlot.add(heldMesh); me.vmPop = 0; }
}

// ============================== helpers ==============================
function feed(text, color = '#cfe') {
  const d = document.createElement('div'); d.textContent = text; d.style.color = color; $('feed').appendChild(d);
  setTimeout(() => d.remove(), 6200);
  while ($('feed').children.length > 6) $('feed').firstChild.remove();
}
function center(text, sub = '', color = '#5de8ff', ms = 4000) {
  const c = $('center'); c.style.color = color; c.innerHTML = `${text}<small>${sub}</small>`; c.classList.add('on');
  clearTimeout(center.t); if (ms) center.t = setTimeout(() => c.classList.remove('on'), ms);
}
const fwd = (yaw, pitch = 0) => new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
function addNoise(x, z, n, ttl = 0.6) { noises.push({ x, z, n, ttl }); }

// ============================== items (loot) ==============================
function makeItemState(id, kind, x, y, z) {
  return { id, kind, x, y, z, nx: x, ny: y, nz: z, vx: 0, vy: 0, vz: 0, ry: Math.random() * 6.28, holder: null, rest: true, thrown: false, restT: 0 };
}
function spawnItems() {
  items.clear();
  const weights = { duck: 3, battery: 5, datapad: 4, gear: 4, canister: 3, idol: 2, core: 1.2 };
  const bag = []; for (const k of LOOT_KINDS) for (let i = 0; i < Math.round(weights[k] * 2); i++) bag.push(k);
  const count = 22 + world.round * 2;
  for (let n = 0; n < count; n++) {
    const kind = bag[Math.floor(Math.random() * bag.length)];
    for (let tries = 0; tries < 30; tries++) {
      const i = Math.floor(Math.random() * 6), j = Math.floor(Math.random() * 6);
      if (i === 0 && j === 0) continue;
      const x = i * CELL + 6 + (Math.random() - 0.5) * 10, z = j * CELL + 6 + (Math.random() - 0.5) * 10;
      const [rx, rz] = resolveCircle(x, z, 0.5, level.colliders);
      if (Math.abs(rx - x) + Math.abs(rz - z) > 0.01) continue;
      const id = nextItemId++; items.set(id, makeItemState(id, kind, x, LOOT[kind].r, z)); break;
    }
  }
}
function ensureItemView(it) {
  let v = itemViews.get(it.id);
  if (!v) {
    const group = buildLootMesh(it.kind); scene.add(group);
    v = { group, glows: [], pulse: Math.random() * 6 }; group.traverse((o) => o.isSprite && v.glows.push(o));
    itemViews.set(it.id, v);
  }
  return v;
}

// host: authoritative handlers
function hostGrab(pid, id) {
  const it = items.get(id); if (!it || it.holder != null) return false;
  for (const o of items.values()) if (o.holder === pid) return false;
  it.holder = pid; it.rest = false; it.vx = it.vy = it.vz = 0; it.thrown = false; return true;
}
function hostRelease(pid, d) {
  const it = items.get(d.id); if (!it || it.holder !== pid) return;
  it.holder = null; it.x = d.x; it.y = d.y; it.z = d.z; it.vx = d.vx; it.vy = d.vy; it.vz = d.vz; it.rest = false; it.thrown = !!d.thrown; it.restT = 0;
}
function sfxAll(k, x, y, z, v) { playSfx(k, x, y, z, v); net.send({ t: 'sfx', k, x, y, z, v }); }

function stepItems(dt) {
  const hosts = [{ id: me.id, x: me.pos.x, z: me.pos.z }, ...[...peers.values()].map((p) => ({ id: p.id, x: p.view.pos.x, z: p.view.pos.z }))];
  for (const it of items.values()) {
    if (it.holder != null) { const h = hosts.find((q) => q.id === it.holder); if (h) { it.x = h.x; it.z = h.z; it.y = 1.1; } continue; }
    if (it.rest) { if (!inPad(it)) continue; }
    else {
      it.vy -= 14 * dt; it.x += it.vx * dt; it.y += it.vy * dt; it.z += it.vz * dt;
      const [rx, rz] = resolveCircle(it.x, it.z, 0.2, level.colliders);
      if (rx !== it.x || rz !== it.z) {
        const nx = rx - it.x, nz = rz - it.z, l = Math.hypot(nx, nz) || 1, dp = (it.vx * nx + it.vz * nz) / l;
        if (dp < 0) { it.vx -= 1.6 * dp * (nx / l); it.vz -= 1.6 * dp * (nz / l); const sp = Math.hypot(it.vx, it.vz); if (sp > 2) { sfxAll(LOOT[it.kind].sound, it.x, it.y, it.z, Math.min(1, sp / 8)); addNoise(it.x, it.z, 13); } }
        it.x = rx; it.z = rz;
      }
      const r = LOOT[it.kind].r;
      if (it.y <= r) {
        it.y = r;
        if (it.vy < -2.2) { sfxAll(LOOT[it.kind].sound, it.x, it.y, it.z, Math.min(1, -it.vy / 8)); addNoise(it.x, it.z, 12 + Math.min(6, -it.vy)); }
        it.vy = it.vy < -2.2 ? -it.vy * 0.32 : 0;
        const f = Math.exp(-4.5 * dt); it.vx *= f; it.vz *= f;
        if (Math.hypot(it.vx, it.vz) < 0.2 && Math.abs(it.vy) < 0.1) { it.rest = true; it.vx = it.vz = it.vy = 0; it.thrown = false; }
      }
      it.ry += (it.vx + it.vz) * dt * 3;
      if (it.thrown) for (const m of monSims) if (Math.hypot(m.x - it.x, m.z - it.z) < 1.2 && it.y < 2.8 && Math.hypot(it.vx, it.vz) > 4 && m.state !== 'stunned') {
        m.stunFor(1.8, (k, x, z) => sfxAll('stun', x, 1.5, z)); it.vx *= -0.3; it.vz *= -0.3; it.thrown = false; feed('Direct hit!', '#ffb53a');
      }
    }
    if (inPad(it) && it.rest) { // delivered
      world.banked += LOOT[it.kind].value; items.delete(it.id);
      const d = { x: it.x, z: it.z, v: LOOT[it.kind].value, name: LOOT[it.kind].name };
      onDeliver(d); net.send({ t: 'deliver', ...d }); addNoise(it.x, it.z, 7);
    }
  }
}
const inPad = (it) => Math.hypot(it.x - level.pad.x, it.z - level.pad.z) < level.pad.r;
function onDeliver(d) {
  playSfx('deliver', d.x, 1, d.z, d.v > 100);
  particles.burst(d.x, 0.6, d.z, 36, 0x34f0d0, 4, 1.2, 0.2, -2);
  particles.burst(d.x, 0.6, d.z, 18, 0xffd75a, 3, 1.4, 0.14, -3);
  feed(`+$${d.v}  ${d.name}`, '#5dff8a');
}

// ============================== monsters ==============================
function spawnMonsters(n) {
  monSims = [];
  const spots = [[5, 5], [5, 0], [0, 5], [3, 3]];
  for (let i = 0; i < n; i++) { const c = level.cellCenter(...spots[i % spots.length]); monSims.push(new MonsterSim(level, c.x, c.z)); }
}
function ensureMonViews(n) {
  while (monViews.length < n) monViews.push(new MonsterView(scene));
  while (monViews.length > n) monViews.pop().dispose();
}
function stepHost(dt) {
  // players list for the monsters
  const players = [{ id: me.id, x: me.pos.x, z: me.pos.z, alive: me.alive, fl: me.fl && me.battery > 0, n: me.noise }];
  for (const p of peers.values()) if (p.last) players.push({ id: p.id, x: p.view.pos.x, z: p.view.pos.z, alive: p.last.alive, fl: p.last.fl, n: p.last.n || 0 });
  noises = noises.filter((n) => (n.ttl -= dt) > 0);
    for (const m of monSims) {
    m.update(dt, players, noises, (k, x, z) => sfxAll(k, x, 1.5, z), (pid, dmg, mx, mz) => {
      if (pid === me.id) hurtMe(dmg, mx, mz); else net.send({ t: 'dmg', amt: dmg, mx, mz }, pid);
    });
  }
  stepItems(dt);
  // game flow
  if (world.phase === 'play') {
    if (world.banked >= world.quota) { world.phase = 'won'; world.timer = 8; }
    else if (players.every((p) => !p.alive)) { world.phase = 'lost'; world.timer = 7; }
  } else {
    world.timer -= dt;
    if (world.timer <= 0) startRound(world.phase === 'won');
  }
}
function startRound(win) {
  if (win) { world.round++; world.quota += 250; } else { world.round = 1; world.quota = 600; }
  world.banked = 0; world.phase = 'play'; world.timer = 0;
  spawnItems(); spawnMonsters(Math.min(3, 1 + Math.floor((world.round - 1) / 2)));
  net.send({ t: 'newround' }); onNewRound();
}
function onNewRound() {
  const sp = level.spawnPoints[me.id % level.spawnPoints.length];
  me.pos.set(sp.x, 0, sp.z); me.vel.set(0, 0, 0); me.alive = true; me.health = 100; me.stamina = 100; me.battery = 100; me.holding = null; me.deadT = 0;
  setHeldMesh(null); lastPhase = 'play';
  center(`ROUND ${world.round}`, `Quota $${world.quota}`, '#5de8ff', 3500);
}

function buildSnapshot() {
  const r2 = (v) => Math.round(v * 100) / 100;
  return {
    t: 'snap', ph: world.phase, rd: world.round, q: world.quota, b: world.banked, tm: world.timer,
    it: [...items.values()].map((i) => [i.id, i.kind, r2(i.x), r2(i.y), r2(i.z), r2(i.ry), i.holder]),
    mn: monSims.map((m) => [r2(m.x), r2(m.z), r2(m.yaw), MON_STATES.indexOf(m.state), r2(m.speed)]),
  };
}
let lastPhase = 'play';
function applySnapshot(s) {
  world.phase = s.ph; world.round = s.rd; world.quota = s.q; world.banked = s.b; world.timer = s.tm;
  const seen = new Set();
  for (const [id, kind, x, y, z, ry, holder] of s.it) {
    seen.add(id);
    let it = items.get(id);
    if (!it) { it = makeItemState(id, kind, x, y, z); items.set(id, it); }
    it.nx = x; it.ny = y; it.nz = z; it.nry = ry; it.holder = holder;
  }
  for (const id of [...items.keys()]) if (!seen.has(id)) items.delete(id);
  ensureMonViews(s.mn.length);
  s.mn.forEach((m, i) => monViews[i].target(m[0], m[1], m[2], MON_STATES[m[3]], m[4]));
}

// ============================== local player ==============================
function hurtMe(dmg, mx, mz) {
  if (!me.alive) return;
  me.health -= dmg; me.dmg = 1; me.shake = 1.2; audio.hurt();
  feed('You were hit!', '#ff4a3a');
  const dx = me.pos.x - mx, dz = me.pos.z - mz, l = Math.hypot(dx, dz) || 1; me.vel.x += (dx / l) * 7; me.vel.z += (dz / l) * 7;
  if (me.health <= 0) die();
}
function die() {
  me.alive = false; me.health = 0; audio.death();
  if (me.holding != null) releaseHeld(0.1, true);
  center('YOU DIED', 'Drift as a ghost — help guide your friends', '#ff4a3a', 5000);
  me.pos.y = 1.6; me.deadT = 0;
}
function releaseHeld(speed, drop = false) {
  const id = me.holding; if (id == null) return;
  const f = fwd(me.yaw, me.pitch);
  const d = { id, x: me.pos.x + f.x * 0.6, y: me.pos.y + 1.45 + f.y * 0.6, z: me.pos.z + f.z * 0.6, vx: f.x * speed + me.vel.x * 0.6, vy: f.y * speed + (drop ? 0.5 : 2.2), vz: f.z * speed + me.vel.z * 0.6, thrown: !drop && speed > 5 };
  if (net.isHost) hostRelease(me.id, d); else net.send({ t: 'rel', ...d });
  me.holding = null; me.relT = time; me.vmKick = drop ? 0.4 : 1;
  if (!drop) { audio.throw_(); me.noiseBurst = { n: 6, t: 0.6 }; }
  setHeldMesh(null);
}
function nearestInteractable() {
  if (!me.alive) return null;
  const f = fwd(me.yaw, me.pitch), ex = me.pos.x, ey = me.pos.y + 1.55, ez = me.pos.z;
  let best = null, bs = 0.9;
  for (const it of items.values()) {
    if (it.holder != null) continue;
    const dx = it.x - ex, dy = it.y - ey, dz = it.z - ez, d = Math.hypot(dx, dy, dz);
    if (d > 3.2 || d < 0.01) continue;
    const dot = (dx * f.x + dy * f.y + dz * f.z) / d;
    const score = dot - d * 0.015;
    if (dot > 0.9 && score > bs - 0.0001 && (!best || score > best.score)) best = { it, score, d };
  }
  return best && best.it;
}
function tryGrab() {
  if (!me.alive || me.holding != null) return;
  const it = nearestInteractable(); if (!it) return;
  if (net.isHost) { if (!hostGrab(me.id, it.id)) return; } else net.send({ t: 'grab', id: it.id });
  me.holding = it.id; me.grabT = time; me.vmPop = 0; setHeldMesh(it.kind); audio.grab(); it.holder = me.id;
}

function updateLocal(dt) {
  // look
  const sens = 0.0022;
  me.yaw -= mouse.dx * sens; me.pitch = clamp(me.pitch - mouse.dy * sens, -1.45, 1.45);
  const swayX = mouse.dx, swayY = mouse.dy; mouse.dx = mouse.dy = 0;
  me.sway = me.sway || { x: 0, y: 0 }; me.sway.x = damp(me.sway.x, clamp(swayX * 0.0006, -0.05, 0.05), 10, dt); me.sway.y = damp(me.sway.y, clamp(swayY * 0.0006, -0.05, 0.05), 10, dt);

  const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const r = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const moving = f !== 0 || r !== 0;

  if (!me.alive) { // ghost: free-fly
    me.deadT += dt;
    const dir = fwd(me.yaw, me.pitch), right = new THREE.Vector3(Math.cos(me.yaw), 0, -Math.sin(me.yaw));
    const sp = 6; me.pos.x += (dir.x * f + right.x * r) * sp * dt; me.pos.y = clamp(me.pos.y + (dir.y * f) * sp * dt, 0.6, 3.6); me.pos.z += (dir.z * f + right.z * r) * sp * dt;
    me.pos.x = clamp(me.pos.x, 0.5, level.size - 0.5); me.pos.z = clamp(me.pos.z, 0.5, level.size - 0.5);
    me.noise = 0; return;
  }

  // movement
  const carryW = me.holding != null && items.get(me.holding) ? LOOT[items.get(me.holding).kind].weight : 1;
  const wantSprint = (keys.has('ShiftLeft') || keys.has('ShiftRight')) && f > 0 && me.stamina > 0 && me.regenDelay <= 0 || (me.sprinting && keys.has('ShiftLeft') && f > 0 && me.stamina > 0);
  me.sprinting = wantSprint && moving;
  const speed = (me.sprinting ? 6.1 : 3.7) * carryW;
  const dir = new THREE.Vector3(-Math.sin(me.yaw) * f + Math.cos(me.yaw) * r, 0, -Math.cos(me.yaw) * f - Math.sin(me.yaw) * r);
  if (dir.lengthSq() > 0) dir.normalize();
  const k = me.onGround ? 11 : 2.5;
  me.vel.x = damp(me.vel.x, dir.x * speed, k, dt); me.vel.z = damp(me.vel.z, dir.z * speed, k, dt);
  if (me.sprinting) { me.stamina -= 21 * dt; if (me.stamina <= 0) { me.stamina = 0; me.regenDelay = 1.6; me.sprinting = false; } }
  else { me.regenDelay -= dt; if (me.regenDelay <= 0) me.stamina = Math.min(100, me.stamina + 15 * dt); }
  if (keys.has('Space') && me.onGround && me.stamina > 8) { me.vy = 4.6; me.onGround = false; me.stamina -= 8; audio.jump(); me.noiseBurst = { n: 5, t: 0.4 }; }
  me.vy -= 14 * dt; me.pos.y += me.vy * dt;
  if (me.pos.y <= 0) { if (!me.onGround && me.vy < -2) { audio.land(null, Math.min(1.4, -me.vy / 6)); me.vmKick = 0.5; me.landDip = Math.min(0.12, -me.vy * 0.02); me.noiseBurst = { n: 7, t: 0.5 }; } me.pos.y = 0; me.vy = 0; me.onGround = true; }
  me.pos.x += me.vel.x * dt; me.pos.z += me.vel.z * dt;
  [me.pos.x, me.pos.z] = resolveCircle(me.pos.x, me.pos.z, 0.42, level.colliders);

  // head bob + footsteps
  const hs = Math.hypot(me.vel.x, me.vel.z);
  me.bobAmp = damp(me.bobAmp, me.onGround ? clamp(hs / 4, 0, 1.5) : 0, 8, dt);
  me.bobT += hs * dt * (me.sprinting ? 1.25 : 1.35);
  const cyc = Math.floor(me.bobT / Math.PI);
  if (cyc !== me.lastStep && me.onGround && hs > 0.8) { me.lastStep = cyc; audio.footstep(null, me.sprinting); }
  me.lastStep = cyc;
  // noise level broadcast
  let n = hs > 0.8 && me.onGround ? (me.sprinting ? 11 : 4) : 0;
  if (me.noiseBurst) { n = Math.max(n, me.noiseBurst.n); me.noiseBurst.t -= dt; if (me.noiseBurst.t <= 0) me.noiseBurst = null; }
  if (voice && voice.micLevel() > 0.07) n = Math.max(n, 8);
  me.noise = n;

  // flashlight battery
  if (me.fl) { me.battery -= 0.75 * dt; if (me.battery <= 0) { me.battery = 0; me.fl = false; audio.flashlight(); } } else me.battery = Math.min(100, me.battery + 2.8 * dt);
}

function updateCamera(dt) {
  const bobY = Math.sin(me.bobT * 2) * 0.05 * me.bobAmp * (me.sprinting ? 1.4 : 1), bobX = Math.cos(me.bobT) * 0.035 * me.bobAmp;
  me.landDip = damp(me.landDip || 0, 0, 9, dt);
  me.shake = damp(me.shake, 0, 4, dt);
  const sh = me.shake * 0.05;
  const eye = me.alive ? 1.66 : 0;
  camera.position.set(me.pos.x + Math.cos(me.yaw) * bobX, me.pos.y + eye + bobY - me.landDip, me.pos.z - Math.sin(me.yaw) * bobX);
  me.roll = damp(me.roll, me.alive ? (keys.has('KeyA') ? 0.02 : 0) - (keys.has('KeyD') ? 0.02 : 0) + (me.sprinting ? Math.sin(me.bobT) * 0.008 : 0) : 0.0, 8, dt);
  camera.rotation.order = 'YXZ';
  camera.rotation.set(me.pitch + (Math.random() - 0.5) * sh, me.yaw + (Math.random() - 0.5) * sh, me.roll + (Math.random() - 0.5) * sh * 0.6);
  me.fov = damp(me.fov, 72 + (me.sprinting ? 9 : 0) + (me.alive ? 0 : 8), 6, dt);
  if (Math.abs(camera.fov - me.fov) > 0.01) { camera.fov = me.fov; camera.updateProjectionMatrix(); }

  // viewmodel
  me.vmKick = damp(me.vmKick, 0, 9, dt);
  me.vmPop = Math.min(1, me.vmPop + dt * 4);
  vm.visible = me.alive;
  const bob = me.bobAmp;
  vm.position.set(-me.sway.x + Math.cos(me.bobT) * 0.012 * bob, me.sway.y + Math.sin(me.bobT * 2) * 0.014 * bob - (me.sprinting ? 0.04 : 0) - me.landDip * 0.5, me.vmKick * 0.14 + (me.sprinting ? 0.03 : 0));
  vm.rotation.set(me.sprinting ? 0.18 : 0, 0, 0);
  armR.rotation.x = -me.vmKick * 0.8 + (heldMesh ? 0.3 : 0); armR.position.y = -0.3 + (heldMesh ? 0.1 : 0) - (1 - easeOutBack(me.vmPop)) * 0.25;
  armL.rotation.x = 0.1 + Math.sin(me.bobT) * 0.02 * bob;
  if (heldMesh) { const s = 0.8 * Math.max(0.01, easeOutBack(me.vmPop)); heldMesh.scale.setScalar(s); heldMesh.rotation.y += dt * 1.4; }

  // flashlight orientation w/ lag
  const target = fwd(me.yaw, me.pitch);
  flash.userData.dir = flash.userData.dir || target.clone();
  flash.userData.dir.lerp(target, 1 - Math.exp(-16 * dt)).normalize();
  const right = new THREE.Vector3(Math.cos(me.yaw), 0, -Math.sin(me.yaw));
  flash.position.copy(camera.position).addScaledVector(right, -0.22).addScaledVector(new THREE.Vector3(0, 1, 0), -0.12);
  flash.target.position.copy(flash.position).addScaledVector(flash.userData.dir, 10);
  const lowBat = me.battery < 22 ? (Math.sin(time * 40) > -0.2 + me.battery / 40 ? 1 : 0.15) : 1;
  const on = me.fl && me.alive;
  flash.intensity = damp(flash.intensity, on ? 95 * lowBat : 0, 40, dt);
  torchLens.material.emissiveIntensity = on ? 3 * lowBat : 0.1;
}

// ============================== networking ==============================
function playSfx(k, x, y, z, v) {
  const pos = { x, y, z };
  switch (k) {
    case 'clang': audio.clang(pos, v ?? 1); break;
    case 'squeak': audio.squeak(pos); audio.clang(pos, (v ?? 1) * 0.2); break;
    case 'roar': audio.monsterRoar(pos); break;
    case 'growl': audio.monsterGrowl(pos, 0.8); break;
    case 'windup': audio.monsterGrowl(pos, 0.5); break;
    case 'attack': audio.monsterAttack(pos); break;
    case 'stun': audio.clang(pos, 1); audio.monsterGrowl(pos, 0.4); break;
    case 'deliver': audio.deposit(pos, v); break;
  }
}
function addPeer(id, name) {
  if (peers.has(id)) return;
  const view = new RemotePlayer(scene, id, name);
  peers.set(id, { id, name, view, last: null, speaking: false });
  feed(`${name} joined`, '#5dff8a');
  renderPlayers();
  if (voice) voiceReady.then(() => voice.connect(id));
}
function removePeer(id) {
  const p = peers.get(id); if (!p) return;
  p.view.dispose(); peers.delete(id); feed(`${p.name} left`, '#ff9a7a');
  if (voice) voice.drop(id);
  for (const it of items.values()) if (it.holder === id) it.holder = null;
  renderPlayers();
}
function renderPlayers() {
  const rows = [{ name: me.name + ' (you)', alive: me.alive, talk: voice && voice.micLevel() > 0.05, id: 'me' }, ...[...peers.values()].map((p) => ({ name: p.name, alive: p.last ? p.last.alive : true, talk: p.speaking, id: p.id }))];
  $('players').innerHTML = rows.map((r) => `<div class="${r.alive ? '' : 'dead'}"><span class="dot ${r.talk ? 'talk' : ''}"></span>${r.name.replace(/</g, '&lt;')}</div>`).join('');
}
let voiceReady = Promise.resolve();

function hookNet() {
  net.on('peer', (m) => addPeer(m.id, m.name));
  net.on('left', (m) => { removePeer(m.id); net.host = m.host; if (net.isHost && !monSims.length && running) becomeHost(); });
  net.on('st', (d, from) => { const p = peers.get(from); if (p) { p.last = d; p.view.setState(d); } });
  net.on('snap', (s) => { if (!net.isHost) applySnapshot(s); });
  net.on('grab', (d, from) => { if (net.isHost) hostGrab(from, d.id); });
  net.on('rel', (d, from) => { if (net.isHost) hostRelease(from, d); });
  net.on('sfx', (d) => playSfx(d.k, d.x, d.y, d.z, d.v));
  net.on('deliver', (d) => onDeliver(d));
  net.on('dmg', (d) => hurtMe(d.amt, d.mx, d.mz));
  net.on('newround', () => onNewRound());
  net.on('close', () => center('DISCONNECTED', 'Reload the page to rejoin', '#ff4a3a', 0));
}
function becomeHost() {
  monSims = monViews.map((v) => { const m = new MonsterSim(level, v.pos.x, v.pos.z); m.yaw = v.yaw; return m; });
  for (const it of items.values()) { it.vx = it.vy = it.vz = 0; it.rest = it.holder == null; }
  feed('You are now the host', '#ffb53a');
}

function sendState() {
  const holding = me.holding != null;
  net.send({ t: 'st', x: +me.pos.x.toFixed(2), y: +me.pos.y.toFixed(2), z: +me.pos.z.toFixed(2), yaw: +me.yaw.toFixed(3), pitch: +me.pitch.toFixed(2), sp: me.sprinting ? 1 : 0, fl: me.fl && me.battery > 0 ? 1 : 0, hold: holding ? 1 : 0, alive: me.alive, n: me.noise });
}

// ============================== frame update ==============================
const _hand = new THREE.Vector3();
let lastFrame = performance.now(), ema = 16, adaptT = 0;
let lastBank = -1, lastRound = -1, lastQuota = -1;

function frame(now) {
  requestAnimationFrame(frame);
  const rawDt = (now - lastFrame) / 1000; lastFrame = now;
  const dt = Math.min(rawDt, 0.05);
  if (!running) { composer.render(); return; }
  time += dt;
  ema = ema * 0.95 + rawDt * 1000 * 0.05;

  updateLocal(dt);
  updateCamera(dt);

  // actors for doors
  const actors = [{ x: me.pos.x, z: me.pos.z }];
  for (const p of peers.values()) actors.push({ x: p.view.pos.x, z: p.view.pos.z });
  const monRefs = monViews.map((v) => ({ x: v.pos.x, z: v.pos.z }));
  level.update(dt, time, actors.concat(monRefs), audio, me.pos);
  level.assignLights(me.pos);

  // network tick
  if (net.isHost) {
    stepHost(dt);
    if (time - lastSnap > 0.1) { lastSnap = time; net.send(buildSnapshot()); }
    ensureMonViews(monSims.length);
    monSims.forEach((m, i) => monViews[i].target(m.x, m.z, m.yaw, m.state, m.speed));
  }
  if (time - lastState > 0.066) { lastState = time; sendState(); }

  // items: interpolate (clients) and render
  const pad = level.pad;
  for (const it of items.values()) {
    if (!net.isHost) { it.x = damp(it.x, it.nx, 16, dt); it.y = damp(it.y, it.ny, 16, dt); it.z = damp(it.z, it.nz, 16, dt); if (it.nry != null) it.ry = it.nry; }
    const v = ensureItemView(it);
    let holder = it.holder;
    if (holder === me.id && me.holding == null && time - me.relT < 0.8) holder = null;
    if (holder === me.id) { v.group.visible = false; if (me.holding == null && time - me.grabT > 0.8 && !net.isHost) { me.holding = it.id; setHeldMesh(it.kind); } }
    else if (holder != null && peers.has(holder)) {
      v.group.visible = true; peers.get(holder).view.hand(_hand); v.group.position.copy(_hand); v.group.rotation.y += dt * 1.4;
    } else { v.group.visible = holder == null; v.group.position.set(it.x, it.y, it.z); v.group.rotation.y = it.ry; if (it.rest && !net.isHost) v.group.rotation.x = 0; }
    // pulse glows
    v.pulse += dt; for (const g of v.glows) g.material.opacity = 0.45 + Math.sin(v.pulse * 2.4) * 0.15;
  }
  for (const [id, v] of itemViews) if (!items.has(id)) { scene.remove(v.group); itemViews.delete(id); }
  // my held item must follow server truth
  if (me.holding != null) { const it = items.get(me.holding); if (!it) { me.holding = null; setHeldMesh(null); } else if (it.holder !== me.id && time - me.grabT > 0.8) { me.holding = null; setHeldMesh(null); } }

  // peers
  let rank = 0;
  const sorted = [...peers.values()].sort((a, b) => a.view.pos.distanceToSquared(me.pos) - b.view.pos.distanceToSquared(me.pos));
  for (const p of sorted) {
    p.view.update(dt, time, audio, me.pos, camera.position, rank++);
    audio.setVoicePos(p.id, { x: p.view.pos.x, y: p.view.pos.y + 1.6, z: p.view.pos.z });
    const sp = audio.voiceLevel(p.id) > 0.03; if (sp !== p.speaking) { p.speaking = sp; p.view.setSpeaking(sp); renderPlayers(); }
  }

  // monsters + tension
  let tension = 0;
  const shakeCb = (s) => { me.shake = Math.max(me.shake, s); };
  monViews.forEach((mv) => {
    mv.update(dt, audio, me.pos, shakeCb);
    const d = Math.hypot(mv.pos.x - me.pos.x, mv.pos.z - me.pos.z);
    const t = (mv.state === 'chase' || mv.state === 'attack') ? clamp(1.1 - d / 40, 0.45, 1) : clamp(1 - d / 22, 0, 0.55);
    tension = Math.max(tension, me.alive ? t : t * 0.3);
  });
  audio.setTension(tension, dt);
  audio.setListener(camera.position, me.yaw);

  // phase transitions
  if (world.phase !== lastPhase) {
    if (world.phase === 'won') { audio.roundWin(); center('QUOTA MET', 'Next shift incoming…', '#7dff7d', 7000); }
    else if (world.phase === 'lost') { audio.roundLose(); center('CREW LOST', 'The station keeps its dead…', '#ff4a3a', 6000); }
    lastPhase = world.phase;
  }
  if (world.banked !== lastBank || world.round !== lastRound || world.quota !== lastQuota) {
    lastBank = world.banked; lastRound = world.round; lastQuota = world.quota;
    $('bank').textContent = `$${world.banked}`; $('quotalbl').textContent = `QUOTA $${world.quota}`; $('roundlbl').textContent = `ROUND ${world.round}`;
    $('qbar').style.width = `${Math.min(100, (world.banked / world.quota) * 100)}%`;
    level.terminal.draw({ round: world.round, banked: world.banked, quota: world.quota, msg: world.banked >= world.quota ? 'QUOTA MET — GOOD WORK' : undefined });
  }

  // particles / dust
  particles.update(dt); dust.update(dt, camera.position);

  // HUD
  const it = nearestInteractable();
  const cross = $('cross'), prompt = $('prompt');
  cross.classList.toggle('hot', !!it);
  if (!me.alive) prompt.innerHTML = 'Ghost mode — WASD to drift';
  else if (me.holding != null) {
    const held = items.get(me.holding); const near = held && Math.hypot(me.pos.x - pad.x, me.pos.z - pad.z) < 7;
    prompt.innerHTML = `<b>LMB</b> throw &nbsp; <b>Q</b> drop${near ? '<small>Drop it on the glowing pad to bank it</small>' : ''}`;
  } else if (it) prompt.innerHTML = `<b>E</b> grab ${LOOT[it.kind].name} <small>$${LOOT[it.kind].value}</small>`;
  else prompt.innerHTML = '';
  $('hp').firstElementChild.nextElementSibling.style.transform = `scaleX(${me.health / 100})`;
  $('st').firstElementChild.nextElementSibling.style.transform = `scaleX(${me.stamina / 100})`;
  $('bt').firstElementChild.nextElementSibling.style.transform = `scaleX(${me.battery / 100})`;
  if (voice) { const lvl = voice.micLevel(); $('mic').textContent = voice.ok ? (voice.muted ? 'MIC MUTED (V)' : lvl > 0.05 ? 'MIC ● TRANSMITTING' : 'MIC ○ live') : 'NO MIC — listen only'; }

  // post
  grade.uniforms.time.value = time; me.dmg = damp(me.dmg, 0, 3, dt);
  grade.uniforms.damage.value = me.dmg + (me.alive && me.health < 35 ? (Math.sin(time * 6) * 0.5 + 0.5) * 0.12 : 0);
  grade.uniforms.fear.value = damp(grade.uniforms.fear.value, Math.max(tension * 0.9, me.alive ? 0 : 0.4), 3, dt);
  grade.uniforms.dead.value = damp(grade.uniforms.dead.value, me.alive ? 0 : 0.55, 2, dt);

  // adaptive resolution
  adaptT += rawDt;
  if (adaptT > 1.5 && !lowQ && !params.has('fixed')) {
    adaptT = 0;
    let pr = pixelRatio;
    if (ema > 26 && pr > 0.5) pr = Math.max(0.5, pr - 0.15); else if (ema < 14 && pr < Math.min(devicePixelRatio, 1.5)) pr = Math.min(Math.min(devicePixelRatio, 1.5), pr + 0.1);
    if (pr !== pixelRatio) { pixelRatio = pr; renderer.setPixelRatio(pr); composer.setPixelRatio(pr); composer.setSize(innerWidth, innerHeight); }
  }

  composer.render();
}

// ============================== input ==============================
addEventListener('keydown', (e) => {
  if (!running) return;
  keys.add(e.code);
  if (e.repeat) return;
  if (e.code === 'KeyE') tryGrab();
  else if (e.code === 'KeyQ') releaseHeld(1.4, true);
  else if (e.code === 'KeyF' && me.alive) { if (me.fl) { me.fl = false; audio.flashlight(); } else if (me.battery > 12) { me.fl = true; audio.flashlight(); } }
  else if (e.code === 'KeyV' && voice) voice.setMuted(!voice.muted);
  if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
addEventListener('mousemove', (e) => { if (locked) { mouse.dx += e.movementX; mouse.dy += e.movementY; } });
addEventListener('mousedown', (e) => {
  if (!running) return;
  if (!locked) { canvas.requestPointerLock?.(); return; }
  if (e.button === 0 && me.holding != null) releaseHeld(10);
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  $('pause').style.display = running && !locked && !params.has('nolock') ? 'flex' : 'none';
});
$('pause').addEventListener('click', () => canvas.requestPointerLock?.());

// ============================== boot ==============================
async function start() {
  const name = ($('name').value.trim() || 'Crew').slice(0, 14), room = ($('room').value.trim() || 'alpha').toLowerCase();
  try { localStorage.setItem('do_name', name); localStorage.setItem('do_room', room); } catch {}
  $('go').disabled = true; $('err').textContent = '';
  try {
    audio.init();
    const w = await net.connect(room, name);
    me.id = w.id; me.name = name;
    level = buildLevel(w.seed);
    scene.add(level.group);
    hookNet();
    voice = new Voice(net, audio);
    voiceReady = Promise.race([voice.init(), new Promise((r) => setTimeout(r, 8000))]);
    for (const p of w.players) addPeer(p.id, p.name);
    const sp = level.spawnPoints[me.id % level.spawnPoints.length];
    me.pos.set(sp.x, 0, sp.z); me.yaw = Math.PI * 0.5; me.pitch = 0;
    if (net.isHost) { spawnItems(); spawnMonsters(1); }
    $('menu').style.display = 'none'; $('hud').classList.add('on');
    history.replaceState(null, '', `?room=${encodeURIComponent(room)}`);
    running = true; renderPlayers();
    if (!params.has('nolock')) canvas.requestPointerLock?.();
    center('DEAD ORBIT', `Station ${room.toUpperCase()} · Quota $${world.quota} · Share this page URL with friends`, '#5de8ff', 5500);
    audio.ui();
    setInterval(renderPlayers, 1500);
  } catch (e) {
    $('err').textContent = e.message || 'Failed to connect'; $('go').disabled = false;
  }
}
$('go').addEventListener('click', start);
addEventListener('keydown', (e) => { if (!running && e.code === 'Enter') start(); });
try { $('name').value = params.get('name') || localStorage.getItem('do_name') || ''; $('room').value = params.get('room') || localStorage.getItem('do_room') || ''; } catch {}
if (params.has('auto')) start();
requestAnimationFrame(frame);

window.__game = { me, items, peers, monViews, get monSims() { return monSims; }, get level() { return level; }, world, net, audio, camera, scene, renderer, keys, mouse, particles };
