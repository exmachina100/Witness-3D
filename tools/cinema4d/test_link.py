# Test of the Cinema 4D plugin's connection and scene plan against the real bridge, with plain
# Python (no Cinema 4D needed):
#   cargo build --example bridge_demo -p w3d-desktop
#   python3 tools/cinema4d/test_link.py target/debug/examples/bridge_demo
# It connects as the plugin does, pulls the seed block, checks the plan's axes and winding, then
# has Witness 3D name the document and group and hide the body, and rounds the block with Live
# Link on.

import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "Witness3DBridge"))
import w3d_link  # noqa: E402

server = subprocess.Popen([sys.argv[1], "8992"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
assert server.stdout.readline().startswith("listening")


def say(line):
    server.stdin.write(line + "\n")
    server.stdin.flush()
    return server.stdout.readline().strip()


def next_meshes(link):
    end = time.time() + 10
    while time.time() < end:
        m = link.inbox.get(timeout=10)
        if m.get("type") == "meshes":
            return m
    raise AssertionError("no meshes")


def signed_volume(mesh):
    """
    Volume by the divergence theorem, reading the points as right-handed. Witness 3D's triangles
    run anticlockwise seen from outside; Cinema 4D's run clockwise. The axes swap (a mirror) and
    the turned-over triangles each flip the sign, so a body facing out still comes out positive.
    """
    pts, v = mesh["points"], 0.0
    for a, b, c in mesh["polys"]:
        (ax, ay, az), (bx, by, bz), (cx, cy, cz) = pts[a], pts[b], pts[c]
        v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)
    return v / 6


try:
    link = w3d_link.Link("127.0.0.1", 8992)
    assert link.hello["type"] == "hello"
    link.send({"type": "refresh"})
    p = w3d_link.plan(next_meshes(link))
    assert p["document"] == "Witness 3D" and p["groups"] == [] and len(p["meshes"]) == 1
    block = p["meshes"][0]
    # The seed block is 30 mm tall: up is y in Cinema 4D.
    ys = [q[1] for q in block["points"]]
    assert min(ys) == 0 and max(ys) == 30, (min(ys), max(ys))
    vol = signed_volume(block)
    assert abs(vol - 80 * 50 * 30) < 1, vol

    link.send({"type": "live", "on": True})
    next_meshes(link)
    outline = {"document": "HOUSING", "objects": {"1": {"path": ["PARTS", "LID"], "hidden": True}}}
    assert say("outline " + json.dumps(outline)) == "ok"
    named = next_meshes(link)
    p = w3d_link.plan(named)
    assert p["document"] == "HOUSING"
    assert p["groups"] == [("PARTS",), ("PARTS", "LID")], p["groups"]
    assert p["meshes"][0]["path"] == ("PARTS", "LID") and p["meshes"][0]["hidden"]
    # Only visible leaves the hidden body out.
    assert w3d_link.plan(named, only_visible=True)["meshes"] == []

    assert say("fillet 4") == "ok"
    rounded = w3d_link.plan(next_meshes(link))["meshes"][0]
    assert rounded["revision"] > block["revision"] and len(rounded["polys"]) > len(block["polys"])
    assert signed_volume(rounded) < vol
    link.close()
    print("ok")
finally:
    say("quit")
    server.wait(timeout=10)
