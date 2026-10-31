//! Boolean's Target Material and Tool Material.
#![cfg(feature = "occt")]

use glam::DVec3;
use w3d_kernel::document::Document;
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

fn vol(doc: &Document<Occt>, s: &<Occt as Kernel>::Solid) -> f64 {
    (doc.kernel.tessellate(s, 0.01).unwrap().volume() * 1000.0).round() / 1000.0
}

fn setup() -> (Document<Occt>, u32, u32, u32) {
    let mut doc = Document::new(Occt);
    let block = doc.add(doc.kernel.box_from_corners(DVec3::ZERO, DVec3::splat(10.0)));
    let sheet = doc.add(doc.kernel.plane_sheet(DVec3::new(5.0, 5.0, 3.0), DVec3::Z, 20.0).unwrap());
    let small = doc.add(doc.kernel.box_from_corners(DVec3::splat(5.0), DVec3::splat(15.0)));
    (doc, block, sheet, small)
}

const fn tool(m: Material) -> Materials { Materials { target: Material::Default, tool: m } }

#[test]
fn a_sheet_tool_inside_or_outside_cuts_one_side() {
    let (doc, block, sheet, _) = setup();
    let inside = doc.preview_boolean_as(block, &[sheet], BooleanOp::Difference, tool(Material::Inside)).unwrap();
    assert_eq!(vol(&doc, &inside.solid), 700.0);
    let outside = doc.preview_boolean_as(block, &[sheet], BooleanOp::Difference, tool(Material::Outside)).unwrap();
    assert_eq!(vol(&doc, &outside.solid), 300.0);
    let common = doc.preview_boolean_as(block, &[sheet], BooleanOp::Intersection, tool(Material::Inside)).unwrap();
    assert_eq!(vol(&doc, &common.solid), 300.0);
}

#[test]
fn outside_a_solid_and_endless_results() {
    let (doc, block, _, small) = setup();
    let t = doc.preview_boolean_as(block, &[small], BooleanOp::Difference, tool(Material::Outside)).unwrap();
    assert_eq!(vol(&doc, &t.solid), 125.0);
    assert!(doc.preview_boolean_as(block, &[small], BooleanOp::Union, tool(Material::Outside)).is_err());
}

#[test]
fn an_empty_target_keeps_its_skin() {
    let (doc, block, _, small) = setup();
    let t = doc.preview_boolean_as(block, &[small], BooleanOp::Difference, Materials { target: Material::Empty, tool: Material::Default }).unwrap();
    assert!(doc.kernel.face_count(&t.solid) >= 6);
    assert!(doc.kernel.is_sheet(&t.solid));
    assert!(!doc.kernel.boundary_edges(&t.solid).is_empty());
}
