# End-to-end test of the Blender add-on against the real bridge, run with Blender as a Python
# module (pip install bpy):
#   python tools/blender/test_bridge.py target/release/examples/bridge_demo [out_dir]
# The demo server serves Witness 3D's model; this script connects as the add-on does, pulls the
# enclosure, gives it a material and a camera the way a Blender user would, then has Witness 3D
# round every edge by 4 mm with Live Link on, and checks the mesh changed while the material and
# camera stayed. With out_dir it also renders a picture before and after.

import math
import os
import subprocess
import sys
import time

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import witness3d_bridge as w3d

server_bin, out = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else None)
PORT = 8991
server = subprocess.Popen([server_bin, str(PORT)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
assert server.stdout.readline().startswith("listening")


def say(line):
    server.stdin.write(line + "\n")
    server.stdin.flush()
    return server.stdout.readline().strip()


def wait_for(cond, what, timeout=10):
    end = time.time() + timeout
    while time.time() < end:
        w3d.pump()
        if cond():
            return
        time.sleep(0.05)
    raise AssertionError("timed out waiting for " + what)


failures = 0


def check(ok, what):
    global failures
    print("PASS" if ok else "FAIL", what)
    failures += not ok


def render(name):
    if not out:
        return
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.cycles.samples = 24
    s.cycles.device = "CPU"
    s.render.resolution_x, s.render.resolution_y = 640, 420
    s.render.filepath = os.path.join(out, name)
    bpy.ops.render.render(write_still=True)


try:
    w3d.register()
    scene = bpy.context.scene
    for o in list(scene.objects):
        if o.type == "MESH":
            bpy.data.objects.remove(o)
    scene.w3d_port = PORT

    w3d.connect(scene)
    check(w3d.state["link"].hello["app"] == "Witness 3D", "the add-on connects and the bridge says hello")
    w3d.state["link"].send({"type": "refresh"})
    wait_for(lambda: bpy.data.collections.get(w3d.COLLECTION) and len(bpy.data.collections[w3d.COLLECTION].objects) == 1, "Refresh")
    body = bpy.data.collections[w3d.COLLECTION].objects[0]
    check(body.name == "Witness Body 01", "Refresh brings in the enclosure as Witness Body 01")
    dims = tuple(round(d * 1000, 3) for d in body.dimensions)
    check(dims == (80.0, 50.0, 30.0), "it is 80 × 50 × 30 mm, z up, at scale 0.001 (got %s)" % (dims,))
    before = len(body.data.vertices)

    # What a Blender user sets up: a material, and a camera and light of their own.
    mat = bpy.data.materials.new("Anodised orange")
    mat.diffuse_color = (1.0, 0.3, 0.0, 1.0)
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (1.0, 0.18, 0.0, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.35
    bsdf.inputs["Metallic"].default_value = 0.6
    body.data.materials.append(mat)
    cam = scene.camera
    cam.location = (0.11, -0.13, 0.1)
    cam.rotation_euler = (Vector((0, 0, 0.012)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = 50
    light = next(o for o in scene.objects if o.type == "LIGHT")
    light.location = (0.2, -0.1, 0.3)
    light.data.energy = 60
    bpy.context.view_layer.update()
    cam_matrix = [list(r) for r in cam.matrix_world]
    render("blender-before.png")

    # Live Link on, then Witness 3D rounds every edge by 4 mm.
    scene.w3d_live = True
    wait_for(lambda: say("status") == "(1, 1)", "Live Link to reach the bridge")
    rev = body["w3d_revision"]
    check(say("fillet 4") == "ok", "Witness 3D rounds all 12 edges by 4 mm")
    wait_for(lambda: body["w3d_revision"] != rev, "the Live Link update")
    check(len(body.data.vertices) > before, "the mesh in Blender is the rounded one (%d → %d vertices)" % (before, len(body.data.vertices)))
    check(tuple(round(d * 1000, 3) for d in body.dimensions) == (80.0, 50.0, 30.0), "its size is unchanged")
    check(len(body.data.materials) == 1 and body.data.materials[0] == mat, "the material set in Blender is kept")
    bpy.context.view_layer.update()
    check([list(r) for r in cam.matrix_world] == cam_matrix and scene.camera == cam, "the camera is untouched")
    check(len(bpy.data.collections[w3d.COLLECTION].objects) == 1, "the object was updated in place, not duplicated")
    render("blender-after.png")
finally:
    w3d.disconnect()
    say("quit")
    server.wait(timeout=5)

print("ALL PASSED" if not failures else "%d FAILED" % failures)
sys.exit(1 if failures else 0)
