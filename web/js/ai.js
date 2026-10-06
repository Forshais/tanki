import { C, TW, TH } from './map.js';
import { wrap, clamp, rand } from './util.js';

// Path nodes are the 2 m tiles. A node is drivable when the 4x4 m area around it has no steel, water or base;
// bricks are allowed at a high cost (the bot shoots its way through).
function nodeCost(world, ti, tj) {
  let brick = 0, water = 0;
  for (let j = tj * 2 - 1; j <= tj * 2 + 2; j++) for (let i = ti * 2 - 1; i <= ti * 2 + 2; i++) {
    const t = world.at(i, j);
    if (t === C.STEEL || t === C.BASE) return Infinity;
    if (t === C.BRICK) brick++;
    if (t === C.WATER) water++;      // fordable, but slow
  }
  return 1 + brick * 1.5 + water * .8;
}

function astar(world, from, to) {
  const N = TW * TH, g = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const idx = (i, j) => j * TW + i, h = (i, j) => Math.hypot(i - to[0], j - to[1]);
  const open = [[h(...from), idx(...from)]]; g[idx(...from)] = 0;
  const goal = idx(...to);
  while (open.length) {
    let bi = 0; for (let k = 1; k < open.length; k++) if (open[k][0] < open[bi][0]) bi = k;
    const [, cur] = open.splice(bi, 1)[0];
    if (cur === goal) break;
    if (closed[cur]) continue; closed[cur] = 1;
    const ci = cur % TW, cj = (cur / TW) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const ni = ci + di, nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= TW || nj >= TH) continue;
      const n = idx(ni, nj); if (closed[n]) continue;
      let c = nodeCost(world, ni, nj);
      if (n === goal) c = Math.min(c, 2);
      if (!isFinite(c)) continue;
      const ng = g[cur] + c * (di && dj ? 1.414 : 1);
      if (ng < g[n]) { g[n] = ng; came[n] = cur; open.push([ng + h(ni, nj), n]); }
    }
  }
  if (came[goal] < 0) return null;
  const path = []; for (let n = goal; n >= 0 && n !== idx(...from); n = came[n]) path.push(n);
  return path.reverse().map(n => [(n % TW) * 2 - TW + 1, ((n / TW) | 0) * 2 - TH + 1]);
}
const tileOf = (x, z) => [clamp(Math.floor((x + TW) / 2), 0, TW - 1), clamp(Math.floor((z + TH) / 2), 0, TH - 1)];

export class Bot {
  constructor(game, tank, role) {
    this.g = game; this.t = tank; this.role = role;
    this.path = null; this.repath = 0; this.target = null; this.scan = 0;
    this.stuckT = 0; this.lastPos = [tank.x, tank.z]; this.lastHeading = tank.heading; this.reverseT = 0; this.jitter = 0;
    this.guard = null;
  }

  objective() {
    const w = this.g.world, enemy = this.t.team === 'blue' ? 'red' : 'blue';
    if (this.role === 'defend') {
      const b = w.bases[this.t.team];
      if (!this.guard || Math.random() < .002) {
        const side = Math.random() < .5 ? -1 : 1;
        this.guard = [b.x + side * rand(6, 14), b.z + (b.z > 0 ? -1 : 1) * rand(8, 16)];
      }
      return this.guard;
    }
    const b = w.bases[enemy];
    return [b.x, b.z + (b.z > 0 ? -7 : 7)];
  }

  update(dt) {
    const t = this.t, c = t.controls, w = this.g.world;
    if (!t.alive) return;
    c.fire = false;
    if (Object.values(t.mod).includes(-1)) t.repair();
    // pick a visible enemy
    this.scan -= dt;
    if (this.scan < 0) {
      this.scan = .4; this.target = null; let best = 70;
      for (const o of this.g.tanks) {
        if (!o.alive || o.team === t.team) continue;
        const d = Math.hypot(o.x - t.x, o.z - t.z);
        if (d < best && w.sight(t.x, t.z, o.x, o.z)) { best = d; this.target = o; }
      }
      this.jitter = rand(-.035, .035);
      this.aimH = Math.random() < .5 ? 1.9 : 1.0;      // turret or hull, chosen once per scan (no barrel jitter)
    }
    // movement along the A* path
    this.repath -= dt;
    const goal = this.objective();
    if (!this.path || this.repath < 0) {
      this.repath = 2.5;
      this.path = astar(w, tileOf(t.x, t.z), tileOf(...goal)) || [];
    }
    while (this.path.length && Math.hypot(this.path[0][0] - t.x, this.path[0][1] - t.z) < 2.2) this.path.shift();
    const wp = this.path[0];
    let throttle = 0, turn = 0, blockedBy = null;
    if (wp) {
      const want = Math.atan2(wp[0] - t.x, wp[1] - t.z), err = wrap(want - t.heading);
      turn = clamp(err * 2, -1, 1);
      throttle = Math.abs(err) < .5 ? 1 : Math.abs(err) < 1.2 ? .3 : 0;
      // brick in the way: stop and shoot it
      for (let s = 2; s <= 5; s += .5) {
        const px = t.x + Math.sin(t.heading) * s, pz = t.z + Math.cos(t.heading) * s;
        if (w.atXZ(px, pz) === C.BRICK) { blockedBy = [px, pz]; break; }
      }
    }
    // engage: hold position when an enemy is close, otherwise keep driving
    const T = this.target;
    if (T) {
      const d = Math.hypot(T.x - t.x, T.z - t.z);
      if (d < 38) throttle = Math.min(throttle, d < 18 ? 0 : .3);
      if (throttle === 0 && !this.reverseT) {
        // hold the hull ~25 degrees off the enemy: the glacis gets thicker effectively
        const bearing = Math.atan2(T.x - t.x, T.z - t.z);
        const a = wrap(bearing + .45 - t.heading), b = wrap(bearing - .45 - t.heading);
        const err = Math.abs(a) < Math.abs(b) ? a : b;
        turn = Math.abs(err) > .08 ? clamp(err * 2, -1, 1) : 0;
      }
      c.aim.set(T.x + T.v * Math.sin(T.heading) * d / 160, this.aimH || 1.9, T.z + T.v * Math.cos(T.heading) * d / 160);
    } else if (blockedBy) {
      throttle = 0; c.aim.set(blockedBy[0], .9, blockedBy[1]);
    } else {
      const enemyBase = w.bases[t.team === 'blue' ? 'red' : 'blue'];
      if (enemyBase.alive && Math.hypot(enemyBase.x - t.x, enemyBase.z - t.z) < 45) c.aim.set(enemyBase.x, 2.2, enemyBase.z);
      else if (wp) c.aim.set(t.x + Math.sin(t.heading) * 20, 1.4, t.z + Math.cos(t.heading) * 20);
    }
    // fire when the gun points at the aim point
    const [tx, tz] = t.turretPos();
    const want = Math.atan2(c.aim.x - tx, c.aim.z - tz), err = Math.abs(wrap(want - t.turretWorldYaw - this.jitter));
    const clearShot = T ? w.sight(t.x, t.z, T.x, T.z) : true;
    if (err < .04 && t.reload === 0 && clearShot && (T || blockedBy || Math.hypot(c.aim.x - t.x, c.aim.z - t.z) < 45)) {
      const friendly = this.g.tanks.some(o => o !== t && o.alive && o.team === t.team && Math.hypot(o.x - t.x, o.z - t.z) < Math.hypot(c.aim.x - t.x, c.aim.z - t.z)
        && Math.abs(wrap(Math.atan2(o.x - tx, o.z - tz) - t.turretWorldYaw)) < .15);
      if (!friendly) { t.ammo = blockedBy && !T ? 'HE' : 'AP'; c.fire = true; }
    }
    // unstick
    this.stuckT += dt;
    if (this.stuckT > 2) {
      const moved = Math.hypot(t.x - this.lastPos[0], t.z - this.lastPos[1]), turned = Math.abs(wrap(t.heading - this.lastHeading));
      const wants = throttle > 0 || Math.abs(turn) > .5;
      if (moved < .6 && turned < .15 && wants && !blockedBy) { this.reverseT = 1.2; this.revTurn = Math.random() < .5 ? 1 : -1; this.repath = 0; }
      this.stuckT = 0; this.lastPos = [t.x, t.z]; this.lastHeading = t.heading;
    }
    if (this.reverseT > 0) { this.reverseT -= dt; throttle = -1; turn = .7 * (this.revTurn || 1); }
    c.throttle = throttle; c.turn = turn;
  }
}
