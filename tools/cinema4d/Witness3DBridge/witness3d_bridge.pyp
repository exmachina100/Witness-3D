# Witness 3D bridge for Cinema 4D: brings Witness 3D's bodies into Cinema 4D as polygon objects.
#
# Works the way Plasticity's Cinema 4D bridge does from Cinema 4D's side: Extensions > Witness 3D
# Bridge opens the panel; Connect to the app running on this machine, Refresh to pull every solid
# and sheet, Live Link to have them follow each change made in Witness 3D. They arrive under a
# root null named after the Witness 3D document, with a null for each outliner group. Only visible
# leaves hidden bodies out (otherwise they come in hidden), and Unit Scale is the root null's
# scale, so it can be changed at any time. It is one-way: an update replaces an object's points in
# place, so materials and tags added in Cinema 4D stay.
#
# Install: copy this Witness3DBridge folder into Cinema 4D's plugins folder (Cinema 4D 2023 or
# later) and restart. The Witness 3D desktop app listens on 127.0.0.1:8981.
# Protocol: apps/desktop/src-tauri/src/bridge.rs.

import os
import queue
import sys

import c4d
from c4d import gui

sys.path.insert(0, os.path.dirname(__file__))
import w3d_link  # noqa: E402

# Cinema 4D's range for plugins in development; a released build needs IDs from Maxon.
PLUGIN_ID = 1000001
KEY_ID = PLUGIN_ID + 1      # a body's id, kept in the object's own container
KEY_REV = PLUGIN_ID + 2     # the revision its points came from
KEY_ROOT = PLUGIN_ID + 3    # marks the root null
KEY_GROUP = PLUGIN_ID + 4   # marks a group null

ID_HOST, ID_PORT, ID_CONNECT, ID_REFRESH, ID_LIVE, ID_VISIBLE, ID_SCALE, ID_STATUS = range(1100, 1108)


def walk(op):
    while op:
        yield op
        for child in walk(op.GetDown()):
            yield child
        op = op.GetNext()


def find_root(doc):
    for op in walk(doc.GetFirstObject()):
        if op.GetDataInstance().GetBool(KEY_ROOT):
            return op
    return None


def apply_plan(doc, p, scale):
    """Make the root null hold exactly the planned groups and bodies, updating points in place."""
    root = find_root(doc)
    if root is None:
        root = c4d.BaseObject(c4d.Onull)
        root.GetDataInstance().SetBool(KEY_ROOT, True)
        doc.InsertObject(root)
    root.SetName(p["document"])
    root.SetAbsScale(c4d.Vector(scale))
    # The groups: a null per path, found again by name under its parent.
    nulls = {(): root}
    for path in p["groups"]:
        parent = nulls[path[:-1]]
        null = next((c for c in parent.GetChildren() if c.GetDataInstance().GetBool(KEY_GROUP) and c.GetName() == path[-1]), None)
        if null is None:
            null = c4d.BaseObject(c4d.Onull)
            null.GetDataInstance().SetBool(KEY_GROUP, True)
            null.SetName(path[-1])
            null.InsertUnderLast(parent)
        nulls[path] = null
    have = {}
    for op in walk(root.GetDown()):
        bc = op.GetDataInstance()
        if op.CheckType(c4d.Opolygon) and bc.GetInt32(KEY_ID) > 0:
            have[bc.GetInt32(KEY_ID)] = op
    seen = set()
    for m in p["meshes"]:
        seen.add(m["id"])
        op = have.get(m["id"])
        if op is None:
            op = c4d.PolygonObject(len(m["points"]), len(m["polys"]))
            op.GetDataInstance().SetInt32(KEY_ID, m["id"])
            # Witness 3D sends each B-rep face with its own points: smooth across a round, sharp
            # at the edges between faces.
            op.MakeTag(c4d.Tphong)
        if op.GetUp() is not nulls[m["path"]]:
            op.Remove()
            op.InsertUnderLast(nulls[m["path"]])
        op.SetName(m["name"])
        mode = c4d.MODE_OFF if m["hidden"] else c4d.MODE_UNDEF
        op.SetEditorMode(mode)
        op.SetRenderMode(mode)
        bc = op.GetDataInstance()
        if bc.GetInt32(KEY_REV) == m["revision"] and op.GetPointCount() == len(m["points"]):
            continue
        op.ResizeObject(len(m["points"]), len(m["polys"]))
        op.SetAllPoints([c4d.Vector(*q) for q in m["points"]])
        for i, (a, b, c) in enumerate(m["polys"]):
            op.SetPolygon(i, c4d.CPolygon(a, b, c))
        op.Message(c4d.MSG_UPDATE)
        bc.SetInt32(KEY_REV, m["revision"])
    for wid, op in have.items():
        if wid not in seen:
            op.Remove()
    # Groups left empty go too, innermost first.
    for op in reversed(list(walk(root.GetDown()))):
        if op.GetDataInstance().GetBool(KEY_GROUP) and op.GetDown() is None:
            op.Remove()
    c4d.EventAdd()


class BridgeDialog(gui.GeDialog):
    def __init__(self):
        super().__init__()
        self.link = None
        self.last = None

    def CreateLayout(self):
        self.SetTitle("Witness 3D Bridge")
        self.GroupBegin(0, c4d.BFH_SCALEFIT, 2, 0)
        self.AddStaticText(0, c4d.BFH_LEFT, name="Server")
        self.GroupBegin(0, c4d.BFH_SCALEFIT, 2, 0)
        self.AddEditText(ID_HOST, c4d.BFH_SCALEFIT, 120)
        self.AddEditNumber(ID_PORT, c4d.BFH_LEFT, 60)
        self.GroupEnd()
        self.AddStaticText(0, c4d.BFH_LEFT, name="Unit Scale")
        self.AddEditNumberArrows(ID_SCALE, c4d.BFH_LEFT, 80)
        self.GroupEnd()
        self.AddButton(ID_CONNECT, c4d.BFH_SCALEFIT, name="Connect")
        self.AddButton(ID_REFRESH, c4d.BFH_SCALEFIT, name="Refresh")
        self.AddCheckbox(ID_LIVE, c4d.BFH_LEFT, 0, 0, name="Live Link")
        self.AddCheckbox(ID_VISIBLE, c4d.BFH_LEFT, 0, 0, name="Only visible")
        self.AddStaticText(ID_STATUS, c4d.BFH_SCALEFIT, name="Not connected")
        return True

    def InitValues(self):
        self.SetString(ID_HOST, "127.0.0.1")
        self.SetInt32(ID_PORT, 8981, 1, 65535)
        # Witness 3D works in millimetres; Cinema 4D's default unit is the centimetre.
        self.SetFloat(ID_SCALE, 0.1, 1e-6, 1e6, 0.1)
        self.SetBool(ID_LIVE, False)
        self.SetBool(ID_VISIBLE, False)
        self.SetTimer(100)
        return True

    def status(self, text):
        self.SetString(ID_STATUS, text)

    def connect(self):
        try:
            self.link = w3d_link.Link(self.GetString(ID_HOST), self.GetInt32(ID_PORT))
        except OSError as e:
            self.link = None
            return self.status("Witness 3D is not running (%s)" % e)
        self.SetString(ID_CONNECT, "Disconnect")
        self.status("Connected")
        self.link.send({"type": "live", "on": self.GetBool(ID_LIVE)})
        if not self.GetBool(ID_LIVE):
            self.link.send({"type": "refresh"})

    def disconnect(self):
        link, self.link = self.link, None
        if link is not None:
            link.close()
        self.SetString(ID_CONNECT, "Connect")
        self.status("Not connected")

    def apply(self):
        if self.last is not None:
            apply_plan(c4d.documents.GetActiveDocument(), w3d_link.plan(self.last, self.GetBool(ID_VISIBLE)), self.GetFloat(ID_SCALE))

    def Command(self, cid, msg):
        if cid == ID_CONNECT:
            self.disconnect() if self.link else self.connect()
        elif cid == ID_REFRESH:
            if self.link is None:
                self.status("Connect to Witness 3D first")
            else:
                self.link.send({"type": "refresh"})
        elif cid == ID_LIVE and self.link is not None:
            self.link.send({"type": "live", "on": self.GetBool(ID_LIVE)})
        elif cid in (ID_VISIBLE, ID_SCALE):
            self.apply()
        return True

    def Timer(self, msg):
        if self.link is None:
            return
        while True:
            try:
                m = self.link.inbox.get_nowait()
            except queue.Empty:
                break
            kind = m.get("type")
            if kind == "meshes":
                self.last = m
                self.apply()
                self.status("Connected · %d bodies" % len(m.get("objects", [])))
            elif kind == "error":
                self.status(m.get("message", "error"))
            elif kind == "closed":
                self.link = None
                self.SetString(ID_CONNECT, "Connect")
                self.status("Disconnected")
                break


class BridgeCommand(c4d.plugins.CommandData):
    dialog = None

    def Execute(self, doc):
        if self.dialog is None:
            self.dialog = BridgeDialog()
        return self.dialog.Open(c4d.DLG_TYPE_ASYNC, PLUGIN_ID, defaultw=260, defaulth=160)

    def RestoreLayout(self, sec_ref):
        if self.dialog is None:
            self.dialog = BridgeDialog()
        return self.dialog.Restore(PLUGIN_ID, sec_ref)


if __name__ == "__main__":
    c4d.plugins.RegisterCommandPlugin(PLUGIN_ID, "Witness 3D Bridge", 0, None,
                                      "Bring Witness 3D bodies into Cinema 4D, with Refresh and Live Link",
                                      BridgeCommand())
