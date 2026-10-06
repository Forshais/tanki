import * as THREE from 'three';
import { C, W, H } from './map.js';

const $ = id => document.getElementById(id);

export class Hud {
  constructor(game) {
    this.g = game;
    this.labels = new Map();
    this.mm = $('minimap'); this.mm.width = W * 2; this.mm.height = H * 2;
    this.mmBase = document.createElement('canvas'); this.mmBase.width = W * 2; this.mmBase.height = H * 2;
    this.mmT = 0;
    this.v = new THREE.Vector3();
  }

  label(t) {
    let el = this.labels.get(t);
    if (!el) {
      el = document.createElement('div'); el.className = 'lbl';
      el.innerHTML = `<span></span><b class="mods"></b><div class="hp"><i></i></div>`;
      el.style.color = this.g.cfg.TEAMS[t.team].color;
      $('labels').appendChild(el); this.labels.set(t, el);
      el.querySelector('span').textContent = t.name;
    }
    return el;
  }

  message(text, cls = '') {
    const el = document.createElement('div'); el.className = 'msg ' + cls; el.textContent = text;
    $('msgs').appendChild(el); setTimeout(() => el.remove(), 2200);
  }

  feed(html) {
    const el = document.createElement('div'); el.innerHTML = html;
    $('feed').prepend(el); setTimeout(() => el.remove(), 7000);
  }

  update(dt) {
    const g = this.g, cam = g.camera, me = g.player;
    // floating name plates
    for (const t of g.tanks) {
      const el = this.label(t);
      if (!t.alive || t.hidden || (t === g.player && g.needsLock())) { el.style.display = 'none'; continue; }
      this.v.set(t.x, 3.4, t.z).project(cam);
      if (this.v.z > 1) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.left = (this.v.x * .5 + .5) * innerWidth + 'px'; el.style.top = (-this.v.y * .5 + .5) * innerHeight + 'px';
      el.querySelector('i').style.width = (t.hp / t.spec.hp * 100) + '%';
      el.querySelector('.mods').textContent = Object.keys(t.mod).filter(k => t.mod[k] !== 0).map(k => ' ' + g.cfg.MODULES[k].icon).join('');
    }
    for (const [t, el] of this.labels) if (!g.tanks.includes(t)) { el.remove(); this.labels.delete(t); }
    // player panel
    if (me) {
      $('hpbar').style.width = (me.hp / me.spec.hp * 100) + '%';
      $('hptext').textContent = me.alive ? `${Math.ceil(me.hp)} / ${me.spec.hp}` : 'Iznīcināts';
      const r = me.reload / me.spec.reload;
      $('reloadbar').style.width = ((1 - r) * 100) + '%';
      $('reloadtext').textContent = me.alive ? (me.reload > 0 ? `Pārlādē ${me.reload.toFixed(1)} s` : 'Gatavs!') : '';
      $('reloadbar').classList.toggle('ready', me.reload === 0);
      $('speed').textContent = Math.round(Math.abs(me.v) * 3.6) + ' km/h';
      for (const a of ['AP', 'HE']) $('ammo' + a).classList.toggle('on', me.ammo === a);
      for (const k of ['turret', 'track', 'engine']) {
        const el = $('mod-' + k), t = me.mod[k];
        el.classList.toggle('bad', t === -1); el.classList.toggle('fix', t > 0);
        el.querySelector('em').textContent = t === -1 ? 'F remonts' : t > 0 ? Math.ceil(t) + ' s' : 'ok';
      }
      const ring = $('crossring'), C2 = 2 * Math.PI * 16;
      ring.style.strokeDashoffset = C2 * r;
      $('cross').classList.toggle('ready', me.reload === 0);
    }
    // score panel: lives left (lives modes) or kills (timed mode), match clock
    const timed = g.mode.rule === 'time';
    for (const team of ['blue', 'red']) {
      const alive = g.tanks.filter(t => t.alive && t.team === team).length;
      $(team + 'info').innerHTML = timed ? `iznīcināja <b>${g.teamKills(team)}</b> · tanki <b>${alive}</b>`
        : `tanki <b>${alive}</b> · rezervē <b>${g.left[team].reduce((a, n) => a + n, 0)}</b>`;
      $(team + 'base').textContent = '★'.repeat(Math.max(0, g.world.bases[team].hp)) + '☆'.repeat(g.cfg.GAME.baseHp - Math.max(0, g.world.bases[team].hp));
    }
    const tl = g.timeLeft;
    $('timer').textContent = tl === null ? '' : `${Math.floor(Math.ceil(tl) / 60)}:${String(Math.ceil(tl) % 60).padStart(2, '0')}`;
    $('timer').classList.toggle('low', tl !== null && tl < 30);
    if (me) {
      const n = g.left[me.team][me.slot] + (me.alive ? 1 : 0);
      $('mylives').textContent = n === Infinity ? '' : '●'.repeat(n) + '○'.repeat(Math.max(0, (g.mode.rule === 'lives1' ? 1 : 3) - n));
      $('mylives').title = 'Dzīvības';
    }
    // minimap
    this.mmT -= dt;
    if (this.mmT < 0) { this.mmT = .15; this.minimap(); }
  }

  minimap() {
    const g = this.g, w = g.world;
    if (w.dirty) {
      w.dirty = false;
      const c = this.mmBase.getContext('2d');
      c.fillStyle = '#3c4a2a'; c.fillRect(0, 0, W * 2, H * 2);
      const col = { [C.BRICK]: '#a0522d', [C.STEEL]: '#9aa3ad', [C.WATER]: '#2f6f8a', [C.BUSH]: '#2c4a1e', [C.BASE]: '#e0b840' };
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const t = w.at(i, j); if (col[t]) { c.fillStyle = col[t]; c.fillRect(i * 2, j * 2, 2, 2); } }
    }
    const c = this.mm.getContext('2d');
    c.drawImage(this.mmBase, 0, 0);
    for (const t of g.tanks) {
      if (!t.alive || t.hidden) continue;
      const x = (t.x + W / 2) * 2, y = (t.z + H / 2) * 2;
      c.fillStyle = t === g.player ? '#ffffff' : g.cfg.TEAMS[t.team].color;
      c.beginPath(); c.arc(x, y, t === g.player ? 4 : 3, 0, 7); c.fill();
      c.strokeStyle = c.fillStyle; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x, y);
      c.lineTo(x + Math.sin(t.turretWorldYaw) * 9, y + Math.cos(t.turretWorldYaw) * 9); c.stroke();
    }
    // camera: view direction wedge
    const tg = g.camTarget, x0 = (tg.x + W / 2) * 2, y0 = (tg.z + H / 2) * 2, a = g.cam.yaw + Math.PI, r = 14 + g.cam.dist * .5;
    c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 1; c.beginPath();
    c.moveTo(x0, y0); c.lineTo(x0 + Math.sin(a - .55) * r, y0 + Math.cos(a - .55) * r);
    c.moveTo(x0, y0); c.lineTo(x0 + Math.sin(a + .55) * r, y0 + Math.cos(a + .55) * r); c.stroke();
  }
}
