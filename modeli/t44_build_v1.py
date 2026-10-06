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
M_WHITE = worn_material('Paint white', lin((214, 210, 196)), dust=.6, edge_wear=1.4)
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

def box(name, size, loc, rot=(0, 0, 0), mat=None, bev=.012, parent=None):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.)
    xform(bm, loc, rot, size)
    return finish(name, bm, mat or M_PAINT, bev, parent=parent)

def cyl(name, r, depth, loc, rot=(0, 0, 0), mat=None, r2=None, seg=32, bev=.006, parent=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r,
                          radius2=r if r2 is None else r2, depth=depth)
    xform(bm, loc, rot)
    return finish(name, bm, mat or M_PAINT, bev, parent=parent)

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

def loft(name, outline, levels, center, mat, parent=None, subsurf=2):
    bm = bmesh.new(); rings = []
    cx, cy, cz = center
    for z, s in levels:
        rings.append([bm.verts.new((cx + x * s, cy + y * s, cz + z)) for x, y in outline])
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

# ---------------------------------------------------------------- hull
ROOF = 1.62
lower = [(-2.6, .43), (2.82, .43), (3.02, 1.25), (2.78, ROOF), (-1.87, ROOF), (-3.03, .95)]
prism('Hull lower', lower, -1.05, 1.05, bev=.02)
upper = [(-2.909, 1.03), (2.973, 1.03), (3.02, 1.25), (2.78, ROOF), (-1.87, ROOF)]
prism('Hull upper', upper, -1.21, 1.21, bev=.02)
# weld seams along the armour plate joints
M_WELD = worn_material('Weld', GREEN, cast=True, bump=.25)
def weld(name, a, b, r=.016):
    n = max(2, int(math.dist(a, b) / .05))
    tube(name, [tuple(a[k] + (b[k] - a[k]) * i / n for k in range(3)) for i in range(n + 1)], r, M_WELD)
weld('Weld glacis top', (-1.2, -1.87, ROOF), (1.2, -1.87, ROOF))
weld('Weld nose', (-1.04, -3.03, .95), (1.04, -3.03, .95))
weld('Weld rear', (-1.2, 2.78, ROOF), (1.2, 2.78, ROOF))
for s in (-1, 1):
    weld(f'Weld glacis side {s}', (s * 1.21, -2.909, 1.03), (s * 1.21, -1.87, ROOF))
    weld(f'Weld roof side {s}', (s * 1.21, -1.87, ROOF), (s * 1.21, 2.78, ROOF))
    weld(f'Weld rear side {s}', (s * 1.21, 2.78, ROOF), (s * 1.21, 3.02, 1.25))
# fenders (thin plates over the tracks) and front mudguards
for s in (-1, 1):
    x = s * 1.41
    box(f'Fender {s}', (.42, 5.9, .012), (x, -.02, 1.03), bev=.003)
    box(f'Mudguard front {s}', (.42, .42, .012), (x, -3.15, .95), (math.radians(-22), 0, 0), bev=.003)
    box(f'Mudguard rear {s}', (.42, .3, .012), (x, 3.05, .98), (math.radians(18), 0, 0), bev=.003)
    box(f'Fender lip {s}', (.012, 5.9, .08), (s * 1.62, -.02, .995), bev=.003)
    for y in (-2.2, -.9, .4, 1.7):
        box(f'Fender bracket {s}{y}', (.36, .03, .1), (s * 1.39, y, .975), bev=.004)
# glacis details: driver's periscope area, hull MG, tow hooks, lower plate weld seam
box('Glacis seam', (2.1, .03, .03), (0, -3.03, .95), (math.radians(30), 0, 0), bev=.006)
cyl('Hull MG ball', .07, .1, (-.55, -2.62, 1.3), (math.radians(60), 0, 0), mat=M_DARK)
cyl('Hull MG barrel', .018, .25, (-.55, -2.72, 1.24), (math.radians(60), 0, 0), mat=M_DARK)
for s in (-1, 1):
    cyl(f'Tow hook front {s}', .09, .08, (s * .78, -2.95, .7), AX, mat=M_DARK)
    cyl(f'Tow hook rear {s}', .09, .08, (s * .78, 2.97, .75), AX, mat=M_DARK)
    tube(f'Tow cable {s}', [(s * 1.225, -1.6, 1.42), (s * 1.225, -.5, 1.47), (s * 1.225, 1.0, 1.47), (s * 1.225, 2.2, 1.42),
                           (s * 1.225, 2.5, 1.32), (s * 1.225, 2.2, 1.24), (s * 1.225, 1.0, 1.29), (s * 1.225, -.5, 1.29), (s * 1.225, -1.6, 1.24)], .016, M_DARK)
    for y in (-1.65, 2.55):
        cyl(f'Cable clamp {s}{y}', .03, .05, (s * 1.215, y, 1.33), AX, mat=M_DARK)
# driver's hatch and periscope (front left, in the hull roof)
cyl('Driver hatch', .3, .05, (.55, -1.45, ROOF + .02), seg=40, bev=.01)
bolts('Driver hatch bolts', [(.55 + .26 * math.cos(a), -1.45 + .26 * math.sin(a), ROOF + .05) for a in [i * math.pi / 5 for i in range(10)]], r=.016)
box('Driver periscope', (.22, .1, .1), (.55, -1.78, ROOF + .05), (math.radians(-25), 0, 0), mat=M_DARK, bev=.01)
box('Driver periscope glass', (.17, .01, .05), (.55, -1.83, ROOF + .05), (math.radians(-25), 0, 0), mat=M_GLASS, bev=0)
# headlight with guard + horn on the left front fender
cyl('Headlight', .085, .14, (1.32, -2.7, 1.15), AY, mat=M_DARK)
cyl('Headlight lens', .07, .01, (1.32, -2.775, 1.15), AY, mat=M_LENS, bev=0)
box('Headlight stand', (.04, .04, .12), (1.32, -2.68, 1.07), mat=M_DARK)
tube('Headlight guard', [(1.22, -2.6, 1.04), (1.22, -2.86, 1.18), (1.42, -2.86, 1.18), (1.42, -2.6, 1.04)], .012, M_PAINT)
cyl('Horn', .05, .12, (1.15, -2.72, 1.09), AY, mat=M_DARK, r2=.07)
# engine deck: big access hatch, louvres, grilles, bolts
box('Engine hatch', (1.15, .95, .03), (0, 1.05, ROOF + .015), bev=.008)
bolts('Engine hatch bolts', [(x, y, ROOF + .035) for x in (-.54, .54) for y in [.62 + i * .17 for i in range(6)]], r=.014)
box('Louvre frame', (1.95, 1.18, .05), (0, 2.12, ROOF + .02), bev=.01)
for i in range(11):
    box(f'Louvre {i}', (1.85, .09, .012), (0, 1.58 + i * .107, ROOF + .055), (math.radians(28), 0, 0), bev=.002)
box('Grille', (1.95, .05, .2), (0, 2.73, ROOF - .03), (math.radians(-40), 0, 0), mat=M_DARK, bev=.004)
# rear plate: exhausts with deflectors, fuel drums on the rear fenders
for s in (-1, 1):
    cyl(f'Exhaust {s}', .075, .3, (s * .62, 2.97, 1.36), AY, mat=M_DARK, r2=.065)
    box(f'Exhaust deflector {s}', (.3, .02, .22), (s * .62, 3.14, 1.33), (math.radians(20), 0, 0), mat=M_DARK, bev=.004)
    cyl(f'Fuel drum {s}', .21, .95, (s * 1.41, 1.95, 1.255), AY, seg=40, bev=.01)
    for y in (1.72, 2.18):
        cyl(f'Drum strap {s}{y}', .218, .035, (s * 1.41, y, 1.255), AY, mat=M_DARK, seg=40)
    cyl(f'Drum cap {s}', .05, .04, (s * 1.41, 2.43, 1.33), AY, mat=M_DARK)
# stowage boxes and spare track links on the fenders
box('Stowage box R1', (.36, .95, .32), (-1.41, -1.7, 1.2), bev=.012)
box('Stowage box R2', (.36, .7, .32), (-1.41, -.55, 1.2), bev=.012)
box('Stowage box L', (.36, 1.05, .28), (1.41, -.4, 1.18), bev=.012)
for b in ('R1', 'R2', 'L'):
    pass
box('Tool shovel blade', (.02, .28, .22), (1.6, .75, 1.18), mat=M_DARK, bev=.004)
tube('Tool shovel handle', [(1.6, .9, 1.18), (1.6, 1.55, 1.18)], .018, M_PAINT)
box('Tool crowbar', (.04, 1.3, .04), (-1.6, .7, 1.1), mat=M_DARK, bev=.004)

# ---------------------------------------------------------------- running gear
TX = 1.34          # track centerline (x)
TW = .52           # track width
WR = .415          # road wheel radius
WZ = .485          # road wheel axle height
WHEELS = [-2.05 + i * .975 for i in range(5)]
IDLER = (-2.78, .62, .3)
SPROCKET = (2.74, .64, .32)

def road_wheel(name, s, y, r, z, parent=None):
    for k, dx in enumerate((-.135, .135)):
        x = s * TX + dx
        cyl(f'{name} tyre {k}', r, .2, (x, y, z), AX, mat=M_RUBBER, seg=48, bev=.02)
        cyl(f'{name} disc {k}', r * .8, .215, (x, y, z), AX, mat=M_WHEEL, seg=48, bev=.01)
        cyl(f'{name} rib {k}', r * .62, .23, (x, y, z), AX, mat=M_WHEEL, seg=48, bev=.01)
        cyl(f'{name} hub {k}', r * .25, .27, (x, y, z), AX, mat=M_WHEEL, seg=24, bev=.01)
    cyl(f'{name} cap', r * .17, .62, (s * TX, y, z), AX, mat=M_DARK, seg=16, bev=.008)
    bolts(f'{name} bolts', [(s * (TX + .25 * 1.0), y + r * .4 * math.cos(a), z + r * .4 * math.sin(a)) for a in [i * math.pi / 4 for i in range(8)]],
          r=.013, h=.03, axis=AX, mat=M_DARK)

for s in (-1, 1):
    for i, y in enumerate(WHEELS):
        road_wheel(f'Wheel {s} {i}', s, y, WR, WZ)
        box(f'Torsion arm {s} {i}', (.08, .4, .09), (s * 1.08, y + .17, WZ + .08), (math.radians(-20), 0, 0), mat=M_DARK)
    road_wheel(f'Idler {s}', s, IDLER[0], IDLER[2], IDLER[1])
    # drive sprocket: two toothed rings + hub
    y, z, r = SPROCKET[0], SPROCKET[1], SPROCKET[2]
    for k, dx in enumerate((-.17, .17)):
        cyl(f'Sprocket ring {s}{k}', r * .92, .07, (s * TX + dx, y, z), AX, mat=M_WHEEL, seg=48)
        bm = bmesh.new()
        for t in range(14):
            a = t * 2 * math.pi / 14
            tmp = bmesh.new(); bmesh.ops.create_cube(tmp, size=1.)
            xform(tmp, (s * TX + dx, y + r * math.cos(a), z + r * math.sin(a)), (a, 0, 0), (.07, .12, .07))
            me = bpy.data.meshes.new('tmp'); tmp.to_mesh(me); tmp.free(); bm.from_mesh(me); bpy.data.meshes.remove(me)
        finish(f'Sprocket teeth {s}{k}', bm, M_WHEEL, bev=.008)
    cyl(f'Sprocket hub {s}', r * .5, .5, (s * TX, y, z), AX, mat=M_WHEEL)
    cyl(f'Sprocket cap {s}', r * .3, .62, (s * TX, y, z), AX, mat=M_DARK)

# track path in the (y, z) plane: bottom run, sprocket wrap, top run resting on the wheels, idler wrap
TT = .035   # link half thickness (centerline offset from wheel surface)
def arc(c, r, a0, a1, n):
    return [(c[0] + r * math.cos(a0 + (a1 - a0) * i / n), c[1] + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]
path = []
path += [(y, TT) for y in (WHEELS[0], WHEELS[-1])]
path += arc((SPROCKET[0], SPROCKET[1]), SPROCKET[2] + TT + .01, math.radians(-115), math.radians(95), 14)
top = WZ + WR + TT
tops = [(WHEELS[-1] + .45, top - .02)]
for i in range(len(WHEELS) - 1, -1, -1):
    tops.append((WHEELS[i], top))
    if i: tops.append(((WHEELS[i] + WHEELS[i - 1]) / 2, top - .045))
path += tops
path += arc((IDLER[0], IDLER[1]), IDLER[2] + TT + .03, math.radians(80), math.radians(255), 12)

def resample(pts, step):
    seg = []; L = 0
    for a, b in zip(pts, pts[1:] + pts[:1]):
        d = math.dist(a, b); seg.append((a, b, L, d)); L += d
    n = round(L / step); step = L / n; out = []
    k = 0
    for i in range(n):
        t = i * step
        while seg[k][2] + seg[k][3] < t: k += 1
        a, b, l0, d = seg[k]
        f = (t - l0) / d if d else 0
        p = (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)
        out.append((p, (b[0] - a[0]) / d, (b[1] - a[1]) / d))
    return out

LINK_BOXES = [  # (u0,u1, v0,v1, w0,w1): u along track, v outward, w across
    (-.072, .072, -.024, .024, -.26, .26),     # shoe
    (-.022, .022, .024, .05, -.25, .25),       # grouser
    (-.08, -.05, -.02, .02, -.275, .275),      # hinge
]
HORN = (-.035, .035, -.11, -.024, -.04, .04)
for s in (-1, 1):
    bm = bmesh.new()
    links = resample(path, .158)
    for i, ((y, z), ty, tz) in enumerate(links):
        # local frame: u=(ty,tz) tangent, v=(tz,-ty) outward normal, w=x
        for bx in LINK_BOXES + ([HORN] if i % 2 == 0 else []):
            u0, u1, v0, v1, w0, w1 = bx
            vs = []
            for (u, v, w) in [(u0, v0, w0), (u1, v0, w0), (u1, v1, w0), (u0, v1, w0), (u0, v0, w1), (u1, v0, w1), (u1, v1, w1), (u0, v1, w1)]:
                vs.append(bm.verts.new((s * TX + w, y + u * ty + v * tz, z + u * tz - v * ty)))
            for f in ((0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)):
                bm.faces.new([vs[j] for j in f])
    finish(f'Track {s}', bm, M_TRACK, bev=.006, seg=1)

# ---------------------------------------------------------------- turret
TUR = bpy.data.objects.new('Turret', None); COL.objects.link(TUR); TUR.parent = ROOT
TC = (0., .12, ROOF)
outline = []
for i in range(56):
    a = i * 2 * math.pi / 56
    c, sn = math.cos(a), math.sin(a)
    L = 1.32 if c > 0 else 1.06
    narrow = 1 - .3 * max(0., -c) ** 1.6
    outline.append((1.04 * sn * narrow, L * c))
levels = [(0, 1.0), (.03, 1.045), (.08, 1.045), (.11, 1.0), (.32, .98), (.52, .94), (.64, .9), (.72, .84), (.76, .8)]
loft('Turret body', outline, levels, TC, M_CAST, parent=TUR, subsurf=1)
loft('Turret ring guard', [(math.cos(a) * 1.0, math.sin(a) * 1.0) for a in [i * math.pi / 24 for i in range(48)]], [(-.06, 1), (.02, 1)], (0, .12, ROOF), M_CAST, parent=TUR, subsurf=0)
# mantlet + gun (ZiS-S-53 85 mm)
MZ = ROOF + .37
box('Mantlet', (1.0, .42, .56), (0, -.98, MZ - .02), mat=M_CAST, bev=.17)
box('Mantlet base', (1.12, .2, .6), (0, -.84, MZ - .03), mat=M_CAST, bev=.06)
cyl('Gun sleeve', .14, .5, (0, -1.25, MZ), AY, mat=M_CAST, r2=.125, seg=40)
cyl('Gun barrel', .093, 3.25, (0, -1.25 - .25 - 1.625, MZ), AY, mat=M_PAINT, r2=.078, seg=40, bev=.004)
cyl('Gun muzzle swell', .088, .14, (0, -4.6, MZ), AY, mat=M_PAINT, seg=40, bev=.01)
cyl('Gun bore', .043, .02, (0, -4.67, MZ), AY, mat=bpy.data.materials.get('Glass'), seg=24, bev=0)
cyl('Coax MG', .022, .3, (-.32, -1.05, MZ - .02), AY, mat=M_DARK)
box('Gunner sight', (.08, .14, .08), (.3, -.95, MZ + .06), mat=M_DARK)
# roof: commander's cupola (rear left), loader's hatch, periscopes, vent dome, antenna, grab rails
TOP = ROOF + .76
cyl('Cupola', .37, .24, (.5, .62, TOP + .08), mat=M_CAST, seg=48, bev=.02)
for k in range(6):
    a = math.radians(-60 + k * 50)
    box(f'Cupola block {k}', (.12, .05, .07), (.5 + .375 * math.sin(a), .62 - .375 * math.cos(a), TOP + .1), (0, 0, -a), mat=M_GLASS, bev=.005)
cyl('Cupola hatch', .29, .05, (.5, .66, TOP + .23), mat=M_CAST, seg=40, bev=.012)
box('Cupola periscope', (.12, .14, .14), (.5, .45, TOP + .3), mat=M_DARK, bev=.01)
cyl('Loader hatch', .27, .05, (-.48, .55, TOP + .02), mat=M_CAST, seg=40, bev=.012)
box('Loader periscope', (.14, .12, .12), (-.48, .18, TOP + .05), mat=M_DARK, bev=.01)
box('Gunner periscope', (.14, .12, .12), (.45, -.15, TOP + .04), mat=M_DARK, bev=.01)
loft('Vent dome', [(math.cos(a) * .17, math.sin(a) * .17) for a in [i * math.pi / 12 for i in range(24)]], [(0, 1), (.06, .9), (.1, .5)], (0, 1.0, TOP - .03), M_CAST, parent=TUR, subsurf=1)
cyl('Antenna base', .05, .1, (-.82, .95, TOP - .1), mat=M_DARK)
cyl('Antenna', .006, 2.4, (-.82, .95, TOP + 1.15), mat=M_DARK, r2=.003, seg=8, bev=0)
for s in (-1, 1):
    tube(f'Turret rail {s}', [(s * .95, -.45, ROOF + .32), (s * 1.06, -.42, ROOF + .4), (s * 1.08, .45, ROOF + .4), (s * .98, .5, ROOF + .32)], .014, M_PAINT)
    cyl(f'Lift eye {s}', .05, .02, (s * .55, -.55, TOP + .01), mat=M_DARK, seg=16)
tube('Turret rear rail', [(-.6, 1.36, ROOF + .3), (-.6, 1.46, ROOF + .38), (.6, 1.46, ROOF + .38), (.6, 1.36, ROOF + .3)], .014, M_PAINT)
for ob in COL.objects:
    if ob is not TUR and ob.parent is ROOT and ob.name.split(' ')[0] in ('Gun', 'Coax', 'Gunner', 'Cupola', 'Loader', 'Antenna', 'Turret', 'Lift', 'Mantlet'):
        ob.parent = TUR
# turret number, shrink-wrapped onto the cast sides
for s in (-1, 1):
    bpy.ops.object.text_add(location=(s * 1.1, .35, ROOF + .24))
    t = bpy.context.object; t.data.body = '144'; t.data.size = .24; t.data.align_x = 'CENTER'; t.data.align_y = 'CENTER'
    t.data.extrude = .002
    t.rotation_euler = (math.pi / 2, 0, s * math.pi / 2)
    bpy.ops.object.convert(target='MESH')
    t.name = f'Number {s}'; t.data.materials.clear(); t.data.materials.append(M_WHITE)
    for c in t.users_collection: c.objects.unlink(t)
    COL.objects.link(t)
    sw = t.modifiers.new('Wrap', 'SHRINKWRAP'); sw.target = bpy.data.objects['Turret body']; sw.offset = .003
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
}
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 't44.blend'))
if 'render' in ARGS:
    which = [a for a in ARGS if a in CAMS] or list(CAMS)
    for k in which:
        sc.camera = CAMS[k]
        sc.render.filepath = os.path.join(HERE, 'renders', f't44_{k}.png')
        bpy.ops.render.render(write_still=True)
print('DONE')
