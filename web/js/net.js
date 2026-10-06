import * as THREE from 'three';

// Online play. The server (server/server.js) keeps rooms and relays messages. The room's host simulates the
// whole battle in its browser (bots, physics, hits) and streams snapshots + events; guests send their inputs
// and show what the host sends (their tanks are puppets).
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const BOT_NAMES = { blue: ['Ozols', 'Kalniņš', 'Bērziņš'], red: ['Vilks', 'Lācis', 'Ērglis'] };
const RULES = { lives3: '3 dzīvības', lives1: '1 dzīvība', time: 'Uz laiku' };
const SNAP = 1 / 10, INPUT = 1 / 15, FULL = 1;      // snapshot / input rates (s), full refresh every second
const r3 = v => Math.round(v * 1000) / 1000, r2 = v => Math.round(v * 100) / 100;

export class Net {
  constructor(game) {
    this.g = game; this.ws = null; this.myId = 0; this.room = null; this.rooms = []; this.status = '';
    this.active = false; this.host = false; this.guest = false;
    this.events = []; this.snapT = 0; this.statT = 0; this.inT = 0; this.rep = 0; this.ammo = 'AP';
    this.byId = new Map();
    // invite link: ?istaba=<room id> joins that room as soon as the room list arrives
    this.invite = +new URLSearchParams(location.search).get('istaba') || 0;
  }

  inviteUrl() { return `${location.origin}${location.pathname}?istaba=${this.room.id}`; }

  // a friend opened an invite link: ask for a name once, then join (with the password if the room has one)
  useInvite() {
    const id = this.invite; this.invite = 0;
    history.replaceState(null, '', location.pathname);
    const r = this.rooms.find(r => r.id === id);
    if (!r) return this.flash('Ielūguma istaba vairs nepastāv. Palūdz draugam jaunu saiti.', true);
    if (!(this.g.opts.name || '').trim()) {
      const n = prompt('Tavs vārds spēlē:', '');
      if (n && n.trim()) { this.g.opts.name = n.trim().slice(0, 16); this.g.saveOpts(); this.send({ t: 'name', name: this.name() }); }
    }
    const pass = r.locked ? prompt(`Istabas „${r.name}” parole:`) : '';
    if (pass === null) return;
    this.send({ t: 'join', id, pass });
  }

  // ------------------------------------------------------------------ connection
  connect() {
    if (this.ws && this.ws.readyState <= 1) return;
    this.setStatus('Savienojas ar serveri…');
    const ws = this.ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    ws.onopen = () => {
      this.setStatus(''); this.send({ t: 'name', name: this.name() }); this.send({ t: 'list' });
      clearInterval(this.pingI); this.pingI = setInterval(() => this.send({ t: 'ping', ts: performance.now() }), 2000);
    };
    ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } this.onMsg(m); };
    ws.onclose = () => {
      this.ws = null; this.room = null;
      if (this.active) { this.stopMatch(); this.g.toMenu(); this.g.hud?.message?.('Savienojums pārtrūka', 'bad'); }
      this.setStatus('Nav savienojuma ar serveri. Vai tas ir palaists (start_online.bat)? <button class="ghost" id="net-retry">Mēģināt vēlreiz</button>');
    };
  }
  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  name() { return (this.g.opts.name || '').trim() || 'Spēlētājs'; }
  setStatus(html) { this.status = html; this.render(); }

  onMsg(m) {
    switch (m.t) {
      case 'hello': this.myId = m.id; break;
      case 'pong': {
        const ms = performance.now() - m.ts;
        this.rtt = this.rtt ? this.rtt * .7 + ms * .3 : ms;
        this.send({ t: 'rtt', ms: this.rtt }); this.showPing();
        break;
      }
      case 'list': this.rooms = m.rooms; this.render(); if (this.invite && !this.room) this.useInvite(); break;
      case 'room': this.room = m.room; this.render(); break;
      case 'closed': this.room = null; if (this.active) { this.stopMatch(); this.g.toMenu(); } this.flash(m.why, true); this.send({ t: 'list' }); break;
      case 'error': this.flash(m.msg, true); break;
      case 'start': this.startMatch(m.mode); break;
      case 'tolobby':
        if (this.active && !this.g.over) { this.stopMatch(); this.g.toMenu(); this.flash('Saimnieks beidza kauju', false); }
        else this.lobbyReady = true;
        break;
      case 'left': if (this.host && this.active) this.playerLeft(m.id); break;
      case 'g': if (this.active) this.host ? this.hostInput(m.from, m.d) : this.guestApply(m.d); break;
    }
  }

  // in a match: a guest's delay is its own trip to the server plus the host's (the host runs the battle)
  showPing() {
    const el = $('ping'); if (!el) return;
    if (!this.active || !this.rtt) { el.textContent = ''; return; }
    const ms = Math.round(this.host ? this.rtt : this.rtt + (this.hostRtt || 0));
    el.textContent = this.host ? `Ping ${ms} ms (tu esi saimnieks)` : `Ping līdz saimniekam ${ms} ms`;
    el.className = ms < 120 ? 'good' : ms < 250 ? 'warn' : 'bad';
  }

  flash(text, bad) {
    const el = $('net-flash'); if (!el) return;
    el.textContent = text || ''; el.className = bad ? 'bad' : 'good';
    clearTimeout(this.flashT); this.flashT = setTimeout(() => { el.textContent = ''; }, 5000);
  }

  // ------------------------------------------------------------------ lobby UI (in the main menu)
  render() {
    const box = $('net-body'); if (!box) return;
    $('menu').classList.toggle('inroom', !!this.room);
    if (this.status) { box.innerHTML = `<p class="dim">${this.status}</p>`; const b = $('net-retry'); if (b) b.onclick = () => this.connect(); return; }
    if (!this.ws) { box.innerHTML = ''; return; }
    box.innerHTML = this.room ? this.roomHtml() : this.listHtml();
    this.bind();
  }

  listHtml() {
    const rows = this.rooms.map(r => `<div class="nrow"><span class="nname">${r.locked ? '🔒 ' : ''}${esc(r.name)}</span>
      <span class="dim">${esc(r.hostName)} · ${r.players}/6 · ${r.state === 'game' ? 'kaujā' : 'gaida'}</span>
      <button class="ghost" data-join="${r.id}" data-locked="${r.locked ? 1 : ''}" ${r.state === 'game' ? 'disabled' : ''}>Pievienoties</button></div>`).join('');
    return `<div class="nfield"><span>Tavs vārds</span><input id="net-name" maxlength="16" value="${esc(this.g.opts.name || '')}" placeholder="Spēlētājs"></div>
      <h3>Istabas</h3>${rows || '<p class="dim">Pagaidām nevienas istabas. Izveido savu un pasaki draugam tās nosaukumu!</p>'}
      <div class="mrow"><button class="ghost" id="net-refresh">Atjaunot sarakstu</button></div>
      <h3>Jauna istaba</h3>
      <div class="nfield"><span>Nosaukums</span><input id="net-rname" maxlength="24" placeholder="${esc(this.name())} istaba"></div>
      <div class="nfield"><span>Parole</span><input id="net-pass" maxlength="32" placeholder="(nav obligāta)"></div>
      <button id="net-create">Izveidot istabu</button>`;
  }

  roomHtml() {
    const r = this.room, s = r.settings, isHost = r.host === this.myId, me = r.players.find(p => p.id === this.myId);
    const team = t => {
      const humans = r.players.filter(p => p.team === t), bots = Math.min(s.bots[t], 3 - humans.length);
      const ping = p => p.rtt ? ` <span class="rtt ${p.rtt < 120 ? 'good' : p.rtt < 250 ? 'warn' : 'bad'}">${p.rtt} ms</span>` : '';
      const list = humans.map(p => `<li>${esc(p.name)}${p.id === r.host ? ' <em>saimnieks</em>' : ''}${p.id === this.myId ? ' <em>tu</em>' : ''}${ping(p)}</li>`).join('')
        + Array.from({ length: Math.max(0, bots) }, () => '<li class="dim">bots</li>').join('');
      const botCtl = isHost ? `<div class="bots">boti <button class="ghost sm" data-bot="${t}" data-d="-1">−</button> ${bots} <button class="ghost sm" data-bot="${t}" data-d="1">+</button></div>` : '';
      const join = me && me.team !== t && humans.length < 3 ? `<button class="ghost sm" data-team="${t}">Pāriet šeit</button>` : '';
      return `<div class="nteam ${t}"><h4>${t === 'blue' ? 'Zilie' : 'Sarkanie'}</h4><ul>${list || '<li class="dim">tukšs</li>'}</ul>${botCtl}${join}</div>`;
    };
    const rules = isHost
      ? `<div class="seg" id="net-rule">${Object.entries(RULES).map(([k, v]) => `<button data-v="${k}" class="${s.rule === k ? 'on' : ''}">${v}</button>`).join('')}</div>
         ${s.rule === 'time' ? `<div class="seg" id="net-min">${[2, 3, 5].map(n => `<button data-v="${n}" class="${s.minutes === n ? 'on' : ''}">${n} min</button>`).join('')}</div>` : ''}`
      : `<p>${RULES[s.rule]}${s.rule === 'time' ? ` · ${s.minutes} min` : ''}</p>`;
    return `<h3>${r.locked ? '🔒 ' : ''}${esc(r.name)}</h3>
      <div class="nfield"><span>Ielūgums</span><input id="net-link" readonly value="${esc(this.inviteUrl())}"><button class="ghost sm" id="net-copy">Kopēt saiti</button></div>
      <p class="dim small">Nosūti šo saiti draugam: atverot to, viņš nonāk tieši šajā istabā${r.locked ? ' (parole jāpasaka atsevišķi)' : ''}.</p>
      <div class="nteams">${team('blue')}${team('red')}</div>
      <div class="nfield"><span>Noteikumi</span><div>${rules}</div></div>
      <div class="mrow">${isHost ? '<button id="net-start" class="big">Sākt kauju</button>' : '<span class="dim">Gaidām, kamēr saimnieks sāks kauju…</span>'}
      <button class="ghost" id="net-leave">Iziet no istabas</button></div>`;
  }

  bind() {
    const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
    const name = $('net-name');
    if (name) name.onchange = () => { this.g.opts.name = name.value.trim().slice(0, 16); this.g.saveOpts(); this.send({ t: 'name', name: this.name() }); };
    on('net-refresh', () => this.send({ t: 'list' }));
    on('net-create', () => { if (name) name.onchange(); this.send({ t: 'create', name: $('net-rname').value, pass: $('net-pass').value }); });
    for (const b of document.querySelectorAll('#net-body [data-join]')) b.onclick = () => {
      if (name) name.onchange();
      const pass = b.dataset.locked ? prompt('Istabas parole:') : '';
      if (pass === null) return;
      this.send({ t: 'join', id: +b.dataset.join, pass });
    };
    on('net-leave', () => this.send({ t: 'leave' }));
    on('net-copy', () => {
      const el = $('net-link'); el.select();
      (navigator.clipboard ? navigator.clipboard.writeText(el.value) : Promise.reject()).catch(() => document.execCommand('copy'))
        .finally(() => this.flash('Saite nokopēta — ielīmē to draugam (Ctrl+V)', false));
    });
    for (const b of document.querySelectorAll('#net-body [data-team]')) b.onclick = () => this.send({ t: 'team', team: b.dataset.team });
    const set = f => { const s = JSON.parse(JSON.stringify(this.room.settings)); f(s); this.send({ t: 'settings', settings: s }); };
    for (const b of document.querySelectorAll('#net-body [data-bot]')) b.onclick = () => set(s => {
      const t = b.dataset.bot, humans = this.room.players.filter(p => p.team === t).length;
      s.bots[t] = Math.max(0, Math.min(3 - humans, Math.min(s.bots[t], 3 - humans) + +b.dataset.d));
    });
    for (const b of document.querySelectorAll('#net-rule button')) b.onclick = () => set(s => { s.rule = b.dataset.v; });
    for (const b of document.querySelectorAll('#net-min button')) b.onclick = () => set(s => { s.minutes = +b.dataset.v; });
    on('net-start', () => this.requestStart());
  }

  // host: fixed roster (humans first, then bots) so every browser builds the same match
  requestStart() {
    const r = this.room, s = r.settings, roster = [], used = new Set();
    const unique = n => { let x = n, k = 2; while (used.has(x)) x = `${n} ${k++}`; used.add(x); return x; };
    for (const team of ['blue', 'red']) {
      const humans = r.players.filter(p => p.team === team).sort((a, b) => (b.id === r.host) - (a.id === r.host));
      let slot = 0;
      for (const p of humans) roster.push({ team, slot: slot++, kind: 'human', id: p.id, name: unique(p.name), role: 'attack' });
      for (let k = 0; k < s.bots[team] && slot < 3; k++, slot++)
        roster.push({ team, slot, kind: 'bot', name: unique(BOT_NAMES[team][slot]), role: slot === 2 ? 'defend' : 'attack' });
    }
    if (!roster.some(e => e.team === 'blue') || !roster.some(e => e.team === 'red')) return this.flash('Katrā komandā vajag vismaz vienu tanku (spēlētāju vai botu)', true);
    this.send({ t: 'start', mode: { rule: s.rule, minutes: s.minutes, roster, hostId: r.host } });
  }

  // ------------------------------------------------------------------ match
  startMatch(mode) {
    this.host = mode.hostId === this.myId; this.guest = !this.host; this.active = true;
    this.events = []; this.byId.clear(); this.snapT = 0; this.statT = 0; this.inT = 0; this.rep = 0; this.ammo = 'AP'; this.lobbyReady = false;
    this.sent = new Map(); this.metaSent = ''; this.fullT = 0; this.waitT = 0; this.lastIn = '';
    this.g.newMatch(mode, this);
    this.showPing();
  }
  stopMatch() { this.active = false; this.host = this.guest = false; this.g.net = null; this.showPing(); }

  // back to the room after the battle (or the host aborting it)
  backToRoom() {
    if (this.host) this.send({ t: 'lobby' });
    this.stopMatch(); this.g.toMenu();
  }
  quit() {
    if (this.host) this.send({ t: 'lobby' }); else { this.send({ t: 'leave' }); this.room = null; }
    this.stopMatch(); this.g.toMenu();
  }

  event(type, data) { if (this.host && this.active) this.events.push([type, data]); }

  // host: snapshot of every tank 20 times a second, the events since the last one, stats once a second
  // host: snapshot of the tanks that changed (all of them once a second) ~10 times a second, the events since the
  // last one, stats every 3 s. If the connection is still busy sending, skip: an old snapshot is worthless, and
  // queuing them is what makes the ping climb to seconds on a slow upload.
  hostTick(dt, force = false) {
    if ((this.snapT -= dt) > 0 && !force) return;
    this.snapT = SNAP;
    const busy = this.ws && this.ws.bufferedAmount > 1500;
    this.waitT = (this.waitT || 0) + SNAP;
    if (busy && !force && (!this.events.length || this.waitT < .6)) return;
    this.waitT = 0;
    const g = this.g, inf = a => a.map(n => n === Infinity ? -1 : n), full = (this.fullT = (this.fullT || 0) - SNAP) <= 0;
    if (full) this.fullT = FULL;
    this.sent = this.sent || new Map();
    const tk = [];
    for (const t of g.tanks) {
      const a = t.alive ? [t.id, 1, ...t.netState()] : [t.id, 0, r2(t.x), r2(t.z), r2(t.heading)], old = this.sent.get(t.id);
      if (full || !old || old.length !== a.length || a.some((v, i) => v !== old[i])) { tk.push(a); this.sent.set(t.id, a); }
    }
    const s = { tk, tl: g.timeLeft === null ? null : Math.round(g.timeLeft * 10) / 10, hr: Math.round(this.rtt || 0) };
    const meta = JSON.stringify([inf(g.left.blue), inf(g.left.red), g.world.bases.blue.hp, g.world.bases.red.hp]);
    if (full || meta !== this.metaSent) { this.metaSent = meta; s.left = { blue: inf(g.left.blue), red: inf(g.left.red) }; s.b = [g.world.bases.blue.hp, g.world.bases.red.hp]; }
    if ((this.statT -= SNAP) <= 0 || this.events.some(e => e[0] === 'kill')) { this.statT = 3; s.st = g.stats; }
    this.send({ t: 'g', d: this.events.length ? { s, e: this.events } : { s } });
    this.events = [];
  }

  // host: a guest's controls for its own tank
  hostInput(from, d) {
    const t = this.g.tanks.find(t => t.owner === from && t.alive);
    if (!t || !d) return;
    const c = t.controls;
    c.throttle = Math.max(-1, Math.min(1, +d.th || 0)); c.turn = Math.max(-1, Math.min(1, +d.tu || 0)); c.fire = !!d.f;
    if (Array.isArray(d.a)) c.aim.set(+d.a[0] || 0, +d.a[1] || 0, +d.a[2] || 0);
    const ammo = d.am ? 'HE' : 'AP';
    if (ammo !== t.ammo) { t.ammo = ammo; t.reload = t.spec.reload; }
    if (d.rep && d.rep !== t.repSeen) { t.repSeen = d.rep; t.repair(); }
  }

  // host: a guest left; a bot takes over its tank (and its respawns)
  playerLeft(id) {
    for (const t of this.g.tanks) if (t.owner === id) {
      t.owner = null;
      if (t.alive) this.g.addBot(t);
      this.g.hud.message(`${t.name} atstāja kauju, viņa vietā bots`, 'info');
    }
  }

  // guest: send my controls
  sendInput(dt) {
    if ((this.inT -= dt) > 0) return;
    this.inT = INPUT;
    const me = this.g.player;
    if (!me || !me.alive || (this.ws && this.ws.bufferedAmount > 600)) return;
    const c = me.controls, a = c.aim;
    const d = { th: c.throttle, tu: c.turn, f: c.fire ? 1 : 0, a: [r2(a.x), r2(a.y), r2(a.z)], am: this.ammo === 'HE' ? 1 : 0, rep: this.rep };
    const key = JSON.stringify(d);
    this.beatT = (this.beatT || 0) - INPUT;
    if (key === this.lastIn && this.beatT > 0) return;
    this.lastIn = key; this.beatT = .3;
    this.send({ t: 'g', d });
  }

  // guest: events first (in host order), then the snapshot
  guestApply(d) {
    const g = this.g;
    if (!g.world) return;
    for (const [type, e] of d.e || []) this.applyEvent(type, e);
    const s = d.s; if (!s) return;
    for (const a of s.tk) {
      const t = this.byId.get(a[0]); if (!t) continue;
      if (a[1]) t.applyNet(a.slice(2));
      else if (!t.alive && (Math.abs(t.x - a[2]) > .01 || Math.abs(t.z - a[3]) > .01)) { t.x = a[2]; t.z = a[3]; t.heading = a[4]; t.sync(); }   // pushed wreck
    }
    if (s.tl !== null) g.timeLeft = s.tl;
    this.hostRtt = s.hr || 0;
    const inf = a => a.map(n => n < 0 ? Infinity : n);
    if (s.left) g.left = { blue: inf(s.left.blue), red: inf(s.left.red) };
    if (s.b) { g.world.bases.blue.hp = s.b[0]; g.world.bases.red.hp = s.b[1]; }
    if (s.st) g.stats = s.st;
  }

  applyEvent(type, e) {
    const g = this.g, V = a => new THREE.Vector3(a[0], a[1], a[2]);
    switch (type) {
      case 'spawn': this.byId.set(e.id, g.netSpawn(e, this.myId)); break;
      case 'shot': {
        const t = this.byId.get(e.id), p = V(e.p), d = V(e.d), m = e.m ? V(e.m) : p;
        g.combat.spawn(t, p, d, e.type, e.sid, true);
        g.fx.muzzle(m, d); g.sfx.shot(g.hearing(m), t === g.player);
        if (t) { t.recoil = 1; t.revealT = 3; if (t === g.player) g.shake(.35); }
        break;
      }
      case 'hit': {
        g.combat.remove(e.sid);
        const t = this.byId.get(e.id), by = this.byId.get(e.by) || null;
        if (!t) break;
        g.combat.hitFx(t, V(e.d), V(e.p), e.type, e.r);
        if (e.r) g.onHit(by, t, e.r, { part: { label: e.label }, face: e.face });
        break;
      }
      case 'kill': { const t = this.byId.get(e.id); if (t && t.alive) t.destroy(this.byId.get(e.by) || null); break; }
      case 'bricks': g.world.removeBricks(e); break;
      case 'base': g.baseUpdate(g.world.bases[e.team], e.hp); break;
      case 'end': g.end(e.winner, e.why); break;
    }
  }
}
