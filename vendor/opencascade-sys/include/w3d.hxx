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
#include <BRepAdaptor_Surface.hxx>
#include <BRepGProp.hxx>
#include <BRepGProp_Face.hxx>
#include <BRepLib.hxx>
#include <BRepOffsetAPI_MakeOffset.hxx>
#include <BRepOffsetAPI_MakeFilling.hxx>
#include <BRepLib_FindSurface.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <BRepGProp_Face.hxx>
#include <HLRBRep_Algo.hxx>
#include <ElSLib.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <HLRBRep_HLRToShape.hxx>
#include <HLRAlgo_Projector.hxx>
#include <BRepClass_FaceClassifier.hxx>
#include <BRepAlgoAPI_Splitter.hxx>
#include <Geom_BSplineSurface.hxx>
#include <Geom2d_Curve.hxx>
#include <TColStd_HArray1OfReal.hxx>
#include <TColgp_Array2OfPnt.hxx>
#include <BRepOffsetAPI_MakePipeShell.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <GC_MakeArcOfCircle.hxx>
#include <GeomAPI_Interpolate.hxx>
#include <TColgp_HArray1OfPnt.hxx>
#include <BRepOffsetAPI_ThruSections.hxx>
#include <BRepOffset_MakeOffset.hxx>
#include <BRepOffsetAPI_MakeThickSolid.hxx>
#include <BRepAlgoAPI_Defeaturing.hxx>
#include <BRepAlgoAPI_Splitter.hxx>
#include <BRepAlgoAPI_Section.hxx>
#include <BRepExtrema_DistShapeShape.hxx>
#include <IntCurvesFace_ShapeIntersector.hxx>
#include <gp_Lin.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <BRep_Tool.hxx>
#include <GeomConvert.hxx>
#include <GeomConvert_CompCurveToBSplineCurve.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <ShapeAnalysis_FreeBounds.hxx>
#include <TopTools_HSequenceOfShape.hxx>
#include <TopoDS_Iterator.hxx>
#include <TopoDS_Compound.hxx>
#include <algorithm>
#include <Geom_BSplineCurve.hxx>
#include <TColStd_Array1OfInteger.hxx>
#include <TColStd_Array1OfReal.hxx>
#include <TColgp_Array1OfPnt.hxx>
#include <BRepPrimAPI_MakeRevol.hxx>
#include <GProp_GProps.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>
#include <gp_Elips.hxx>
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
#include <BRepLib.hxx>
#include <BRepOffsetAPI_DraftAngle.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <Geom2d_Line.hxx>
#include <BRepBndLib.hxx>
#include <Bnd_Box.hxx>
#include <gp_Pln.hxx>
#include <BRep_Builder.hxx>
#include <ChFiDS_ErrorStatus.hxx>
#include <Standard_Failure.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
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
  // Further results beside `shape`, such as the other pieces of a cut (a compound, maybe empty).
  TopoDS_Shape others;
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
// A section is [0, n, x, y, z, ...] (a closed polygon of n corners), [1, cx, cy, cz, nx, ny, nz, r]
// (a circle) or [3, n, 1, x, y, z, ...] (a closed spline through n points). A path is a section,
// [2, n, x, y, z, ...] for an open polyline, [3, n, 0, x, y, z, ...] for an open spline, or
// [4, x, y, z, x, y, z, x, y, z] for an arc from its first point through its second to its third.
// [5, cx, cy, cz, nx, ny, nz, ax, ay, az, R, r] is an ellipse with radius R along (ax, ay, az) and r
// across it (R >= r), and [6, m, ...] is a contour: m open pieces of the kinds above joined end to
// end (Plasticity's Join Curves), closed when its ends meet. [8, n, closed, x, y, z, ...] is a
// control-point curve: a uniform B-spline, cubic where it has the points for it, clamped to its ends
// when open and periodic when closed (Plasticity's Control Point Curve).

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
  if (kind == 3) {
    need(2);
    int n = int(*p++);
    bool closed = *p++ != 0;
    need(size_t(n) * 3);
    if (n < 2 || (closed && n < 3)) throw std::runtime_error("a curve needs more points");
    Handle(TColgp_HArray1OfPnt) pts = new TColgp_HArray1OfPnt(1, n);
    for (int i = 1; i <= n; i++, p += 3) pts->SetValue(i, gp_Pnt(p[0], p[1], p[2]));
    GeomAPI_Interpolate fit(pts, closed, 1e-7);
    fit.Perform();
    if (!fit.IsDone()) throw std::runtime_error("no smooth curve passes through those points");
    return BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(fit.Curve()).Edge()).Wire();
  }
  if (kind == 8) {
    need(2);
    int n = int(*p++);
    bool closed = *p++ != 0;
    need(size_t(n) * 3);
    if (n < 2 || (closed && n < 3)) throw std::runtime_error("a curve needs more control points");
    int deg = n - 1 < 3 ? n - 1 : 3;
    TColgp_Array1OfPnt poles(1, n);
    for (int i = 1; i <= n; i++, p += 3) poles.SetValue(i, gp_Pnt(p[0], p[1], p[2]));
    Handle(Geom_BSplineCurve) curve;
    if (closed) {
      TColStd_Array1OfReal knots(1, n + 1);
      TColStd_Array1OfInteger mults(1, n + 1);
      for (int i = 1; i <= n + 1; i++) { knots.SetValue(i, i - 1); mults.SetValue(i, 1); }
      curve = new Geom_BSplineCurve(poles, knots, mults, deg, Standard_True);
    } else {
      int k = n - deg + 1;
      TColStd_Array1OfReal knots(1, k);
      TColStd_Array1OfInteger mults(1, k);
      for (int i = 1; i <= k; i++) { knots.SetValue(i, double(i - 1) / (k - 1)); mults.SetValue(i, i == 1 || i == k ? deg + 1 : 1); }
      curve = new Geom_BSplineCurve(poles, knots, mults, deg, Standard_False);
    }
    return BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(curve).Edge()).Wire();
  }
  if (kind == 9) {
    // A NURBS curve as it is stored: [9, degree, n, k, n poles x y z, n weights, k flat knots].
    need(3);
    int deg = int(p[0]), n = int(p[1]), k = int(p[2]);
    p += 3;
    if (deg < 1 || n < deg + 1 || k != n + deg + 1) throw std::runtime_error("a NURBS curve's knots do not match its poles");
    need(size_t(n) * 4 + size_t(k));
    TColgp_Array1OfPnt poles(1, n);
    TColStd_Array1OfReal weights(1, n);
    for (int i = 1; i <= n; i++, p += 3) poles.SetValue(i, gp_Pnt(p[0], p[1], p[2]));
    for (int i = 1; i <= n; i++) {
      if (!(*p > 0)) throw std::runtime_error("a NURBS curve's weights must be positive");
      weights.SetValue(i, *p++);
    }
    std::vector<double> distinct;
    std::vector<int> mult;
    for (int i = 0; i < k; i++, p++) {
      if (i && *p < distinct.back() - 1e-12) throw std::runtime_error("a NURBS curve's knots must not decrease");
      if (i && *p - distinct.back() < 1e-12) mult.back()++;
      else { distinct.push_back(*p); mult.push_back(1); }
    }
    TColStd_Array1OfReal knots(1, int(distinct.size()));
    TColStd_Array1OfInteger mults(1, int(distinct.size()));
    for (size_t i = 0; i < distinct.size(); i++) { knots.SetValue(int(i) + 1, distinct[i]); mults.SetValue(int(i) + 1, mult[i]); }
    Handle(Geom_BSplineCurve) curve = new Geom_BSplineCurve(poles, weights, knots, mults, deg, Standard_False);
    return BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(curve).Edge()).Wire();
  }
  if (kind == 5) {
    need(11);
    gp_Pnt c(p[0], p[1], p[2]);
    gp_Dir n(p[3], p[4], p[5]), a(p[6], p[7], p[8]);
    double R = p[9], r = p[10];
    p += 11;
    if (!(r > 0) || R < r) throw std::runtime_error("an ellipse needs two radii greater than zero");
    return BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(gp_Elips(gp_Ax2(c, n, a), R, r)).Edge()).Wire();
  }
  if (kind == 6) {
    need(1);
    int m = int(*p++);
    if (m < 1) throw std::runtime_error("a contour needs a piece");
    BRepBuilderAPI_MakeWire mk;
    for (int i = 0; i < m; i++) {
      TopoDS_Wire piece = w3d_section(p, end);
      for (TopExp_Explorer ex(piece, TopAbs_EDGE); ex.More(); ex.Next()) {
        mk.Add(TopoDS::Edge(ex.Current()));
        if (!mk.IsDone()) throw std::runtime_error("the curves do not meet end to end");
      }
    }
    return mk.Wire();
  }
  if (kind == 7) {
    // A helix: a straight line unrolled on the cylinder through its start.
    need(13);
    gp_Pnt o(p[0], p[1], p[2]);
    gp_Dir n(p[3], p[4], p[5]), x(p[6], p[7], p[8]);
    double r = p[9], length = p[10], turns = p[11];
    bool left = p[12] != 0;
    p += 13;
    if (!(r > 0 && length > 0 && turns > 0)) throw std::runtime_error("a spiral needs a radius, a length and turns greater than zero");
    Handle(Geom_CylindricalSurface) cyl = new Geom_CylindricalSurface(gp_Ax3(o, n, x), r);
    double pitch = length / turns;
    gp_Vec2d d((left ? -1 : 1) * 2 * M_PI, pitch);
    Handle(Geom2d_Line) line = new Geom2d_Line(gp_Pnt2d(0, 0), gp_Dir2d(d));
    TopoDS_Edge e = BRepBuilderAPI_MakeEdge(line, cyl, 0, turns * d.Magnitude()).Edge();
    BRepLib::BuildCurves3d(e);
    return BRepBuilderAPI_MakeWire(e).Wire();
  }
  if (kind == 4) {
    need(9);
    gp_Pnt a(p[0], p[1], p[2]), b(p[3], p[4], p[5]), c(p[6], p[7], p[8]);
    p += 9;
    GC_MakeArcOfCircle arc(a, b, c);
    if (!arc.IsDone()) throw std::runtime_error("the three points of an arc must not lie on a line");
    return BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(arc.Value()).Edge()).Wire();
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
inline TopoDS_Wire w3d_offset_wire(const TopoDS_Wire &w, double d);
inline TopoDS_Shape w3d_cut(const TopoDS_Shape &a, const TopoDS_Shape &b, const char *why);

inline TopoDS_Shape w3d_revolved(const TopoDS_Wire &w, const gp_Ax1 &ax, double angle) {
  TopoDS_Face face = BRepBuilderAPI_MakeFace(w, Standard_True).Face();
  BRepPrimAPI_MakeRevol mk(face, ax, angle, Standard_True);
  mk.Build();
  if (!mk.IsDone()) throw std::runtime_error("the profile could not be revolved about that axis");
  return mk.Shape();
}

// With a `thickness`, only walls that thick inside the outline are turned (Shift+T).
inline std::unique_ptr<TopoDS_Shape> w3d_revolve(rust::Slice<const double> section, rust::Slice<const double> axis,
                                                 double angle, double thickness) {
  try {
    if (axis.size() != 6) throw std::runtime_error("an axis is a point and a direction");
    if (!(thickness >= 0)) throw std::runtime_error("a thickness can't be negative");
    TopoDS_Wire w = w3d_one_section(section);
    gp_Ax1 ax(gp_Pnt(axis[0], axis[1], axis[2]), gp_Dir(axis[3], axis[4], axis[5]));
    TopoDS_Shape r = w3d_revolved(w, ax, angle);
    if (thickness > 1e-12) r = w3d_cut(r, w3d_revolved(w3d_offset_wire(w, -thickness), ax, angle), "the walls could not be made that thick");
    return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(r));
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
    // Along a spiral the profile follows the Frenet frame, so it stays upright to the axis.
    mk.SetMode(path.size() > 0 && int(path[0]) == 7 ? Standard_True : Standard_False);
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
// neighbours stretch or shrink to meet them. With an `angle` (A, "Angle Adjacent") the faces
// sharing a sharp edge with them then lean by that many radians, pivoting where they end away from
// the moved face, so that face shrinks (positive) or grows. Faces and edges are traced through.
inline std::unique_ptr<W3dResult> w3d_offset_faces(const TopoDS_Shape &shape, rust::Slice<const int32_t> faces,
                                                   double distance, double angle) {
  TopTools_IndexedMapOfShape map;
  TopExp::MapShapes(shape, TopAbs_FACE, map);
  for (int32_t f : faces)
    if (f < 0 || f >= map.Extent()) throw std::out_of_range("no such face");
  try {
    std::vector<W3dSuccessors> steps;
    TopoDS_Shape now = shape;
    std::vector<TopoDS_Face> moved;
    for (int32_t f : faces) moved.push_back(TopoDS::Face(map(f + 1)));
    std::shared_ptr<BRepOffset_MakeOffset> mk;
    if (std::fabs(distance) > 1e-12) {
      mk.reset(new BRepOffset_MakeOffset());
      mk->Initialize(shape, 0.0, 1e-6, BRepOffset_Skin, Standard_False, Standard_False, GeomAbs_Intersection,
                     Standard_False, Standard_True);
      for (const auto &f : moved) mk->SetOffsetOnFace(f, distance);
      mk->MakeOffsetShape();
      if (!mk->IsDone() || mk->Shape().IsNull())
        throw std::runtime_error("the faces could not be offset that far; try a smaller distance");
      now = mk->Shape();
      // MakeOffset reports each face's and edge's offset image as "generated" from it.
      W3dSuccessors step = [mk](const TopoDS_Shape &s, TopTools_ListOfShape &out) {
        const TopTools_ListOfShape &g = mk->Generated(s);
        if (!g.IsEmpty()) { for (TopTools_ListOfShape::Iterator it(g); it.More(); it.Next()) out.Append(it.Value()); return; }
        if (!mk->IsDeleted(s)) out.Append(s);
      };
      steps.push_back(step);
      std::vector<TopoDS_Face> images;
      for (const auto &f : moved) {
        TopTools_ListOfShape l;
        step(f, l);
        for (TopTools_ListOfShape::Iterator it(l); it.More(); it.Next())
          if (it.Value().ShapeType() == TopAbs_FACE) images.push_back(TopoDS::Face(it.Value()));
      }
      moved = images;
    }
    if (std::fabs(angle) > 1e-12) {
      TopTools_IndexedDataMapOfShapeListOfShape owners;
      TopExp::MapShapesAndAncestors(now, TopAbs_EDGE, TopAbs_FACE, owners);
      TopTools_IndexedMapOfShape picked;
      for (const auto &f : moved) picked.Add(f);
      std::shared_ptr<BRepOffsetAPI_DraftAngle> draft(new BRepOffsetAPI_DraftAngle(now));
      TopTools_IndexedMapOfShape done;
      for (const auto &f : moved) {
        BRepAdaptor_Surface surf(f);
        if (surf.GetType() != GeomAbs_Plane) throw std::runtime_error("an angle needs flat faces");
        gp_Dir n = surf.Plane().Axis().Direction();
        if (f.Orientation() == TopAbs_REVERSED) n.Reverse();
        gp_Pnt o = surf.Plane().Location();
        // The neighbours across sharp edges, and how far they reach back from the face.
        std::vector<TopoDS_Face> slopes;
        double reach = 0;
        for (TopExp_Explorer ex(f, TopAbs_EDGE); ex.More(); ex.Next()) {
          const TopTools_ListOfShape &l = owners.FindFromKey(ex.Current());
          for (TopTools_ListOfShape::Iterator it(l); it.More(); it.Next()) {
            const TopoDS_Face &g = TopoDS::Face(it.Value());
            if (picked.Contains(g) || done.Contains(g)) continue;
            if (BRep_Tool::Continuity(TopoDS::Edge(ex.Current()), f, g) > GeomAbs_C0) continue;
            done.Add(g);
            slopes.push_back(g);
            Bnd_Box b;
            BRepBndLib::Add(g, b);
            double x0, y0, z0, x1, y1, z1;
            b.Get(x0, y0, z0, x1, y1, z1);
            for (int k = 0; k < 8; k++) {
              gp_Vec v(o, gp_Pnt(k & 1 ? x1 : x0, k & 2 ? y1 : y0, k & 4 ? z1 : z0));
              reach = std::min(reach, v.Dot(gp_Vec(n)));
            }
          }
        }
        gp_Pln neutral(o.Translated(gp_Vec(n) * reach), n);
        for (const auto &g : slopes) {
          draft->Add(g, n, angle, neutral);
          if (!draft->AddDone()) throw std::runtime_error("the faces next to it cannot lean that far");
        }
      }
      if (done.IsEmpty()) throw std::runtime_error("no faces meet it at a sharp edge to lean");
      draft->Build();
      if (!draft->IsDone()) throw std::runtime_error("the faces next to it cannot lean that far; try a smaller angle");
      now = draft->Shape();
      steps.push_back([draft](const TopoDS_Shape &s, TopTools_ListOfShape &out) {
        // DraftAngle reports nothing as Modified; ModifiedShape gives each image.
        try { out.Append(draft->ModifiedShape(s)); } catch (const Standard_Failure &) { out.Append(s); }
      });
    }
    if (steps.empty()) throw std::runtime_error("nothing to change");
    std::unique_ptr<W3dResult> r(new W3dResult());
    r->shape = now;
    if (!w3d_is_valid(r->shape)) throw std::runtime_error("offsetting that far breaks the body; try a smaller distance");
    w3d_record(*r, 0, shape, steps);
    return r;
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// --- Extrude with an angle, a wall thickness and a second side ----------------------------------
// Plasticity's Extrude options: A tapers the sides by `angle` radians (positive narrows away from
// the profile), Shift+T leaves walls `thickness` thick inside the outline, and `back` extrudes the
// other way too (S locks it to the same distance).

// The planar wire grown outwards by `d` (shrunk when negative), with sharp corners.
inline TopoDS_Wire w3d_offset_wire(const TopoDS_Wire &w, double d) {
  if (std::fabs(d) < 1e-12) return w;
  TopoDS_Face face = BRepBuilderAPI_MakeFace(w, Standard_True).Face();
  BRepOffsetAPI_MakeOffset mk(face, GeomAbs_Intersection);
  mk.Perform(d);
  if (!mk.IsDone()) throw std::runtime_error("the outline cannot be shrunk that far");
  TopTools_IndexedMapOfShape wires;
  TopExp::MapShapes(mk.Shape(), TopAbs_WIRE, wires);
  if (wires.Extent() != 1) throw std::runtime_error("the outline cannot be shrunk that far");
  return TopoDS::Wire(wires(1));
}

inline TopoDS_Wire w3d_moved(const TopoDS_Wire &w, const gp_Vec &v) {
  gp_Trsf t;
  t.SetTranslation(v);
  return TopoDS::Wire(BRepBuilderAPI_Transform(w, t, Standard_True).Shape());
}

// The area a closed planar wire encloses.
inline double w3d_enclosed(const TopoDS_Wire &w) {
  GProp_GProps g;
  BRepGProp::SurfaceProperties(BRepBuilderAPI_MakeFace(w, Standard_True).Face(), g);
  return std::fabs(g.Mass());
}

// The wire grown by `d` (shrunk when negative) whichever way round it runs: a hole's wire runs the
// other way, which turns OpenCascade's offset inside out.
inline TopoDS_Wire w3d_grown(const TopoDS_Wire &w, double d) {
  if (std::fabs(d) < 1e-12) return w;
  TopoDS_Wire r = w3d_offset_wire(w, d);
  if ((w3d_enclosed(r) > w3d_enclosed(w)) != (d > 0)) r = w3d_offset_wire(w, -d);
  return r;
}

// The solid swept from the outline `w` along unit `n`: from `back` behind it to `d` ahead. At height
// h the outline is grown by `grow + slope * |h|` (shrunk when negative); a slope of -tan(angle) leans
// the sides in by `angle` going away from the outline's plane.
inline TopoDS_Shape w3d_stack(const TopoDS_Wire &w, const gp_Vec &n, double d, double back, double grow,
                              double slope) {
  double sign = d < 0 ? -1 : 1;
  if (std::fabs(slope) < 1e-12) {
    TopoDS_Face f = BRepBuilderAPI_MakeFace(w3d_moved(w3d_grown(w, grow), n * (-sign * back)), Standard_True).Face();
    BRepPrimAPI_MakePrism mk(f, n * (d + sign * back), Standard_True);
    if (!mk.IsDone()) throw std::runtime_error("the profile could not be extruded");
    return mk.Shape();
  }
  BRepOffsetAPI_ThruSections mk(Standard_True, Standard_True);
  std::vector<double> at;
  if (back > 1e-12) at.push_back(-sign * back);
  at.push_back(0);
  at.push_back(d);
  for (double h : at) mk.AddWire(w3d_moved(w3d_grown(w, grow + std::fabs(h) * slope), n * h));
  mk.Build();
  if (!mk.IsDone()) throw std::runtime_error("the sides cannot lean that far");
  return mk.Shape();
}

inline TopoDS_Shape w3d_cut(const TopoDS_Shape &a, const TopoDS_Shape &b, const char *why) {
  BRepAlgoAPI_Cut cut(a, b);
  if (!cut.IsDone()) throw std::runtime_error(why);
  return cut.Shape();
}

// The region of the planar face `base` swept as w3d_stack says, its outline grown by `grow` and its
// holes shrunk by as much: the outline leans in by `angle` and every hole leans out to match, so all
// side walls keep the same draft.
inline TopoDS_Shape w3d_region_stack(const TopoDS_Face &base, const gp_Vec &n, double d, double back, double angle,
                                     double grow) {
  double k = std::tan(angle);
  TopoDS_Wire outer = BRepTools::OuterWire(base);
  TopoDS_Shape solid = w3d_stack(outer, n, d, back, grow, -k);
  for (TopExp_Explorer ex(base, TopAbs_WIRE); ex.More(); ex.Next()) {
    TopoDS_Wire hole = TopoDS::Wire(ex.Current());
    if (hole.IsSame(outer)) continue;
    solid = w3d_cut(solid, w3d_stack(hole, n, d, back, -grow, k), "a hole closes up at that angle");
  }
  return solid;
}

inline TopoDS_Shape w3d_extrude_base(const TopoDS_Face &base, const gp_Vec &n, double d, double back, double angle,
                                     double thickness) {
  if (std::fabs(d) < 1e-12 && back < 1e-12) throw std::runtime_error("the extrude has no length");
  if (back < 0 || thickness < 0) throw std::runtime_error("distances on the far side and thicknesses are positive");
  if (std::fabs(angle) >= M_PI / 2 - 1e-6) throw std::runtime_error("the angle must be less than 90 degrees");
  bool plain = std::fabs(angle) < 1e-12 && thickness < 1e-12;
  if (plain) {
    double sign = d < 0 ? -1 : 1;
    gp_Trsf t;
    t.SetTranslation(n * (-sign * back));
    TopoDS_Face f = TopoDS::Face(BRepBuilderAPI_Transform(base, t, Standard_True).Shape());
    BRepPrimAPI_MakePrism mk(f, n * (d + sign * back), Standard_True);
    if (!mk.IsDone()) throw std::runtime_error("the profile could not be extruded");
    return mk.Shape();
  }
  TopoDS_Shape solid = w3d_region_stack(base, n, d, back, angle, 0);
  if (thickness < 1e-12) return solid;
  return w3d_cut(solid, w3d_region_stack(base, n, d, back, angle, -thickness), "the walls could not be made that thick");
}

// A profile (see w3d_section) extruded along unit `dir`.
inline std::unique_ptr<TopoDS_Shape> w3d_extrude(rust::Slice<const double> section, rust::Slice<const double> dir,
                                                 double distance, double back, double angle, double thickness) {
  try {
    if (dir.size() != 3) throw std::runtime_error("a direction is three numbers");
    TopoDS_Wire w = w3d_one_section(section);
    if (!w.Closed()) throw std::runtime_error("only a closed curve has a region to extrude");
    TopoDS_Face base = BRepBuilderAPI_MakeFace(w, Standard_True).Face();
    gp_Vec n(dir[0], dir[1], dir[2]);
    if (n.Magnitude() < 1e-12) throw std::runtime_error("the extrude has no direction");
    TopoDS_Shape r = w3d_extrude_base(base, n.Normalized(), distance, back, angle, thickness);
    return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(r));
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// The numbered face of `shape` extruded along `dir` (its outward normal, from the caller).
inline std::unique_ptr<TopoDS_Shape> w3d_extrude_face(const TopoDS_Shape &shape, int32_t face,
                                                      rust::Slice<const double> dir, double distance, double back,
                                                      double angle, double thickness) {
  TopTools_IndexedMapOfShape map;
  TopExp::MapShapes(shape, TopAbs_FACE, map);
  if (face < 0 || face >= map.Extent()) throw std::out_of_range("no such face");
  try {
    if (dir.size() != 3) throw std::runtime_error("a direction is three numbers");
    gp_Vec n(dir[0], dir[1], dir[2]);
    if (n.Magnitude() < 1e-12) throw std::runtime_error("that face has no direction to extrude in");
    TopoDS_Face base = TopoDS::Face(map(face + 1));
    base.Orientation(TopAbs_FORWARD);
    TopoDS_Shape r = w3d_extrude_base(base, n.Normalized(), distance, back, angle, thickness);
    return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(r));
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// `n + 1` points evenly spaced in parameter along a section or path (see w3d_section), for drawing
// curves the viewport can't compute itself, like splines.
inline rust::Vec<double> w3d_sample(rust::Slice<const double> section, int32_t n) {
  try {
    if (n < 1) throw std::runtime_error("sample at least one step");
    BRepAdaptor_CompCurve c(w3d_one_section(section));
    rust::Vec<double> out;
    double t0 = c.FirstParameter(), t1 = c.LastParameter();
    for (int i = 0; i <= n; i++) {
      gp_Pnt p = c.Value(t0 + (t1 - t0) * i / n);
      out.push_back(p.X());
      out.push_back(p.Y());
      out.push_back(p.Z());
    }
    return out;
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// --- Shell and Mirror (Round 6) ------------------------------------------------------------------

// Plasticity's Shell (Thin Solid): hollow the solid to walls `thickness` thick inside its outer
// surface, opening the numbered faces. The outer faces keep their numbers' history; the inner
// walls are new.
inline std::unique_ptr<W3dResult> w3d_shell(const TopoDS_Shape &shape, rust::Slice<const int32_t> faces,
                                            double thickness) {
  TopTools_IndexedMapOfShape map;
  TopExp::MapShapes(shape, TopAbs_FACE, map);
  if (faces.empty()) throw std::runtime_error("select the faces to open");
  if (!(thickness > 0.0) || !std::isfinite(thickness)) throw std::runtime_error("the wall thickness must be greater than zero");
  TopTools_ListOfShape closing;
  for (int32_t f : faces) {
    if (f < 0 || f >= map.Extent()) throw std::out_of_range("no such face");
    closing.Append(map(f + 1));
  }
  try {
    BRepOffsetAPI_MakeThickSolid mk;
    mk.MakeThickSolidByJoin(shape, closing, -thickness, 1e-6, BRepOffset_Skin, Standard_False, Standard_False,
                            GeomAbs_Intersection, Standard_False);
    if (!mk.IsDone() || mk.Shape().IsNull())
      throw std::runtime_error("the walls can't be that thick here; try a thinner shell");
    std::unique_ptr<W3dResult> r(new W3dResult());
    r->shape = mk.Shape();
    if (!w3d_is_valid(r->shape)) throw std::runtime_error("a shell that thick breaks the body; try a thinner one");
    w3d_record(*r, 0, shape, {w3d_step(mk)});
    return r;
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// The shape reflected in the plane through plane[0..3] with normal plane[3..6], as a new copy.
inline std::unique_ptr<TopoDS_Shape> w3d_mirror(const TopoDS_Shape &shape, rust::Slice<const double> plane) {
  if (plane.size() != 6) throw std::runtime_error("a mirror plane is a point and a normal");
  for (double v : plane) if (!std::isfinite(v)) throw std::runtime_error("the mirror plane is not a number");
  gp_Vec n(plane[3], plane[4], plane[5]);
  if (n.Magnitude() < 1e-12) throw std::runtime_error("the mirror plane has no direction");
  try {
    gp_Trsf t;
    t.SetMirror(gp_Ax2(gp_Pnt(plane[0], plane[1], plane[2]), gp_Dir(n)));
    BRepBuilderAPI_Transform mk(shape, t, Standard_True);
    if (!mk.IsDone()) throw std::runtime_error("the body could not be mirrored");
    return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(mk.Shape()));
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// Plasticity's Remove Face: delete the numbered faces and let the faces around them grow to close
// the gap (a fillet, hole or boss gone). The faces that remain keep their history.
inline std::unique_ptr<W3dResult> w3d_remove_faces(const TopoDS_Shape &shape, rust::Slice<const int32_t> faces) {
  TopTools_IndexedMapOfShape map;
  TopExp::MapShapes(shape, TopAbs_FACE, map);
  if (faces.empty()) throw std::runtime_error("select the faces to remove");
  try {
    BRepAlgoAPI_Defeaturing df;
    df.SetShape(shape);
    for (int32_t f : faces) {
      if (f < 0 || f >= map.Extent()) throw std::out_of_range("no such face");
      df.AddFaceToRemove(map(f + 1));
    }
    df.SetToFillHistory(Standard_True);
    df.Build();
    if (!df.IsDone() || df.HasErrors() || df.Shape().IsNull())
      throw std::runtime_error("the faces around those can't grow to close the gap; remove a whole feature at once");
    std::unique_ptr<W3dResult> r(new W3dResult());
    r->shape = df.Shape();
    if (!w3d_is_valid(r->shape)) throw std::runtime_error("removing those faces breaks the body");
    w3d_record(*r, 0, shape, {w3d_step(df)});
    return r;
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// The solids in a shape, counted and fetched by number (TopExp::MapShapes order).
inline int32_t w3d_solid_count(const TopoDS_Shape &shape) {
  TopTools_IndexedMapOfShape map;
  TopExp::MapShapes(shape, TopAbs_SOLID, map);
  return map.Extent();
}
inline std::unique_ptr<TopoDS_Shape> w3d_solid_at(const TopoDS_Shape &shape, int32_t index) {
  TopTools_IndexedMapOfShape map;
  TopExp::MapShapes(shape, TopAbs_SOLID, map);
  if (index < 0 || index >= map.Extent()) throw std::out_of_range("no such solid");
  return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(map(index + 1)));
}
inline std::unique_ptr<TopoDS_Shape> w3d_result_others(const W3dResult &r) {
  return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(r.others));
}

// Plasticity's Cut with curves. `data` is [m, then per cutter: nx, ny, nz, section...]: each
// section's wire (see w3d_section) swept `length` both ways along its normal into a sheet, and the
// shape split by the sheets. `shape` of the result is the biggest piece, with history; `others`
// holds the rest.
// The cutting sheets of `data` (see w3d_cut): each section's wire swept `length` both ways along its normal.
inline TopTools_ListOfShape w3d_cut_sheets(rust::Slice<const double> data, double length) {
  const double *p = data.data(), *end = p + data.size();
  if (p >= end) throw std::runtime_error("select the curves to cut with");
  int m = int(*p++);
  if (m < 0) throw std::runtime_error("select the curves to cut with");
  TopTools_ListOfShape sheets;
  for (int i = 0; i < m; i++) {
    if (p + 3 > end) throw std::runtime_error("a cutter is cut short");
    gp_Vec n(p[0], p[1], p[2]);
    p += 3;
    if (n.Magnitude() < 1e-12) throw std::runtime_error("a cutting curve's plane has no direction");
    n.Normalize();
    TopoDS_Wire w = w3d_section(p, end);
    gp_Trsf back;
    back.SetTranslation(n * -length);
    TopoDS_Shape start = BRepBuilderAPI_Transform(w, back, Standard_True).Shape();
    sheets.Append(BRepPrimAPI_MakePrism(start, n * (2 * length)).Shape());
  }
  return sheets;
}

// The shapes inside `extra` (a compound of further tools: sheets from faces or planes, or solids).
inline void w3d_append_children(TopTools_ListOfShape &list, const TopoDS_Shape &extra) {
  if (extra.IsNull()) return;
  for (TopoDS_Iterator it(extra); it.More(); it.Next()) list.Append(it.Value());
}

// A face of `shape` as a cutting tool, grown past the body: a plane becomes a square `size` each way,
// a cylinder its whole round `size` each way along the axis; other faces stay as they are.
inline std::unique_ptr<TopoDS_Shape> w3d_face_sheet(const TopoDS_Shape &shape, int32_t index, double size) {
  TopTools_IndexedMapOfShape map;
  TopExp::MapShapes(shape, TopAbs_FACE, map);
  if (index < 0 || index >= map.Extent()) throw std::out_of_range("no such face");
  TopoDS_Face face = TopoDS::Face(map(index + 1));
  try {
    BRepAdaptor_Surface surf(face);
    TopoDS_Shape out;
    if (surf.GetType() == GeomAbs_Plane) out = BRepBuilderAPI_MakeFace(surf.Plane(), -size, size, -size, size).Face();
    else if (surf.GetType() == GeomAbs_Cylinder) out = BRepBuilderAPI_MakeFace(surf.Cylinder(), 0.0, 2 * M_PI, -size, size).Face();
    else out = face;
    return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(out));
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// The plane through (plane[0..3]) with normal (plane[3..6]) as a square sheet `size` each way.
inline std::unique_ptr<TopoDS_Shape> w3d_plane_sheet(rust::Slice<const double> plane, double size) {
  if (plane.size() != 6) throw std::runtime_error("a plane is a point and a normal");
  gp_Vec n(plane[3], plane[4], plane[5]);
  if (n.Magnitude() < 1e-12) throw std::runtime_error("the plane has no direction");
  try {
    gp_Pln pln(gp_Pnt(plane[0], plane[1], plane[2]), gp_Dir(n));
    return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(BRepBuilderAPI_MakeFace(pln, -size, size, -size, size).Face()));
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

inline std::unique_ptr<W3dResult> w3d_cut(const TopoDS_Shape &shape, rust::Slice<const double> data, double length, const TopoDS_Shape &extra) {
  TopTools_ListOfShape args, tools = w3d_cut_sheets(data, length);
  w3d_append_children(tools, extra);
  if (tools.IsEmpty()) throw std::runtime_error("select curves, faces or a plane to cut with");
  args.Append(shape);
  try {
    BRepAlgoAPI_Splitter mk;
    mk.SetArguments(args);
    mk.SetTools(tools);
    mk.Build();
    if (!mk.IsDone() || mk.HasErrors()) throw std::runtime_error("the body could not be cut there");
    std::vector<TopoDS_Shape> pieces;
    for (TopExp_Explorer ex(mk.Shape(), TopAbs_SOLID); ex.More(); ex.Next()) pieces.push_back(ex.Current());
    if (pieces.size() < 2) throw std::runtime_error("the curve does not cut the body; draw it across the solid");
    auto vol = [](const TopoDS_Shape &s) { GProp_GProps g; BRepGProp::VolumeProperties(s, g); return g.Mass(); };
    std::sort(pieces.begin(), pieces.end(), [&](const TopoDS_Shape &a, const TopoDS_Shape &b) { return vol(a) > vol(b); });
    std::unique_ptr<W3dResult> r(new W3dResult());
    r->shape = pieces[0];
    TopoDS_Compound rest;
    BRep_Builder bb;
    bb.MakeCompound(rest);
    for (size_t i = 1; i < pieces.size(); i++) bb.Add(rest, pieces[i]);
    r->others = rest;
    w3d_record(*r, 0, shape, {w3d_step(mk)});
    return r;
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// Plasticity's Imprint: the curves of `data` (see w3d_cut) projected along their normals onto the
// numbered faces (all of them when `faces` is empty) and the faces split there. The solid stays whole.
inline std::unique_ptr<W3dResult> w3d_imprint(const TopoDS_Shape &shape, rust::Slice<const int32_t> faces,
                                              rust::Slice<const double> data, double length, const TopoDS_Shape &extra) {
  TopTools_ListOfShape sheets = w3d_cut_sheets(data, length);
  w3d_append_children(sheets, extra);
  if (sheets.IsEmpty()) throw std::runtime_error("select curves or a body to imprint");
  TopTools_IndexedMapOfShape map;
  TopExp::MapShapes(shape, TopAbs_FACE, map);
  std::vector<TopoDS_Shape> targets;
  if (faces.empty()) for (int i = 1; i <= map.Extent(); i++) targets.push_back(map(i));
  for (int32_t f : faces) {
    if (f < 0 || f >= map.Extent()) throw std::out_of_range("no such face");
    targets.push_back(map(f + 1));
  }
  try {
    TopTools_ListOfShape args, tools;
    args.Append(shape);
    for (const auto &face : targets)
      for (TopTools_ListOfShape::Iterator it(sheets); it.More(); it.Next()) {
        BRepAlgoAPI_Section sec(face, it.Value(), Standard_False);
        sec.ComputePCurveOn1(Standard_True);
        sec.Approximation(Standard_True);
        sec.Build();
        if (!sec.IsDone()) continue;
        for (TopExp_Explorer ex(sec.Shape(), TopAbs_EDGE); ex.More(); ex.Next()) tools.Append(ex.Current());
      }
    if (tools.IsEmpty()) throw std::runtime_error("the curves do not cross those faces");
    BRepAlgoAPI_Splitter mk;
    mk.SetArguments(args);
    mk.SetTools(tools);
    mk.Build();
    if (!mk.IsDone() || mk.HasErrors()) throw std::runtime_error("the curves could not be imprinted there");
    TopExp_Explorer solid(mk.Shape(), TopAbs_SOLID);
    if (!solid.More()) throw std::runtime_error("the curves could not be imprinted there");
    std::unique_ptr<W3dResult> r(new W3dResult());
    r->shape = solid.Current();
    TopTools_IndexedMapOfShape after;
    TopExp::MapShapes(r->shape, TopAbs_FACE, after);
    if (after.Extent() <= map.Extent()) throw std::runtime_error("the curves do not divide those faces; draw them across a face or as closed loops");
    w3d_record(*r, 0, shape, {w3d_step(mk)});
    return r;
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// Plasticity's Draft Face: the numbered faces tilted by `angle` radians about the neutral plane
// through (frame[3..6]) square to the pull direction (frame[0..3]). Positive angles close the
// faces in along the pull, as a part leaving its mould needs. Flat, cylindrical and conical faces.
inline std::unique_ptr<W3dResult> w3d_draft_faces(const TopoDS_Shape &shape, rust::Slice<const int32_t> faces,
                                                  rust::Slice<const double> frame, double angle) {
  if (faces.empty()) throw std::runtime_error("select the faces to draft");
  if (frame.size() != 6) throw std::runtime_error("a draft needs a pull direction and a point on the neutral plane");
  if (!(std::fabs(angle) > 1e-9) || !std::isfinite(angle)) throw std::runtime_error("the draft angle must not be zero");
  if (std::fabs(angle) >= M_PI / 2) throw std::runtime_error("a draft is less than 90 degrees");
  gp_Vec n(frame[0], frame[1], frame[2]);
  if (n.Magnitude() < 1e-12) throw std::runtime_error("the pull direction has no length");
  TopTools_IndexedMapOfShape map;
  TopExp::MapShapes(shape, TopAbs_FACE, map);
  try {
    gp_Dir pull(n);
    gp_Pln neutral(gp_Pnt(frame[3], frame[4], frame[5]), pull);
    std::shared_ptr<BRepOffsetAPI_DraftAngle> draft(new BRepOffsetAPI_DraftAngle(shape));
    for (int32_t f : faces) {
      if (f < 0 || f >= map.Extent()) throw std::out_of_range("no such face");
      draft->Add(TopoDS::Face(map(f + 1)), pull, angle, neutral);
      if (!draft->AddDone()) throw std::runtime_error("that face cannot be drafted; faces square to the pull, or free-form ones, cannot");
    }
    draft->Build();
    if (!draft->IsDone()) throw std::runtime_error("the faces cannot be drafted that far; try a smaller angle");
    std::unique_ptr<W3dResult> r(new W3dResult());
    r->shape = draft->Shape();
    if (!w3d_is_valid(r->shape)) throw std::runtime_error("drafting that far breaks the body; try a smaller angle");
    w3d_record(*r, 0, shape, {[draft](const TopoDS_Shape &s, TopTools_ListOfShape &out) {
      // DraftAngle reports nothing as Modified; ModifiedShape gives each image.
      try { out.Append(draft->ModifiedShape(s)); } catch (const Standard_Failure &) { out.Append(s); }
    }});
    return r;
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// --- Project (Plasticity's Project Curve Body, Body Body and Curve Curve) -------------------------

// The sheets of `data` (see w3d_cut) swept along each cutter's direction: `length` forwards, and as
// far backwards too when `both`. Each sheet is paired with the wire it was swept from.
inline std::vector<std::pair<TopoDS_Wire, TopoDS_Shape>> w3d_curtains(rust::Slice<const double> data, double length, bool both,
                                                                     std::vector<gp_Vec> &dirs) {
  const double *p = data.data(), *end = p + data.size();
  if (p >= end) throw std::runtime_error("select the curves to project");
  int m = int(*p++);
  std::vector<std::pair<TopoDS_Wire, TopoDS_Shape>> out;
  for (int i = 0; i < m; i++) {
    if (p + 3 > end) throw std::runtime_error("a curve is cut short");
    gp_Vec n(p[0], p[1], p[2]);
    p += 3;
    if (n.Magnitude() < 1e-12) throw std::runtime_error("the projection has no direction");
    n.Normalize();
    TopoDS_Wire w = w3d_section(p, end);
    TopoDS_Shape start = w;
    if (both) {
      gp_Trsf back;
      back.SetTranslation(n * -length);
      start = BRepBuilderAPI_Transform(w, back, Standard_True).Shape();
    }
    out.push_back({w, BRepPrimAPI_MakePrism(start, n * (both ? 2 * length : length)).Shape()});
    dirs.push_back(n);
  }
  return out;
}

// Every edge where `a` and `b` meet, as approximated 3D curves.
inline void w3d_meet(const TopoDS_Shape &a, const TopoDS_Shape &b, std::vector<TopoDS_Edge> &edges) {
  BRepAlgoAPI_Section sec(a, b, Standard_False);
  sec.Approximation(Standard_True);
  sec.Build();
  if (!sec.IsDone()) return;
  for (TopExp_Explorer ex(sec.Shape(), TopAbs_EDGE); ex.More(); ex.Next()) edges.push_back(TopoDS::Edge(ex.Current()));
}

// Whether a face of `skin` (loaded into `hits`) crosses the way between `from` and `to`, ends
// excluded. Faces met edge-on, along the way, hide nothing.
inline bool w3d_blocked(IntCurvesFace_ShapeIntersector &hits, const gp_Pnt &from, const gp_Pnt &to) {
  gp_Vec d(from, to);
  double len = d.Magnitude();
  double skip = std::max(1e-4, 1e-7 * len);
  if (len < 3 * skip) return false;
  hits.Perform(gp_Lin(from, gp_Dir(d)), skip, len - skip);
  if (!hits.IsDone()) return false;
  for (int i = 1; i <= hits.NbPnt(); i++)
    if (hits.Transition(i) != IntCurveSurface_Tangent) return true;
  return false;
}

// Where along `dir` the point `p` was projected from on `wire`: the wire's point on the line through
// `p` along `dir`, if the line meets it.
inline bool w3d_source(const TopoDS_Wire &wire, const gp_Pnt &p, const gp_Vec &dir, double length, gp_Pnt &q) {
  TopoDS_Edge line = BRepBuilderAPI_MakeEdge(p.Translated(dir * -2 * length), p.Translated(dir * 2 * length)).Edge();
  BRepExtrema_DistShapeShape dist(line, wire);
  if (!dist.IsDone() || dist.NbSolution() == 0 || dist.Value() > 1e-4) return false;
  q = dist.PointOnShape2(1);
  return true;
}

// The edges joined end to end into chains, each chain as one NURBS curve in the numbers w3d_section
// reads (kind 9), after a count: [count, 9, degree, n, k, ...].
inline rust::Vec<double> w3d_curves_out(const std::vector<TopoDS_Edge> &edges) {
  rust::Vec<double> out;
  out.push_back(0);
  if (edges.empty()) return out;
  Handle(TopTools_HSequenceOfShape) in = new TopTools_HSequenceOfShape(), wires;
  for (const auto &e : edges) in->Append(e);
  ShapeAnalysis_FreeBounds::ConnectEdgesToWires(in, 1e-5, Standard_False, wires);
  for (int i = 1; i <= wires->Length(); i++) {
    GeomConvert_CompCurveToBSplineCurve join;
    bool any = false;
    for (BRepTools_WireExplorer ex(TopoDS::Wire(wires->Value(i))); ex.More(); ex.Next()) {
      double t0, t1;
      Handle(Geom_Curve) c = BRep_Tool::Curve(ex.Current(), t0, t1);
      if (c.IsNull() || t1 - t0 < 1e-12) continue;
      Handle(Geom_BSplineCurve) b = GeomConvert::CurveToBSplineCurve(new Geom_TrimmedCurve(c, t0, t1));
      if (ex.Current().Orientation() == TopAbs_REVERSED) b->Reverse();
      if (!join.Add(b, 1e-5)) throw std::runtime_error("the projected pieces do not meet end to end");
      any = true;
    }
    if (!any) continue;
    Handle(Geom_BSplineCurve) b = join.BSplineCurve();
    if (b->IsPeriodic()) b->SetNotPeriodic();
    int n = b->NbPoles(), deg = b->Degree();
    TColStd_Array1OfReal flat(1, n + deg + 1);
    b->KnotSequence(flat);
    out.push_back(9);
    out.push_back(deg);
    out.push_back(n);
    out.push_back(flat.Length());
    for (int j = 1; j <= n; j++) { gp_Pnt q = b->Pole(j); out.push_back(q.X()); out.push_back(q.Y()); out.push_back(q.Z()); }
    for (int j = 1; j <= n; j++) out.push_back(b->Weight(j));
    for (int j = flat.Lower(); j <= flat.Upper(); j++) out.push_back(flat(j));
    out[0] += 1;
  }
  return out;
}

// Plasticity's Project Curve Body: the curves of `data` (see w3d_cut, each with its direction)
// projected onto the numbered faces of `shape` (all when `faces` is empty). Forwards along the
// direction only, unless `both`; with `hide`, only what is seen looking along the direction from the
// curve, faces behind others left out. The result as w3d_curves_out writes it.
inline rust::Vec<double> w3d_project(const TopoDS_Shape &shape, rust::Slice<const int32_t> faces, rust::Slice<const double> data,
                                     double length, bool both, bool hide) {
  try {
    TopTools_IndexedMapOfShape map;
    TopExp::MapShapes(shape, TopAbs_FACE, map);
    TopoDS_Compound targets;
    BRep_Builder bb;
    bb.MakeCompound(targets);
    if (faces.empty()) for (int i = 1; i <= map.Extent(); i++) bb.Add(targets, map(i));
    for (int32_t f : faces) {
      if (f < 0 || f >= map.Extent()) throw std::out_of_range("no such face");
      bb.Add(targets, map(f + 1));
    }
    std::vector<gp_Vec> dirs;
    auto curtains = w3d_curtains(data, length, both, dirs);
    std::vector<TopoDS_Edge> kept;
    const double tol = 1e-5;
    // What can hide a curve: the body's faces, not its inside, so curves drawn within it see out.
    TopoDS_Compound skin;
    bb.MakeCompound(skin);
    for (int i = 1; i <= map.Extent(); i++) bb.Add(skin, map(i));
    IntCurvesFace_ShapeIntersector hits;
    if (hide) hits.Load(skin, tol);
    for (size_t c = 0; c < curtains.size(); c++) {
      std::vector<TopoDS_Edge> edges;
      w3d_meet(targets, curtains[c].second, edges);
      if (!hide) { kept.insert(kept.end(), edges.begin(), edges.end()); continue; }
      const gp_Vec &dir = dirs[c];
      // Seen when nothing of the body lies between the point and the curve it came from.
      auto seen = [&](const Handle(Geom_Curve) &g, double t) {
        gp_Pnt p = g->Value(t), q;
        if (!w3d_source(curtains[c].first, p, dir, length, q)) return true;
        return !w3d_blocked(hits, q, p);
      };
      for (const auto &e : edges) {
        double t0, t1;
        Handle(Geom_Curve) g = BRep_Tool::Curve(e, t0, t1);
        if (g.IsNull()) continue;
        const int N = 16;
        std::vector<bool> vis(N + 1);
        for (int i = 0; i <= N; i++) vis[i] = seen(g, t0 + (t1 - t0) * i / N);
        // Each run of seen samples is kept, its ends found by bisection where the view changes.
        auto edge = [&](double a, double b, bool ia) {
          double lo = a, hi = b;
          for (int k = 0; k < 30; k++) { double mid = (lo + hi) / 2; (seen(g, mid) == ia ? lo : hi) = mid; }
          return (lo + hi) / 2;
        };
        int i = 0;
        while (i <= N) {
          if (!vis[i]) { i++; continue; }
          int j = i;
          while (j < N && vis[j + 1]) j++;
          double a = i == 0 ? t0 : edge(t0 + (t1 - t0) * (i - 1) / N, t0 + (t1 - t0) * i / N, false);
          double b = j == N ? t1 : edge(t0 + (t1 - t0) * j / N, t0 + (t1 - t0) * (j + 1) / N, true);
          // Shorter than a micron is a leftover where an edge-on face meets the way, not a curve.
          if (g->Value(a).Distance(g->Value((a + b) / 2)) + g->Value((a + b) / 2).Distance(g->Value(b)) > 1e-3)
            kept.push_back(BRepBuilderAPI_MakeEdge(g, a, b).Edge());
          i = j + 1;
        }
      }
    }
    if (kept.empty()) throw std::runtime_error(hide ? "the curves miss what can be seen of the body along that direction" : "the curves miss the body along that direction");
    return w3d_curves_out(kept);
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// Plasticity's Project Body Body: the curves where the two shapes meet.
inline rust::Vec<double> w3d_meet_curves(const TopoDS_Shape &a, const TopoDS_Shape &b) {
  try {
    std::vector<TopoDS_Edge> edges;
    w3d_meet(a, b, edges);
    if (edges.empty()) throw std::runtime_error("the two bodies do not meet");
    return w3d_curves_out(edges);
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// Plasticity's Project Curve Curve: each of the two curves of `data` swept both ways along its own
// direction, and the curves where the two sheets meet.
inline rust::Vec<double> w3d_project_curve_curve(rust::Slice<const double> data, double length) {
  try {
    std::vector<gp_Vec> dirs;
    auto curtains = w3d_curtains(data, length, true, dirs);
    if (curtains.size() != 2) throw std::runtime_error("select two curves");
    std::vector<TopoDS_Edge> edges;
    w3d_meet(curtains[0].second, curtains[1].second, edges);
    if (edges.empty()) throw std::runtime_error("the two curves' sheets do not meet; check that their directions cross");
    return w3d_curves_out(edges);
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}


// Plasticity's Patch: a sheet filling one closed loop of drawn curves (`data`, as w3d_curtains
// reads them, their directions unused) and edges of `shape`. Where `tangent[i]` is set, the sheet
// leaves edge `edges[i]` tangent to the body's face along it. A flat loop with no tangency gives
// the exact plane; anything else is filled with an energy-minimising plate (GeomPlate), within
// `tol` of the boundary. Returns the face, or says why the loop does not close.
inline std::unique_ptr<TopoDS_Shape> w3d_patch(rust::Slice<const double> data, const TopoDS_Shape &shape,
                                              rust::Slice<const int32_t> edges, rust::Slice<const int32_t> tangent,
                                              double tol) {
  if (edges.size() != tangent.size()) throw std::runtime_error("each edge needs its continuity");
  try {
    std::vector<std::pair<TopoDS_Edge, TopoDS_Face>> bounds;
    const double *p = data.data(), *end = p + data.size();
    int m = p < end ? int(*p++) : 0;
    for (int i = 0; i < m; i++) {
      if (p + 3 > end) throw std::runtime_error("a curve is cut short");
      p += 3;
      TopoDS_Wire w = w3d_section(p, end);
      for (TopExp_Explorer ex(w, TopAbs_EDGE); ex.More(); ex.Next()) bounds.push_back({TopoDS::Edge(ex.Current()), TopoDS_Face()});
    }
    TopTools_IndexedMapOfShape map;
    TopExp::MapShapes(shape, TopAbs_EDGE, map);
    TopTools_IndexedDataMapOfShapeListOfShape faces;
    TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, faces);
    for (size_t i = 0; i < edges.size(); i++) {
      if (edges[i] < 0 || edges[i] >= map.Extent()) throw std::out_of_range("that edge no longer exists");
      TopoDS_Edge e = TopoDS::Edge(map(edges[i] + 1));
      TopoDS_Face f;
      if (tangent[i]) {
        const TopTools_ListOfShape &around = faces.FindFromKey(e);
        if (around.IsEmpty()) throw std::runtime_error("a tangent edge needs a face beside it");
        f = TopoDS::Face(around.First());
      }
      bounds.push_back({e, f});
    }
    if (bounds.empty()) throw std::runtime_error("select a closed loop of curves or edges to patch");

    // One closed loop, or say what is wrong with it.
    Handle(TopTools_HSequenceOfShape) loose = new TopTools_HSequenceOfShape, wires;
    for (auto &b : bounds) loose->Append(b.first);
    ShapeAnalysis_FreeBounds::ConnectEdgesToWires(loose, tol, Standard_False, wires);
    if (wires->Length() != 1) throw std::runtime_error("the curves and edges must join end to end into one loop");
    TopoDS_Wire loop = TopoDS::Wire(wires->Value(1));
    if (!BRep_Tool::IsClosed(loop)) {
      TopoDS_Vertex a, b;
      TopExp::Vertices(loop, a, b);
      if (a.IsNull() || b.IsNull() || BRep_Tool::Pnt(a).Distance(BRep_Tool::Pnt(b)) > tol)
        throw std::runtime_error("the loop is open; its ends must meet");
    }

    bool smooth = false;
    for (auto &b : bounds) smooth = smooth || !b.second.IsNull();
    if (!smooth) {
      BRepLib_FindSurface flat(loop, tol, Standard_True);
      if (flat.Found()) {
        BRepBuilderAPI_MakeFace mk(loop, Standard_True);
        if (mk.IsDone()) return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(mk.Face()));
      }
    }
    BRepOffsetAPI_MakeFilling fill(3, 15, 2, Standard_False, 1e-5, tol, 0.01, 0.1, 8, 9);
    for (auto &b : bounds) {
      if (b.second.IsNull()) fill.Add(b.first, GeomAbs_C0, Standard_True);
      else fill.Add(b.first, b.second, GeomAbs_G1, Standard_True);
    }
    fill.Build();
    if (!fill.IsDone()) throw std::runtime_error("no surface could be filled inside that loop");
    if (fill.G0Error() > 10 * tol) {
      std::ostringstream why;
      why << "the patch misses its boundary by " << fill.G0Error() << " mm";
      throw std::runtime_error(why.str());
    }
    // A plate is a height field over its first guess, so it cannot turn as steeply as a wall
    // standing square to the loop; say so rather than hand back a flat lid.
    double off = fill.G1Error() * 180.0 / M_PI;
    if (smooth && off > 0.5) {
      std::ostringstream why;
      why.precision(2);
      why << std::fixed << "the patch meets the faces up to " << off << " degrees off tangent; try plain (G0) edges where the walls stand square to the loop";
      throw std::runtime_error(why.str());
    }
    return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(fill.Shape()));
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}


// One side of a Bridge Surface: points along an edge and, at each, the way out of its face (in
// the face's tangent plane, square to the edge, away from the face).
struct W3dBridgeSide {
  std::vector<gp_Pnt> at;
  std::vector<gp_Vec> out;
  bool closed = false;
};

inline W3dBridgeSide w3d_bridge_side(const TopoDS_Shape &shape, int32_t index, int n, double shift, bool backwards) {
  TopTools_IndexedMapOfShape map;
  TopExp::MapShapes(shape, TopAbs_EDGE, map);
  if (index < 0 || index >= map.Extent()) throw std::out_of_range("that edge no longer exists");
  TopoDS_Edge edge = TopoDS::Edge(map(index + 1));
  TopTools_IndexedDataMapOfShapeListOfShape faces;
  TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, faces);
  const TopTools_ListOfShape &around = faces.FindFromKey(edge);
  if (around.IsEmpty()) throw std::runtime_error("bridge edges of sheets or solids; a loose edge has no face to leave");
  TopoDS_Face face = TopoDS::Face(around.First());
  // The edge as the face's wire runs it: the face lies on its left.
  TopoDS_Edge inFace = edge;
  for (TopExp_Explorer ex(face, TopAbs_EDGE); ex.More(); ex.Next())
    if (ex.Current().IsSame(edge)) { inFace = TopoDS::Edge(ex.Current()); break; }
  BRepAdaptor_Curve curve(inFace);
  double f, l;
  Handle(Geom2d_Curve) uv = BRep_Tool::CurveOnSurface(inFace, face, f, l);
  if (uv.IsNull()) throw std::runtime_error("that edge has no curve on its face");
  BRepGProp_Face props(face);
  W3dBridgeSide side;
  side.closed = BRep_Tool::IsClosed(edge) || curve.Value(curve.FirstParameter()).Distance(curve.Value(curve.LastParameter())) < 1e-7;
  double a = curve.FirstParameter(), b = curve.LastParameter();
  int count = side.closed ? n : n + 1;
  for (int i = 0; i < count; i++) {
    double s = (side.closed ? std::fmod(double(i) / n + shift + 1.0, 1.0) : double(i) / n);
    if (backwards) s = side.closed ? std::fmod(1.0 - s + 1.0, 1.0) : 1.0 - s;
    double t = a + (b - a) * s;
    gp_Pnt p;
    gp_Vec d;
    curve.D1(t, p, d);
    if (inFace.Orientation() == TopAbs_REVERSED) d.Reverse();
    gp_Pnt2d q = uv->Value(t);
    gp_Pnt on;
    gp_Vec normal;
    props.Normal(q.X(), q.Y(), on, normal);
    gp_Vec out = d.Crossed(normal);
    if (out.Magnitude() < 1e-12) throw std::runtime_error("the face is degenerate along that edge");
    side.at.push_back(p);
    side.out.push_back(out.Normalized());
  }
  return side;
}

// Plasticity's Bridge Surface: a sheet from edge `a` to edge `b` of `shape`, leaving each tangent
// to its face (G1). `tension` scales how far each side carries on before turning (1 is a smooth
// cubic). Open edges pair end to end the shorter way; closed ones start opposite each other.
inline std::unique_ptr<TopoDS_Shape> w3d_bridge_surface(const TopoDS_Shape &shape, int32_t a, int32_t b, double tension) {
  if (a == b) throw std::runtime_error("select two different edges");
  if (!(tension > 0)) throw std::runtime_error("the tension must be above zero");
  try {
    const int n = 48;
    W3dBridgeSide A = w3d_bridge_side(shape, a, n, 0.0, false);
    W3dBridgeSide B = w3d_bridge_side(shape, b, n, 0.0, false);
    if (A.closed != B.closed) throw std::runtime_error("bridge two open edges or two closed ones");
    bool backwards;
    double shift = 0.0;
    if (!A.closed) {
      backwards = A.at.front().Distance(B.at.front()) + A.at.back().Distance(B.at.back()) >
                  A.at.front().Distance(B.at.back()) + A.at.back().Distance(B.at.front());
    } else {
      // Start B where it is nearest A's start, then run it the way that keeps them together.
      W3dBridgeSide fine = w3d_bridge_side(shape, b, 720, 0.0, false);
      int best = 0;
      for (int i = 1; i < 720; i++)
        if (fine.at[i].Distance(A.at[0]) < fine.at[best].Distance(A.at[0])) best = i;
      shift = best / 720.0;
      W3dBridgeSide f1 = w3d_bridge_side(shape, b, n, shift, false), f2 = w3d_bridge_side(shape, b, n, 1.0 - shift, true);
      double d1 = 0, d2 = 0;
      for (int i = 0; i < n; i++) { d1 += A.at[i].Distance(f1.at[i]); d2 += A.at[i].Distance(f2.at[i]); }
      backwards = d2 < d1;
      shift = backwards ? 1.0 - shift : shift;
    }
    B = w3d_bridge_side(shape, b, n, shift, backwards);
    // Four rows of points: the edges and, between, each carried out along its face. A closed
    // pair repeats its first points at the end, and the seam is made smooth with matching tangents.
    int k = int(A.at.size()), m = A.closed ? k + 1 : k;
    std::vector<std::vector<gp_Pnt>> pts(4, std::vector<gp_Pnt>(k));
    for (int i = 0; i < k; i++) {
      double h = tension * A.at[i].Distance(B.at[i]) / 3.0;
      pts[0][i] = A.at[i];
      pts[1][i] = A.at[i].Translated(A.out[i] * h);
      pts[2][i] = B.at[i].Translated(B.out[i] * h);
      pts[3][i] = B.at[i];
    }
    Handle(TColStd_HArray1OfReal) params = new TColStd_HArray1OfReal(1, m);
    for (int i = 0; i < m; i++) params->SetValue(i + 1, double(i) / (m - 1));
    std::vector<Handle(Geom_BSplineCurve)> fits;
    for (auto &row : pts) {
      Handle(TColgp_HArray1OfPnt) r = new TColgp_HArray1OfPnt(1, m);
      for (int i = 0; i < m; i++) r->SetValue(i + 1, row[i % k]);
      GeomAPI_Interpolate fit(r, params, Standard_False, 1e-9);
      if (A.closed) {
        gp_Vec seam(row[k - 1], row[1]);
        seam *= (m - 1) / 2.0;
        fit.Load(seam, seam, Standard_False);
      }
      fit.Perform();
      if (!fit.IsDone()) throw std::runtime_error("the bridge could not be fitted between those edges");
      fits.push_back(fit.Curve());
    }
    const Handle(Geom_BSplineCurve) &c0 = fits[0];
    int np = c0->NbPoles();
    TColgp_Array2OfPnt poles(1, np, 1, 4);
    for (int j = 0; j < 4; j++) {
      if (fits[j]->NbPoles() != np) throw std::runtime_error("the bridge's rows do not match");
      for (int i = 1; i <= np; i++) poles.SetValue(i, j + 1, fits[j]->Pole(i));
    }
    TColStd_Array1OfReal vk(1, 2);
    vk.SetValue(1, 0.0);
    vk.SetValue(2, 1.0);
    TColStd_Array1OfInteger vm(1, 2);
    vm.SetValue(1, 4);
    vm.SetValue(2, 4);
    TColStd_Array1OfReal uk(1, c0->NbKnots());
    TColStd_Array1OfInteger um(1, c0->NbKnots());
    c0->Knots(uk);
    c0->Multiplicities(um);
    Handle(Geom_BSplineSurface) surf = new Geom_BSplineSurface(poles, uk, vk, um, vm, c0->Degree(), 3, Standard_False, Standard_False);
    BRepBuilderAPI_MakeFace mk(surf, 1e-6);
    if (!mk.IsDone()) throw std::runtime_error("the bridge could not be made into a face");
    return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(mk.Face()));
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}


// Plasticity's Project Outline: the outline of `shape` seen along the plane's normal, drawn on the
// plane (plane[0..3] a point, plane[3..6] its normal, plane[6..9] its x). Hidden-line removal gives
// every sharp edge and silhouette in the plane; they split a sheet covering them, the pieces the body
// casts its shadow on are kept and merged, and the merged region's boundary is the outline, holes
// through the body included. Returns the curves as w3d_curves_out does.
inline rust::Vec<double> w3d_project_outline(const TopoDS_Shape &shape, rust::Slice<const double> plane) {
  if (plane.size() != 9) throw std::runtime_error("a plane is a point, a normal and an x direction");
  try {
    gp_Ax2 frame(gp_Pnt(plane[0], plane[1], plane[2]), gp_Dir(plane[3], plane[4], plane[5]), gp_Dir(plane[6], plane[7], plane[8]));
    Handle(HLRBRep_Algo) hlr = new HLRBRep_Algo();
    hlr->Add(shape);
    hlr->Projector(HLRAlgo_Projector(frame));
    hlr->Update();
    hlr->Hide();
    HLRBRep_HLRToShape out(hlr);
    // HLR draws in the frame's own x, y; carry it back onto the plane in model space.
    gp_Trsf place;
    place.SetTransformation(gp_Ax3(frame), gp_Ax3());
    TopTools_ListOfShape tools;
    Bnd_Box box;
    for (const TopoDS_Shape &c : {out.VCompound(), out.OutLineVCompound(), out.HCompound(), out.OutLineHCompound(), out.Rg1LineVCompound()}) {
      if (c.IsNull()) continue;
      for (TopExp_Explorer ex(c, TopAbs_EDGE); ex.More(); ex.Next()) {
        TopoDS_Shape e = ex.Current();
        BRepLib::BuildCurves3d(TopoDS::Edge(e));
        TopoDS_Shape moved = BRepBuilderAPI_Transform(e, place, Standard_True).Shape();
        tools.Append(moved);
        BRepBndLib::Add(moved, box);
      }
    }
    if (tools.IsEmpty() || box.IsVoid()) throw std::runtime_error("the body has no outline seen along that plane's normal");
    // A sheet on the plane covering every line, split by them.
    double x0, y0, z0, x1, y1, z1;
    box.Get(x0, y0, z0, x1, y1, z1);
    double size = gp_Pnt(x0, y0, z0).Distance(gp_Pnt(x1, y1, z1)) + 10.0;
    gp_Pln pln(frame.Location(), frame.Direction());
    TopoDS_Face sheet = BRepBuilderAPI_MakeFace(pln, -size, size, -size, size).Face();
    BRepAlgoAPI_Splitter split;
    TopTools_ListOfShape args;
    args.Append(sheet);
    split.SetArguments(args);
    split.SetTools(tools);
    split.Build();
    if (!split.IsDone()) throw std::runtime_error("the outline could not be traced");
    // Keep the pieces in the body's shadow: a line through a point inside each, along the normal, meets the body.
    IntCurvesFace_ShapeIntersector hits;
    hits.Load(shape, 1e-7);
    gp_Dir n = frame.Direction();
    TopTools_ListOfShape shadow;
    for (TopExp_Explorer ex(split.Shape(), TopAbs_FACE); ex.More(); ex.Next()) {
      TopoDS_Face f = TopoDS::Face(ex.Current());
      BRepAdaptor_Surface s(f);
      double u0 = s.FirstUParameter(), u1 = s.LastUParameter(), v0 = s.FirstVParameter(), v1 = s.LastVParameter();
      Bnd_Box fb;
      BRepBndLib::Add(f, fb);
      // Find a point inside the piece: try a grid until the classifier says IN.
      double fx0, fy0, fz0, fx1, fy1, fz1;
      fb.Get(fx0, fy0, fz0, fx1, fy1, fz1);
      bool found = false;
      gp_Pnt inside;
      for (int k = 1; k < 24 && !found; k++) {
        for (int i = 1; i < 2 * k && !found; i++) for (int j = 1; j < 2 * k && !found; j++) {
          gp_Pnt p(fx0 + (fx1 - fx0) * i / (2.0 * k), fy0 + (fy1 - fy0) * j / (2.0 * k), fz0 + (fz1 - fz0) * i / (2.0 * k));
          // The box is flat along the normal only when the plane is axis-aligned; project onto the plane.
          gp_Vec off(frame.Location(), p);
          p.Translate(gp_Vec(n) * -off.Dot(gp_Vec(n)));
          double pu, pv;
          ElSLib::Parameters(pln, p, pu, pv);
          if (pu < u0 || pu > u1 || pv < v0 || pv > v1) continue;
          BRepClass_FaceClassifier cls(f, gp_Pnt2d(pu, pv), 1e-7);
          if (cls.State() == TopAbs_IN) { inside = p; found = true; }
        }
      }
      if (!found) continue;
      hits.Perform(gp_Lin(inside, n), -RealLast(), RealLast());
      if (hits.IsDone() && hits.NbPnt() > 0) shadow.Append(f);
    }
    if (shadow.IsEmpty()) throw std::runtime_error("the body casts no shadow on that plane");
    // Merge the shadow into as few faces as it makes; their wires are the outline.
    TopoDS_Compound all;
    BRep_Builder b;
    b.MakeCompound(all);
    for (const TopoDS_Shape &f : shadow) b.Add(all, f);
    BRepBuilderAPI_Sewing sew(1e-6);
    sew.Add(all);
    sew.Perform();
    ShapeUpgrade_UnifySameDomain unify(sew.SewedShape(), Standard_True, Standard_True, Standard_True);
    unify.Build();
    TopoDS_Shape merged = unify.Shape();
    // The outline is the edges bounding the shadow: those on one shadow face only.
    TopTools_IndexedDataMapOfShapeListOfShape owners;
    TopExp::MapShapesAndAncestors(merged, TopAbs_EDGE, TopAbs_FACE, owners);
    std::vector<TopoDS_Edge> rim;
    for (int i = 1; i <= owners.Extent(); i++)
      if (owners(i).Extent() == 1) rim.push_back(TopoDS::Edge(owners.FindKey(i)));
    if (rim.empty()) throw std::runtime_error("the outline could not be traced");
    return w3d_curves_out(rim);
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}
