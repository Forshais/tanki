import * as THREE from 'three';
import { C } from './map.js';
import { rand, rayBox } from './util.js';

const STEP = .4;

export class Combat {
  constructor(game) {
    this.g = game; this.shells = []; this.nextId = 1;
    this.tracerGeo = new THREE.CylinderGeometry(.06, .02, 3.2, 6).rotateX(Math.PI / 2).translate(0, 0, -1.6);
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: .85, blending: THREE.AdditiveBlending, depthWrite: false });
  }

  // visual = an online guest's copy: it flies and bursts on walls and ground, but tank hits, damage
  // and destroyed bricks come from the host
  spawn(owner, p, dir, type, id = null, visual = false) {
    const spec = this.g.cfg.SHELLS[type];
    const mesh = new THREE.Mesh(this.tracerGeo, this.tracerMat);
    mesh.position.copy(p); mesh.lookAt(p.clone().add(dir));
    this.g.scene.add(mesh);
    const sid = id ?? this.nextId++;
    this.shells.push({ id: sid, owner, type, spec, p: p.clone(), d: dir.clone().normalize(), dist: 0, mesh, visual });
    return sid;
  }

  remove(id) {
    const k = this.shells.findIndex(s => s.id === id);
    if (k >= 0) { this.g.scene.remove(this.shells[k].mesh); this.shells.splice(k, 1); }
  }

  update(dt) {
    for (let k = this.shells.length - 1; k >= 0; k--) {
      const s = this.shells[k];
      let left = s.spec.speed * dt, done = false;
      while (left > 0 && !done) {
        const len = Math.min(STEP, left); left -= len;
        done = this.advance(s, len);
      }
      if (done || s.dist > 240) { this.g.scene.remove(s.mesh); this.shells.splice(k, 1); continue; }
      s.mesh.position.copy(s.p);
    }
  }

  // move one sub-step; returns true when the shell is spent
  advance(s, len) {
    let hit = null;
    if (!s.visual) for (const t of this.g.tanks) {
      if (t === s.owner || (!t.alive && !t.wreck)) continue;
      if (Math.hypot(t.x - s.p.x, t.z - s.p.z) > 6) continue;
      const h = t.raycast(s.p, s.d, len);
      if (h && (!hit || h.t < hit.t)) hit = { ...h, tank: t };
    }
    // the golden eagle itself (the plinth around it only stops shells)
    for (const b of Object.values(this.g.world.bases)) {
      if (!b.alive || Math.hypot(b.x - s.p.x, b.z - s.p.z) > 5) continue;
      const e = rayBox([s.p.x - b.x, s.p.y, s.p.z - b.z], [s.d.x, s.d.y, s.d.z], [-1.15, 1.6, -.6], [1.15, 3.1, .6], len);
      if (e && (!hit || e.t < hit.t)) {
        const p = s.p.clone().addScaledVector(s.d, e.t);
        if (s.visual) this.g.fx.impact(p, 1.1); else this.eagle(s, p, b);
        return true;
      }
    }
    const n = s.p.clone().addScaledVector(s.d, hit ? hit.t : len);
    const w = this.g.world, cell = w.atXZ(n.x, n.z);
    if (!hit && n.y < w.wallHeight(n.x, n.z)) { this.wall(s, n, cell); return true; }
    if (!hit && n.y <= .05) { this.ground(s, n); return true; }
    s.dist += hit ? hit.t : len; s.p.copy(n);
    if (hit) { this.tankHit(s, hit); return true; }
    return false;
  }

  wall(s, p, cell) {
    const fx = this.g.fx, sfx = this.g.sfx, w = this.g.world, ear = this.g.hearing(p);
    if (cell === C.BRICK) {
      if (!s.visual) w.destroyBricks(p.x, p.z, s.spec.brickR);
      fx.impact(p, s.type === 'HE' ? 1.2 : .7); sfx.brick(ear); this.g.shake(.25 * ear);
    } else if (cell === C.BASE) {
      fx.sparks(p, s.d, 10); fx.dirt(p, .6); sfx.thud(ear);
    } else {
      fx.sparks(p, s.d, 14); sfx.rico(ear);
      if (s.type === 'HE') fx.impact(p, .8);
    }
    if (s.type === 'HE') this.splash(s, p);
  }

  eagle(s, p, b) {
    this.g.fx.impact(p, 1.1); this.g.sfx.boom(this.g.hearing(p), false);
    this.g.baseHit(b, s.owner);
    if (s.type === 'HE') this.splash(s, p);
  }

  ground(s, p) {
    if (this.g.world.atXZ(p.x, p.z) === C.WATER) { this.g.fx.splash(p); this.g.sfx.thud(this.g.hearing(p) * .6); return; }
    this.g.fx.dirt(p, s.type === 'HE' ? 1.2 : .6);
    if (s.type === 'HE') { this.g.fx.scorch(p.x, p.z, 1.6); this.splash(s, p); }
    this.g.sfx.thud(this.g.hearing(p));
  }

  splash(s, p) {
    if (s.visual) return;
    this.g.world.destroyBricks(p.x, p.z, s.spec.brickR * .7);
    for (const t of this.g.tanks) {
      if (!t.alive) continue;
      const d = Math.hypot(t.x - p.x, t.z - p.z);
      if (d < s.spec.splash + 2) t.damage(rand(...s.spec.splashDmg) * (1 - d / (s.spec.splash + 2)), s.owner);
    }
  }

  tankHit(s, hit) {
    const t = hit.tank, net = this.g.net;
    if (!t.alive) {
      net?.event('hit', { sid: s.id, id: t.id, by: s.owner?.id ?? 0, type: s.type, p: hit.point.toArray(), d: s.d.toArray(), r: null });
      return this.hitFx(t, s.d, hit.point, s.type, null);
    }
    const r = t.takeHit(s, hit, s.dist);
    // the kill (if any) was already announced from takeHit, so guests see the same order as here
    net?.event('hit', { sid: s.id, id: t.id, by: s.owner?.id ?? 0, type: s.type, p: hit.point.toArray(), d: s.d.toArray(),
      r, label: hit.part ? hit.part.label : '', face: hit.face });
    this.hitFx(t, s.d, hit.point, s.type, r);
    this.g.onHit(s.owner, t, r, hit);
  }

  // sparks, sounds and the decal of a shell striking a tank (r = null: a wreck)
  hitFx(t, d, point, type, r) {
    const fx = this.g.fx, ear = this.g.hearing(point);
    if (!r) { fx.sparks(point, d, 10); this.g.sfx.rico(ear); t.addDecal(point, d, 'scrape'); return; }
    if (r.result === 'pen' || r.result === 'track') {
      fx.sparks(point, d, 22); fx.impact(point, .8); this.g.sfx.pen(ear);
    } else {
      fx.sparks(point, d.clone().reflect(new THREE.Vector3(0, 1, 0)), r.result === 'rico' ? 18 : 10);
      this.g.sfx.rico(ear);
      if (type === 'HE') fx.impact(point, 1);
    }
    if (type === 'HE') fx.scorch(point.x, point.z, 1.2);
    t.addDecal(point, d, r.result === 'pen' ? 'hole' : 'scrape');
  }
}
