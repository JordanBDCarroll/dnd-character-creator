import * as THREE from 'three';
import { clamp, damp, dampAngle, angDiff, resolveCircle, segBlocked, easeInOut } from './util.js';

export const MON_STATES = ['wander', 'investigate', 'chase', 'attack', 'stunned'];

// ================= host-side simulation =================
export class MonsterSim {
  constructor(level, x, z) {
    this.level = level; this.x = x; this.z = z; this.yaw = 0; this.state = 'wander';
    this.speed = 0; this.tx = x; this.tz = z; this.wait = 1; this.pathT = 0; this.path = [];
    this.seeTimer = 0; this.cool = 0; this.windup = 0; this.stun = 0; this.stuck = 0; this.lastX = x; this.lastZ = z; this.noiseCool = 0; this.lastSeen = null;
  }
  setState(s, sfx) {
    if (this.state === s) return; this.state = s;
    if (s === 'chase') sfx('roar', this.x, this.z);
    if (s === 'investigate') sfx('growl', this.x, this.z);
  }
  pickWander() {
    const L = this.level, [ci, cj] = L.cellOf(this.x, this.z);
    const i = Math.floor(Math.random() * 6), j = Math.floor(Math.random() * 6);
    const c = L.cellCenter(i, j); this.tx = c.x; this.tz = c.z; this.path = []; this.pathT = 0;
    if (i === 0 && j === 0 && Math.random() < 0.6) this.pickWander();
  }
  // returns true if we have arrived
  moveToward(tx, tz, speed, dt) {
    const L = this.level;
    let gx = tx, gz = tz;
    const direct = !segBlocked(this.x, this.z, tx, tz, L.colliders);
    if (!direct) {
      this.pathT -= dt;
      if (this.pathT <= 0 || !this.path.length) {
        this.path = L.path(L.cellOf(this.x, this.z), L.cellOf(tx, tz)).map(([i, j]) => L.cellCenter(i, j));
        this.pathT = 0.6;
      }
      while (this.path.length > 1 && Math.hypot(this.path[0].x - this.x, this.path[0].z - this.z) < 1.6) this.path.shift();
      if (this.path.length) { gx = this.path[0].x; gz = this.path[0].z; if (this.path.length === 1 && Math.hypot(gx - this.x, gz - this.z) < 1.6) { gx = tx; gz = tz; } }
    }
    const dx = gx - this.x, dz = gz - this.z, d = Math.hypot(dx, dz);
    const want = Math.atan2(-dx, -dz);
    this.yaw = dampAngle(this.yaw, want, 7, dt);
    const turnPenalty = clamp(1 - Math.abs(angDiff(this.yaw, want)) / 1.8, 0.2, 1);
    const sp = speed * turnPenalty;
    this.speed = damp(this.speed, sp, 6, dt);
    const step = Math.min(d, this.speed * dt);
    if (d > 0.01) { this.x += (dx / d) * step; this.z += (dz / d) * step; }
    [this.x, this.z] = resolveCircle(this.x, this.z, 0.8, L.colliders);
    return Math.hypot(tx - this.x, tz - this.z) < 1.3;
  }
  stunFor(t, sfx) { this.stun = t; this.state = 'stunned'; sfx('stun', this.x, this.z); }

  // players: [{id,x,z,alive,fl,n}]
  update(dt, players, noises, sfx, hit) {
    const L = this.level;
    this.cool -= dt; this.noiseCool -= dt;
    if (this.state === 'stunned') {
      this.stun -= dt; this.speed = damp(this.speed, 0, 8, dt);
      if (this.stun <= 0) this.state = 'chase';
      return;
    }
    // perceive
    let best = null, bd = 1e9;
    for (const p of players) {
      if (!p.alive) continue;
      const d = Math.hypot(p.x - this.x, p.z - this.z);
      const range = p.fl ? 20 : 12;
      if (d < range && !segBlocked(this.x, this.z, p.x, p.z, L.colliders) && d < bd) { best = p; bd = d; }
      else if (d < 3.2 && d < bd) { best = p; bd = d; } // can always sense very close
    }
    if (best) { this.seeTimer = 0; this.lastSeen = { x: best.x, z: best.z }; this.target = best; }

    if (this.state === 'attack') {
      this.windup -= dt; this.speed = damp(this.speed, 0, 10, dt);
      const tp = this.target;
      if (tp) this.yaw = dampAngle(this.yaw, Math.atan2(-(tp.x - this.x), -(tp.z - this.z)), 14, dt);
      if (this.windup <= 0) {
        for (const p of players) if (p.alive && Math.hypot(p.x - this.x, p.z - this.z) < 2.5) hit(p.id, 34, this.x, this.z);
        sfx('attack', this.x, this.z);
        this.cool = 1.15; this.state = 'chase';
      }
      return;
    }

    if (best) {
      this.setState('chase', sfx);
    } else if (this.state === 'chase') {
      this.seeTimer += dt;
      if (this.seeTimer > 4) { this.tx = this.lastSeen.x; this.tz = this.lastSeen.z; this.wait = 2; this.setState('investigate', sfx); }
    }
    if (this.state !== 'chase' && this.noiseCool <= 0) { // hearing
      for (const p of players.map((q) => (q.alive ? q : { n: 0 })).concat(noises)) {
        if (!p.n) continue;
        if (Math.hypot(p.x - this.x, p.z - this.z) < p.n * 1.4) { this.tx = p.x; this.tz = p.z; this.wait = 2; this.path = []; this.setState('investigate', sfx); this.noiseCool = 1.5; break; }
      }
    }

    if (this.state === 'chase') {
      const tgt = best || this.lastSeen;
      if (tgt) {
        this.moveToward(tgt.x, tgt.z, 5.6, dt);
        if (best && bd < 1.9 && this.cool <= 0) { this.state = 'attack'; this.windup = 0.42; sfx('windup', this.x, this.z); }
      }
    } else if (this.state === 'investigate') {
      if (this.moveToward(this.tx, this.tz, 3.6, dt)) { this.speed = damp(this.speed, 0, 6, dt); this.wait -= dt; if (this.wait <= 0) { this.setState('wander', sfx); this.pickWander(); } }
    } else { // wander
      if (this.moveToward(this.tx, this.tz, 2.3, dt)) { this.wait -= dt; this.speed = damp(this.speed, 0, 6, dt); if (this.wait <= 0) { this.wait = 1 + Math.random() * 2.5; this.pickWander(); } }
    }
    // stuck detection
    this.stuck += dt;
    if (this.stuck > 1.5) { if (Math.hypot(this.x - this.lastX, this.z - this.lastZ) < 0.4 && this.state !== 'attack') { this.pickWander(); if (this.state === 'investigate') this.state = 'wander'; } this.stuck = 0; this.lastX = this.x; this.lastZ = this.z; }
  }
}

// ================= visual with procedural IK legs =================
const Y = new THREE.Vector3(0, 1, 0);
function link(mesh, a, b) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.quaternion.setFromUnitVectors(Y, d.normalize());
  mesh.scale.set(mesh.userData.w, len, mesh.userData.w);
}

export class MonsterView {
  constructor(scene) {
    this.root = new THREE.Group(); scene.add(this.root);
    this.scene = scene;
    this.pos = new THREE.Vector3(); this.yaw = 0; this.vel = new THREE.Vector3(); this.speed = 0; this.state = 'wander';
    this.t = 0; this.stepCool = 0; this.attackT = 0; this.stepSound = null;
    this.nx = 0; this.nz = 0; this.ny = 0; this.init = false;

    const skin = new THREE.MeshStandardMaterial({ color: 0x161b22, roughness: 0.4, metalness: 0.2, emissive: 0x04060a });
    const flesh = new THREE.MeshStandardMaterial({ color: 0x3a0f14, roughness: 0.5, metalness: 0.1, emissive: 0x200508 });
    this.eyeMat = new THREE.MeshStandardMaterial({ color: 0x110000, emissive: 0xff2a10, emissiveIntensity: 2 });
    const bone = new THREE.MeshStandardMaterial({ color: 0xc9c3b0, roughness: 0.5, metalness: 0.1 });

    this.body = new THREE.Group(); this.root.add(this.body);
    const mk = (geo, mat, parent = this.body) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; parent.add(m); return m; };
    this.torso = mk(new THREE.SphereGeometry(1, 18, 14), skin); this.torso.scale.set(0.62, 0.45, 1.0);
    this.rear = mk(new THREE.SphereGeometry(1, 16, 12), skin); this.rear.scale.set(0.55, 0.42, 0.8); this.rear.position.set(0, 0.04, -0.9);
    this.head = new THREE.Group(); this.head.position.set(0, 0.12, 0.95); this.body.add(this.head);
    mk(new THREE.SphereGeometry(1, 16, 12), skin, this.head).scale.set(0.34, 0.3, 0.46);
    this.jaw = new THREE.Group(); this.jaw.position.set(0, -0.12, 0.1); this.head.add(this.jaw);
    const jm = mk(new THREE.SphereGeometry(1, 12, 8), flesh, this.jaw); jm.scale.set(0.26, 0.09, 0.4); jm.position.set(0, -0.02, 0.28);
    for (let i = 0; i < 7; i++) { // teeth
      const up = mk(new THREE.ConeGeometry(0.025, 0.12, 5), bone, this.head); up.position.set((i - 3) * 0.075, -0.11, 0.5 - Math.abs(i - 3) * 0.03); up.rotation.x = Math.PI;
      const lo = mk(new THREE.ConeGeometry(0.022, 0.1, 5), bone, this.jaw); lo.position.set((i - 3) * 0.07, 0.04, 0.5 - Math.abs(i - 3) * 0.03);
    }
    this.eyes = [];
    for (const [x, y, z, s] of [[-0.14, 0.1, 0.36, 0.05], [0.14, 0.1, 0.36, 0.05], [-0.07, 0.17, 0.4, 0.03], [0.07, 0.17, 0.4, 0.03]]) {
      const e = mk(new THREE.SphereGeometry(s, 8, 6), this.eyeMat, this.head); e.position.set(x, y, z); e.castShadow = false; this.eyes.push(e);
    }
    this.eyeLight = new THREE.PointLight(0xff2a14, 0, 12, 2); this.eyeLight.position.set(0, 0.15, 0.6); this.head.add(this.eyeLight);
    this.spines = [];
    for (let i = 0; i < 8; i++) { const s = mk(new THREE.ConeGeometry(0.05, 0.5 - i * 0.025, 5), bone); s.position.set(0, 0.42, 0.5 - i * 0.28); s.rotation.x = -0.4; this.spines.push(s); }
    this.tail = [];
    let tp = new THREE.Vector3(0, 0, -1.5);
    for (let i = 0; i < 7; i++) { const s = mk(new THREE.SphereGeometry(0.2 - i * 0.022, 8, 6), skin); s.position.copy(tp); tp = tp.clone().add(new THREE.Vector3(0, -0.02, -0.38)); this.tail.push(s); }

    // legs
    this.L1 = 1.35; this.L2 = 1.75;
    this.legs = [];
    const legMat = skin;
    const hipZ = [0.55, 0.0, -0.55];
    for (let side = -1; side <= 1; side += 2) for (let r = 0; r < 3; r++) {
      const leg = {
        side, hip: new THREE.Vector3(side * 0.42, -0.05, hipZ[r]), ideal: new THREE.Vector3(side * 1.9, 0, hipZ[r] * 1.5 + (r === 0 ? 0.5 : r === 2 ? -0.4 : 0)),
        foot: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, stepping: false, group: (r + (side > 0 ? 1 : 0)) % 2,
        m1: new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.05, 1, 6), legMat), m2: new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.02, 1, 6), legMat),
        knee: new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), flesh),
      };
      leg.m1.userData.w = 1; leg.m2.userData.w = 1; leg.m1.castShadow = leg.m2.castShadow = true;
      scene.add(leg.m1, leg.m2, leg.knee);
      this.legs.push(leg);
    }
    this.hv = new THREE.Vector3(); this.hw = new THREE.Vector3(); this.kn = new THREE.Vector3(); this.tmp = new THREE.Vector3();
    this.rootQ = new THREE.Quaternion();
  }

  // set network target
  target(x, z, yaw, state, speed) { this.nx = x; this.nz = z; this.nyaw = yaw; this.state = state; this.nspeed = speed; if (!this.init) { this.pos.set(x, 0, z); this.yaw = yaw; this.init = true; this.legs.forEach((l) => { this.placeIdeal(l, l.foot); }); } }

  placeIdeal(leg, out) {
    this.tmp.copy(leg.ideal).applyAxisAngle(Y, this.yaw).add(this.pos); out.set(this.tmp.x, 0, this.tmp.z); return out;
  }

  update(dt, audio, listener, shakeCb) {
    if (!this.init) return;
    this.t += dt;
    const prevX = this.pos.x, prevZ = this.pos.z;
    this.pos.x = damp(this.pos.x, this.nx, 12, dt); this.pos.z = damp(this.pos.z, this.nz, 12, dt);
    this.yaw = dampAngle(this.yaw, this.nyaw, 10, dt);
    this.vel.set((this.pos.x - prevX) / dt, 0, (this.pos.z - prevZ) / dt);
    this.speed = damp(this.speed, this.vel.length(), 8, dt);
    const st = this.state, chase = st === 'chase', att = st === 'attack';
    this.attackT = damp(this.attackT, att ? 1 : 0, att ? 14 : 6, dt);

    // body pose
    const crouch = chase ? 0.22 : st === 'investigate' ? 0.08 : 0;
    const baseH = 1.55 - crouch * 1.0 - this.attackT * 0.25;
    this.root.position.set(this.pos.x, 0, this.pos.z);
    this.root.rotation.y = this.yaw;
    const bob = Math.sin(this.t * (4 + this.speed * 1.2)) * 0.06 * Math.min(1, this.speed);
    this.body.position.set(0, baseH + bob, this.attackT * 0.7);
    this.body.rotation.x = -this.attackT * 0.35 + (st === 'stunned' ? Math.sin(this.t * 40) * 0.05 : 0);
    this.body.rotation.z = Math.sin(this.t * 2.2) * 0.03 + (st === 'stunned' ? Math.sin(this.t * 33) * 0.06 : 0);
    // head: sweeps when wandering, locks on when chasing
    const sweep = st === 'wander' || st === 'investigate' ? Math.sin(this.t * 0.9) * 0.6 : 0;
    this.head.rotation.y = damp(this.head.rotation.y, sweep, 4, dt);
    this.head.rotation.x = damp(this.head.rotation.x, chase ? 0.15 : st === 'investigate' ? -0.2 : 0.1, 5, dt);
    const open = Math.max(this.attackT * 0.9, chase ? 0.25 + Math.sin(this.t * 14) * 0.08 : st === 'investigate' ? 0.12 : 0.05);
    this.jaw.rotation.x = open;
    // eyes
    const ei = chase || att ? 4.5 : st === 'investigate' ? 2.8 : 1.6;
    this.eyeMat.emissiveIntensity = st === 'stunned' ? (Math.sin(this.t * 50) > 0 ? 3 : 0.2) : ei + Math.sin(this.t * 3) * 0.3;
    this.eyeLight.intensity = chase || att ? 18 : st === 'investigate' ? 4 : 0;
    // spines & tail
    this.spines.forEach((s, i) => { s.rotation.x = -0.4 - (chase ? 0.5 : 0) + Math.sin(this.t * 2 + i * 0.5) * 0.08; });
    this.tail.forEach((s, i) => { s.position.x = Math.sin(this.t * 2.5 - i * 0.7) * 0.12 * (i + 1) * 0.5; s.position.y = -0.02 * i + Math.cos(this.t * 2 - i * 0.6) * 0.05; });

    // legs: tripod gait IK
    this.body.updateMatrixWorld(true); this.root.updateMatrixWorld(true);
    const anyStepping = [false, false];
    this.legs.forEach((l) => { if (l.stepping) anyStepping[l.group] = true; });
    const stride = 0.55 + this.speed * 0.08;
    for (const l of this.legs) {
      const ideal = this.placeIdeal(l, this.hv);
      ideal.x += this.vel.x * 0.18; ideal.z += this.vel.z * 0.18;
      if (!l.stepping) {
        const d = Math.hypot(ideal.x - l.foot.x, ideal.z - l.foot.z);
        if (d > stride && !anyStepping[1 - l.group]) {
          l.stepping = true; l.t = 0; l.from.copy(l.foot); l.to.copy(ideal); anyStepping[l.group] = true;
        }
      }
      if (l.stepping) {
        const dur = clamp(0.28 - this.speed * 0.025, 0.1, 0.28);
        l.t += dt / dur;
        const k = Math.min(1, l.t), e = easeInOut(k);
        l.foot.lerpVectors(l.from, l.to, e); l.foot.y = Math.sin(Math.PI * k) * (0.55 + this.speed * 0.05);
        if (l.t >= 1) {
          l.stepping = false; l.foot.copy(l.to); l.foot.y = 0;
          if (audio && listener) {
            const dx = this.pos.x - listener.x, dz = this.pos.z - listener.z, d = Math.hypot(dx, dz);
            if (d < 50 && Math.random() < 0.7) audio.monsterStep({ x: l.foot.x, y: 0.2, z: l.foot.z });
            if (shakeCb && d < 14) shakeCb((1 - d / 14) * 0.5 * Math.min(1, this.speed / 3));
          }
        }
      }
      // IK
      const hip = this.hw.copy(l.hip).applyMatrix4(this.body.matrixWorld);
      const dv = this.tmp.subVectors(l.foot, hip), dist = clamp(dv.length(), 0.2, this.L1 + this.L2 - 0.02);
      dv.normalize();
      const cosA = clamp((this.L1 * this.L1 + dist * dist - this.L2 * this.L2) / (2 * this.L1 * dist), -1, 1), ang = Math.acos(cosA);
      // pole vector: up + slightly outward
      const out = new THREE.Vector3(l.side, 0, 0).applyAxisAngle(Y, this.yaw);
      const pole = new THREE.Vector3(0, 1, 0).addScaledVector(out, 0.6);
      pole.addScaledVector(dv, -pole.dot(dv)).normalize();
      const knee = this.kn.copy(hip).addScaledVector(dv, Math.cos(ang) * this.L1).addScaledVector(pole, Math.sin(ang) * this.L1);
      const foot = this.tmp.copy(hip).addScaledVector(dv, dist);
      const footPos = l.foot.clone(); // true target (may be slightly beyond reach)
      l.m1.userData.w = 1.3; l.m2.userData.w = 1.0;
      link(l.m1, hip, knee); link(l.m2, knee, footPos.y < 0.01 ? footPos : footPos);
      l.knee.position.copy(knee);
    }
  }
  setVisible(v) { this.root.visible = v; this.legs.forEach((l) => { l.m1.visible = l.m2.visible = l.knee.visible = v; }); }
  dispose() { this.scene.remove(this.root); this.legs.forEach((l) => this.scene.remove(l.m1, l.m2, l.knee)); }
}
