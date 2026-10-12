// Witness 3D additions to the opencascade-sys bindings. See vendor/README.md.
//
// OpenCascade reports many failures by throwing Standard_Failure, which does not derive from
// std::exception. cxx only turns std::exception into a Rust Err, so every function here catches
// Standard_Failure and rethrows it as std::runtime_error; a stray one would abort the process.
#pragma once
#include "rust/cxx.h"
#include <BRepAlgoAPI_Common.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepAdaptor_CompCurve.hxx>
#include <BRepGProp.hxx>
#include <BRepGProp_Face.hxx>
#include <BRepLib.hxx>
#include <BRepOffsetAPI_MakePipeShell.hxx>
#include <BRepOffsetAPI_ThruSections.hxx>
#include <BRepOffset_MakeOffset.hxx>
#include <BRepPrimAPI_MakeRevol.hxx>
#include <GProp_GProps.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>
#include <gp_Trsf.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepTools_History.hxx>
#include <ShapeUpgrade_UnifySameDomain.hxx>
#include <ShapeFix_Shape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <functional>
#include <vector>
#include <BRepFilletAPI_MakeChamfer.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepTools.hxx>
#include <BRep_Builder.hxx>
#include <ChFiDS_ErrorStatus.hxx>
#include <Standard_Failure.hxx>
#include <TopExp.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <cmath>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>

inline std::runtime_error w3d_kernel_error(const Standard_Failure &f) {
  const char *msg = f.GetMessageString();
  return std::runtime_error(std::string("kernel: ") + f.DynamicType()->Name() + (msg && *msg ? std::string(" ") + msg : ""));
}

// Edges and faces are numbered by TopExp::MapShapes: each sub-shape once, in explorer order.
// The number is stable for an unchanged shape, which is all a selection needs within one version.
inline int32_t w3d_count(const TopoDS_Shape &shape, bool faces) {
  TopTools_IndexedMapOfShape map;
  TopExp::MapShapes(shape, faces ? TopAbs_FACE : TopAbs_EDGE, map);
  return map.Extent();
}

inline std::unique_ptr<TopoDS_Edge> w3d_edge(const TopoDS_Shape &shape, int32_t index) {
  TopTools_IndexedMapOfShape map;
  TopExp::MapShapes(shape, TopAbs_EDGE, map);
  if (index < 0 || index >= map.Extent()) throw std::out_of_range("no such edge");
  return std::unique_ptr<TopoDS_Edge>(new TopoDS_Edge(TopoDS::Edge(map(index + 1))));
}

inline std::unique_ptr<TopoDS_Face> w3d_face(const TopoDS_Shape &shape, int32_t index) {
  TopTools_IndexedMapOfShape map;
  TopExp::MapShapes(shape, TopAbs_FACE, map);
  if (index < 0 || index >= map.Extent()) throw std::out_of_range("no such face");
  return std::unique_ptr<TopoDS_Face>(new TopoDS_Face(TopoDS::Face(map(index + 1))));
}

inline const char *w3d_stripe_reason(ChFiDS_ErrorStatus status) {
  switch (status) {
  case ChFiDS_WalkingFailure:
    return "the round could not be traced along the edge; a neighbouring face is probably narrower than the radius";
  case ChFiDS_StartsolFailure:
    return "no starting point for the round was found; the radius is probably too large for the faces it joins";
  case ChFiDS_TwistedSurface:
    return "the rounding surface would twist on itself";
  default:
    return "the kernel could not build the round";
  }
}

// Add one edge to a chamfer: equal distances, or `size` on the edge's first face and an angle
// (radians) from it when `angle` is not 45 degrees.
inline void w3d_add_chamfer(BRepFilletAPI_MakeChamfer &c, const TopoDS_Shape &shape, double size, double angle,
                            const TopoDS_Edge &edge) {
  if (!(angle > 0) || std::fabs(angle - M_PI / 4) < 1e-9) { c.Add(size, edge); return; }
  TopTools_IndexedDataMapOfShapeListOfShape faces;
  TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, faces);
  const TopTools_ListOfShape &around = faces.FindFromKey(edge);
  if (around.IsEmpty()) { c.Add(size, edge); return; }
  c.AddDA(size, angle, edge, TopoDS::Face(around.First()));
}

// Round (fillet) or bevel (chamfer) the given edges by `size`. On failure throws a message of the
// form "BLEND|<failed edge numbers, comma separated>|<reason>" so the caller can point at the edges.
inline std::unique_ptr<TopoDS_Shape> w3d_blend_edges(const TopoDS_Shape &shape, rust::Slice<const int32_t> edges,
                                                     double size, bool chamfer, double angle) {
  TopTools_IndexedMapOfShape map;
  TopExp::MapShapes(shape, TopAbs_EDGE, map);
  for (int32_t e : edges)
    if (e < 0 || e >= map.Extent()) throw std::out_of_range("no such edge");
  try {
    if (chamfer) {
      BRepFilletAPI_MakeChamfer mk(shape);
      for (int32_t e : edges) w3d_add_chamfer(mk, shape, size, angle, TopoDS::Edge(map(e + 1)));
      mk.Build();
      if (!mk.IsDone()) throw std::runtime_error("BLEND||the kernel could not build the chamfer; try a smaller distance");
      return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(mk.Shape()));
    }
    BRepFilletAPI_MakeFillet mk(shape);
    for (int32_t e : edges) mk.Add(size, TopoDS::Edge(map(e + 1)));
    mk.Build();
    if (!mk.IsDone()) {
      std::string failed, reason;
      for (int i = 1; i <= mk.NbFaultyContours(); i++) {
        int ic = mk.FaultyContour(i);
        for (int j = 1; j <= mk.NbEdges(ic); j++) {
          int idx = map.FindIndex(mk.Edge(ic, j));
          if (idx > 0) failed += (failed.empty() ? "" : ",") + std::to_string(idx - 1);
        }
        if (reason.empty()) reason = w3d_stripe_reason(mk.StripeStatus(ic));
      }
      if (reason.empty() && mk.NbFaultyVertices() > 0)
        reason = "the round could not be finished where it meets a corner; try a smaller radius";
      if (reason.empty()) reason = "the kernel could not build the round";
      throw std::runtime_error("BLEND|" + failed + "|" + reason);
    }
    return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(mk.Shape()));
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

inline bool w3d_is_valid(const TopoDS_Shape &shape) {
  try {
    BRepCheck_Analyzer check(shape);
    return check.IsValid();
  } catch (const Standard_Failure &) {
    return false;
  }
}

// Repair small gaps, tolerances and orientation problems in imported geometry.
inline std::unique_ptr<TopoDS_Shape> w3d_heal(const TopoDS_Shape &shape) {
  try {
    ShapeFix_Shape fix(shape);
    fix.Perform();
    return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(fix.Shape()));
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// Exact geometry as OpenCascade's own BREP text, without display triangles.
inline rust::String w3d_write_brep(const TopoDS_Shape &shape) {
  std::ostringstream out;
  try {
    BRepTools::Write(shape, out, Standard_False, Standard_False, TopTools_FormatVersion_CURRENT);
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
  return rust::String(out.str());
}

inline std::unique_ptr<TopoDS_Shape> w3d_read_brep(rust::Str text) {
  std::istringstream in(std::string(text.data(), text.size()));
  std::unique_ptr<TopoDS_Shape> shape(new TopoDS_Shape());
  BRep_Builder builder;
  try {
    BRepTools::Read(*shape, in, builder);
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
  if (shape->IsNull()) throw std::runtime_error("not a BREP shape");
  return shape;
}

// ---------------------------------------------------------------------------------------------
// Operations with history: which faces and edges of the result came from which of the inputs.
// This is what keeps a selection, or an AI proposal that names edges, valid across an operation:
// an edge number changes, but its lineage is known.

struct W3dResult {
  TopoDS_Shape shape;
  // [input][kind] flat (source index, result index) pairs. kind 0: faces that are, or were cut
  // from, the source face; 1: the same for edges; 2: faces generated from a source edge (a
  // fillet's rounds).
  std::vector<int32_t> pairs[2][3];
};

using W3dSuccessors = std::function<void(const TopoDS_Shape &, TopTools_ListOfShape &)>;

// Successors through one step: removed means none, modified means its pieces, else itself.
inline W3dSuccessors w3d_step(BRepBuilderAPI_MakeShape &mk) {
  return [&mk](const TopoDS_Shape &s, TopTools_ListOfShape &out) {
    if (mk.IsDeleted(s)) return;
    const TopTools_ListOfShape &m = mk.Modified(s);
    if (m.IsEmpty()) out.Append(s);
    else for (TopTools_ListOfShape::Iterator it(m); it.More(); it.Next()) out.Append(it.Value());
  };
}

inline W3dSuccessors w3d_step(const Handle(BRepTools_History) & h) {
  return [h](const TopoDS_Shape &s, TopTools_ListOfShape &out) {
    if (h.IsNull()) { out.Append(s); return; }
    if (h->IsRemoved(s)) return;
    const TopTools_ListOfShape &m = h->Modified(s);
    if (m.IsEmpty()) out.Append(s);
    else for (TopTools_ListOfShape::Iterator it(m); it.More(); it.Next()) out.Append(it.Value());
  };
}

// Record, for every face and edge of `input`, where its successors through `steps` landed in `result`.
inline void w3d_record(W3dResult &r, int which, const TopoDS_Shape &input, const std::vector<W3dSuccessors> &steps) {
  for (int kind = 0; kind < 2; kind++) {
    TopAbs_ShapeEnum type = kind == 0 ? TopAbs_FACE : TopAbs_EDGE;
    TopTools_IndexedMapOfShape in, out;
    TopExp::MapShapes(input, type, in);
    TopExp::MapShapes(r.shape, type, out);
    for (int i = 1; i <= in.Extent(); i++) {
      TopTools_ListOfShape now;
      now.Append(in(i));
      for (const auto &step : steps) {
        TopTools_ListOfShape next;
        for (TopTools_ListOfShape::Iterator it(now); it.More(); it.Next()) step(it.Value(), next);
        now = next;
      }
      for (TopTools_ListOfShape::Iterator it(now); it.More(); it.Next()) {
        if (it.Value().ShapeType() != type) continue;
        int j = out.FindIndex(it.Value());
        if (j > 0) {
          r.pairs[which][kind].push_back(i - 1);
          r.pairs[which][kind].push_back(j - 1);
        }
      }
    }
  }
}

// Union (0), difference (1) or intersection (2), then merge coplanar faces like Shape::clean.
inline std::unique_ptr<W3dResult> w3d_boolean(const TopoDS_Shape &a, const TopoDS_Shape &b, int32_t op) {
  try {
    std::unique_ptr<BRepAlgoAPI_BooleanOperation> mk;
    if (op == 0) mk.reset(new BRepAlgoAPI_Fuse());
    else if (op == 1) mk.reset(new BRepAlgoAPI_Cut());
    else mk.reset(new BRepAlgoAPI_Common());
    TopTools_ListOfShape args, tools;
    args.Append(a);
    tools.Append(b);
    mk->SetArguments(args);
    mk->SetTools(tools);
    mk->SetRunParallel(Standard_True);
    mk->Build();
    if (!mk->IsDone() || mk->HasErrors()) throw std::runtime_error("the boolean operation failed");
    ShapeUpgrade_UnifySameDomain unify(mk->Shape(), Standard_True, Standard_True, Standard_True);
    unify.AllowInternalEdges(Standard_False);
    unify.Build();
    std::unique_ptr<W3dResult> r(new W3dResult());
    r->shape = unify.Shape();
    std::vector<W3dSuccessors> steps{w3d_step(*mk), w3d_step(unify.History())};
    w3d_record(*r, 0, a, steps);
    w3d_record(*r, 1, b, steps);
    return r;
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// w3d_blend_edges with history: the body's faces and edges, plus the faces each edge became.
inline std::unique_ptr<W3dResult> w3d_blend_edges_history(const TopoDS_Shape &shape, rust::Slice<const int32_t> edges,
                                                          double size, bool chamfer, double angle) {
  TopTools_IndexedMapOfShape map;
  TopExp::MapShapes(shape, TopAbs_EDGE, map);
  for (int32_t e : edges)
    if (e < 0 || e >= map.Extent()) throw std::out_of_range("no such edge");
  std::unique_ptr<W3dResult> r(new W3dResult());
  try {
    std::unique_ptr<BRepFilletAPI_LocalOperation> mk;
    if (chamfer) {
      BRepFilletAPI_MakeChamfer *c = new BRepFilletAPI_MakeChamfer(shape);
      mk.reset(c);
      for (int32_t e : edges) w3d_add_chamfer(*c, shape, size, angle, TopoDS::Edge(map(e + 1)));
    } else {
      BRepFilletAPI_MakeFillet *f = new BRepFilletAPI_MakeFillet(shape);
      mk.reset(f);
      for (int32_t e : edges) f->Add(size, TopoDS::Edge(map(e + 1)));
    }
    mk->Build();
    if (!mk->IsDone()) {
      // Run the reporting version for the reason and the edges.
      w3d_blend_edges(shape, edges, size, chamfer, angle);
      throw std::runtime_error("BLEND||the kernel could not build the blend");
    }
    r->shape = mk->Shape();
    w3d_record(*r, 0, shape, {w3d_step(*mk)});
    TopTools_IndexedMapOfShape faces;
    TopExp::MapShapes(r->shape, TopAbs_FACE, faces);
    for (int i = 1; i <= map.Extent(); i++) {
      const TopTools_ListOfShape &g = mk->Generated(map(i));
      for (TopTools_ListOfShape::Iterator it(g); it.More(); it.Next()) {
        int j = faces.FindIndex(it.Value());
        if (j > 0) { r->pairs[0][2].push_back(i - 1); r->pairs[0][2].push_back(j - 1); }
      }
    }
    return r;
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

inline std::unique_ptr<TopoDS_Shape> w3d_result_shape(const W3dResult &r) {
  return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(r.shape));
}

inline rust::Vec<int32_t> w3d_result_pairs(const W3dResult &r, int32_t input, int32_t kind) {
  rust::Vec<int32_t> v;
  if (input < 0 || input > 1 || kind < 0 || kind > 2) return v;
  for (int32_t x : r.pairs[input][kind]) v.push_back(x);
  return v;
}

// --- Revolve, loft, sweep and offset face --------------------------------------------------------
// Profiles and paths arrive as plain numbers so no wire or face crosses the language boundary.
// A section is [0, n, x, y, z, ...] (a closed polygon of n corners) or [1, cx, cy, cz, nx, ny, nz, r]
// (a circle). A path is a section, or [2, n, x, y, z, ...] for an open polyline.

inline TopoDS_Wire w3d_section(const double *&p, const double *end) {
  auto need = [&](size_t n) { if (p + n > end) throw std::runtime_error("a profile is cut short"); };
  need(1);
  int kind = int(*p++);
  if (kind == 1) {
    need(7);
    gp_Pnt c(p[0], p[1], p[2]);
    gp_Dir n(p[3], p[4], p[5]);
    double r = p[6];
    p += 7;
    if (!(r > 0)) throw std::runtime_error("a circle needs a radius greater than zero");
    return BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(gp_Circ(gp_Ax2(c, n), r)).Edge()).Wire();
  }
  if (kind != 0 && kind != 2) throw std::runtime_error("unknown profile kind");
  need(1);
  int n = int(*p++);
  need(size_t(n) * 3);
  if (n < 2 || (kind == 0 && n < 3)) throw std::runtime_error("a profile needs more corners");
  BRepBuilderAPI_MakePolygon poly;
  for (int i = 0; i < n; i++, p += 3) poly.Add(gp_Pnt(p[0], p[1], p[2]));
  if (kind == 0) poly.Close();
  if (!poly.IsDone()) throw std::runtime_error("the profile has repeated corners");
  return poly.Wire();
}

inline TopoDS_Wire w3d_one_section(rust::Slice<const double> data) {
  const double *p = data.data(), *end = data.data() + data.size();
  return w3d_section(p, end);
}

// The profile turned `angle` radians about the axis through (ax, ay, az) along (dx, dy, dz).
inline std::unique_ptr<TopoDS_Shape> w3d_revolve(rust::Slice<const double> section, rust::Slice<const double> axis,
                                                 double angle) {
  try {
    if (axis.size() != 6) throw std::runtime_error("an axis is a point and a direction");
    TopoDS_Face face = BRepBuilderAPI_MakeFace(w3d_one_section(section), Standard_True).Face();
    gp_Ax1 ax(gp_Pnt(axis[0], axis[1], axis[2]), gp_Dir(axis[3], axis[4], axis[5]));
    BRepPrimAPI_MakeRevol mk(face, ax, angle, Standard_True);
    mk.Build();
    if (!mk.IsDone()) throw std::runtime_error("the profile could not be revolved about that axis");
    return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(mk.Shape()));
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// A solid through the sections, in order.
inline std::unique_ptr<TopoDS_Shape> w3d_loft(rust::Slice<const double> sections) {
  try {
    const double *p = sections.data(), *end = sections.data() + sections.size();
    BRepOffsetAPI_ThruSections mk(Standard_True, Standard_False);
    int n = 0;
    while (p < end) { mk.AddWire(w3d_section(p, end)); n++; }
    if (n < 2) throw std::runtime_error("a loft needs two profiles or more");
    mk.Build();
    if (!mk.IsDone()) throw std::runtime_error("no surface could be lofted through those profiles");
    return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(mk.Shape()));
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// The profile swept along the path. The far end is turned by `twist` radians about the profile's
// centre and scaled by `scale`; the section changes evenly in between.
//
// Without a twist this is one pipe shell, with mitred corners, its far section carried along the
// path when it is scaled. A twist is not a straight blend between two sections (that would pinch
// the middle), so a twisted sweep is lofted through sections carried along the path at even steps,
// each turned its share of the twist.
inline std::unique_ptr<TopoDS_Shape> w3d_sweep(rust::Slice<const double> section, rust::Slice<const double> path,
                                               double twist, double scale) {
  try {
    TopoDS_Wire profile = w3d_one_section(section);
    TopoDS_Wire spine = w3d_one_section(path);
    bool plain = std::fabs(twist) < 1e-12 && std::fabs(scale - 1) < 1e-12;
    if (!(scale > 0)) throw std::runtime_error("the end scale must be greater than zero");
    if (!plain && spine.Closed()) throw std::runtime_error("twist and scale need a path with two ends");

    TopoDS_Face face = BRepBuilderAPI_MakeFace(profile, Standard_True).Face();
    GProp_GProps props;
    BRepGProp::SurfaceProperties(face, props);
    gp_Pnt c = props.CentreOfMass();
    BRepGProp_Face normal_at(face);
    double u0, u1, v0, v1;
    normal_at.Bounds(u0, u1, v0, v1);
    gp_Pnt pt;
    gp_Vec n;
    normal_at.Normal((u0 + u1) / 2, (v0 + v1) / 2, pt, n);

    BRepAdaptor_CompCurve along(spine);
    // The section a fraction `f` along the path: turned and scaled about its centre, then carried
    // by the path's own turn (parallel transport through `steps` samples) and position.
    auto section_at = [&](double f, int steps) {
      gp_Trsf turn, grow, carry, move;
      turn.SetRotation(gp_Ax1(c, gp_Dir(n)), twist * f);
      grow.SetScale(c, 1 + (scale - 1) * f);
      double t0 = along.FirstParameter(), t1 = along.FirstParameter() + (along.LastParameter() - along.FirstParameter()) * f;
      gp_Pnt start, p;
      gp_Vec prev, tan;
      along.D1(t0, start, prev);
      for (int i = 1; i <= steps; i++) {
        along.D1(t0 + (t1 - t0) * i / steps, p, tan);
        if (prev.Magnitude() > 1e-12 && tan.Magnitude() > 1e-12 && !prev.IsParallel(tan, 1e-9)) {
          gp_Trsf r;
          r.SetRotation(gp_Ax1(start, gp_Dir(prev.Crossed(tan))), prev.Angle(tan));
          carry = r * carry;
        }
        prev = tan;
      }
      along.D0(t1, p);
      move.SetTranslation(start, p);
      return BRepBuilderAPI_Transform(profile, move * carry * grow * turn, Standard_True).Shape();
    };

    if (std::fabs(twist) > 1e-12) {
      int n_sections = std::max(8, int(std::ceil(std::fabs(twist) / (M_PI / 12))));
      BRepOffsetAPI_ThruSections mk(Standard_True, Standard_False);
      for (int i = 0; i <= n_sections; i++) mk.AddWire(TopoDS::Wire(section_at(double(i) / n_sections, 4 * n_sections)));
      mk.CheckCompatibility(Standard_False);
      mk.Build();
      if (!mk.IsDone()) throw std::runtime_error("the profile could not be twisted along that path");
      return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(mk.Shape()));
    }

    BRepOffsetAPI_MakePipeShell mk(spine);
    mk.SetMode(Standard_False);
    mk.SetTransitionMode(BRepBuilderAPI_RightCorner);
    mk.Add(profile, Standard_False, Standard_False);
    if (!plain) {
      TopoDS_Vertex first, last;
      TopExp::Vertices(spine, first, last);
      mk.Add(section_at(1, 64), last, Standard_False, Standard_False);
    }
    mk.Build();
    if (!mk.IsDone()) throw std::runtime_error("the profile could not be swept along that path");
    if (!mk.MakeSolid()) throw std::runtime_error("the sweep did not close into a solid");
    return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(mk.Shape()));
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// Plasticity's Offset Face: the numbered faces move `distance` along their normals and their
// neighbours stretch or shrink to meet them. Faces and edges are traced into the result.
inline std::unique_ptr<W3dResult> w3d_offset_faces(const TopoDS_Shape &shape, rust::Slice<const int32_t> faces,
                                                   double distance) {
  TopTools_IndexedMapOfShape map;
  TopExp::MapShapes(shape, TopAbs_FACE, map);
  for (int32_t f : faces)
    if (f < 0 || f >= map.Extent()) throw std::out_of_range("no such face");
  try {
    BRepOffset_MakeOffset mk;
    mk.Initialize(shape, 0.0, 1e-6, BRepOffset_Skin, Standard_False, Standard_False, GeomAbs_Intersection,
                  Standard_False, Standard_True);
    for (int32_t f : faces) mk.SetOffsetOnFace(TopoDS::Face(map(f + 1)), distance);
    mk.MakeOffsetShape();
    if (!mk.IsDone() || mk.Shape().IsNull())
      throw std::runtime_error("the faces could not be offset that far; try a smaller distance");
    std::unique_ptr<W3dResult> r(new W3dResult());
    r->shape = mk.Shape();
    if (!w3d_is_valid(r->shape)) throw std::runtime_error("offsetting that far breaks the body; try a smaller distance");
    // MakeOffset reports each face's and edge's offset image as "generated" from it.
    W3dSuccessors step = [&mk](const TopoDS_Shape &s, TopTools_ListOfShape &out) {
      const TopTools_ListOfShape &g = mk.Generated(s);
      if (!g.IsEmpty()) { for (TopTools_ListOfShape::Iterator it(g); it.More(); it.Next()) out.Append(it.Value()); return; }
      if (!mk.IsDeleted(s)) out.Append(s);
    };
    w3d_record(*r, 0, shape, {step});
    return r;
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}
