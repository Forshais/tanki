import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import * as cfg from './config.js';
import { World } from './map.js';
import { Tank } from './tank.js';
import { Combat } from './combat.js';
import { FX } from './fx.js';
import { Bot } from './ai.js';
import { Hud } from './hud.js';
import { Sfx } from './audio.js';
import { Net } from './net.js';
import { canvasTex, rng, clamp, wrap } from './util.js';

const $ = id => document.getElementById(id);
const NAMES = { blue: ['Jānis', 'Ozols', 'Kalniņš'], red: ['Vilks', 'Lācis', 'Ērglis'] };
const GEN = { blue: 'Zilo', red: 'Sarkano' };      // genitive for messages

class Game {
  constructor() {
    this.cfg = cfg; this.time = 0; this.zoom = 1; this.paused = true; this.over = false;
    // ask for the discrete GPU (laptops otherwise often run WebGL on the integrated one)
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    try { const gl = r.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info'); this.gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ''; } catch { this.gpu = ''; }
    r.setPixelRatio(Math.min(devicePixelRatio, 2)); r.setSize(innerWidth, innerHeight);
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
    $('app').appendChild(r.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xb9c6c9); this.scene.fog = new THREE.Fog(0xb9c6c9, 90, 220);
    this.camera = new THREE.PerspectiveCamera(45, Math.max(1, innerWidth) / Math.max(1, innerHeight), .5, 600);
    this.camTarget = new THREE.Vector3(0, 0, 25); this.shakeA = 0; this.pushT = 0;
    // post: soft bloom so fire, flashes and tracers glow
    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), .45, .5, .92);
    this.composer.addPass(this.bloom); this.composer.addPass(new OutputPass());
    addEventListener('resize', () => { r.setSize(innerWidth, innerHeight); this.composer.setSize(innerWidth, innerHeight); this.camera.aspect = Math.max(1, innerWidth) / Math.max(1, innerHeight); this.camera.updateProjectionMatrix(); });
    addEventListener('visibilitychange', () => {
      if (document.hidden && !this.paused && !this.over && !this.testing) this.pause(true);
      // a hidden tab stops requestAnimationFrame, so nothing would update the engine sound: silence the audio entirely
      if (this.sfx.ctx && this.sfx.ctx.state !== 'closed') document.hidden ? this.sfx.ctx.suspend() : this.sfx.ctx.resume();
    });
    this.lights(); this.materials();
    this.sfx = new Sfx();
    this.keys = {}; this.mouse = { x: innerWidth / 2, y: innerHeight / 2, down: false, rdown: false };
    this.cam = { yaw: 0, pitchOff: 0, dist: 42 };
    const defaults = { carReverse: true, camMode: 'tactical', quality: 'medium', fps: 60, showFps: false, rings: true };
    try { this.opts = { ...defaults, ...JSON.parse(localStorage.getItem('tanki.opts') || '{}') }; } catch { this.opts = defaults; }
    this.fpsN = 0; this.fpsT = 0;
    this.input();
  }

  lights() {
    const s = this.scene, pm = new THREE.PMREMGenerator(this.renderer);
    const sky = new THREE.Scene();
    const t = canvasTex(8, 256, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#5c8cd0'); gr.addColorStop(.47, '#e2ebf0'); gr.addColorStop(.53, '#5a5d40'); gr.addColorStop(1, '#3d4230');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    sky.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide })));
    const sunBall = new THREE.Mesh(new THREE.SphereGeometry(4, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 13, 11) }));
    sunBall.position.set(-25, 35, 15); sky.add(sunBall);
    s.environment = pm.fromScene(sky, .02).texture; s.environmentIntensity = .85;
    const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x4a4a30, .45); hemi.userData.keep = true; s.add(hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xfff0dc, 3.0);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 200 });
    sun.shadow.bias = -.0004; sun.shadow.normalBias = .04;
    sun.userData.keep = sun.target.userData.keep = true;
    s.add(sun, sun.target);
  }

  materials() {
    const steelTex = canvasTex(256, 256, (g, w, h) => {
      const r = rng(9); g.fillStyle = '#6e757b'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 1500; k++) { g.fillStyle = `rgba(${r() < .5 ? 0 : 255},${r() < .5 ? 0 : 255},${r() < .5 ? 0 : 255},${r() * .05})`; g.fillRect(r() * w, r() * h, 2 + r() * 8, 1 + r() * 4); }
      for (let k = 0; k < 14; k++) { const x = r() * w, y = r() * h, l = 15 + r() * 60, gr = g.createLinearGradient(0, y, 0, y + l); gr.addColorStop(0, 'rgba(120,60,25,.45)'); gr.addColorStop(1, 'rgba(120,60,25,0)'); g.fillStyle = gr; g.fillRect(x, y, 2, l); }
      g.strokeStyle = 'rgba(25,27,29,.9)'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
      for (let i = 16; i < w; i += 28) for (const [x, y] of [[i, 12], [i, h - 12], [12, i], [w - 12, i]]) {
        g.fillStyle = '#565b61'; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); g.fillStyle = 'rgba(220,225,230,.5)'; g.beginPath(); g.arc(x - 1, y - 1, 1.6, 0, 7); g.fill();
      }
    });
    const conc = canvasTex(256, 256, (g, w, h) => {
      const r = rng(3); g.fillStyle = '#85827b'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 4000; k++) { const v = r() * 255 | 0; g.fillStyle = `rgba(${v},${v},${v},${r() * .08})`; g.fillRect(r() * w, r() * h, 1 + r() * 4, 1 + r() * 4); }
    });
    this.mats = {
      steel: new THREE.MeshStandardMaterial({ map: steelTex, bumpMap: steelTex, bumpScale: 1, metalness: .55, roughness: .5, color: 0xd8d4cc }),
      concrete: new THREE.MeshStandardMaterial({ map: conc, roughness: .95 }),
      gold: new THREE.MeshStandardMaterial({ color: 0xd4a63a, metalness: 1, roughness: .28 }),
    };
  }

  makeBase(team) {
    const g = new THREE.Group(), M = (geo, mat, p, r = [0, 0, 0], s = [1, 1, 1]) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(...p); m.rotation.set(...r); m.scale.set(...s);
      m.castShadow = m.receiveShadow = true; g.add(m); return m;
    };
    const conc = this.mats.concrete, gold = this.mats.gold;
    M(new THREE.BoxGeometry(3.9, .4, 3.9), conc, [0, .2, 0]);
    M(new THREE.BoxGeometry(2.3, 1.1, 2.3), conc, [0, .95, 0]);
    const eagle = new THREE.Group(); g.add(eagle); g.userData.eagle = eagle;
    const E = (geo, p, r, s) => { const m = M(geo, gold, p, r, s); g.remove(m); eagle.add(m); return m; };
    E(new THREE.SphereGeometry(.5, 20, 14), [0, 2.05, 0], [0, 0, 0], [.75, 1, .65]);
    E(new THREE.SphereGeometry(.24, 16, 12), [0, 2.72, .16]);
    E(new THREE.ConeGeometry(.08, .26, 10), [0, 2.66, .44], [Math.PI / 2 + .4, 0, 0]);
    E(new THREE.ConeGeometry(.3, .7, 4), [0, 1.65, -.3], [-.9, 0, 0], [1, 1, .3]);
    const wing = new THREE.Shape([[0, 0], [1.5, .55], [1.7, 1.05], [1.25, .8], [1.3, 1.25], [.85, .85], [.75, 1.1], [.3, .55]].map(([x, y]) => new THREE.Vector2(x, y)));
    const wg = new THREE.ExtrudeGeometry(wing, { depth: .06, bevelEnabled: true, bevelSize: .03, bevelThickness: .03, bevelSegments: 2 });
    for (const s of [-1, 1]) E(wg, [s * .2, 2.0, -.05], [0, s < 0 ? Math.PI : 0, s * .25], [1, 1, 1]);
    M(new THREE.CylinderGeometry(.05, .05, 5, 8), this.mats.steel, [1.6, 2.5, 1.6]);
    const flagTex = canvasTex(128, 80, c => { c.fillStyle = cfg.TEAMS[team].color; c.fillRect(0, 0, 128, 80); c.fillStyle = '#fff'; c.font = 'bold 44px Arial'; c.fillText('★', 10, 55); });
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1, 8, 1), new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide, roughness: .8 }));
    const p = fl.geometry.attributes.position; for (let k = 0; k < p.count; k++) p.setZ(k, Math.sin(p.getX(k) * 3) * .1);
    fl.geometry.computeVertexNormals(); fl.position.set(2.4, 4.5, 1.6); fl.castShadow = true; g.add(fl); g.userData.flag = fl;
    if (team === 'blue') g.rotation.y = Math.PI;
    return g;
  }

  async load() {
    const gltf = await new GLTFLoader().loadAsync(cfg.TANKS.T44.model, e => {
      if (e.total) { const pc = Math.round(e.loaded / e.total * 100); $('loading').textContent = `Ielādē T-44 modeli… ${pc}%`; $('lbar').style.width = pc + '%'; }
    });
    this.assets = { t44: gltf };
  }

  // mode: { size: 1 | 3 tanks per team, rule: 'lives3' | 'lives1' | 'time', minutes }; online games bring a
  // roster [{team, slot, kind: 'human' | 'bot', id, name, role}] instead of size
  setup(mode) {
    this.mode = mode;
    this.time = 0; this.over = false; this.watch = null; this.respawnAt = 0;
    this.world = new World(this);
    this.fx = new FX(this); this.combat = new Combat(this); this.hud = new Hud(this);
    this.tanks = []; this.bots = []; this.timers = []; this.stats = {}; this.pending = { blue: 0, red: 0 };
    // respawns left per player (by slot); timed games have unlimited respawns
    const re = mode.rule === 'time' ? Infinity : mode.rule === 'lives1' ? 0 : 2;
    this.left = { blue: Array(3).fill(re), red: Array(3).fill(re) };
    this.timeLeft = mode.rule === 'time' ? mode.minutes * 60 : null;
    const net = this.net, mine = mode.roster?.find(e => e.id === net?.myId);
    this.myTeam = mine ? mine.team : 'blue';
    if (net?.guest) { /* the host announces every tank */ }
    else if (mode.roster) {
      for (const e of mode.roster) this.spawn(e.team, e.slot, e === mine, e.role, { name: e.name, owner: e.kind === 'human' && e !== mine ? e.id : null });
    } else {
      this.spawn('blue', 0, true, 'attack', { name: (this.opts.name || '').trim() || NAMES.blue[0] });
      if (mode.size === 1) this.spawn('red', 0, false, 'attack');
      else {
        for (let k = 1; k < 3; k++) this.spawn('blue', k, false, k === 1 ? 'attack' : 'defend');
        for (let k = 0; k < 3; k++) this.spawn('red', k, false, k === 2 ? 'defend' : 'attack');
      }
    }
    const sp = mine ? this.world.spawns[mine.team][mine.slot] : this.player;
    this.camTarget.set(sp.x, 0, sp.z);
    this.cam.yaw = this.myTeam === 'red' ? Math.PI : 0;
    this.view.yaw = this.myTeam === 'red' ? 0 : Math.PI;
    $('myname').textContent = mine ? mine.name : this.player.name;
  }

  modeText(m = this.mode) {
    const n = t => m.roster.filter(e => e.team === t).length;
    const size = m.roster ? `tiešsaistē · ${n('blue')} pret ${n('red')}` : m.size === 1 ? '1 pret 1' : '3 pret 3';
    const rule = m.rule === 'time' ? `${m.minutes} minūtes, neierobežotas dzīvības` : m.rule === 'lives1' ? '1 dzīvība katram' : '3 dzīvības katram';
    return `${size} · ${rule}`;
  }

  // remove the whole match from the scene (lights stay) so a new one can be built in place
  teardown() {
    if (!this.world) return;
    this.toggleScope(false); this.release(); this.sfx.stopEngine();
    if (this.sfx.drives) { for (const d of this.sfx.drives.values()) d.src.stop(); this.sfx.drives.clear(); }
    const disposeMat = m => {
      for (const v of Object.values(m)) if (v && v.isTexture) v.dispose();
      m.dispose();
    };
    for (const o of [...this.scene.children]) {
      if (o.userData.keep) continue;
      this.scene.remove(o);
      o.traverse(n => {
        if (n.geometry) n.geometry.dispose();
        if (n.material) (Array.isArray(n.material) ? n.material : [n.material]).forEach(disposeMat);
        if (n.isInstancedMesh) n.dispose();
      });
    }
    for (const id of ['labels', 'feed', 'msgs', 'dmgdirs']) $(id).innerHTML = '';
    for (const id of ['dead', 'end', 'board']) $(id).classList.remove('show');
    $('respawn').textContent = ''; $('banner').className = '';
    this.world = null; this.player = null; this.tanks = []; this.bots = []; this.timers = [];
  }

  // start a match (also used for "play again"); the world is rebuilt from scratch
  newMatch(mode, net = null) {
    this.teardown();
    this.net = net;
    if (!net) { this.opts.mode = mode; this.saveOpts(); }
    this.setup(mode);
    for (const b of ['again', 'restart']) $(b).classList.toggle('hidden', !!net && b === 'restart');
    $('again').textContent = net ? 'Atpakaļ uz istabu' : 'Spēlēt vēlreiz (R)';
    $('tomenu').textContent = net ? 'Pamest kauju' : 'Galvenā izvēlne';
    $('dead-restart').classList.toggle('hidden', !!net);
    this.showMenu(false);
    this.sfx.start(); this.pause(false);
    if (this.needsLock()) this.renderer.domElement.requestPointerLock();
  }

  toMenu() {
    this.teardown(); this.paused = true; this.net = null;
    $('overlay').classList.remove('show');
    this.showMenu(true);
  }

  showMenu(on) {
    $('menu').classList.toggle('show', on);
    if (on) { $('optsHome').appendChild($('opts')); this.online?.render(); }
  }

  // online lobby lives in the main menu
  openOnline() {
    if (!this.online) this.online = new Net(this);
    this.online.connect(); this.online.render();
  }

  // guest: a tank announced by the host
  netSpawn(e, myId) {
    const mine = e.owner === myId;
    const t = new Tank(this, { team: e.team, spec: cfg.TANKS.T44, name: e.name, isPlayer: mine, x: e.x, z: e.z, heading: e.h,
      id: e.id, number: e.number, puppet: true });
    t.net = { x: e.x, z: e.z, h: e.h, ty: 0, p: 0 };
    t.slot = e.slot; t.owner = e.owner; this.tanks.push(t);
    if (mine) {
      if (this.player) this.hud.message('Atpakaļ kaujā!', 'info');
      this.player = t;
    }
    return t;
  }

  // like World of Tanks: an enemy in standing bushes stays invisible to us unless one of our tanks is within
  // 18 m; firing (or being hit) gives it away for a few seconds. Bots use the same rule through world.sight().
  spotting(dt) {
    const mine = this.tanks.filter(t => t.alive && t.team === this.myTeam);
    for (const t of this.tanks) {
      let hide = false;
      if (t.alive && t.team !== this.myTeam) {
        t.revealT = Math.max(0, (t.revealT || 0) - dt);
        hide = t.revealT === 0 && this.world.concealed(t.x, t.z) && !mine.some(a => Math.hypot(a.x - t.x, a.z - t.z) < 18);
      }
      if (hide !== !!t.hidden) { t.hidden = hide; t.root.visible = !hide; }
    }
  }

  addBot(t) { this.bots.push(new Bot(this, t, t.role || 'attack')); }

  // extra: { name, owner } — owner = the client id of a remote human whose inputs drive this tank (host)
  spawn(team, slot, isPlayer, role = 'attack', extra = {}) {
    const sp = this.world.spawns[team][slot];
    const t = new Tank(this, { team, spec: cfg.TANKS.T44, name: extra.name || NAMES[team][slot], isPlayer, x: sp.x, z: sp.z, heading: sp.heading, owner: extra.owner || null });
    this.stat(t, 'kills', 0);
    t.slot = slot; t.role = role;
    this.tanks.push(t);
    if (isPlayer) this.player = t; else if (!t.owner) this.addBot(t);
    this.net?.event('spawn', { id: t.id, team, slot, name: t.name, number: t.number, owner: isPlayer ? this.net.myId : t.owner || 0, x: t.x, z: t.z, h: t.heading });
    return t;
  }

  // tanks that ended up inside each other are eased apart (wrecks move less), never into walls
  separate(dt) {
    const ts = this.tanks;
    for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
      const a = ts[i], b = ts[j];
      let dx = b.x - a.x, dz = b.z - a.z; const d = Math.hypot(dx, dz);
      if (d > 7.2 || !(a.overlaps(b) || b.overlaps(a))) continue;
      if (d < .01) { dx = 1; dz = 0; } else { dx /= d; dz /= d; }
      const step = 3 * dt, wa = a.alive ? 1 : .3, wb = b.alive ? 1 : .3;
      if (!a.blockedWorld(a.x - dx * step * wa, a.z - dz * step * wa, a.heading)) { a.x -= dx * step * wa; a.z -= dz * step * wa; a.sync(); }
      if (!b.blockedWorld(b.x + dx * step * wb, b.z + dz * step * wb, b.heading)) { b.x += dx * step * wb; b.z += dz * step * wb; b.sync(); }
    }
  }

  // per-player match statistics (by name, so they survive respawns)
  stat(t, key, n = 1) {
    if (!t || !this.stats) return;
    const s = this.stats[t.name] || (this.stats[t.name] = { name: t.name, team: t.team, tank: t.spec.name, kills: 0, deaths: 0, dmg: 0, shots: 0, pens: 0 });
    s[key] += n;
  }

  hitMark(kind) {
    const el = $('hitmark'), c = this.needsLock();
    el.style.left = (c ? innerWidth / 2 : this.mouse.x) + 'px'; el.style.top = (c ? innerHeight / 2 : this.mouse.y) + 'px';
    el.className = ''; void el.offsetWidth; el.className = kind;
  }

  // arc at the screen edge pointing to whoever just hit the player: red = penetration, yellow = track, blue = the armour held
  damageFrom(src, result) {
    const me = this.player, cam = this.camera.getWorldDirection(new THREE.Vector3());
    const a = Math.atan2(src.x - me.x, src.z - me.z) - Math.atan2(cam.x, cam.z);
    const el = document.createElement('div'); el.className = 'dmgdir ' + (result === 'pen' ? 'pen' : result === 'track' ? 'track' : 'bounce');
    el.style.transform = `translate(-50%, -50%) rotate(${-a}rad)`;
    $('dmgdirs').appendChild(el); setTimeout(() => el.remove(), 1600);
  }

  banner(text, cls) {
    const el = $('banner'); el.textContent = text; el.className = cls;
    void el.offsetWidth; el.classList.add('on');
  }

  board(el) {
    const rows = team => Object.values(this.stats).filter(s => s.team === team)
      .sort((a, b) => b.kills - a.kills || b.dmg - a.dmg)
      .map(s => `<tr class="${s.name === this.player?.name ? 'me' : ''}"><td>${s.name}</td><td>${s.tank}</td><td>${s.kills}</td><td>${s.deaths}</td><td>${Math.round(s.dmg)}</td><td>${s.shots} / ${s.pens}</td></tr>`).join('');
    const head = '<tr><th>Spēlētājs</th><th>Tanks</th><th>Iznīcināja</th><th>Zaudēja</th><th>Bojājumi</th><th>Šāvieni / caursit.</th></tr>';
    el.innerHTML = ['blue', 'red'].map(team => `<div class="bteam ${team}"><h3>${cfg.TEAMS[team].name} · ērglis ${'★'.repeat(Math.max(0, this.world.bases[team].hp))}</h3><table>${head}${rows(team)}</table></div>`).join('');
  }

  // timers run on game time, so pausing (or a test fast-forward) behaves correctly
  later(seconds, fn) { this.timers.push({ at: this.time + seconds, fn }); }

  hearing(p) {
    const d = Math.hypot(p.x - this.camTarget.x, p.z - this.camTarget.z);
    return .05 + .9 * Math.pow(clamp(1 - d / 130, 0, 1), 1.5);
  }

  onHit(owner, target, r, hit) {
    target.revealT = Math.max(target.revealT || 0, 2);
    if (r.result === 'pen') this.stat(owner, 'pens');
    if (!target.alive) return;          // the kill banner already said it all
    const where = hit.part ? hit.part.label : 'korpusā', face = { front: 'priekšā', side: 'sānos', rear: 'aizmugurē', top: 'jumtā', bottom: 'apakšā' }[hit.face];
    if (owner === this.player) this.hitMark(r.result === 'pen' || r.result === 'track' ? 'pen' : 'bounce');
    if (target === this.player && owner) this.damageFrom(owner, r.result);
    const mod = r.module ? cfg.MODULES[r.module].name : '';
    if (owner === this.player) {
      if (mod) this.hud.message(`${target.name}: ${mod.toLowerCase()}!`, 'good');
      if (r.result === 'track') this.hud.message(`Trāpīts ķēdē −${r.dmg}`, 'good');
      else if (r.result === 'pen') this.hud.message(r.rack ? 'Munīcijas eksplozija!' : `Caursists! −${r.dmg}`, 'good');
      else if (r.result === 'rico') this.hud.message('Rikošets!', 'warn');
      else this.hud.message(`Neiesita (${r.eff} mm ${where} ${face})`, 'warn');
    }
    if (target === this.player) {
      if (mod) this.hud.message(`${mod}! Spied F — remonts (${cfg.MODULES[r.module].repair} s)`, 'bad');
      if (r.result === 'track') this.hud.message(`Trāpījums ķēdē −${r.dmg}`, 'bad');
      else if (r.result === 'pen') { this.hud.message(`Tevi caursita ${where}! −${r.dmg}`, 'bad'); $('hurt').classList.remove('on'); void $('hurt').offsetWidth; $('hurt').classList.add('on'); }
      else this.hud.message(r.result === 'rico' ? 'Rikošets no tavām bruņām' : `Bruņas izturēja (${r.eff} mm)`, 'info');
    }
  }

  onKill(t, by) {
    const guest = this.net?.guest;
    if (!guest) { this.stat(t, 'deaths'); if (by && by !== t && by.team !== t.team) this.stat(by, 'kills'); }
    if (by === this.player && t !== this.player) {
      this.banner(`IZNĪCINĀTS · ${t.name}`, 'kill'); this.sfx.kill();
    }
    const col = tk => `<b style="color:${cfg.TEAMS[tk.team].color}">${tk.name}</b>`;
    this.hud.feed(by && by !== t ? `${col(by)} iznīcināja ${col(t)}` : `${col(t)} iznīcināts`);
    if (t === this.player) {
      this.hud.message('Tavs tanks iznīcināts', 'bad'); this.sfx.stopEngine(); this.toggleScope(false);
      if (this.left[t.team][t.slot] === 0) this.later(2.5, () => { if (!this.over && this.player === t) { $('dead').classList.add('show'); this.release(); } });
    }
    const wait = this.mode.rule === 'time' ? cfg.GAME.respawnTimed : cfg.GAME.respawn;
    if (t === this.player && this.left[t.team][t.slot] > 0) this.respawnAt = this.time + wait;
    if (guest) return;                   // lives, respawns and the end are the host's business
    if (this.left[t.team][t.slot] > 0) {
      this.left[t.team][t.slot]--; this.pending[t.team]++;
      this.later(wait, () => {
        this.pending[t.team]--;
        if (this.over) return;
        const nt = this.spawn(t.team, t.slot, t === this.player, t.role, { name: t.name, owner: t.owner });
        this.bots = this.bots.filter(b => b.t !== t);
        if (nt.blocked(nt.x, nt.z, nt.heading)) for (const dx of [6, -6, 12, -12]) if (!nt.blocked(nt.x + dx, nt.z, nt.heading)) { nt.x += dx; nt.sync(); break; }
        if (nt === this.player) this.hud.message('Atpakaļ kaujā!', 'info');
      });
    } else this.bots = this.bots.filter(b => b.t !== t);
    this.checkEnd();
  }

  baseHit(b, by) {
    this.baseUpdate(b, b.hp - 1);
    this.net?.event('base', { team: b.team, hp: b.hp });
    if (b.hp <= 0) this.end(b.team === 'blue' ? 'red' : 'blue', `${GEN[b.team]} ērglis iznīcināts`);
  }

  baseUpdate(b, hp) {
    if (!b.alive) return;
    b.hp = hp;
    const ours = b.team === this.myTeam;
    this.hud.message(`${ours ? 'Mūsu' : 'Pretinieka'} ērglim trāpīts! (${Math.max(0, b.hp)}/${cfg.GAME.baseHp})`, ours ? 'bad' : 'good');
    if (b.hp > 0) return;
    b.alive = false; b.mesh.userData.eagle.visible = false;
    const p = new THREE.Vector3(b.x, 2, b.z);
    this.fx.explosion(p, 1.5); this.fx.burn(p, 60); this.sfx.boom(1, true);
  }

  checkEnd() {
    for (const team of ['blue', 'red']) {
      const alive = this.tanks.some(t => t.alive && t.team === team);
      if (!alive && this.left[team].every(n => n === 0) && this.pending[team] === 0)
        this.end(team === 'blue' ? 'red' : 'blue', `Visi ${GEN[team]} tanki iznīcināti`);
    }
  }

  teamKills(team) { return Object.values(this.stats).filter(s => s.team === team).reduce((a, s) => a + s.kills, 0); }

  // timed games: more destroyed enemy tanks wins, then the less damaged eagle
  timeUp() {
    const kb = this.teamKills('blue'), kr = this.teamKills('red'), eb = this.world.bases.blue.hp, er = this.world.bases.red.hp;
    const winner = kb !== kr ? (kb > kr ? 'blue' : 'red') : eb !== er ? (eb > er ? 'blue' : 'red') : null;
    this.end(winner, `Laiks beidzies · iznīcināti: Zilie ${kb}, Sarkanie ${kr}` + (kb === kr && winner ? ' · izšķīra ērgļu bojājumi' : ''));
  }

  end(winner, why) {
    if (this.over) return;
    this.over = true; this.sfx.stopEngine();
    this.net?.event('end', { winner, why });
    if (this.net?.host) this.net.hostTick(1, true);     // flush now: the host's tab may be closed right after
    const world = this.world;
    setTimeout(() => {
      if (this.world !== world) return;          // a new match was started meanwhile
      $('endtitle').textContent = winner === this.myTeam ? 'Uzvara!' : winner ? 'Zaudējums' : 'Neizšķirts';
      $('endwhy').textContent = `${why} · ${this.modeText()}`;
      this.board($('endboard'));
      $('dead').classList.remove('show'); this.release();
      $('end').classList.add('show');
    }, 2500);
  }

  // ------------------------------------------------------------------ input
  input() {
    const canvas = this.renderer.domElement;
    this.view = { yaw: Math.PI, pitch: -.04 };     // War Thunder / gunner-sight view direction (world)
    this.scope = false; this.scopeFov = 14; this.wtDist = 13; this.saved = null;
    addEventListener('keydown', e => {
      if (e.code === 'Space' || e.code === 'Tab' || e.code === 'F3') e.preventDefault();
      if (e.repeat) return;
      this.keys[e.code] = true;
      if (e.code === 'Escape' && !this.over && this.world) this.pause(!this.paused);
      if (e.code === 'KeyR' && this.over && this.world) this.again();
      if (e.code === 'Tab' && this.world) { this.board($('board')); $('board').classList.add('show'); }
      if (e.code === 'Space' && this.player && !this.player.alive) this.spectateNext();
      if (this.paused || !this.player) return;
      if (e.code === 'Digit1' || e.code === 'Digit2') this.setAmmo(e.code === 'Digit1' ? 'AP' : 'HE');
      if (e.code === 'F3') { this.opts.showFps = !this.opts.showFps; $('opt-showFps').checked = this.opts.showFps; this.saveOpts(); }
      if (e.code === 'KeyF') this.repair();
      if (e.code === 'KeyX') this.resetCamera();
      if (e.code === 'KeyV') this.setCamMode(this.opts.camMode === 'wt' ? 'tactical' : 'wt');
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.toggleScope();
      if (e.code === 'KeyC') this.saved = { ...this.view };          // free look: remember where the gun aims
    });
    addEventListener('keyup', e => {
      this.keys[e.code] = false;
      if (e.code === 'Tab') $('board').classList.remove('show');
      if (e.code === 'KeyC' && this.saved) { this.view = this.saved; this.saved = null; }   // snap back like War Thunder
    });
    addEventListener('mousemove', e => {
      const dx = e.movementX || 0, dy = e.movementY || 0;
      if (this.locked()) {
        const s = this.scope ? .0012 * this.scopeFov / 14 : .0024;
        this.view.yaw -= dx * s; this.view.pitch = clamp(this.view.pitch - dy * s, -.5, .35);
      } else if (this.mouse.rdown || this.keys.KeyC) {      // tactical: right drag or holding C orbits the camera
        this.cam.yaw -= dx * .006;
        this.cam.pitchOff = clamp(this.cam.pitchOff + dy * .25, -60, 40);
      }
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
    });
    addEventListener('mousedown', e => { if (e.button === 0) this.mouse.down = true; if (e.button === 2) this.mouse.rdown = true; });
    addEventListener('mouseup', e => { if (e.button === 0) this.mouse.down = false; if (e.button === 2) this.mouse.rdown = false; });
    addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('wheel', e => {
      const f = e.deltaY > 0 ? 1.12 : .89;
      if (this.scope) this.scopeFov = clamp(this.scopeFov * f, 4, 24);
      else if (this.opts.camMode === 'wt') this.wtDist = clamp(this.wtDist * f, 7, 34);
      else this.cam.dist = clamp(this.cam.dist * f, 9, 95);
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      // Esc releases the pointer lock in the browser: treat that as pause
      if (!this.locked() && !this.releasing && !this.paused && !this.over && this.needsLock()) this.pause(true);
      this.releasing = false;
    });
    canvas.addEventListener('click', () => { if (!this.paused && this.needsLock() && !this.locked()) canvas.requestPointerLock(); });
    for (const k of ['carReverse', 'showFps', 'rings']) {
      const el = $('opt-' + k); el.checked = this.opts[k];
      el.onchange = () => { this.opts[k] = el.checked; this.saveOpts(); };
    }
    for (const k of ['quality', 'fps', 'camMode']) {
      const el = $('opt-' + k); el.value = String(this.opts[k]);
      el.onchange = () => { this.opts[k] = k === 'fps' ? +el.value : el.value; this.saveOpts(); this.applyQuality(); };
    }
    this.applyQuality();
    $('resume').onclick = () => { this.sfx.start(); this.pause(false); if (this.needsLock()) canvas.requestPointerLock(); };
    $('again').onclick = () => this.again();
    for (const id of ['restart', 'dead-restart']) $(id).onclick = () => this.newMatch(this.mode);
    for (const id of ['tomenu', 'dead-menu', 'end-menu']) $(id).onclick = () => this.net ? this.net.quit() : this.toMenu();
    $('dead-watch').onclick = () => { $('dead').classList.remove('show'); this.spectateNext(); };
    this.menuInput();
  }

  // main menu: segmented choices for team size, rules and time; the last choice is remembered
  menuInput() {
    const m = { size: 3, rule: 'lives3', minutes: 3, ...(this.opts.mode || {}) };
    const sync = () => {
      for (const seg of document.querySelectorAll('#menu .seg'))
        for (const b of seg.children) b.classList.toggle('on', String(m[seg.dataset.k]) === b.dataset.v);
      $('f-min').style.display = m.rule === 'time' ? '' : 'none';
      const goal = m.rule === 'time' ? 'Uzvar komanda, kas iznīcina vairāk tanku (vai pretinieka ērgli).' : m.rule === 'lives1' ? 'Bez atdzimšanas: katram tankam viena dzīvība.' : 'Katrs tanks drīkst atdzimt divreiz.';
      $('modeinfo').textContent = `${this.modeText(m)}. ${goal}`;
    };
    for (const seg of document.querySelectorAll('#menu .seg'))
      for (const b of seg.children) b.onclick = () => { m[seg.dataset.k] = seg.dataset.k === 'rule' ? b.dataset.v : +b.dataset.v; sync(); };
    for (const b of document.querySelectorAll('#menu [data-tab]')) b.onclick = () => {
      const on = !$(b.dataset.tab).classList.contains('show');
      for (const t of document.querySelectorAll('#menu .tab')) t.classList.remove('show');
      for (const x of document.querySelectorAll('#menu [data-tab]')) x.classList.remove('on');
      $(b.dataset.tab).classList.toggle('show', on); b.classList.toggle('on', on);
      if (on && b.dataset.tab === 't-net') this.openOnline();
    };
    $('play').onclick = () => this.newMatch({ ...m });
    sync();
  }

  spectateNext() {
    const team = this.player.team, list = this.tanks.filter(t => t.alive && t.team === team);
    const all = list.length ? list : this.tanks.filter(t => t.alive);
    if (!all.length) return;
    const i = all.indexOf(this.watch);
    this.watch = all[(i + 1) % all.length];
    this.hud.message(`Vēro: ${this.watch.name} (atstarpe — nākamais)`, 'info');
  }

  locked() { return document.pointerLockElement === this.renderer.domElement; }
  needsLock() { return this.opts.camMode === 'wt' || this.scope; }
  release() { if (this.locked()) { this.releasing = true; document.exitPointerLock(); } }

  setCamMode(mode) {
    this.opts.camMode = mode; $('opt-camMode').value = mode; this.saveOpts();
    const me = this.player;
    if (mode === 'wt') {
      if (me) this.view = { yaw: me.turretWorldYaw, pitch: -.04 };
      this.renderer.domElement.requestPointerLock();
      this.hud.message('Kamera: War Thunder (pele griež skatu)', 'info');
    } else {
      if (!this.scope) this.release();
      this.hud.message('Kamera: taktiskā (kursors)', 'info');
    }
  }

  toggleScope(force) {
    const me = this.player, on = force ?? !this.scope;
    if (on && (!me || !me.alive)) return;
    this.scope = on;
    $('scope').classList.toggle('show', on);
    if (on) {
      this.view = { yaw: me.turretWorldYaw, pitch: me.pitch };
      this.renderer.domElement.requestPointerLock();
    } else {
      if (me) me.root.visible = true;
      if (this.opts.camMode !== 'wt') this.release();
    }
  }

  resetCamera() {
    this.cam = { yaw: this.myTeam === 'red' ? Math.PI : 0, pitchOff: 0, dist: 42 }; this.wtDist = 13; this.scopeFov = 14;
    if (this.player) this.view = { yaw: this.player.turretWorldYaw, pitch: -.04 };
  }

  repair() {
    const me = this.player;
    if (!me || !me.alive) return;
    if (this.net?.guest) {
      if (Object.values(me.mod).includes(-1)) { this.net.rep++; this.hud.message('Apkalpe sāk remontu', 'info'); this.sfx.click(); }
      return;
    }
    if (me.repair()) { this.hud.message('Apkalpe sāk remontu', 'info'); this.sfx.click(); }
  }

  saveOpts() { try { localStorage.setItem('tanki.opts', JSON.stringify(this.opts)); } catch {} }

  // graphics presets: resolution scale, shadow map size, bloom (low also helps a hot laptop)
  applyQuality() {
    const q = this.opts.quality, r = this.renderer;
    const pr = q === 'high' ? Math.min(devicePixelRatio, 2) : q === 'medium' ? Math.min(devicePixelRatio, 1.25) : .85;
    r.setPixelRatio(pr); this.composer.setPixelRatio(pr); this.composer.setSize(innerWidth, innerHeight);
    const size = q === 'high' ? 2048 : 1024;
    this.sun.castShadow = q !== 'low';
    if (this.sun.shadow.mapSize.x !== size) { this.sun.shadow.mapSize.set(size, size); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; }
    this.bloom.enabled = q !== 'low';
  }

  // after the end screen: solo = same mode again, online = back to the room
  again() { if (this.net) this.net.backToRoom(); else this.newMatch(this.mode); }

  // online games never stop for one player: the menu only covers the screen and the tank stands still
  pause(p) {
    this.paused = p;
    if (p) { this.release(); $('optsPause').appendChild($('opts')); $('pausemode').textContent = this.modeText(); }
    $('overlay').classList.toggle('show', p);
    if (p) this.sfx.stopEngine();
  }

  setAmmo(a) {
    const me = this.player;
    if (!me || !me.alive || me.ammo === a) return;
    me.ammo = a; me.reload = me.spec.reload;
    if (this.net?.guest) this.net.ammo = a;
    this.hud.message(`Lādē: ${cfg.SHELLS[a].name}`, 'info'); this.sfx.click();
  }

  playerControls() {
    const k = this.keys, me = this.player, c = me.controls;
    c.throttle = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
    c.turn = (k.KeyA || k.ArrowLeft ? 1 : 0) - (k.KeyD || k.ArrowRight ? 1 : 0);
    // War Thunder / car style: when backing up, A swings the rear to the left
    if (this.opts.carReverse && c.throttle <= 0 && (c.throttle < 0 || me.v < -.3)) c.turn = -c.turn;
    c.fire = this.mouse.down || !!k.Space;
    if (k.KeyC) return;                                   // free look: the turret keeps its aim
    // aim along the cursor (tactical) or the screen centre (War Thunder / sight); tanks are aimed at exactly
    const centre = this.needsLock();
    const ndc = centre ? new THREE.Vector2(0, 0) : new THREE.Vector2(this.mouse.x / innerWidth * 2 - 1, -(this.mouse.y / innerHeight) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.camera);
    const o = ray.ray.origin.clone(), d = ray.ray.direction;
    if (!Number.isFinite(d.x + d.y + d.z + o.x)) return;      // window of size 0 (tab opened in the background)
    if (centre && !this.scope) o.addScaledVector(d, this.wtDist);   // skip what lies between the camera and the tank
    let best = null;
    for (const t of this.tanks) {
      if (t === me || t.hidden || (!t.alive && !t.wreck)) continue;
      const h = t.raycast(o, d, 500);
      if (h && (!best || h.t < best.t)) best = { ...h, tank: t };
    }
    const w = this.world.raycast(o, d, 450);
    if (best && best.point.distanceTo(o) < w.point.distanceTo(o)) { c.aim.copy(best.point); this.penHint(best); }
    else {
      best = null; $('pentip').textContent = ''; delete $('cross').dataset.pen;
      c.aim.copy(w.point);
      if (!centre && w.kind === 'ground') c.aim.y = 1.0;
    }
    $('cross').classList.toggle('ontank', !!best);
  }

  // War Thunder style hint: will the loaded shell go through where the cursor points?
  penHint(best) {
    const me = this.player, tip = $('pentip');
    const target = best.tank;
    if (!target.alive || target.team === me.team) { tip.textContent = ''; delete $('cross').dataset.pen; return; }
    const { p } = me.muzzle(), d = best.point.clone().sub(p), dist = d.length(); d.normalize();
    const h = target.raycast(p, d, dist + 2);
    if (!h) { tip.textContent = ''; delete $('cross').dataset.pen; return; }
    if (h.region === 'track') { tip.className = 'maybe'; tip.textContent = 'ķēde · sabojās gaitas daļu'; $('cross').dataset.pen = 'maybe'; return; }
    const shell = cfg.SHELLS[me.ammo], base = h.part.armor[h.face];
    const eff = base / Math.max(h.cos, .2), pen = shell.pen * (1 - Math.min(dist, 300) / 1500);
    let cls, txt;
    if (me.ammo === 'AP' && h.cos < .34 && h.face !== 'top') { cls = 'no'; txt = 'rikošets'; }
    else if (pen > eff * 1.1) { cls = 'yes'; txt = 'caursitīs'; }
    else if (pen > eff * .9) { cls = 'maybe'; txt = 'varbūt'; }
    else { cls = 'no'; txt = 'necaursitīs'; }
    tip.className = cls; tip.textContent = `${txt} · ${Math.round(eff)} mm ${h.part.label}`;
    $('cross').dataset.pen = cls;
  }

  shake(a) { this.shakeA = Math.min(1.2, this.shakeA + a); }

  // ------------------------------------------------------------------ loop
  update(dt) {
    if (!this.world || !(dt > 0)) return;
    this.time += dt;
    const net = this.net, guest = net?.guest;
    if (this.timeLeft !== null && !this.over && (this.timeLeft -= dt) <= 0) { this.timeLeft = 0; if (!guest) this.timeUp(); }
    for (const tm of this.timers.filter(tm => tm.at <= this.time)) { this.timers.splice(this.timers.indexOf(tm), 1); tm.fn(); }
    const me = this.player;
    if (me && me.alive && !this.paused) this.playerControls();
    else if (me) { const c = me.controls; c.fire = false; if (this.paused) c.throttle = c.turn = 0; }
    if (guest) net.sendInput(dt);
    else for (const b of this.bots) b.update(dt);
    for (const t of this.tanks) t.update(dt);
    if (!guest) this.separate(dt);
    this.spotting(dt);
    this.world.updateBushes(dt);
    this.tanks = this.tanks.filter(t => t.alive || t.wreck);
    this.combat.update(dt); this.fx.update(dt);
    // engine and tracks (one recording): the player's own tank, and nearby tanks louder the closer to the camera
    if (this.sfx.ctx) {
      const quiet = this.paused && !this.net;
      for (const t of this.tanks) {
        const v = t.alive ? t.trackV || 0 : 0, ear = t === me ? 1 : this.hearing(t);
        const vol = !t.alive || quiet ? 0 : t === me ? .6 : ear * .45;
        this.sfx.drive(t, v, vol, t === me && !this.paused ? Math.abs(t.controls.throttle) : 0);
      }
      this.sfx.driveSweep();
    }
    this.world.waterNormal.offset.x += dt * .02; this.world.waterNormal.offset.y += dt * .013;
    if (net?.host) net.hostTick(dt);
  }

  frame(dt) {
    if (!this.world) return;
    if (this.watch && !this.watch.alive && this.player && !this.player.alive) this.spectateNext();
    if (this.player && this.player.alive && this.watch && !this.testing) this.watch = null;
    const me = this.watch || this.player;
    if (this.scope && (!me || !me.alive)) this.toggleScope(false);
    if (me && me.isPlayer) me.root.visible = !this.scope;
    let fov = 45;
    const vdir = new THREE.Vector3(Math.sin(this.view.yaw) * Math.cos(this.view.pitch), Math.sin(this.view.pitch), Math.cos(this.view.yaw) * Math.cos(this.view.pitch));
    if (this.scope && me) {
      // gunner's sight: on the mantlet, looking where the player looks (the gun follows at its own speed)
      me.root.updateMatrixWorld(true);
      const gp = me.gun.getWorldPosition(new THREE.Vector3());
      this.camera.position.copy(gp).add(new THREE.Vector3(0, .32, 0)).addScaledVector(vdir, .4);
      this.camera.lookAt(this.camera.position.clone().add(vdir));
      fov = this.scopeFov; this.camTarget.set(me.x, 0, me.z);
      this.scene.fog.near = 120; this.scene.fog.far = 420;
    } else if (this.opts.camMode === 'wt' && me) {
      // third person behind the tank; the view direction is the mouse, the turret follows it
      const piv = new THREE.Vector3(me.x, 2.3, me.z), D = this.wtDist;
      this.camTarget.lerp(new THREE.Vector3(me.x, 0, me.z), 1 - Math.exp(-dt * 10));
      this.camera.position.copy(piv).addScaledVector(vdir, -D).add(new THREE.Vector3(0, .8 + D * .1, 0));
      this.camera.position.y = Math.max(.7, this.camera.position.y);
      this.camera.lookAt(piv.clone().addScaledVector(vdir, 30));
      this.scene.fog.near = 70; this.scene.fog.far = 260;
    } else this.tacticalCamera(me, dt);
    if (this.camera.fov !== fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.frameRest(me, dt);
  }

  tacticalCamera(me, dt) {
    // orbit camera (right drag or C rotates, wheel zooms; close up it drops toward a third-person view)
    const cam = this.cam, D = cam.dist;
    const pitch = clamp(22 + (D - 9) + cam.pitchOff, 8, 85) * Math.PI / 180;
    if (me) {
      const look = new THREE.Vector3(me.x, 0, me.z);
      if (me.alive) look.lerp(me.controls.aim.clone().setY(0), .18 * Math.min(1, pitch));
      this.camTarget.lerp(look, 1 - Math.exp(-dt * 4));
    }
    const lookAt = this.camTarget.clone().setY(1.2 * (1 - pitch / 1.6));
    this.camera.position.set(lookAt.x + Math.sin(cam.yaw) * Math.cos(pitch) * D, lookAt.y + Math.sin(pitch) * D, lookAt.z + Math.cos(cam.yaw) * Math.cos(pitch) * D);
    this.camera.lookAt(lookAt);
    this.scene.fog.near = D + 60; this.scene.fog.far = D * 2 + 190;
    this.zoom = D / 42;
  }

  frameRest(me, dt) {
    if (this.shakeA > .01) {
      const a = this.shakeA; this.shakeA *= Math.pow(.02, dt);
      this.camera.position.add(new THREE.Vector3((Math.random() - .5) * a, (Math.random() - .5) * a, (Math.random() - .5) * a));
    }
    this.sun.position.set(this.camTarget.x - 30, 60, this.camTarget.z + 22); this.sun.target.position.copy(this.camTarget);
    if (this.world.leafU && me) { this.world.leafU.uCam.value.copy(this.camera.position); this.world.leafU.uTank.value.set(me.x, 1.6, me.z); }
    // reticles: cursor + where the gun actually points
    const cx = this.needsLock() ? innerWidth / 2 : this.mouse.x, cy = this.needsLock() ? innerHeight / 2 : this.mouse.y;
    $('cross').style.transform = `translate(${cx}px,${cy}px)`;
    $('cross').style.visibility = this.scope ? 'hidden' : '';
    for (const t of this.tanks) t.ring.visible = this.opts.rings && t.alive;
    const pen = $('cross').dataset.pen || '';
    $('gunmark').dataset.pen = pen; $('scope').dataset.pen = pen;
    $('pentip').style.transform = `translate(${cx + 24}px,${cy + 10}px)`;
    if (me && me.alive && me.isPlayer) {
      const m = me.muzzle(), d = Math.max(5, m.p.distanceTo(me.controls.aim));
      const p = m.p.clone().addScaledVector(m.dir, d).project(this.camera);
      $('gunmark').style.display = '';
      $('gunmark').style.transform = `translate(${(p.x * .5 + .5) * innerWidth}px,${(-p.y * .5 + .5) * innerHeight}px)`;
    } else $('gunmark').style.display = 'none';
    $('respawn').textContent = me && !me.alive && this.respawnAt && !this.over ? `Atgriešanās pēc ${Math.max(0, this.respawnAt - this.time).toFixed(0)} s` : '';
    this.hud.update(dt);
    this.composer.render(dt);
  }

  // test helper: advance the game without requestAnimationFrame (works in a hidden tab)
  simulate(seconds, dt = 1 / 60) {
    this.paused = false; this.testing = true;
    let k = 0;
    for (let t = 0; t < seconds; t += dt) { this.update(dt); if (++k % 4 === 0) this.frame(dt * 4); }
    this.frame(dt);
  }

  run() {
    let last = performance.now(), next = 0;
    const tick = now => {
      requestAnimationFrame(tick);
      const lim = this.opts.fps;
      // frame cap keeps the GPU (and the laptop) cooler; a running deadline averages to the cap on 144 Hz screens too
      if (lim) { if (now < next - 1) return; next = Math.max(next + 1000 / lim, now - 1000 / lim); }
      const dt = Math.min((now - last) / 1000, 1 / 20); last = Math.max(last, now);
      if ((!this.paused || this.net) && dt > 0) this.update(dt);
      this.lastRaf = now;
      this.frame(dt);
      this.fpsN++; this.fpsT += dt;
      if (this.fpsT >= .5) { $('fps').textContent = this.opts.showFps ? `${Math.round(this.fpsN / this.fpsT)} FPS · ${this.gpu.replace(/ANGLE \(|\)|Direct3D11.*$/g, '').slice(0, 60)}` : ''; this.fpsN = 0; this.fpsT = 0; }
    };
    requestAnimationFrame(tick);
    // a hidden, minimised or covered window gets no animation frames: an online game keeps running from a
    // worker's timer (worker timers are not throttled like the page's), otherwise the battle would freeze for everybody
    const worker = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 33)'], { type: 'text/javascript' })));
    this.lastRaf = 0;
    worker.onmessage = () => {
      const now = performance.now();
      if (!this.net || !this.world || now - this.lastRaf < 120) return;
      const dt = Math.min((now - last) / 1000, 1 / 10); last = now;
      if (dt > 0) this.update(dt);
    };
  }
}

const game = window.game = new Game();
game.load().then(() => {
  game.run();
  $('loader').classList.remove('show'); game.showMenu(true);
  if (new URLSearchParams(location.search).has('istaba')) document.querySelector('[data-tab="t-net"]').click();   // invite link
}).catch(e => { $('loading').textContent = 'Kļūda: ' + e.message; console.error(e); });
