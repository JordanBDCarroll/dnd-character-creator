export class Net {
  constructor() { this.h = {}; this.id = null; this.host = null; this.ws = null; }
  connect(room, name) {
    return new Promise((resolve, reject) => {
      const ws = (this.ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`));
      ws.onopen = () => ws.send(JSON.stringify({ t: 'join', room, name }));
      ws.onerror = () => reject(new Error('Could not reach server'));
      ws.onclose = () => this.emit('close', {});
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.t === 'welcome') { this.id = m.id; this.host = m.host; resolve(m); }
        if (m.t === 'full') reject(new Error('Room is full'));
        if (m.t === 'relay') this.emit(m.d.t, m.d, m.from);
        else this.emit(m.t, m);
      };
    });
  }
  on(t, f) { (this.h[t] ||= []).push(f); }
  emit(t, ...a) { (this.h[t] || []).forEach((f) => f(...a)); }
  get isHost() { return this.id === this.host; }
  send(d, to) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 'relay', to, d })); }
}
