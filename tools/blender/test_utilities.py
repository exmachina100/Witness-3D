# The selection utilities on a cube sent as Witness 3D sends it (each face its own points), run with
# Blender as a Python module (pip install bpy): python tools/blender/test_utilities.py

import os
import sys

import bpy
import bmesh

sys.path.insert(0, os.path.dirname(__file__))
import witness3d_bridge as w3d

failed = 0


def check(ok, what):
    global failed
    print(("PASS " if ok else "FAIL ") + what)
    failed += not ok


def cube_message():
    """A 10 mm cube, z up: per face 4 points and 2 triangles, its normals and its face number."""
    pos, ix, fids, nor = [], [], [], []
    sides = [((0, 0, 1), (1, 0, 0)), ((0, 0, -1), (1, 0, 0)), ((1, 0, 0), (0, 1, 0)),
             ((-1, 0, 0), (0, 1, 0)), ((0, 1, 0), (0, 0, 1)), ((0, -1, 0), (0, 0, 1))]
    for k, (n, u) in enumerate(sides):
        v = (n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0])
        base = len(pos) // 3
        for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            pos += [5 * (n[i] + a * u[i] + b * v[i]) for i in range(3)]
            nor += list(n)
        ix += [base, base + 1, base + 2, base, base + 2, base + 3]
        fids += [k, k]
    return {"type": "meshes", "document": "TEST", "objects": [
        {"id": 1, "name": "CUBE", "revision": 1, "positions": pos, "indices": ix, "faceIds": fids,
         "normals": nor, "path": [], "hidden": False}]}


w3d.register()
scene = bpy.context.scene
w3d.apply_meshes(scene, cube_message(), scene.w3d_scale)
obj = next(o for o in bpy.data.objects if o.get("w3d_id") == 1)
me = obj.data
check(me.attributes.get(w3d.FACE_ATTR) is not None and len(me.polygons) == 12, "each polygon knows its B-rep face")
bpy.context.view_layer.objects.active = obj
obj.select_set(True)

# Select Faces: one triangle selected grows to its whole square face.
bpy.ops.object.mode_set(mode="EDIT")
bm = bmesh.from_edit_mesh(me)
for f in bm.faces:
    f.select_set(f.index == 0)
bmesh.update_edit_mesh(me)
bpy.ops.witness3d.select_faces()
bm = bmesh.from_edit_mesh(me)
check(sorted(f.index for f in bm.faces if f.select) == [0, 1], "Select Faces grows one triangle to its face")

# Select Edges: the face's 4 sides, not its diagonal.
bpy.ops.witness3d.select_edges()
bm = bmesh.from_edit_mesh(me)
check(sum(e.select for e in bm.edges) == 4, "Select Edges picks the face's four sides only")

# Auto Mark Edges (seams) on that face: welds, then seams on its 4 sides only; shading kept.
for f in bm.faces:
    f.select_set(f.index in (0, 1))
bmesh.update_edit_mesh(me)
bpy.ops.witness3d.mark_edges(mark="SEAM")
bpy.ops.object.mode_set(mode="OBJECT")
check(len(me.vertices) == 8, "Auto Mark Edges welds the cube into one piece (%d points)" % len(me.vertices))
check(sum(e.use_seam for e in me.edges) == 4, "and marks the face's four sides as seams")
ups = [me.corner_normals[l.index].vector.z for l in me.loops if me.polygons[0].loop_start <= l.index < me.polygons[0].loop_start + 3]
check(min(ups) > 0.9999, "the top still shades flat after welding")

# Merge UV Seams on the whole object: seams on every cube edge, none across a face.
bpy.ops.witness3d.merge_seams()
check(sum(e.use_seam for e in me.edges) == 12, "Merge UV Seams leaves seams on the 12 cube edges only")

# Auto Mark Edges sharp on everything.
bpy.ops.witness3d.mark_edges(mark="SHARP")
check(sum(e.use_edge_sharp for e in me.edges) == 12, "Auto Mark Edges (sharp) marks the 12 cube edges")

# Paint Faces: one colour per face, the two triangles of a face alike.
bpy.ops.witness3d.paint_faces()
col = me.color_attributes["w3d_faces"]
first = [tuple(round(c, 3) for c in col.data[me.polygons[p].loop_start].color) for p in range(12)]
check(first[0] == first[1] and len(set(first)) == 6, "Paint Faces gives each of the 6 faces its own colour")

print("%d FAILED" % failed if failed else "ALL PASSED")
sys.exit(1 if failed else 0)
