# Witness 3D bridge: the connection and the scene plan, shared by the Cinema 4D plugin and its test.
# Nothing here imports Cinema 4D. The WebSocket client is the one in the Blender add-on
# (tools/blender/witness3d_bridge.py), which keeps its own copy so it installs as one file.
# Protocol: apps/desktop/src-tauri/src/bridge.rs.

import base64
import hashlib
import json
import os
import queue
import socket
import struct
import threading

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
    """A connection read on its own thread; messages wait in `inbox` for the host app's main thread."""

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


# --- what the scene should hold ------------------------------------------------------------

def to_c4d(p):
    """A z-up, right-handed point (as the bridge sends) in Cinema 4D's y-up, left-handed space."""
    return (p[0], p[2], p[1])


def plan(msg, only_visible=False):
    """
    A "meshes" message as what Cinema 4D should hold under the document's root null: the group
    paths (each a tuple of names from the top, parents first) and each body's mesh in Cinema 4D's
    axes. Mirroring the axes turns the triangles over, so each is wound the other way round to
    keep its normal pointing out. Hidden bodies are left out when `only_visible` is on, and are
    marked hidden otherwise.
    """
    meshes, groups = [], set()
    for o in msg.get("objects", []):
        hidden = bool(o.get("hidden"))
        if hidden and only_visible:
            continue
        path = tuple(o.get("path") or ())
        for i in range(1, len(path) + 1):
            groups.add(path[:i])
        p, ix = o["positions"], o["indices"]
        meshes.append({
            "id": o["id"],
            "name": o["name"],
            "revision": o["revision"],
            "path": path,
            "hidden": hidden,
            "points": [to_c4d(p[i:i + 3]) for i in range(0, len(p), 3)],
            "polys": [(ix[i], ix[i + 2], ix[i + 1]) for i in range(0, len(ix), 3)],
        })
    return {
        "document": msg.get("document") or "Witness 3D",
        "groups": sorted(groups, key=lambda g: (len(g), g)),
        "meshes": meshes,
    }
