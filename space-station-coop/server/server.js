import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || 3000;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

function resolveStatic(url) {
  let p = decodeURIComponent(url.split('?')[0]);
  if (p === '/') p = '/client/index.html';
  if (p.startsWith('/three/')) return path.join(root, 'node_modules/three', p.slice(7));
  if (p.startsWith('/client/')) return path.join(root, p);
  return null;
}

const server = http.createServer((req, res) => {
  const f = resolveStatic(req.url);
  const allowed = f && (f.startsWith(path.join(root, 'client')) || f.startsWith(path.join(root, 'node_modules/three')));
  if (!allowed) { res.writeHead(404); return res.end('not found'); }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// rooms: code -> { clients: Map(id -> ws), host, seed }
const rooms = new Map();
let nextId = 1;
const MAX_PLAYERS = 8;

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  let room = null, id = null;
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'join' && !room) {
      const code = String(m.room || 'lobby').slice(0, 24).toLowerCase();
      let r = rooms.get(code);
      if (!r) { r = { clients: new Map(), host: null, seed: (Math.random() * 1e9) | 0, code }; rooms.set(code, r); }
      if (r.clients.size >= MAX_PLAYERS) { ws.send(JSON.stringify({ t: 'full' })); return ws.close(); }
      id = nextId++;
      ws.pname = String(m.name || 'Crew').slice(0, 14);
      r.clients.set(id, ws);
      if (r.host === null) r.host = id;
      room = r;
      ws.send(JSON.stringify({
        t: 'welcome', id, host: r.host, seed: r.seed, room: r.code,
        players: [...r.clients].filter(([i]) => i !== id).map(([i, w]) => ({ id: i, name: w.pname })),
      }));
      broadcast(r, { t: 'peer', id, name: ws.pname }, id);
    } else if (m.t === 'relay' && room) {
      const msg = JSON.stringify({ t: 'relay', from: id, d: m.d });
      if (m.to) { const w = room.clients.get(m.to); if (w && w.readyState === 1) w.send(msg); }
      else broadcast(room, msg, id, true);
    }
  });
  ws.on('close', () => {
    if (!room) return;
    room.clients.delete(id);
    if (room.clients.size === 0) { rooms.delete(room.code); return; }
    if (room.host === id) room.host = room.clients.keys().next().value;
    broadcast(room, { t: 'left', id, host: room.host });
  });
});

function broadcast(r, msg, except, preStringified) {
  const s = preStringified ? msg : JSON.stringify(msg);
  for (const [i, w] of r.clients) if (i !== except && w.readyState === 1) w.send(s);
}

server.listen(PORT, () => console.log(`Space Station Co-op running on http://localhost:${PORT}`));
