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
#include <GCPnts_AbscissaPoint.hxx>
#include <GCPnts_TangentialDeflection.hxx>
#include <BRepBuilderAPI_MakeVertex.hxx>
#include <TopTools_HSequenceOfShape.hxx>
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
#include <cstdio>
#include <BRepOffsetAPI_MakePipeShell.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRepPrimAPI_MakeHalfSpace.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <GC_MakeArcOfCircle.hxx>
#include <GeomAPI_Interpolate.hxx>
#include <TColgp_HArray1OfPnt.hxx>
#include <BRepOffsetAPI_ThruSections.hxx>
#include <BRepOffset_MakeOffset.hxx>
#include <BRepOffsetAPI_MakeThickSolid.hxx>
#include <BRepOffsetAPI_MakeOffsetShape.hxx>
#include <BRepAlgoAPI_Defeaturing.hxx>
#include <BRepAlgoAPI_Splitter.hxx>
#include <BRepAlgoAPI_Section.hxx>
#include <BRepExtrema_DistShapeShape.hxx>
#include <IntCurvesFace_ShapeIntersector.hxx>
#include <gp_Lin.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <ShapeFix_Face.hxx>
#include <gp_Cone.hxx>
#include <gp.hxx>
#include <BRep_Tool.hxx>
#include <GeomConvert.hxx>
#include <GeomLib.hxx>
#include <TopoDS_Iterator.hxx>
#include <BRepBuilderAPI_Copy.hxx>
#include <BRepBuilderAPI_MakeSolid.hxx>
#include <BRep_Builder.hxx>
#include <Geom_RectangularTrimmedSurface.hxx>
#include <BRepTools_ReShape.hxx>
#include <BRepBuilderAPI_NurbsConvert.hxx>
#include <ShapeAnalysis_Edge.hxx>
#include <ShapeFix_Edge.hxx>
#include <TopTools_MapOfShape.hxx>
#include <GeomAPI_PointsToBSpline.hxx>
#include <GeomAdaptor_Surface.hxx>
#include <GeomConvert_CompCurveToBSplineCurve.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <ShapeAnalysis_FreeBounds.hxx>
#include <TopTools_HSequenceOfShape.hxx>
#include <TopoDS_Iterator.hxx>
#include <TopoDS_Compound.hxx>
#include <algorithm>
#include <map>
#include <TColgp_Array1OfPnt2d.hxx>
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
#include <BRepTools_Modification.hxx>
#include <BRepTools_Modifier.hxx>
#include <BRepClass3d_SolidClassifier.hxx>
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
#include <TopTools_DataMapOfShapeInteger.hxx>
#include <cmath>
#include <set>
#include <GeomAPI_ProjectPointOnSurf.hxx>
#include <Geom_Surface.hxx>
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

// Where a point on an edge falls along its fillet contour, as the contour's relative parameter
// [0, 1]: the arc length from the edge's start to the point (on a fine polyline of the edge), placed
// by the curvilinear abscissae the builder gives the edge's two vertices.
inline double w3d_spine_param(BRepFilletAPI_MakeFillet &mk, int ic, const TopoDS_Edge &e, const gp_Pnt &p) {
  BRepAdaptor_Curve c(e);
  const double u0 = c.FirstParameter(), u1 = c.LastParameter();
  const int n = 512;
  gp_Pnt prev = c.Value(u0);
  double run = 0, best = 1e300, at = 0;
  for (int i = 1; i <= n; i++) {
    gp_Pnt q = c.Value(u0 + (u1 - u0) * i / n);
    gp_Vec d(prev, q);
    double l = d.Magnitude(), t = l > 0 ? std::max(0.0, std::min(1.0, gp_Vec(prev, p).Dot(d) / (l * l))) : 0;
    gp_Pnt f = prev.Translated(d * t);
    double dist = f.Distance(p);
    if (dist < best) { best = dist; at = run + t * l; }
    run += l;
    prev = q;
  }
  const double len = run, total = mk.Length(ic);
  if (total <= 0) return 0;
  TopoDS_Vertex v0, v1;
  double d0 = 1e300, d1 = 1e300;
  gp_Pnt s0 = c.Value(u0), s1 = c.Value(u1);
  for (TopExp_Explorer x(e, TopAbs_VERTEX); x.More(); x.Next()) {
    const TopoDS_Vertex &v = TopoDS::Vertex(x.Current());
    gp_Pnt q = BRep_Tool::Pnt(v);
    if (q.Distance(s0) < d0) { d0 = q.Distance(s0); v0 = v; }
    if (q.Distance(s1) < d1) { d1 = q.Distance(s1); v1 = v; }
  }
  double a;
  if (v0.IsNull() || v1.IsNull()) a = at * total / len;
  else {
    const double a0 = mk.Abscissa(ic, v0), a1 = mk.Abscissa(ic, v1), tol = 1e-3 * std::max(1.0, total);
    if (v0.IsSame(v1)) a = at * total / len;                                   // a closed edge
    else if (std::abs(a0 + len - a1) < tol || (std::abs(a0 + len - total) < tol && a1 < tol)) a = a0 + at;  // runs with the contour
    else a = (a0 < tol ? total : a0) - at;                                       // runs against it
  }
  return std::max(0.0, std::min(1.0, a / total));
}

// w3d_blend_edges with history: the body's faces and edges, plus the faces each edge became.
// `variable` holds Plasticity's variable points for a fillet, [edge, x, y, z, scale] each: the
// radius there is `size` × scale, and the contour's radius runs smoothly through them from `size`
// at its ends.
inline std::unique_ptr<W3dResult> w3d_blend_edges_history(const TopoDS_Shape &shape, rust::Slice<const int32_t> edges,
                                                          double size, bool chamfer, double angle,
                                                          rust::Slice<const double> variable) {
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
    } else if (variable.size() >= 5) {
      if (variable.size() % 5) throw std::runtime_error("a variable point is cut short");
      BRepFilletAPI_MakeFillet probe(shape);
      for (int32_t e : edges) probe.Add(size, TopoDS::Edge(map(e + 1)));
      std::map<int, std::vector<std::pair<double, double>>> laws;
      for (size_t i = 0; i < variable.size(); i += 5) {
        int e = int(variable[i]);
        if (e < 0 || e >= map.Extent()) throw std::out_of_range("no such edge");
        const TopoDS_Edge &edge = TopoDS::Edge(map(e + 1));
        int ic = probe.Contour(edge);
        if (ic == 0) throw std::runtime_error("a variable point is on an edge that isn't being rounded");
        if (!(variable[i + 4] > 0)) throw std::runtime_error("a variable point's radius must be greater than zero");
        laws[ic].push_back({w3d_spine_param(probe, ic, edge, gp_Pnt(variable[i + 1], variable[i + 2], variable[i + 3])), size * variable[i + 4]});
      }
      BRepFilletAPI_MakeFillet *f = new BRepFilletAPI_MakeFillet(shape);
      mk.reset(f);
      for (int ic = 1; ic <= probe.NbContours(); ic++) {
        const TopoDS_Edge &first = probe.Edge(ic, 1);
        auto law = laws.find(ic);
        if (law == laws.end()) { f->Add(size, first); continue; }
        // The ends keep the radius unless a point sits on them; points closer than 0.1% merge.
        double r0 = size, r1 = size;
        std::vector<std::pair<double, double>> mid;
        for (auto &q : law->second) {
          if (q.first < 1e-3) r0 = q.second;
          else if (q.first > 1 - 1e-3) r1 = q.second;
          else mid.push_back(q);
        }
        std::stable_sort(mid.begin(), mid.end(), [](const std::pair<double, double> &a, const std::pair<double, double> &b) { return a.first < b.first; });
        std::vector<std::pair<double, double>> keep{{0.0, r0}};
        for (auto &q : mid) {
          if (q.first - keep.back().first < 1e-3) keep.back().second = q.second;
          else keep.push_back(q);
        }
        if (1.0 - keep.back().first < 1e-3 && keep.size() > 1) keep.pop_back();
        // A closed contour comes back to where it started.
        bool closed = BRep_Tool::Pnt(probe.FirstVertex(ic)).Distance(BRep_Tool::Pnt(probe.LastVertex(ic))) < 1e-7;
        keep.push_back({1.0, closed ? (r0 != size ? r0 : r1) : r1});
        if (closed) keep.front().second = keep.back().second;
        TColgp_Array1OfPnt2d arr(1, int(keep.size()));
        for (size_t k = 0; k < keep.size(); k++) arr.SetValue(int(k) + 1, gp_Pnt2d(keep[k].first, keep[k].second));
        f->Add(arr, first);
      }
    } else {
      BRepFilletAPI_MakeFillet *f = new BRepFilletAPI_MakeFillet(shape);
      mk.reset(f);
      for (int32_t e : edges) f->Add(size, TopoDS::Edge(map(e + 1)));
    }
    mk->Build();
    if (!mk->IsDone()) {
      if (!chamfer && variable.size() >= 5)
        throw std::runtime_error("BLEND||the kernel could not build the variable round; try radii closer to each other or a smaller radius");
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

// A guide wire turned, if need be, to run the same way as the sections: it starts nearer `from`.
inline TopoDS_Wire w3d_guide_from(const TopoDS_Wire &guide, const TopoDS_Shape &from) {
  TopoDS_Vertex first, last;
  TopExp::Vertices(guide, first, last);
  if (first.IsNull() || last.IsNull()) return guide;
  BRepExtrema_DistShapeShape a(first, from), b(last, from);
  if (a.IsDone() && b.IsDone() && b.Value() < a.Value() - 1e-9) return TopoDS::Wire(guide.Reversed());
  return guide;
}

// The shortest gap between a guide and a section, to refuse guides that miss the profiles.
inline double w3d_gap(const TopoDS_Shape &a, const TopoDS_Shape &b) {
  BRepExtrema_DistShapeShape d(a, b);
  return d.IsDone() ? d.Value() : 1e100;
}

// The point where `guide` crosses the plane through `o` square to `n`, searched between curve
// parameters `t0` and `t1`; the crossing nearest `near` when there are several.
inline gp_Pnt w3d_crossing(const BRepAdaptor_CompCurve &guide, double t0, double t1, const gp_Pnt &o, const gp_Vec &n, const gp_Pnt &near) {
  auto side = [&](double t) { return gp_Vec(o, guide.Value(t)).Dot(n); };
  const int steps = 400;
  bool found = false;
  gp_Pnt best;
  double prev = side(t0);
  for (int i = 1; i <= steps; i++) {
    double a = t0 + (t1 - t0) * (i - 1) / steps, b = t0 + (t1 - t0) * i / steps, now = side(b);
    if (std::fabs(prev) < 1e-12 || prev * now <= 0) {
      double sa = prev;
      for (int k = 0; k < 80; k++) {
        double m = (a + b) / 2, sm = side(m);
        if (sa * sm <= 0) b = m; else { a = m; sa = sm; }
      }
      gp_Pnt p = guide.Value((a + b) / 2);
      if (!found || p.Distance(near) < best.Distance(near)) best = p;
      found = true;
    }
    prev = now;
  }
  if (!found) throw std::runtime_error("the guide does not run beside the path all the way; it must reach as far as the path does");
  return best;
}

// The transform that moves `r` to `g` (one guide) or takes the pair `r1`, `r2` onto `g1`, `g2`
// by turning about `axis` through `pivot`, scaling there and moving (two guides).
inline gp_Trsf w3d_onto(const gp_Pnt &pivot, const gp_Vec &axis, const gp_Pnt &from, const gp_Pnt &to, bool grow) {
  gp_Vec n = axis.Normalized(), u(pivot, from), v(pivot, to);
  u -= n * u.Dot(n);
  v -= n * v.Dot(n);
  if (u.Magnitude() < 1e-7) throw std::runtime_error("the guide must touch the profile away from the path");
  if (v.Magnitude() < 1e-7) throw std::runtime_error("the guide crosses the path; keep it to one side");
  gp_Trsf turn, scale;
  turn.SetRotation(gp_Ax1(pivot, gp_Dir(n)), u.AngleWithRef(v, n));
  if (grow) scale.SetScale(pivot, v.Magnitude() / u.Magnitude());
  return scale * turn;
}

// Plasticity's Sweep with a guide or an alignment. With a `guide` (empty for none) the section is
// carried along the path as in a plain sweep and then, at each of many stations, turned about the
// path toward the guide: `method` 0 (Point) also scales it so the point that touched the guide
// stays on it; 1 (Chord) and 2 (Curve) only turn it, Chord meeting the guide where it crosses the
// section's plane and Curve at the same fraction of the guide's length. The stations are lofted.
// Without a guide, `parallel` keeps the section at its drawn orientation all along (Alignment:
// Parallel) instead of turning with the path (Normal).
inline std::unique_ptr<TopoDS_Shape> w3d_sweep_guided(rust::Slice<const double> section, rust::Slice<const double> path,
                                                      rust::Slice<const double> guide, int32_t method, bool parallel) {
  try {
    TopoDS_Wire profile = w3d_one_section(section);
    TopoDS_Wire spine = w3d_one_section(path);
    if (guide.size() == 0) {
      BRepOffsetAPI_MakePipeShell mk(spine);
      if (parallel) mk.SetMode(gp_Ax2());
      else mk.SetMode(path.size() > 0 && int(path[0]) == 7 ? Standard_True : Standard_False);
      mk.SetTransitionMode(BRepBuilderAPI_RightCorner);
      mk.Add(profile, Standard_False, Standard_False);
      mk.Build();
      if (!mk.IsDone()) throw std::runtime_error("the profile could not be swept along that path");
      if (!mk.MakeSolid()) throw std::runtime_error("the sweep did not close into a solid");
      return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(mk.Shape()));
    }
    if (method < 0 || method > 2) throw std::runtime_error("the guide method is Point, Chord or Curve");
    if (spine.Closed()) throw std::runtime_error("a guide needs a path with two ends");
    TopoDS_Wire g = w3d_guide_from(w3d_one_section(guide), profile);
    if (w3d_gap(g, profile) > 0.01) throw std::runtime_error("the guide does not touch the profile; snap its end onto it");
    BRepAdaptor_CompCurve along(spine), rail(g);
    TopoDS_Vertex g0, g1;
    TopExp::Vertices(g, g0, g1);
    BRepExtrema_DistShapeShape touch(g0, profile);
    gp_Pnt contact = touch.PointOnShape2(1);
    double rail_length = GCPnts_AbscissaPoint::Length(rail);

    double t0 = along.FirstParameter(), t1 = along.LastParameter();
    const int stations = 32, sub = 8;
    BRepOffsetAPI_ThruSections mk(Standard_True, Standard_False, 1e-6);
    gp_Trsf carry;
    gp_Pnt start, p, last_g = contact;
    gp_Vec prev, tan;
    along.D1(t0, start, prev);
    for (int i = 0; i <= stations; i++) {
      // Carried by the path's own turn (parallel transport) from the last station.
      if (i > 0) {
        for (int k = 1; k <= sub; k++) {
          along.D1(t0 + (t1 - t0) * ((i - 1) * sub + k) / (stations * sub), p, tan);
          if (prev.Magnitude() > 1e-12 && tan.Magnitude() > 1e-12 && !prev.IsParallel(tan, 1e-9)) {
            gp_Trsf r;
            r.SetRotation(gp_Ax1(gp::Origin(), gp_Dir(prev.Crossed(tan))), prev.Angle(tan));
            carry = r * carry;
          }
          prev = tan;
        }
      }
      double t = t0 + (t1 - t0) * i / stations;
      along.D1(t, p, tan);
      gp_Trsf move, at_start, back;
      at_start.SetTranslation(start, gp::Origin());
      move.SetTranslation(gp::Origin(), p);
      gp_Trsf place = move * carry * at_start;
      gp_Pnt c = contact.Transformed(place);
      gp_Pnt target;
      if (method == 2) {
        GCPnts_AbscissaPoint at(rail, rail_length * i / stations, rail.FirstParameter());
        target = rail.Value(at.Parameter());
      } else if (i == 0) {
        target = contact;
      } else if (i == stations) {
        target = BRep_Tool::Pnt(g1);
      } else {
        target = w3d_crossing(rail, rail.FirstParameter(), rail.LastParameter(), p, tan, last_g);
      }
      last_g = target;
      gp_Trsf all = w3d_onto(p, tan, c, target, method == 0) * place;
      mk.AddWire(TopoDS::Wire(BRepBuilderAPI_Transform(profile, all, Standard_True).Shape()));
    }
    mk.CheckCompatibility(Standard_False);
    mk.Build();
    if (!mk.IsDone()) throw std::runtime_error("the profile could not follow that guide; check it runs beside the path all along");
    return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(mk.Shape()));
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// The region's centre and the normal of its plane.
inline std::pair<gp_Pnt, gp_Vec> w3d_plane_of(const TopoDS_Wire &w) {
  TopoDS_Face face = BRepBuilderAPI_MakeFace(w, Standard_True).Face();
  GProp_GProps props;
  BRepGProp::SurfaceProperties(face, props);
  BRepGProp_Face at(face);
  double u0, u1, v0, v1;
  at.Bounds(u0, u1, v0, v1);
  gp_Pnt pt;
  gp_Vec n;
  at.Normal((u0 + u1) / 2, (v0 + v1) / 2, pt, n);
  return {props.CentreOfMass(), n.Normalized()};
}

// Plasticity's Loft with guides: a solid through the sections, in order, its sides running along
// the guides. The plain loft is cut at stations between each pair of sections; each cut is moved
// so its point nearest one guide lies on it, or, with two guides, turned and scaled in its plane so
// it meets both; then the sections and cuts are lofted. Every guide must touch every section.
inline std::unique_ptr<TopoDS_Shape> w3d_loft_guided(rust::Slice<const double> sections, rust::Slice<const double> guides) {
  try {
    std::vector<TopoDS_Wire> profiles, rails;
    for (const double *p = sections.data(), *end = p + sections.size(); p < end;) profiles.push_back(w3d_section(p, end));
    for (const double *p = guides.data(), *end = p + guides.size(); p < end;) rails.push_back(w3d_section(p, end));
    if (profiles.size() < 2) throw std::runtime_error("a loft needs two profiles or more");
    if (rails.empty()) throw std::runtime_error("select the guide curves");
    if (rails.size() > 2) throw std::runtime_error("this build follows up to two guides; select fewer");
    // Where each guide touches each profile, and its curve parameter there.
    std::vector<BRepAdaptor_CompCurve> curves;
    std::vector<std::vector<gp_Pnt>> touch(rails.size());
    for (size_t j = 0; j < rails.size(); j++) {
      rails[j] = w3d_guide_from(rails[j], profiles.front());
      curves.emplace_back(rails[j]);
      for (const auto &w : profiles) {
        BRepExtrema_DistShapeShape d(rails[j], w);
        if (!d.IsDone() || d.Value() > 0.01) throw std::runtime_error("a guide does not touch every profile; snap it onto each one");
        touch[j].push_back(d.PointOnShape2(1));
      }
    }
    BRepOffsetAPI_ThruSections plain_mk(Standard_True, Standard_False);
    for (const auto &w : profiles) plain_mk.AddWire(w);
    plain_mk.Build();
    if (!plain_mk.IsDone()) throw std::runtime_error("no surface could be lofted through those profiles");
    TopoDS_Shape plain = plain_mk.Shape();

    const int stations = 16;
    BRepOffsetAPI_ThruSections mk(Standard_True, Standard_False, 1e-6);
    mk.AddWire(profiles[0]);
    for (size_t i = 0; i + 1 < profiles.size(); i++) {
      auto [ca, na] = w3d_plane_of(profiles[i]);
      auto [cb, nb] = w3d_plane_of(profiles[i + 1]);
      gp_Vec span(ca, cb);
      if (na.Dot(span) < 0) na.Reverse();
      if (nb.Dot(span) < 0) nb.Reverse();
      for (int k = 1; k < stations; k++) {
        double s = double(k) / stations;
        gp_Pnt o(ca.XYZ() * (1 - s) + cb.XYZ() * s);
        gp_Vec n = na * (1 - s) + nb * s;
        if (n.Magnitude() < 1e-9) throw std::runtime_error("the profiles face opposite ways");
        n.Normalize();
        BRepAlgoAPI_Section cut(plain, gp_Pln(o, gp_Dir(n)), Standard_False);
        cut.ComputePCurveOn1(Standard_False);
        cut.Approximation(Standard_True);
        cut.Build();
        if (!cut.IsDone()) throw std::runtime_error("the loft could not be cut between its profiles");
        Handle(TopTools_HSequenceOfShape) edges = new TopTools_HSequenceOfShape, wires;
        for (TopExp_Explorer e(cut.Shape(), TopAbs_EDGE); e.More(); e.Next()) edges->Append(e.Current());
        ShapeAnalysis_FreeBounds::ConnectEdgesToWires(edges, 1e-6, Standard_False, wires);
        if (wires->Length() != 1) throw std::runtime_error("the loft between those profiles folds over; guides need a simple loft");
        TopoDS_Wire w = TopoDS::Wire(wires->Value(1));
        // Where each guide and the plain loft's side cross this cut.
        std::vector<gp_Pnt> r, g;
        for (size_t j = 0; j < rails.size(); j++) {
          gp_Pnt guess(touch[j][i].XYZ() * (1 - s) + touch[j][i + 1].XYZ() * s);
          g.push_back(w3d_crossing(curves[j], curves[j].FirstParameter(), curves[j].LastParameter(), o, n, guess));
          BRepExtrema_DistShapeShape near(BRepBuilderAPI_MakeVertex(guess).Vertex(), w);
          r.push_back(near.PointOnShape2(1));
        }
        gp_Trsf t;
        if (rails.size() == 1) {
          t.SetTranslation(r[0], g[0]);
        } else {
          gp_Trsf onto = w3d_onto(r[0], n, r[1], gp_Pnt(r[0].XYZ() + (g[1].XYZ() - g[0].XYZ())), true), move;
          move.SetTranslation(r[0], g[0]);
          t = move * onto;
        }
        mk.AddWire(TopoDS::Wire(BRepBuilderAPI_Transform(w, t, Standard_True).Shape()));
      }
      mk.AddWire(profiles[i + 1]);
    }
    mk.Build();
    if (!mk.IsDone()) throw std::runtime_error("no surface could be lofted along those guides; check they run from the first profile to the last");
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
    TopTools_IndexedMapOfShape before;
    TopExp::MapShapes(shape, TopAbs_FACE, before);
    // A real shell adds an inner wall for every face it keeps. On some free-form bodies (a loft of
    // closed splines) the intersection join hands the body back untouched; the arc join, which
    // rounds the inner corners instead, often succeeds there.
    auto hollowed = [&](BRepOffsetAPI_MakeThickSolid &m) {
      if (!m.IsDone() || m.Shape().IsNull()) return false;
      TopTools_IndexedMapOfShape after;
      TopExp::MapShapes(m.Shape(), TopAbs_FACE, after);
      return after.Extent() > before.Extent();
    };
    BRepOffsetAPI_MakeThickSolid join, arc;
    join.MakeThickSolidByJoin(shape, closing, -thickness, 1e-6, BRepOffset_Skin, Standard_False, Standard_False,
                              GeomAbs_Intersection, Standard_False);
    BRepOffsetAPI_MakeThickSolid *done = &join;
    if (!hollowed(join)) {
      arc.MakeThickSolidByJoin(shape, closing, -thickness, 1e-6, BRepOffset_Skin, Standard_False, Standard_False,
                               GeomAbs_Arc, Standard_False);
      done = &arc;
    }
    BRepOffsetAPI_MakeThickSolid &mk = *done;
    if (!hollowed(mk))
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

// A fillet's size changed (Plasticity's Dimension on a fillet): the numbered fillet faces removed so
// the faces they joined grow back to a sharp edge, then that edge filleted again at `radius`. The
// edges to fillet are those the removal made between two faces that touched the fillet but not
// each other.
inline std::unique_ptr<W3dResult> w3d_refillet(const TopoDS_Shape &shape, rust::Slice<const int32_t> faces, double radius) {
  if (!(radius > 0) || !std::isfinite(radius)) throw std::runtime_error("the radius must be above zero");
  if (faces.empty()) throw std::runtime_error("select a fillet");
  TopTools_IndexedMapOfShape map;
  TopExp::MapShapes(shape, TopAbs_FACE, map);
  TopTools_IndexedDataMapOfShapeListOfShape before;
  TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, before);
  try {
    TopTools_MapOfShape removed;
    for (int32_t f : faces) {
      if (f < 0 || f >= map.Extent()) throw std::out_of_range("no such face");
      removed.Add(map(f + 1));
    }
    // The faces the fillet touches, and which of them already shared an edge.
    TopTools_IndexedMapOfShape near;
    for (TopTools_MapOfShape::Iterator it(removed); it.More(); it.Next())
      for (TopExp_Explorer ex(it.Value(), TopAbs_EDGE); ex.More(); ex.Next())
        for (TopTools_ListOfShape::Iterator g(before.FindFromKey(ex.Current())); g.More(); g.Next())
          if (!removed.Contains(g.Value())) near.Add(g.Value());
    std::set<std::pair<int, int>> touching;
    for (int i = 1; i <= before.Extent(); i++) {
      std::vector<int> ids;
      for (TopTools_ListOfShape::Iterator g(before(i)); g.More(); g.Next()) { int k = near.FindIndex(g.Value()); if (k) ids.push_back(k); }
      for (size_t a = 0; a < ids.size(); a++) for (size_t b = a + 1; b < ids.size(); b++) touching.insert({std::min(ids[a], ids[b]), std::max(ids[a], ids[b])});
    }
    BRepAlgoAPI_Defeaturing df;
    df.SetShape(shape);
    for (TopTools_MapOfShape::Iterator it(removed); it.More(); it.Next()) df.AddFaceToRemove(it.Value());
    df.SetToFillHistory(Standard_True);
    df.Build();
    if (!df.IsDone() || df.HasErrors() || df.Shape().IsNull())
      throw std::runtime_error("the faces around that fillet can't grow back to an edge");
    TopoDS_Shape sharp = df.Shape();
    // Which touching face each face of the sharp body came from.
    TopTools_DataMapOfShapeInteger from;
    for (int k = 1; k <= near.Extent(); k++) {
      if (df.IsDeleted(near(k))) continue;
      const TopTools_ListOfShape &m = df.Modified(near(k));
      if (m.IsEmpty()) from.Bind(near(k), k);
      else for (TopTools_ListOfShape::Iterator it(m); it.More(); it.Next()) from.Bind(it.Value(), k);
    }
    TopTools_IndexedDataMapOfShapeListOfShape after;
    TopExp::MapShapesAndAncestors(sharp, TopAbs_EDGE, TopAbs_FACE, after);
    BRepFilletAPI_MakeFillet mk(sharp);
    int added = 0;
    for (int i = 1; i <= after.Extent(); i++) {
      const TopTools_ListOfShape &fs = after(i);
      if (fs.Extent() != 2) continue;
      const TopoDS_Shape &a = fs.First(), &b = fs.Last();
      if (!from.IsBound(a) || !from.IsBound(b)) continue;
      int ia = from(a), ib = from(b);
      if (ia == ib || touching.count({std::min(ia, ib), std::max(ia, ib)})) continue;
      mk.Add(radius, TopoDS::Edge(after.FindKey(i)));
      added++;
    }
    if (!added) throw std::runtime_error("that face is not a fillet between two faces");
    mk.Build();
    if (!mk.IsDone() || mk.Shape().IsNull()) throw std::runtime_error("a fillet that size does not fit there");
    std::unique_ptr<W3dResult> r(new W3dResult());
    r->shape = mk.Shape();
    if (!w3d_is_valid(r->shape)) throw std::runtime_error("a fillet that size breaks the body");
    w3d_record(*r, 0, shape, {w3d_step(df), w3d_step(mk)});
    return r;
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// Plasticity's Delete Redundant Topology: faces on one surface merged, and edges on one curve, so
// seams that an edit left behind (coplanar faces, split lines and arcs) go away.
inline std::unique_ptr<W3dResult> w3d_unify(const TopoDS_Shape &shape) {
  try {
    ShapeUpgrade_UnifySameDomain unify(shape, Standard_True, Standard_True, Standard_True);
    unify.AllowInternalEdges(Standard_False);
    unify.Build();
    std::unique_ptr<W3dResult> r(new W3dResult());
    r->shape = unify.Shape();
    if (!w3d_is_valid(r->shape)) throw std::runtime_error("merging the faces breaks the body");
    w3d_record(*r, 0, shape, {w3d_step(unify.History())});
    return r;
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// Plasticity's Reverse Sheet: the same faces facing the other way. Faces and edges keep their numbers.
inline std::unique_ptr<TopoDS_Shape> w3d_reversed(const TopoDS_Shape &shape) {
  return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(shape.Reversed()));
}

// Plasticity's Find Boundary Edges: the numbers (TopExp::MapShapes order) of the edges that bound
// only one face, the open sides of sheets. Seams and degenerate edges are skipped.
inline rust::Vec<int32_t> w3d_boundary_edges(const TopoDS_Shape &shape) {
  TopTools_IndexedMapOfShape edges;
  TopExp::MapShapes(shape, TopAbs_EDGE, edges);
  TopTools_IndexedDataMapOfShapeListOfShape faces;
  TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, faces);
  rust::Vec<int32_t> out;
  for (int i = 1; i <= edges.Extent(); i++) {
    const TopoDS_Edge &e = TopoDS::Edge(edges(i));
    if (BRep_Tool::Degenerated(e) || !faces.Contains(e)) continue;
    TopTools_IndexedMapOfShape distinct;
    for (TopTools_ListIteratorOfListOfShape it(faces.FindFromKey(e)); it.More(); it.Next()) distinct.Add(it.Value());
    if (distinct.Extent() != 1) continue;
    if (BRep_Tool::IsClosed(e, TopoDS::Face(distinct(1)))) continue;
    out.push_back(i - 1);
  }
  return out;
}

// The face's outward normal where the edge runs over it, `t` of the way along the edge.
inline bool w3d_normal_on_edge(const TopoDS_Edge &e, const TopoDS_Face &f, double t, gp_Vec &n) {
  Standard_Real a, b;
  Handle(Geom2d_Curve) pc = BRep_Tool::CurveOnSurface(e, f, a, b);
  if (pc.IsNull()) return false;
  gp_Pnt2d uv = pc->Value(a + (b - a) * t);
  BRepAdaptor_Surface s(f);
  gp_Pnt p;
  gp_Vec du, dv;
  s.D1(uv.X(), uv.Y(), p, du, dv);
  n = du.Crossed(dv);
  if (n.Magnitude() < 1e-12) return false;
  n.Normalize();
  if (f.Orientation() == TopAbs_REVERSED) n.Reverse();
  return true;
}

// Whether the two faces meet smoothly (within 1 degree) all along the edge.
inline bool w3d_tangent_along(const TopoDS_Edge &e, const TopoDS_Face &a, const TopoDS_Face &b) {
  for (double t : {0.2, 0.5, 0.8}) {
    gp_Vec na, nb;
    if (!w3d_normal_on_edge(e, a, t, na) || !w3d_normal_on_edge(e, b, t, nb)) return false;
    if (na.Dot(nb) < std::cos(M_PI / 180.0)) return false;
  }
  return true;
}

// For each edge (TopExp::MapShapes order), the largest angle in degrees between the two faces'
// outward normals along it, sampled at 17 points: 0 where the faces meet tangentially (G1), 90 at
// a square corner. -1 for edges that do not join two distinct faces (open sides, seams, poles).
inline rust::Vec<double> w3d_edge_angles(const TopoDS_Shape &shape) {
  TopTools_IndexedMapOfShape edges;
  TopExp::MapShapes(shape, TopAbs_EDGE, edges);
  TopTools_IndexedDataMapOfShapeListOfShape owners;
  TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, owners);
  rust::Vec<double> out;
  for (int i = 1; i <= edges.Extent(); i++) {
    const TopoDS_Edge &e = TopoDS::Edge(edges(i));
    double worst = -1;
    if (!BRep_Tool::Degenerated(e) && owners.Contains(e)) {
      TopTools_IndexedMapOfShape distinct;
      for (TopTools_ListIteratorOfListOfShape it(owners.FindFromKey(e)); it.More(); it.Next()) distinct.Add(it.Value());
      if (distinct.Extent() == 2) {
        TopoDS_Face a = TopoDS::Face(distinct(1)), b = TopoDS::Face(distinct(2));
        for (int k = 0; k <= 16; k++) {
          gp_Vec na, nb;
          if (!w3d_normal_on_edge(e, a, k / 16.0, na) || !w3d_normal_on_edge(e, b, k / 16.0, nb)) continue;
          worst = std::max(worst, na.Angle(nb) * 180.0 / M_PI);
        }
      }
    }
    out.push_back(worst);
  }
  return out;
}

// The larger of a surface's principal curvatures at (u, v), by size: from its first and second
// fundamental forms. 0 where the surface degenerates.
inline double w3d_largest_curvature(const BRepAdaptor_Surface &sa, double u, double v) {
  gp_Pnt p; gp_Vec du, dv, duu, dvv, duv;
  sa.D2(u, v, p, du, dv, duu, dvv, duv);
  gp_Vec n = du.Crossed(dv);
  if (n.Magnitude() < 1e-12) return 0;
  n.Normalize();
  double E = du.Dot(du), F = du.Dot(dv), G = dv.Dot(dv), L = duu.Dot(n), M = duv.Dot(n), N = dvv.Dot(n);
  double det = E * G - F * F;
  if (det < 1e-24) return 0;
  double K = (L * N - M * M) / det, H = (E * N - 2 * F * M + G * L) / (2 * det);
  double s = std::sqrt(std::max(0.0, H * H - K));
  return std::max(std::abs(H + s), std::abs(H - s));
}

// For each face (TopExp::MapShapes order), nine numbers for Dimension: the kind (0 other, 1 plane,
// 2 cylinder, 3 sphere, 4 a spline round of one radius), the radius (0 for a plane), a point (plane origin, cylinder axis point,
// sphere centre), a direction (outward plane normal, cylinder axis) and +1 where the outward normal
// points away from the axis or centre (a boss or ball), -1 where it points towards it (a hole).
inline rust::Vec<double> w3d_face_surfaces(const TopoDS_Shape &shape) {
  TopTools_IndexedMapOfShape faces;
  TopExp::MapShapes(shape, TopAbs_FACE, faces);
  rust::Vec<double> out;
  for (int i = 1; i <= faces.Extent(); i++) {
    const TopoDS_Face &f = TopoDS::Face(faces(i));
    BRepAdaptor_Surface sa(f);
    double u = (sa.FirstUParameter() + sa.LastUParameter()) / 2, v = (sa.FirstVParameter() + sa.LastVParameter()) / 2;
    gp_Pnt p; gp_Vec du, dv;
    sa.D1(u, v, p, du, dv);
    gp_Vec n = du.Crossed(dv);
    if (f.Orientation() == TopAbs_REVERSED) n.Reverse();
    double kind = 0, r = 0, side = 1;
    gp_Pnt at(0, 0, 0); gp_Dir dir(0, 0, 1);
    switch (sa.GetType()) {
    case GeomAbs_Plane: {
      kind = 1; at = sa.Plane().Location();
      if (n.Magnitude() > 1e-12) dir = gp_Dir(n);
      break;
    }
    case GeomAbs_Cylinder: {
      kind = 2; r = sa.Cylinder().Radius(); at = sa.Cylinder().Location(); dir = sa.Cylinder().Axis().Direction();
      gp_Vec w(at, p);
      gp_Vec radial = w - gp_Vec(dir) * w.Dot(gp_Vec(dir));
      side = n.Dot(radial) >= 0 ? 1 : -1;
      break;
    }
    case GeomAbs_Sphere: {
      kind = 3; r = sa.Sphere().Radius(); at = sa.Sphere().Location();
      side = n.Dot(gp_Vec(at, p)) >= 0 ? 1 : -1;
      break;
    }
    default: {
      // A spline bent to one radius throughout (a round made as a B-spline): kind 4.
      double lo = 1e300, hi = 0;
      for (double a : {0.2, 0.5, 0.8}) for (double b : {0.2, 0.5, 0.8}) {
        double k = w3d_largest_curvature(sa, sa.FirstUParameter() + a * (sa.LastUParameter() - sa.FirstUParameter()), sa.FirstVParameter() + b * (sa.LastVParameter() - sa.FirstVParameter()));
        lo = std::min(lo, k); hi = std::max(hi, k);
      }
      if (lo > 1e-9 && (hi - lo) <= 1e-3 * lo) { kind = 4; r = 2 / (lo + hi); }
      break;
    }
    }
    for (double x : {kind, r, at.X(), at.Y(), at.Z(), dir.X(), dir.Y(), dir.Z(), side}) out.push_back(x);
  }
  return out;
}

// Toggle Points: each face's control points, its surface (trimmed to the face's (u, v) bounds) as a
// B-spline. Per face: nu, nv, then nu × nv points (x, y, z), u running slowest; 0, 0 when it has none.
// Face `f` as a B-spline face: itself when its surface is one, else converted exactly (its edges'
// curves on the new surface carried over). Returns the face whose surface and edge curves to use,
// and `edge` maps each of `f`'s edges to the matching edge of that face.
struct W3dSplineFace {
  TopoDS_Face face;
  Handle(Geom_BSplineSurface) surface;
  TopLoc_Location loc;
  std::function<TopoDS_Edge(const TopoDS_Edge &)> edge;
};
inline W3dSplineFace w3d_spline_face(const TopoDS_Face &f) {
  W3dSplineFace out;
  out.surface = Handle(Geom_BSplineSurface)::DownCast(BRep_Tool::Surface(f, out.loc));
  if (!out.surface.IsNull()) {
    out.face = f;
    out.edge = [](const TopoDS_Edge &e) { return e; };
    return out;
  }
  auto conv = std::make_shared<BRepBuilderAPI_NurbsConvert>(f, true);
  if (!conv->IsDone()) throw std::runtime_error("that face could not be converted to control points");
  out.face = TopoDS::Face(conv->Shape());
  out.surface = Handle(Geom_BSplineSurface)::DownCast(BRep_Tool::Surface(out.face, out.loc));
  if (out.surface.IsNull()) throw std::runtime_error("that face could not be converted to control points");
  out.edge = [conv](const TopoDS_Edge &e) { return TopoDS::Edge(conv->ModifiedShape(e)); };
  return out;
}

// Per face of `shape`: [nu, nv, then nu * nv poles (x, y, z), v fastest], or [0, 0] where it has
// none. These are the control points w3d_move_face_poles moves.
inline rust::Vec<double> w3d_face_poles(const TopoDS_Shape &shape) {
  TopTools_IndexedMapOfShape faces;
  TopExp::MapShapes(shape, TopAbs_FACE, faces);
  rust::Vec<double> out;
  for (int i = 1; i <= faces.Extent(); i++) {
    try {
      W3dSplineFace sf = w3d_spline_face(TopoDS::Face(faces(i)));
      const Handle(Geom_BSplineSurface) &b = sf.surface;
      out.push_back(b->NbUPoles());
      out.push_back(b->NbVPoles());
      for (int a = 1; a <= b->NbUPoles(); a++) for (int c = 1; c <= b->NbVPoles(); c++) {
        gp_Pnt p = b->Pole(a, c).Transformed(sf.loc.Transformation());
        out.push_back(p.X()); out.push_back(p.Y()); out.push_back(p.Z());
      }
    } catch (const std::exception &) {
      out.push_back(0); out.push_back(0);
    } catch (const Standard_Failure &) {
      out.push_back(0); out.push_back(0);
    }
  }
  return out;
}

// Face `f` (of a copied shape whose edge-to-face map is `owners`) on `made`, a B-spline with the
// knots of `sf.surface` (w3d_spline_face of `f`) and its poles moved or refined: the same wires, the
// edges' curves on the face carried over. The face's own open edges follow the new surface; an edge
// it shares with another face must stay put, or it throws.
inline TopoDS_Face w3d_face_on_spline(const TopoDS_Face &f, const W3dSplineFace &sf, const Handle(Geom_BSplineSurface) &made,
                                      const TopTools_IndexedDataMapOfShapeListOfShape &owners) {
  BRep_Builder B;
  const double t = Precision::Confusion();
  // The face again on the moved surface, with the same wires.
  TopLoc_Location oldLoc;
  Handle(Geom_Surface) old = BRep_Tool::Surface(f, oldLoc);
  TopoDS_Face nf = TopoDS::Face(f.Oriented(TopAbs_FORWARD).EmptyCopied());
  B.UpdateFace(nf, made, sf.loc, t);
  for (TopoDS_Iterator it(f, false, true); it.More(); it.Next()) B.Add(nf, it.Value());
  nf.Orientation(f.Orientation());
  const TopoDS_Face src = TopoDS::Face(sf.face.Oriented(TopAbs_FORWARD));
  TopTools_IndexedMapOfShape edges;
  TopExp::MapShapes(f, TopAbs_EDGE, edges);
  std::vector<TopoDS_Edge> open;
  for (int i = 1; i <= edges.Extent(); i++) {
    TopoDS_Edge e = TopoDS::Edge(edges(i));
    const TopoDS_Edge se = sf.edge(e);
    double a, b;
    // The edge's curve(s) on the B-spline face, read before the old surface's are dropped (when
    // the face was a B-spline already, they are the same ones). Conversion keeps each edge's
    // direction, so forward and reversed match `e`'s.
    Handle(Geom2d_Curve) c1, c2;
    const bool seam = BRep_Tool::IsClosed(se, src);
    if (seam) {
      c1 = BRep_Tool::CurveOnSurface(TopoDS::Edge(se.Oriented(TopAbs_FORWARD)), src, a, b);
      c2 = BRep_Tool::CurveOnSurface(TopoDS::Edge(se.Oriented(TopAbs_REVERSED)), src, a, b);
    } else c1 = BRep_Tool::CurveOnSurface(se, src, a, b);
    if (c1.IsNull() || (seam && c2.IsNull())) throw std::runtime_error("an edge of that face has no curve on it");
    B.UpdateEdge(e, Handle(Geom2d_Curve)(), old, oldLoc, t);
    if (seam) B.UpdateEdge(TopoDS::Edge(e.Oriented(TopAbs_FORWARD)), c1, c2, made, sf.loc, t);
    else B.UpdateEdge(e, c1, made, sf.loc, t);
    B.Range(e, made, sf.loc, a, b);
    if (BRep_Tool::Degenerated(e)) continue;
    bool shared = false;
    for (const TopoDS_Shape &g : owners.FindFromKey(e)) shared |= !g.IsSame(f);
    if (!shared) open.push_back(e);
    else {
      // A converted face's curves may run at another pace than the edge; match them, then the
      // edge's tolerance says how far the face now stands off it.
      B.SameParameter(e, false);
      BRepLib::SameParameter(e, 1e-6);
      if (BRep_Tool::Tolerance(e) > 1e-4)
        throw std::runtime_error("those points hold an edge shared with another face; move the points inside it, or move the points of a sheet's open side");
    }
  }
  // Open edges follow the surface: their 3D curves made again from the curves on it, their
  // vertices moved to the new ends.
  for (TopoDS_Edge &e : open) {
    B.UpdateEdge(e, Handle(Geom_Curve)(), t);
    if (!BRepLib::BuildCurve3d(e, 1e-6)) throw std::runtime_error("an edge of that face could not follow the moved points");
  }
  for (TopoDS_Edge &e : open) {
    double a, b;
    Handle(Geom_Curve) c = BRep_Tool::Curve(e, a, b);
    if (c.IsNull()) continue;
    TopoDS_Vertex v0, v1;
    const TopoDS_Edge ef = TopoDS::Edge(e.Oriented(TopAbs_FORWARD));
    TopExp::Vertices(ef, v0, v1);
    B.UpdateVertex(v0, c->Value(a), t);
    B.UpdateVertex(v1, c->Value(b), t);
  }
  for (TopoDS_Edge &e : open) BRepLib::SameParameter(e, 1e-6);
  return nf;
}

// Plasticity's surface control points moved (G on a face's points, Slide Surface CV): `moves` is
// (face, pole, dx, dy, dz) per point, poles numbered as w3d_face_poles gives them. A face that isn't
// a B-spline becomes one exactly first. The face's own open edges follow the new surface; an edge it
// shares with another face must stay put, so moving the points that hold one is refused.
inline std::unique_ptr<TopoDS_Shape> w3d_move_face_poles(const TopoDS_Shape &shape, rust::Slice<const double> moves) {
  if (moves.empty() || moves.size() % 5 != 0) throw std::runtime_error("no control points to move");
  try {
    TopoDS_Shape work = BRepBuilderAPI_Copy(shape).Shape();
    TopTools_IndexedMapOfShape map;
    TopExp::MapShapes(work, TopAbs_FACE, map);
    TopTools_IndexedDataMapOfShapeListOfShape owners;
    TopExp::MapShapesAndAncestors(work, TopAbs_EDGE, TopAbs_FACE, owners);
    std::map<int, std::vector<std::pair<int, gp_Vec>>> byFace;
    for (size_t i = 0; i < moves.size(); i += 5) byFace[(int)moves[i]].push_back({(int)moves[i + 1], gp_Vec(moves[i + 2], moves[i + 3], moves[i + 4])});
    Handle(BRepTools_ReShape) rs = new BRepTools_ReShape();
    for (auto &[index, list] : byFace) {
      if (index < 0 || index >= map.Extent()) throw std::out_of_range("that face no longer exists");
      TopoDS_Face f = TopoDS::Face(map(index + 1));
      W3dSplineFace sf = w3d_spline_face(f);
      Handle(Geom_BSplineSurface) made = Handle(Geom_BSplineSurface)::DownCast(sf.surface->Copy());
      const gp_Trsf back = sf.loc.Transformation().Inverted();
      const int nv = made->NbVPoles();
      for (auto &[k, by] : list) {
        if (k < 0 || k >= made->NbUPoles() * nv) throw std::out_of_range("that control point no longer exists");
        const int a = k / nv + 1, c = k % nv + 1;
        made->SetPole(a, c, made->Pole(a, c).Translated(by.Transformed(back)));
      }
      rs->Replace(f, w3d_face_on_spline(f, sf, made, owners));
    }
    TopoDS_Shape result = rs->Apply(work);
    BRepLib::UpdateTolerances(result, false);
    if (!w3d_is_valid(result)) throw std::runtime_error("moving those points would leave the face invalid; move them less, or move fewer");
    return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(result));
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// Plasticity's Subdivide on faces: each of `faces` with its spans doubled in u and v (a knot in the
// middle of every span), so it has twice the control points to shape with and the same shape. A
// face that isn't a B-spline becomes one exactly first. Faces and edges keep their numbers.
inline std::unique_ptr<TopoDS_Shape> w3d_subdivide_faces(const TopoDS_Shape &shape, rust::Slice<const int32_t> faces) {
  if (faces.empty()) throw std::runtime_error("select the faces to subdivide");
  try {
    TopoDS_Shape work = BRepBuilderAPI_Copy(shape).Shape();
    TopTools_IndexedMapOfShape map;
    TopExp::MapShapes(work, TopAbs_FACE, map);
    TopTools_IndexedDataMapOfShapeListOfShape owners;
    TopExp::MapShapesAndAncestors(work, TopAbs_EDGE, TopAbs_FACE, owners);
    Handle(BRepTools_ReShape) rs = new BRepTools_ReShape();
    for (int32_t index : faces) {
      if (index < 0 || index >= map.Extent()) throw std::out_of_range("that face no longer exists");
      TopoDS_Face f = TopoDS::Face(map(index + 1));
      W3dSplineFace sf = w3d_spline_face(f);
      Handle(Geom_BSplineSurface) made = Handle(Geom_BSplineSurface)::DownCast(sf.surface->Copy());
      if (made->NbUPoles() * made->NbVPoles() > 4096) throw std::runtime_error("that face already has as many control points as it can take");
      std::vector<double> us, vs;
      for (int i = 1; i < made->NbUKnots(); i++) us.push_back((made->UKnot(i) + made->UKnot(i + 1)) / 2);
      for (int i = 1; i < made->NbVKnots(); i++) vs.push_back((made->VKnot(i) + made->VKnot(i + 1)) / 2);
      for (double u : us) made->InsertUKnot(u, 1, Precision::PConfusion(), true);
      for (double v : vs) made->InsertVKnot(v, 1, Precision::PConfusion(), true);
      rs->Replace(f, w3d_face_on_spline(f, sf, made, owners));
    }
    TopoDS_Shape result = rs->Apply(work);
    BRepLib::UpdateTolerances(result, false);
    if (!w3d_is_valid(result)) throw std::runtime_error("the subdivided face is not valid");
    return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(result));
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// Whether two faces lie on one surface (two halves of a cylinder, say), for the analytic kinds.
inline bool w3d_same_surface(const TopoDS_Face &a, const TopoDS_Face &b) {
  BRepAdaptor_Surface sa(a), sb(b);
  if (sa.GetType() != sb.GetType()) return false;
  auto coaxial = [](const gp_Ax1 &x, const gp_Ax1 &y) {
    return x.IsCoaxial(y, 1e-6, 1e-6) || x.IsCoaxial(y.Reversed(), 1e-6, 1e-6);
  };
  switch (sa.GetType()) {
  case GeomAbs_Cylinder: return std::abs(sa.Cylinder().Radius() - sb.Cylinder().Radius()) < 1e-6 && coaxial(sa.Cylinder().Axis(), sb.Cylinder().Axis());
  case GeomAbs_Sphere: return std::abs(sa.Sphere().Radius() - sb.Sphere().Radius()) < 1e-6 && sa.Sphere().Location().Distance(sb.Sphere().Location()) < 1e-6;
  case GeomAbs_Torus: return std::abs(sa.Torus().MinorRadius() - sb.Torus().MinorRadius()) < 1e-6 && std::abs(sa.Torus().MajorRadius() - sb.Torus().MajorRadius()) < 1e-6 && coaxial(sa.Torus().Axis(), sb.Torus().Axis());
  case GeomAbs_Plane: return sa.Plane().Position().IsCoplanar(sb.Plane().Position(), 1e-6, 1e-6);
  default: return false;
  }
}

// The rolling radius of a round face, or -1 when its surface has no single one.
inline double w3d_round_radius(const TopoDS_Face &f) {
  BRepAdaptor_Surface s(f);
  switch (s.GetType()) {
  case GeomAbs_Cylinder: return s.Cylinder().Radius();
  case GeomAbs_Sphere: return s.Sphere().Radius();
  case GeomAbs_Torus: return s.Torus().MinorRadius();
  default: return -1;
  }
}

// Numbers of the faces that look like fillets: curved faces running smoothly into at least two
// other faces. A curved face whose smooth neighbours are all curved counts only when it is no
// wider than they are (a corner ball counts; a cylinder rounded at both ends does not). With
// `seeds`, only the fillet chains (fillets meeting smoothly) holding those faces.
inline rust::Vec<int32_t> w3d_fillet_faces(const TopoDS_Shape &shape, rust::Slice<const int32_t> seeds) {
  TopTools_IndexedMapOfShape faces;
  TopExp::MapShapes(shape, TopAbs_FACE, faces);
  TopTools_IndexedDataMapOfShapeListOfShape owners;
  TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, owners);
  const int n = faces.Extent();
  std::vector<bool> curved(n);
  for (int i = 0; i < n; i++) curved[i] = BRepAdaptor_Surface(TopoDS::Face(faces(i + 1))).GetType() != GeomAbs_Plane;
  // Smooth neighbours of each face, as face numbers.
  std::vector<std::set<int>> smooth(n);
  for (int i = 1; i <= owners.Extent(); i++) {
    const TopoDS_Edge &e = TopoDS::Edge(owners.FindKey(i));
    if (BRep_Tool::Degenerated(e)) continue;
    std::vector<TopoDS_Face> fs;
    for (TopTools_ListIteratorOfListOfShape it(owners(i)); it.More(); it.Next()) fs.push_back(TopoDS::Face(it.Value()));
    if (fs.size() != 2) continue;
    int a = faces.FindIndex(fs[0]) - 1, b = faces.FindIndex(fs[1]) - 1;
    if (a < 0 || b < 0 || a == b || w3d_same_surface(fs[0], fs[1])) continue;
    if (!w3d_tangent_along(e, fs[0], fs[1])) continue;
    smooth[a].insert(b);
    smooth[b].insert(a);
  }
  std::vector<bool> fillet(n, false);
  for (int i = 0; i < n; i++) {
    if (!curved[i] || smooth[i].size() < 2) continue;
    bool flatNeighbour = false;
    double least = 1e300;
    for (int j : smooth[i]) {
      if (!curved[j]) flatNeighbour = true;
      double r = w3d_round_radius(TopoDS::Face(faces(j + 1)));
      if (r > 0) least = std::min(least, r);
    }
    double r = w3d_round_radius(TopoDS::Face(faces(i + 1)));
    fillet[i] = flatNeighbour || (r > 0 && r <= least + 1e-6);
  }
  std::vector<bool> keep(n, seeds.empty());
  if (!seeds.empty()) {
    std::vector<int> todo;
    for (int32_t s : seeds) if (s >= 0 && s < n && fillet[s] && !keep[s]) { keep[s] = true; todo.push_back(s); }
    while (!todo.empty()) {
      int i = todo.back();
      todo.pop_back();
      for (int j : smooth[i]) if (fillet[j] && !keep[j]) { keep[j] = true; todo.push_back(j); }
    }
  }
  rust::Vec<int32_t> out;
  for (int i = 0; i < n; i++) if (fillet[i] && keep[i]) out.push_back(i);
  return out;
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
// a cylinder its whole round `size` each way along the axis, any other face its surface carried on
// `size` past its sides.
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
    else {
      // A free-form face: its surface carried straight on `size` past each side it has (closed
      // directions stay as they are), as Plasticity cuts by a surface's extension.
      TopLoc_Location loc;
      Handle(Geom_Surface) gs = BRep_Tool::Surface(face, loc);
      double u0, u1, v0, v1;
      BRepTools::UVBounds(face, u0, u1, v0, v1);
      Handle(Geom_BSplineSurface) wide = GeomConvert::SurfaceToBSplineSurface(new Geom_RectangularTrimmedSurface(gs, u0, u1, v0, v1));
      for (int side = 0; side < 4 && !wide.IsNull(); side++) {
        const bool inU = side < 2;
        if (inU ? wide->IsUClosed() : wide->IsVClosed()) continue;
        // A side shrunk to a point (a sphere's pole) has nothing to carry on.
        const int row = inU ? (side == 0 ? 1 : wide->NbUPoles()) : (side == 2 ? 1 : wide->NbVPoles());
        const int n = inU ? wide->NbVPoles() : wide->NbUPoles();
        double spread = 0.0;
        for (int j = 2; j <= n; j++) spread = std::max(spread, (inU ? wide->Pole(row, j) : wide->Pole(j, row)).Distance(inU ? wide->Pole(row, 1) : wide->Pole(1, row)));
        if (spread < 1e-7) continue;
        Handle(Geom_BoundedSurface) g = wide;
        GeomLib::ExtendSurfByLength(g, size, 1, inU, side % 2 == 1);
        wide = Handle(Geom_BSplineSurface)::DownCast(g);
      }
      if (wide.IsNull()) out = face;
      else {
        if (!loc.IsIdentity()) wide->Transform(loc.Transformation());
        BRepBuilderAPI_MakeFace mk(wide, 1e-7);
        out = mk.IsDone() ? TopoDS_Shape(mk.Face()) : TopoDS_Shape(face);
      }
    }
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

// A sheet of one B-spline surface given as numbers: u and v degrees, pole counts nu and nv, flat
// knot counts (with repeats), the flat u then v knots, then nu * nv poles (x, y, z), rows along u.
inline std::unique_ptr<TopoDS_Shape> w3d_spline_sheet(rust::Slice<const double> data) {
  if (data.size() < 6) throw std::runtime_error("the surface data is short");
  const int du = int(data[0]), dv = int(data[1]), nu = int(data[2]), nv = int(data[3]), nku = int(data[4]), nkv = int(data[5]);
  if (du < 1 || dv < 1 || nu <= du || nv <= dv || nku != nu + du + 1 || nkv != nv + dv + 1 || data.size() != size_t(6 + nku + nkv + 3 * nu * nv))
    throw std::runtime_error("the surface data does not add up");
  // Flat knots to distinct knots and multiplicities.
  auto distinct = [&](size_t from, int count, TColStd_Array1OfReal *&k, TColStd_Array1OfInteger *&m) {
    std::vector<double> ks; std::vector<int> ms;
    for (int i = 0; i < count; i++) {
      const double x = data[from + i];
      if (!ks.empty() && std::abs(x - ks.back()) < 1e-12) ms.back()++;
      else { ks.push_back(x); ms.push_back(1); }
    }
    k = new TColStd_Array1OfReal(1, int(ks.size()));
    m = new TColStd_Array1OfInteger(1, int(ks.size()));
    for (size_t i = 0; i < ks.size(); i++) { k->SetValue(int(i) + 1, ks[i]); m->SetValue(int(i) + 1, ms[i]); }
  };
  TColStd_Array1OfReal *uk = nullptr, *vk = nullptr;
  TColStd_Array1OfInteger *um = nullptr, *vm = nullptr;
  distinct(6, nku, uk, um);
  distinct(6 + nku, nkv, vk, vm);
  std::unique_ptr<TColStd_Array1OfReal> ukp(uk), vkp(vk);
  std::unique_ptr<TColStd_Array1OfInteger> ump(um), vmp(vm);
  TColgp_Array2OfPnt poles(1, nu, 1, nv);
  const size_t at = 6 + nku + nkv;
  for (int i = 0; i < nu; i++)
    for (int j = 0; j < nv; j++) {
      const size_t k = at + 3 * (size_t(i) * nv + j);
      poles.SetValue(i + 1, j + 1, gp_Pnt(data[k], data[k + 1], data[k + 2]));
    }
  try {
    Handle(Geom_BSplineSurface) surface = new Geom_BSplineSurface(poles, *uk, *vk, *um, *vm, du, dv);
    BRepBuilderAPI_MakeFace mk(surface, 1e-7);
    if (!mk.IsDone()) throw std::runtime_error("the surface could not be made into a sheet");
    return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(mk.Face()));
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

// Plasticity's Isoparam: the curve on face `face` of `shape` through `point` along which one
// surface parameter stays put: v when `along_u` (the curve runs along u), else u. It is cut to the
// face, and of the pieces the face leaves, the one nearest the point is kept.
inline rust::Vec<double> w3d_isoparam(const TopoDS_Shape &shape, int32_t face, rust::Slice<const double> point, bool along_u) {
  if (point.size() != 3) throw std::runtime_error("the point needs three numbers");
  try {
    TopTools_IndexedMapOfShape faces;
    TopExp::MapShapes(shape, TopAbs_FACE, faces);
    if (face < 0 || face >= faces.Extent()) throw std::out_of_range("that face no longer exists");
    TopoDS_Face f = TopoDS::Face(faces(face + 1));
    f.Orientation(TopAbs_FORWARD);
    Handle(Geom_Surface) s = BRep_Tool::Surface(f);
    gp_Pnt p(point[0], point[1], point[2]);
    GeomAPI_ProjectPointOnSurf proj(p, s);
    if (!proj.NbPoints()) throw std::runtime_error("that point is not on the face");
    Standard_Real u, v, u0, u1, v0, v1;
    proj.LowerDistanceParameters(u, v);
    BRepTools::UVBounds(f, u0, u1, v0, v1);
    Handle(Geom_Curve) iso = along_u ? s->VIso(v) : s->UIso(u);
    double a = along_u ? u0 : v0, b = along_u ? u1 : v1;
    if (!iso->IsPeriodic()) { a = std::max(a, iso->FirstParameter()); b = std::min(b, iso->LastParameter()); }
    if (b - a < 1e-9) throw std::runtime_error("the face is too thin there for an isoparam");
    TopoDS_Edge whole = BRepBuilderAPI_MakeEdge(iso, a, b);
    std::vector<TopoDS_Edge> pieces;
    BRepAlgoAPI_Common common(whole, f);
    if (common.IsDone() && !common.HasErrors())
      for (TopExp_Explorer ex(common.Shape(), TopAbs_EDGE); ex.More(); ex.Next()) pieces.push_back(TopoDS::Edge(ex.Current()));
    if (pieces.empty()) pieces.push_back(whole);
    // Pieces that meet end to end are one run; keep the run nearest the point.
    Handle(TopTools_HSequenceOfShape) in = new TopTools_HSequenceOfShape(), wires;
    for (const auto &e : pieces) in->Append(e);
    ShapeAnalysis_FreeBounds::ConnectEdgesToWires(in, 1e-5, Standard_False, wires);
    TopoDS_Vertex at = BRepBuilderAPI_MakeVertex(p);
    int best = 0;
    double least = 1e300;
    for (int i = 1; i <= wires->Length(); i++) {
      BRepExtrema_DistShapeShape d(at, wires->Value(i));
      if (d.IsDone() && d.Value() < least) { least = d.Value(); best = i; }
    }
    if (!best) throw std::runtime_error("the isoparam could not be found there");
    std::vector<TopoDS_Edge> kept;
    for (TopExp_Explorer ex(wires->Value(best), TopAbs_EDGE); ex.More(); ex.Next()) kept.push_back(TopoDS::Edge(ex.Current()));
    return w3d_curves_out(kept);
  } catch (const Standard_Failure &e) {
    throw w3d_kernel_error(e);
  }
}

// Deform's face coordinates on face `face` of `shape`: (s, t, n), s and t the face's u and v scaled
// to 0..1 over its bounds, n the distance along its outward normal.
struct W3dFaceMap {
  TopoDS_Face f;
  Handle(Geom_Surface) surface;
  BRepAdaptor_Surface ad;
  double u0 = 0, u1 = 1, v0 = 0, v1 = 1;
  bool back = false;

  W3dFaceMap(const TopoDS_Shape &shape, int32_t face) {
    TopTools_IndexedMapOfShape faces;
    TopExp::MapShapes(shape, TopAbs_FACE, faces);
    if (face < 0 || face >= faces.Extent()) throw std::out_of_range("that face no longer exists");
    f = TopoDS::Face(faces(face + 1));
    back = f.Orientation() == TopAbs_REVERSED;
    ad.Initialize(f, Standard_True);
    BRepTools::UVBounds(f, u0, u1, v0, v1);
    if (!(u1 - u0 > 1e-12) || !(v1 - v0 > 1e-12)) throw std::runtime_error("that face has no area");
    surface = BRep_Tool::Surface(f);
  }

  void frame(double u, double v, gp_Pnt &p, gp_Vec &n) const {
    gp_Vec du, dv;
    ad.D1(u, v, p, du, dv);
    n = du.Crossed(dv);
    if (n.Magnitude() < 1e-14) {
      // A pole of the surface: step in a little to find which way it faces.
      gp_Pnt q;
      ad.D1(u + (u1 - u0) * 1e-6, v + (v1 - v0) * 1e-6, q, du, dv);
      n = du.Crossed(dv);
    }
    if (n.Magnitude() < 1e-14) throw std::runtime_error("the face has no normal there");
    n.Normalize();
    if (back) n.Reverse();
  }

  // The face's length along u (or v) through its middle, in mm.
  double length(bool along_u) const {
    double total = 0;
    gp_Pnt last;
    for (int i = 0; i <= 64; i++) {
      double a = i / 64.0;
      gp_Pnt p = along_u ? ad.Value(u0 + (u1 - u0) * a, (v0 + v1) / 2) : ad.Value((u0 + u1) / 2, v0 + (v1 - v0) * a);
      if (i) total += p.Distance(last);
      last = p;
    }
    return total;
  }

  gp_XYZ uvn(const gp_Pnt &q) const {
    GeomAPI_ProjectPointOnSurf proj(q, surface);
    if (!proj.NbPoints()) throw std::runtime_error("that does not lie over the reference face");
    Standard_Real u, v;
    proj.LowerDistanceParameters(u, v);
    gp_Pnt p;
    gp_Vec n;
    frame(u, v, p, n);
    return gp_XYZ((u - u0) / (u1 - u0), (v - v0) / (v1 - v0), gp_Vec(p, q).Dot(n));
  }

  gp_Pnt at(const gp_XYZ &stn) const {
    gp_Pnt p;
    gp_Vec n;
    frame(u0 + (u1 - u0) * stn.X(), v0 + (v1 - v0) * stn.Y(), p, n);
    return p.Translated(n * stn.Z());
  }
};

// Deform Curve's face coordinates (see W3dFaceMap): with `map`, `data` holds (s, t, n) triples
// and the points come back; without, `data` holds points and their (s, t, n) come back. Either way
// the result starts with the face's length along u and along v through its middle, in mm.
inline rust::Vec<double> w3d_face_uvn(const TopoDS_Shape &shape, int32_t face, bool map, rust::Slice<const double> data) {
  if (data.size() % 3) throw std::runtime_error("the points need three numbers each");
  try {
    W3dFaceMap m(shape, face);
    rust::Vec<double> out;
    out.push_back(m.length(true));
    out.push_back(m.length(false));
    for (size_t i = 0; i < data.size(); i += 3) {
      gp_XYZ r = map ? m.at(gp_XYZ(data[i], data[i + 1], data[i + 2])).XYZ() : m.uvn(gp_Pnt(data[i], data[i + 1], data[i + 2]));
      out.push_back(r.X()); out.push_back(r.Y()); out.push_back(r.Z());
    }
    return out;
  } catch (const Standard_Failure &e) {
    throw w3d_kernel_error(e);
  }
}

// Align Surface: the faces along edge `index` of `shape`. [count, then per face: its number, a point
// in its middle (3), then 1 and its control surface as w3d_face_poles gives it (du, dv, nu, nv, the
// counts of u and v knots, the knots spelled out, 1 if rational, the poles u slowest) or 0, then
// per point of `data` (x, y, z each) projected onto the face's surface: the point, Su, Sv, Suu, Suv,
// Svv and the face's orientation (1 or -1)]. web/src/alignSurface.js reads it.
inline rust::Vec<double> w3d_edge_faces(const TopoDS_Shape &shape, int32_t index, rust::Slice<const double> data) {
  if (data.size() % 3) throw std::runtime_error("the points need three numbers each");
  TopTools_IndexedMapOfShape edges, faces;
  TopExp::MapShapes(shape, TopAbs_EDGE, edges);
  TopExp::MapShapes(shape, TopAbs_FACE, faces);
  if (index < 0 || index >= edges.Extent()) throw std::out_of_range("that edge no longer exists");
  const TopoDS_Shape e = edges(index + 1);
  rust::Vec<double> out;
  out.push_back(0);
  auto put = [&](const gp_XYZ &v) { out.push_back(v.X()); out.push_back(v.Y()); out.push_back(v.Z()); };
  try {
    for (int i = 1; i <= faces.Extent(); i++) {
      const TopoDS_Face f = TopoDS::Face(faces(i));
      bool on = false;
      for (TopExp_Explorer ex(f, TopAbs_EDGE); ex.More() && !on; ex.Next()) on = ex.Current().IsSame(e);
      if (!on) continue;
      out[0] += 1;
      out.push_back(i - 1);
      BRepAdaptor_Surface ad(f, true);
      double u0, u1, v0, v1;
      BRepTools::UVBounds(f, u0, u1, v0, v1);
      put(ad.Value((u0 + u1) / 2, (v0 + v1) / 2).XYZ());
      bool spline = false;
      try {
        W3dSplineFace sf = w3d_spline_face(f);
        const Handle(Geom_BSplineSurface) &b = sf.surface;
        out.push_back(1);
        out.push_back(b->UDegree()); out.push_back(b->VDegree());
        out.push_back(b->NbUPoles()); out.push_back(b->NbVPoles());
        TColStd_Array1OfReal uk(1, b->NbUPoles() + b->UDegree() + 1), vk(1, b->NbVPoles() + b->VDegree() + 1);
        b->UKnotSequence(uk);
        b->VKnotSequence(vk);
        out.push_back(uk.Length()); out.push_back(vk.Length());
        for (int k = uk.Lower(); k <= uk.Upper(); k++) out.push_back(uk(k));
        for (int k = vk.Lower(); k <= vk.Upper(); k++) out.push_back(vk(k));
        out.push_back(b->IsURational() || b->IsVRational() ? 1 : 0);
        for (int a = 1; a <= b->NbUPoles(); a++) for (int c = 1; c <= b->NbVPoles(); c++) put(b->Pole(a, c).Transformed(sf.loc.Transformation()).XYZ());
        spline = true;
      } catch (const std::exception &) {
      } catch (const Standard_Failure &) {
      }
      if (!spline) out.push_back(0);
      const double sign = f.Orientation() == TopAbs_REVERSED ? -1 : 1;
      for (size_t k = 0; k < data.size(); k += 3) {
        // Project in the face's own frame, then evaluate where the face sits.
        TopLoc_Location loc;
        Handle(Geom_Surface) gs = BRep_Tool::Surface(f, loc);
        gp_Pnt q(data[k], data[k + 1], data[k + 2]);
        if (!loc.IsIdentity()) q.Transform(loc.Transformation().Inverted());
        GeomAPI_ProjectPointOnSurf pr(q, gs);
        if (!pr.NbPoints()) throw std::runtime_error("the reference face could not be found under the edge");
        double u, v;
        pr.LowerDistanceParameters(u, v);
        gp_Pnt p;
        gp_Vec du, dv, duu, dvv, duv;
        ad.D2(u, v, p, du, dv, duu, dvv, duv);
        put(p.XYZ()); put(du.XYZ()); put(dv.XYZ()); put(duu.XYZ()); put(duv.XYZ()); put(dvv.XYZ());
        out.push_back(sign);
      }
    }
    return out;
  } catch (const Standard_Failure &err) {
    throw w3d_kernel_error(err);
  }
}

// Deform Solid and Sheet's warp: each B-spline pole carried from the reference face's coordinates
// to the target's, after the shapes are refined enough (cubic, 16 spans each way) for the poles to
// follow the warp closely. Parameters are kept, so the faces' curves stay as they were.
class W3dDeform : public BRepTools_Modification {
public:
  std::function<gp_Pnt(const gp_Pnt &)> warp;

  static void refine(const Handle(Geom_BSplineSurface) &b) {
    b->IncreaseDegree(std::max(3, b->UDegree()), std::max(3, b->VDegree()));
    for (int dir = 0; dir < 2; dir++) {
      const bool u = dir == 0;
      double a, c, d, e;
      b->Bounds(a, c, d, e);
      const double lo = u ? a : d, hi = u ? c : e;
      for (int i = 1; i < 16; i++) {
        double k = lo + (hi - lo) * i / 16;
        if (u) b->InsertUKnot(k, 1, 1e-9, Standard_False); else b->InsertVKnot(k, 1, 1e-9, Standard_False);
      }
    }
  }

  Standard_Boolean NewSurface(const TopoDS_Face &F, Handle(Geom_Surface) &S, TopLoc_Location &L, Standard_Real &Tol,
                              Standard_Boolean &RevWires, Standard_Boolean &RevFace) override {
    TopLoc_Location loc;
    Handle(Geom_BSplineSurface) b = Handle(Geom_BSplineSurface)::DownCast(BRep_Tool::Surface(F, loc));
    if (b.IsNull()) throw std::runtime_error("a face could not be turned into control points to deform");
    b = Handle(Geom_BSplineSurface)::DownCast(b->Copy());
    refine(b);
    const gp_Trsf t = loc.Transformation();
    for (int i = 1; i <= b->NbUPoles(); i++)
      for (int j = 1; j <= b->NbVPoles(); j++) b->SetPole(i, j, warp(b->Pole(i, j).Transformed(t)));
    S = b;
    L = TopLoc_Location();
    Tol = BRep_Tool::Tolerance(F);
    RevWires = RevFace = Standard_False;
    return Standard_True;
  }

  Standard_Boolean NewCurve(const TopoDS_Edge &E, Handle(Geom_Curve) &C, TopLoc_Location &L, Standard_Real &Tol) override {
    Standard_Real f, l;
    TopLoc_Location loc;
    Handle(Geom_Curve) g = BRep_Tool::Curve(E, loc, f, l);
    if (g.IsNull()) return Standard_False;
    Handle(Geom_BSplineCurve) b = Handle(Geom_BSplineCurve)::DownCast(g);
    if (b.IsNull()) throw std::runtime_error("an edge could not be turned into control points to deform");
    b = Handle(Geom_BSplineCurve)::DownCast(b->Copy());
    b->IncreaseDegree(std::max(3, b->Degree()));
    const double lo = b->FirstParameter(), hi = b->LastParameter();
    for (int i = 1; i < 16; i++) b->InsertKnot(lo + (hi - lo) * i / 16, 1, 1e-9, Standard_False);
    const gp_Trsf t = loc.Transformation();
    for (int i = 1; i <= b->NbPoles(); i++) b->SetPole(i, warp(b->Pole(i).Transformed(t)));
    C = b;
    L = TopLoc_Location();
    Tol = BRep_Tool::Tolerance(E);
    return Standard_True;
  }

  Standard_Boolean NewPoint(const TopoDS_Vertex &V, gp_Pnt &P, Standard_Real &Tol) override {
    P = warp(BRep_Tool::Pnt(V));
    Tol = BRep_Tool::Tolerance(V);
    return Standard_True;
  }

  Standard_Boolean NewCurve2d(const TopoDS_Edge &E, const TopoDS_Face &F, const TopoDS_Edge &, const TopoDS_Face &,
                              Handle(Geom2d_Curve) &C, Standard_Real &Tol) override {
    Standard_Real f, l;
    Handle(Geom2d_Curve) c = BRep_Tool::CurveOnSurface(E, F, f, l);
    if (c.IsNull()) return Standard_False;
    C = Handle(Geom2d_Curve)::DownCast(c->Copy());
    Tol = BRep_Tool::Tolerance(E);
    return Standard_True;
  }

  Standard_Boolean NewParameter(const TopoDS_Vertex &V, const TopoDS_Edge &E, Standard_Real &P, Standard_Real &Tol) override {
    P = BRep_Tool::Parameter(V, E);
    Tol = BRep_Tool::Tolerance(V);
    return Standard_True;
  }

  GeomAbs_Shape Continuity(const TopoDS_Edge &E, const TopoDS_Face &F1, const TopoDS_Face &F2, const TopoDS_Edge &,
                           const TopoDS_Face &, const TopoDS_Face &) override {
    return BRep_Tool::Continuity(E, F1, F2);
  }
};

// Deform's Reblend, first half: `shape` with its fillets taken off (see w3d_fillet_faces), so the
// faces they joined meet at sharp edges again; each such edge comes back in `blends` with the
// radius of the fillet that was there. Only fillets of one radius can be made again.
inline TopoDS_Shape w3d_unblend(const TopoDS_Shape &shape, std::vector<std::pair<TopoDS_Edge, double>> &blends) {
  rust::Vec<int32_t> rounds = w3d_fillet_faces(shape, rust::Slice<const int32_t>());
  if (rounds.empty()) return shape;
  TopTools_IndexedMapOfShape map;
  TopExp::MapShapes(shape, TopAbs_FACE, map);
  TopTools_IndexedDataMapOfShapeListOfShape before;
  TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, before);
  TopTools_MapOfShape removed;
  std::vector<std::pair<TopoDS_Face, double>> fillets;
  for (int32_t f : rounds) {
    TopoDS_Face face = TopoDS::Face(map(f + 1));
    double r = w3d_round_radius(face);
    if (r <= 0) throw std::runtime_error("reblend makes fillets of one radius again, and this body has one whose radius changes; turn Reblend off");
    removed.Add(face);
    fillets.push_back({face, r});
  }
  // The faces the fillets touch, which of them already shared an edge, and each fillet's.
  TopTools_IndexedMapOfShape near;
  std::vector<std::set<int>> touches(fillets.size());
  for (size_t i = 0; i < fillets.size(); i++)
    for (TopExp_Explorer ex(fillets[i].first, TopAbs_EDGE); ex.More(); ex.Next())
      for (TopTools_ListOfShape::Iterator g(before.FindFromKey(ex.Current())); g.More(); g.Next())
        if (!removed.Contains(g.Value())) touches[i].insert(near.Add(g.Value()));
  std::set<std::pair<int, int>> touching;
  for (int i = 1; i <= before.Extent(); i++) {
    std::vector<int> ids;
    for (TopTools_ListOfShape::Iterator g(before(i)); g.More(); g.Next()) { int k = near.FindIndex(g.Value()); if (k) ids.push_back(k); }
    for (size_t a = 0; a < ids.size(); a++) for (size_t b = a + 1; b < ids.size(); b++) touching.insert({std::min(ids[a], ids[b]), std::max(ids[a], ids[b])});
  }
  BRepAlgoAPI_Defeaturing df;
  df.SetShape(shape);
  for (TopTools_MapOfShape::Iterator it(removed); it.More(); it.Next()) df.AddFaceToRemove(it.Value());
  df.SetToFillHistory(Standard_True);
  df.Build();
  if (!df.IsDone() || df.HasErrors() || df.Shape().IsNull())
    throw std::runtime_error("the faces around the fillets can't grow back to edges, so they can't be reblended; turn Reblend off");
  TopoDS_Shape sharp = df.Shape();
  TopTools_DataMapOfShapeInteger from;
  for (int k = 1; k <= near.Extent(); k++) {
    if (df.IsDeleted(near(k))) continue;
    const TopTools_ListOfShape &m = df.Modified(near(k));
    if (m.IsEmpty()) from.Bind(near(k), k);
    else for (TopTools_ListOfShape::Iterator it(m); it.More(); it.Next()) from.Bind(it.Value(), k);
  }
  TopTools_IndexedDataMapOfShapeListOfShape after;
  TopExp::MapShapesAndAncestors(sharp, TopAbs_EDGE, TopAbs_FACE, after);
  for (int i = 1; i <= after.Extent(); i++) {
    const TopTools_ListOfShape &fs = after(i);
    if (fs.Extent() != 2 || !from.IsBound(fs.First()) || !from.IsBound(fs.Last())) continue;
    int ia = from(fs.First()), ib = from(fs.Last());
    if (ia == ib || touching.count({std::min(ia, ib), std::max(ia, ib)})) continue;
    for (size_t k = 0; k < fillets.size(); k++)
      if (touches[k].count(ia) && touches[k].count(ib)) { blends.push_back({TopoDS::Edge(after.FindKey(i)), fillets[k].second}); break; }
  }
  return sharp;
}

// Plasticity's Deform Solid and Sheet: each child of `bodies` (a compound) wrapped from face `rface`
// of `ref` onto face `tface` of `target`, each point keeping its (s, t, n) coordinates (see
// W3dFaceMap) after `opts` move them: scale u, v, n (about the middle of all the bodies), offset u,
// v (mm along the target) and n (mm), then mirror, swap u and v, and turn the normal over (1 or 0),
// and optionally reblend (1 or 0): fillets taken off before the warp and made again after it at
// their radius, so they stay round rather than stretched. Returns a compound of the results in the same order.
inline std::unique_ptr<TopoDS_Shape> w3d_deform(const TopoDS_Shape &bodies, const TopoDS_Shape &ref, int32_t rface,
                                                const TopoDS_Shape &target, int32_t tface, rust::Slice<const double> opts) {
  if (opts.size() != 9 && opts.size() != 10) throw std::runtime_error("deform takes nine or ten options");
  const bool reblend = opts.size() == 10 && opts[9] != 0;
  try {
    W3dFaceMap from(ref, rface), to(target, tface);
    const bool mirror = opts[6] != 0, swap = opts[7] != 0, normal = opts[8] != 0;
    auto flip = [&](gp_XYZ c) {
      if (swap) c = gp_XYZ(c.Y(), c.X(), c.Z());
      if (mirror) c.SetX(1 - c.X());
      return c;
    };
    // The middle of the bodies on the reference, from their vertices and points along their edges.
    double lo[2] = {1e300, 1e300}, hi[2] = {-1e300, -1e300};
    auto grow = [&](const gp_Pnt &p) {
      gp_XYZ c = flip(from.uvn(p));
      lo[0] = std::min(lo[0], c.X()); hi[0] = std::max(hi[0], c.X());
      lo[1] = std::min(lo[1], c.Y()); hi[1] = std::max(hi[1], c.Y());
    };
    for (TopExp_Explorer ex(bodies, TopAbs_EDGE); ex.More(); ex.Next()) {
      const TopoDS_Edge &e = TopoDS::Edge(ex.Current());
      if (BRep_Tool::Degenerated(e)) continue;
      BRepAdaptor_Curve c(e);
      for (int i = 0; i <= 4; i++) grow(c.Value(c.FirstParameter() + (c.LastParameter() - c.FirstParameter()) * i / 4));
    }
    if (lo[0] > hi[0]) throw std::runtime_error("select the solids or sheets to deform");
    const double cs = (lo[0] + hi[0]) / 2, ct = (lo[1] + hi[1]) / 2;
    const double lu = to.length(true), lv = to.length(false);
    const double du = lu > 1e-12 ? opts[3] / lu : 0, dv = lv > 1e-12 ? opts[4] / lv : 0;
    W3dDeform *mod = new W3dDeform();
    Handle(BRepTools_Modification) keep(mod);
    mod->warp = [&](const gp_Pnt &p) {
      gp_XYZ c = flip(from.uvn(p));
      return to.at(gp_XYZ(cs + (c.X() - cs) * opts[0] + du, ct + (c.Y() - ct) * opts[1] + dv, (normal ? -c.Z() : c.Z()) * opts[2] + opts[5]));
    };
    BRep_Builder b;
    TopoDS_Compound out;
    b.MakeCompound(out);
    for (TopoDS_Iterator it(bodies); it.More(); it.Next()) {
      std::vector<std::pair<TopoDS_Edge, double>> blends;
      const TopoDS_Shape body = reblend ? w3d_unblend(it.Value(), blends) : it.Value();
      BRepBuilderAPI_NurbsConvert nurbs(body, Standard_True);
      if (!nurbs.IsDone()) throw std::runtime_error("a body could not be turned into control points to deform");
      BRepTools_Modifier m(nurbs.Shape(), keep);
      if (!m.IsDone()) throw std::runtime_error("the body could not be deformed");
      TopoDS_Shape made = m.ModifiedShape(nurbs.Shape());
      BRepLib::SameParameter(made, 1e-5, Standard_True);
      Handle(ShapeFix_Shape) fix;
      if (!BRepCheck_Analyzer(made).IsValid()) {
        fix = new ShapeFix_Shape(made);
        fix->Perform();
        made = fix->Shape();
      }
      if (!BRepCheck_Analyzer(made).IsValid()) throw std::runtime_error("the deformed body is not valid; try a flatter target, or Unwrap Face of the target as the reference");
      // Reblend: the sharp edges, followed through the warp, filleted again at their radius.
      if (!blends.empty()) {
        BRepFilletAPI_MakeFillet mk(made);
        int added = 0;
        for (const auto &blend : blends) {
          const double r = blend.second;
          TopoDS_Shape now = m.ModifiedShape(nurbs.ModifiedShape(blend.first));
          if (!fix.IsNull()) now = fix->Context()->Apply(now);
          for (TopExp_Explorer ex(now, TopAbs_EDGE); ex.More(); ex.Next()) { mk.Add(r, TopoDS::Edge(ex.Current())); added++; }
        }
        if (added) {
          mk.Build();
          if (!mk.IsDone() || mk.Shape().IsNull() || !w3d_is_valid(mk.Shape()))
            throw std::runtime_error("the fillets could not be made again on the deformed body; turn Reblend off");
          made = mk.Shape();
        }
      }
      // A warp that turns the space over (a mirror or a flipped normal) turns solids inside out.
      if (TopExp_Explorer(made, TopAbs_SOLID).More()) {
        GProp_GProps g;
        BRepGProp::VolumeProperties(made, g);
        if (g.Mass() < 0) made.Reverse();
      }
      b.Add(out, made);
    }
    return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(out));
  } catch (const Standard_Failure &e) {
    throw w3d_kernel_error(e);
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
    // Round the plane's origin, out past the farthest line (the body need not sit over the origin).
    double size = 0.0;
    for (double x : {x0, x1}) for (double y : {y0, y1}) for (double z : {z0, z1}) size = std::max(size, frame.Location().Distance(gp_Pnt(x, y, z)));
    size += 10.0;
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
      // Find a point inside the piece: a grid over its own (u, v) bounds until the classifier says IN.
      double u0, u1, v0, v1;
      BRepTools::UVBounds(f, u0, u1, v0, v1);
      Handle(Geom_Surface) surf = BRep_Tool::Surface(f);
      bool found = false;
      gp_Pnt inside;
      for (int k = 1; k < 24 && !found; k++) {
        for (int i = 1; i < 2 * k && !found; i++) for (int j = 1; j < 2 * k && !found; j++) {
          gp_Pnt2d uv(u0 + (u1 - u0) * i / (2.0 * k), v0 + (v1 - v0) * j / (2.0 * k));
          BRepClass_FaceClassifier cls(f, uv, 1e-7);
          if (cls.State() == TopAbs_IN) { inside = surf->Value(uv.X(), uv.Y()); found = true; }
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

// Plasticity's Thicken: a sheet made solid, `front` along its faces' normals and `back` behind
// them. The sheet is first moved back, then grown by the whole thickness with walls along its
// open edges (the simple offset: each face moves along its own normal, so smooth sheets join
// cleanly and the walls are ruled between each edge and its image).
inline std::unique_ptr<TopoDS_Shape> w3d_thicken(const TopoDS_Shape &shape, double front, double back) {
  if (!std::isfinite(front) || !std::isfinite(back)) throw std::runtime_error("the thickness is not a number");
  if (front < 0.0 || back < 0.0) throw std::runtime_error("the thicknesses can't be below zero; swap front and back instead");
  if (front + back < 1e-6) throw std::runtime_error("the sheet needs a thickness");
  if (w3d_solid_count(shape) != 0) throw std::runtime_error("thicken sheets; that body is already solid");
  TopTools_IndexedMapOfShape faces;
  TopExp::MapShapes(shape, TopAbs_FACE, faces);
  if (faces.IsEmpty()) throw std::runtime_error("that body has no faces to thicken");
  try {
    TopoDS_Shape base = shape;
    if (back > 0.0) {
      BRepOffsetAPI_MakeOffsetShape off;
      off.PerformBySimple(shape, -back);
      if (!off.IsDone() || off.Shape().IsNull()) throw std::runtime_error("the sheet can't be moved that far back; try a thinner back");
      base = off.Shape();
    }
    // Faces meeting at an angle need their offsets joined (the simple offset leaves the corner
    // between them malformed); a sheet of one face, or a join that fails, takes the simple one.
    TopoDS_Shape solid;
    if (faces.Extent() > 1) {
      try {
        BRepOffset_MakeOffset join;
        join.Initialize(base, front + back, 1e-6, BRepOffset_Skin, Standard_False, Standard_False, GeomAbs_Intersection, Standard_True);
        join.MakeOffsetShape();
        if (join.IsDone() && !join.Shape().IsNull()) {
          TopExp_Explorer js(join.Shape(), TopAbs_SOLID);
          if (js.More() && w3d_is_valid(js.Current())) solid = join.Shape();
        }
      } catch (const Standard_Failure &) {}
    }
    if (solid.IsNull()) {
      BRepOffsetAPI_MakeThickSolid mk;
      mk.MakeThickSolidBySimple(base, front + back);
      if (!mk.IsDone() || mk.Shape().IsNull())
        throw std::runtime_error("the sheet can't be thickened; its open edges must form clean loops and its faces join edge to edge");
      solid = mk.Shape();
    }
    TopExp_Explorer ex(solid, TopAbs_SOLID);
    if (!ex.More()) throw std::runtime_error("the thickened sheet does not close into a solid");
    TopoDS_Solid one = TopoDS::Solid(ex.Current());
    BRepLib::OrientClosedSolid(one);
    if (!w3d_is_valid(one)) throw std::runtime_error("that thickness folds the sheet into itself; try a thinner one");
    return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(one));
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// Which side of its face's surface (u0, u1, v0, v1 as 0..3) the edge runs along, or -1 when it
// crosses the surface's parameters, as a trimmed edge does.
inline int w3d_iso_side(const TopoDS_Edge &edge, const TopoDS_Face &face, double u0, double u1, double v0, double v1) {
  double f, l;
  Handle(Geom2d_Curve) uv = BRep_Tool::CurveOnSurface(edge, face, f, l);
  if (uv.IsNull()) return -1;
  const double eu = 1e-7 * std::max(1.0, u1 - u0), ev = 1e-7 * std::max(1.0, v1 - v0);
  const double bound[4] = {u0, u1, v0, v1};
  for (int side = 0; side < 4; side++) {
    bool on = true;
    for (int i = 0; i <= 8 && on; i++) {
      gp_Pnt2d q = uv->Value(f + (l - f) * i / 8.0);
      on = std::abs((side < 2 ? q.X() : q.Y()) - bound[side]) < (side < 2 ? eu : ev);
    }
    if (on) return side;
  }
  return -1;
}

// Extend Sheet's Soft and Reflective shapes: a face of its own beyond side `side` (0..3 as u0, u1,
// v0, v1) of the clamped polynomial B-spline `s`, sharing that side's poles so the two faces meet
// exactly. Built across the side in pole space, keeping the surface's knots along it:
// - Soft: per pole column, the cubic leaving the side with the column's position, tangent and
//   curvature (G2), its curvature fading to nothing at the far end.
// - Reflective: the strip of the surface `distance` deep inside the side, turned through the side
//   (every point taken to the far side of its side point: 2 e(v) - S(u, v)). Tangent carries on (G1)
//   and the curvature mirrors, so a bulge becomes an S.
inline TopoDS_Face w3d_extension_face(const Handle(Geom_BSplineSurface) &s, int side, double distance, bool reflective) {
  if (s->IsURational() || s->IsVRational()) throw std::runtime_error("soft and reflective extend polynomial sheets only; try natural or linear");
  const bool inU = side < 2, after = side % 2 == 1;
  if (inU ? s->IsUPeriodic() : s->IsVPeriodic()) throw std::runtime_error("that sheet is periodic across the edge; it has no side to extend");
  const int p = inU ? s->UDegree() : s->VDegree(), q = inU ? s->VDegree() : s->UDegree();
  const int nk = inU ? s->NbUKnots() : s->NbVKnots(), ok = inU ? s->NbVKnots() : s->NbUKnots();
  TColStd_Array1OfReal knots(1, nk), oknots(1, ok);
  TColStd_Array1OfInteger mults(1, nk), omults(1, ok);
  if (inU) { s->UKnots(knots); s->UMultiplicities(mults); s->VKnots(oknots); s->VMultiplicities(omults); }
  else { s->VKnots(knots); s->VMultiplicities(mults); s->UKnots(oknots); s->UMultiplicities(omults); }
  const double a = knots(1), b = knots(nk), at = after ? b : a;
  // rows[k][j]: k across, outward from the side; j along it.
  std::vector<std::vector<gp_Pnt>> rows;
  std::vector<double> ks;
  std::vector<int> ms;
  int degree = p;
  if (!reflective) {
    const int n = inU ? s->NbUPoles() : s->NbVPoles(), m = inU ? s->NbVPoles() : s->NbUPoles();
    std::vector<gp_Pnt> e(m);
    std::vector<gp_Vec> d1(m), d2(m);
    double speed = 0;
    for (int j = 1; j <= m; j++) {
      TColgp_Array1OfPnt column(1, n);
      for (int i = 1; i <= n; i++) column(i) = inU ? s->Pole(i, j) : s->Pole(j, i);
      Geom_BSplineCurve c(column, knots, mults, p);
      c.D2(at, e[j - 1], d1[j - 1], d2[j - 1]);
      if (!after) d1[j - 1].Reverse();  // outward runs down the parameter
      speed += d1[j - 1].Magnitude() / m;
    }
    if (!(speed > 1e-12)) throw std::runtime_error("the sheet is degenerate along that edge");
    // By length across the side: unit tangent v and curvature vector w (d2's part square to d1,
    // over the speed squared). E(t) = e + v t + w (t^2/2 - t^3/(6T)), a cubic Bezier on [0, T].
    const double T = distance;
    rows.assign(4, std::vector<gp_Pnt>(m));
    for (int j = 0; j < m; j++) {
      const double sp = d1[j].Magnitude();
      if (!(sp > 1e-12)) throw std::runtime_error("the sheet is degenerate along that edge");
      const gp_XYZ o = e[j].XYZ(), v = d1[j].XYZ() / sp;
      const gp_XYZ w = (d2[j].XYZ() - v * d2[j].XYZ().Dot(v)) / (sp * sp);
      rows[0][j] = gp_Pnt(o);
      rows[1][j] = gp_Pnt(o + v * (T / 3));
      rows[2][j] = gp_Pnt(o + v * (2 * T / 3) + w * (T * T / 6));
      rows[3][j] = gp_Pnt(o + v * T + w * (T * T / 3));
    }
    degree = 3;
    ks = {0.0, T};
    ms = {4, 4};
  } else {
    // How deep inside the side `distance` reaches, along the middle of it.
    const double mid = (oknots(1) + oknots(ok)) / 2;
    auto at_ = [&](double t) { return inU ? s->Value(t, mid) : s->Value(mid, t); };
    const int N = 1024;
    double run = 0, depth = -1;
    gp_Pnt last = at_(at);
    for (int i = 1; i <= N && depth < 0; i++) {
      const double t = after ? b - (b - a) * i / N : a + (b - a) * i / N;
      gp_Pnt here = at_(t);
      const double step = last.Distance(here);
      if (run + step >= distance) depth = std::abs(t - at) - (b - a) / N * (1 - (distance - run) / std::max(step, 1e-300));
      run += step;
      last = here;
    }
    if (depth <= 0) {
      char why[160];
      std::snprintf(why, sizeof why, "reflective mirrors the sheet itself, which is only %.3g mm across there; extend less", run);
      throw std::runtime_error(why);
    }
    Handle(Geom_BSplineSurface) strip = Handle(Geom_BSplineSurface)::DownCast(s->Copy());
    const double lo = after ? b - depth : a, hi = after ? b : a + depth;
    if (inU) strip->Segment(lo, hi, oknots(1), oknots(ok)); else strip->Segment(oknots(1), oknots(ok), lo, hi);
    const int n = inU ? strip->NbUPoles() : strip->NbVPoles(), m = inU ? strip->NbVPoles() : strip->NbUPoles();
    const int sk = inU ? strip->NbUKnots() : strip->NbVKnots();
    TColStd_Array1OfReal sknots(1, sk);
    TColStd_Array1OfInteger smults(1, sk);
    if (inU) { strip->UKnots(sknots); strip->UMultiplicities(smults); } else { strip->VKnots(sknots); strip->VMultiplicities(smults); }
    auto pole = [&](int i, int j) { return inU ? strip->Pole(i, j) : strip->Pole(j, i); };
    const int edgeRow = after ? n : 1;
    for (int k = 0; k < n; k++) {
      const int i = after ? n - k : k + 1;
      std::vector<gp_Pnt> row(m);
      for (int j = 1; j <= m; j++) row[j - 1] = gp_Pnt(pole(edgeRow, j).XYZ() * 2 - pole(i, j).XYZ());
      rows.push_back(row);
    }
    for (int k = 0; k < sk; k++) {
      const int i = after ? sk - k : k + 1;
      ks.push_back(std::abs(sknots(i) - at));
      ms.push_back(smults(i));
    }
  }
  const int R = (int)rows.size(), m = (int)rows[0].size();
  TColgp_Array2OfPnt poles(1, inU ? R : m, 1, inU ? m : R);
  for (int k = 0; k < R; k++)
    for (int j = 0; j < m; j++) {
      if (inU) poles(k + 1, j + 1) = rows[k][j]; else poles(j + 1, k + 1) = rows[k][j];
    }
  TColStd_Array1OfReal xk(1, (int)ks.size());
  TColStd_Array1OfInteger xm(1, (int)ms.size());
  for (size_t i = 0; i < ks.size(); i++) { xk((int)i + 1) = ks[i]; xm((int)i + 1) = ms[i]; }
  Handle(Geom_BSplineSurface) out = inU
      ? new Geom_BSplineSurface(poles, xk, oknots, xm, omults, degree, q)
      : new Geom_BSplineSurface(poles, oknots, xk, omults, xm, q, degree);
  BRepBuilderAPI_MakeFace mk(out, 1e-7);
  if (!mk.IsDone()) throw std::runtime_error("the extension could not be made into a face");
  return mk.Face();
}

// Plasticity's Extend Sheet: the sheet grown `distance` past its open edge `index`. `shape` is
// 0 Linear (straight on from the face), 1 Natural (on with its curvature), 2 Soft or 3 Reflective
// (see `w3d_extension_face`). Linear and Natural on a side of the face's surface extend that
// surface (GeomLib); Linear on a straight edge of a flat face extends the plane with a strip. Soft
// and Reflective add a face of their own along a side of a B-spline surface.
inline std::unique_ptr<TopoDS_Shape> w3d_extend_sheet(const TopoDS_Shape &shape, int32_t index, double distance, int32_t kind) {
  if (kind < 0 || kind > 3) throw std::runtime_error("that is not an extension shape");
  const bool natural = kind == 1;
  if (!std::isfinite(distance) || !(distance > 1e-6)) throw std::runtime_error("the distance must be above zero");
  TopTools_IndexedMapOfShape map;
  TopExp::MapShapes(shape, TopAbs_EDGE, map);
  if (index < 0 || index >= map.Extent()) throw std::out_of_range("that edge no longer exists");
  TopoDS_Edge edge = TopoDS::Edge(map(index + 1));
  TopTools_IndexedDataMapOfShapeListOfShape faces;
  TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, faces);
  const TopTools_ListOfShape &around = faces.FindFromKey(edge);
  if (around.Extent() != 1) throw std::runtime_error(around.IsEmpty() ? "that edge has no sheet to extend" : "extend an open edge of a sheet; that edge joins two faces");
  TopoDS_Face face = TopoDS::Face(around.First());
  try {
    double u0, u1, v0, v1;
    BRepTools::UVBounds(face, u0, u1, v0, v1);
    TopoDS_Face grown;
    int side = w3d_iso_side(edge, face, u0, u1, v0, v1);
    bool untrimmed = true;
    for (TopExp_Explorer ex(face, TopAbs_EDGE); ex.More() && untrimmed; ex.Next()) {
      TopoDS_Edge e = TopoDS::Edge(ex.Current());
      untrimmed = BRep_Tool::Degenerated(e) || w3d_iso_side(e, face, u0, u1, v0, v1) >= 0;
    }
    if (kind >= 2) {
      if (side < 0 || !untrimmed) throw std::runtime_error("soft and reflective extend a side of the sheet's surface; that edge is trimmed across it");
      Handle(Geom_Surface) surface = BRep_Tool::Surface(face);
      Handle(Geom_BSplineSurface) bs = GeomConvert::SurfaceToBSplineSurface(new Geom_RectangularTrimmedSurface(surface, u0, u1, v0, v1));
      TopoDS_Face more = w3d_extension_face(bs, side, distance, kind == 3);
      BRepBuilderAPI_Sewing sew(1e-6);
      sew.Add(shape);
      sew.Add(more);
      sew.Perform();
      TopoDS_Shape result = sew.SewedShape();
      TopTools_IndexedDataMapOfShapeListOfShape after;
      TopExp::MapShapesAndAncestors(result, TopAbs_EDGE, TopAbs_FACE, after);
      int shared = 0;
      for (int i = 1; i <= after.Extent(); i++) if (after(i).Extent() == 2) shared++;
      TopTools_IndexedDataMapOfShapeListOfShape before;
      TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, before);
      int had = 0;
      for (int i = 1; i <= before.Extent(); i++) if (before(i).Extent() == 2) had++;
      if (shared != had + 1) throw std::runtime_error("the extension could not be joined to the sheet");
      if (!w3d_is_valid(result)) throw std::runtime_error("the extended sheet is not valid; try a shorter distance");
      return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(result));
    }
    if (side >= 0 && untrimmed) {
      Handle(Geom_Surface) surface = BRep_Tool::Surface(face);
      Handle(Geom_BoundedSurface) bs = GeomConvert::SurfaceToBSplineSurface(new Geom_RectangularTrimmedSurface(surface, u0, u1, v0, v1));
      // Linear carries the side's tangent on (C1); Natural its curvature too (C2).
      GeomLib::ExtendSurfByLength(bs, distance, natural ? 2 : 1, side < 2, side % 2 == 1);
      BRepBuilderAPI_MakeFace mk(bs, 1e-7);
      if (!mk.IsDone()) throw std::runtime_error("the extended surface could not be made into a face");
      grown = mk.Face();
      if (face.Orientation() == TopAbs_REVERSED) grown.Reverse();
    } else {
      BRepAdaptor_Curve curve(edge);
      GeomAdaptor_Surface plane(BRep_Tool::Surface(face));
      if (plane.GetType() != GeomAbs_Plane || curve.GetType() != GeomAbs_Line)
        throw std::runtime_error("extend a side of the sheet's surface, or a straight edge of a flat sheet; that edge is trimmed across its surface");
      // Out of the face, in its plane: the edge as the face's wire runs it has the face on its left.
      TopoDS_Edge inFace = edge;
      for (TopExp_Explorer ex(face, TopAbs_EDGE); ex.More(); ex.Next())
        if (ex.Current().IsSame(edge)) { inFace = TopoDS::Edge(ex.Current()); break; }
      gp_Vec d = curve.Line().Direction();
      if (inFace.Orientation() == TopAbs_REVERSED) d.Reverse();
      gp_Vec normal = plane.Plane().Axis().Direction();
      if (face.Orientation() == TopAbs_REVERSED) normal.Reverse();
      gp_Vec out = d.Crossed(normal).Normalized() * distance;
      TopoDS_Shape strip = BRepPrimAPI_MakePrism(edge, out).Shape();
      BRepAlgoAPI_Fuse fuse(face, strip);
      if (!fuse.IsDone()) throw std::runtime_error("the strip could not be joined to the sheet");
      ShapeUpgrade_UnifySameDomain unify(fuse.Shape(), true, true, false);
      unify.Build();
      TopExp_Explorer one(unify.Shape(), TopAbs_FACE);
      if (!one.More()) throw std::runtime_error("the strip could not be joined to the sheet");
      grown = TopoDS::Face(one.Current());
      one.Next();
      if (one.More()) throw std::runtime_error("the strip could not be merged into the sheet");
    }
    TopoDS_Shape result;
    if (faces.Extent() > 0 && [&] { TopTools_IndexedMapOfShape all; TopExp::MapShapes(shape, TopAbs_FACE, all); return all.Extent(); }() == 1) {
      result = grown;
    } else {
      Handle(BRepTools_ReShape) rs = new BRepTools_ReShape();
      rs->Replace(face, grown);
      BRepBuilderAPI_Sewing sew(1e-6);
      sew.Add(rs->Apply(shape));
      sew.Perform();
      result = sew.SewedShape();
    }
    if (!w3d_is_valid(result)) throw std::runtime_error("the extended sheet is not valid; try a shorter distance");
    return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(result));
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// Extend Sheet's Limit (Plasticity's Minimal): the sheet carried on past its open edge `index` in
// shape `kind` until it first meets `target`, and no further. The sheet is extended well past the
// target, split by it, and the pieces reached from the edge without crossing the target are kept.
// With `through` (Plasticity's Outside) the extension goes on into a solid target and stops where
// it comes out of the far side; otherwise (Minimal) it stops where it first meets the target.
inline std::unique_ptr<TopoDS_Shape> w3d_extend_sheet_to(const TopoDS_Shape &shape, int32_t index, const TopoDS_Shape &target, int32_t kind, bool through) {
  if (kind == 3) throw std::runtime_error("reflective mirrors only as much sheet as there is, so it can't reach to a body; pick another shape");
  TopTools_IndexedMapOfShape map;
  TopExp::MapShapes(shape, TopAbs_EDGE, map);
  if (index < 0 || index >= map.Extent()) throw std::out_of_range("that edge no longer exists");
  try {
    BRepAdaptor_Curve along(TopoDS::Edge(map(index + 1)));
    const TopoDS_Vertex mid = BRepBuilderAPI_MakeVertex(along.Value((along.FirstParameter() + along.LastParameter()) / 2)).Vertex();
    Bnd_Box box;
    BRepBndLib::Add(shape, box);
    BRepBndLib::Add(target, box);
    const double far = std::sqrt(box.SquareExtent()) * 1.5;
    std::unique_ptr<TopoDS_Shape> grown;
    try {
      grown = w3d_extend_sheet(shape, index, far, kind);
    } catch (const std::exception &) {
      throw std::runtime_error("the sheet can't be carried on as far as that body in this shape; try Linear");
    }
    BRepAlgoAPI_Splitter split;
    TopTools_ListOfShape args, tools;
    args.Append(*grown);
    tools.Append(target);
    split.SetArguments(args);
    split.SetTools(tools);
    split.Build();
    if (!split.IsDone() || split.HasErrors()) throw std::runtime_error("the extension could not be cut at that body");
    TopTools_IndexedMapOfShape faces;
    TopExp::MapShapes(split.Shape(), TopAbs_FACE, faces);
    TopTools_IndexedDataMapOfShapeListOfShape owners;
    TopExp::MapShapesAndAncestors(split.Shape(), TopAbs_EDGE, TopAbs_FACE, owners);
    auto near = [](const TopoDS_Shape &a, const TopoDS_Shape &b, double tol) {
      BRepExtrema_DistShapeShape d(a, b);
      return d.IsDone() && d.Value() < tol;
    };
    std::map<int, bool> onTarget;
    auto meets = [&](int e) {
      auto it = onTarget.find(e);
      if (it != onTarget.end()) return it->second;
      const TopoDS_Edge &edge = TopoDS::Edge(owners.FindKey(e));
      bool on = false;
      if (!BRep_Tool::Degenerated(edge)) {
        BRepAdaptor_Curve c(edge);
        on = near(BRepBuilderAPI_MakeVertex(c.Value((c.FirstParameter() + c.LastParameter()) / 2)).Vertex(), target, 1e-5);
      }
      return onTarget[e] = on;
    };
    // Which pieces lie inside the target, for Outside: only a solid has an inside.
    std::vector<bool> inside(faces.Extent() + 1, false);
    if (through && TopExp_Explorer(target, TopAbs_SOLID).More()) {
      BRepClass3d_SolidClassifier in(target);
      for (int i = 1; i <= faces.Extent(); i++) {
        GProp_GProps props;
        BRepGProp::SurfaceProperties(faces(i), props);
        in.Perform(props.CentreOfMass(), 1e-6);
        inside[i] = in.State() == TopAbs_IN;
      }
    }
    // The sheet's own pieces are always kept, whatever the target cuts of them.
    std::vector<bool> keep(faces.Extent() + 1, false);
    std::vector<int> todo;
    for (int i = 1; i <= faces.Extent(); i++) {
      GProp_GProps props;
      BRepGProp::SurfaceProperties(faces(i), props);
      const TopoDS_Vertex at = BRepBuilderAPI_MakeVertex(props.CentreOfMass()).Vertex();
      if (near(mid, faces(i), 1e-6) || near(at, shape, 1e-6)) { keep[i] = true; todo.push_back(i); }
    }
    if (todo.empty()) throw std::runtime_error("the extension lost track of its edge");
    bool reached = false;
    while (!todo.empty()) {
      const int f = todo.back();
      todo.pop_back();
      for (TopExp_Explorer ex(faces(f), TopAbs_EDGE); ex.More(); ex.Next()) {
        const int e = owners.FindIndex(ex.Current());
        if (e == 0) continue;
        const bool crossing = meets(e);
        for (TopTools_ListIteratorOfListOfShape it(owners(e)); it.More(); it.Next()) {
          const int g = faces.FindIndex(it.Value());
          if (g <= 0 || g == f || keep[g]) continue;
          // Across the target only into it, on Outside; coming out again is as far as it goes.
          if (crossing && !(inside[g] && !inside[f])) { reached = true; continue; }
          keep[g] = true;
          todo.push_back(g);
        }
        if (crossing && owners(e).Extent() < 2) reached = true;
      }
    }
    if (!reached) throw std::runtime_error("the extension never meets that body; pick a body the edge points at");
    BRepBuilderAPI_Sewing sew(1e-6);
    for (int i = 1; i <= faces.Extent(); i++) if (keep[i]) sew.Add(faces(i));
    sew.Perform();
    TopoDS_Shape result = sew.SewedShape();
    if (!w3d_is_valid(result)) throw std::runtime_error("the extended sheet is not valid");
    return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(result));
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// The pieces at the top of a compound, counted and fetched by number.
inline int32_t w3d_child_count(const TopoDS_Shape &shape) {
  int32_t n = 0;
  for (TopoDS_Iterator it(shape); it.More(); it.Next()) n++;
  return n;
}
inline std::unique_ptr<TopoDS_Shape> w3d_child_at(const TopoDS_Shape &shape, int32_t index) {
  int32_t n = 0;
  for (TopoDS_Iterator it(shape); it.More(); it.Next(), n++)
    if (n == index) return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(it.Value()));
  throw std::out_of_range("no such piece");
}

// Plasticity's Join for sheets: the sheets in `all` (a compound of bodies) sewn where their open
// edges meet within `tol` into one body; a sewn shell that closes becomes a solid.
inline std::unique_ptr<TopoDS_Shape> w3d_join_sheets(const TopoDS_Shape &all, double tol) {
  if (w3d_solid_count(all) != 0) throw std::runtime_error("join sheets; use Boolean to join solids");
  TopTools_IndexedMapOfShape faces;
  TopExp::MapShapes(all, TopAbs_FACE, faces);
  if (faces.Extent() < 2) throw std::runtime_error("select two or more sheets to join");
  try {
    BRepBuilderAPI_Sewing sew(tol, true, true, true, false);
    for (int i = 1; i <= faces.Extent(); i++) sew.Add(faces(i));
    sew.Perform();
    TopoDS_Shape sewn = sew.SewedShape();
    std::vector<TopoDS_Shell> shells;
    for (TopExp_Explorer ex(sewn, TopAbs_SHELL); ex.More(); ex.Next()) shells.push_back(TopoDS::Shell(ex.Current()));
    TopTools_IndexedMapOfShape loose;
    for (TopExp_Explorer ex(sewn, TopAbs_FACE, TopAbs_SHELL); ex.More(); ex.Next()) loose.Add(ex.Current());
    if (shells.size() != 1 || loose.Extent() != 0)
      throw std::runtime_error("the sheets must meet edge to edge, within 0.01 mm, to join into one");
    TopoDS_Shell shell = shells[0];
    if (BRep_Tool::IsClosed(shell)) {
      BRepBuilderAPI_MakeSolid mk(shell);
      if (mk.IsDone()) {
        TopoDS_Solid solid = mk.Solid();
        BRepLib::OrientClosedSolid(solid);
        if (w3d_is_valid(solid)) return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(solid));
      }
    }
    if (!w3d_is_valid(shell)) throw std::runtime_error("the joined sheet is not valid");
    return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(shell));
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// Plasticity's Unjoin: a body taken apart, into each face as a sheet of its own (`faces`), or into
// each separate shell or solid it holds. A compound of the pieces, in face or shell order.
inline std::unique_ptr<TopoDS_Shape> w3d_unjoin(const TopoDS_Shape &shape, bool faces) {
  BRep_Builder b;
  TopoDS_Compound out;
  b.MakeCompound(out);
  int n = 0;
  if (faces) {
    TopTools_IndexedMapOfShape map;
    TopExp::MapShapes(shape, TopAbs_FACE, map);
    for (int i = 1; i <= map.Extent(); i++, n++) {
      TopoDS_Shape copy = BRepBuilderAPI_Copy(map(i)).Shape();
      b.Add(out, copy);
    }
  } else {
    for (TopExp_Explorer ex(shape, TopAbs_SOLID); ex.More(); ex.Next(), n++) b.Add(out, ex.Current());
    for (TopExp_Explorer ex(shape, TopAbs_SHELL, TopAbs_SOLID); ex.More(); ex.Next(), n++) b.Add(out, ex.Current());
    for (TopExp_Explorer ex(shape, TopAbs_FACE, TopAbs_SHELL); ex.More(); ex.Next(), n++) b.Add(out, ex.Current());
  }
  if (n < 2) throw std::runtime_error(faces ? "that body has only one face" : "that body is all one piece; unjoin its faces instead");
  return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(out));
}

// Plasticity's SVG and DXF export: the hidden-line drawing of `shape` (a compound of the bodies) seen
// along frame[3..6] (pointing at the viewer) from frame[0..3], frame[6..9] the drawing's x. Each line
// comes back as [kind, n, x0, y0, ... x(n-1), y(n-1)] in the drawing's own x, y: kind 0 is visible
// (sharp edges, smooth-edge lines and silhouettes), 1 hidden. Curves are cut to within `deflection`.
inline rust::Vec<double> w3d_hidden_lines(const TopoDS_Shape &shape, rust::Slice<const double> frame, double deflection) {
  if (frame.size() != 9) throw std::runtime_error("a view is a point, a direction and an x direction");
  if (!(deflection > 0)) throw std::runtime_error("the deflection must be greater than zero");
  try {
    gp_Ax2 ax(gp_Pnt(frame[0], frame[1], frame[2]), gp_Dir(frame[3], frame[4], frame[5]), gp_Dir(frame[6], frame[7], frame[8]));
    Handle(HLRBRep_Algo) hlr = new HLRBRep_Algo();
    hlr->Add(shape);
    hlr->Projector(HLRAlgo_Projector(ax));
    hlr->Update();
    hlr->Hide();
    HLRBRep_HLRToShape out(hlr);
    rust::Vec<double> lines;
    auto emit = [&](const TopoDS_Shape &c, double kind) {
      if (c.IsNull()) return;
      for (TopExp_Explorer ex(c, TopAbs_EDGE); ex.More(); ex.Next()) {
        TopoDS_Edge e = TopoDS::Edge(ex.Current());
        BRepLib::BuildCurves3d(e);
        BRepAdaptor_Curve a(e);
        GCPnts_TangentialDeflection pts(a, 0.1, deflection);
        if (pts.NbPoints() < 2) continue;
        lines.push_back(kind);
        lines.push_back(pts.NbPoints());
        for (int i = 1; i <= pts.NbPoints(); i++) {
          gp_Pnt p = pts.Value(i);
          lines.push_back(p.X());
          lines.push_back(p.Y());
        }
      }
    };
    emit(out.VCompound(), 0);
    emit(out.Rg1LineVCompound(), 0);
    emit(out.OutLineVCompound(), 0);
    emit(out.HCompound(), 1);
    emit(out.Rg1LineHCompound(), 1);
    emit(out.OutLineHCompound(), 1);
    if (lines.empty()) throw std::runtime_error("nothing to draw seen from that view");
    return lines;
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// One side of Plasticity's Thicken Face on a solid: the solid hollowed with every face but `faces`
// open, by `offset` (out of the body when positive). What is left is a wall over just those faces,
// its ends cut off where the open faces lie, the walls joined at their corners.
inline TopoDS_Shape w3d_face_wall(const TopoDS_Shape &shape, const TopTools_IndexedMapOfShape &map, const std::vector<bool> &keep, double offset) {
  TopTools_ListOfShape open;
  for (int i = 1; i <= map.Extent(); i++) if (!keep[i - 1]) open.Append(map(i));
  BRepOffsetAPI_MakeThickSolid mk;
  mk.MakeThickSolidByJoin(shape, open, offset, 1e-6, BRepOffset_Skin, Standard_True, Standard_False, GeomAbs_Intersection);
  if (!mk.IsDone() || mk.Shape().IsNull()) throw std::runtime_error("those faces can't be thickened that far; try a thinner wall");
  TopExp_Explorer ex(mk.Shape(), TopAbs_SOLID);
  if (!ex.More()) throw std::runtime_error("the thickened faces do not close into a solid");
  TopoDS_Solid one = TopoDS::Solid(ex.Current());
  BRepLib::OrientClosedSolid(one);
  if (!w3d_is_valid(one)) throw std::runtime_error("that thickness folds the faces into themselves; try a thinner one");
  return one;
}

// Plasticity's Thicken Face on a solid: `faces` made a solid of their own, `front` out of the body
// and `back` into it. The body itself is not changed.
inline std::unique_ptr<TopoDS_Shape> w3d_thicken_faces(const TopoDS_Shape &shape, rust::Slice<const int32_t> faces, double front, double back) {
  if (!std::isfinite(front) || !std::isfinite(back)) throw std::runtime_error("the thickness is not a number");
  if (front < 0.0 || back < 0.0) throw std::runtime_error("the thicknesses can't be below zero; swap front and back instead");
  if (front + back < 1e-6) throw std::runtime_error("the faces need a thickness");
  if (faces.empty()) throw std::runtime_error("select the faces to thicken");
  if (w3d_solid_count(shape) == 0) throw std::runtime_error("thicken faces of a solid");
  TopTools_IndexedMapOfShape map;
  TopExp::MapShapes(shape, TopAbs_FACE, map);
  std::vector<bool> keep(map.Extent(), false);
  for (int32_t f : faces) {
    if (f < 0 || f >= map.Extent()) throw std::out_of_range("no such face");
    if (keep[f]) throw std::runtime_error("a face is picked twice");
    keep[f] = true;
  }
  if (std::all_of(keep.begin(), keep.end(), [](bool k) { return k; })) throw std::runtime_error("leave at least one face unpicked; to thicken every face use Shell");
  try {
    TopoDS_Shape out;
    if (front > 1e-9) out = w3d_face_wall(shape, map, keep, front);
    if (back > 1e-9) {
      TopoDS_Shape inner = w3d_face_wall(shape, map, keep, -back);
      if (out.IsNull()) out = inner;
      else {
        BRepAlgoAPI_Fuse fuse(out, inner);
        if (!fuse.IsDone()) throw std::runtime_error("the front and back of the faces could not be joined");
        ShapeUpgrade_UnifySameDomain unify(fuse.Shape(), Standard_True, Standard_True, Standard_True);
        unify.Build();
        TopExp_Explorer ex(unify.Shape(), TopAbs_SOLID);
        if (!ex.More()) throw std::runtime_error("the front and back of the faces could not be joined");
        out = ex.Current();
      }
    }
    return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(out));
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// Rebuild Face: Cox-de Boor, all `n` basis functions of degree `p` on the clamped knots `T` at `t`.
inline void w3d_basis(const std::vector<double> &T, int p, int n, double t, std::vector<double> &N) {
  N.assign(n, 0.0);
  int k = p;
  if (t >= T[n]) k = n - 1;
  else while (k < n - 1 && t >= T[k + 1]) k++;
  std::vector<double> b(p + 1, 0.0), left(p + 1), right(p + 1);
  b[0] = 1.0;
  for (int j = 1; j <= p; j++) {
    left[j] = t - T[k + 1 - j];
    right[j] = T[k + j] - t;
    double saved = 0.0;
    for (int r = 0; r < j; r++) {
      double tmp = b[r] / (right[r + 1] + left[j - r]);
      b[r] = saved + right[r + 1] * tmp;
      saved = left[j - r] * tmp;
    }
    b[j] = saved;
  }
  for (int j = 0; j <= p; j++) N[k - p + j] = b[j];
}

// The least-squares fit of `n` poles of degree `p` on uniform clamped knots over [a, b] to `m`
// values at uniform parameters, the end poles held at the end values: the (n x m) matrix taking
// the values to the poles. (A curve fitted this way passes through its ends, so a closed surface
// rebuilt along its seam stays closed.)
inline std::vector<std::vector<double>> w3d_fit_matrix(const std::vector<double> &T, int p, int n, int m, double a, double b) {
  std::vector<std::vector<double>> A(m);
  for (int i = 0; i < m; i++) w3d_basis(T, p, n, a + (b - a) * i / (m - 1), A[i]);
  std::vector<std::vector<double>> F(n, std::vector<double>(m, 0.0));
  F[0][0] = 1.0;
  F[n - 1][m - 1] = 1.0;
  const int k = n - 2;
  if (k <= 0) return F;
  // Interior poles: (Bt B) x = Bt (y - N0 y0 - Nn yn), B the interior columns of A on interior rows.
  std::vector<std::vector<double>> M(k, std::vector<double>(k, 0.0));
  for (int i = 1; i < m - 1; i++)
    for (int r = 0; r < k; r++) if (A[i][r + 1] != 0.0)
      for (int c = 0; c < k; c++) M[r][c] += A[i][r + 1] * A[i][c + 1];
  // R: (k x m) right-hand side as a map from the values.
  std::vector<std::vector<double>> R(k, std::vector<double>(m, 0.0));
  for (int i = 1; i < m - 1; i++)
    for (int r = 0; r < k; r++) {
      double w = A[i][r + 1];
      if (w == 0.0) continue;
      R[r][i] += w;
      R[r][0] -= w * A[i][0];
      R[r][m - 1] -= w * A[i][n - 1];
    }
  // Gauss-Jordan with partial pivoting on [M | R].
  for (int col = 0; col < k; col++) {
    int piv = col;
    for (int r = col + 1; r < k; r++) if (std::abs(M[r][col]) > std::abs(M[piv][col])) piv = r;
    if (std::abs(M[piv][col]) < 1e-14) throw std::runtime_error("too many control points for the face; use fewer spans");
    std::swap(M[col], M[piv]);
    std::swap(R[col], R[piv]);
    for (int r = 0; r < k; r++) {
      if (r == col) continue;
      double f = M[r][col] / M[col][col];
      if (f == 0.0) continue;
      for (int c = col; c < k; c++) M[r][c] -= f * M[col][c];
      for (int c = 0; c < m; c++) R[r][c] -= f * R[col][c];
    }
  }
  for (int r = 0; r < k; r++)
    for (int c = 0; c < m; c++) F[r + 1][c] = R[r][c] / M[r][r];
  return F;
}

// `surface` over [u0, u1] x [v0, v1] refitted as a polynomial B-spline of degree (du, dv) with
// (su, sv) uniform spans, keeping the parameters: the new surface at (u, v) is close to the old one
// at (u, v), so the face's curves on it still hold.
inline Handle(Geom_BSplineSurface) w3d_refit_fn(const std::function<gp_XYZ(double, double)> &at, double u0, double u1, double v0, double v1,
                                                int du, int dv, int su, int sv) {
  auto knots = [](int p, int s, double a, double b) {
    std::vector<double> T;
    for (int i = 0; i <= p; i++) T.push_back(a);
    for (int i = 1; i < s; i++) T.push_back(a + (b - a) * i / s);
    for (int i = 0; i <= p; i++) T.push_back(b);
    return T;
  };
  const int nu = su + du, nv = sv + dv;
  const int mu = 4 * su + du + 1, mv = 4 * sv + dv + 1;
  std::vector<double> Tu = knots(du, su, u0, u1), Tv = knots(dv, sv, v0, v1);
  auto Fu = w3d_fit_matrix(Tu, du, nu, mu, u0, u1), Fv = w3d_fit_matrix(Tv, dv, nv, mv, v0, v1);
  std::vector<std::vector<gp_XYZ>> G(mu, std::vector<gp_XYZ>(mv));
  for (int i = 0; i < mu; i++)
    for (int j = 0; j < mv; j++) G[i][j] = at(u0 + (u1 - u0) * i / (mu - 1), v0 + (v1 - v0) * j / (mv - 1));
  std::vector<std::vector<gp_XYZ>> C(mu, std::vector<gp_XYZ>(nv, gp_XYZ(0, 0, 0)));
  for (int i = 0; i < mu; i++)
    for (int r = 0; r < nv; r++)
      for (int j = 0; j < mv; j++) if (Fv[r][j] != 0.0) C[i][r] += G[i][j] * Fv[r][j];
  TColgp_Array2OfPnt poles(1, nu, 1, nv);
  for (int r = 0; r < nu; r++)
    for (int c = 0; c < nv; c++) {
      gp_XYZ q(0, 0, 0);
      for (int i = 0; i < mu; i++) if (Fu[r][i] != 0.0) q += C[i][c] * Fu[r][i];
      poles.SetValue(r + 1, c + 1, gp_Pnt(q));
    }
  auto flat = [](int s, double a, double b, int p, TColStd_Array1OfReal &k, TColStd_Array1OfInteger &m) {
    for (int i = 0; i <= s; i++) { k.SetValue(i + 1, a + (b - a) * i / s); m.SetValue(i + 1, (i == 0 || i == s) ? p + 1 : 1); }
  };
  TColStd_Array1OfReal ku(1, su + 1), kv(1, sv + 1);
  TColStd_Array1OfInteger mu_(1, su + 1), mv_(1, sv + 1);
  flat(su, u0, u1, du, ku, mu_);
  flat(sv, v0, v1, dv, kv, mv_);
  return new Geom_BSplineSurface(poles, ku, kv, mu_, mv_, du, dv);
}

inline Handle(Geom_BSplineSurface) w3d_refit(const Handle(Geom_Surface) &surface, double u0, double u1, double v0, double v1,
                                             int du, int dv, int su, int sv) {
  return w3d_refit_fn([&](double u, double v) { return surface->Value(u, v).XYZ(); }, u0, u1, v0, v1, du, dv, su, sv);
}

// The furthest `b`'s surface strays from `a`'s over `a`'s face `index` (the same parameters on both).
inline double w3d_face_deviation(const TopoDS_Shape &a, const TopoDS_Shape &b, int32_t index) {
  TopTools_IndexedMapOfShape ma, mb;
  TopExp::MapShapes(a, TopAbs_FACE, ma);
  TopExp::MapShapes(b, TopAbs_FACE, mb);
  if (index < 0 || index >= ma.Extent() || index >= mb.Extent()) throw std::out_of_range("that face no longer exists");
  TopoDS_Face fa = TopoDS::Face(ma(index + 1)), fb = TopoDS::Face(mb(index + 1));
  double u0, u1, v0, v1;
  BRepTools::UVBounds(fa, u0, u1, v0, v1);
  BRepAdaptor_Surface sa(fa, false), sb(fb, false);
  const int n = 48;
  double worst = 0.0;
  for (int i = 0; i <= n; i++)
    for (int j = 0; j <= n; j++) {
      double u = u0 + (u1 - u0) * i / n, v = v0 + (v1 - v0) * j / n;
      worst = std::max(worst, sa.Value(u, v).Distance(sb.Value(u, v)));
    }
  return worst;
}

// Per face of `shape`: its surface's U and V degree and pole counts, or -1s where it isn't a B-spline.
inline rust::Vec<int32_t> w3d_face_spline(const TopoDS_Shape &shape, int32_t index) {
  TopTools_IndexedMapOfShape map;
  TopExp::MapShapes(shape, TopAbs_FACE, map);
  if (index < 0 || index >= map.Extent()) throw std::out_of_range("that face no longer exists");
  Handle(Geom_BSplineSurface) bs = Handle(Geom_BSplineSurface)::DownCast(BRep_Tool::Surface(TopoDS::Face(map(index + 1))));
  rust::Vec<int32_t> out;
  if (bs.IsNull()) { for (int i = 0; i < 4; i++) out.push_back(-1); return out; }
  out.push_back(bs->UDegree());
  out.push_back(bs->VDegree());
  out.push_back(bs->NbUPoles());
  out.push_back(bs->NbVPoles());
  return out;
}

// Face `f` (of a copied shape: its edges are updated in place) on the surface `made`, which keeps
// `f`'s surface parameters to within `dev` mm: the same edges and wires, their curves on the face
// carried over and their tolerances raised to cover how far they now lie from the surface.
inline TopoDS_Face w3d_face_on(const TopoDS_Face &f, const Handle(Geom_Surface) &made, const TopLoc_Location &loc, double dev) {
  BRep_Builder B;
  const double t = std::max(dev * 1.01, Precision::Confusion());
  // Built forward (Add would turn the wires of a reversed face), then turned like the old one. The
  // wires come with their locations in full, since Add takes the face's own location off them.
  TopoDS_Face nf = TopoDS::Face(f.Oriented(TopAbs_FORWARD).EmptyCopied());
  B.UpdateFace(nf, made, loc, t);
  for (TopoDS_Iterator it(f, false, true); it.More(); it.Next()) B.Add(nf, it.Value());
  nf.Orientation(f.Orientation());
  TopTools_IndexedMapOfShape edges;
  TopExp::MapShapes(f, TopAbs_EDGE, edges);
  const TopoDS_Face ff = TopoDS::Face(f.Oriented(TopAbs_FORWARD));
  for (int i = 1; i <= edges.Extent(); i++) {
    TopoDS_Edge e = TopoDS::Edge(edges(i));
    double a, b;
    if (BRep_Tool::IsClosed(e, f)) {
      TopoDS_Edge ef = TopoDS::Edge(e.Oriented(TopAbs_FORWARD)), er = TopoDS::Edge(e.Oriented(TopAbs_REVERSED));
      Handle(Geom2d_Curve) c1 = BRep_Tool::CurveOnSurface(ef, ff, a, b), c2 = BRep_Tool::CurveOnSurface(er, ff, a, b);
      B.UpdateEdge(ef, c1, c2, made, loc, t);
    } else {
      Handle(Geom2d_Curve) c = BRep_Tool::CurveOnSurface(e, ff, a, b);
      if (c.IsNull()) throw std::runtime_error("an edge of that face has no curve on it");
      B.UpdateEdge(e, c, made, loc, t);
    }
    B.Range(e, made, loc, a, b);
    // The edge's tolerance covers how far its curve now lies from the new surface.
    double off = 0.0;
    ShapeAnalysis_Edge().CheckSameParameter(e, off, 64);
    const double et = std::max(t, off * 1.05);
    B.UpdateEdge(e, et);
    B.UpdateVertex(TopExp::FirstVertex(e), et);
    B.UpdateVertex(TopExp::LastVertex(e), et);
  }
  return nf;
}

// Plasticity's Rebuild Face: each of `faces` given a new polynomial B-spline surface, its edges and
// trims kept. `p` is [explicit, degree u, degree v, spans u, spans v, tolerance, extend u, extend v,
// shrink]. Explicit fits the given degree and spans; otherwise degree 3 with as few uniform spans as
// keep the face within the tolerance. Shrink fits over the face's own extent instead of its whole
// surface; extend then carries the surface on that far (mm) past both sides in u and v.
inline std::unique_ptr<TopoDS_Shape> w3d_rebuild_faces(const TopoDS_Shape &shape, rust::Slice<const int32_t> faces, rust::Slice<const double> p) {
  if (p.size() != 9) throw std::runtime_error("rebuild takes 9 settings");
  if (faces.empty()) throw std::runtime_error("select the faces to rebuild");
  const bool explicit_ = p[0] != 0.0, shrink = p[8] != 0.0;
  const int du = (int)p[1], dv = (int)p[2], su = (int)p[3], sv = (int)p[4];
  const double tol = p[5], eu = p[6], ev = p[7];
  if (explicit_ && (du < 1 || dv < 1 || du > 9 || dv > 9)) throw std::runtime_error("the degree must be 1 to 9");
  if (explicit_ && (su < 1 || sv < 1 || su > 64 || sv > 64)) throw std::runtime_error("the spans must be 1 to 64");
  if (!explicit_ && !(tol > 0.0)) throw std::runtime_error("the tolerance must be above zero");
  if (!(eu >= 0.0) || !(ev >= 0.0)) throw std::runtime_error("extend must be zero or more");
  try {
    TopoDS_Shape work = BRepBuilderAPI_Copy(shape).Shape();
    TopTools_IndexedMapOfShape map;
    TopExp::MapShapes(work, TopAbs_FACE, map);
    Handle(BRepTools_ReShape) rs = new BRepTools_ReShape();
    for (int32_t index : faces) {
      if (index < 0 || index >= map.Extent()) throw std::out_of_range("that face no longer exists");
      TopoDS_Face f = TopoDS::Face(map(index + 1));
      TopLoc_Location loc;
      Handle(Geom_Surface) s = BRep_Tool::Surface(f, loc);
      double fu0, fu1, fv0, fv1;
      BRepTools::UVBounds(f, fu0, fu1, fv0, fv1);
      double u0 = fu0, u1 = fu1, v0 = fv0, v1 = fv1;
      if (!shrink) {
        double a0, a1, b0, b1;
        s->Bounds(a0, a1, b0, b1);
        if (!Precision::IsInfinite(a0) && !Precision::IsInfinite(a1)) { u0 = std::min(a0, fu0); u1 = std::max(a1, fu1); }
        if (!Precision::IsInfinite(b0) && !Precision::IsInfinite(b1)) { v0 = std::min(b0, fv0); v1 = std::max(b1, fv1); }
      }
      if (!(u1 - u0 > 1e-12) || !(v1 - v0 > 1e-12)) throw std::runtime_error("that face has no area to rebuild");
      // Deviation over the face's own extent.
      auto deviation = [&](const Handle(Geom_Surface) &t) {
        const int n = 24;
        double worst = 0.0;
        for (int i = 0; i <= n; i++)
          for (int j = 0; j <= n; j++) {
            double u = fu0 + (fu1 - fu0) * i / n, v = fv0 + (fv1 - fv0) * j / n;
            worst = std::max(worst, s->Value(u, v).Distance(t->Value(u, v)));
          }
        return worst;
      };
      Handle(Geom_BSplineSurface) made;
      if (explicit_) made = w3d_refit(s, u0, u1, v0, v1, du, dv, su, sv);
      else {
        static const int steps[] = {1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48};
        for (int k : steps) {
          made = w3d_refit(s, u0, u1, v0, v1, 3, 3, k, k);
          if (deviation(made) <= tol) break;
        }
      }
      for (int side = 0; side < 4; side++) {
        const bool inU = side < 2;
        const double by = inU ? eu : ev;
        if (by <= 0.0 || (inU ? s->IsUClosed() : s->IsVClosed())) continue;
        Handle(Geom_BoundedSurface) grown = made;
        GeomLib::ExtendSurfByLength(grown, by, 1, inU, side % 2 == 1);
        made = Handle(Geom_BSplineSurface)::DownCast(grown);
        if (made.IsNull()) throw std::runtime_error("the rebuilt face could not be extended");
      }
      const double dev = deviation(made);
      rs->Replace(f, w3d_face_on(f, made, loc, dev));
    }
    TopoDS_Shape result = rs->Apply(work);
    if (!w3d_is_valid(result)) throw std::runtime_error("the rebuilt face is not valid; try more spans or a higher degree");
    return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(result));
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// A point of a conic (kind 2) or G2 (kind 3) round's section from p0 to p1, whose sides would
// meet at the corner c, at s in [0, 1]. The conic is a rational quadratic with rho `tension` (0.5
// a parabola, nearer 1 tighter into the corner); the G2 section is a quintic Bézier with three
// control points on each side's line, so it leaves both faces with no curvature.
inline gp_XYZ w3d_round_section(const gp_XYZ &p0, const gp_XYZ &c, const gp_XYZ &p1, int kind, double tension, double s) {
  if (kind == 2) {
    const double w = tension / (1.0 - tension), b0 = (1 - s) * (1 - s), b1 = 2 * s * (1 - s) * w, b2 = s * s;
    return (p0 * b0 + c * b1 + p1 * b2) / (b0 + b1 + b2);
  }
  gp_XYZ q[6] = {p0, p0 + (c - p0) * (tension / 2), p0 + (c - p0) * tension, p1 + (c - p1) * tension, p1 + (c - p1) * (tension / 2), p1};
  for (int n = 5; n > 0; n--)
    for (int i = 0; i < n; i++) q[i] = q[i] * (1 - s) + q[i + 1] * s;
  return q[0];
}

// The outward normal of face `f` (its own surface `s`, in the face's frame) at (u, v).
inline gp_Vec w3d_face_normal_at(const TopoDS_Face &f, const Handle(Geom_Surface) &s, double u, double v) {
  gp_Pnt p;
  gp_Vec du, dv;
  s->D1(u, v, p, du, dv);
  gp_Vec n = du.Crossed(dv);
  if (f.Orientation() == TopAbs_REVERSED) n.Reverse();
  return n;
}

// Plasticity's Conic and G2 fillet shapes: each of `faces` (rounds a fillet made) given the section
// of w3d_round_section between the same spring lines, so the round meets its faces where it did,
// tangent to them. Faces and edges keep their numbers. kind is 2 (Conic) or 3 (G2). The ends of a
// round must be square to its edge (as on a block) or run into another of `faces`.
inline std::unique_ptr<TopoDS_Shape> w3d_reshape_fillets(const TopoDS_Shape &shape, rust::Slice<const int32_t> faces, int32_t kind, double tension) {
  if (kind != 2 && kind != 3) throw std::runtime_error("a fillet shape is conic or G2");
  if (!(tension >= 0.05 && tension <= 0.95)) throw std::runtime_error("the tension must be between 0.05 and 0.95");
  if (faces.empty()) throw std::runtime_error("no rounds to shape");
  const char *corner = "conic and G2 rounds don't go round corners yet; round those edges with the round shape";
  try {
    TopoDS_Shape work = BRepBuilderAPI_Copy(shape).Shape();
    TopTools_IndexedMapOfShape fmap;
    TopExp::MapShapes(work, TopAbs_FACE, fmap);
    TopTools_IndexedDataMapOfShapeListOfShape edgeFaces;
    TopExp::MapShapesAndAncestors(work, TopAbs_EDGE, TopAbs_FACE, edgeFaces);
    std::set<int> mine;
    for (int32_t f : faces) {
      if (f < 0 || f >= fmap.Extent()) throw std::out_of_range("that face no longer exists");
      mine.insert(f + 1);
    }
    BRep_Builder B;
    Handle(BRepTools_ReShape) rs = new BRepTools_ReShape();
    TopTools_MapOfShape remade;
    // Each round's new section evaluator, in its own face's frame, by face number.
    std::map<int, std::function<gp_XYZ(double, double)>> shaped;
    std::map<int, TopLoc_Location> frames;
    for (int pass = 0; pass < 2; pass++)
    for (int fi : mine) {
      const TopoDS_Face f = TopoDS::Face(fmap(fi));
      TopLoc_Location loc;
      Handle(Geom_Surface) s = BRep_Tool::Surface(f, loc);
      double u0, u1, v0, v1;
      BRepTools::UVBounds(f, u0, u1, v0, v1);
      const double tu = 1e-6 * std::max(1.0, u1 - u0), tv = 1e-6 * std::max(1.0, v1 - v0);
      // The spring lines: edges to faces the round leaves tangent, lying along an isoline at the
      // edge of the face's parameters. Their direction is the round's across direction.
      std::vector<TopoDS_Edge> ends;
      bool spring[2][2] = {{false, false}, {false, false}};
      auto otherFace = [&](const TopoDS_Edge &e) {
        for (TopTools_ListIteratorOfListOfShape it(edgeFaces.FindFromKey(e)); it.More(); it.Next())
          if (!it.Value().IsSame(f)) return TopoDS::Face(it.Value());
        return TopoDS_Face();
      };
      for (TopExp_Explorer ex(f, TopAbs_EDGE); ex.More(); ex.Next()) {
        const TopoDS_Edge e = TopoDS::Edge(ex.Current());
        if (BRep_Tool::Degenerated(e)) continue;
        double a, b;
        Handle(Geom2d_Curve) c2 = BRep_Tool::CurveOnSurface(e, f, a, b);
        if (c2.IsNull()) throw std::runtime_error(corner);
        const gp_Pnt2d A = c2->Value(a), M = c2->Value((a + b) / 2), Z = c2->Value(b);
        const TopoDS_Face g = otherFace(e);
        bool isSpring = false;
        if (!g.IsNull() && !mine.count(fmap.FindIndex(g))) {
          TopLoc_Location gl;
          Handle(Geom_Surface) gs = BRep_Tool::Surface(g, gl);
          double ga, gb;
          Handle(Geom2d_Curve) g2 = BRep_Tool::CurveOnSurface(e, g, ga, gb);
          if (!g2.IsNull()) {
            const gp_Pnt2d gm = g2->Value((ga + gb) / 2);
            gp_Vec nf = w3d_face_normal_at(f, s, M.X(), M.Y()).Transformed(loc.Transformation());
            gp_Vec ng = w3d_face_normal_at(g, gs, gm.X(), gm.Y()).Transformed(gl.Transformation());
            isSpring = nf.Magnitude() > 1e-12 && ng.Magnitude() > 1e-12 && nf.Angle(ng) < 1e-3;
          }
        }
        for (int dir = 0; dir < 2 && isSpring; dir++) {
          const double x = dir ? A.Y() : A.X(), t = dir ? tv : tu, lo = dir ? v0 : u0, hi = dir ? v1 : u1;
          if (std::fabs(x - (dir ? M.Y() : M.X())) > t || std::fabs(x - (dir ? Z.Y() : Z.X())) > t) continue;
          if (std::fabs(x - lo) <= t) spring[dir][0] = true;
          else if (std::fabs(x - hi) <= t) spring[dir][1] = true;
        }
        if (!isSpring) ends.push_back(e);
      }
      const int across = spring[0][0] && spring[0][1] ? 0 : spring[1][0] && spring[1][1] ? 1 : -1;
      if (across < 0) throw std::runtime_error(corner);
      const double a0 = across ? v0 : u0, a1 = across ? v1 : u1;
      // The new round at (u, v): the section across through the old round's spring points there.
      std::function<gp_XYZ(double, double)> at = [s, across, a0, a1, kind, tension](double u, double v) {
        const double a = across ? v : u, b = across ? u : v;
        gp_Pnt p0, p1;
        gp_Vec d0u, d0v, d1u, d1v;
        if (across) { s->D1(b, a0, p0, d0u, d0v); s->D1(b, a1, p1, d1u, d1v); }
        else { s->D1(a0, b, p0, d0u, d0v); s->D1(a1, b, p1, d1u, d1v); }
        const gp_Vec t0 = across ? d0v : d0u, t1 = across ? d1v : d1u;
        // Where the round's sides, carried on along their tangents, come closest.
        const gp_Vec w(p1, p0);
        const double aa = t0.Dot(t0), bb = t0.Dot(t1), cc = t1.Dot(t1), d = t0.Dot(w), e = t1.Dot(w), den = aa * cc - bb * bb;
        if (!(den > 1e-12 * aa * cc)) throw std::runtime_error("that round turns too far for a conic or G2 shape");
        const double x = (bb * e - cc * d) / den, y = (aa * e - bb * d) / den;
        if (!(x > 0) || !(y < 0)) throw std::runtime_error("that round turns too far for a conic or G2 shape");
        const gp_XYZ c = (p0.XYZ() + t0.XYZ() * x + p1.XYZ() + t1.XYZ() * y) / 2;
        return w3d_round_section(p0.XYZ(), c, p1.XYZ(), kind, tension, (a - a0) / (a1 - a0));
      };
      if (pass == 0) { shaped[fi] = at; frames[fi] = loc; continue; }
      auto deviation = [&](const Handle(Geom_Surface) &t) {
        const int n = 24;
        double worst = 0.0;
        for (int i = 0; i <= n; i++)
          for (int j = 0; j <= n; j++) {
            const double u = u0 + (u1 - u0) * i / n, v = v0 + (v1 - v0) * j / n;
            worst = std::max(worst, t->Value(u, v).XYZ().Subtracted(at(u, v)).Modulus());
          }
        return worst;
      };
      Handle(Geom_BSplineSurface) made;
      double dev = 0.0;
      // Spans across and along grow in turn until the fit holds the new round within 1e-6 mm.
      int ka = 2, kb = 2;
      for (int round = 0; round < 12; round++) {
        made = w3d_refit_fn(at, u0, u1, v0, v1, 3, 3, across ? kb : ka, across ? ka : kb);
        dev = deviation(made);
        if (dev <= 1e-6) break;
        // Which way the fit is worse: along the middle isoline across the round, or along it.
        auto worst = [&](bool alongAcross) {
          double w = 0.0;
          for (int i = 0; i <= 48; i++) {
            const double x = double(i) / 48;
            const double uu = alongAcross == (across == 0) ? u0 + (u1 - u0) * x : (u0 + u1) / 2;
            const double vv = alongAcross == (across == 0) ? (v0 + v1) / 2 : v0 + (v1 - v0) * x;
            w = std::max(w, made->Value(uu, vv).XYZ().Subtracted(at(uu, vv)).Modulus());
          }
          return w;
        };
        if (worst(true) >= worst(false)) ka = std::min(64, ka * 2); else kb = std::min(64, kb * 2);
        if (ka == 64 && kb == 64) { made = w3d_refit_fn(at, u0, u1, v0, v1, 3, 3, 64, 64); dev = deviation(made); break; }
      }
      if (dev > 1e-3) throw std::runtime_error("the shaped round could not be fitted closely enough; try the round shape");
      // The round's ends take the new section, on the faces they run into.
      for (const TopoDS_Edge &e : ends) {
        double a, b;
        Handle(Geom2d_Curve) c2 = BRep_Tool::CurveOnSurface(e, f, a, b);
        const int n = 32;
        TColgp_Array1OfPnt pts(1, n + 1);
        TColStd_Array1OfReal prm(1, n + 1);
        for (int i = 0; i <= n; i++) {
          const double t = a + (b - a) * i / n;
          const gp_Pnt2d q = c2->Value(t);
          pts.SetValue(i + 1, gp_Pnt(at(q.X(), q.Y())));
          prm.SetValue(i + 1, t);
        }
        const TopoDS_Face g = otherFace(e);
        const bool shared = !g.IsNull() && mine.count(fmap.FindIndex(g));
        if (shared) {
          // Two rounds meeting at a corner: their new sections must still meet along the edge.
          const int gi = fmap.FindIndex(g);
          double ga, gb;
          Handle(Geom2d_Curve) g2 = BRep_Tool::CurveOnSurface(e, g, ga, gb);
          if (g2.IsNull()) throw std::runtime_error(corner);
          const gp_Trsf tf = loc.Transformation(), tg = frames[gi].Transformation();
          // An edge has one parameter on both its faces.
          for (int i = 0; i <= n; i++) {
            const double t = a + (b - a) * i / n;
            const gp_Pnt2d q = c2->Value(t), r = g2->Value(t);
            const gp_Pnt here = gp_Pnt(at(q.X(), q.Y())).Transformed(tf), there = gp_Pnt(shaped[gi](r.X(), r.Y())).Transformed(tg);
            if (here.Distance(there) > 1e-4) throw std::runtime_error(corner);
          }
        }
        if (!g.IsNull() && !shared) {
          Handle(Geom_Surface) gs = BRep_Tool::Surface(g);
          for (int i = 1; i <= n + 1; i++) {
            GeomAPI_ProjectPointOnSurf pr(pts(i).Transformed(loc.Transformation()), gs);
            if (!pr.NbPoints() || pr.LowerDistance() > 1e-4) throw std::runtime_error("a conic or G2 round needs its ends square to the edge; use the round shape here");
          }
        }
        if (remade.Contains(e)) continue;
        remade.Add(e);
        GeomAPI_PointsToBSpline fit(pts, prm, 3, 8, GeomAbs_C2, 1e-7);
        if (!fit.IsDone()) throw std::runtime_error("the end of a shaped round could not be made");
        TopoDS_Edge ed = e;
        B.UpdateEdge(ed, fit.Curve(), loc, 1e-6);
        B.Range(ed, a, b, true);
        if (!g.IsNull() && !shared) {
          TopLoc_Location gl;
          Handle(Geom_Surface) gs = BRep_Tool::Surface(g, gl);
          B.UpdateEdge(ed, Handle(Geom2d_Curve)(), gs, gl, 1e-6);
          ShapeFix_Edge().FixAddPCurve(ed, g, false, 1e-6);
        }
      }
      rs->Replace(f, w3d_face_on(f, made, loc, dev));
    }
    TopoDS_Shape result = rs->Apply(work);
    if (!w3d_is_valid(result)) throw std::runtime_error("the shaped round is not valid; try the round shape");
    return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(result));
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// Plasticity's Raise Surface Degree: each of `faces` with its surface's U and V degree raised by one,
// which adds a row and a column of control points without changing its shape. A face that is not
// a B-spline (a plane, cylinder, sphere...) is first fitted as one, degree 3, within 1e-3 mm.
inline std::unique_ptr<TopoDS_Shape> w3d_raise_faces(const TopoDS_Shape &shape, rust::Slice<const int32_t> faces) {
  if (faces.empty()) throw std::runtime_error("select the faces or solids to raise");
  try {
    TopoDS_Shape work = BRepBuilderAPI_Copy(shape).Shape();
    TopTools_IndexedMapOfShape map;
    TopExp::MapShapes(work, TopAbs_FACE, map);
    Handle(BRepTools_ReShape) rs = new BRepTools_ReShape();
    for (int32_t index : faces) {
      if (index < 0 || index >= map.Extent()) throw std::out_of_range("that face no longer exists");
      TopoDS_Face f = TopoDS::Face(map(index + 1));
      TopLoc_Location loc;
      Handle(Geom_Surface) s = BRep_Tool::Surface(f, loc);
      double u0, u1, v0, v1;
      BRepTools::UVBounds(f, u0, u1, v0, v1);
      Handle(Geom_BSplineSurface) bs = Handle(Geom_BSplineSurface)::DownCast(s);
      double dev = 0.0;
      if (!bs.IsNull()) bs = Handle(Geom_BSplineSurface)::DownCast(bs->Copy());
      else {
        for (int k : {1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48}) {
          bs = w3d_refit(s, u0, u1, v0, v1, 3, 3, k, k);
          dev = 0.0;
          for (int i = 0; i <= 24; i++)
            for (int j = 0; j <= 24; j++) {
              double u = u0 + (u1 - u0) * i / 24, v = v0 + (v1 - v0) * j / 24;
              dev = std::max(dev, s->Value(u, v).Distance(bs->Value(u, v)));
            }
          if (dev <= 1e-3) break;
        }
      }
      const int du = std::min(bs->UDegree() + 1, Geom_BSplineSurface::MaxDegree()), dv = std::min(bs->VDegree() + 1, Geom_BSplineSurface::MaxDegree());
      if (du == bs->UDegree() && dv == bs->VDegree()) throw std::runtime_error("that face is already at the highest degree");
      bs->IncreaseDegree(du, dv);
      rs->Replace(f, w3d_face_on(f, bs, loc, dev));
    }
    TopoDS_Shape result = rs->Apply(work);
    if (!w3d_is_valid(result)) throw std::runtime_error("raising the degree breaks the body");
    return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(result));
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// A face's outward normal at the middle of its parameters.
inline gp_Dir w3d_face_out(const TopoDS_Face &f) {
  double u0, u1, v0, v1;
  BRepTools::UVBounds(f, u0, u1, v0, v1);
  BRepAdaptor_Surface s(f);
  gp_Pnt p;
  gp_Vec du, dv;
  s.D1((u0 + u1) / 2, (v0 + v1) / 2, p, du, dv);
  gp_Vec n = du.Crossed(dv);
  if (n.Magnitude() < 1e-12) throw std::runtime_error("that face has no direction at its middle");
  if (f.Orientation() == TopAbs_REVERSED) n.Reverse();
  return gp_Dir(n);
}

// Plasticity's Match Face: `faces` of the solid `shape` replaced by the surface of face `tface` of
// `target`, the body growing out to it or cut back to it. Each face's column (the face swept along
// its outward normal, both ways, past everything) is split by the target's surface, carried on
// well past its edges; inside the columns the body keeps only what lies on the face's inner side
// of that surface, grown out to it where the face stood short.
inline std::unique_ptr<TopoDS_Shape> w3d_match_faces(const TopoDS_Shape &shape, rust::Slice<const int32_t> faces,
                                                     const TopoDS_Shape &target, int32_t tface, rust::Slice<const double> caps) {
  if (faces.empty()) throw std::runtime_error("select the faces to match");
  TopTools_IndexedMapOfShape map, tmap;
  TopExp::MapShapes(shape, TopAbs_FACE, map);
  TopExp::MapShapes(target, TopAbs_FACE, tmap);
  if (tface < 0 || tface >= tmap.Extent()) throw std::out_of_range("that target face no longer exists");
  if (TopExp_Explorer(shape, TopAbs_SOLID).More() == false) throw std::runtime_error("Match Face works on the faces of a solid");
  try {
    Bnd_Box box;
    BRepBndLib::Add(shape, box);
    BRepBndLib::Add(target, box);
    const double far = std::sqrt(box.SquareExtent()) * 2.0;
    // The target's surface carried on far past its face: a B-spline, extended straight on each side.
    const TopoDS_Face tf = TopoDS::Face(tmap(tface + 1));
    TopLoc_Location tl;
    Handle(Geom_Surface) ts = BRep_Tool::Surface(tf, tl);
    double tu0, tu1, tv0, tv1;
    BRepTools::UVBounds(tf, tu0, tu1, tv0, tv1);
    Handle(Geom_BSplineSurface) wide = GeomConvert::SurfaceToBSplineSurface(new Geom_RectangularTrimmedSurface(ts, tu0, tu1, tv0, tv1));
    for (int side = 0; side < 4; side++) {
      const bool inU = side < 2;
      if (inU ? wide->IsUClosed() : wide->IsVClosed()) continue;
      Handle(Geom_BoundedSurface) g = wide;
      GeomLib::ExtendSurfByLength(g, far, 1, inU, side % 2 == 1);
      wide = Handle(Geom_BSplineSurface)::DownCast(g);
    }
    if (!tl.IsIdentity()) wide->Transform(tl.Transformation());
    BRepBuilderAPI_MakeFace mkw(wide, 1e-7);
    if (!mkw.IsDone()) throw std::runtime_error("the target surface could not be carried on past its edges");
    const TopoDS_Face sheet = mkw.Face();
    // Which side of the target each point is on, signed along the target's normal.
    auto side = [&](const gp_Pnt &p, double &s) {
      GeomAPI_ProjectPointOnSurf pr(p, wide);
      if (!pr.NbPoints()) return false;
      double u, v;
      pr.LowerDistanceParameters(u, v);
      gp_Pnt q;
      gp_Vec du, dv;
      wide->D1(u, v, q, du, dv);
      s = gp_Vec(q, p).Dot(du.Crossed(dv));
      return true;
    };
    TopoDS_Shape columns, outs;
    BRep_Builder B;
    TopoDS_Compound cc, oc;
    B.MakeCompound(cc);
    B.MakeCompound(oc);
    std::vector<std::pair<gp_Pnt, gp_Dir>> marks;
    for (size_t i = 0; i < faces.size(); i++) {
      const int32_t index = faces[i];
      if (index < 0 || index >= map.Extent()) throw std::out_of_range("that face no longer exists");
      const TopoDS_Face f = TopoDS::Face(map(index + 1));
      const gp_Dir n = w3d_face_out(f);
      // Grow Fixed: the face grows no further out than its cap (the body's outer wall).
      const double grow = i < caps.size() && caps[i] > 0 ? caps[i] : far;
      gp_Trsf back;
      back.SetTranslation(gp_Vec(n) * -far);
      const TopoDS_Shape low = BRepBuilderAPI_Transform(f, back, true).Shape();
      B.Add(cc, BRepPrimAPI_MakePrism(low, gp_Vec(n) * (2 * far)).Shape());
      B.Add(oc, BRepPrimAPI_MakePrism(f, gp_Vec(n) * grow).Shape());
      GProp_GProps props;
      BRepGProp::SurfaceProperties(f, props);
      marks.emplace_back(props.CentreOfMass(), n);
    }
    // Each face's own sense of "inner side": the target's side that its normal points away from.
    double sense = 0.0;
    for (auto &m : marks) {
      GeomAPI_ProjectPointOnSurf pr(m.first, wide);
      if (!pr.NbPoints()) throw std::runtime_error("the target surface does not lie across that face");
      double u, v;
      pr.LowerDistanceParameters(u, v);
      gp_Pnt q;
      gp_Vec du, dv;
      wide->D1(u, v, q, du, dv);
      sense += gp_Vec(m.second).Dot(du.Crossed(dv).Normalized());
    }
    if (std::abs(sense) < 1e-6 * marks.size()) throw std::runtime_error("the target surface runs along that face, not across it");
    const double inner = sense > 0 ? -1.0 : 1.0;
    // The columns split by the target: keep the pieces on the inner side.
    auto fuse = [](const TopoDS_Shape &all) {
      TopoDS_Shape out;
      for (TopoDS_Iterator it(all); it.More(); it.Next()) {
        if (out.IsNull()) { out = it.Value(); continue; }
        BRepAlgoAPI_Fuse f(out, it.Value());
        if (!f.IsDone() || f.HasErrors()) throw std::runtime_error("the faces' columns could not be joined");
        out = f.Shape();
      }
      return out;
    };
    columns = fuse(cc);
    outs = fuse(oc);
    BRepAlgoAPI_Splitter split;
    TopTools_ListOfShape args, tools;
    args.Append(columns);
    tools.Append(sheet);
    split.SetArguments(args);
    split.SetTools(tools);
    split.Build();
    if (!split.IsDone() || split.HasErrors()) throw std::runtime_error("the target surface could not cut across the faces");
    TopoDS_Compound below;
    B.MakeCompound(below);
    int kept = 0, pieces = 0;
    for (TopExp_Explorer ex(split.Shape(), TopAbs_SOLID); ex.More(); ex.Next()) {
      pieces++;
      GProp_GProps props;
      BRepGProp::VolumeProperties(ex.Current(), props);
      double s;
      if (side(props.CentreOfMass(), s) && s * inner > 0) { B.Add(below, ex.Current()); kept++; }
    }
    if (pieces < 2 || kept == 0) throw std::runtime_error("the target surface does not cut across the faces");
    const TopoDS_Shape inside = fuse(below);
    BRepAlgoAPI_Cut rest(shape, columns);
    BRepAlgoAPI_Fuse grownBody(shape, outs);
    if (!rest.IsDone() || rest.HasErrors() || !grownBody.IsDone() || grownBody.HasErrors()) throw std::runtime_error("the body could not be cut around the faces");
    BRepAlgoAPI_Common within(grownBody.Shape(), inside);
    if (!within.IsDone() || within.HasErrors()) throw std::runtime_error("the body could not be matched to the target");
    BRepAlgoAPI_Fuse joined(rest.Shape(), within.Shape());
    if (!joined.IsDone() || joined.HasErrors()) throw std::runtime_error("the matched part could not be joined back");
    ShapeUpgrade_UnifySameDomain unify(joined.Shape(), true, true, false);
    unify.Build();
    TopoDS_Shape result = unify.Shape();
    int solids = 0;
    for (TopExp_Explorer ex(result, TopAbs_SOLID); ex.More(); ex.Next()) solids++;
    if (solids != 1) throw std::runtime_error(solids ? "matching to that surface splits the body in pieces" : "matching to that surface leaves nothing of the body");
    if (!w3d_is_valid(result)) throw std::runtime_error("matching to that surface breaks the body");
    return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(result));
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// Plasticity's Untrim: a sheet of the whole surface under face `index` of `shape`, out to the
// surface's own bounds (a plane, or the open direction of a cylinder or cone, out to the face's
// extent). With `keep`, the face's edges are imprinted on the sheet.
inline std::unique_ptr<TopoDS_Shape> w3d_untrim_face(const TopoDS_Shape &shape, int32_t index, bool keep) {
  TopTools_IndexedMapOfShape map;
  TopExp::MapShapes(shape, TopAbs_FACE, map);
  if (index < 0 || index >= map.Extent()) throw std::out_of_range("that face no longer exists");
  try {
    const TopoDS_Face f = TopoDS::Face(map(index + 1));
    TopLoc_Location loc;
    Handle(Geom_Surface) s = BRep_Tool::Surface(f, loc);
    double u0, u1, v0, v1, fu0, fu1, fv0, fv1;
    s->Bounds(u0, u1, v0, v1);
    BRepTools::UVBounds(f, fu0, fu1, fv0, fv1);
    if (Precision::IsInfinite(u0) || Precision::IsInfinite(u1)) { u0 = fu0; u1 = fu1; }
    if (Precision::IsInfinite(v0) || Precision::IsInfinite(v1)) { v0 = fv0; v1 = fv1; }
    BRepBuilderAPI_MakeFace mk(s, u0, u1, v0, v1, Precision::Confusion());
    if (!mk.IsDone()) throw std::runtime_error("the face's surface could not be made into a sheet");
    TopoDS_Shape sheet = mk.Face().Located(loc);
    sheet.Orientation(f.Orientation());
    if (keep) {
      TopoDS_Compound edges;
      BRep_Builder B;
      B.MakeCompound(edges);
      for (TopExp_Explorer ex(f, TopAbs_EDGE); ex.More(); ex.Next())
        if (!BRep_Tool::Degenerated(TopoDS::Edge(ex.Current()))) B.Add(edges, ex.Current());
      BRepAlgoAPI_Splitter split;
      TopTools_ListOfShape args, tools;
      args.Append(sheet);
      tools.Append(edges);
      split.SetArguments(args);
      split.SetTools(tools);
      split.SetFuzzyValue(1e-6);
      split.Build();
      if (!split.IsDone() || split.HasErrors()) throw std::runtime_error("the face's edges could not be imprinted on the sheet");
      TopoDS_Shell shell;
      B.MakeShell(shell);
      int n = 0;
      for (TopExp_Explorer ex(split.Shape(), TopAbs_FACE); ex.More(); ex.Next(), n++) B.Add(shell, ex.Current());
      if (n > 1) sheet = shell;
    }
    return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(sheet));
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// Plasticity's Toggle Surface Curvature: `n + 1` samples along edge `index` of `shape`, seven
// numbers each: the point, the unit direction away from the centre of the bend (zero where the
// edge is straight) and the curvature (1 / radius).
inline rust::Vec<double> w3d_edge_curvature(const TopoDS_Shape &shape, int32_t index, int32_t n) {
  TopTools_IndexedMapOfShape map;
  TopExp::MapShapes(shape, TopAbs_EDGE, map);
  if (index < 0 || index >= map.Extent()) throw std::out_of_range("that edge no longer exists");
  const TopoDS_Edge e = TopoDS::Edge(map(index + 1));
  if (BRep_Tool::Degenerated(e)) throw std::runtime_error("that edge is a single point");
  if (n < 1) n = 1;
  rust::Vec<double> out;
  try {
    BRepAdaptor_Curve c(e);
    const double t0 = c.FirstParameter(), t1 = c.LastParameter();
    for (int i = 0; i <= n; i++) {
      gp_Pnt p;
      gp_Vec d1, d2;
      c.D2(t0 + (t1 - t0) * i / n, p, d1, d2);
      const gp_Vec b = d1.Crossed(d2);
      const double s = d1.Magnitude();
      double k = 0;
      gp_Vec away(0, 0, 0);
      if (s > 1e-12 && b.Magnitude() > 1e-12 * s * s * s) {
        k = b.Magnitude() / (s * s * s);
        // The principal normal points at the centre; the teeth stand on the other side.
        away = d1.Crossed(b);
        away.Normalize();
      }
      for (double v : {p.X(), p.Y(), p.Z(), away.X(), away.Y(), away.Z(), k}) out.push_back(v);
    }
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
  return out;
}

// Plasticity's Offset Edge on any faces, curved or several: the picked `edges` of the solid moved
// `d` across the faces on one side of them and imprinted there. The offset is where the tube of
// w3d_edge_tube meets those faces, so it keeps `d` from the edges in space and joins round at
// corners. This gives the faces either side of the picked edges, split into the two sides of the
// run, those of `side` (0 or 1, 2 for both) as face numbers.
inline rust::Vec<int32_t> w3d_offset_edge_faces(const TopoDS_Shape &shape, rust::Slice<const int32_t> edges, int32_t side) {
  if (edges.empty()) throw std::runtime_error("select the edges to offset");
  TopTools_IndexedMapOfShape emap, fmap;
  TopExp::MapShapes(shape, TopAbs_EDGE, emap);
  TopExp::MapShapes(shape, TopAbs_FACE, fmap);
  TopTools_IndexedDataMapOfShapeListOfShape edgeFaces;
  TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, edgeFaces);
  std::set<int> picked;
  for (int32_t e : edges) {
    if (e < 0 || e >= emap.Extent()) throw std::out_of_range("that edge no longer exists");
    picked.insert(e + 1);
  }
  try {
    // The faces either side of the picked edges, coloured 0 and 1: across a picked edge the colour
    // changes, across any other edge between two of these faces it stays.
    std::map<int, int> colour;
    auto facesOf = [&](int e) {
      std::vector<int> out;
      for (TopTools_ListIteratorOfListOfShape it(edgeFaces.FindFromKey(emap(e))); it.More(); it.Next()) {
        const int f = fmap.FindIndex(it.Value());
        if (f > 0 && std::find(out.begin(), out.end(), f) == out.end()) out.push_back(f);
      }
      return out;
    };
    std::set<int> touched;
    for (int e : picked) {
      const auto fs = facesOf(e);
      if (fs.size() != 2) throw std::runtime_error("offset edges between two faces of a solid");
      touched.insert(fs.begin(), fs.end());
    }
    std::vector<int> todo;
    const int seed = facesOf(*picked.begin())[0];
    colour[seed] = 0;
    todo.push_back(seed);
    while (!todo.empty()) {
      const int f = todo.back();
      todo.pop_back();
      TopTools_IndexedMapOfShape fe;
      TopExp::MapShapes(fmap(f), TopAbs_EDGE, fe);
      for (int i = 1; i <= fe.Extent(); i++) {
        const int e = emap.FindIndex(fe(i));
        if (e == 0) continue;
        for (int g : facesOf(e)) {
          if (g == f || !touched.count(g)) continue;
          const int want = picked.count(e) ? 1 - colour[f] : colour[f];
          auto it = colour.find(g);
          if (it == colour.end()) { colour[g] = want; todo.push_back(g); }
          else if (it->second != want) throw std::runtime_error("those edges don't run along one side of the faces; offset them in parts");
        }
      }
    }
    for (int f : touched) if (!colour.count(f)) throw std::runtime_error("those edges don't join up; offset each run on its own");
    rust::Vec<int32_t> out;
    for (auto &[f, c] : colour) if (side == 2 || c == side) out.push_back(f - 1);
    if (out.empty()) throw std::runtime_error("no faces on that side");
    return out;
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// The tube Offset Edge cuts the faces with: a pipe of radius `d` round each picked edge, a ball
// where two picked edges meet, and straight on past the ends of each run.
inline std::unique_ptr<TopoDS_Shape> w3d_edge_tube(const TopoDS_Shape &shape, rust::Slice<const int32_t> edges, double d) {
  if (edges.empty()) throw std::runtime_error("select the edges to offset");
  if (!(d > 1e-6)) throw std::runtime_error("the distance must be greater than zero");
  TopTools_IndexedMapOfShape emap;
  TopExp::MapShapes(shape, TopAbs_EDGE, emap);
  TopTools_IndexedDataMapOfShapeListOfShape vertexEdges;
  TopExp::MapShapesAndAncestors(shape, TopAbs_VERTEX, TopAbs_EDGE, vertexEdges);
  std::set<int> picked;
  for (int32_t e : edges) {
    if (e < 0 || e >= emap.Extent()) throw std::out_of_range("that edge no longer exists");
    picked.insert(e + 1);
  }
  try {
    Bnd_Box box;
    BRepBndLib::Add(shape, box);
    const double far = std::sqrt(box.SquareExtent()) * 1.5;
    std::vector<TopoDS_Shape> parts;
    for (int e : picked) {
      const TopoDS_Edge edge = TopoDS::Edge(emap(e));
      BRepAdaptor_Curve c(edge);
      gp_Pnt p;
      gp_Vec t;
      c.D1(c.FirstParameter(), p, t);
      if (t.Magnitude() < 1e-12) throw std::runtime_error("an edge has no direction at its start");
      const TopoDS_Wire ring = BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(gp_Circ(gp_Ax2(p, gp_Dir(t)), d)).Edge()).Wire();
      BRepOffsetAPI_MakePipeShell pipe(BRepBuilderAPI_MakeWire(edge).Wire());
      pipe.Add(ring);
      pipe.Build();
      if (!pipe.IsDone() || !pipe.MakeSolid()) throw std::runtime_error("the edge bends tighter than that distance; use a smaller one");
      parts.push_back(pipe.Shape());
      for (int end = 0; end < 2; end++) {
        // The vertex at that end of the curve's parameters, whichever way the edge is used.
        const TopoDS_Vertex v = end ? TopExp::LastVertex(edge) : TopExp::FirstVertex(edge);
        // A closed edge runs on into itself.
        if (v.IsNull() || TopExp::FirstVertex(edge).IsSame(TopExp::LastVertex(edge))) continue;
        int meeting = 0;
        for (TopTools_ListIteratorOfListOfShape it(vertexEdges.FindFromKey(v)); it.More(); it.Next()) {
          const int g = emap.FindIndex(it.Value());
          if (g != e && picked.count(g)) meeting++;
        }
        const gp_Pnt at = BRep_Tool::Pnt(v);
        if (meeting) { parts.push_back(BRepPrimAPI_MakeSphere(at, d).Shape()); continue; }
        gp_Pnt q;
        gp_Vec dir;
        c.D1(end ? c.LastParameter() : c.FirstParameter(), q, dir);
        if (!end) dir.Reverse();
        if (dir.Magnitude() < 1e-12) continue;
        parts.push_back(BRepPrimAPI_MakeCylinder(gp_Ax2(at, gp_Dir(dir)), d, far).Shape());
      }
    }
    TopoDS_Shape tube = parts[0];
    for (size_t i = 1; i < parts.size(); i++) {
      BRepAlgoAPI_Fuse f(tube, parts[i]);
      if (!f.IsDone() || f.HasErrors()) throw std::runtime_error("the offsets round the edges could not be joined");
      tube = f.Shape();
    }
    return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(tube));
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// The solid's exact volume (mm³), from its surfaces rather than a mesh.
inline double w3d_volume(const TopoDS_Shape &shape) {
  try {
    GProp_GProps g;
    BRepGProp::VolumeProperties(shape, g);
    return g.Mass();
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// A fillet's limit points: what `rounded` (the body with a round) took off `body`, kept only on the
// side of both planes in `planes` ([point, normal] twice, the normal pointing to the side kept).
inline std::unique_ptr<TopoDS_Shape> w3d_round_piece(const TopoDS_Shape &body, const TopoDS_Shape &rounded, rust::Slice<const double> planes) {
  if (planes.size() != 12) throw std::runtime_error("limits are two planes");
  try {
    BRepAlgoAPI_Cut cut(body, rounded);
    if (!cut.IsDone() || cut.HasErrors()) throw std::runtime_error("the round could not be measured against the body");
    TopoDS_Shape piece = cut.Shape();
    Bnd_Box box;
    BRepBndLib::Add(body, box);
    const double size = std::sqrt(box.SquareExtent()) * 4;
    for (int i = 0; i < 2; i++) {
      const gp_Pnt p(planes[6 * i], planes[6 * i + 1], planes[6 * i + 2]);
      const gp_Vec n(planes[6 * i + 3], planes[6 * i + 4], planes[6 * i + 5]);
      if (n.Magnitude() < 1e-12) throw std::runtime_error("a limit has no direction");
      const TopoDS_Face face = BRepBuilderAPI_MakeFace(gp_Pln(p, gp_Dir(n)), -size, size, -size, size).Face();
      const TopoDS_Shape half = BRepPrimAPI_MakeHalfSpace(face, p.Translated(gp_Vec(gp_Dir(n)) * size / 2)).Solid();
      BRepAlgoAPI_Common keep(piece, half);
      if (!keep.IsDone() || keep.HasErrors()) throw std::runtime_error("the round could not be cut at a limit point");
      piece = keep.Shape();
    }
    if (!TopExp_Explorer(piece, TopAbs_SOLID).More()) throw std::runtime_error("the limit points leave nothing of the round");
    return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(piece));
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}

// A conformal flattening of the grid `pts` (n x n points of a surface, row-major in u then v) by
// least squares (LSCM): each triangle's map to the plane as close to a rotation and scale as the
// whole allows, then scaled so the flat area equals the surface's. Solved by conjugate gradients.
inline std::vector<gp_XY> w3d_lscm(const std::vector<gp_Pnt> &pts, int n) {
  const int V = n * n;
  struct Row { int idx[6]; double w[6]; };
  std::vector<Row> rows;
  double area3 = 0.0;
  // A row or column of the grid that is all one point (a pole) is one point of the mesh, so it
  // can't open out and fold over; the seam's pairs stay apart, which is where the face is cut.
  std::vector<int> rep(V);
  for (int k = 0; k < V; k++) rep[k] = k;
  for (int line = 0; line < n; line++)
    for (int dir = 0; dir < 2; dir++) {
      auto at = [&](int m) { return dir ? line * n + m : m * n + line; };
      bool pole = true;
      for (int m = 1; m < n && pole; m++) pole = pts[at(0)].Distance(pts[at(m)]) < 1e-9;
      if (pole) for (int m = 1; m < n; m++) rep[at(m)] = rep[at(0)];
    }
  auto tri = [&](int a, int b, int c) {
    a = rep[a], b = rep[b], c = rep[c];
    if (a == b || b == c || a == c) return;
    const gp_Vec e1(pts[a], pts[b]), e2(pts[a], pts[c]);
    const gp_Vec nrm = e1.Crossed(e2);
    const double A = nrm.Magnitude() / 2;
    if (A < 1e-14) return;
    area3 += A;
    // The triangle in its own plane: a at the origin, b along x.
    const gp_Vec x = e1.Normalized(), y = nrm.Crossed(e1).Normalized();
    const double p[3][2] = {{0, 0}, {e1.Magnitude(), 0}, {e2.Dot(x), e2.Dot(y)}};
    const int id[3] = {a, b, c};
    // Gradient of each corner's hat function: the opposite edge turned a quarter, over 2A.
    double gx[3], gy[3];
    for (int i = 0; i < 3; i++) {
      const double *q = p[(i + 1) % 3], *r = p[(i + 2) % 3];
      gx[i] = (q[1] - r[1]) / (2 * A);
      gy[i] = (r[0] - q[0]) / (2 * A);
    }
    const double s = std::sqrt(A);
    Row r1, r2;
    for (int i = 0; i < 3; i++) {
      // Cauchy-Riemann: x_u = y_v and x_v = -y_u, unknowns x at 2k, y at 2k + 1.
      r1.idx[2 * i] = 2 * id[i]; r1.w[2 * i] = s * gx[i];
      r1.idx[2 * i + 1] = 2 * id[i] + 1; r1.w[2 * i + 1] = -s * gy[i];
      r2.idx[2 * i] = 2 * id[i]; r2.w[2 * i] = s * gy[i];
      r2.idx[2 * i + 1] = 2 * id[i] + 1; r2.w[2 * i + 1] = s * gx[i];
    }
    rows.push_back(r1);
    rows.push_back(r2);
  };
  for (int i = 0; i + 1 < n; i++)
    for (int j = 0; j + 1 < n; j++) {
      const int a = i * n + j, b = (i + 1) * n + j, c = (i + 1) * n + j + 1, d = i * n + j + 1;
      tri(a, b, c);
      tri(a, c, d);
    }
  if (rows.empty()) throw std::runtime_error("that face has no area to unwrap");
  // Two pinned points fix where the flat piece sits and how it turns: the middle of the grid and
  // the point farthest from it (corners can sit on a pole, where a whole row meets).
  const int pa = (n / 2) * n + n / 2;
  int pb = 0;
  for (int k = 0; k < V; k++) if (rep[k] == k && pts[pa].SquareDistance(pts[k]) > pts[pa].SquareDistance(pts[pb])) pb = k;
  std::vector<double> fixed(2 * V, 0.0);
  std::vector<bool> pinned(2 * V, false);
  fixed[2 * pb] = pts[pa].Distance(pts[pb]);
  if (fixed[2 * pb] < 1e-9) fixed[2 * pb] = 1.0;
  for (int k : {2 * pa, 2 * pa + 1, 2 * pb, 2 * pb + 1}) pinned[k] = true;
  // Normal equations on the free unknowns: M x = -A^T (A fixed).
  auto apply = [&](const std::vector<double> &x, std::vector<double> &out, bool freeOnly) {
    std::fill(out.begin(), out.end(), 0.0);
    for (const Row &r : rows) {
      double v = 0.0;
      for (int k = 0; k < 6; k++) if (!freeOnly || !pinned[r.idx[k]]) v += r.w[k] * x[r.idx[k]];
      for (int k = 0; k < 6; k++) if (!pinned[r.idx[k]]) out[r.idx[k]] += r.w[k] * v;
    }
  };
  std::vector<double> b(2 * V), x(2 * V, 0.0), r(2 * V), d(2 * V), q(2 * V);
  std::vector<double> justFixed(2 * V, 0.0);
  for (int k = 0; k < 2 * V; k++) if (pinned[k]) justFixed[k] = fixed[k];
  // A x_fixed, carried to the right-hand side.
  {
    std::fill(b.begin(), b.end(), 0.0);
    for (const Row &row : rows) {
      double v = 0.0;
      for (int k = 0; k < 6; k++) if (pinned[row.idx[k]]) v += row.w[k] * justFixed[row.idx[k]];
      for (int k = 0; k < 6; k++) if (!pinned[row.idx[k]]) b[row.idx[k]] -= row.w[k] * v;
    }
  }
  apply(x, q, true);
  for (int k = 0; k < 2 * V; k++) { r[k] = b[k] - q[k]; d[k] = r[k]; }
  double rr = 0.0, bb = 0.0;
  for (int k = 0; k < 2 * V; k++) { rr += r[k] * r[k]; bb += b[k] * b[k]; }
  for (int it = 0; it < 20 * V && rr > 1e-28 * std::max(bb, 1e-30); it++) {
    apply(d, q, true);
    double dq = 0.0;
    for (int k = 0; k < 2 * V; k++) dq += d[k] * q[k];
    if (!(dq > 0)) break;
    const double alpha = rr / dq;
    double nr = 0.0;
    for (int k = 0; k < 2 * V; k++) { x[k] += alpha * d[k]; r[k] -= alpha * q[k]; nr += r[k] * r[k]; }
    const double beta = nr / rr;
    rr = nr;
    for (int k = 0; k < 2 * V; k++) d[k] = r[k] + beta * d[k];
  }
  std::vector<gp_XY> flat(V);
  for (int k = 0; k < V; k++) flat[k] = gp_XY(pinned[2 * k] ? fixed[2 * k] : x[2 * k], pinned[2 * k + 1] ? fixed[2 * k + 1] : x[2 * k + 1]);
  for (int k = 0; k < V; k++) flat[k] = flat[rep[k]];
  double area2 = 0.0;
  for (int i = 0; i + 1 < n; i++)
    for (int j = 0; j + 1 < n; j++) {
      const gp_XY a = flat[i * n + j], b2 = flat[(i + 1) * n + j], c = flat[(i + 1) * n + j + 1], e = flat[i * n + j + 1];
      area2 += std::fabs((b2 - a) ^ (c - a)) / 2 + std::fabs((c - a) ^ (e - a)) / 2;
    }
  if (!(area2 > 1e-14)) throw std::runtime_error("that face could not be flattened");
  const double s = std::sqrt(area3 / area2);
  for (gp_XY &p : flat) p *= s;
  return flat;
}

// Plasticity's Unwrap Face: face `index` of `shape` laid flat on the ground (the user's XY plane,
// the model's y = 0, as the model is y-up) as a new sheet, its centre under the face's centre. Planes, cylinders and cones unroll exactly (lengths kept); other
// faces are flattened conformally (shapes of small pieces kept, area kept overall), so their edges
// stretch where the face is doubly curved.
inline std::unique_ptr<TopoDS_Shape> w3d_unwrap_face(const TopoDS_Shape &shape, int32_t index) {
  TopTools_IndexedMapOfShape fmap;
  TopExp::MapShapes(shape, TopAbs_FACE, fmap);
  if (index < 0 || index >= fmap.Extent()) throw std::out_of_range("that face no longer exists");
  try {
    const TopoDS_Face face = TopoDS::Face(fmap(index + 1));
    BRepAdaptor_Surface ad(face, true);
    double u0, u1, v0, v1;
    BRepTools::UVBounds(face, u0, u1, v0, v1);
    std::function<gp_XY(double, double)> flat;
    std::vector<gp_XY> grid;
    const int n = 33;
    GProp_GProps g;
    BRepGProp::SurfaceProperties(face, g);
    const gp_Pnt centre = g.CentreOfMass();
    if (ad.GetType() == GeomAbs_Plane) {
      // A flat face only turns: its outward side up, its centre over where it was, curves kept exact.
      const gp_Pln pln = ad.Plane();
      gp_Dir up = pln.Axis().Direction();
      if (face.Orientation() == TopAbs_REVERSED) up.Reverse();
      gp_Dir x = pln.XAxis().Direction();
      gp_Trsf to;
      to.SetDisplacement(gp_Ax3(centre, up, x), gp_Ax3(gp_Pnt(centre.X(), 0.0, centre.Z()), gp::DY(), gp::DX()));
      TopoDS_Shape result = BRepBuilderAPI_Transform(face, to, true).Shape();
      if (!w3d_is_valid(result)) throw std::runtime_error("the unwrapped face is not valid");
      return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(result));
    }
    switch (ad.GetType()) {
      case GeomAbs_Cylinder: {
        const double R = ad.Cylinder().Radius();
        flat = [R](double u, double v) { return gp_XY(R * u, v); };
        break;
      }
      case GeomAbs_Cone: {
        const gp_Cone cone = ad.Cone();
        const gp_Pnt apex = cone.Apex();
        const double s = std::sin(std::fabs(cone.SemiAngle()));
        flat = [&ad, apex, s](double u, double v) {
          const double rho = apex.Distance(ad.Value(u, v)), phi = u * s;
          return gp_XY(rho * std::cos(phi), rho * std::sin(phi));
        };
        break;
      }
      default: {
        std::vector<gp_Pnt> pts(n * n);
        for (int i = 0; i < n; i++)
          for (int j = 0; j < n; j++) pts[i * n + j] = ad.Value(u0 + (u1 - u0) * i / (n - 1), v0 + (v1 - v0) * j / (n - 1));
        grid = w3d_lscm(pts, n);
        flat = [&grid, u0, u1, v0, v1](double u, double v) {
          const double a = std::min(std::max((u - u0) / (u1 - u0) * (n - 1), 0.0), double(n - 1));
          const double b = std::min(std::max((v - v0) / (v1 - v0) * (n - 1), 0.0), double(n - 1));
          const int i = std::min(int(a), n - 2), j = std::min(int(b), n - 2);
          const double s = a - i, t = b - j;
          return grid[i * n + j] * ((1 - s) * (1 - t)) + grid[(i + 1) * n + j] * (s * (1 - t)) + grid[(i + 1) * n + j + 1] * (s * t) + grid[i * n + j + 1] * ((1 - s) * t);
        };
      }
    }
    // Keep the face's outward side up: mirror if the flattening turns it over.
    const double um = (u0 + u1) / 2, vm = (v0 + v1) / 2, hu = (u1 - u0) * 1e-3, hv = (v1 - v0) * 1e-3;
    const gp_XY fu = flat(um + hu, vm) - flat(um - hu, vm), fv = flat(um, vm + hv) - flat(um, vm - hv);
    const bool mirror = ((fu ^ fv) < 0) != (face.Orientation() == TopAbs_REVERSED);
    // Turned so the face's v direction runs the way it runs seen from above (a round along an edge
    // lies along the edge), when it isn't straight up; the user's y is the model's -z.
    const gp_Vec dv(ad.Value(um, vm - hv), ad.Value(um, vm + hv));
    const gp_XY seen(dv.X(), -dv.Z()), laid(mirror ? -fv.X() : fv.X(), fv.Y());
    const double turn = seen.Modulus() > 1e-3 * dv.Magnitude() && laid.Modulus() > 1e-12
      ? std::atan2(seen.Y(), seen.X()) - std::atan2(laid.Y(), laid.X()) : 0.0;
    const double ct = std::cos(turn), st = std::sin(turn);
    // Centred under the face's centre.
    const gp_XY mid = flat(um, vm);
    auto place = [&](double u, double v) {
      gp_XY p = flat(u, v) - mid;
      if (mirror) p.SetX(-p.X());
      p = gp_XY(ct * p.X() - st * p.Y(), st * p.X() + ct * p.Y());
      return gp_Pnt(p.X() + centre.X(), 0.0, centre.Z() - p.Y());
    };
    std::vector<TopoDS_Vertex> verts;
    auto vertexAt = [&](const gp_Pnt &p) {
      for (const TopoDS_Vertex &v : verts) if (BRep_Tool::Pnt(v).Distance(p) < 1e-6) return v;
      verts.push_back(BRepBuilderAPI_MakeVertex(p).Vertex());
      return verts.back();
    };
    const TopoDS_Face fwd = TopoDS::Face(face.Oriented(TopAbs_FORWARD));
    const TopoDS_Wire outer = BRepTools::OuterWire(fwd);
    std::vector<TopoDS_Wire> wires;
    for (TopoDS_Iterator wi(fwd); wi.More(); wi.Next()) {
      const TopoDS_Wire w = TopoDS::Wire(wi.Value());
      BRepBuilderAPI_MakeWire mw;
      for (BRepTools_WireExplorer we(w, fwd); we.More(); we.Next()) {
        const TopoDS_Edge e = we.Current();
        double a, b;
        Handle(Geom2d_Curve) c2 = BRep_Tool::CurveOnSurface(e, fwd, a, b);
        if (c2.IsNull()) {
          if (BRep_Tool::Degenerated(e)) continue;
          throw std::runtime_error("an edge of that face has no curve on it");
        }
        // A pole opens out into a line when laid flat; one that stays a point drops out.
        if (BRep_Tool::Degenerated(e) && place(c2->Value(a).X(), c2->Value(a).Y()).Distance(place(c2->Value(b).X(), c2->Value(b).Y())) < 1e-6) continue;
        const int m = 32;
        TColgp_Array1OfPnt pts(1, m + 1);
        for (int i = 0; i <= m; i++) {
          const gp_Pnt2d q = c2->Value(a + (b - a) * i / m);
          pts.SetValue(i + 1, place(q.X(), q.Y()));
        }
        // Straight stays straight.
        bool straight = true;
        const gp_Vec chord(pts(1), pts(m + 1));
        if (chord.Magnitude() < 1e-9) straight = false;
        else for (int i = 2; i <= m && straight; i++) straight = gp_Vec(pts(1), pts(i)).Crossed(chord).Magnitude() / chord.Magnitude() < 1e-7;
        // The edge runs a to b along its curve; in the wire it runs as e is oriented.
        const bool rev = e.Orientation() == TopAbs_REVERSED;
        const gp_Pnt first = rev ? pts(m + 1) : pts(1), last = rev ? pts(1) : pts(m + 1);
        const TopoDS_Vertex vf = vertexAt(first), vl = vertexAt(last);
        TopoDS_Edge ne;
        if (straight) ne = BRepBuilderAPI_MakeEdge(vf, vl).Edge();
        else {
          if (rev) for (int i = 1; i <= (m + 1) / 2; i++) { gp_Pnt t = pts(i); pts.SetValue(i, pts(m + 2 - i)); pts.SetValue(m + 2 - i, t); }
          GeomAPI_PointsToBSpline fit(pts, 3, 8, GeomAbs_C2, 1e-7);
          if (!fit.IsDone()) throw std::runtime_error("an edge of that face could not be laid flat");
          Handle(Geom_BSplineCurve) cv = fit.Curve();
          BRepBuilderAPI_MakeEdge me(cv, vf, vl);
          if (!me.IsDone()) throw std::runtime_error("an edge of that face could not be laid flat");
          ne = me.Edge();
        }
        mw.Add(ne);
        if (!mw.IsDone()) throw std::runtime_error("the face's edges don't join up when laid flat");
      }
      if (w.IsSame(outer)) wires.insert(wires.begin(), mw.Wire());
      else wires.push_back(mw.Wire());
    }
    if (wires.empty()) throw std::runtime_error("that face has no edges to unwrap");
    BRepBuilderAPI_MakeFace mf(gp_Pln(gp_Ax3(gp::Origin(), gp::DY(), gp::DX())), wires[0], true);
    for (size_t i = 1; i < wires.size(); i++) mf.Add(wires[i]);
    if (!mf.IsDone()) throw std::runtime_error("the flat face could not be made");
    ShapeFix_Face fix(mf.Face());
    fix.FixOrientation();
    fix.Perform();
    TopoDS_Shape result = fix.Face();
    if (!w3d_is_valid(result)) throw std::runtime_error("the unwrapped face is not valid");
    return std::unique_ptr<TopoDS_Shape>(new TopoDS_Shape(result));
  } catch (const Standard_Failure &f) {
    throw w3d_kernel_error(f);
  }
}
