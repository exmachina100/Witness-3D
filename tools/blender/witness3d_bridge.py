# Witness 3D bridge for Blender: brings Witness 3D's bodies into Blender as meshes.
#
# Works the way Plasticity's Blender bridge does from Blender's side: Connect to the app running on
# this machine, Refresh to pull every body, Live Link to have the bodies follow each change made in
# Witness 3D. It is one-way. Blender only receives meshes, and an update replaces an object's
# geometry in place, so materials, modifiers, the camera and the lights set up in Blender stay.
#
# As Plasticity's does, it mirrors the outliner: a collection per document under "Witness 3D", and
# inside it a collection per group (named by its path, "HOUSING/PARTS/LID", since Blender's names are
# global), with each body named as in the outliner. Bodies hidden in Witness 3D arrive hidden, or not
# at all with "Only visible". Documents stay apart: refreshing one leaves another's objects alone.
#
# Refacet, as in Plasticity's add-on, asks Witness 3D to facet the selected bridge objects again at
# the panel's settings: Tri or Ngon, Tolerance (millimetres) and Angle (radians), and under Advanced
# the edge chord and angle, face plane and angle tolerances and a minimum width. A refaceted mesh is
# welded into one piece with the B-rep edges marked sharp, and with Ngon the facets of each face are
# merged where they lie flat. Live Link keeps each object's settings: when the body changes it is
# refaceted again.
#
# Selection utilities, as in Plasticity's add-on (each polygon keeps its B-rep face in the w3d_face
# attribute): Select Faces and Select Edges in edit mode, Auto Mark Edges (seams and/or sharp on the
# B-rep edges), Merge UV Seams (seams left only on the B-rep edges) and Paint Faces (a colour per
# face). Marking and merging weld the mesh first, keeping its shading through custom normals.
#
# Install: Edit > Preferences > Add-ons > Install from Disk, pick this file, enable it. The panel is
# in the 3D view's sidebar (N), under "Witness 3D". The Witness 3D desktop app listens on
# 127.0.0.1:8981. Protocol: apps/desktop/src-tauri/src/bridge.rs.

bl_info = {
    "name": "Witness 3D Bridge",
    "author": "Witness 3D",
    "version": (0, 1, 0),
    "blender": (4, 2, 0),
    "location": "View3D > Sidebar > Witness 3D",
    "description": "Bring Witness 3D bodies into Blender, with Refresh and Live Link",
    "category": "Import-Export",
}

import base64
import hashlib
import json
import os
import queue
import socket
import struct
import threading

try:
    import bpy
    import bmesh
except ImportError:  # the WebSocket client is usable without Blender, for tests
    bpy = bmesh = None

COLLECTION = "Witness 3D"
FACE_ATTR = "w3d_face"  # per polygon: the B-rep face it came from
GUID = b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


# --- a small WebSocket client (RFC 6455), so the add-on needs nothing outside Blender ---------

class Socket:
    def __init__(self, host, port, timeout=5.0):
        self.sock = socket.create_connection((host, port), timeout=timeout)
        key = base64.b64encode(os.urandom(16))
        self.sock.sendall(
            b"GET / HTTP/1.1\r\nHost: %s:%d\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
            b"Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n" % (host.encode(), port, key))
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("Witness 3D closed the connection")
            head += chunk
        head, self.buf = head.split(b"\r\n\r\n", 1)
        lines = head.decode("latin-1").split("\r\n")
        if " 101 " not in lines[0] + " ":
            raise ConnectionError("not a Witness 3D bridge: " + lines[0])
        accept = base64.b64encode(hashlib.sha1(key + GUID).digest()).decode()
        if not any(l.lower().startswith("sec-websocket-accept:") and l.split(":", 1)[1].strip() == accept for l in lines):
            raise ConnectionError("the bridge answered with the wrong handshake")
        self.sock.settimeout(None)

    def _exact(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(max(65536, n - len(self.buf)))
            if not chunk:
                raise ConnectionError("Witness 3D closed the connection")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def _frame(self, opcode, payload):
        mask = os.urandom(4)
        n = len(payload)
        head = bytes([0x80 | opcode])
        if n < 126:
            head += bytes([0x80 | n])
        elif n < 65536:
            head += bytes([0x80 | 126]) + struct.pack(">H", n)
        else:
            head += bytes([0x80 | 127]) + struct.pack(">Q", n)
        self.sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    def send(self, obj):
        self._frame(0x1, json.dumps(obj).encode())

    def recv(self):
        """The next message as a dict, or None when the connection closed."""
        data = b""
        while True:
            b0, b1 = self._exact(2)
            opcode, n = b0 & 0x0F, b1 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._exact(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._exact(8))[0]
            mask = self._exact(4) if b1 & 0x80 else None
            payload = self._exact(n)
            if mask:
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
            if opcode == 0x8:
                return None
            if opcode == 0x9:
                self._frame(0xA, payload)
                continue
            if opcode in (0x1, 0x2, 0x0):
                data += payload
                if b0 & 0x80:
                    return json.loads(data)

    def close(self):
        try:
            self._frame(0x8, b"")
        except OSError:
            pass
        self.sock.close()


class Link:
    """A connection read on its own thread; messages wait in `inbox` for Blender's main thread."""

    def __init__(self, host, port):
        self.ws = Socket(host, port)
        self.inbox = queue.Queue()
        self.hello = self.ws.recv()
        self.thread = threading.Thread(target=self._read, daemon=True)
        self.thread.start()

    def _read(self):
        try:
            while True:
                msg = self.ws.recv()
                if msg is None:
                    break
                self.inbox.put(msg)
        except (OSError, ConnectionError, ValueError):
            pass
        self.inbox.put({"type": "closed"})

    def send(self, obj):
        self.ws.send(obj)

    def close(self):
        self.ws.close()


# --- turning messages into Blender objects --------------------------------------------------

def document_name(msg):
    """The document's name as its collection is named: the file's name without .w3d."""
    name = (msg.get("document") or "").strip()
    name = name[:-4] if name.lower().endswith(".w3d") else name
    return name if name and name != COLLECTION else "UNTITLED"


def plan(msg, only_visible=False):
    """What the scene should hold for a meshes message: each object with the collection path it
    belongs in (outermost first) and whether it is hidden. Pure, so it is tested without Blender."""
    doc = document_name(msg)
    out = []
    for m in msg.get("objects", []):
        hidden = bool(m.get("hidden"))
        if hidden and only_visible:
            continue
        path = [str(g) for g in (m.get("path") or [])]
        cols = [COLLECTION, doc] + ["/".join([doc] + path[:i + 1]) for i in range(len(path))]
        out.append(dict(m, document=doc, collections=cols, hidden=hidden))
    return doc, out


def child(parent, name):
    """The collection for `name` under `parent`, made if it isn't there. It is found by the name
    it was made for, so a collection of the user's with the same name doesn't get mixed in."""
    for c in parent.children:
        if c.get("w3d_name") == name:
            return c
    col = bpy.data.collections.new(name)
    col["w3d"] = True
    col["w3d_name"] = name
    parent.children.link(col)
    return col


def collection(scene):
    col = bpy.data.collections.get(COLLECTION)
    if col is None:
        col = bpy.data.collections.new(COLLECTION)
    if col.name not in scene.collection.children:
        scene.collection.children.link(col)
    return col


def apply_meshes(scene, msg, scale, only_visible=False):
    """Make the document's collection hold exactly the message's objects, in their groups,
    updating geometry in place."""
    root = collection(scene)
    doc, objects = plan(msg, only_visible)
    partial = bool(msg.get("partial"))
    again = {}
    # This document's objects (older versions kept them loose in the root: they are adopted).
    have = {o.get("w3d_id"): o for o in bpy.data.objects
            if o.get("w3d_id") is not None and (o.get("w3d_doc") == doc or (o.get("w3d_doc") is None and o.name in root.objects))}
    seen = set()
    for m in objects:
        seen.add(m["id"])
        obj = have.get(m["id"])
        cols = m["collections"]
        target = root
        for name in cols[1:]:
            target = child(target, name)
        if obj is not None:
            place(obj, target, root)
            if obj.name != m["name"] and not obj.name.startswith(m["name"] + "."):
                obj.name = m["name"]
            show(obj, m["hidden"])
        if obj is not None and obj.get("w3d_revision") == m["revision"] and not partial:
            continue
        p = m["positions"]
        verts = [(p[i] * scale, p[i + 1] * scale, p[i + 2] * scale) for i in range(0, len(p), 3)]
        ix = m["indices"]
        faces = [(ix[i], ix[i + 1], ix[i + 2]) for i in range(0, len(ix), 3)]
        fids = m.get("faceIds") or [0] * len(faces)
        if not partial:
            # A face's collapsed edge (a sphere's or a corner blend's pole) leaves triangles with two
            # corners at one point; they have no area, and Blender can't place a normal on them.
            keep = [verts[f[0]] != verts[f[1]] and verts[f[1]] != verts[f[2]] and verts[f[2]] != verts[f[0]] for f in faces]
            faces = [f for f, k in zip(faces, keep) if k]
            fids = [i for i, k in zip(fids, keep) if k]
        if obj is None:
            mesh = bpy.data.meshes.new(m["name"])
            obj = bpy.data.objects.new(m["name"], mesh)
            obj["w3d_id"] = m["id"]
            obj["w3d_doc"] = doc
            target.objects.link(obj)
            show(obj, m["hidden"])
        mesh = obj.data
        # Clearing keeps the mesh's material slots, so materials set in Blender stay put.
        mesh.clear_geometry()
        if partial:
            build_refaceted(mesh, verts, faces, fids, bool(obj.get("w3d_ngon")), 0.0005 * scale)
        else:
            mesh.from_pydata(verts, [], faces)
            # Witness 3D sends each B-rep face with its own vertices, so smooth shading stays sharp
            # at the face boundaries and smooth across rounds.
            mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
            set_normals(mesh, m.get("normals"))
            # Which B-rep face each polygon came from, for the selection utilities.
            mesh.attributes.new(FACE_ATTR, "INT", "FACE").data.foreach_set("value", fids)
            if obj.get("w3d_refacet"):
                again.setdefault(obj["w3d_refacet"], []).append(m["id"])
        mesh.update()
        obj["w3d_revision"] = m["revision"]
    if partial:
        return []
    for wid, obj in have.items():
        if wid not in seen:
            mesh = obj.data
            bpy.data.objects.remove(obj)
            if mesh.users == 0:
                bpy.data.meshes.remove(mesh)
    # Group collections nothing is in any more go (only ones this add-on made).
    for c in root.children:
        if c.get("w3d_name") == doc:
            prune(c)
    return refacet_requests(again)


def set_normals(mesh, n):
    """Give the mesh Witness 3D's true surface normals (one per vertex), so curved faces shade
    as the surface does rather than as the facets do. Without them Blender's own smoothing stays."""
    if not n or len(n) != 3 * len(mesh.vertices):
        return
    if hasattr(mesh, "use_auto_smooth"):  # Blender before 4.1 reads custom normals only with this
        mesh.use_auto_smooth = True
    mesh.normals_split_custom_set_from_vertices([tuple(n[i:i + 3]) for i in range(0, len(n), 3)])


def place(obj, target, root):
    """Move an object into `target`, out of any other collection under the Witness 3D root."""
    inside = set()
    stack = [root]
    while stack:
        c = stack.pop()
        inside.add(c.name)
        stack.extend(c.children)
    for c in list(obj.users_collection):
        if c.name in inside and c != target:
            c.objects.unlink(obj)
    if obj.name not in target.objects:
        target.objects.link(obj)


def show(obj, hidden):
    """Hidden in Witness 3D, hidden in the viewport here (the eye in Blender's outliner)."""
    try:
        obj.hide_set(hidden)
    except RuntimeError:  # not in the view layer yet
        obj.hide_viewport = hidden
    obj["w3d_hidden"] = hidden


def prune(col):
    for c in list(col.children):
        prune(c)
        if c.get("w3d") and not c.objects and not c.children:
            bpy.data.collections.remove(c)


# --- the add-on: state, operators, panel ------------------------------------------------------

state = {"link": None, "error": "", "document": None}

# Edges between B-rep faces bending more than this are marked sharp in a refaceted mesh.
SHARP_ANGLE = 0.0873  # 5°


def refacet_settings(scene):
    """The panel's Refacet settings as the bridge takes them (bridge.rs)."""
    r = {"ngon": scene.w3d_facet_type == "NGON", "tolerance": scene.w3d_tolerance, "angle": scene.w3d_angle}
    if scene.w3d_advanced:
        r.update(min_width=scene.w3d_min_width, max_width=scene.w3d_max_width,
                 edge_chord_tolerance=scene.w3d_edge_chord_tolerance, edge_angle_tolerance=scene.w3d_edge_angle_tolerance,
                 face_plane_tolerance=scene.w3d_face_plane_tolerance, face_angle_tolerance=scene.w3d_face_angle_tolerance)
    return r


def refacet_requests(groups):
    """{settings JSON: [ids]} as refacet requests, one per set of settings."""
    return [dict(json.loads(k), type="refacet", ids=sorted(ids)) for k, ids in sorted(groups.items())]


def build_refaceted(mesh, verts, faces, face_ids, ngon, weld):
    """Fill `mesh` welded into one piece, with sharp B-rep edges and (Ngon) flat facets merged."""
    bm = bmesh.new()
    bv = [bm.verts.new(v) for v in verts]
    layer = bm.faces.layers.int.new(FACE_ATTR)
    for f, fid in zip(faces, face_ids):
        try:
            bf = bm.faces.new((bv[f[0]], bv[f[1]], bv[f[2]]))
        except ValueError:  # degenerate or repeated
            continue
        bf[layer] = fid
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=weld)
    if ngon:
        inner = [e for e in bm.edges if len(e.link_faces) == 2 and e.link_faces[0][layer] == e.link_faces[1][layer]]
        bmesh.ops.dissolve_limit(bm, angle_limit=0.0175, use_dissolve_boundaries=False, verts=[], edges=inner)
    for e in bm.edges:
        fs = e.link_faces
        e.smooth = not (len(fs) == 2 and fs[0][layer] != fs[1][layer] and e.calc_face_angle(0.0) > SHARP_ANGLE)
    for f in bm.faces:
        f.smooth = True
    bm.to_mesh(mesh)
    bm.free()


# --- selection utilities (Plasticity's add-on has the same five; each polygon knows its B-rep face) ---

def face_layer(bm):
    return bm.faces.layers.int.get(FACE_ATTR)


def borders(bm, faces):
    """The edges of `faces` that bound their B-rep face: open edges, or between two B-rep faces."""
    layer = face_layer(bm)
    out = set()
    for f in faces:
        for e in f.edges:
            fs = e.link_faces
            if len(fs) != 2 or fs[0][layer] != fs[1][layer]:
                out.add(e)
    return out


def whole_faces(bm, faces):
    """Every polygon of the B-rep faces `faces` belong to."""
    layer = face_layer(bm)
    ids = {f[layer] for f in faces}
    return [f for f in bm.faces if f[layer] in ids]


def welded_mesh(obj, dist):
    """Weld the object's mesh in place (outside edit mode), its shading kept: the B-rep edges stay
    sharp through their custom normals and every face's own normals stay as they were."""
    me = obj.data
    loop_normals = [tuple(me.corner_normals[i].vector) for i in range(len(me.loops))]
    attr = me.attributes.get("w3d_n") or me.attributes.new("w3d_n", "FLOAT_VECTOR", "CORNER")
    attr.data.foreach_set("vector", [c for n in loop_normals for c in n])
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
    bm.to_mesh(me)
    bm.free()
    attr = me.attributes["w3d_n"]
    flat = [0.0] * (3 * len(me.loops))
    attr.data.foreach_get("vector", flat)
    me.attributes.remove(attr)
    if hasattr(me, "use_auto_smooth"):
        me.use_auto_smooth = True
    me.normals_split_custom_set([tuple(flat[i:i + 3]) for i in range(0, len(flat), 3)])
    me.update()


def ours(context):
    """The objects worked on: those in edit mode, else the selected ones, that came from Witness 3D
    (their polygons know their B-rep faces)."""
    objs = context.objects_in_mode if context.mode == "EDIT_MESH" else context.selected_objects
    return [o for o in objs or [] if o.type == "MESH" and o.data.attributes.get(FACE_ATTR)]


def on_whole_mesh(context, work):
    """Run `work(obj, picked)` on each object out of edit mode, `picked` its selected polygons (empty
    outside edit mode), going back to edit mode after."""
    objs, editing = ours(context), context.mode == "EDIT_MESH"
    picked = {}
    if editing:
        for o in objs:
            bm = bmesh.from_edit_mesh(o.data)
            picked[o.name] = {f.index for f in bm.faces if f.select}
        bpy.ops.object.mode_set(mode="OBJECT")
    for o in objs:
        work(o, picked.get(o.name, set()))
    if editing:
        bpy.ops.object.mode_set(mode="EDIT")
    return len(objs)


def select_faces(obj):
    """Grow the face selection to the whole B-rep faces it touches."""
    bm = bmesh.from_edit_mesh(obj.data)
    if face_layer(bm) is None:
        return
    for f in whole_faces(bm, [f for f in bm.faces if f.select]):
        f.select_set(True)
    bmesh.update_edit_mesh(obj.data)


def select_edges(obj):
    """Select the B-rep edges round the selected faces (and nothing else)."""
    bm = bmesh.from_edit_mesh(obj.data)
    if face_layer(bm) is None:
        return
    edges = borders(bm, whole_faces(bm, [f for f in bm.faces if f.select]))
    for f in bm.faces:
        f.select_set(False)
    for e in edges:
        e.select_set(True)
    bm.select_mode = {"EDGE"}
    bm.select_flush_mode()
    bmesh.update_edit_mesh(obj.data)


def mark_edges(obj, picked, sharp, seam, dist):
    """Weld the object, then mark the B-rep edges round the faces `picked` (polygon indices; all
    when empty) sharp and/or as UV seams."""
    welded_mesh(obj, dist)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    faces = [bm.faces[i] for i in picked] if picked else list(bm.faces)
    for e in borders(bm, whole_faces(bm, faces)):
        if sharp:
            e.smooth = False
        if seam:
            e.seam = True
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def merge_seams(obj, picked, dist):
    """Weld the object and clear the UV seams inside the B-rep faces of `picked` (polygon indices;
    all when empty), keeping those on the B-rep edges: each face unwraps as one island."""
    welded_mesh(obj, dist)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    faces = whole_faces(bm, [bm.faces[i] for i in picked] if picked else list(bm.faces))
    edge = borders(bm, faces)
    for f in faces:
        for e in f.edges:
            e.seam = e in edge
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def paint_faces(obj):
    """A colour attribute with a random colour per B-rep face (the same face keeps its colour)."""
    me = obj.data
    ids = [0] * len(me.polygons)
    me.attributes[FACE_ATTR].data.foreach_get("value", ids)
    col = me.color_attributes.get("w3d_faces") or me.color_attributes.new("w3d_faces", "BYTE_COLOR", "CORNER")
    rgba = []
    for p, fid in zip(me.polygons, ids):
        h = hashlib.md5(b"%d" % fid).digest()
        c = (h[0] / 255, h[1] / 255, h[2] / 255, 1.0)
        rgba.extend(c * p.loop_total)
    col.data.foreach_set("color", rgba)
    me.color_attributes.active_color = col
    me.update()


def handle(scene, msg):
    kind = msg.get("type")
    if kind == "meshes":
        state["document"] = document_name(msg)
        for req in apply_meshes(scene, msg, scene.w3d_scale, scene.w3d_only_visible) or []:
            if state["link"] is not None:
                state["link"].send(req)
    elif kind == "error":
        state["error"] = msg.get("message", "")
    elif kind == "closed":
        state["link"] = None
        state["error"] = "Disconnected"


def pump():
    """Apply what arrived; Blender calls this on its main thread every tenth of a second."""
    link = state["link"]
    if link is None:
        return None
    while True:
        try:
            msg = link.inbox.get_nowait()
        except queue.Empty:
            break
        handle(bpy.context.scene, msg)
        if state["link"] is None:
            return None
    return 0.1


def connect(scene):
    link = Link(scene.w3d_host, scene.w3d_port)
    state["link"], state["error"] = link, ""
    if scene.w3d_live:
        link.send({"type": "live", "on": True})
    if not bpy.app.timers.is_registered(pump):
        bpy.app.timers.register(pump)
    return link


def disconnect():
    link, state["link"] = state["link"], None
    if link is not None:
        link.close()


def on_live(self, context):
    if state["link"] is not None:
        state["link"].send({"type": "live", "on": self.w3d_live})


if bpy is not None:
    class W3D_OT_connect(bpy.types.Operator):
        """Connect to Witness 3D running on this machine"""
        bl_idname = "witness3d.connect"
        bl_label = "Connect"

        def execute(self, context):
            try:
                connect(context.scene)
            except OSError as e:
                state["error"] = "Witness 3D is not running (%s)" % e
                self.report({"ERROR"}, state["error"])
                return {"CANCELLED"}
            return {"FINISHED"}

    class W3D_OT_disconnect(bpy.types.Operator):
        """Stop receiving from Witness 3D"""
        bl_idname = "witness3d.disconnect"
        bl_label = "Disconnect"

        def execute(self, context):
            disconnect()
            return {"FINISHED"}

    class W3D_OT_refresh(bpy.types.Operator):
        """Bring in every body from Witness 3D now"""
        bl_idname = "witness3d.refresh"
        bl_label = "Refresh"

        def execute(self, context):
            if state["link"] is None:
                self.report({"ERROR"}, "Connect to Witness 3D first")
                return {"CANCELLED"}
            state["link"].send({"type": "refresh"})
            return {"FINISHED"}

    def refacet_selected(context):
        """Ask for the selected bridge objects of the current document again at the panel's settings."""
        if state["link"] is None:
            return "Connect to Witness 3D first"
        objs = [o for o in context.selected_objects if o.get("w3d_id") is not None and o.get("w3d_doc") == state["document"]]
        if not objs:
            return "Select objects from Witness 3D's open document"
        r = refacet_settings(context.scene)
        key = json.dumps(r, sort_keys=True)
        for o in objs:
            o["w3d_refacet"] = key
            o["w3d_ngon"] = r["ngon"]
        for req in refacet_requests({key: [o["w3d_id"] for o in objs]}):
            state["link"].send(req)
        return None

    class W3D_OT_refacet(bpy.types.Operator):
        """Facet the selected Witness 3D objects again at these settings"""
        bl_idname = "witness3d.refacet"
        bl_label = "Refacet"

        def execute(self, context):
            err = refacet_selected(context)
            if err:
                self.report({"ERROR"}, err)
                return {"CANCELLED"}
            return {"FINISHED"}

    class W3D_PT_panel(bpy.types.Panel):
        bl_label = "Witness 3D"
        bl_space_type = "VIEW_3D"
        bl_region_type = "UI"
        bl_category = "Witness 3D"

        def draw(self, context):
            s, col = context.scene, self.layout.column()
            if state["link"] is None:
                row = col.row(align=True)
                row.prop(s, "w3d_host", text="")
                row.prop(s, "w3d_port", text="")
                col.operator("witness3d.connect", icon="LINKED")
            else:
                col.label(text="Connected", icon="CHECKMARK")
                col.operator("witness3d.refresh", icon="FILE_REFRESH")
                col.operator("witness3d.disconnect", icon="UNLINKED")
            col.prop(s, "w3d_live")
            col.prop(s, "w3d_scale")
            col.prop(s, "w3d_only_visible")
            box = col.box()
            box.row().prop(s, "w3d_facet_type", expand=True)
            box.prop(s, "w3d_tolerance")
            box.prop(s, "w3d_angle")
            box.prop(s, "w3d_advanced")
            if s.w3d_advanced:
                for p in ("w3d_min_width", "w3d_max_width", "w3d_edge_chord_tolerance", "w3d_edge_angle_tolerance",
                          "w3d_face_plane_tolerance", "w3d_face_angle_tolerance"):
                    box.prop(s, p)
            row = box.row()
            row.enabled = state["link"] is not None
            row.operator("witness3d.refacet", icon="MOD_TRIANGULATE")
            box = col.box()
            box.label(text="Selection utilities")
            row = box.row(align=True)
            row.operator("witness3d.select_faces", icon="FACESEL")
            row.operator("witness3d.select_edges", icon="EDGESEL")
            box.operator("witness3d.mark_edges", icon="EDGESEL")
            box.operator("witness3d.merge_seams", icon="UV")
            box.operator("witness3d.paint_faces", icon="BRUSH_DATA")
            if state["error"]:
                col.label(text=state["error"], icon="ERROR")

    class W3D_OT_select_faces(bpy.types.Operator):
        """Grow the face selection to the whole Witness 3D faces it touches"""
        bl_idname = "witness3d.select_faces"
        bl_label = "Select Faces"
        bl_options = {"REGISTER", "UNDO"}

        @classmethod
        def poll(cls, context):
            return context.mode == "EDIT_MESH"

        def execute(self, context):
            for o in ours(context):
                select_faces(o)
            return {"FINISHED"}

    class W3D_OT_select_edges(bpy.types.Operator):
        """Select the Witness 3D edges round the selected faces"""
        bl_idname = "witness3d.select_edges"
        bl_label = "Select Edges"
        bl_options = {"REGISTER", "UNDO"}

        @classmethod
        def poll(cls, context):
            return context.mode == "EDIT_MESH"

        def execute(self, context):
            for o in ours(context):
                select_edges(o)
            return {"FINISHED"}

    class W3D_OT_mark_edges(bpy.types.Operator):
        """Weld the mesh and mark the Witness 3D edges round the selected faces (or all of them)"""
        bl_idname = "witness3d.mark_edges"
        bl_label = "Auto Mark Edges"
        bl_options = {"REGISTER", "UNDO"}
        mark: bpy.props.EnumProperty(name="Mark", default="SEAM", items=[
            ("SEAM", "Seams", "Mark them as UV seams"), ("SHARP", "Sharp", "Mark them sharp"),
            ("BOTH", "Both", "Seams and sharp")])

        def execute(self, context):
            sharp, seam = self.mark in ("SHARP", "BOTH"), self.mark in ("SEAM", "BOTH")
            weld = 0.0005 * context.scene.w3d_scale
            if not on_whole_mesh(context, lambda o, p: mark_edges(o, p, sharp, seam, weld)):
                self.report({"ERROR"}, "Select objects from Witness 3D")
                return {"CANCELLED"}
            return {"FINISHED"}

    class W3D_OT_merge_seams(bpy.types.Operator):
        """Weld the mesh and keep UV seams only on the Witness 3D edges of the selected faces, so each face unwraps whole"""
        bl_idname = "witness3d.merge_seams"
        bl_label = "Merge UV Seams"
        bl_options = {"REGISTER", "UNDO"}

        def execute(self, context):
            weld = 0.0005 * context.scene.w3d_scale
            if not on_whole_mesh(context, lambda o, p: merge_seams(o, p, weld)):
                self.report({"ERROR"}, "Select objects from Witness 3D")
                return {"CANCELLED"}
            return {"FINISHED"}

    class W3D_OT_paint_faces(bpy.types.Operator):
        """Give each Witness 3D face a random colour (a colour attribute, w3d_faces)"""
        bl_idname = "witness3d.paint_faces"
        bl_label = "Paint Faces"
        bl_options = {"REGISTER", "UNDO"}

        def execute(self, context):
            if not on_whole_mesh(context, lambda o, p: paint_faces(o)):
                self.report({"ERROR"}, "Select objects from Witness 3D")
                return {"CANCELLED"}
            return {"FINISHED"}

    CLASSES = (W3D_OT_connect, W3D_OT_disconnect, W3D_OT_refresh, W3D_OT_refacet, W3D_OT_select_faces,
               W3D_OT_select_edges, W3D_OT_mark_edges, W3D_OT_merge_seams, W3D_OT_paint_faces, W3D_PT_panel)

REFACET_PROPS = ("w3d_facet_type", "w3d_tolerance", "w3d_angle", "w3d_advanced", "w3d_min_width", "w3d_max_width",
                 "w3d_edge_chord_tolerance", "w3d_edge_angle_tolerance", "w3d_face_plane_tolerance",
                 "w3d_face_angle_tolerance")


def register():
    S = bpy.types.Scene
    S.w3d_host = bpy.props.StringProperty(name="Host", default="127.0.0.1")
    S.w3d_port = bpy.props.IntProperty(name="Port", default=8981, min=1, max=65535)
    S.w3d_live = bpy.props.BoolProperty(name="Live Link", default=False, update=on_live,
                                        description="Update the meshes whenever the model changes in Witness 3D")
    S.w3d_scale = bpy.props.FloatProperty(name="Scale", default=0.001, min=1e-6,
                                          description="Blender units per millimetre; 0.001 gives metres")
    S.w3d_only_visible = bpy.props.BoolProperty(name="Only visible", default=False,
                                                description="Leave out bodies hidden in Witness 3D (otherwise they come in hidden)")
    P = bpy.props
    S.w3d_facet_type = P.EnumProperty(name="Facets", default="TRI", items=[
        ("TRI", "Tri", "Triangles everywhere"), ("NGON", "Ngon", "Flat stretches of a face merged into n-gons")])
    S.w3d_tolerance = P.FloatProperty(name="Tolerance", default=0.01, min=0.0001, max=0.1, precision=4,
                                      description="How far facets may stray from the surface, in millimetres")
    S.w3d_angle = P.FloatProperty(name="Angle", default=0.45, min=0.1, max=1.0,
                                  description="How far neighbouring facets may turn, in radians")
    S.w3d_advanced = P.BoolProperty(name="Advanced", default=False, description="Set edge and face tolerances apart")
    S.w3d_min_width = P.FloatProperty(name="Min Width", default=0.0, min=0.0, max=100.0,
                                      description="No facet edge shorter than this, in millimetres (0: no limit)")
    S.w3d_max_width = P.FloatProperty(name="Max Width", default=0.0, min=0.0, max=10000.0,
                                      description="No facet edge longer than this, in millimetres (0: no limit)")
    S.w3d_edge_chord_tolerance = P.FloatProperty(name="Edge chord tolerance", default=0.01, min=0.0001, max=1.0, precision=4)
    S.w3d_edge_angle_tolerance = P.FloatProperty(name="Edge angle tolerance", default=0.45, min=0.01, max=1.5)
    S.w3d_face_plane_tolerance = P.FloatProperty(name="Face plane tolerance", default=0.01, min=0.0001, max=1.0, precision=4)
    S.w3d_face_angle_tolerance = P.FloatProperty(name="Face angle tolerance", default=0.45, min=0.01, max=1.5)
    for c in CLASSES:
        bpy.utils.register_class(c)


def unregister():
    disconnect()
    for c in reversed(CLASSES):
        bpy.utils.unregister_class(c)
    for p in ("w3d_host", "w3d_port", "w3d_live", "w3d_scale", "w3d_only_visible") + REFACET_PROPS:
        delattr(bpy.types.Scene, p)
