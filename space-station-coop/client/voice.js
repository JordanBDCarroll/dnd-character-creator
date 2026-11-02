// Proximity voice chat: WebRTC mesh, signalled through the game server, spatialised in audio.js
export class Voice {
  constructor(net, audio) {
    this.net = net; this.audio = audio; this.peers = new Map(); this.stream = null; this.muted = false; this.ok = false; this.level = 0;
    this.ready = new Promise((r) => (this._ready = r));
    net.on('rtc', (d, from) => this.onSignal(d, from)); // register immediately so early offers aren't lost
  }

  async init() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      this.ok = true;
      const ctx = this.audio.ctx, src = ctx.createMediaStreamSource(this.stream);
      this.an = ctx.createAnalyser(); this.an.fftSize = 256; src.connect(this.an); this.buf = new Uint8Array(256);
    } catch (e) { console.warn('Mic unavailable, listen-only', e); }
    this._ready();
  }
  micLevel() {
    if (!this.an || this.muted) return 0;
    this.an.getByteTimeDomainData(this.buf);
    let s = 0; for (let i = 0; i < this.buf.length; i++) { const x = (this.buf[i] - 128) / 128; s += x * x; }
    return (this.level = Math.sqrt(s / this.buf.length));
  }
  setMuted(m) { this.muted = m; if (this.stream) this.stream.getAudioTracks().forEach((t) => (t.enabled = !m)); }

  connect(id) { // the lower id initiates the offer
    if (this.peers.has(id)) return this.peers.get(id);
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    const rec = { pc, pending: [], remoteSet: false };
    this.peers.set(id, rec);
    if (this.stream) this.stream.getTracks().forEach((t) => pc.addTrack(t, this.stream));
    else pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.onicecandidate = (e) => e.candidate && this.net.send({ t: 'rtc', c: e.candidate }, id);
    pc.ontrack = (e) => this.audio.addVoice(id, e.streams[0] || new MediaStream([e.track]));
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) this.drop(id); };
    if (this.net.id < id) {
      pc.onnegotiationneeded = async () => {
        try { await pc.setLocalDescription(await pc.createOffer()); this.net.send({ t: 'rtc', sdp: pc.localDescription }, id); } catch (e) { console.warn(e); }
      };
    }
    return rec;
  }
  async onSignal(d, from) {
    await this.ready; // tracks must be attached before we answer
    const rec = this.connect(from), pc = rec.pc;
    try {
      if (d.sdp) {
        await pc.setRemoteDescription(d.sdp); rec.remoteSet = true;
        for (const c of rec.pending) await pc.addIceCandidate(c); rec.pending = [];
        if (d.sdp.type === 'offer') { await pc.setLocalDescription(await pc.createAnswer()); this.net.send({ t: 'rtc', sdp: pc.localDescription }, from); }
      } else if (d.c) { if (rec.remoteSet) await pc.addIceCandidate(d.c); else rec.pending.push(d.c); }
    } catch (e) { console.warn('rtc', e); }
  }
  drop(id) { const r = this.peers.get(id); if (r) { r.pc.close(); this.peers.delete(id); } this.audio.removeVoice(id); }
}
