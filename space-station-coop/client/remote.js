import * as THREE from 'three';
import { damp, dampAngle, playerColor } from './util.js';

const sharedGeo = {
  torso: new THREE.CapsuleGeometry(0.25, 0.42, 4, 10), limb: new THREE.CapsuleGeometry(0.095, 0.5, 3, 8), helmet: new THREE.SphereGeometry(0.24, 16, 12),
  visor: new THREE.SphereGeometry(0.19, 14, 10), pack: new THREE.BoxGeometry(0.4, 0.5, 0.2),
};
const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff1c9, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });

export class RemotePlayer {
  constructor(scene, id, name) {
    this.id = id; this.name = name; this.scene = scene;
    this.pos = new THREE.Vector3(); this.yaw = 0; this.pitch = 0; this.speed = 0; this.alive = true; this.fl = true; this.hold = false;
    this.nx = 0; this.nz = 0; this.ny = 0; this.nyaw = 0; this.init = false;
    this.phase = 0; this.fall = 0; this.lastStepPhase = 0; this.noise = 0;
    const col = new THREE.Color(playerColor(id));
    const suit = new THREE.MeshStandardMaterial({ color: col, roughness: 0.55, metalness: 0.2 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2f35, roughness: 0.6, metalness: 0.5 });
    this.visorMat = new THREE.MeshStandardMaterial({ color: 0x0a1218, roughness: 0.1, metalness: 0.9, emissive: 0x1a5a70, emissiveIntensity: 0.7 });
    this.root = new THREE.Group(); scene.add(this.root);
    this.body = new THREE.Group(); this.root.add(this.body);
    const m = (geo, mat, parent = this.body) => { const x = new THREE.Mesh(geo, mat); x.castShadow = true; parent.add(x); return x; };
    m(sharedGeo.torso, suit).position.y = 1.12;
    m(sharedGeo.pack, dark).position.set(0, 1.18, 0.22);
    this.head = new THREE.Group(); this.head.position.y = 1.62; this.body.add(this.head);
    m(sharedGeo.helmet, suit, this.head);
    const v = m(sharedGeo.visor, this.visorMat, this.head); v.position.set(0, 0.0, -0.08); v.scale.set(1, 0.8, 0.9);
    this.armL = new THREE.Group(); this.armR = new THREE.Group(); this.legL = new THREE.Group(); this.legR = new THREE.Group();
    this.armL.position.set(-0.34, 1.38, 0); this.armR.position.set(0.34, 1.38, 0); this.legL.position.set(-0.14, 0.82, 0); this.legR.position.set(0.14, 0.82, 0);
    [this.armL, this.armR, this.legL, this.legR].forEach((g, i) => { this.body.add(g); m(sharedGeo.limb, i < 2 ? suit : dark, g).position.y = -0.3; });
    // flashlight
    this.spot = new THREE.SpotLight(0xfff1d0, 40, 24, 0.45, 0.6, 1.6); this.spot.castShadow = false;
    this.head.add(this.spot, this.spot.target); this.spot.position.set(0, 0, -0.2); this.spot.target.position.set(0, 0, -5);
    this.beam = new THREE.Mesh(new THREE.ConeGeometry(2.3, 9, 20, 1, true), beamMat); this.beam.geometry.translate(0, -4.5, 0); this.beam.geometry.rotateX(Math.PI / 2);
    this.beam.position.z = -0.25; this.head.add(this.beam);
    // name tag
    const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d');
    x.font = 'bold 34px "Courier New", monospace'; x.textAlign = 'center'; x.fillStyle = '#000'; x.fillText(name, 130, 44); x.fillStyle = playerColor(id); x.fillText(name, 128, 42);
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    this.tag.scale.set(1.3, 0.33, 1); this.tag.position.y = 2.15; this.root.add(this.tag);
    this.speakDot = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x5dff8a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.speakDot.scale.set(0.2, 0.2, 1); this.speakDot.position.set(0.7, 2.15, 0); this.speakDot.visible = false; this.root.add(this.speakDot);
  }
  setState(s) {
    this.nx = s.x; this.nz = s.z; this.ny = s.y; this.nyaw = s.yaw; this.pitch = s.pitch; this.alive = s.alive; this.fl = s.fl; this.hold = s.hold; this.noise = s.n || 0; this.sprint = s.sp;
    if (!this.init) { this.pos.set(s.x, s.y, s.z); this.yaw = s.yaw; this.init = true; }
  }
  hand(out) { // world position of the held item
    const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    return out.set(this.pos.x + f.x * 0.55, this.pos.y + 1.15, this.pos.z + f.z * 0.55);
  }
  update(dt, t, audio, listener, camPos, lightRank) {
    if (!this.init) return;
    const px = this.pos.x, pz = this.pos.z;
    this.pos.x = damp(this.pos.x, this.nx, 14, dt); this.pos.z = damp(this.pos.z, this.nz, 14, dt); this.pos.y = damp(this.pos.y, this.ny, 14, dt);
    this.yaw = dampAngle(this.yaw, this.nyaw, 12, dt);
    const spd = Math.hypot(this.pos.x - px, this.pos.z - pz) / Math.max(dt, 1e-4);
    this.speed = damp(this.speed, spd, 10, dt);
    this.root.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.root.rotation.y = this.yaw + Math.PI; // model faces +z; we want -z forward
    // death topple
    this.fall = damp(this.fall, this.alive ? 0 : 1, this.alive ? 12 : 5, dt);
    const f = this.fall;
    this.body.rotation.x = -f * (Math.PI / 2) + (f > 0.9 ? 0 : 0);
    this.body.position.y = f * 0.28;
    // gait
    const run = Math.min(1, this.speed / 4);
    this.phase += this.speed * dt * 1.6;
    const sw = Math.sin(this.phase) * 0.9 * run * (1 - f);
    this.legL.rotation.x = sw; this.legR.rotation.x = -sw;
    const carry = this.hold ? 1 : 0;
    this.armL.rotation.x = damp(this.armL.rotation.x, carry ? -1.25 : -sw * 0.8, 12, dt);
    this.armR.rotation.x = damp(this.armR.rotation.x, carry ? -1.25 : sw * 0.8, 12, dt);
    this.armL.rotation.z = damp(this.armL.rotation.z, carry ? 0.2 : 0, 10, dt); this.armR.rotation.z = damp(this.armR.rotation.z, carry ? -0.2 : 0, 10, dt);
    this.body.position.y += Math.abs(Math.sin(this.phase)) * 0.05 * run * (1 - f);
    this.head.rotation.x = this.pitch * 0.8; this.torsoLean = run * 0.12;
    if (this.sprint) this.body.rotation.x += 0.18 * (1 - f);
    // footsteps
    const cyc = Math.floor(this.phase / Math.PI);
    if (cyc !== this.lastStepPhase) { this.lastStepPhase = cyc; if (this.alive && run > 0.3 && audio) audio.footstep({ x: this.pos.x, y: 0.2, z: this.pos.z }, !!this.sprint); }
    // lights
    const on = this.fl && this.alive;
    this.spot.visible = on && lightRank < 3; this.beam.visible = on;
    const dist = Math.hypot(this.pos.x - camPos.x, this.pos.z - camPos.z);
    this.tag.visible = this.alive && dist < 16; this.tag.material.opacity = Math.max(0, 1 - dist / 16);
  }
  setSpeaking(v) { this.speakDot.visible = v; }
  dispose() { this.scene.remove(this.root); }
}
