# Witness 3D bridge for Blender: brings Witness 3D's bodies into Blender as meshes.
#
# Works the way Plasticity's Blender bridge does from Blender's side: Connect to the app running on
# this machine, Refresh to pull every body, Live Link to have the bodies follow each change made in
# Witness 3D. It is one-way. Blender only receives meshes, and an update replaces an object's
# geometry in place, so materials, modifiers, the camera and the lights set up in Blender stay.
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
except ImportError:  # the WebSocket client is usable without Blender, for tests
    bpy = None

COLLECTION = "Witness 3D"
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

def collection(scene):
    col = bpy.data.collections.get(COLLECTION)
    if col is None:
        col = bpy.data.collections.new(COLLECTION)
    if col.name not in scene.collection.children:
        scene.collection.children.link(col)
    return col


def apply_meshes(scene, objects, scale):
    """Make the Witness 3D collection hold exactly `objects`, updating geometry in place."""
    col = collection(scene)
    have = {o.get("w3d_id"): o for o in col.objects if o.get("w3d_id") is not None}
    seen = set()
    for m in objects:
        seen.add(m["id"])
        obj = have.get(m["id"])
        if obj is not None and obj.get("w3d_revision") == m["revision"]:
            continue
        p = m["positions"]
        verts = [(p[i] * scale, p[i + 1] * scale, p[i + 2] * scale) for i in range(0, len(p), 3)]
        ix = m["indices"]
        faces = [(ix[i], ix[i + 1], ix[i + 2]) for i in range(0, len(ix), 3)]
        if obj is None:
            mesh = bpy.data.meshes.new(m["name"])
            obj = bpy.data.objects.new(m["name"], mesh)
            obj["w3d_id"] = m["id"]
            col.objects.link(obj)
        mesh = obj.data
        # Clearing keeps the mesh's material slots, so materials set in Blender stay put.
        mesh.clear_geometry()
        mesh.from_pydata(verts, [], faces)
        # Witness 3D sends each B-rep face with its own vertices, so smooth shading stays sharp
        # at the face boundaries and smooth across rounds.
        mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
        mesh.update()
        obj["w3d_revision"] = m["revision"]
    for wid, obj in have.items():
        if wid not in seen:
            mesh = obj.data
            bpy.data.objects.remove(obj)
            if mesh.users == 0:
                bpy.data.meshes.remove(mesh)


# --- the add-on: state, operators, panel ------------------------------------------------------

state = {"link": None, "error": ""}


def handle(scene, msg):
    kind = msg.get("type")
    if kind == "meshes":
        apply_meshes(scene, msg["objects"], scene.w3d_scale)
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
            if state["error"]:
                col.label(text=state["error"], icon="ERROR")

    CLASSES = (W3D_OT_connect, W3D_OT_disconnect, W3D_OT_refresh, W3D_PT_panel)


def register():
    S = bpy.types.Scene
    S.w3d_host = bpy.props.StringProperty(name="Host", default="127.0.0.1")
    S.w3d_port = bpy.props.IntProperty(name="Port", default=8981, min=1, max=65535)
    S.w3d_live = bpy.props.BoolProperty(name="Live Link", default=False, update=on_live,
                                        description="Update the meshes whenever the model changes in Witness 3D")
    S.w3d_scale = bpy.props.FloatProperty(name="Scale", default=0.001, min=1e-6,
                                          description="Blender units per millimetre; 0.001 gives metres")
    for c in CLASSES:
        bpy.utils.register_class(c)


def unregister():
    disconnect()
    for c in reversed(CLASSES):
        bpy.utils.unregister_class(c)
    for p in ("w3d_host", "w3d_port", "w3d_live", "w3d_scale"):
        delattr(bpy.types.Scene, p)
