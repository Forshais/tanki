# T-44 medium tank, procedural model for Blender 5.x
# Run: blender -b --factory-startup --python t44_build.py -- [render]
# Units: meters. Tank faces -Y, +Z up, left side = +X.
import bpy, bmesh, math, sys, os
from mathutils import Vector, Matrix, Euler

HERE = os.path.dirname(os.path.abspath(__file__))
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []

for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob)
COL = bpy.data.collections.new('T44')
bpy.context.scene.collection.children.link(COL)
ROOT = bpy.data.objects.new('T44', None)
COL.objects.link(ROOT)

# ---------------------------------------------------------------- materials
def lin(c):
    return tuple(((v / 255 + .055) / 1.055) ** 2.4 for v in c)

class NT:
    """Small helper around a material node tree."""
    def __init__(self, name):
        self.mat = bpy.data.materials.new(name)
        self.mat.use_nodes = True
        self.t = self.mat.node_tree
        self.t.nodes.clear()
        self.x = 0
    def n(self, kind, **props):
        node = self.t.nodes.new(kind)
        for k, v in props.items():
            setattr(node, k, v)
        node.location = (self.x, 0); self.x += 200
        return node
    def link(self, a, b):
        self.t.links.new(a, b)
    def val(self, v):
        node = self.n('ShaderNodeValue'); node.outputs[0].default_value = v
        return node.outputs[0]
    def rgb(self, c):
        node = self.n('ShaderNodeRGB'); node.outputs[0].default_value = (*c, 1)
        return node.outputs[0]
    def math(self, op, a, b=None, clamp=False):
        node = self.n('ShaderNodeMath', operation=op, use_clamp=clamp)
        for i, v in enumerate((a, b)):
            if v is None: continue
            if isinstance(v, (int, float)): node.inputs[i].default_value = v
            else: self.link(v, node.inputs[i])
        return node.outputs[0]
    def mrange(self, v, f0, f1, t0=0., t1=1.):
        node = self.n('ShaderNodeMapRange')
        self.link(v, node.inputs['Value'])
        for k, x in (('From Min', f0), ('From Max', f1), ('To Min', t0), ('To Max', t1)):
            node.inputs[k].default_value = x
        return node.outputs['Result']
    def mixc(self, fac, a, b):
        node = self.n('ShaderNodeMix', data_type='RGBA')
        self.link(fac, node.inputs[0]) if not isinstance(fac, float) else None
        for idx, v in ((6, a), (7, b)):
            if isinstance(v, tuple): node.inputs[idx].default_value = (*v, 1)
            else: self.link(v, node.inputs[idx])
        return node.outputs[2]
    def mixf(self, fac, a, b):
        node = self.n('ShaderNodeMix', data_type='FLOAT')
        self.link(fac, node.inputs[0])
        for idx, v in ((2, a), (3, b)):
            if isinstance(v, (int, float)): node.inputs[idx].default_value = v
            else: self.link(v, node.inputs[idx])
        return node.outputs[0]
    def noise(self, vec, scale, detail=6., rough=.55):
        node = self.n('ShaderNodeTexNoise')
        self.link(vec, node.inputs['Vector'])
        node.inputs['Scale'].default_value = scale
        node.inputs['Detail'].default_value = detail
        node.inputs['Roughness'].default_value = rough
        return node.outputs['Fac']

def worn_material(name, base, *, metal_base=0., rough_base=.55, bump=.05, cast=False,
                  edge_wear=1., dust=1., grime=1., bare=(.32, .31, .29)):
    T = NT(name)
    tc = T.n('ShaderNodeTexCoord'); tc.object = ROOT
    co = tc.outputs['Object']
    out = T.n('ShaderNodeOutputMaterial')
    bsdf = T.n('ShaderNodeBsdfPrincipled')
    T.link(bsdf.outputs[0], out.inputs['Surface'])
    # paint variation
    var = T.noise(co, 3.5, 4)
    paint = T.mixc(T.mrange(var, .35, .65), tuple(c * .88 for c in base), tuple(c * 1.08 for c in base))
    mp = T.n('ShaderNodeMapping'); T.link(co, mp.inputs['Vector']); mp.inputs['Scale'].default_value = (28, 28, 1.6)
    streak = T.math('MULTIPLY', T.mrange(T.noise(mp.outputs['Vector'], 3, 4), .5, .75), .45 * grime)
    paint = T.mixc(streak, paint, tuple(c * .45 for c in base))
    # edges: bevel normal vs true normal
    bev = T.n('ShaderNodeBevel'); bev.inputs['Radius'].default_value = .035; bev.samples = 8
    geo = T.n('ShaderNodeNewGeometry')
    dot = T.n('ShaderNodeVectorMath', operation='DOT_PRODUCT')
    T.link(bev.outputs['Normal'], dot.inputs[0]); T.link(geo.outputs['Normal'], dot.inputs[1])
    edge = T.mrange(dot.outputs['Value'], .86, .998, 1., 0.)
    chips = T.mrange(T.noise(co, 22, 12, .62), .42, .62)
    wear = T.mrange(T.math('MULTIPLY', T.math('MULTIPLY', edge, chips), edge_wear), .14, .3)
    # small random chips away from edges
    spots = T.mrange(T.noise(co, 60, 10, .7), .68, .74)
    wear = T.math('MAXIMUM', wear, T.math('MULTIPLY', spots, .9 * edge_wear))
    # grime in crevices
    ao = T.n('ShaderNodeAmbientOcclusion', samples=8); ao.inputs['Distance'].default_value = .35
    gr = T.math('MULTIPLY', T.math('SUBTRACT', 1., ao.outputs['AO']), .85 * grime, clamp=True)
    # dust low on the vehicle
    sep = T.n('ShaderNodeSeparateXYZ'); T.link(co, sep.inputs[0])
    low = T.mrange(sep.outputs['Z'], .25, 1.25, 1., 0.)
    dn = T.mrange(T.noise(co, 5, 8), .3, .7)
    du = T.math('MULTIPLY', T.math('MULTIPLY', low, dn), .9 * dust, clamp=True)
    du = T.math('MAXIMUM', du, T.math('MULTIPLY', T.mrange(T.noise(co, 9, 8), .62, .72), .22 * dust))
    # rust streaks under edges
    col = T.mixc(gr, paint, tuple(c * .3 for c in base))
    col = T.mixc(du, col, lin((122, 104, 78)))
    col = T.mixc(wear, col, bare)
    T.link(col, bsdf.inputs['Base Color'])
    rough = T.mixf(du, T.math('ADD', rough_base, T.math('MULTIPLY', T.math('SUBTRACT', var, .5), .25)), .92)
    rough = T.mixf(wear, rough, .28)
    T.link(rough, bsdf.inputs['Roughness'])
    T.link(T.mixf(wear, metal_base, 1.), bsdf.inputs['Metallic'])
    # surface: fine bumps, stronger for cast armour
    bh = T.math('ADD', T.math('MULTIPLY', T.noise(co, 140 if not cast else 45, 8, .6), 1. if not cast else 2.), T.math('MULTIPLY', wear, -.6))
    bmp = T.n('ShaderNodeBump'); bmp.inputs['Strength'].default_value = bump * (3 if cast else 1)
    bmp.inputs['Distance'].default_value = .01
    T.link(bh, bmp.inputs['Height'])
    T.link(bmp.outputs['Normal'], bsdf.inputs['Normal'])
    return T.mat

GREEN = lin((62, 70, 38))
M_PAINT = worn_material('Paint 4BO', GREEN)
M_CAST = worn_material('Paint cast', GREEN, cast=True)
M_WHEEL = worn_material('Paint wheels', GREEN, dust=1.0)
M_TRACK = worn_material('Track steel', lin((46, 42, 38)), metal_base=.75, rough_base=.65, dust=1.5,
                        edge_wear=1.0, bare=(.28, .27, .25))
M_RUBBER = worn_material('Rubber', (.012, .012, .012), rough_base=.85, edge_wear=0., dust=.5, bump=.02)
M_DARK = worn_material('Dark steel', lin((40, 38, 36)), metal_base=.8, rough_base=.45, dust=.6)
M_WHITE = worn_material('Paint white', lin((214, 210, 196)), dust=.6, edge_wear=1.4, grime=0)
M_GLASS = bpy.data.materials.new('Glass'); M_GLASS.use_nodes = True
_b = M_GLASS.node_tree.nodes['Principled BSDF']
_b.inputs['Base Color'].default_value = (.02, .03, .03, 1); _b.inputs['Roughness'].default_value = .05
M_LENS = bpy.data.materials.new('Lens'); M_LENS.use_nodes = True
_b = M_LENS.node_tree.nodes['Principled BSDF']
_b.inputs['Base Color'].default_value = (.7, .7, .65, 1); _b.inputs['Roughness'].default_value = .02; _b.inputs['Metallic'].default_value = 1.

# ---------------------------------------------------------------- geometry helpers
def finish(name, bm, mat, bev=.012, seg=2, smooth=True, angle=32, parent=None):
    me = bpy.data.meshes.new(name)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = smooth
    ob = bpy.data.objects.new(name, me); COL.objects.link(ob)
    me.materials.append(mat)
    ob.parent = parent or ROOT
    if bev:
        m = ob.modifiers.new('Bevel', 'BEVEL'); m.width = bev; m.segments = seg
        m.limit_method = 'ANGLE'; m.angle_limit = math.radians(angle); m.harden_normals = True
    return ob

def xform(bm, loc=(0, 0, 0), rot=(0, 0, 0), size=(1, 1, 1)):
    bm.transform(Matrix.Translation(loc) @ Euler(rot).to_matrix().to_4x4() @ Matrix.Diagonal((*size, 1)))

def add_box(bm, size, loc, rot=(0, 0, 0)):
    tmp = bmesh.new(); bmesh.ops.create_cube(tmp, size=1.); xform(tmp, loc, rot, size)
    me = bpy.data.meshes.new('tmp'); tmp.to_mesh(me); tmp.free(); bm.from_mesh(me); bpy.data.meshes.remove(me)

def box(name, size, loc, rot=(0, 0, 0), mat=None, bev=.012, parent=None):
    bm = bmesh.new(); add_box(bm, size, loc, rot)
    return finish(name, bm, mat or M_PAINT, bev, parent=parent)

def cyl(name, r, depth, loc, rot=(0, 0, 0), mat=None, r2=None, seg=32, bev=.006, parent=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r,
                          radius2=r if r2 is None else r2, depth=depth)
    xform(bm, loc, rot)
    return finish(name, bm, mat or M_PAINT, bev, parent=parent)

def annulus(name, r_out, r_in, depth, loc, rot, mat, seg=48, bev=.006, parent=None):
    bm = bmesh.new(); rings = []
    for zz in (-depth / 2, depth / 2):
        for r in (r_out, r_in):
            rings.append([bm.verts.new((r * math.cos(2 * math.pi * i / seg), r * math.sin(2 * math.pi * i / seg), zz)) for i in range(seg)])
    ob_, ib_, ot_, it_ = rings
    for i in range(seg):
        j = (i + 1) % seg
        bm.faces.new((ot_[i], ot_[j], it_[j], it_[i])); bm.faces.new((ob_[i], ib_[i], ib_[j], ob_[j]))
        bm.faces.new((ob_[i], ob_[j], ot_[j], ot_[i])); bm.faces.new((ib_[i], it_[i], it_[j], ib_[j]))
    xform(bm, loc, rot)
    return finish(name, bm, mat, bev, parent=parent)

AX = (0, math.pi / 2, 0)      # cylinder axis along X
AY = (math.pi / 2, 0, 0)      # cylinder axis along Y

def prism(name, prof, x0, x1, mat=None, bev=.015, parent=None):
    """Side profile (y, z) extruded across X."""
    bm = bmesh.new()
    a = [bm.verts.new((x0, y, z)) for y, z in prof]
    b = [bm.verts.new((x1, y, z)) for y, z in prof]
    bm.faces.new(a); bm.faces.new(b[::-1])
    n = len(prof)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))
    return finish(name, bm, mat or M_PAINT, bev, parent=parent)

def bent_plate(name, pts, x0, x1, t=.012, mat=None):
    """Thin plate following a (y, z) polyline, extruded across X."""
    outer, inner = [], []
    for i, p in enumerate(pts):
        a, b = pts[max(i - 1, 0)], pts[min(i + 1, len(pts) - 1)]
        dy, dz = b[0] - a[0], b[1] - a[1]; L = math.hypot(dy, dz)
        ny, nz = -dz / L, dy / L
        outer.append((p[0] + ny * t / 2, p[1] + nz * t / 2)); inner.append((p[0] - ny * t / 2, p[1] - nz * t / 2))
    return prism(name, outer + inner[::-1], x0, x1, mat, bev=.004)

def smooth_outline(ctrl, n_per=6):
    """Closed Catmull-Rom spline through control points."""
    out = []; N = len(ctrl)
    for i in range(N):
        p0, p1, p2, p3 = ctrl[i - 1], ctrl[i], ctrl[(i + 1) % N], ctrl[(i + 2) % N]
        for k in range(n_per):
            t = k / n_per; t2 = t * t; t3 = t2 * t
            out.append(tuple(.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2
                                   + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3) for j in (0, 1)))
    return out

def loft(name, outline, levels, center, mat, parent=None, subsurf=1):
    """levels: (z, scale_x, scale_front, scale_rear); front = -Y."""
    bm = bmesh.new(); rings = []
    cx, cy, cz = center
    for z, sx, sf, sr in levels:
        rings.append([bm.verts.new((cx + x * sx, cy + y * (sf if y < 0 else sr), cz + z)) for x, y in outline])
    n = len(outline)
    for r0, r1 in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((r0[i], r0[j], r1[j], r1[i]))
    for ring, z in ((rings[0], levels[0][0]), (rings[-1], levels[-1][0])):
        c = bm.verts.new((cx, cy, cz + z))
        for i in range(n):
            bm.faces.new((ring[i], ring[(i + 1) % n], c))
    ob = finish(name, bm, mat, bev=0, parent=parent)
    if subsurf:
        m = ob.modifiers.new('Subsurf', 'SUBSURF'); m.levels = subsurf; m.render_levels = subsurf
    return ob

def circle(r, n=24):
    return [(r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n)) for i in range(n)]

def tube(name, pts, r, mat=None, parent=None, cyclic=False):
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'
    cu.bevel_depth = r; cu.bevel_resolution = 3; cu.use_fill_caps = True
    sp = cu.splines.new('POLY'); sp.points.add(len(pts) - 1)
    for p, c in zip(sp.points, pts): p.co = (*c, 1)
    sp.use_cyclic_u = cyclic
    ob = bpy.data.objects.new(name, cu); COL.objects.link(ob)
    cu.materials.append(mat or M_DARK); ob.parent = parent or ROOT
    return ob

def bolts(prefix, pts, r=.022, h=.02, axis=(0, 0, 0), mat=None, parent=None):
    bm = bmesh.new()
    for p in pts:
        tmp = bmesh.new()
        bmesh.ops.create_cone(tmp, cap_ends=True, segments=6, radius1=r, radius2=r * .8, depth=h)
        xform(tmp, p, axis)
        me = bpy.data.meshes.new('tmp'); tmp.to_mesh(me); tmp.free(); bm.from_mesh(me); bpy.data.meshes.remove(me)
    return finish(prefix, bm, mat or M_PAINT, bev=0, parent=parent)

def surface(ob, origin, direction):
    """Ray-cast against the evaluated (modified) mesh: returns (point, normal) in world space."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg); mw = ob.matrix_world; inv = mw.inverted()
    hit, loc, nor, _ = ev.ray_cast(inv @ Vector(origin), (inv.to_3x3() @ Vector(direction)).normalized())
    assert hit, f'no surface on {ob.name} from {origin}'
    return mw @ loc, (mw.to_3x3() @ nor).normalized()

def rail(name, ob, anchors, off=.06, r=.013, mat=None, legs=(0, -1)):
    """Grab rail standing off a surface; anchors = [(origin, direction)], legs at chosen anchors."""
    hits = [surface(ob, o, d) for o, d in anchors]
    pts = [tuple(p + n * off) for p, n in hits]
    tube(name, pts, r, mat or M_PAINT, parent=ob.parent)
    for k in legs:
        p, n = hits[k]
        tube(f'{name} leg {k}', [tuple(p - n * .01), tuple(p + n * off)], r, mat or M_PAINT, parent=ob.parent)

# ---------------------------------------------------------------- hull
ROOF = 1.46
lower = [(-2.6, .43), (2.82, .43), (3.02, 1.25), (2.78, ROOF), (-2.37, ROOF), (-3.03, 1.08)]
HULL_L = prism('Hull lower', lower, -1.05, 1.05, bev=.02)
upper = [(-2.997, 1.03), (2.973, 1.03), (3.02, 1.25), (2.78, ROOF), (-2.37, ROOF), (-3.03, 1.08)]
HULL = prism('Hull upper', upper, -1.21, 1.21, bev=.02)

M_WELD = worn_material('Weld', GREEN, cast=True, bump=.25)
def weld(name, a, b, r=.016):
    n = max(2, int(math.dist(a, b) / .05))
    tube(name, [tuple(a[k] + (b[k] - a[k]) * i / n for k in range(3)) for i in range(n + 1)], r, M_WELD)
weld('Weld glacis top', (-1.2, -2.37, ROOF), (1.2, -2.37, ROOF))
weld('Weld nose', (-1.2, -3.03, 1.08), (1.2, -3.03, 1.08))
weld('Weld rear', (-1.2, 2.78, ROOF), (1.2, 2.78, ROOF))
for s in (-1, 1):
    weld(f'Weld glacis side {s}', (s * 1.21, -3.03, 1.08), (s * 1.21, -2.37, ROOF))
    weld(f'Weld roof side {s}', (s * 1.21, -2.37, ROOF), (s * 1.21, 2.78, ROOF))
    weld(f'Weld rear side {s}', (s * 1.21, 2.78, ROOF), (s * 1.21, 3.02, 1.25))

# running gear layout (from the side-view drawing: 5 evenly spaced wheels, rear sprocket, front idler)
TX, WR, WZ = 1.34, .415, .485
WHEELS = [-2.12 + i * 1.06 for i in range(5)]
IDLER = (-2.93, .62, .3)
SPROCKET = (2.9, .64, .32)
FZ = 1.03          # fender height
F0, F1 = -3.2, 3.15

# fenders with curved mudguards front and rear
for s in (-1, 1):
    x0, x1 = s * 1.2, s * 1.63
    lo, hi = min(x0, x1), max(x0, x1)
    box(f'Fender {s}', (.43, F1 - F0, .012), (s * 1.415, (F0 + F1) / 2, FZ), bev=.003)
    fr = [(IDLER[0] - .48 * math.cos(math.radians(a)), IDLER[1] + .48 * math.sin(math.radians(a))) for a in range(58, -22, -8)]
    bent_plate(f'Mudguard front {s}', fr, lo, hi)
    rr = [(SPROCKET[0] + .48 * math.cos(math.radians(a)), SPROCKET[1] + .48 * math.sin(math.radians(a))) for a in range(58, -8, -8)]
    bent_plate(f'Mudguard rear {s}', rr, lo, hi)
    box(f'Fender lip {s}', (.012, F1 - F0, .07), (s * 1.632, (F0 + F1) / 2, FZ - .03), bev=.003)
    for y in (-2.3, -1.0, .3, 1.6, 2.6):
        box(f'Fender bracket {s}{y}', (.4, .025, .09), (s * 1.41, y, FZ - .05), bev=.004)

# stowage boxes along the fenders (lids with stamped X), positions from the top-view drawing
def stowbox(name, x, y, L, w=.4, h=.3):
    zc = FZ + .006 + h / 2
    box(name, (w, L, h), (x, y, zc), bev=.014)
    box(f'{name} lid', (w + .02, L + .02, .025), (x, y, zc + h / 2), bev=.008)
    d = math.hypot(L, w) * .82; a = math.atan2(w, L)
    for sgn in (-1, 1):
        box(f'{name} X{sgn}', (.03, d, .012), (x, y, zc + h / 2 + .016), (0, 0, sgn * a), bev=.004)
    xs = x + (.21 if x > 0 else -.21)
    for k in (-1, 1):
        box(f'{name} latch {k}', (.02, .06, .08), (xs, y + k * L * .3, zc + .05), mat=M_DARK, bev=.004)
for i, (y, L) in enumerate(((2.07, 1.0), (.9, 1.05), (-.38, .28), (-.7, .28), (-1.44, 1.05))):
    stowbox(f'Box L{i}', 1.41, y, L)
for i, (y, L) in enumerate(((.54, 1.3), (-.86, 1.2), (-1.8, .42), (-2.3, .42))):
    stowbox(f'Box R{i}', -1.41, y, L)
cyl('Fuel drum', .22, .95, (-1.41, 2.15, FZ + .23), AY, seg=40, bev=.01)
for y in (1.92, 2.38):
    cyl(f'Drum strap {y}', .228, .035, (-1.41, y, FZ + .23), AY, mat=M_DARK, seg=40)
cyl('Drum cap', .05, .04, (-1.41, 2.64, FZ + .3), AY, mat=M_DARK)
box('Tool shovel blade', (.02, .26, .2), (1.635, .1, FZ + .14), mat=M_DARK, bev=.004)

# glacis: splash board, hull MG, grab handles, tow hooks
box('Splash board', (2.02, .014, .15), (0, -2.9, 1.2), (math.radians(-38), 0, 0), bev=.004)
for s in (-1, 1):
    box(f'Splash brace {s}', (.02, .1, .1), (s * .7, -2.85, 1.17), (math.radians(-38), 0, 0), bev=.003)
GZ = lambda y: 1.08 + (y + 3.03) / .66 * .38          # glacis height at y
cyl('Hull MG ball', .07, .1, (-.55, -2.66, GZ(-2.66)), (math.radians(60), 0, 0), mat=M_DARK)
cyl('Hull MG barrel', .018, .22, (-.55, -2.75, GZ(-2.66) - .05), (math.radians(60), 0, 0), mat=M_DARK)
for s in (-1, 1):
    rail(f'Glacis handle {s}', HULL, [((s * .75 + dx, -6, 1.36), (0, 1, 0)) for dx in (-.12, 0, .12)], off=.05, r=.012)
    cyl(f'Tow hook front {s}', .09, .08, (s * .78, -2.84, .75), AX, mat=M_DARK)
    cyl(f'Tow hook rear {s}', .09, .08, (s * .78, 2.99, .75), AX, mat=M_DARK)
    cable = [(s * 1.222, y, z) for y, z in ((-1.5, 1.37), (-.4, 1.42), (1.2, 1.42), (2.3, 1.4), (2.45, 1.37), (2.3, 1.35), (1.2, 1.37), (-.4, 1.37), (-1.5, 1.35))]
    tube(f'Tow cable {s}', cable, .015, M_DARK)
    for y in (-1.55, 2.5):
        cyl(f'Cable clamp {s}{y}', .028, .04, (s * 1.215, y, 1.38), AX, mat=M_DARK)
# driver's hatch and periscope (hull roof, front left)
cyl('Driver hatch', .21, .05, (.62, -1.92, ROOF + .02), seg=40, bev=.01)
bolts('Driver hatch bolts', [(.62 + .18 * math.cos(a), -1.92 + .18 * math.sin(a), ROOF + .05) for a in [i * math.pi / 4 for i in range(8)]], r=.013)
box('Driver hatch hinge', (.06, .1, .05), (.86, -1.92, ROOF + .03), mat=M_DARK, bev=.008)
box('Driver periscope', (.2, .09, .09), (.62, -2.25, ROOF + .04), (math.radians(-25), 0, 0), mat=M_DARK, bev=.01)
box('Driver periscope glass', (.15, .01, .045), (.62, -2.3, ROOF + .04), (math.radians(-25), 0, 0), mat=M_GLASS, bev=0)
# headlight with guard + horn on the left front fender
cyl('Headlight', .085, .14, (1.32, -2.78, 1.15), AY, mat=M_DARK)
cyl('Headlight lens', .07, .01, (1.32, -2.855, 1.15), AY, mat=M_LENS, bev=0)
box('Headlight stand', (.04, .04, .12), (1.32, -2.76, 1.07), mat=M_DARK)
tube('Headlight guard', [(1.22, -2.66, 1.04), (1.22, -2.95, 1.2), (1.42, -2.95, 1.2), (1.42, -2.66, 1.04)], .012, M_PAINT)
cyl('Horn', .05, .12, (1.12, -2.78, 1.09), AY, mat=M_DARK, r2=.07)
# engine deck (from the top view): side access plates, louvre panel, rear grille
for s in (-1, 1):
    box(f'Access plate {s}', (.55, .4, .025), (s * .6, 1.55, ROOF + .012), bev=.006)
    bolts(f'Access bolts {s}', [(s * .6 + dx, 1.55 + dy, ROOF + .03) for dx in (-.24, .24) for dy in (-.17, 0, .17)], r=.012)
box('Louvre frame', (1.75, .78, .05), (0, 2.08, ROOF + .02), bev=.01)
for i in range(8):
    box(f'Louvre {i}', (1.65, .085, .012), (0, 1.76 + i * .092, ROOF + .055), (math.radians(28), 0, 0), bev=.002)
box('Rear grille frame', (1.25, .3, .04), (0, 2.6, ROOF + .015), mat=M_DARK, bev=.006)
bm = bmesh.new()
for i in range(13):
    add_box(bm, (.012, .26, .02), (-.57 + i * .095, 2.6, ROOF + .04))
for i in range(4):
    add_box(bm, (1.2, .012, .02), (0, 2.49 + i * .072, ROOF + .045))
finish('Rear grille mesh', bm, M_DARK, bev=0)
# rear plate: exhausts with deflectors, tail lights
for s in (-1, 1):
    cyl(f'Exhaust {s}', .075, .3, (s * .62, 2.98, 1.32), AY, mat=M_DARK, r2=.065)
    box(f'Exhaust deflector {s}', (.3, .02, .2), (s * .62, 3.15, 1.3), (math.radians(20), 0, 0), mat=M_DARK, bev=.004)
    cyl(f'Tail light {s}', .045, .06, (s * .9, 3.0, 1.15), AY, mat=M_DARK)

# ---------------------------------------------------------------- running gear
def spoked_wheel(name, s, y, r, z, spokes=10):
    for k, dx in enumerate((-.13, .13)):
        x = s * TX + dx
        annulus(f'{name} tyre {k}', r, r * .86, .17, (x, y, z), AX, M_RUBBER, seg=56, bev=.02)
        annulus(f'{name} rim {k}', r * .865, r * .74, .17, (x, y, z), AX, M_WHEEL, seg=56, bev=.008)
        cyl(f'{name} dish {k}', r * .745, .09, (x, y, z), AX, mat=M_WHEEL, seg=48, bev=.004)
    xo = s * (TX + .13)
    bm = bmesh.new()
    for i in range(spokes):
        a = i * 2 * math.pi / spokes
        rr_ = r * .48
        add_box(bm, (.035, r * .56, .05), (xo + s * .058, y + rr_ * math.cos(a), z + rr_ * math.sin(a)), (a, 0, 0))
    finish(f'{name} spokes', bm, M_WHEEL, bev=.008)
    cyl(f'{name} hub', r * .23, .25, (xo + s * .03, y, z), AX, mat=M_WHEEL, seg=24, bev=.012)
    cyl(f'{name} cap', r * .13, .08, (xo + s * .17, y, z), AX, mat=M_DARK, seg=6, bev=.006)
    bolts(f'{name} bolts', [(xo + s * .155, y + r * .18 * math.cos(a), z + r * .18 * math.sin(a)) for a in [i * math.pi / 3 for i in range(6)]],
          r=.011, h=.025, axis=AX, mat=M_DARK)

for s in (-1, 1):
    for i, y in enumerate(WHEELS):
        spoked_wheel(f'Wheel {s} {i}', s, y, WR, WZ)
        box(f'Torsion arm {s} {i}', (.08, .42, .09), (s * 1.08, y + .17, WZ + .08), (math.radians(-20), 0, 0), mat=M_DARK)
    spoked_wheel(f'Idler {s}', s, IDLER[0], IDLER[2], IDLER[1], spokes=8)
    box(f'Idler crank {s}', (.1, .3, .12), (s * 1.1, IDLER[0] + .12, IDLER[1] + .05), mat=M_DARK)
    y, z, r = SPROCKET[0], SPROCKET[1], SPROCKET[2]
    for k, dx in enumerate((-.17, .17)):
        cyl(f'Sprocket ring {s}{k}', r * .9, .07, (s * TX + dx, y, z), AX, mat=M_WHEEL, seg=48)
        bm = bmesh.new()
        for t in range(14):
            a = t * 2 * math.pi / 14
            add_box(bm, (.07, .11, .075), (s * TX + dx, y + r * math.cos(a), z + r * math.sin(a)), (a, 0, 0))
        finish(f'Sprocket teeth {s}{k}', bm, M_WHEEL, bev=.01)
        bm = bmesh.new()
        for t in range(6):
            a = t * math.pi / 3 + .3
            add_box(bm, (.06, .06, r * .5), (s * TX + dx * 1.15, y + r * .5 * math.cos(a), z + r * .5 * math.sin(a)), (a - math.pi / 2, 0, 0))
        finish(f'Sprocket spokes {s}{k}', bm, M_WHEEL, bev=.01)
    cyl(f'Sprocket hub {s}', r * .4, .5, (s * TX, y, z), AX, mat=M_WHEEL)
    cyl(f'Sprocket cap {s}', r * .22, .62, (s * TX, y, z), AX, mat=M_DARK, seg=8)

TT = .035
def arc(c, r, a0, a1, n):
    return [(c[0] + r * math.cos(a0 + (a1 - a0) * i / n), c[1] + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]
path = [(y, TT) for y in (WHEELS[0], WHEELS[-1])]
path += arc((SPROCKET[0], SPROCKET[1]), SPROCKET[2] + TT + .01, math.radians(-115), math.radians(95), 14)
top = WZ + WR + TT
tops = [(WHEELS[-1] + .45, top - .02)]
for i in range(len(WHEELS) - 1, -1, -1):
    tops.append((WHEELS[i], top))
    if i: tops.append(((WHEELS[i] + WHEELS[i - 1]) / 2, top - .05))
path += tops
path += arc((IDLER[0], IDLER[1]), IDLER[2] + TT + .03, math.radians(80), math.radians(255), 12)

def resample(pts, step):
    seg = []; L = 0
    for a, b in zip(pts, pts[1:] + pts[:1]):
        d = math.dist(a, b); seg.append((a, b, L, d)); L += d
    n = round(L / step); step = L / n; out = []; k = 0
    for i in range(n):
        t = i * step
        while seg[k][2] + seg[k][3] < t: k += 1
        a, b, l0, d = seg[k]
        f = (t - l0) / d if d else 0
        out.append(((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f), (b[0] - a[0]) / d, (b[1] - a[1]) / d))
    return out

# T-54 style link: two shoe halves with a window between, grouser, pin bosses, guide horn on every 2nd link
LINK = [(-.065, .065, -.022, .022, -.26, -.03), (-.065, .065, -.022, .022, .03, .26),
        (-.065, -.025, -.022, .022, -.03, .03), (-.018, .018, .022, .046, -.25, .25),
        (-.075, -.045, -.026, .018, -.275, .275)]
HORN = (-.032, .032, -.11, -.022, -.035, .035)
for s in (-1, 1):
    bm = bmesh.new()
    for i, ((y, z), ty, tz) in enumerate(resample(path, .14)):
        for u0, u1, v0, v1, w0, w1 in LINK + ([HORN] if i % 2 == 0 else []):
            vs = [bm.verts.new((s * TX + w, y + u * ty + v * tz, z + u * tz - v * ty)) for u, v, w in
                  [(u0, v0, w0), (u1, v0, w0), (u1, v1, w0), (u0, v1, w0), (u0, v0, w1), (u1, v0, w1), (u1, v1, w1), (u0, v1, w1)]]
            for f in ((0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)):
                bm.faces.new([vs[j] for j in f])
    finish(f'Track {s}', bm, M_TRACK, bev=.005, seg=1)

# ---------------------------------------------------------------- turret (outline from the top-view drawing)
TUR = bpy.data.objects.new('Turret', None); COL.objects.link(TUR); TUR.parent = ROOT
TC = (0., -.05, ROOF)
half = [(0, -1.53), (.38, -1.5), (.6, -1.3), (.84, -.65), (1.0, -.1), (1.04, .35), (.98, .85), (.78, 1.18), (.42, 1.33)]
ctrl = half + [(0, 1.36)] + [(-x, y) for x, y in half[:0:-1]]
outline = smooth_outline(ctrl, 5)
levels = [(0, 1.0, 1.0, 1.0), (.03, 1.03, 1.025, 1.02), (.09, 1.03, 1.025, 1.02), (.12, 1.0, 1.0, 1.0), (.35, .99, .97, 1.0),
          (.52, .96, .9, .99), (.62, .92, .82, .97), (.69, .86, .74, .93), (.72, .8, .68, .88)]
TB = loft('Turret body', outline, levels, TC, M_CAST, parent=TUR, subsurf=1)
loft('Turret ring guard', circle(1.0, 48), [(-.06, 1, 1, 1), (.02, 1, 1, 1)], (0, -.05, ROOF), M_CAST, parent=TUR, subsurf=0)
def roof(x, y):
    return surface(TB, (x, y, ROOF + 3), (0, 0, -1))[0].z - .01
MZ = ROOF + .35
box('Mantlet', (.86, .42, .5), (0, -1.6, MZ - .02), mat=M_CAST, bev=.15, parent=TUR)
box('Mantlet base', (.98, .16, .56), (0, -1.45, MZ - .03), mat=M_CAST, bev=.06, parent=TUR)
cyl('Gun sleeve', .14, .4, (0, -1.98, MZ), AY, mat=M_CAST, r2=.125, seg=40, parent=TUR)
cyl('Gun barrel', .092, 2.35, (0, -3.355, MZ), AY, mat=M_PAINT, r2=.078, seg=40, bev=.004, parent=TUR)
cyl('Gun muzzle swell', .088, .14, (0, -4.47, MZ), AY, mat=M_PAINT, seg=40, bev=.01, parent=TUR)
cyl('Gun bore', .043, .02, (0, -4.545, MZ), AY, mat=M_GLASS, seg=24, bev=0, parent=TUR)
cyl('Coax MG', .022, .3, (-.3, -1.82, MZ - .02), AY, mat=M_DARK, parent=TUR)
box('Gunner sight', (.08, .12, .08), (.3, -1.78, MZ + .07), mat=M_DARK, parent=TUR)
# roof equipment, each item seated on the real roof height
cx, cy = -.38, .3                              # commander's cupola (rear right, as in both drawings)
z0 = roof(cx, cy)
cyl('Cupola', .36, .24, (cx, cy, z0 + .12), mat=M_CAST, seg=48, bev=.02, parent=TUR)
for k in range(7):
    a = math.radians(-90 + k * 30)
    box(f'Cupola block {k}', (.11, .05, .07), (cx + .365 * math.sin(a), cy - .365 * math.cos(a), z0 + .16), (0, 0, -a), mat=M_GLASS, bev=.005, parent=TUR)
cyl('Cupola hatch', .28, .05, (cx, cy + .03, z0 + .265), mat=M_CAST, seg=40, bev=.012, parent=TUR)
box('Cupola hinge', (.12, .07, .06), (cx, cy + .3, z0 + .27), mat=M_DARK, bev=.01, parent=TUR)
box('Cupola periscope', (.11, .13, .13), (cx, cy - .14, z0 + .33), mat=M_DARK, bev=.01, parent=TUR)
lx, ly = .45, -.05
cyl('Loader hatch', .26, .05, (lx, ly, roof(lx, ly) + .025), mat=M_CAST, seg=40, bev=.012, parent=TUR)
box('Loader hatch hinge', (.11, .07, .05), (lx, ly + .28, roof(lx, ly + .28) + .03), mat=M_DARK, bev=.01, parent=TUR)
for nm, (px, py) in (('Loader periscope', (.62, -.45)), ('Gunner periscope', (.25, -.75))):
    z = roof(px, py)
    box(nm, (.13, .12, .13), (px, py, z + .06), mat=M_DARK, bev=.01, parent=TUR)
    box(nm + ' guard', (.17, .03, .1), (px, py - .09, z + .05), mat=M_PAINT, bev=.006, parent=TUR)
vx, vy = .5, .6
loft('Vent dome', circle(.16, 24), [(0, 1, 1, 1), (.05, .95, .95, .95), (.09, .55, .55, .55)], (vx, vy, roof(vx, vy)), M_CAST, parent=TUR, subsurf=1)
ax_, ay_ = -.78, .72
cyl('Antenna base', .05, .1, (ax_, ay_, roof(ax_, ay_) + .05), mat=M_DARK, parent=TUR)
cyl('Antenna', .006, 2.4, (ax_, ay_, roof(ax_, ay_) + 1.25), mat=M_DARK, r2=.003, seg=8, bev=0, parent=TUR)
for s in (-1, 1):
    rail(f'Turret rail {s}', TB, [((s * 3, y, ROOF + .44), (-s, 0, 0)) for y in (-.75, -.35, .05, .45)], off=.06)
    lx2, ly2 = s * .55, -.95
    box(f'Lift eye {s}', (.04, .1, .07), (lx2, ly2, roof(lx2, ly2) + .03), mat=M_DARK, bev=.01, parent=TUR)
rail('Turret rear rail', TB, [((x, 4, ROOF + .36), (0, -1, 0)) for x in (-.55, -.18, .18, .55)], off=.06)
# turret number, projected onto the cast sides
for s in (-1, 1):
    bpy.ops.object.text_add(location=(s * 1.15, .15, ROOF + .26))
    t = bpy.context.object; t.data.body = '144'; t.data.size = .24; t.data.align_x = 'CENTER'; t.data.align_y = 'CENTER'
    t.data.extrude = .002
    t.rotation_euler = (math.pi / 2, 0, s * math.pi / 2)
    bpy.ops.object.convert(target='MESH')
    t.name = f'Number {s}'; t.data.materials.clear(); t.data.materials.append(M_WHITE)
    for c in t.users_collection: c.objects.unlink(t)
    COL.objects.link(t)
    sw = t.modifiers.new('Wrap', 'SHRINKWRAP'); sw.target = TB; sw.offset = .003
    sw.wrap_method = 'PROJECT'; sw.use_project_z = True; sw.use_negative_direction = True; sw.use_positive_direction = True
    t.parent = TUR

# ---------------------------------------------------------------- scene: ground, sky, cameras
bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 0, 0))
ground = bpy.context.object; ground.name = 'Ground'
for c in ground.users_collection: c.objects.unlink(ground)
bpy.context.scene.collection.objects.link(ground)
G = NT('Ground')
tc = G.n('ShaderNodeTexCoord'); out = G.n('ShaderNodeOutputMaterial'); bsdf = G.n('ShaderNodeBsdfPrincipled')
G.link(bsdf.outputs[0], out.inputs['Surface'])
co = tc.outputs['Object']
m1 = G.mrange(G.noise(co, .35, 6), .4, .62)
m2 = G.mrange(G.noise(co, 2.5, 8), .35, .7)
ruts = G.mrange(G.noise(co, 14, 10, .7), .3, .75)
c = G.mixc(m1, lin((96, 76, 50)), lin((72, 84, 38)))
c = G.mixc(m2, c, lin((110, 96, 72)))
c = G.mixc(G.math('MULTIPLY', ruts, .35), c, lin((50, 42, 32)))
G.link(c, bsdf.inputs['Base Color']); bsdf.inputs['Roughness'].default_value = .95
bmp = G.n('ShaderNodeBump'); bmp.inputs['Strength'].default_value = .5; G.link(G.noise(co, 25, 12, .7), bmp.inputs['Height']); G.link(bmp.outputs['Normal'], bsdf.inputs['Normal'])
ground.data.materials.append(G.mat)

sc = bpy.context.scene
world = bpy.data.worlds.new('Sky'); sc.world = world; world.use_nodes = True
wn = world.node_tree.nodes; wl = world.node_tree.links
sky = wn.new('ShaderNodeTexSky'); sky.sky_type = 'MULTIPLE_SCATTERING'
sky.sun_elevation = math.radians(32); sky.sun_rotation = math.radians(215); sky.sun_disc = False
wl.new(sky.outputs[0], wn['Background'].inputs[0]); wn['Background'].inputs[1].default_value = .22
sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN')); sc.collection.objects.link(sun)
sun.data.energy = 4.6; sun.data.angle = math.radians(1.2); sun.data.color = (1., .95, .88)
sun.rotation_euler = Euler((math.radians(50), 0, math.radians(101)))

sc.render.engine = 'CYCLES'
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'OPTIX'; prefs.refresh_devices()
for d in prefs.devices: d.use = d.type == 'OPTIX'
sc.cycles.device = 'GPU'
sc.cycles.samples = 160; sc.cycles.use_denoising = True
sc.render.resolution_x, sc.render.resolution_y = 1600, 900
try:
    sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Medium High Contrast'
except Exception: pass

def camera(name, loc, target, lens=50):
    cam = bpy.data.objects.new(name, bpy.data.cameras.new(name)); sc.collection.objects.link(cam)
    cam.location = loc; cam.data.lens = lens
    d = Vector(target) - Vector(loc); cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    cam.data.dof.use_dof = True; cam.data.dof.focus_distance = d.length; cam.data.dof.aperture_fstop = 5.6
    return cam

CAMS = {
    'hero': camera('Cam hero', (6.2, -8.8, 2.0), (-.2, -.6, 1.05), 50),
    'rear': camera('Cam rear', (-6.5, 6.8, 4.4), (0, .2, 1.0), 45),
    'top': camera('Cam game', (2.5, 7.5, 16.0), (0, -.6, .8), 50),
    'detail': camera('Cam detail', (3.2, -3.4, 3.3), (.1, -.5, 1.9), 50),
}
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 't44.blend'))
if 'render' in ARGS:
    which = [a for a in ARGS if a in CAMS] or list(CAMS)
    for k in which:
        sc.camera = CAMS[k]
        sc.render.filepath = os.path.join(HERE, 'renders', f't44_{k}.png')
        bpy.ops.render.render(write_still=True)
print('DONE')
