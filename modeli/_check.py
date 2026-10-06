import bpy
p=bpy.context.preferences.addons['cycles'].preferences
for t in ('OPTIX','CUDA','HIP','ONEAPI','METAL'):
    try:
        p.compute_device_type=t; p.refresh_devices()
        print("TYPE",t,[(d.name,d.type) for d in p.devices])
    except Exception as e: print("TYPE",t,"err",e)
