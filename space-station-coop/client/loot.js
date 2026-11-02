import * as THREE from 'three';
import { glowTexture } from './textures.js';

const M = (color, rough = 0.4, metal = 0.7, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
const E = (color, i = 2) => new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(color), emissiveIntensity: i });
const glow = {};
const glowSprite = (c, rgb, s = 0.9) => {
  glow[c] ||= new THREE.SpriteMaterial({ map: glowTexture(rgb), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6 });
  const sp = new THREE.Sprite(glow[c]); sp.scale.set(s, s, 1); sp.userData.isGlow = true; return sp;
};
const add = (g, geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };

// kind -> { name, value, weight (speed multiplier while carried), r (rest height), build() }
export const LOOT = {
  battery: {
    name: 'Power Cell', value: 35, weight: 0.97, r: 0.17, sound: 'clang',
    build() { const g = new THREE.Group(); add(g, new THREE.CylinderGeometry(0.12, 0.12, 0.34, 14), M(0x2b2f35)); add(g, new THREE.CylinderGeometry(0.125, 0.125, 0.1, 14), E(0xffc21a, 1.6), 0, 0.1); add(g, new THREE.CylinderGeometry(0.05, 0.05, 0.06, 8), M(0xb0b6bb), 0, 0.2); g.add(glowSprite('y', '255,200,60', 0.7)); return g; },
  },
  gear: {
    name: 'Brass Gear', value: 55, weight: 0.93, r: 0.22, sound: 'clang',
    build() { const g = new THREE.Group(); const m = M(0xc9953a, 0.3, 0.95); add(g, new THREE.CylinderGeometry(0.2, 0.2, 0.08, 16), m); for (let i = 0; i < 10; i++) { const t = add(g, new THREE.BoxGeometry(0.07, 0.08, 0.07), m, Math.cos(i * 0.628) * 0.22, 0, Math.sin(i * 0.628) * 0.22); t.rotation.y = -i * 0.628; } add(g, new THREE.CylinderGeometry(0.05, 0.05, 0.1, 8), M(0x222222)); g.rotation.x = 1.2; g.add(glowSprite('o', '255,170,60', 0.6)); return g; },
  },
  datapad: {
    name: 'Data Pad', value: 45, weight: 0.98, r: 0.05, sound: 'clang',
    build() { const g = new THREE.Group(); add(g, new THREE.BoxGeometry(0.34, 0.04, 0.24), M(0x1a1d21, 0.3, 0.6)); add(g, new THREE.BoxGeometry(0.29, 0.005, 0.19), E(0x35e0ff, 1.8), 0, 0.022); g.add(glowSprite('c', '70,220,255', 0.6)); return g; },
  },
  canister: {
    name: 'Toxic Canister', value: 75, weight: 0.88, r: 0.2, sound: 'clang',
    build() { const g = new THREE.Group(); add(g, new THREE.CylinderGeometry(0.16, 0.16, 0.52, 14), M(0x3a4147, 0.35, 0.8)); add(g, new THREE.CylinderGeometry(0.162, 0.162, 0.26, 14), E(0x5dff4a, 1.4), 0, 0.02); add(g, new THREE.SphereGeometry(0.1, 10, 8), M(0x3a4147), 0, 0.3); g.add(glowSprite('g', '90,255,70', 0.9)); return g; },
  },
  idol: {
    name: 'Alien Idol', value: 120, weight: 0.85, r: 0.24, sound: 'clang',
    build() { const g = new THREE.Group(); const m = M(0xd7b24a, 0.25, 1); add(g, new THREE.IcosahedronGeometry(0.22, 0), m); add(g, new THREE.ConeGeometry(0.1, 0.3, 6), m, 0, 0.3); add(g, new THREE.SphereGeometry(0.05, 8, 6), E(0xff2a6a, 3), 0, 0.05, 0.19); g.add(glowSprite('p', '255,200,90', 1.0)); return g; },
  },
  core: {
    name: 'Fuel Core', value: 180, weight: 0.62, r: 0.32, sound: 'clang',
    build() { const g = new THREE.Group(); add(g, new THREE.SphereGeometry(0.2, 18, 14), E(0x32c8ff, 2.6)); const c = M(0x2a2f34, 0.35, 0.9); for (let i = 0; i < 3; i++) { const t = add(g, new THREE.TorusGeometry(0.28, 0.03, 8, 22), c); t.rotation.set(i * 1.05, i * 0.7, 0); } g.add(glowSprite('b', '60,200,255', 1.5)); return g; },
  },
  duck: {
    name: 'Rubber Duck', value: 25, weight: 0.99, r: 0.14, sound: 'squeak',
    build() { const g = new THREE.Group(); const y = M(0xffd21a, 0.5, 0); add(g, new THREE.SphereGeometry(0.15, 14, 10), y).scale.set(1, 0.8, 1.2); add(g, new THREE.SphereGeometry(0.09, 12, 10), y, 0, 0.17, 0.1); add(g, new THREE.BoxGeometry(0.07, 0.03, 0.06), M(0xff7a1a, 0.5, 0), 0, 0.16, 0.2); add(g, new THREE.SphereGeometry(0.015, 6, 6), M(0x000000), 0.04, 0.2, 0.17); add(g, new THREE.SphereGeometry(0.015, 6, 6), M(0x000000), -0.04, 0.2, 0.17); return g; },
  },
};
export const LOOT_KINDS = Object.keys(LOOT);

export function buildLootMesh(kind) {
  const g = LOOT[kind].build();
  g.userData.kind = kind;
  return g;
}
