// Fully procedural audio: no asset files. Spatialised with HRTF + convolution reverb.
const rnd = (a, b) => a + Math.random() * (b - a);

export class AudioEngine {
  constructor() { this.ctx = null; this.tension = 0; this._t = 0; this.voices = new Map(); this.hbTimer = 0; }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }));
    this.master = ctx.createGain(); this.master.gain.value = 0.85;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 24; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.25;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.dry = ctx.createGain(); this.dry.connect(this.master);
    // reverb
    this.wetSend = ctx.createGain(); this.wetSend.gain.value = 0.4;
    const conv = ctx.createConvolver(); conv.buffer = this._impulse(2.6, 2.4);
    const wetOut = ctx.createGain(); wetOut.gain.value = 0.8;
    this.wetSend.connect(conv); conv.connect(wetOut); wetOut.connect(this.master);
    // noise buffers
    this.noiseBuf = this._noise(2);
    this._startAmbient();
    this._schedule();
  }

  _impulse(sec, decay) {
    const ctx = this.ctx, n = ctx.sampleRate * sec, b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c); let lp = 0;
      for (let i = 0; i < n; i++) {
        const w = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
        lp += (w - lp) * (0.25 + 0.7 * (1 - i / n)); // darker over time
        d[i] = lp;
      }
    }
    return b;
  }
  _noise(sec) {
    const ctx = this.ctx, n = ctx.sampleRate * sec, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  // ---- listener / output plumbing -------------------------------------------------
  setListener(p, yaw) {
    if (!this.ctx) return;
    const l = this.ctx.listener, t = this.ctx.currentTime;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    if (l.positionX) {
      l.positionX.setValueAtTime(p.x, t); l.positionY.setValueAtTime(p.y, t); l.positionZ.setValueAtTime(p.z, t);
      l.forwardX.setValueAtTime(fx, t); l.forwardY.setValueAtTime(0, t); l.forwardZ.setValueAtTime(fz, t);
      l.upX.setValueAtTime(0, t); l.upY.setValueAtTime(1, t); l.upZ.setValueAtTime(0, t);
    }
    this._lp = p;
  }
  _out(pos, wet = 0.25, ref = 3) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    let head = g;
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = 1.3; p.maxDistance = 80;
      p.positionX.value = pos.x; p.positionY.value = pos.y ?? 1; p.positionZ.value = pos.z;
      g.connect(p); head = p;
    }
    const w = ctx.createGain(); w.gain.value = wet;
    head.connect(this.dry); head.connect(w); w.connect(this.wetSend);
    return g;
  }
  _env(g, t, a, d, peak) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  // ---- primitives -----------------------------------------------------------------
  tone({ f = 440, f2, type = 'sine', dur = 0.2, gain = 0.2, a = 0.004, pos, wet = 0.25, lp, delay = 0, detune = 0 }) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ctx.createGain(); this._env(g, t, a, dur, gain);
    let n = o; if (lp) { const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; o.connect(fl); n = fl; }
    n.connect(g); g.connect(this._out(pos, wet));
    o.start(t); o.stop(t + a + dur + 0.05);
    return o;
  }
  noise({ dur = 0.15, f = 1000, f2, q = 1, type = 'bandpass', gain = 0.3, a = 0.002, pos, wet = 0.25, delay = 0 }) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(f, t);
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ctx.createGain(); this._env(g, t, a, dur, gain);
    s.connect(fl); fl.connect(g); g.connect(this._out(pos, wet));
    s.start(t, Math.random()); s.stop(t + a + dur + 0.05);
  }

  // ---- game sounds ----------------------------------------------------------------
  footstep(pos, sprint = false, metal = 1) {
    const v = sprint ? 1 : 0.65;
    this.noise({ f: rnd(160, 260), q: 1.1, dur: 0.11, gain: 0.55 * v, pos, wet: 0.35 });
    this.tone({ f: rnd(70, 90), f2: 38, dur: 0.12, gain: 0.28 * v, pos, wet: 0.2 });
    if (Math.random() < 0.6 * metal) this.tone({ f: rnd(1500, 2600), dur: 0.05, gain: 0.025 * v, pos, wet: 0.5 });
  }
  jump(pos) { this.noise({ f: 400, f2: 900, q: 0.8, dur: 0.1, gain: 0.15, pos }); }
  land(pos, hard = 1) { this.tone({ f: 90, f2: 35, dur: 0.18, gain: 0.35 * hard, pos }); this.noise({ f: 220, q: 0.9, dur: 0.14, gain: 0.5 * hard, pos, wet: 0.4 }); }
  grab() { this.noise({ type: 'highpass', f: 3000, dur: 0.04, gain: 0.18 }); this.tone({ f: 340, f2: 190, dur: 0.1, gain: 0.18, type: 'triangle' }); }
  pickupDing() { [660, 880, 1320].forEach((f, i) => this.tone({ f, dur: 0.18, gain: 0.07, delay: i * 0.05, wet: 0.5, type: 'triangle' })); }
  throw_() { this.noise({ f: 300, f2: 1800, q: 1.2, dur: 0.22, gain: 0.3 }); }
  deposit(pos, big) {
    [1046, 1568, 2093].forEach((f, i) => this.tone({ f, dur: 0.5, gain: 0.09, delay: i * 0.07, wet: 0.6, pos, type: 'sine' }));
    this.noise({ type: 'highpass', f: 6000, dur: 0.25, gain: 0.09, delay: 0.1, pos });
    if (big) this.tone({ f: 523, f2: 1046, dur: 0.6, gain: 0.08, delay: 0.2, pos, type: 'triangle' });
  }
  clang(pos, power = 1) {
    const base = rnd(260, 520), g = Math.min(1, power) * 0.28;
    [1, 2.76, 5.4, 8.93].forEach((r, i) => this.tone({ f: base * r, dur: 0.5 / (i + 1) + 0.12, gain: g / (i + 1), pos, wet: 0.5 }));
    this.noise({ f: 3500, q: 0.6, dur: 0.05, gain: g * 0.8, pos });
  }
  squeak(pos) { this.tone({ f: 1100, f2: 1750, type: 'square', dur: 0.07, gain: 0.09, pos, lp: 3000 }); this.tone({ f: 1700, f2: 900, type: 'square', dur: 0.1, gain: 0.08, delay: 0.07, pos, lp: 3000 }); }
  door(pos, open = true) {
    this.noise({ type: 'highpass', f: 2500, dur: 0.35, gain: 0.12, pos, wet: 0.4 });
    this.tone({ f: open ? 110 : 80, f2: open ? 70 : 120, type: 'sawtooth', dur: 0.35, gain: 0.05, lp: 400, pos });
  }
  flashlight() { this.noise({ type: 'highpass', f: 4500, dur: 0.02, gain: 0.2 }); this.noise({ type: 'highpass', f: 4500, dur: 0.02, gain: 0.15, delay: 0.035 }); this.tone({ f: 1200, dur: 0.03, gain: 0.04, delay: 0.02 }); }
  hurt() {
    this.tone({ f: 70, f2: 30, dur: 0.4, gain: 0.5 }); this.noise({ f: 800, f2: 120, q: 0.7, dur: 0.35, gain: 0.45 });
    this.tone({ f: 180, f2: 80, type: 'sawtooth', dur: 0.3, gain: 0.12, lp: 900, delay: 0.04 });
  }
  death() { this.tone({ f: 55, f2: 22, dur: 1.6, gain: 0.5, wet: 0.8 }); this.noise({ f: 600, f2: 60, q: 0.6, dur: 1.2, gain: 0.35, wet: 0.8 }); }
  zap(pos) {
    for (let i = 0; i < 5; i++) this.noise({ type: 'highpass', f: rnd(2000, 5000), dur: rnd(0.02, 0.06), gain: rnd(0.08, 0.2), delay: i * rnd(0.03, 0.07), pos, wet: 0.4 });
  }
  groan() {
    const f = rnd(48, 75);
    this.tone({ f, f2: f * 0.55, type: 'sawtooth', dur: 3.2, gain: 0.07, a: 1.0, lp: 220, wet: 0.9 });
    this.tone({ f: f * 1.5, f2: f * 0.8, type: 'sine', dur: 3.2, gain: 0.05, a: 1.2, wet: 0.9 });
    this.noise({ f: rnd(300, 700), f2: rnd(150, 400), q: 8, dur: 2.5, gain: 0.05, a: 0.8, wet: 0.9 });
  }
  distantClang() { const a = Math.random() * 6.28, r = rnd(15, 35); this.clang({ x: this._lp.x + Math.cos(a) * r, y: 1.5, z: this._lp.z + Math.sin(a) * r }, 0.5); }
  monsterGrowl(pos, power = 1) {
    const ctx = this.ctx; if (!ctx) return; const t = ctx.currentTime, d = 1.4;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(70, t); o.frequency.linearRampToValueAtTime(48, t + d);
    const mod = ctx.createOscillator(); mod.frequency.value = 22; const mg = ctx.createGain(); mg.gain.value = 18; mod.connect(mg); mg.connect(o.frequency);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 4; f.frequency.setValueAtTime(300, t); f.frequency.linearRampToValueAtTime(700, t + d * 0.5); f.frequency.linearRampToValueAtTime(220, t + d);
    const g = ctx.createGain(); this._env(g, t, 0.2, d, 0.5 * power);
    o.connect(f); f.connect(g); g.connect(this._out(pos, 0.5, 4));
    o.start(t); mod.start(t); o.stop(t + d + 0.3); mod.stop(t + d + 0.3);
    this.noise({ f: 900, q: 1.5, dur: d, gain: 0.12 * power, a: 0.2, pos, wet: 0.5 });
  }
  monsterRoar(pos) {
    const ctx = this.ctx; if (!ctx) return; const t = ctx.currentTime, d = 1.8;
    for (const [type, f0, f1] of [['sawtooth', 90, 190], ['square', 60, 120]]) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + 0.5); o.frequency.exponentialRampToValueAtTime(f0 * 0.8, t + d);
      const mod = ctx.createOscillator(); mod.frequency.value = 34; const mg = ctx.createGain(); mg.gain.value = 40; mod.connect(mg); mg.connect(o.frequency);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2.5; f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(1600, t + 0.45); f.frequency.exponentialRampToValueAtTime(400, t + d);
      const g = ctx.createGain(); this._env(g, t, 0.08, d, 0.45);
      o.connect(f); f.connect(g); g.connect(this._out(pos, 0.6, 6));
      o.start(t); mod.start(t); o.stop(t + d + 0.3); mod.stop(t + d + 0.3);
    }
    this.noise({ f: 1500, f2: 400, q: 0.8, dur: d, gain: 0.3, a: 0.05, pos, wet: 0.6 });
  }
  monsterStep(pos) { this.tone({ f: 58, f2: 30, dur: 0.16, gain: 0.5, pos, wet: 0.4 }); this.noise({ f: 180, q: 1, dur: 0.1, gain: 0.35, pos }); if (Math.random() < 0.5) this.tone({ f: rnd(2200, 3200), dur: 0.04, gain: 0.03, pos }); }
  monsterAttack(pos) { this.noise({ f: 2500, f2: 300, q: 0.7, dur: 0.35, gain: 0.5, pos }); this.tone({ f: 800, f2: 250, type: 'sawtooth', dur: 0.3, gain: 0.2, lp: 2000, pos }); }
  heartbeat(vol = 1) {
    this.tone({ f: 60, f2: 35, dur: 0.14, gain: 0.55 * vol, wet: 0.1 });
    this.tone({ f: 55, f2: 30, dur: 0.16, gain: 0.4 * vol, delay: 0.17, wet: 0.1 });
  }
  roundWin() { [392, 523, 659, 784].forEach((f, i) => this.tone({ f, dur: 1.1, gain: 0.1, delay: i * 0.12, wet: 0.7, type: 'triangle' })); }
  roundLose() { [220, 185, 147, 98].forEach((f, i) => this.tone({ f, f2: f * 0.97, dur: 1.4, gain: 0.12, delay: i * 0.25, wet: 0.8, type: 'sawtooth', lp: 500 })); }
  ui() { this.tone({ f: 880, dur: 0.06, gain: 0.05, type: 'square', lp: 2500 }); }

  // ---- ambience -------------------------------------------------------------------
  _startAmbient() {
    const ctx = this.ctx;
    const bus = ctx.createGain(); bus.gain.value = 0.9; bus.connect(this.dry);
    const wetAmb = ctx.createGain(); wetAmb.gain.value = 0.3; bus.connect(wetAmb); wetAmb.connect(this.wetSend);
    // drone
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 170; lp.Q.value = 1.5;
    const dg = ctx.createGain(); dg.gain.value = 0.11; lp.connect(dg); dg.connect(bus);
    for (const [type, f, dt] of [['sawtooth', 55, 0], ['sawtooth', 55.3, 0], ['sine', 27.5, 0], ['triangle', 82.4, 4]]) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = dt; o.connect(lp); o.start();
    }
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lg = ctx.createGain(); lg.gain.value = 70; lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
    // air / ventilation
    const ns = ctx.createBufferSource(); ns.buffer = this.noiseBuf; ns.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 0.6;
    const ag = ctx.createGain(); ag.gain.value = 0.035; ns.connect(bp); bp.connect(ag); ag.connect(bus); ns.start();
    const l2 = ctx.createOscillator(); l2.frequency.value = 0.11; const l2g = ctx.createGain(); l2g.gain.value = 200; l2.connect(l2g); l2g.connect(bp.frequency); l2.start();
    // tension layer: dissonant tritone + tremolo
    const tg = (this.tensionGain = ctx.createGain()); tg.gain.value = 0;
    const tl = ctx.createBiquadFilter(); tl.type = 'lowpass'; tl.frequency.value = 600;
    const trem = ctx.createGain(); trem.gain.value = 0.5;
    const tremLfo = ctx.createOscillator(); tremLfo.frequency.value = 5.5; const tlg = ctx.createGain(); tlg.gain.value = 0.5; tremLfo.connect(tlg); tlg.connect(trem.gain); tremLfo.start();
    for (const f of [110, 155.6, 233]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(tl); o.start(); }
    tl.connect(trem); trem.connect(tg); tg.connect(bus);
  }
  _schedule() {
    const tick = () => {
      if (!this.ctx) return;
      const r = Math.random();
      if (r < 0.28) this.groan(); else if (r < 0.58) this.distantClang();
      else if (r < 0.78 && this._lp) this.zap({ x: this._lp.x + rnd(-20, 20), y: 3, z: this._lp.z + rnd(-20, 20) });
      this._to = setTimeout(tick, rnd(7000, 17000));
    };
    this._to = setTimeout(tick, 6000);
  }
  setTension(t, dt) {
    if (!this.ctx) return;
    this.tension += (t - this.tension) * Math.min(1, dt * (t > this.tension ? 3 : 0.6));
    this.tensionGain.gain.setTargetAtTime(this.tension * 0.07, this.ctx.currentTime, 0.1);
    // heartbeat accelerates with tension
    if (this.tension > 0.25) {
      this.hbTimer -= dt;
      if (this.hbTimer <= 0) { this.heartbeat(Math.min(1, this.tension)); this.hbTimer = 1.1 - this.tension * 0.55; }
    }
  }

  // ---- proximity voice ------------------------------------------------------------
  addVoice(id, stream) {
    if (!this.ctx || this.voices.has(id)) return;
    const ctx = this.ctx;
    const el = new Audio(); el.muted = true; el.srcObject = stream; el.play().catch(() => {}); // Chrome needs a sink
    const src = ctx.createMediaStreamSource(stream);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 120;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5500;
    const p = ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 2.5; p.rolloffFactor = 1.7; p.maxDistance = 60;
    const g = ctx.createGain(); g.gain.value = 1.4;
    const an = ctx.createAnalyser(); an.fftSize = 256;
    src.connect(hp); hp.connect(lp); lp.connect(an); lp.connect(p); p.connect(g); g.connect(this.dry);
    const w = ctx.createGain(); w.gain.value = 0.18; g.connect(w); w.connect(this.wetSend);
    this.voices.set(id, { panner: p, an, el, buf: new Uint8Array(an.fftSize) });
  }
  setVoicePos(id, pos) {
    const v = this.voices.get(id); if (!v) return;
    const t = this.ctx.currentTime;
    v.panner.positionX.setTargetAtTime(pos.x, t, 0.05); v.panner.positionY.setTargetAtTime(pos.y, t, 0.05); v.panner.positionZ.setTargetAtTime(pos.z, t, 0.05);
  }
  voiceLevel(id) {
    const v = this.voices.get(id); if (!v) return 0;
    v.an.getByteTimeDomainData(v.buf);
    let s = 0; for (let i = 0; i < v.buf.length; i++) { const x = (v.buf[i] - 128) / 128; s += x * x; }
    return Math.sqrt(s / v.buf.length);
  }
  removeVoice(id) { const v = this.voices.get(id); if (v) { v.panner.disconnect(); v.el.srcObject = null; this.voices.delete(id); } }
}
