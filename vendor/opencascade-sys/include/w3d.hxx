// Witness 3D additions to the opencascade-sys bindings. See vendor/README.md.
//
// OpenCascade reports many failures by throwing Standard_Failure, which does not derive from
// std::exception. cxx only turns std::exception into a Rust Err, so every function here catches
// Standard_Failure and rethrows it as std::runtime_error; a stray one would abort the process.
#pragma once
#include "rust/cxx.h"
#include <BRepAlgoAPI_Common.hxx>
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
