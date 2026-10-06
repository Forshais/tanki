// Tanki online server: serves the game (../web) and keeps rooms over WebSocket (/ws).
// The room creator's browser (the host) simulates the battle; this server only relays:
// guest -> host (inputs) and host -> guests (snapshots, events). Run: node server.js [port]
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = +(process.env.PORT || process.argv[2] || 8095);
const WEB = path.join(__dirname, '..', 'web');
const MAX_PLAYERS = 6, TEAM_MAX = 3;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon' };

// ---------------------------------------------------------------- static files
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  if (p === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  const file = path.normalize(path.join(WEB, p));
  if (!file.startsWith(WEB)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    // the big model can be cached; code always revalidates so updates show up at once
    const big = /\.(glb|jpg|png|webp)$/.test(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Content-Length': st.size,
      'Cache-Control': big ? 'public, max-age=3600' : 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
});

// ---------------------------------------------------------------- rooms
let nextId = 1;
const clients = new Map();   // id -> { id, ws, name, room }
const rooms = new Map();     // id -> { id, name, pass, host, players: Map(id -> {id, name, team}), settings, state }

const send = (c, msg) => { if (c && c.ws.readyState === 1) c.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); };
const clean = (s, n) => String(s || '').replace(/[<>&"]/g, '').trim().slice(0, n);

function roomInfo(r) {
  return { id: r.id, name: r.name, locked: !!r.pass, host: r.host, state: r.state, settings: r.settings,
    players: [...r.players.values()].map(p => ({ ...p, rtt: clients.get(p.id)?.rtt || 0 })) };
}
function roomList() {
  return [...rooms.values()].map(r => ({ id: r.id, name: r.name, locked: !!r.pass, players: r.players.size, state: r.state,
    hostName: r.players.get(r.host)?.name || '' }));
}
function broadcastRoom(r) { for (const id of r.players.keys()) send(clients.get(id), { t: 'room', room: roomInfo(r) }); }
function broadcastList() { const msg = JSON.stringify({ t: 'list', rooms: roomList() }); for (const c of clients.values()) if (!c.room) send(c, msg); }
const teamCount = (r, team) => [...r.players.values()].filter(p => p.team === team).length;

function leave(c) {
  const r = rooms.get(c.room);
  c.room = null;
  if (!r) return;
  r.players.delete(c.id);
  if (r.host === c.id || r.players.size === 0) {
    // the host's browser runs the game: without it the room is gone
    for (const id of r.players.keys()) { const o = clients.get(id); if (o) { o.room = null; send(o, { t: 'closed', why: 'Istabas saimnieks aizgāja' }); } }
    rooms.delete(r.id);
  } else {
    send(clients.get(r.host), { t: 'left', id: c.id });
    broadcastRoom(r);
  }
  broadcastList();
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 256 * 1024,
  perMessageDeflate: { threshold: 200, zlibDeflateOptions: { level: 3 } } });
wss.on('connection', ws => {
  const c = { id: nextId++, ws, name: 'Spēlētājs', room: null, alive: true };
  clients.set(c.id, c);
  send(c, { t: 'hello', id: c.id });
  ws.on('pong', () => { c.alive = true; });
  ws.on('message', data => {
    let m; try { m = JSON.parse(data); } catch { return; }
    const r = rooms.get(c.room);
    switch (m.t) {
      case 'name': c.name = clean(m.name, 16) || 'Spēlētājs'; if (r) { r.players.get(c.id).name = c.name; broadcastRoom(r); } break;
      case 'list': send(c, { t: 'list', rooms: roomList() }); break;
      case 'ping': send(c, { t: 'pong', ts: m.ts }); break;                 // the client measures its round trip
      case 'rtt': c.rtt = Math.max(0, Math.min(5000, Math.round(+m.ms || 0))); break;
      case 'create': {
        if (c.room) leave(c);
        const room = { id: nextId++, name: clean(m.name, 24) || `${c.name} istaba`, pass: String(m.pass || '').slice(0, 32), host: c.id,
          players: new Map([[c.id, { id: c.id, name: c.name, team: 'blue' }]]), state: 'lobby',
          settings: { rule: 'lives3', minutes: 3, bots: { blue: 2, red: 3 } } };
        rooms.set(room.id, room); c.room = room.id;
        broadcastRoom(room); broadcastList();
        break;
      }
      case 'join': {
        const room = rooms.get(m.id);
        if (!room) return send(c, { t: 'error', msg: 'Istaba vairs nepastāv' });
        if (room.pass && room.pass !== String(m.pass || '')) return send(c, { t: 'error', msg: 'Nepareiza parole' });
        if (room.state !== 'lobby') return send(c, { t: 'error', msg: 'Kauja jau notiek, pagaidi beigas' });
        if (room.players.size >= MAX_PLAYERS) return send(c, { t: 'error', msg: 'Istaba ir pilna' });
        if (c.room) leave(c);
        const team = teamCount(room, 'red') < teamCount(room, 'blue') ? 'red' : (teamCount(room, 'blue') < TEAM_MAX ? 'blue' : 'red');
        room.players.set(c.id, { id: c.id, name: c.name, team }); c.room = room.id;
        broadcastRoom(room); broadcastList();
        break;
      }
      case 'leave': leave(c); send(c, { t: 'list', rooms: roomList() }); break;
      case 'team':
        if (r && r.state === 'lobby' && (m.team === 'blue' || m.team === 'red') && teamCount(r, m.team) < TEAM_MAX) {
          r.players.get(c.id).team = m.team; broadcastRoom(r);
        }
        break;
      case 'settings':      // host only: rules and bots per team
        if (r && r.host === c.id && r.state === 'lobby' && m.settings) { r.settings = m.settings; broadcastRoom(r); }
        break;
      case 'start':         // host only: everyone builds the same match; the host then streams it
        if (r && r.host === c.id && r.state === 'lobby') {
          r.state = 'game';
          for (const id of r.players.keys()) send(clients.get(id), { t: 'start', mode: m.mode });
          broadcastList();
        }
        break;
      case 'lobby':         // host only: the match is over / aborted, back to the room
        if (r && r.host === c.id) {
          r.state = 'lobby';
          for (const id of r.players.keys()) if (id !== c.id) send(clients.get(id), { t: 'tolobby' });
          broadcastRoom(r); broadcastList();
        }
        break;
      case 'g':             // game traffic: host -> every guest, guest -> host
        if (!r) break;
        if (r.host === c.id) { const s = JSON.stringify(m); for (const id of r.players.keys()) if (id !== c.id) send(clients.get(id), s); }
        else send(clients.get(r.host), { t: 'g', from: c.id, d: m.d });
        break;
    }
  });
  ws.on('close', () => { leave(c); clients.delete(c.id); });
});

// lobbies show everybody's ping: refresh them now and then
setInterval(() => { for (const r of rooms.values()) if (r.state === 'lobby') broadcastRoom(r); }, 4000);

// drop dead connections (laptop lid closed, network gone)
setInterval(() => {
  for (const c of clients.values()) {
    if (!c.alive) { c.ws.terminate(); continue; }
    c.alive = false; try { c.ws.ping(); } catch {}
  }
}, 15000);

server.listen(PORT, () => console.log(`Tanki server: http://localhost:${PORT}  (WebSocket /ws)`));
