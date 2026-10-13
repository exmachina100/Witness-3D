#include <ShapeAnalysis.hxx>
#include <ShapeAnalysis_FreeBounds.hxx>
#include <TopTools_HSequenceOfShape.hxx>
#include <bindings_common.hxx>

// Witness 3D: wrapped, because under MSVC Handle_TopTools_HSequenceOfShape is a class derived from
// opencascade::handle<TopTools_HSequenceOfShape>, so the static function can't be bound by pointer.
inline void ShapeAnalysis_FreeBounds_ConnectEdgesToWires(Handle_TopTools_HSequenceOfShape &edges, double tolerance,
                                                        bool shared, Handle_TopTools_HSequenceOfShape &wires) {
  ShapeAnalysis_FreeBounds::ConnectEdgesToWires(edges, tolerance, shared, wires);
}
