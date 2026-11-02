import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const PARTICLE_VS = `
attribute float size; attribute float alpha; attribute vec3 color; varying float vA; varying vec3 vC;
void main(){ vA=alpha; vC=color; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=size*(320.0/-mv.z); gl_Position=projectionMatrix*mv; }`;
const PARTICLE_FS = `
varying float vA; varying vec3 vC;
void main(){ vec2 d=gl_PointCoord-0.5; float r=length(d)*2.0; float a=smoothstep(1.0,0.0,r); a*=a; gl_FragColor=vec4(vC, a*vA); }`;

function pointsMaterial() {
  return new THREE.ShaderMaterial({ vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
}

export class Particles {
  constructor(scene, max = 700) {
    this.max = max; this.n = 0;
    this.p = new Float32Array(max * 3); this.c = new Float32Array(max * 3); this.s = new Float32Array(max); this.a = new Float32Array(max);
    this.v = new Float32Array(max * 3); this.life = new Float32Array(max); this.age = new Float32Array(max); this.size0 = new Float32Array(max); this.grav = new Float32Array(max);
    const g = (this.geo = new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.c, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.s, 1)); g.setAttribute('alpha', new THREE.BufferAttribute(this.a, 1));
    this.pts = new THREE.Points(g, pointsMaterial()); this.pts.frustumCulled = false; scene.add(this.pts);
  }
  emit(x, y, z, vx, vy, vz, life, size, color, grav = 0) {
    if (this.n >= this.max) return;
    const i = this.n++, k = i * 3;
    this.p[k] = x; this.p[k + 1] = y; this.p[k + 2] = z; this.v[k] = vx; this.v[k + 1] = vy; this.v[k + 2] = vz;
    this.c[k] = color.r; this.c[k + 1] = color.g; this.c[k + 2] = color.b;
    this.life[i] = life; this.age[i] = 0; this.size0[i] = size; this.grav[i] = grav;
  }
  burst(x, y, z, count, color, speed = 3, life = 0.8, size = 0.18, grav = -4) {
    const col = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * 6.28, e = Math.random() * 1.6 - 0.3, s = speed * (0.4 + Math.random() * 0.8);
      this.emit(x, y, z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + 1, Math.sin(a) * Math.cos(e) * s, life * (0.6 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8), col, grav);
    }
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { // swap-remove
        const l = --this.n;
        if (i !== l) for (const [arr, w] of [[this.p, 3], [this.v, 3], [this.c, 3], [this.life, 1], [this.age, 1], [this.size0, 1], [this.grav, 1]]) for (let q = 0; q < w; q++) arr[i * w + q] = arr[l * w + q];
        i--; continue;
      }
      const k = i * 3, t = this.age[i] / this.life[i];
      this.v[k + 1] += this.grav[i] * dt;
      this.p[k] += this.v[k] * dt; this.p[k + 1] = Math.max(0.03, this.p[k + 1] + this.v[k + 1] * dt); this.p[k + 2] += this.v[k + 2] * dt;
      this.s[i] = this.size0[i] * (1 - t * 0.5); this.a[i] = (1 - t) * (t < 0.1 ? t * 10 : 1);
    }
    this.geo.setDrawRange(0, this.n);
    for (const a of ['position', 'color', 'size', 'alpha']) this.geo.attributes[a].needsUpdate = true;
  }
}

// Floating dust motes that wrap around the camera.
export class Dust {
  constructor(scene, n = 140, box = 9) {
    this.n = n; this.box = box;
    this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3);
    const s = new Float32Array(n).fill(0.05), a = new Float32Array(n).fill(0.35), c = new Float32Array(n * 3).fill(0.75);
    for (let i = 0; i < n * 3; i++) { this.p[i] = (Math.random() - 0.5) * box * 2; this.v[i] = (Math.random() - 0.5) * 0.15; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3)); g.setAttribute('size', new THREE.BufferAttribute(s, 1));
    g.setAttribute('alpha', new THREE.BufferAttribute(a, 1)); g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    this.w = new Float32Array(n * 3);
    this.pts = new THREE.Points(g, pointsMaterial()); this.pts.frustumCulled = false; scene.add(this.pts);
    this.geo = g; this.t = 0;
  }
  update(dt, cam) {
    this.t += dt; const b = this.box, pos = this.geo.attributes.position.array;
    for (let i = 0; i < this.n; i++) {
      const k = i * 3;
      this.p[k] += (this.v[k] + Math.sin(this.t * 0.5 + i) * 0.04) * dt; this.p[k + 1] += this.v[k + 1] * 0.4 * dt; this.p[k + 2] += this.v[k + 2] * dt;
      for (let q = 0; q < 3; q++) { if (this.p[k + q] > b) this.p[k + q] -= b * 2; else if (this.p[k + q] < -b) this.p[k + q] += b * 2; }
      pos[k] = cam.x + this.p[k]; pos[k + 1] = Math.max(0.2, Math.min(4, 1.8 + this.p[k + 1] * 0.3)); pos[k + 2] = cam.z + this.p[k + 2];
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, damage: { value: 0 }, fear: { value: 0 }, dead: { value: 0 }, aspect: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time, damage, fear, dead, aspect; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
    void main(){
      vec2 c = vUv-0.5; float r2 = dot(c,c);
      // chromatic aberration grows toward edges, with damage & fear
      float ab = (0.0012 + damage*0.012 + fear*0.003) * (0.4 + r2*4.0);
      vec2 dir = normalize(c+1e-5);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + dir*ab).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - dir*ab).b;
      // vignette
      float vig = smoothstep(0.85, 0.15, r2*1.9 + fear*0.15);
      col *= mix(1.0, vig, 0.85);
      // slight cold grade + desaturate with fear / death
      float l = dot(col, vec3(0.299,0.587,0.114));
      col = mix(vec3(l), col, 1.0 - fear*0.35 - dead*0.9);
      col *= vec3(0.96, 1.0, 1.05);
      // damage flash
      col = mix(col, vec3(0.7,0.02,0.02)*(0.3+vig), damage*0.55);
      // film grain
      float g = hash(vUv*vec2(1920.0,1080.0) + fract(time)*100.0) - 0.5;
      col += g * (0.028 + fear*0.02);
      // faint scanlines
      col *= 0.97 + 0.03*sin(vUv.y*900.0);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function createComposer(renderer, scene, camera, { bloom = true, samples = 0 } = {}) {
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples }));
  composer.addPass(new RenderPass(scene, camera));
  let bloomPass = null;
  if (bloom) {
    bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.5, 1.0);
    composer.addPass(bloomPass);
  }
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  return { composer, grade, bloomPass };
}
