import * as THREE from 'three';
import { canvasTex, rng, rand, toWorld } from './util.js';

function blobTex(seed, colors, additive) {
  return canvasTex(128, 128, (g) => {
    const r = rng(seed);
    for (let k = 0; k < 40; k++) {
      const x = 64 + (r() - .5) * 60, y = 64 + (r() - .5) * 60, s = 10 + r() * 26;
      const gr = g.createRadialGradient(x, y, 0, x, y, s);
      const c = colors[k % colors.length];
      gr.addColorStop(0, `rgba(${c},${additive ? .45 : .28})`); gr.addColorStop(1, `rgba(${c},0)`);
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    }
  });
}

export class FX {
  constructor(game) {
    this.g = game; const scene = game.scene;
    this.tex = {
      smoke: blobTex(3, ['200,200,200', '170,170,170'], false),
      fire: blobTex(8, ['255,235,180', '255,150,40', '230,80,20'], true),
      glow: canvasTex(64, 64, g => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.3, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }),
    };
    this.parts = [];
    this.pool = [];
    // debris chunks (instanced, simple physics)
    this.chunkMax = 500;
    this.chunks = new THREE.InstancedMesh(new THREE.BoxGeometry(.22, .14, .18), new THREE.MeshStandardMaterial({ color: 0x8a4a32, roughness: .9 }), this.chunkMax);
    this.chunks.castShadow = true; this.chunks.frustumCulled = false; this.chunkList = []; scene.add(this.chunks);
    this.chunks.count = 0;
    // track marks
    this.markMax = 5000; this.markN = 0;
    this.marks = new THREE.InstancedMesh(new THREE.PlaneGeometry(.52, .5).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x2a2418, transparent: true, opacity: .28, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }), this.markMax);
    this.marks.count = 0; this.marks.renderOrder = 1; this.marks.frustumCulled = false; scene.add(this.marks);
    // scorch marks
    this.scorchMax = 300; this.scorchN = 0;
    const st = canvasTex(128, 128, g => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(15,12,10,.85)'); gr.addColorStop(.6, 'rgba(25,20,15,.45)'); gr.addColorStop(1, 'rgba(25,20,15,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); });
    this.scorches = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: st, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), this.scorchMax);
    this.scorches.count = 0; this.scorches.renderOrder = 2; this.scorches.frustumCulled = false; scene.add(this.scorches);
    // a few re-used point lights for flashes
    this.lights = Array.from({ length: 4 }, () => { const l = new THREE.PointLight(0xffa040, 0, 0, 2); scene.add(l); return { l, t: 0, max: 0, dur: 1 }; });
    this.li = 0;
    this.burners = [];
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler();
  }

  sprite(kind, p, o) {
    let s = this.pool.pop();
    if (!s) { s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false })); }
    const add = kind === 'fire' || kind === 'glow' || kind === 'spark';
    s.material.map = this.tex[kind === 'spark' ? 'glow' : kind === 'dust' ? 'smoke' : kind];
    s.material.blending = add ? THREE.AdditiveBlending : THREE.NormalBlending;
    s.material.color.set(o.color ?? 0xffffff); s.material.rotation = Math.random() * 6.28;
    s.material.opacity = o.opacity ?? 1; s.material.needsUpdate = true;
    s.position.copy(p); s.scale.setScalar(o.size);
    this.g.scene.add(s);
    this.parts.push({ s, v: o.v || new THREE.Vector3(), life: o.life, max: o.life, size: o.size, grow: o.grow ?? 0, op: o.opacity ?? 1, grav: o.grav ?? 0, drag: o.drag ?? 1 });
  }

  flash(p, intensity, dur, color = 0xffa040) {
    const L = this.lights[this.li++ % this.lights.length];
    L.l.position.copy(p); L.l.color.set(color); L.t = dur; L.dur = dur; L.max = intensity;
  }

  muzzle(p, dir) {
    for (let k = 0; k < 3; k++) this.sprite('fire', p.clone().addScaledVector(dir, k * .7), { size: 2.4 - k * .5, life: .09, opacity: 1 });
    this.sprite('glow', p, { size: 4, life: .07, color: 0xffd08a });
    for (let k = 0; k < 6; k++) {
      const v = dir.clone().multiplyScalar(rand(2, 6)).add(new THREE.Vector3(rand(-1, 1), rand(.3, 1.2), rand(-1, 1)));
      this.sprite('smoke', p, { size: rand(1.2, 2), life: rand(1.2, 2.2), v, grow: 1.6, opacity: .55, color: 0xb8b2a8, drag: .92 });
    }
    this.flash(p, 160, .12);
  }

  impact(p, size) {
    this.sprite('glow', p, { size: 5 * size, life: .12, color: 0xffb060 });
    for (let k = 0; k < 6; k++) this.sprite('fire', p.clone().add(new THREE.Vector3(rand(-.4, .4), rand(0, .5), rand(-.4, .4)).multiplyScalar(size)), { size: rand(1.2, 2.2) * size, life: rand(.15, .3) });
    for (let k = 0; k < 8; k++) this.sprite('smoke', p, { size: rand(1.4, 2.4) * size, life: rand(1.5, 3), v: new THREE.Vector3(rand(-1.5, 1.5), rand(.8, 2.2), rand(-1.5, 1.5)), grow: 1.4, opacity: .7, color: 0x6e6a64, drag: .95 });
    this.flash(p, 120 * size, .18);
  }

  explosion(p, size) {
    this.g.shake(1.1 * this.g.hearing(p));
    this.impact(p, size * 1.4);
    for (let k = 0; k < 16; k++) this.sprite('fire', p, { size: rand(2, 3.5) * size, life: rand(.3, .7), v: new THREE.Vector3(rand(-4, 4), rand(2, 7), rand(-4, 4)), grow: .8, drag: .9 });
    for (let k = 0; k < 18; k++) this.sprite('smoke', p, { size: rand(2.5, 4) * size, life: rand(3, 6), v: new THREE.Vector3(rand(-3, 3), rand(2, 5), rand(-3, 3)), grow: 1, opacity: .85, color: 0x3a3632, drag: .96 });
    this.debris(p.x, p.y, p.z, 14, null, 0x252220);
    this.flash(p, 600 * size, .5);
    this.scorch(p.x, p.z, 3.2);
  }

  wake(t) {
    const k = -3.2 * Math.sign(t.v || 1), dx = Math.sin(t.heading) * k, dz = Math.cos(t.heading) * k;
    for (const side of [-1.5, 1.5]) {
      const x = t.x + dx + Math.cos(t.heading) * side, z = t.z + dz - Math.sin(t.heading) * side;
      this.sprite('smoke', new THREE.Vector3(x, .15, z), { size: rand(.6, 1.1), life: rand(.5, .9), v: new THREE.Vector3(rand(-.8, .8), rand(1.5, 3), rand(-.8, .8)), grav: 9, grow: .8, opacity: .65, color: 0xdcecf0 });
    }
    this.sprite('smoke', new THREE.Vector3(t.x - dx * .3, .1, t.z - dz * .3), { size: rand(2.5, 3.5), life: 1.4, grow: 1.2, opacity: .25, color: 0xcfe4ea });
  }

  splash(p) {
    for (let k = 0; k < 14; k++) this.sprite('smoke', new THREE.Vector3(p.x, .1, p.z), { size: rand(.6, 1.3), life: rand(.6, 1.2), v: new THREE.Vector3(rand(-1.2, 1.2), rand(4, 9), rand(-1.2, 1.2)), grav: 16, grow: .6, opacity: .8, color: 0xd8ecf2 });
    for (let k = 0; k < 6; k++) this.sprite('smoke', new THREE.Vector3(p.x, .2, p.z), { size: rand(1.5, 2.5), life: rand(.8, 1.4), v: new THREE.Vector3(rand(-2, 2), rand(.3, 1), rand(-2, 2)), grow: 1.4, opacity: .5, color: 0xbcd6de });
  }

  burn(p, seconds) { this.burners.push({ p: p.clone(), until: this.g.time + seconds, t: 0 }); }

  sparks(p, dir, n) {
    for (let k = 0; k < n; k++) {
      const v = dir.clone().multiplyScalar(-rand(2, 8)).add(new THREE.Vector3(rand(-6, 6), rand(1, 7), rand(-6, 6)));
      this.sprite('spark', p, { size: rand(.15, .35), life: rand(.2, .5), v, grav: 14, color: 0xffd27a });
    }
    this.flash(p, 40, .08, 0xffe0a0);
  }

  dirt(p, size) {
    for (let k = 0; k < 8; k++) this.sprite('smoke', p, { size: rand(1, 2) * size, life: rand(1, 2), v: new THREE.Vector3(rand(-1.5, 1.5), rand(1.5, 4), rand(-1.5, 1.5)), grow: 1, opacity: .7, color: 0x8a7656, drag: .93, grav: 2 });
    this.debris(p.x, .2, p.z, 4, null, 0x4a3c2a);
  }

  dust(x, z, k) {
    this.sprite('dust', new THREE.Vector3(x, .5, z), { size: rand(1.4, 2.4), life: rand(1.2, 2), v: new THREE.Vector3(rand(-.4, .4), rand(.3, .8), rand(-.4, .4)), grow: 1.2, opacity: .32 * k, color: 0x9a8a6a });
  }

  debris(x, y, z, n, mat, color = 0x8a4a32) {
    for (let k = 0; k < n; k++) {
      if (this.chunkList.length >= this.chunkMax) this.chunkList.shift();
      this.chunkList.push({ p: new THREE.Vector3(x + rand(-.4, .4), y + rand(0, .6), z + rand(-.4, .4)),
        v: new THREE.Vector3(rand(-4, 4), rand(2, 7), rand(-4, 4)), r: new THREE.Vector3(rand(0, 6), rand(0, 6), 0),
        w: new THREE.Vector3(rand(-8, 8), rand(-8, 8), 0), life: rand(4, 7), s: rand(.6, 1.4), color: new THREE.Color(color).offsetHSL(0, 0, rand(-.06, .06)) });
    }
  }

  trackMark(tank) {
    for (const side of [-1.34, 1.34]) {
      const [dx, dz] = toWorld(side, 0, tank.heading);
      this.m.compose(new THREE.Vector3(tank.x + dx, .02, tank.z + dz), this.q.setFromEuler(this.e.set(0, tank.heading, 0)), new THREE.Vector3(1, 1, 1));
      this.marks.setMatrixAt(this.markN % this.markMax, this.m); this.markN++;
    }
    this.marks.count = Math.min(this.markN, this.markMax); this.marks.instanceMatrix.needsUpdate = true;
  }

  scorch(x, z, size) {
    this.m.compose(new THREE.Vector3(x, .03, z), this.q.setFromEuler(this.e.set(0, Math.random() * 6, 0)), new THREE.Vector3(size, 1, size));
    this.scorches.setMatrixAt(this.scorchN % this.scorchMax, this.m); this.scorchN++;
    this.scorches.count = Math.min(this.scorchN, this.scorchMax); this.scorches.instanceMatrix.needsUpdate = true;
  }

  update(dt) {
    for (let k = this.parts.length - 1; k >= 0; k--) {
      const P = this.parts[k];
      P.life -= dt;
      if (P.life <= 0) { this.g.scene.remove(P.s); this.pool.push(P.s); this.parts.splice(k, 1); continue; }
      P.v.multiplyScalar(Math.pow(P.drag, dt * 60)); P.v.y -= P.grav * dt;
      P.s.position.addScaledVector(P.v, dt);
      const a = 1 - P.life / P.max;
      P.s.scale.setScalar(P.size * (1 + P.grow * a));
      P.s.material.opacity = P.op * (1 - a) * Math.min(1, a * 8 + .4);
    }
    for (const L of this.lights) { L.t = Math.max(0, L.t - dt); L.l.intensity = L.max * (L.t / L.dur) ** 2; }
    // burning wrecks
    for (let k = this.burners.length - 1; k >= 0; k--) {
      const b = this.burners[k];
      if (this.g.time > b.until) { this.burners.splice(k, 1); continue; }
      b.t -= dt;
      if (b.t < 0) {
        b.t = .08;
        this.sprite('fire', b.p.clone().add(new THREE.Vector3(rand(-.8, .8), rand(0, .6), rand(-.8, .8))), { size: rand(1, 1.8), life: rand(.3, .6), v: new THREE.Vector3(0, rand(1, 2.5), 0) });
        if (Math.random() < .5) this.sprite('smoke', b.p.clone().add(new THREE.Vector3(0, 1, 0)), { size: rand(1.6, 2.6), life: rand(3, 5), v: new THREE.Vector3(rand(.3, 1.2), rand(2, 3.5), rand(-.3, .3)), grow: 2.2, opacity: .7, color: 0x2e2b28, drag: .99 });
      }
    }
    // debris physics
    const m = this.m, q = this.q, e = this.e;
    let n = 0;
    for (let k = this.chunkList.length - 1; k >= 0; k--) {
      const c = this.chunkList[k];
      c.life -= dt;
      if (c.life <= 0) { this.chunkList.splice(k, 1); continue; }
      if (c.p.y > .07 || c.v.y > 0) {
        c.v.y -= 18 * dt; c.p.addScaledVector(c.v, dt); c.r.addScaledVector(c.w, dt);
        if (c.p.y < .07) { c.p.y = .07; c.v.y *= -.3; c.v.x *= .5; c.v.z *= .5; c.w.multiplyScalar(.5); }
      }
      const s = c.s * Math.min(1, c.life);
      m.compose(c.p, q.setFromEuler(e.set(c.r.x, c.r.y, 0)), new THREE.Vector3(s, s, s));
      this.chunks.setMatrixAt(n, m); this.chunks.setColorAt(n, c.color); n++;
    }
    this.chunks.count = n; this.chunks.instanceMatrix.needsUpdate = true;
    if (this.chunks.instanceColor) this.chunks.instanceColor.needsUpdate = true;
  }
}
