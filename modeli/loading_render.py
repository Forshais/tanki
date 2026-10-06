# Loading-screen picture: the T-44 from t44.blend in low evening light with a brick wall and bushes.
# Run: blender -b modeli/t44.blend --factory-startup --python modeli/loading_render.py -- [preview]
# Writes web/assets/loading.jpg (preview: modeli/renders/loading_preview.jpg).
import bpy, bmesh, math, os, sys, random
from mathutils import Vector, Euler

HERE = os.path.dirname(os.path.abspath(__file__))
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
PREVIEW = 'preview' in ARGS
sc = bpy.context.scene
rnd = random.Random(5)

def lin(c):
    return tuple(((v / 255) ** 2.2) for v in c) + (1,)

def mat(name, build):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs[0], out.inputs['Surface'])
    build(nt, bsdf); return m

# turret turned a little towards the camera
bpy.data.objects['Turret'].rotation_euler.z = math.radians(-24)

# ---- brick wall and steel blocks behind the tank
def brick(nt, bsdf):
    tc = nt.nodes.new('ShaderNodeTexCoord'); b = nt.nodes.new('ShaderNodeTexBrick')
    b.inputs['Scale'].default_value = 1.6; b.inputs['Mortar Size'].default_value = .012
    b.inputs['Color1'].default_value = lin((128, 54, 36)); b.inputs['Color2'].default_value = lin((96, 40, 28))
    b.inputs['Mortar'].default_value = lin((150, 142, 130))
    b.inputs['Brick Width'].default_value = .25; b.inputs['Row Height'].default_value = .068
    # walls are vertical: map bricks on (x + y, z) so the rows run horizontally on every face
    sep = nt.nodes.new('ShaderNodeSeparateXYZ'); add = nt.nodes.new('ShaderNodeMath'); add.operation = 'ADD'
    comb = nt.nodes.new('ShaderNodeCombineXYZ')
    nt.links.new(tc.outputs['Object'], sep.inputs[0]); nt.links.new(sep.outputs['X'], add.inputs[0]); nt.links.new(sep.outputs['Y'], add.inputs[1])
    nt.links.new(add.outputs[0], comb.inputs['X']); nt.links.new(sep.outputs['Z'], comb.inputs['Y'])
    nt.links.new(comb.outputs[0], b.inputs['Vector'])
    nt.links.new(b.outputs['Color'], bsdf.inputs['Base Color'])
    bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = .6
    nt.links.new(b.outputs['Fac'], bump.inputs['Height']); nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    bsdf.inputs['Roughness'].default_value = .9
BRICK = mat('LoadBrick', brick)
def steel(nt, bsdf):
    bsdf.inputs['Base Color'].default_value = lin((92, 98, 104)); bsdf.inputs['Metallic'].default_value = .6; bsdf.inputs['Roughness'].default_value = .45
STEEL = mat('LoadSteel', steel)

def box(name, loc, size, m, rot=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object; o.name = name; o.scale = size; o.rotation_euler.z = rot
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bv = o.modifiers.new('Bevel', 'BEVEL'); bv.width = .02; bv.segments = 2
    o.data.materials.append(m); return o

for k in range(9):
    h = 2.5 if k not in (6, 7) else (1.3 if k == 6 else .7)
    box(f'Wall{k}', (-12 + k * 1.0, 8.5, h / 2), (.98, .98, h), BRICK)
for k in range(5):
    box(f'Wall2_{k}', (-12.0, 8.5 - (k + 1) * 1.0, 1.25), (.98, .98, 2.5), BRICK)
for k in range(3):
    box(f'Steel{k}', (7.0 + k * 1.0, 11.0, 1.3), (1, 1, 2.6), STEEL)
# rubble from a shot-up wall
for k in range(14):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=.25 + rnd.random() * .2,
                                          location=(-5.5 + rnd.uniform(-1.4, 1.4), 7.4 + rnd.uniform(-1.2, .8), .1))
    o = bpy.context.object; o.scale = (1, 1, .6); o.rotation_euler = (rnd.random(), rnd.random(), rnd.random() * 6)
    o.data.materials.append(BRICK)

# ---- bushes: lumpy displaced spheres
def leaf(nt, bsdf):
    tc = nt.nodes.new('ShaderNodeTexCoord'); n = nt.nodes.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = 6
    nt.links.new(tc.outputs['Object'], n.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = lin((34, 52, 20)); ramp.color_ramp.elements[1].color = lin((78, 98, 40))
    nt.links.new(n.outputs['Fac'], ramp.inputs['Fac']); nt.links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = .8
    bsdf.inputs['Subsurface Weight'].default_value = .15
LEAF = mat('LoadLeaf', leaf)
tex = bpy.data.textures.new('BushNoise', 'CLOUDS'); tex.noise_scale = .35
def bush(x, y, s):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=4, radius=1, location=(x, y, s * .45))
    o = bpy.context.object; o.scale = (s * 1.1, s * 1.0, s * .8)
    d = o.modifiers.new('Disp', 'DISPLACE'); d.texture = tex; d.strength = .45; d.mid_level = .5
    o.data.materials.append(LEAF); bpy.ops.object.shade_smooth()
for x, y, s in [(-9.5, 4.5, 1.3), (-8, 5.6, 1.1), (-11.5, 6.0, 1.2), (-12.8, 3.4, 1.0), (4.5, 9.5, 1.3), (6, 8.6, 1.0),
                (12, 6, 1.4), (13.5, 8.5, 1.2), (-16, 9, 1.6), (-3, 13, 1.4), (1, 14.5, 1.5), (9.5, 1.5, 1.0)]:
    bush(x, y, s)

# ---- bigger ground (same material, object coordinates keep the texture scale) and a far tree line
g = bpy.data.objects['Ground']
bpy.ops.mesh.primitive_plane_add(size=700, location=(0, 0, -.01)); far = bpy.context.object; far.data.materials.append(g.data.materials[0])
for k in range(110):
    a = rnd.uniform(1.4, 3.2); r = rnd.uniform(85, 150)
    bush(6.6 + math.cos(a) * r, -8.6 + math.sin(a) * r, rnd.uniform(2.2, 4.2))
    bpy.context.object.scale.z *= 1.9

# ---- smoke column from a burning wreck far behind
def smoke(nt, bsdf):
    nt.nodes.remove(bsdf); out = nt.nodes['Material Output']
    vol = nt.nodes.new('ShaderNodeVolumePrincipled'); vol.inputs['Color'].default_value = lin((120, 114, 106))
    tc = nt.nodes.new('ShaderNodeTexCoord'); n = nt.nodes.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = 2.2; n.inputs['Detail'].default_value = 6
    nt.links.new(tc.outputs['Object'], n.inputs['Vector'])
    grad = nt.nodes.new('ShaderNodeTexGradient'); grad.gradient_type = 'SPHERICAL'; nt.links.new(tc.outputs['Object'], grad.inputs['Vector'])
    m1 = nt.nodes.new('ShaderNodeMath'); m1.operation = 'MULTIPLY'; nt.links.new(n.outputs['Fac'], m1.inputs[0]); nt.links.new(grad.outputs['Fac'], m1.inputs[1])
    m2 = nt.nodes.new('ShaderNodeMapRange'); m2.inputs['From Min'].default_value = .14; m2.inputs['From Max'].default_value = .45; m2.inputs['To Max'].default_value = 1.6
    nt.links.new(m1.outputs[0], m2.inputs['Value']); nt.links.new(m2.outputs['Result'], vol.inputs['Density'])
    nt.links.new(vol.outputs[0], out.inputs['Volume'])
SMOKE = mat('LoadSmoke', smoke)
for k, (x, y, z, s) in enumerate([(-20, 30, 3, 4), (-21.5, 31, 9, 5.5), (-24, 32, 16, 7), (-28, 33, 24, 9)]):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1, location=(x, y, z))
    o = bpy.context.object; o.scale = (s, s * .9, s * .8); o.data.materials.append(SMOKE)
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1.2, location=(-20, 30, .6))
fire = bpy.context.object
fm = bpy.data.materials.new('LoadFire'); fm.use_nodes = True
em = fm.node_tree.nodes.new('ShaderNodeEmission'); em.inputs['Color'].default_value = (1, .35, .08, 1); em.inputs['Strength'].default_value = 25
fm.node_tree.links.new(em.outputs[0], fm.node_tree.nodes['Material Output'].inputs['Surface']); fire.data.materials.append(fm)

# ---- evening light: low warm sun from the left-front, cool sky
sky = sc.world.node_tree.nodes['Sky Texture']
sky.sun_elevation = math.radians(7); sky.sun_rotation = math.radians(300)
try: sky.aerosol_density = 1.5
except Exception: pass
sc.world.node_tree.nodes['Background'].inputs[1].default_value = .2
# thin haze in the air: depth and a warm glow around the low sun
bpy.ops.mesh.primitive_cube_add(size=1, location=(-20, 40, 40)); hz = bpy.context.object; hz.scale = (320, 320, 80)
hm = bpy.data.materials.new('LoadHaze'); hm.use_nodes = True; hnt = hm.node_tree; hnt.nodes.remove(hnt.nodes['Principled BSDF'])
vs = hnt.nodes.new('ShaderNodeVolumeScatter')
vs.inputs['Density'].default_value = .0025; vs.inputs['Anisotropy'].default_value = .5; vs.inputs['Color'].default_value = (1, .93, .85, 1)
hnt.links.new(vs.outputs[0], hnt.nodes['Material Output'].inputs['Volume']); hz.data.materials.append(hm)
sun = bpy.data.objects['Sun']; sun.data.energy = 7.5; sun.data.color = (1., .62, .38); sun.data.angle = math.radians(2)
d = Vector((-.5, .8, -.13)).normalized()                 # direction the light travels
sun.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

# ---- camera: low front three-quarter view, tank on the right half
cam = bpy.data.objects.new('Cam loading', bpy.data.cameras.new('Cam loading')); sc.collection.objects.link(cam)
cam.location = (6.6, -8.6, .7); cam.data.lens = 32
tgt = Vector((-3.0, 2.0, 1.9)); dv = tgt - cam.location
cam.rotation_euler = dv.to_track_quat('-Z', 'Y').to_euler()
cam.data.dof.use_dof = True; cam.data.dof.focus_distance = (Vector((0, -1, 1.2)) - cam.location).length; cam.data.dof.aperture_fstop = 2.8
sc.camera = cam
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'OPTIX'; prefs.refresh_devices()
for dev in prefs.devices: dev.use = dev.type == 'OPTIX'
sc.cycles.device = 'GPU'

sc.render.resolution_x, sc.render.resolution_y = (960, 540) if PREVIEW else (1920, 1080)
sc.cycles.samples = 40 if PREVIEW else 140
sc.render.image_settings.file_format = 'JPEG'; sc.render.image_settings.quality = 88
sc.render.filepath = os.path.join(HERE, 'renders', 'loading_preview.jpg') if PREVIEW else os.path.join(HERE, 'renders', 'loading_blender.jpg')
bpy.ops.render.render(write_still=True)
print('DONE', sc.render.filepath)
