import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { clamp, wrap, toLocal, toWorld, rayBox, rand, canvasTex } from './util.js';

let NEXT_ID = 1;

// ---- track path (model space, from the Blender build constants), sampled every 1 cm
const TX = 1.34, TT = .035, WR = .415, WZ = .485, RAD = Math.PI / 180;
const WHEELS = [0, 1, 2, 3, 4].map(i => -2.12 + i * 1.06), IDLER = [-2.93, .62, .3], SPROCKET = [2.9, .64, .32];
const PAIR = .28;     // the exported link segment holds two 0.14 m links
function arc(c, r, a0, a1, n) {
  const out = [];
  for (let i = 0; i <= n; i++) { const a = (a0 + (a1 - a0) * i / n) * RAD; out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); }
  return out;
}
const TRACK = (() => {
  let p = [[WHEELS[0], TT], [WHEELS[4], TT]];
  p = p.concat(arc(SPROCKET, SPROCKET[2] + TT + .01, -115, 95, 14));
  const top = WZ + WR + TT;
  p.push([WHEELS[4] + .45, top - .02]);
  for (let i = 4; i >= 0; i--) { p.push([WHEELS[i], top]); if (i) p.push([(WHEELS[i] + WHEELS[i - 1]) / 2, top - .05]); }
  p = p.concat(arc(IDLER, IDLER[2] + TT + .03, 80, 255, 12));
  // Blender (y, z) -> three (z = -y, y = z); reversed so the bottom run points toward +Z
  p = p.map(([y, z]) => [-y, z]).reverse();
  const seg = []; let L = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length], d = Math.hypot(b[0] - a[0], b[1] - a[1]); if (d > 1e-6) { seg.push([a, b, L, d]); L += d; } }
  const N = Math.ceil(L / .01), Z = new Float32Array(N), Y = new Float32Array(N), A = new Float32Array(N);
  let k = 0;
  for (let i = 0; i < N; i++) {
    const t = i * L / N;
    while (seg[k][2] + seg[k][3] < t) k++;
    const [a, b, l0, d] = seg[k], f = (t - l0) / d, tz = (b[0] - a[0]) / d, ty = (b[1] - a[1]) / d;
    Z[i] = a[0] + (b[0] - a[0]) * f; Y[i] = a[1] + (b[1] - a[1]) * f; A[i] = Math.atan2(-ty, tz);
  }
  const pairs = Math.round(L / PAIR);
  return { L, N, Z, Y, A, pairs, step: L / pairs };
})();
const _m = new THREE.Matrix4();
const TURRET_PART = s => s._turretPart || (s._turretPart = { region: 'turret', label: 'tornī', armor: s.armor.turret });

// decal materials, made once
const DECALS = {};
function decalMaterial(kind) {
  if (DECALS[kind]) return DECALS[kind];
  const map = canvasTex(128, 128, (g, w, h) => {
    const c = w / 2;
    if (kind === 'hole') {
      let gr = g.createRadialGradient(c, c, 6, c, c, 62);
      gr.addColorStop(0, 'rgba(20,14,10,.95)'); gr.addColorStop(.45, 'rgba(40,28,18,.6)'); gr.addColorStop(1, 'rgba(40,28,18,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(190,185,175,.95)'; g.beginPath();
      for (let k = 0; k < 18; k++) { const a = k / 18 * 6.283, r = 15 + Math.random() * 7; g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r); }
      g.fill();
      g.fillStyle = '#050403'; g.beginPath(); g.arc(c, c, 12, 0, 7); g.fill();
    } else {
      let gr = g.createRadialGradient(c, c, 4, c, c, 60);
      gr.addColorStop(0, 'rgba(60,50,40,.55)'); gr.addColorStop(1, 'rgba(60,50,40,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.save(); g.translate(c, c); g.rotate(-.2);
      gr = g.createLinearGradient(-44, 0, 44, 0);
      gr.addColorStop(0, 'rgba(210,205,195,0)'); gr.addColorStop(.3, 'rgba(225,222,215,.95)'); gr.addColorStop(1, 'rgba(160,155,148,.2)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(0, 0, 44, 9, 0, 0, 7); g.fill();
      g.strokeStyle = 'rgba(240,238,232,.8)'; g.lineWidth = 1;
      for (let k = 0; k < 6; k++) { g.beginPath(); g.moveTo(-40, -6 + k * 2.4); g.lineTo(38, -5 + k * 2.2); g.stroke(); }
      g.restore();
    }
  });
  return (DECALS[kind] = new THREE.MeshStandardMaterial({
    map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
    roughness: kind === 'hole' ? .9 : .35, metalness: kind === 'hole' ? .2 : .8,
  }));
}

export class Tank {
  // id/number come from the host in online games; owner = the client id of a remote human (host side);
  // puppet = this browser only shows the tank, the host simulates it
  constructor(game, { team, spec, name, isPlayer = false, x, z, heading, id = null, number = null, owner = null, puppet = false }) {
    this.g = game; this.id = id ?? NEXT_ID++; this.owner = owner; this.puppet = puppet;
    if (id !== null) NEXT_ID = Math.max(NEXT_ID, id + 1);
    this.team = team; this.spec = spec; this.name = name; this.isPlayer = isPlayer;
    this.x = x; this.z = z; this.heading = heading; this.v = 0;
    this.turretYaw = 0; this.pitch = 0;
    this.hp = spec.hp; this.alive = true; this.wreck = false;
    this.reload = 1.5; this.ammo = 'AP';
    this.controls = { throttle: 0, turn: 0, aim: new THREE.Vector3(x, 1, z - 10), fire: false };
    this.recoil = 0; this.trackDist = 0; this.dustT = 0; this.shield = 2.5;
    this.mod = { turret: 0, track: 0, engine: 0 };   // 0 ok, -1 broken, > 0 seconds of repair left
    this.decals = []; this.sink = 0; this.sinkF = this.sinkR = this.sinkL = this.sinkRt = 0; this.trackSide = 'L'; this.wakeT = 0;
    this.smokeT = 0;

    const root = game.assets.t44.scene.clone(true);
    root.traverse(o => {
      if (!o.isMesh) return;
      o.material = o.material.clone(); o.castShadow = o.receiveShadow = true;
      if (team === 'red') o.material.color.setRGB(.86, .86, .92);
    });
    this.root = root;
    this.turret = root.getObjectByName('turret');
    this.gun = root.getObjectByName('gun');
    this.gunBase = this.gun.position.clone();
    // tactical number painted on both turret sides (worn white paint)
    this.number = number ?? (team === 'blue' ? 100 : 200) + 10 * (NEXT_ID % 9) + Math.floor(Math.random() * 9) + 1;
    const nt = canvasTex(256, 128, (g, w, h) => {
      g.fillStyle = 'rgba(232,228,214,.92)'; g.font = 'bold 92px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(this.number), w / 2, h / 2 + 4);
      g.globalCompositeOperation = 'destination-out';
      for (let k = 0; k < 420; k++) { g.fillStyle = `rgba(0,0,0,${Math.random() * .9})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 4, 1 + Math.random() * 3); }
    });
    for (const sd of [1, -1]) {
      const d = new THREE.Mesh(new THREE.PlaneGeometry(.6, .3), new THREE.MeshStandardMaterial({ map: nt, transparent: true, roughness: .75, polygonOffset: true, polygonOffsetFactor: -2 }));
      d.position.set(sd * 1.05, .3, -.2); d.rotation.y = sd * Math.PI / 2; d.userData.noDecal = true; this.turret.add(d);
    }
    // running gear: spinning wheels + instanced track links
    this.wheels = [];
    root.traverse(o => {
      const m = /^(wheel|idler|sprocket)_([LR])/.exec(o.name);
      if (m) this.wheels.push({ o, side: m[2], r: m[1] === 'wheel' ? WR : m[1] === 'idler' ? IDLER[2] : SPROCKET[2] });
    });
    const link = root.getObjectByName('link');
    this.tracks = [];
    if (link) {
      link.parent.remove(link);
      for (const side of ['L', 'R']) {
        const im = new THREE.InstancedMesh(link.geometry, link.material, TRACK.pairs);
        im.castShadow = im.receiveShadow = true; im.frustumCulled = false;
        root.add(im);
        this.tracks.push({ side, im, x: side === 'L' ? TX : -TX, off: Math.random() * PAIR });
      }
      this.animateTracks(0, 0);
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.6, 3.9, 48), new THREE.MeshBasicMaterial({
      color: game.cfg.TEAMS[team].color, transparent: true, opacity: isPlayer ? .55 : .3, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = .04; ring.userData.noDecal = true; root.add(ring); this.ring = ring;
    game.scene.add(root);
    this.samples = this.footprint();
    this.sync();
  }

  footprint() {
    const { hw, hl } = this.spec.hull, pts = [];
    for (let z = -hl; z <= hl + 1e-6; z += .5) pts.push([-hw, z], [hw, z]);
    for (let x = -hw + .5; x < hw; x += .5) pts.push([x, -hl], [x, hl]);
    pts.push([-hw, hl], [hw, hl], [-hw, -hl], [hw, -hl]);
    return pts;
  }

  // does the hull at (x, z, h) overlap walls, water or another tank?
  blocked(x, z, h, ignore = null) {
    const w = this.g.world;
    for (const [lx, lz] of this.samples) {
      const [dx, dz] = toWorld(lx, lz, h);
      if (w.blocksMove(x + dx, z + dz)) return true;
    }
    return this.tankAt(x, z, h, ignore);
  }

  tankAt(x, z, h, ignore = null) {
    for (const o of this.g.tanks) {
      if (o === this || o === ignore || (!o.alive && !o.wreck)) continue;
      if (Math.hypot(o.x - x, o.z - z) > 8) continue;
      const { hw, hl } = o.spec.hull;
      for (const [lx, lz] of this.samples) {
        const [dx, dz] = toWorld(lx, lz, h);
        const [ox, oz] = toLocal(x + dx - o.x, z + dz - o.z, o.heading);
        if (Math.abs(ox) < hw && Math.abs(oz) < hl) return o;
      }
    }
    return null;
  }

  blockedWorld(x, z, h) {
    const w = this.g.world;
    for (const [lx, lz] of this.samples) { const [dx, dz] = toWorld(lx, lz, h); if (w.blocksMove(x + dx, z + dz)) return true; }
    return false;
  }

  overlaps(o) {
    const { hw, hl } = o.spec.hull;
    for (const [lx, lz] of this.samples) {
      const [dx, dz] = toWorld(lx, lz, this.heading);
      const [ox, oz] = toLocal(this.x + dx - o.x, this.z + dz - o.z, o.heading);
      if (Math.abs(ox) < hw && Math.abs(oz) < hl) return true;
    }
    return false;
  }

  // shove another tank or wreck: heavier resistance for live tanks, off-centre pushes rotate it
  push(o, dx, dz, dt) {
    const give = o.alive ? .35 : .65;
    const px = dx * give, pz = dz * give;
    const rx = this.x - o.x, rz = this.z - o.z;
    const turn = clamp(-(rx * pz - rz * px) * .025, -.25 * dt, .25 * dt);
    if (o.blocked(o.x + px, o.z + pz, o.heading + turn, this)) return false;
    o.x += px; o.z += pz; o.heading += turn; o.sync();
    if (this.blocked(this.x + px, this.z + pz, this.heading, o)) return false;
    this.x += px; this.z += pz;
    const cap = this.spec.maxSpeed * (o.alive ? .2 : .4);
    this.v = clamp(this.v, -cap, cap);
    if (!o.alive && Math.random() < dt * 3) this.g.fx.dust(o.x, o.z, .8);
    this.g.pushT = this.isPlayer ? .2 : this.g.pushT;
    return true;
  }

  get turretWorldYaw() { return this.heading + this.turretYaw; }

  update(dt) {
    if (!this.alive) return;
    if (this.puppet) return this.puppetUpdate(dt);
    const s = this.spec, c = this.controls;
    // drive
    for (const k in this.mod) if (this.mod[k] > 0) {
      this.mod[k] -= dt;
      if (this.mod[k] <= 0) { this.mod[k] = 0; if (this.isPlayer) this.g.hud.message(this.g.cfg.MODULES[k].done, 'info'); }
    }
    const engineDead = this.mod.engine !== 0, broken = this.mod.track !== 0;
    let wet = 0;
    for (const [lx, lz] of this.samples) { const [dx, dz] = toWorld(lx, lz, this.heading); if (this.g.world.isWater(this.x + dx, this.z + dz)) wet++; }
    const wetF = wet / this.samples.length, inWater = wetF > .5, wf = 1 - .67 * wetF;
    this.spinning = false;
    let target = c.throttle > 0 ? s.maxSpeed * wf * c.throttle : c.throttle < 0 ? s.reverse * wf * c.throttle : 0;
    if (broken || engineDead) target = 0;
    const rate = (Math.sign(target) !== Math.sign(this.v) && this.v !== 0) || target === 0 ? s.brake : s.accel;
    this.v += clamp(target - this.v, -rate * dt, rate * dt);
    const dh = engineDead ? 0 : c.turn * s.turnRate * dt * (broken ? .6 : 1) * (inWater ? .6 : 1) * (1 - .35 * Math.abs(this.v) / s.maxSpeed);
    const h0 = this.heading;
    const nh = this.heading + dh;
    const nx = this.x + Math.sin(nh) * this.v * dt, nz = this.z + Math.cos(nh) * this.v * dt;
    const hit = this.blocked(nx, nz, nh);
    if (!hit) { this.x = nx; this.z = nz; this.heading = nh; }
    else if (hit !== true && Math.abs(this.v) > .01 && this.push(hit, nx - this.x, nz - this.z, dt)) { this.heading = nh; }
    else {
      // blocked: turn if that is free, then scrape along the wall with the part of the motion that fits
      if (dh && !this.blocked(this.x, this.z, nh)) this.heading = nh;
      const mx = Math.sin(this.heading) * this.v * dt, mz = Math.cos(this.heading) * this.v * dt;
      let slid = false;
      for (const [ax, az] of [[mx, mz], [mx * .55, 0], [0, mz * .55]]) {
        if (Math.abs(ax) + Math.abs(az) < 1e-6 || this.blocked(this.x + ax, this.z + az, this.heading)) continue;
        this.x += ax; this.z += az; slid = true; break;
      }
      if (slid) this.v *= Math.pow(.5, dt);           // friction against the wall
      else {
        if (Math.abs(this.v) > 2 && this.isPlayer) this.g.sfx.bump();
        this.v = 0; this.spinning = c.throttle !== 0 && !engineDead && !broken;   // tracks keep turning in place
      }
    }
    const moved = Math.abs(this.v * dt);
    // turret follows the aim point at a limited traverse speed
    const [tx, tz] = this.turretPos();
    const want = wrap(Math.atan2(c.aim.x - tx, c.aim.z - tz) - this.heading);
    const diff = wrap(want - this.turretYaw), step = this.mod.turret !== 0 ? 0 : s.turretRate * dt;
    this.turretYaw = wrap(this.turretYaw + clamp(diff, -step, step) - dh * 0);
    const flat = Math.hypot(c.aim.x - tx, c.aim.z - tz);
    this.pitch = clamp(Math.atan2(c.aim.y - s.gunPivot[1] - s.turret.pivot[1], flat), s.depression, s.elevation);
    // reload / fire
    this.reload = Math.max(0, this.reload - dt);
    if (this.shield > 0) this.shield -= dt;
    if (c.fire && this.reload === 0) this.fire();
    this.spinDir = this.spinning ? Math.sign(c.throttle) : 0;
    this.visuals(dt, moved, dh, h0, wetF, engineDead, broken);
  }

  // online guest: glide toward the host's latest state, then run the same visuals as a simulated tank
  puppetUpdate(dt) {
    const n = this.net;
    if (!n) return;
    const h0 = this.heading, x0 = this.x, z0 = this.z;
    if (Math.hypot(n.x - this.x, n.z - this.z) > 6) { this.x = n.x; this.z = n.z; this.heading = n.h; }
    const k = 1 - Math.exp(-dt * 14);
    this.x += (n.x - this.x) * k; this.z += (n.z - this.z) * k;
    this.heading += wrap(n.h - this.heading) * k;
    this.turretYaw = wrap(this.turretYaw + wrap(n.ty - this.turretYaw) * k);
    this.pitch += (n.p - this.pitch) * k;
    let wet = 0;
    for (const [lx, lz] of this.samples) { const [dx, dz] = toWorld(lx, lz, this.heading); if (this.g.world.isWater(this.x + dx, this.z + dz)) wet++; }
    if (this.shield > 0) this.shield -= dt;
    this.visuals(dt, Math.hypot(this.x - x0, this.z - z0), wrap(this.heading - h0), h0, wet / this.samples.length, this.mod.engine !== 0, this.mod.track !== 0);
  }

  // host state for a puppet: [x, z, heading, v, turretYaw, pitch, hp, reload, ammo(0 AP/1 HE), shield, spinDir, modT, modK, modE, trackSide(0 L/1 R)]
  applyNet(a) {
    this.net = { x: a[0], z: a[1], h: a[2], ty: a[4], p: a[5] };
    this.v = a[3]; this.hp = a[6]; this.reload = a[7]; this.ammo = a[8] ? 'HE' : 'AP'; this.shield = a[9]; this.spinDir = a[10];
    const was = { ...this.mod };
    this.mod.turret = a[11]; this.mod.track = a[12]; this.mod.engine = a[13]; this.trackSide = a[14] ? 'R' : 'L';
    if (this.isPlayer) for (const k in this.mod) if (was[k] > 0 && this.mod[k] === 0) this.g.hud.message(this.g.cfg.MODULES[k].done, 'info');
  }
  netState() {
    const r = v => Math.round(v * 1000) / 1000;
    return [r(this.x), r(this.z), r(this.heading), r(this.v), r(this.turretYaw), r(this.pitch), Math.round(this.hp), r(this.reload),
      this.ammo === 'HE' ? 1 : 0, r(this.shield), this.spinDir || 0, r(this.mod.turret), r(this.mod.track), r(this.mod.engine), this.trackSide === 'R' ? 1 : 0];
  }

  // marks, sinking and tilting in water, dust, wake, rolling tracks, engine smoke (simulated and puppet tanks alike)
  visuals(dt, moved, dh, h0, wetF, engineDead, broken) {
    const s = this.spec, inWater = wetF > .5, spin = this.spinDir || 0;
    this.spinning = spin !== 0;
    if (this.shield > 0 || this.ringFlash) { this.ringFlash = this.shield > 0; this.ring.material.opacity = this.shield > 0 ? .35 + .3 * Math.sin(this.g.time * 12) : (this.isPlayer ? .55 : .3); }
    this.recoil = Math.max(0, this.recoil - dt * 2.2);
    // ground marks and dust
    this.trackDist += wetF > .3 ? 0 : moved;
    // the parts standing in water sink; front/rear and left/right difference tilts the hull (no sinking into the bank)
    const q = { f: 0, r: 0, l: 0, rt: 0, nf: 0, nr: 0, nl: 0, nrt: 0 };
    for (const [lx, lz] of this.samples) {
      const [dx, dz] = toWorld(lx, lz, this.heading), wv = this.g.world.isWater(this.x + dx, this.z + dz) ? 1 : 0;
      if (lz > 0) { q.f += wv; q.nf++; } else { q.r += wv; q.nr++; }
      if (lx > 0) { q.l += wv; q.nl++; } else { q.rt += wv; q.nrt++; }
    }
    const k = Math.min(1, dt * 3), D = .45;
    this.sinkF += (D * q.f / q.nf - this.sinkF) * k; this.sinkR += (D * q.r / q.nr - this.sinkR) * k;
    this.sinkL += (D * q.l / q.nl - this.sinkL) * k; this.sinkRt += (D * q.rt / q.nrt - this.sinkRt) * k;
    this.sink = (this.sinkF + this.sinkR) / 2;
    if (this.spinning && (this.dustT -= dt) < 0) {
      this.dustT = .07;
      for (const side of [-1.34, 1.34]) { const [dx, dz] = toWorld(side, -spin * 2.9, this.heading); this.g.fx.dust(this.x + dx, this.z + dz, 1); }
    }
    if (inWater && (Math.abs(this.v) > .5 || Math.abs(dh) > .001) && (this.wakeT -= dt) < 0) { this.wakeT = .1; this.g.fx.wake(this); }
    if (this.trackDist > .45) { this.trackDist = 0; this.g.fx.trackMark(this); }
    this.dustT -= dt;
    if (Math.abs(this.v) > 3 && this.dustT < 0 && !inWater) {
      this.dustT = .12;
      const [dx, dz] = toWorld(rand(-1.4, 1.4), -Math.sign(this.v) * 3.2, this.heading);
      this.g.fx.dust(this.x + dx, this.z + dz, Math.abs(this.v) / s.maxSpeed);
    }
    // tracks and wheels roll with each side's ground speed
    const drive = this.spinning ? spin * s.maxSpeed * .6 : moved / dt * Math.sign(this.v);
    const w = wrap(this.heading - h0) / dt, vL = drive - w * TX, vR = drive + w * TX;
    this.trackV = (Math.abs(vL) + Math.abs(vR)) / 2; this.turnW = Math.abs(w);          // for the sound
    this.animateTracks(broken && this.trackSide === 'L' ? 0 : vL * dt, broken && this.trackSide === 'R' ? 0 : vR * dt);
    if (engineDead && (this.smokeT -= dt) < 0) {
      // burning engine deck: thick black smoke, now and then a lick of flame
      this.smokeT = .09; const [dx, dz] = toWorld(rand(-.6, .6), -2.1, this.heading);
      const p = new THREE.Vector3(this.x + dx, 1.7, this.z + dz);
      this.g.fx.sprite('smoke', p, { size: rand(1.2, 2), life: rand(3, 4.5), v: new THREE.Vector3(rand(.2, .8), rand(1.8, 2.8), rand(-.3, .3)), grow: 2.4, opacity: .75, color: 0x1e1c1a, drag: .99 });
      if (Math.random() < .25) this.g.fx.sprite('fire', p, { size: rand(.6, 1.1), life: rand(.2, .4), v: new THREE.Vector3(0, 1.5, 0) });
    }
    this.sync();
  }

  // advance each side by its travelled distance: links slide along the path, wheels spin
  animateTracks(dL, dR) {
    for (const tr of this.tracks) {
      const d = tr.side === 'L' ? dL : dR;
      tr.off = ((tr.off - d) % TRACK.L + TRACK.L) % TRACK.L;
      for (let k = 0; k < TRACK.pairs; k++) {
        const i = Math.floor(((k * TRACK.step + tr.off) % TRACK.L) / TRACK.L * TRACK.N) % TRACK.N;
        _m.makeRotationX(TRACK.A[i]); _m.setPosition(tr.x, TRACK.Y[i], TRACK.Z[i]);
        tr.im.setMatrixAt(k, _m);
      }
      tr.im.instanceMatrix.needsUpdate = true;
    }
    for (const wl of this.wheels) wl.o.rotation.x += (wl.side === 'L' ? dL : dR) / wl.r;
  }

  turretPos() {
    const p = this.spec.turret.pivot, [dx, dz] = toWorld(p[0], p[2], this.heading);
    return [this.x + dx, this.z + dz];
  }

  sync() {
    this.root.position.set(this.x, -this.sink, this.z);
    // half-centres are ~3.1 m apart lengthwise and ~1.6 m sideways; the hull pivots about its middle
    this.root.rotation.set(Math.atan2(this.sinkF - this.sinkR, 6.2), this.heading, -Math.atan2(this.sinkL - this.sinkRt, 3.2), 'YXZ');
    this.turret.rotation.y = this.turretYaw;
    this.gun.rotation.x = -this.pitch;
    this.gun.position.copy(this.gunBase).z -= Math.sin(Math.min(1, this.recoil) * Math.PI) * .35 * (this.recoil > 0 ? 1 : 0);
  }

  muzzle() {
    this.root.updateMatrixWorld(true);
    const p = this.gun.localToWorld(new THREE.Vector3(0, 0, this.spec.muzzle));
    const yaw = this.turretWorldYaw, cp = Math.cos(this.pitch);
    const dir = new THREE.Vector3(Math.sin(yaw) * cp, Math.sin(this.pitch), Math.cos(yaw) * cp);
    return { p, dir };
  }

  fire() {
    const { p, dir } = this.muzzle();
    this.reload = this.spec.reload; this.recoil = 1;
    this.g.stat(this, 'shots');
    const sid = this.g.combat.spawn(this, p, dir, this.ammo);
    this.g.net?.event('shot', { id: this.id, sid, p: [p.x, p.y, p.z].map(v => Math.round(v * 1000) / 1000), d: [dir.x, dir.y, dir.z].map(v => Math.round(v * 10000) / 10000), type: this.ammo });
    this.g.fx.muzzle(p, dir);
    this.g.sfx.shot(this.g.hearing(p), this.isPlayer);
    if (this.isPlayer) this.g.shake(.35);
    this.v -= .6 * Math.cos(this.turretYaw);
  }

  // shell segment o + d*t (t <= len) vs hull/turret proxies; returns nearest hit in world space
  raycast(o, d, len) {
    const s = this.spec, h = this.heading;
    const [lox, loz] = toLocal(o.x - this.x, o.z - this.z, h), [ldx, ldz] = toLocal(d.x, d.z, h);
    let best = null;
    const oy = o.y + this.sink;
    for (const part of s.hullParts) {
      const hb = rayBox([lox, oy, loz], [ldx, d.y, ldz], part.min, part.max, len);
      if (hb && (!best || hb.t < best.t)) best = { ...hb, part, dir: [ldx, d.y, ldz] };
    }
    const P = s.turret.pivot, ty = this.turretYaw;
    const [tox, toz] = toLocal(lox - P[0], loz - P[2], ty), [tdx, tdz] = toLocal(ldx, ldz, ty);
    const tb = rayBox([tox, oy - P[1], toz], [tdx, d.y, tdz], [-s.turret.hw, 0, -s.turret.rear], [s.turret.hw, s.turret.h, s.turret.front], len);
    if (tb && (!best || tb.t < best.t)) best = { ...tb, part: TURRET_PART(s), dir: [tdx, d.y, tdz] };
    for (const part of s.turretParts || []) {
      const hb = rayBox([tox, oy - P[1], toz], [tdx, d.y, tdz], part.min, part.max, len);
      if (hb && (!best || hb.t <= best.t + .02)) best = { ...hb, part, dir: [tdx, d.y, tdz] };
    }
    if (!best) return null;
    const face = best.axis === 1 ? (best.sign > 0 ? 'top' : 'bottom') : best.axis === 0 ? 'side' : (best.sign > 0 ? 'front' : 'rear');
    const cos = Math.abs(best.dir[best.axis]);
    return { t: best.t, region: best.part.region, part: best.part, face, cos, point: o.clone().addScaledVector(d, best.t) };
  }

  // armour check; returns {result: 'pen'|'nopen'|'rico', dmg, eff}
  takeHit(shell, hit, dist) {
    if (this.shield > 0) return { result: 'nopen', dmg: 0, eff: 999 };
    if (hit.region === 'track') {
      // the track and road wheels take the shell: little reaches the hull, the track usually breaks
      const dmg = rand(...shell.spec.dmg) * (shell.type === 'HE' ? .25 : .12);
      let module = null;
      if (Math.random() < .75) { module = 'track'; this.mod.track = -1; this.trackSide = hit.part.side; }
      this.damage(dmg, shell.owner);
      return { result: 'track', dmg: Math.round(dmg), eff: 20, module };
    }
    const base = hit.part.armor[hit.face];
    if (shell.type === 'AP' && hit.cos < .34 && hit.face !== 'top') return { result: 'rico', dmg: 0, eff: base };
    const eff = base / Math.max(hit.cos, .2);
    const pen = shell.spec.pen * (1 - Math.min(dist, 300) / 1500) * rand(.9, 1.1);
    let dmg = 0, result = 'nopen', rack = false;
    if (pen >= eff) {
      result = 'pen'; dmg = rand(...shell.spec.dmg);
      if (shell.type === 'AP' && Math.random() < .06) { dmg = this.hp; rack = true; }
    } else if (shell.type === 'HE') dmg = rand(...shell.spec.splashDmg);
    // module damage on penetration: turret ring, tracks (low side hits), engine (rear)
    let module = null;
    if (result === 'pen' && !rack) {
      const r = Math.random();
      if (hit.region === 'turret' && r < .45) module = 'turret';
      else if (hit.region !== 'turret' && (hit.face === 'rear' ? r < .6 : r < .15)) module = 'engine';
      if (module) this.mod[module] = -1;
    }
    this.damage(dmg, shell.owner);
    return { result, dmg: Math.round(dmg), eff: Math.round(eff), rack, module };
  }

  // crew starts repairing every broken module (they repair in parallel)
  repair() {
    let any = false;
    for (const k in this.mod) if (this.mod[k] === -1) { this.mod[k] = this.g.cfg.MODULES[k].repair; any = true; }
    return any;
  }

  // leave a mark where a shell struck: a hole for a penetration, a bright gouge otherwise
  addDecal(point, dir, kind) {
    this.root.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(point.clone().addScaledVector(dir, -1.6), dir.clone().normalize(), 0, 4);
    const hit = ray.intersectObject(this.root, true).find(h => h.object.isMesh && !h.object.isInstancedMesh && !h.object.userData.noDecal);
    if (!hit) return;
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    const helper = new THREE.Object3D(); helper.position.copy(hit.point); helper.lookAt(hit.point.clone().add(n));
    helper.rotation.z = Math.random() * 6.28;
    const size = kind === 'hole' ? .55 : .75;
    const geo = new DecalGeometry(hit.object, hit.point, helper.rotation, new THREE.Vector3(size, size, size));
    geo.applyMatrix4(hit.object.matrixWorld.clone().invert());
    const m = new THREE.Mesh(geo, decalMaterial(kind)); m.userData.noDecal = m.userData.hitDecal = true;
    hit.object.add(m); this.decals.push(m);
    if (this.decals.length > 24) { const old = this.decals.shift(); old.parent.remove(old); old.geometry.dispose(); }
  }

  damage(dmg, by) {
    if (!this.alive || dmg <= 0) return;
    if (by && by !== this && by.team !== this.team) this.g.stat(by, 'dmg', Math.min(this.hp, dmg));
    this.hp = Math.max(0, this.hp - dmg); this.lastHitBy = by;
    if (this.hp === 0) this.destroy(by);
  }

  destroy(by) {
    this.alive = false; this.wreck = true; this.v = 0;
    this.g.net?.event('kill', { id: this.id, by: by?.id ?? 0 });
    this.g.onKill(this, by);
    this.root.traverse(o => {
      if (o.isMesh && o !== this.ring && !o.userData.hitDecal) { o.material.color.setRGB(.16, .14, .13); o.material.roughness = 1; o.material.metalness = .2; }
    });
    this.ring.visible = false;
    this.turretYaw += rand(-.8, .8); this.turret.rotation.z = rand(-.15, .15); this.turret.position.y += .12;
    this.sync();
    const p = new THREE.Vector3(this.x, 1.5, this.z);
    this.g.fx.explosion(p, 1.6); this.g.fx.burn(p, 14);
    this.g.sfx.boom(this.g.hearing(p), true);
    this.g.later(this.g.cfg.GAME.wreckLife, () => this.removeWreck());
  }

  removeWreck() {
    this.wreck = false; this.g.scene.remove(this.root);
  }
}
