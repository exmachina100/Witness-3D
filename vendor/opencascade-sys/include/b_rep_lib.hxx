#include <BRepLib.hxx>
#include <BRepLib_ToolTriangulatedShape.hxx>
#include <TopoDS_Shape.hxx>
#include <bindings_common.hxx>

// Witness 3D: a wrapper, because under MSVC Handle_Poly_Triangulation is a class derived from
// opencascade::handle<Poly_Triangulation>, so the static function can't be bound by pointer.
inline void BRepLib_ToolTriangulatedShape_ComputeNormals(const TopoDS_Face &face,
                                                         const Handle_Poly_Triangulation &triangulation) {
  BRepLib_ToolTriangulatedShape::ComputeNormals(face, triangulation);
}
