// Witness 3D additions to the opencascade-sys bindings. See vendor/README.md.
//
// OpenCascade reports many failures by throwing Standard_Failure, which does not derive from
// std::exception. cxx only turns std::exception into a Rust Err, so every function here catches
// Standard_Failure and rethrows it as std::runtime_error; a stray one would abort the process.
#pragma once
#include "rust/cxx.h"
#include <BRepCheck_Analyzer.hxx>
#include <BRepFilletAPI_MakeChamfer.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepTools.hxx>
#include <BRep_Builder.hxx>
#include <ChFiDS_ErrorStatus.hxx>
#include <Standard_Failure.hxx>
#include <TopExp.hxx>
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

// Round (fillet) or bevel (chamfer) the given edges by `size`. On failure throws a message of the
// form "BLEND|<failed edge numbers, comma separated>|<reason>" so the caller can point at the edges.
inline std::unique_ptr<TopoDS_Shape> w3d_blend_edges(const TopoDS_Shape &shape, rust::Slice<const int32_t> edges,
                                                     double size, bool chamfer) {
  TopTools_IndexedMapOfShape map;
  TopExp::MapShapes(shape, TopAbs_EDGE, map);
  for (int32_t e : edges)
    if (e < 0 || e >= map.Extent()) throw std::out_of_range("no such edge");
  try {
    if (chamfer) {
      BRepFilletAPI_MakeChamfer mk(shape);
      for (int32_t e : edges) mk.Add(size, TopoDS::Edge(map(e + 1)));
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
