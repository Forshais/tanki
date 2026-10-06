# Bake the procedural T-44 materials into textures and export a game-ready GLB.
# Run after t44_build.py:
#   blender -b modeli/t44.blend --python modeli/t44_export.py -- [stats]
import bpy, os, sys, math
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'web', 'assets', 't44.glb')
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
sc = bpy.context.scene
COL = bpy.data.collections['T44']
ROOT = bpy.data.objects['T44']
TUR = bpy.data.objects['Turret']
ROOF = 1.46
TURRET_PIVOT = (0., -.05, ROOF)
GUN_PIVOT = (0., -1.6, ROOF + .35)

if 'Ground' in bpy.data.objects:
    bpy.data.objects['Ground'].hide_render = True

def descendants(ob):
    out = []
    for c in ob.children:
        out.append(c); out += descendants(c)
    return out

def select(objs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]

# 1. curves/text/modifiers -> plain meshes, groups by part
geo = [o for o in COL.objects if o.type in ('MESH', 'CURVE', 'FONT')]
turret_set = set(descendants(TUR))
groups = {'gun': [], 'turret': [], 'track': [], 'hull': []}
for o in geo:
    if o in turret_set:
        groups['gun' if o.name.startswith('Gun') else 'turret'].append(o)
    elif o.name.startswith('Track'):
        groups['track'].append(o)
    else:
        groups['hull'].append(o)
select(geo)
bpy.ops.object.convert(target='MESH')
parts = {}
for name, objs in groups.items():
    objs = [bpy.data.objects[o.name] for o in objs]
    for o in objs:
        mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
    select(objs)
    if len(objs) > 1: bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = ob.data.name = name
    parts[name] = ob

def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)
stats = {k: tris(v) for k, v in parts.items()}
print('TRIS before', stats, sum(stats.values()))

# 2. reduce: bevelled detail is mostly baked into the normal map anyway
for name, ratio in (('track', .35), ('hull', .5), ('turret', .6)):
    ob = parts[name]
    m = ob.modifiers.new('Decimate', 'DECIMATE'); m.ratio = ratio; m.use_collapse_triangulate = True
    select([ob]); bpy.ops.object.modifier_apply(modifier='Decimate')
stats = {k: tris(v) for k, v in parts.items()}
print('TRIS after', stats, sum(stats.values()))
if 'stats' in ARGS:
    raise SystemExit

# 3. UV atlases: A = hull + tracks, B = turret + gun
ATLAS = {'A': (['hull', 'track'], 4096), 'B': (['turret', 'gun'], 2048)}
for key, (names, size) in ATLAS.items():
    objs = [parts[n] for n in names]
    for o in objs:
        while o.data.uv_layers: o.data.uv_layers.remove(o.data.uv_layers[0])
        o.data.uv_layers.new(name='UVMap')
    select(objs)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=.002, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(margin=.002, rotate=True)
    bpy.ops.object.mode_set(mode='OBJECT')

# 4. bake
sc.render.engine = 'CYCLES'
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'OPTIX'; prefs.refresh_devices()
for d in prefs.devices: d.use = d.type == 'OPTIX'
sc.cycles.device = 'GPU'
sc.cycles.samples = 24
bk = sc.render.bake
bk.margin = 6; bk.use_clear = True

def image(name, size, color=True):
    im = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    im.colorspace_settings.name = 'sRGB' if color else 'Non-Color'
    return im

def set_target(objs, im):
    for o in objs:
        for slot in o.material_slots:
            nt = slot.material.node_tree
            n = nt.nodes.get('BAKE') or nt.nodes.new('ShaderNodeTexImage')
            n.name = 'BAKE'; n.image = im; nt.nodes.active = n

def output_of(mat):
    return next(n for n in mat.node_tree.nodes if n.type == 'OUTPUT_MATERIAL')

def bsdf_of(mat):
    return next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')

def bake_metallic(objs, im):
    """Cycles has no metallic pass: route the metallic input through an emission shader."""
    saved = []
    for o in objs:
        for slot in o.material_slots:
            m = slot.material; nt = m.node_tree
            if any(s[0] == m for s in saved): continue
            out = output_of(m); b = bsdf_of(m)
            em = nt.nodes.new('ShaderNodeEmission')
            src = b.inputs['Metallic']
            if src.is_linked: nt.links.new(src.links[0].from_socket, em.inputs['Color'])
            else: em.inputs['Color'].default_value = (src.default_value,) * 3 + (1,)
            prev = out.inputs['Surface'].links[0].from_socket
            nt.links.new(em.outputs[0], out.inputs['Surface'])
            saved.append((m, prev, em))
    set_target(objs, im)
    bpy.ops.object.bake(type='EMIT')
    for m, prev, em in saved:
        m.node_tree.links.new(prev, output_of(m).inputs['Surface']); m.node_tree.nodes.remove(em)

baked = {}
for key, (names, size) in ATLAS.items():
    objs = [parts[n] for n in names]
    select(objs)
    col, rough, metal, nrm = image(f'{key}_color', size), image(f'{key}_rough', size, False), image(f'{key}_metal', size, False), image(f'{key}_normal', size, False)
    set_target(objs, col)
    bk.use_pass_direct = False; bk.use_pass_indirect = False; bk.use_pass_color = True
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'})
    set_target(objs, rough); bpy.ops.object.bake(type='ROUGHNESS')
    bake_metallic(objs, metal)
    set_target(objs, nrm); bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT')
    # pack roughness (G) + metallic (B) into one glTF metallicRoughness map
    orm = image(f'{key}_orm', size, False)
    r = np.array(rough.pixels[:]).reshape(-1, 4); mtl = np.array(metal.pixels[:]).reshape(-1, 4)
    px = np.ones_like(r); px[:, 1] = r[:, 0]; px[:, 2] = mtl[:, 0]
    orm.pixels = px.ravel().tolist()
    baked[key] = (col, orm, nrm)
    print('BAKED', key)

# 5. final game materials
for key, (names, size) in ATLAS.items():
    col, orm, nrm = baked[key]
    m = bpy.data.materials.new(f'T44_{key}')
    nt = m.node_tree; b = bsdf_of(m)
    tc = nt.nodes.new('ShaderNodeTexImage'); tc.image = col
    to = nt.nodes.new('ShaderNodeTexImage'); to.image = orm
    tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = nrm
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(tc.outputs[0], b.inputs['Base Color'])
    nt.links.new(to.outputs[0], sep.inputs[0])
    nt.links.new(sep.outputs[1], b.inputs['Roughness']); nt.links.new(sep.outputs[2], b.inputs['Metallic'])
    nt.links.new(tn.outputs[0], nm.inputs['Color']); nt.links.new(nm.outputs[0], b.inputs['Normal'])
    for n in names:
        ob = parts[n]; ob.data.materials.clear(); ob.data.materials.append(m)

# 6. hierarchy with proper pivots: T44 > hull, track, turret > gun
def set_origin(ob, p):
    sc.cursor.location = p; select([ob]); bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
set_origin(parts['turret'], TURRET_PIVOT)
set_origin(parts['gun'], GUN_PIVOT)
for n in ('hull', 'track', 'turret'):
    parts[n].parent = ROOT
mw = parts['gun'].matrix_world.copy(); parts['gun'].parent = parts['turret']; parts['gun'].matrix_world = mw
for o in list(COL.objects):
    if o not in parts.values() and o is not ROOT:
        bpy.data.objects.remove(o)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
select([ROOT] + list(parts.values()), ROOT)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True,
                          export_image_format='JPEG', export_jpeg_quality=88, export_yup=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 't44_game.blend'))
print('EXPORTED', OUT, os.path.getsize(OUT))
