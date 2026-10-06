import * as THREE from 'three';
import { canvasTex, rng, clamp, toLocal, toWorld, rand } from './util.js';

// smooth value noise in [-1, 1] and a three-octave sum of it
function vnoise(x, z, seed) {
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi;
  const h = (i, j) => {
    let n = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 982451653)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz), a = h(xi, zi), b = h(xi + 1, zi), c = h(xi, zi + 1), d = h(xi + 1, zi + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
const fbm = (x, z, s) => vnoise(x / 2.3, z / 2.3, s) * .6 + vnoise(x / .9, z / .9, s + 7) * .3 + vnoise(x / .37, z / .37, s + 13) * .1;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
// signed distance to the water cells plus a wobble, so the drawn shore is not made of 1 m squares
const shore = (sd, x, z) => sd + .4 * fbm(x, z, 1);

// unit bush (radius ~1.1, height ~1): a few lumpy blobs, darker towards the ground
function bushGeometry(rr) {
  const parts = [[0, .5, 0, .7, .55]];
  for (let k = 0; k < 5; k++) {
    const a = k / 5 * 6.28 + rr() * .8, d = .4 + rr() * .2;
    parts.push([Math.cos(a) * d, .28 + rr() * .2, Math.sin(a) * d, .42 + rr() * .14, .8]);
  }
  const pos = [], col = [];
  for (const [px, py, pz, rad, ys] of parts) {
    const p = new THREE.IcosahedronGeometry(1, 1).attributes.position, tint = .85 + rr() * .3;
    for (let k = 0; k < p.count; k++) {
      const x0 = p.getX(k), y0 = p.getY(k), z0 = p.getZ(k), f = 1 + .2 * Math.sin(x0 * 5.1 + z0 * 3.7 + px * 9) * Math.cos(y0 * 4.3 + x0 * 2.1);
      const y = Math.max(0, py + y0 * rad * ys * f), ao = (.4 + .6 * Math.min(1, y / .85)) * tint;
      pos.push(px + x0 * rad * f, y, pz + z0 * rad * f); col.push(ao, ao, ao);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals(); return geo;
}

// Map is authored in 2 m tiles (48 x 36) and simulated in 1 m cells (96 x 72).
export const TW = 48, TH = 36, W = TW * 2, H = TH * 2;
export const C = { EMPTY: 0, BRICK: 1, STEEL: 2, WATER: 3, BUSH: 4, BASE: 5 };
export const cellX = i => i - W / 2 + .5;
export const cellZ = j => j - H / 2 + .5;
export const toI = x => Math.floor(x + W / 2);
export const toJ = z => Math.floor(z + H / 2);
const HEIGHT = { [C.BRICK]: 2.5, [C.STEEL]: 2.6, [C.BASE]: 1.5 };   // BASE = the concrete plinth under the eagle   // walls are taller than a T-44 turret (2.2 m)

function layout() {
  const g = Array.from({ length: TH }, () => Array(TW).fill('.'));
  const rect = (x, z, w, h, c) => {
    for (let j = z; j < z + h; j++) for (let i = x; i < x + w; i++) if (i >= 0 && i < TW && j >= 0 && j < TH) g[j][i] = c;
  };
  // top half = red side; the bottom half is the same layout rotated 180 degrees
  rect(21, 0, 6, 4, 'B'); rect(23, 1, 2, 2, 'e');
  rect(9, 5, 4, 1, 'S'); rect(35, 5, 4, 1, 'S');
  rect(6, 3, 1, 6, 'B'); rect(41, 3, 1, 6, 'B');
  rect(15, 5, 1, 5, 'B'); rect(32, 5, 1, 5, 'B');
  rect(16, 7, 4, 1, 'B'); rect(28, 7, 4, 1, 'B');
  rect(1, 7, 4, 4, 'T'); rect(43, 7, 4, 4, 'T');
  rect(26, 10, 5, 3, 'T'); rect(16, 11, 3, 2, 'T');
  rect(2, 12, 7, 1, 'B'); rect(39, 12, 7, 1, 'B');
  rect(12, 13, 6, 1, 'B'); rect(30, 13, 6, 1, 'B');
  rect(9, 15, 3, 2, 'T');
  rect(20, 14, 1, 3, 'S'); rect(27, 14, 1, 3, 'S');
  rect(0, 17, 48, 1, 'W'); rect(7, 17, 5, 1, '.'); rect(21, 17, 6, 1, '.'); rect(36, 17, 5, 1, '.');
  g[2][3] = '4'; g[2][44] = '5'; g[6][24] = '6';
  const swap = { e: 'E', 4: '1', 5: '2', 6: '3' };
  for (let j = 0; j < TH / 2; j++) for (let i = 0; i < TW; i++) {
    const c = g[j][i]; g[TH - 1 - j][TW - 1 - i] = swap[c] || c;
  }
  return g;
}

export class World {
  constructor(game) {
    this.g = game;
    this.tiles = layout();
    this.cells = new Uint8Array(W * H);
    this.brickId = new Int32Array(W * H).fill(-1);
    this.spawns = { blue: [], red: [] };
    this.bases = {};
    const baseCells = { blue: [], red: [] };
    for (let tj = 0; tj < TH; tj++) for (let ti = 0; ti < TW; ti++) {
      const ch = this.tiles[tj][ti];
      const type = { B: C.BRICK, S: C.STEEL, W: C.WATER, T: C.BUSH, E: C.BASE, e: C.BASE }[ch] ?? C.EMPTY;
      for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) this.cells[(tj * 2 + dj) * W + ti * 2 + di] = type;
      const x = ti * 2 - W / 2 + 1, z = tj * 2 - H / 2 + 1;
      if ('123'.includes(ch)) this.spawns.blue[+ch - 1] = { x, z, heading: Math.PI };
      if ('456'.includes(ch)) this.spawns.red[+ch - 4] = { x, z, heading: 0 };
      if (ch === 'E') baseCells.blue.push([x, z]);
      if (ch === 'e') baseCells.red.push([x, z]);
    }
    for (const team of ['blue', 'red']) {
      const p = baseCells[team], x = p.reduce((a, q) => a + q[0], 0) / p.length, z = p.reduce((a, q) => a + q[1], 0) / p.length;
      this.bases[team] = { team, x, z, hp: game.cfg.GAME.baseHp, alive: true };
    }
    this.dirty = true;
    this.build();
  }

  at(i, j) { return (i < 0 || j < 0 || i >= W || j >= H) ? C.STEEL : this.cells[j * W + i]; }
  atXZ(x, z) { return this.at(toI(x), toJ(z)); }
  blocksMove(x, z) { const t = this.atXZ(x, z); return t === C.BRICK || t === C.STEEL || t === C.BASE; }
  isWater(x, z) { return this.atXZ(x, z) === C.WATER; }
  wallHeight(x, z) { return HEIGHT[this.atXZ(x, z)] || 0; }
  baseAt(x, z) {
    for (const b of Object.values(this.bases)) if (Math.abs(x - b.x) < 2.05 && Math.abs(z - b.z) < 2.05) return b;
    return null;
  }

  // line of sight on the cell grid (bricks/steel/bases block; a target in standing bushes is only seen within 18 m)
  sight(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / .5);
    for (let k = 1; k < n; k++) {
      const t = this.atXZ(ax + (bx - ax) * k / n, az + (bz - az) * k / n);
      if (t === C.BRICK || t === C.STEEL || t === C.BASE) return false;
    }
    return !(this.concealed(bx, bz) && d > 18);
  }
  concealed(x, z) {
    const i = toI(x), j = toJ(z);
    return i >= 0 && j >= 0 && i < W && j < H && this.cover[j * W + i] > 0;
  }

  // march a ray through the cell grid: first wall, the ground, or nothing within max
  raycast(o, d, max = 400) {
    const p = new THREE.Vector3();
    for (let t = 0; t < max; t += .25) {
      p.copy(o).addScaledVector(d, t);
      if (p.y <= 0 && d.y < 0) { p.addScaledVector(d, -p.y / d.y); return { point: p.clone(), kind: 'ground' }; }
      if (p.y < 3 && p.y < this.wallHeight(p.x, p.z)) return { point: p.clone(), kind: 'wall' };
    }
    return { point: o.clone().addScaledVector(d, max), kind: 'sky' };
  }

  destroyBricks(x, z, r) {
    const gone = [];
    const i0 = toI(x - r), i1 = toI(x + r), j0 = toJ(z - r), j1 = toJ(z + r);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (this.at(i, j) !== C.BRICK) continue;
      if (Math.hypot(cellX(i) - x, cellZ(j) - z) > r + .35) continue;
      gone.push(j * W + i);
    }
    this.removeBricks(gone);
    if (gone.length) this.g.net?.event('bricks', gone);
    return gone.length;
  }

  // cells = indices j * W + i (also how the host tells guests)
  removeBricks(cells) {
    for (const c of cells) {
      if (this.cells[c] !== C.BRICK) continue;
      const i = c % W, j = Math.floor(c / W), cx = cellX(i), cz = cellZ(j);
      this.cells[c] = C.EMPTY;
      this.bricks.setMatrixAt(this.brickId[c], ZERO);
      this.addRubble(cx, cz);
      this.g.fx.debris(cx, 1.2, cz, 6, this.brickMat);
    }
    if (cells.length) { this.bricks.instanceMatrix.needsUpdate = true; this.dirty = true; }
  }

  addRubble(x, z) {
    const r = this.rubbleRnd, m = new THREE.Matrix4();
    for (let k = 0; k < 2; k++) {
      if (this.rubbleN >= this.rubble.count) return;
      m.compose(new THREE.Vector3(x + (r() - .5) * .7, .08, z + (r() - .5) * .7),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * .5, r() * 6, r() * .5)),
        new THREE.Vector3(.6 + r() * .5, .25 + r() * .2, .5 + r() * .5));
      this.rubble.setMatrixAt(this.rubbleN++, m);
    }
    this.rubble.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------------ meshes
  build() {
    const scene = this.g.scene, r = rng(7);
    // ground
    const gt = this.groundTexture();
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ map: gt, roughness: 1, roughnessMap: this.groundRough }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ map: this.outerTexture(), roughness: 1 }));
    outer.rotation.x = -Math.PI / 2; outer.position.y = -.02; outer.receiveShadow = true; scene.add(outer);

    // bricks
    const bt = canvasTex(256, 640, (g, w, h) => {
      const rr = rng(5); g.fillStyle = '#8a8276'; g.fillRect(0, 0, w, h);
      const rows = 37, bh = h / rows, bw = w / 4;
      for (let k = 0; k < rows; k++) {
        const o = k % 2 ? bw / 2 : 0;
        for (let i = -1; i < 5; i++) {
          const x = i * bw + o + 2, y = k * bh + 2, ww = bw - 4, hh = bh - 4;
          g.fillStyle = `rgb(${105 + rr() * 55 | 0},${42 + rr() * 24 | 0},${30 + rr() * 16 | 0})`; g.fillRect(x, y, ww, hh);
          for (let n = 0; n < 10; n++) { g.fillStyle = `rgba(0,0,0,${rr() * .18})`; g.fillRect(x + rr() * ww, y + rr() * hh, 2 + rr() * 6, 1 + rr() * 2); }
          g.fillStyle = 'rgba(255,230,210,.1)'; g.fillRect(x, y, ww, 2);
        }
      }
    });
    this.brickMat = new THREE.MeshStandardMaterial({ map: bt, bumpMap: bt, bumpScale: 2, roughness: .9 });
    const nb = this.cells.reduce((a, c) => a + (c === C.BRICK), 0);
    const bg = new THREE.BoxGeometry(.98, 2.5, .98); bg.translate(0, 1.25, 0);
    this.bricks = new THREE.InstancedMesh(bg, this.brickMat, nb);
    const steelN = this.cells.reduce((a, c) => a + (c === C.STEEL), 0);
    const sg = new THREE.BoxGeometry(1, 2.6, 1); sg.translate(0, 1.3, 0);
    const steel = new THREE.InstancedMesh(sg, this.g.mats.steel, steelN);
    const m = new THREE.Matrix4(), col = new THREE.Color();
    let bi = 0, si = 0;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const t = this.cells[j * W + i];
      if (t === C.BRICK) {
        m.makeTranslation(cellX(i), 0, cellZ(j)); this.bricks.setMatrixAt(bi, m);
        const v = .85 + r() * .25; this.bricks.setColorAt(bi, col.setRGB(v, v * (.95 + r() * .08), v));
        this.brickId[j * W + i] = bi++;
      } else if (t === C.STEEL) {
        m.makeTranslation(cellX(i), 0, cellZ(j)); steel.setMatrixAt(si++, m);
      }
    }
    for (const im of [this.bricks, steel]) { im.castShadow = im.receiveShadow = true; scene.add(im); }
    this.rubble = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(.4, 0), this.brickMat, nb * 2 + 10);
    this.rubble.count = nb * 2 + 10; this.rubbleN = 0; this.rubbleRnd = rng(99);
    for (let k = 0; k < this.rubble.count; k++) this.rubble.setMatrixAt(k, ZERO);
    this.rubble.castShadow = this.rubble.receiveShadow = true; this.rubble.frustumCulled = false; scene.add(this.rubble);

    // map border curb
    const curbMat = this.g.mats.concrete;
    for (const [w, d, x, z] of [[W + 1, .5, 0, -H / 2 - .25], [W + 1, .5, 0, H / 2 + .25], [.5, H, -W / 2 - .25, 0], [.5, H, W / 2 + .25, 0]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, .4, d), curbMat); b.position.set(x, .2, z); b.receiveShadow = b.castShadow = true; scene.add(b);
    }

    // water: one plane over the river's bounding box; colour, depth tint, foam and the irregular edge are baked into its texture
    let i0 = W, i1 = -1, j0 = H, j1 = -1;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (this.cells[j * W + i] === C.WATER) { i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j); }
    const wx0 = Math.max(-W / 2, i0 - W / 2 - 1.5), wx1 = Math.min(W / 2, i1 + 1 - W / 2 + 1.5);
    const wz0 = Math.max(-H / 2, j0 - H / 2 - 1.5), wz1 = Math.min(H / 2, j1 + 1 - H / 2 + 1.5), ww = wx1 - wx0, wh = wz1 - wz0, WPX = 16;
    const wmap = canvasTex(Math.round(ww * WPX), Math.round(wh * WPX), (g, w, h) => {
      const sd = this.waterField(wx0, wz0, w, h, WPX), img = g.createImageData(w, h), d = img.data, rr = rng(21);
      for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) {
        const x = wx0 + (u + .5) / WPX, z = wz0 + (v + .5) / WPX, s = shore(sd[v * w + u], x, z), o = (v * w + u) * 4;
        const dpt = smooth(-.1, -1.6, s), a = smooth(.12, -.6, s) * mix(.5, .93, dpt), n = .94 + rr() * .12;
        const foam = Math.exp(-(((s + .08) / .1) ** 2)) * clamp(.15 + 1.1 * fbm(x * 3, z * 3, 9), 0, 1) * .55;
        d[o] = mix(mix(78, 27, dpt), 150, foam) * n; d[o + 1] = mix(mix(72, 46, dpt), 150, foam) * n; d[o + 2] = mix(mix(52, 42, dpt), 135, foam) * n;
        d[o + 3] = 255 * Math.max(a, foam);
      }
      g.putImageData(img, 0, 0);
    });
    wmap.wrapS = wmap.wrapT = THREE.ClampToEdgeWrapping;
    const wg = new THREE.PlaneGeometry(ww, wh); wg.rotateX(-Math.PI / 2);
    this.waterNormal = canvasTex(256, 256, (g, w, h) => {
      const rr = rng(4); g.fillStyle = 'rgb(128,128,255)'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 220; k++) {
        const x = rr() * w, y = rr() * h, s = 6 + rr() * 22, gr = g.createRadialGradient(x, y, 0, x, y, s);
        const a = rr() * 6.28, nx = 128 + Math.cos(a) * 60, ny = 128 + Math.sin(a) * 60;
        gr.addColorStop(0, `rgba(${nx | 0},${ny | 0},255,.5)`); gr.addColorStop(1, 'rgba(128,128,255,0)');
        g.fillStyle = gr; g.fillRect(x - s, y - s, 2 * s, 2 * s);
      }
    }, { srgb: false });
    this.waterNormal.repeat.set(ww / 8, wh / 8);
    const water = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ map: wmap, roughness: .3, metalness: 0, envMapIntensity: .3, normalMap: this.waterNormal, normalScale: new THREE.Vector2(.3, .3), transparent: true, depthWrite: false }));
    water.position.set(wx0 + ww / 2, .05, wz0 + wh / 2); water.receiveShadow = true; scene.add(water);

    // bushes in the 'T' areas (tanks drive through and flatten them), more bushes just outside the map, trees further out
    this.leafU = { uCam: { value: new THREE.Vector3(0, 100, 0) }, uTank: { value: new THREE.Vector3() }, uTime: { value: 0 } };
    const bush = [], treeSpots = [];
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (this.cells[j * W + i] === C.BUSH && r() < .55)
      bush.push([cellX(i) + (r() - .5) * .8, cellZ(j) + (r() - .5) * .8, .8 + r() * .3, 1.5 + r() * .8, true]);
    for (let k = 0; k < 260; k++) {
      let x = (r() - .5) * 150, z = (r() - .5) * 120;
      if (Math.abs(x) < W / 2 + 2 && Math.abs(z) < H / 2 + 2) { if (r() < .5) x = Math.sign(x || 1) * (W / 2 + 3 + r() * 25); else z = Math.sign(z || 1) * (H / 2 + 3 + r() * 22); }
      if (Math.abs(x) > W / 2 + 10 || Math.abs(z) > H / 2 + 10) treeSpots.push([x, z, .9 + r() * .5]);
      else bush.push([x, z, .9 + r() * .4, 1.6 + r() * 1.1, false]);
    }
    this.bushes(bush, r);
    this.trees(treeSpots, r);

    // bases
    for (const b of Object.values(this.bases)) { b.mesh = this.g.makeBase(b.team); b.mesh.position.set(b.x, 0, b.z); scene.add(b.mesh); }
  }

  // shared foliage shader bits: `bend` deforms bushes by the per-instance aBend (x, z lean in model units, y flattening)
  // plus a light wind sway; `dither` hides foliage between the camera and the watched tank, and right in front of the camera
  foliage(sh, bend, dither) {
    Object.assign(sh.uniforms, this.leafU);
    if (bend) sh.vertexShader = 'attribute vec3 aBend;\nuniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  {
    float hN = clamp(transformed.y, 0.0, 1.0), fl = aBend.z, bl = min(length(aBend.xy), 1.3);
    transformed.xz *= 1.0 + 0.35 * fl;
    transformed.y *= (1.0 - 0.84 * fl) * (1.0 - 0.3 * bl * hN);
    transformed.xz += aBend.xy * hN * hN;
    vec3 ip = instanceMatrix[3].xyz;
    transformed.xz += vec2(sin(uTime * 1.3 + ip.x * .7 + ip.z * .3), cos(uTime * 1.1 + ip.z * .6)) * .03 * hN * (1.0 - fl);
  }`);
    if (!dither) return;
    sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace('#include <project_vertex>',
      '#include <project_vertex>\n  vWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'varying vec3 vWPos;\nuniform vec3 uCam;\nuniform vec3 uTank;\n' + sh.fragmentShader.replace('#include <clipping_planes_fragment>',
      `#include <clipping_planes_fragment>
  vec3 ab = uTank - uCam; float t = clamp(dot(vWPos - uCam, ab) / dot(ab, ab), 0.0, 1.0);
  float d = length(vWPos - (uCam + ab * t));
  float n = fract(sin(dot(floor(gl_FragCoord.xy / 2.0), vec2(12.9898, 78.233))) * 43758.5453);
  if (t > 0.04 && t < 0.98 && d < 4.2) {
    if (d < 3.0) discard;
    if (n < smoothstep(4.2, 3.0, d)) discard;
  }
  float dc = distance(vWPos, uCam);          // leaves right in front of the camera
  if (dc < 4.5 || n < smoothstep(8.0, 4.5, dc)) discard;`);
  }

  // spots: [x, z, radius scale, height, interactive]; the interactive ones come first
  bushes(spots, r) {
    const n = spots.length, geo = bushGeometry(rng(41));
    this.bendAttr = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.bendAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aBend', this.bendAttr);
    const mat = new THREE.MeshStandardMaterial({ roughness: .88, flatShading: true, vertexColors: true });
    mat.onBeforeCompile = sh => this.foliage(sh, true, true);
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.onBeforeCompile = sh => this.foliage(sh, true, false);
    const im = this.bushMesh = new THREE.InstancedMesh(geo, mat, n);
    im.customDepthMaterial = depth; im.castShadow = im.receiveShadow = true; im.frustumCulled = false;
    this.bush = []; this.cover = new Uint8Array(W * H);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    spots.forEach(([x, z, s, h, live], k) => {
      const yaw = r() * 6.28, col = new THREE.Color().setHSL(.22 + r() * .06, .42 + r() * .15, .11 + r() * .05);
      m.compose(new THREE.Vector3(x, 0, z), q.setFromEuler(e.set(0, yaw, 0)), new THREE.Vector3(s, h, s));
      im.setMatrixAt(k, m); im.setColorAt(k, col);
      if (!live) return;
      const b = { k, x, z, s, h, c: Math.cos(yaw), sn: Math.sin(yaw), col, bx: 0, bz: 0, vx: 0, vz: 0, dx: 0, dz: 0,
        flat: 0, flatT: 0, passes: 0, need: 3 + Math.floor(r() * 3), touch: new Set(), covering: true, idle: true };
      this.bush.push(b); this.setCover(b, 1);
    });
    this.g.scene.add(im);
  }

  // bushes that still stand hide tanks: count them on the 1 m cells they cover
  setCover(b, add) {
    const rad = b.s * .85;
    for (let j = toJ(b.z - rad); j <= toJ(b.z + rad); j++) for (let i = toI(b.x - rad); i <= toI(b.x + rad); i++)
      if (i >= 0 && j >= 0 && i < W && j < H && Math.hypot(cellX(i) - b.x, cellZ(j) - b.z) < rad + .3) this.cover[j * W + i] += add;
  }

  // tanks push bushes over while their hull overlaps them; each pass flattens a bush a little, after 3-5 it stays down
  updateBushes(dt) {
    this.leafU.uTime.value += dt;
    const tanks = this.g.tanks, a = this.bendAttr.array, dry = new THREE.Color().setHSL(.17, .38, .12), col = new THREE.Color();
    let dirty = false, cdirty = false;
    for (const b of this.bush) {
      let tx = 0, tz = 0, pushed = false;
      for (const t of tanks) {
        const dx = b.x - t.x, dz = b.z - t.z, reach = 3.8 + b.s;
        if (dx * dx + dz * dz > reach * reach) { if (b.touch.size) b.touch.delete(t); continue; }
        const [lx, lz] = toLocal(dx, dz, t.heading), mg = b.s * .55;
        const ox = t.spec.hull.hw + mg - Math.abs(lx), oz = t.spec.hull.hl + mg - Math.abs(lz);
        if (ox <= 0 || oz <= 0) { if (ox < -.4 || oz < -.4) b.touch.delete(t); continue; }
        // passes (flattening) count for every tank, but a tank hidden from us does not bend bushes on our screen
        if (!b.touch.has(t)) {
          b.touch.add(t);
          if (t.alive && Math.abs(t.v) > .8) this.bushPass(b, t);
        }
        if (t.hidden) continue;
        pushed = true;
        // pressed out sideways from the hull and dragged along with the motion
        const fwd = Math.sign(t.v) * Math.min(1, Math.abs(t.v) / 3), side = Math.sign(lx || 1) * (.45 + .55 * (1 - Math.min(1, Math.abs(lx) / (t.spec.hull.hw + mg))));
        let [wx, wz] = toWorld(side, fwd, t.heading);
        const len = Math.hypot(wx, wz) || 1, amt = .8 * b.h * Math.min(1, .45 + Math.min(ox, oz) / (mg + .4));
        tx += wx / len * amt; tz += wz / len * amt;
        if (t.alive && Math.abs(t.v) > 1.5 && Math.random() < dt * 2.5) this.leaves(b, 1);
      }
      if (pushed) {
        const l = Math.hypot(tx, tz), cap = .9 * b.h;
        if (l > cap) { tx *= cap / l; tz *= cap / l; }
        const k = Math.min(1, dt * 9);
        b.vx = (tx - b.bx) * 9; b.vz = (tz - b.bz) * 9; b.bx += (tx - b.bx) * k; b.bz += (tz - b.bz) * k;
        if (l > .05) { b.dx = tx / l; b.dz = tz / l; }
        b.idle = false;
      } else if (!b.idle) {
        // springs back with a little sway; flattened bushes keep leaning the way they were pushed
        const rx = b.dx * .55 * b.h * b.flat, rz = b.dz * .55 * b.h * b.flat;
        b.vx += (-(b.bx - rx) * 45 - b.vx * 4.5) * dt; b.vz += (-(b.bz - rz) * 45 - b.vz * 4.5) * dt;
        b.bx += b.vx * dt; b.bz += b.vz * dt;
        if (Math.abs(b.bx - rx) + Math.abs(b.bz - rz) + Math.abs(b.vx) + Math.abs(b.vz) < .004 && b.flat === b.flatT) b.idle = true;
      }
      if (b.flat !== b.flatT) {
        b.flat += clamp(b.flatT - b.flat, -dt * 1.5, dt * 1.5);
        this.bushMesh.setColorAt(b.k, col.copy(b.col).lerp(dry, b.flat * .6).multiplyScalar(1 - .35 * b.flat)); cdirty = true;
      }
      if (!b.idle || pushed) {
        // world lean -> the instance's model space (undo yaw and the xz scale)
        const o = b.k * 3;
        a[o] = (b.bx * b.c - b.bz * b.sn) / b.s; a[o + 1] = (b.bx * b.sn + b.bz * b.c) / b.s; a[o + 2] = b.flat;
        dirty = true;
      }
    }
    if (dirty) this.bendAttr.needsUpdate = true;
    if (cdirty) this.bushMesh.instanceColor.needsUpdate = true;
  }

  bushPass(b, t) {
    b.passes++;
    b.flatT = b.passes >= b.need ? 1 : Math.max(b.flatT, b.passes * .17);
    if (b.flatT >= 1 && b.covering) { b.covering = false; this.setCover(b, -1); }
    if (!t.hidden) this.leaves(b, 4);
    this.g.sfx.rustle?.(this.g.hearing(t) * .8);
  }

  leaves(b, n) {
    for (let k = 0; k < n; k++)
      this.g.fx.sprite('dust', new THREE.Vector3(b.x + rand(-.6, .6), b.h * rand(.4, .9), b.z + rand(-.6, .6)), { size: rand(.25, .45), life: rand(.9, 1.6),
        v: new THREE.Vector3(rand(-1.2, 1.2), rand(.5, 2), rand(-1.2, 1.2)), grav: 2.5, drag: .96, opacity: .9, color: new THREE.Color().setHSL(.24, .45, .22) });
  }

  trees(spots, r) {
    const scene = this.g.scene;
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(.13, .22, 2.4, 7).translate(0, 1.2, 0),
      new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: .95 }), spots.length);
    const geos = [0, 1, 2].map(s => {
      const geo = new THREE.IcosahedronGeometry(1, 1), p = geo.attributes.position, rr = rng(30 + s);
      for (let k = 0; k < p.count; k++) { const f = 1 + (rr() - .5) * .3; p.setXYZ(k, p.getX(k) * f, p.getY(k) * f * .85, p.getZ(k) * f); }
      geo.computeVertexNormals(); return geo;
    });
    const leafMat = new THREE.MeshStandardMaterial({ roughness: .9, flatShading: true });
    leafMat.onBeforeCompile = trunk.material.onBeforeCompile = sh => this.foliage(sh, false, true);
    const leaves = geos.map(geo => new THREE.InstancedMesh(geo, leafMat, spots.length));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    spots.forEach(([x, z, s], k) => {
      m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s, s)); trunk.setMatrixAt(k, m);
      leaves.forEach((im, n) => {
        const a = r() * 6.28, d = n ? .7 * s : 0, ss = s * (1.25 - n * .18) * (1 + r() * .2);
        m.compose(new THREE.Vector3(x + Math.cos(a) * d, s * (2.6 + n * .55 + r() * .4), z + Math.sin(a) * d),
          q.setFromEuler(new THREE.Euler(0, r() * 6, 0)), new THREE.Vector3(ss, ss, ss));
        im.setMatrixAt(k, m); im.setColorAt(k, col.setHSL(.24 + r() * .06, .38 + r() * .15, .13 + r() * .07));
      });
    });
    for (const im of [trunk, ...leaves]) { im.castShadow = true; im.receiveShadow = true; scene.add(im); }
  }

  // signed distance (m) from each pixel centre to the water cells (negative inside), 99 when far from any water
  waterField(x0, z0, w, h, PX) {
    const R = 5, sd = new Float32Array(w * h).fill(99);
    const wat = (i, j) => this.cells[clamp(j, 0, H - 1) * W + clamp(i, 0, W - 1)] === C.WATER;
    if (!this.waterNear) {
      const list = [], near = this.waterNear = new Uint8Array(W * H).fill(255);
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (wat(i, j)) list.push([i, j]);
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) for (const [a, b] of list) near[j * W + i] = Math.min(near[j * W + i], Math.max(Math.abs(a - i), Math.abs(b - j)));
    }
    for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) {
      const x = x0 + (u + .5) / PX, z = z0 + (v + .5) / PX, i = toI(x), j = toJ(z);
      if (this.waterNear[clamp(j, 0, H - 1) * W + clamp(i, 0, W - 1)] > R) continue;
      const inside = wat(i, j); let best = R * R;
      for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
        if (wat(i + di, j + dj) === inside) continue;
        const cx = i + di - W / 2, cz = j + dj - H / 2;
        const ex = Math.max(cx - x, 0, x - cx - 1), ez = Math.max(cz - z, 0, z - cz - 1), d = ex * ex + ez * ez;
        if (d < best) best = d;
      }
      sd[v * w + u] = inside ? -Math.sqrt(best) : Math.sqrt(best);
    }
    return sd;
  }

  groundTexture() {
    const PX = 20;
    return canvasTex(W * PX, H * PX, (g, w, h) => {
      const r = rng(11);
      g.fillStyle = '#55633a'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 140; k++) {
        const x = r() * w, y = r() * h, s = 40 + r() * 200, c = r() < .5 ? '95,105,55' : (r() < .5 ? '78,66,44' : '118,116,70');
        const gr = g.createRadialGradient(x, y, 0, x, y, s); gr.addColorStop(0, `rgba(${c},.35)`); gr.addColorStop(1, `rgba(${c},0)`);
        g.fillStyle = gr; g.fillRect(x - s, y - s, 2 * s, 2 * s);
      }
      for (let k = 0; k < 90000; k++) {
        g.fillStyle = `rgba(${50 + r() * 75 | 0},${65 + r() * 60 | 0},${25 + r() * 35 | 0},${.3 + r() * .4})`;
        g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 2);
      }
      // dirt roads from each base to the centre crossing
      g.lineCap = 'round';
      for (const [a, b] of [[[0, -33], [0, 33]], [[-38, -10], [-38, 10]], [[38, -10], [38, 10]]]) {
        const p = q => [(q[0] + W / 2) * PX, (q[1] + H / 2) * PX];
        for (const [lw, c] of [[150, 'rgba(70,58,40,.6)'], [120, '#7a6849']]) {
          g.strokeStyle = c; g.lineWidth = lw; g.beginPath(); g.moveTo(...p(a)); g.lineTo(...p(b)); g.stroke();
        }
      }
      for (let k = 0; k < 20000; k++) { g.fillStyle = `rgba(${110 + r() * 60 | 0},${90 + r() * 45 | 0},${60 + r() * 35 | 0},.12)`; g.fillRect(r() * w, r() * h, 2, 2); }
      // river bed and a wide band of wet, rutted mud along the banks
      g.drawImage(this.mudTexture(), 0, 0, w, h);
      // dirt under walls
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (this.cells[j * W + i] === C.BRICK) {
        g.fillStyle = 'rgba(80,68,50,.35)'; g.fillRect((i - .3) * PX, (j - .3) * PX, PX * 1.6, PX * 1.6);
      }
    });
  }

  // mud overlay for the ground texture (transparent away from the water) and the ground roughness map (wet mud is glossy)
  mudTexture() {
    const PX = 10, w = W * PX, h = H * PX, r = rng(17), sd = this.waterField(-W / 2, -H / 2, w, h, PX);
    const ov = document.createElement('canvas'), rc = document.createElement('canvas');
    ov.width = rc.width = w; ov.height = rc.height = h;
    const g = ov.getContext('2d'), gr = rc.getContext('2d'), img = g.createImageData(w, h), rimg = gr.createImageData(w, h), d = img.data, rd = rimg.data;
    for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) {
      const o = (v * w + u) * 4; rd[o] = rd[o + 1] = rd[o + 2] = 245; rd[o + 3] = 255;
      if (sd[v * w + u] > 50) continue;
      const x = -W / 2 + (u + .5) / PX, z = -H / 2 + (v + .5) / PX, s = shore(sd[v * w + u], x, z), outer = 2.6 + .9 * fbm(x, z, 3);
      const a = smooth(outer, outer - 1.3, s); if (a <= 0) continue;
      const wet = smooth(1.8, .2, s), bed = smooth(.3, -.4, s), n = (.86 + r() * .26) * (1 + .12 * fbm(x * 2, z * 2, 5));
      d[o] = mix(mix(86, 56, wet), 30, bed) * n; d[o + 1] = mix(mix(72, 46, wet), 28, bed) * n; d[o + 2] = mix(mix(50, 33, wet), 21, bed) * n;
      d[o + 3] = 255 * a * .95;
      rd[o] = rd[o + 1] = rd[o + 2] = mix(245, mix(140, 110, bed), wet * a);
    }
    g.putImageData(img, 0, 0); gr.putImageData(rimg, 0, 0);
    const P = (x, z) => [(x + W / 2) * PX, (z + H / 2) * PX], sdAt = (x, z) => sd[clamp(Math.floor((z + H / 2) * PX), 0, h - 1) * w + clamp(Math.floor((x + W / 2) * PX), 0, w - 1)];
    // track ruts (two tracks 2.6 m apart) drawn only onto the mud
    g.globalCompositeOperation = 'source-atop'; g.lineCap = 'round';
    const rut = (x, z, ang, len, curve) => {
      for (const side of [-1.3, 1.3]) {
        const path = () => {
          g.beginPath();
          for (let k = 0; k <= 16; k++) {
            const t = (k / 16 - .5) * len, off = side + curve * (t / len) ** 2 * len;
            g.lineTo(...P(x + Math.sin(ang) * t + Math.cos(ang) * off, z + Math.cos(ang) * t - Math.sin(ang) * off));
          }
        };
        path(); g.setLineDash([]); g.strokeStyle = 'rgba(110,95,70,.1)'; g.lineWidth = .85 * PX; g.stroke();
        g.strokeStyle = 'rgba(30,24,16,.26)'; g.lineWidth = .55 * PX; g.stroke();
        g.setLineDash([.12 * PX, .16 * PX]); g.strokeStyle = 'rgba(18,14,9,.16)'; g.lineWidth = .5 * PX; g.stroke();
      }
      g.setLineDash([]);
    };
    // fords = runs of dry columns inside the river's rows; tanks cross there, and wade across elsewhere now and then
    let j0 = H, j1 = -1;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (this.cells[j * W + i] === C.WATER) { j0 = Math.min(j0, j); j1 = Math.max(j1, j); }
    const zc = (j0 + j1 + 1) / 2 - H / 2;
    for (let i = 0, start = -1; i <= W; i++) {
      let dry = i < W;
      for (let j = j0; dry && j <= j1; j++) if (this.cells[j * W + i] === C.WATER) dry = false;
      if (dry && start < 0) start = i;
      if (!dry && start >= 0) {
        const a = start - W / 2, b = i - W / 2;
        if (b - a > 3) for (let k = 0; k < 3; k++) rut(a + 1.5 + r() * (b - a - 3), zc, (r() - .5) * .3, 12 + r() * 4, (r() - .5) * 2);
        start = -1;
      }
    }
    for (let k = 0; k < 8; k++) rut((r() - .5) * W * .9, zc, (r() - .5) * .8, 10 + r() * 4, (r() - .5) * 3);
    for (let k = 0; k < 8; k++) rut((r() - .5) * W * .9, zc + (r() < .5 ? -1 : 1) * (3.2 + r() * .8), Math.PI / 2 + (r() - .5) * .4, 8 + r() * 8, (r() - .5) * 3);
    // puddles on the wet mud
    g.globalCompositeOperation = 'source-over';
    for (let k = 0, tries = 0; k < 40 && tries < 2000; tries++) {
      const x = (r() - .5) * W, z = zc + (r() - .5) * 12, s = sdAt(x, z);
      if (s < .4 || s > 1.8) continue;
      k++;
      const [px, pz] = P(x, z), rx = (.3 + r() * .7) * PX, rz = (.2 + r() * .4) * PX, rot = r() * 3;
      const pg = g.createRadialGradient(px, pz, 0, px, pz, rx); pg.addColorStop(0, 'rgba(26,24,18,.6)'); pg.addColorStop(.6, 'rgba(30,27,20,.45)'); pg.addColorStop(1, 'rgba(40,34,24,0)');
      g.fillStyle = pg; g.beginPath(); g.ellipse(px, pz, rx, rz, rot, 0, 6.28); g.fill();
      gr.fillStyle = 'rgb(55,55,55)'; gr.beginPath(); gr.ellipse(px, pz, rx * .85, rz * .85, rot, 0, 6.28); gr.fill();
    }
    this.groundRough = new THREE.CanvasTexture(rc); this.groundRough.anisotropy = 8;
    return ov;
  }

  outerTexture() {
    const t = canvasTex(512, 512, (g, w, h) => {
      const r = rng(3); g.fillStyle = '#46552f'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 9000; k++) { g.fillStyle = `rgba(${40 + r() * 60 | 0},${55 + r() * 50 | 0},${20 + r() * 30 | 0},.5)`; g.fillRect(r() * w, r() * h, 2, 2); }
    });
    t.repeat.set(30, 30); return t;
  }
}
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
