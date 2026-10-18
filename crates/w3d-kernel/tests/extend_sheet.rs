//! Extend Sheet (Plasticity's Extend on a sheet's edge): the sheet grown past one open edge,
//! carrying straight on from its face. Units are mm.

#![cfg(feature = "occt")]

use glam::DVec3;
use opencascade::primitives::Shape;
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

fn square(k: &Occt, x0: f64, z: f64) -> Shape {
    let c = [DVec3::new(x0, 0.0, z), DVec3::new(x0 + 10.0, 0.0, z), DVec3::new(x0 + 10.0, 10.0, z), DVec3::new(x0, 10.0, z)];
    k.patch(&[Path::Polyline { points: c.to_vec(), closed: true }], &[]).unwrap()
}

/// The edge of `s` whose polyline lies where `on` holds for every point.
fn edge_where(k: &Occt, s: &Shape, on: impl Fn(&[f64; 3]) -> bool) -> u32 {
    let t = k.tessellate(s, 0.01).unwrap();
    t.edges.iter().position(|e| e.iter().all(&on)).expect("no such edge") as u32
}

fn area(t: &Tessellation) -> f64 {
    t.indices.chunks_exact(3).map(|i| {
        let [a, b, c] = [0, 1, 2].map(|k| DVec3::from(t.positions[i[k] as usize]));
        (b - a).cross(c - a).length() / 2.0
    }).sum()
}

fn range(t: &Tessellation, axis: usize) -> (f64, f64) {
    t.positions.iter().fold((f64::MAX, f64::MIN), |(lo, hi), p| (lo.min(p[axis]), hi.max(p[axis])))
}

#[test]
fn a_flat_sheet_grows_past_its_edge_in_its_plane() {
    let k = Occt;
    let a = square(&k, 0.0, 0.0);
    let e = edge_where(&k, &a, |p| (p[0] - 10.0).abs() < 1e-9);
    let s = k.extend_sheet(&a, e, 5.0, SheetExtension::Linear).unwrap();
    assert!(k.is_valid(&s) && k.is_sheet(&s));
    assert_eq!(k.face_count(&s), 1, "one face, not a strip beside it");
    let t = k.tessellate(&s, 0.001).unwrap();
    assert!((area(&t) - 150.0).abs() < 1e-6, "area {}", area(&t));
    let (lo, hi) = range(&t, 0);
    assert!(lo.abs() < 1e-9 && (hi - 15.0).abs() < 1e-9, "x {lo}..{hi}");
    assert!(t.positions.iter().all(|p| p[2].abs() < 1e-9));
}

#[test]
fn a_curved_sheet_carries_straight_on_from_its_edge() {
    let k = Occt;
    // A bridge from z = 0 at x = 10 up to z = 5 at x = 20, level where it leaves each square.
    let (a, b) = (square(&k, 0.0, 0.0), square(&k, 20.0, 5.0));
    let ea = edge_where(&k, &a, |p| (p[0] - 10.0).abs() < 1e-9);
    let eb = edge_where(&k, &b, |p| (p[0] - 20.0).abs() < 1e-9);
    let s = k.bridge_surface((&a, ea), (&b, eb), false, 1.0).unwrap();
    let low = edge_where(&k, &s, |p| (p[0] - 10.0).abs() < 1e-6 && p[2].abs() < 1e-6);
    let grown = k.extend_sheet(&s, low, 3.0, SheetExtension::Linear).unwrap();
    assert!(k.is_valid(&grown));
    assert_eq!(k.face_count(&grown), 1);
    let t = k.tessellate(&grown, 0.0005).unwrap();
    // Back along the level it left A at: 3 mm on, still level.
    let (lo, hi) = range(&t, 0);
    assert!((lo - 7.0).abs() < 0.01 && (hi - 20.0).abs() < 1e-6, "x {lo}..{hi}");
    for p in t.positions.iter().filter(|p| p[0] < 10.0) {
        assert!(p[2].abs() < 1e-3, "{p:?} is not level past the edge");
    }
    // Sideways off the edge at y = 0, the sheet widens by 2 along its whole run.
    let side = edge_where(&k, &s, |p| p[1].abs() < 1e-6);
    let t = k.tessellate(&k.extend_sheet(&s, side, 2.0, SheetExtension::Linear).unwrap(), 0.0005).unwrap();
    let (lo, hi) = range(&t, 1);
    assert!((lo + 2.0).abs() < 0.01 && (hi - 10.0).abs() < 1e-6, "y {lo}..{hi}");
    let (zlo, zhi) = range(&t, 2);
    assert!(zlo > -1e-6 && zhi < 5.0 + 1e-6, "z {zlo}..{zhi}: widening sideways keeps the profile");
}

#[test]
fn natural_bends_on_with_the_sheet_where_linear_goes_straight() {
    let k = Occt;
    let (a, b) = (square(&k, 0.0, 0.0), square(&k, 20.0, 5.0));
    let ea = edge_where(&k, &a, |p| (p[0] - 10.0).abs() < 1e-9);
    let eb = edge_where(&k, &b, |p| (p[0] - 20.0).abs() < 1e-9);
    let s = k.bridge_surface((&a, ea), (&b, eb), false, 1.0).unwrap();
    let low = edge_where(&k, &s, |p| (p[0] - 10.0).abs() < 1e-6 && p[2].abs() < 1e-6);
    // The bridge curves up away from its low edge, so carried on backwards it rises again.
    let rise = |natural| {
        let t = k.tessellate(&k.extend_sheet(&s, low, 3.0, if natural { SheetExtension::Natural } else { SheetExtension::Linear }).unwrap(), 0.0005).unwrap();
        t.positions.iter().filter(|p| p[0] < 10.0 - 1e-6).map(|p| p[2]).fold(0.0, f64::max)
    };
    let (straight, bent) = (rise(false), rise(true));
    assert!(straight < 1e-3, "linear stays level: {straight}");
    assert!(bent > 0.01, "natural follows the curvature: {bent}");
}

/// The bridge from `natural_bends_on…` and its low edge (x = 10, z = 0), where it leaves level.
fn bridge(k: &Occt) -> (Shape, u32) {
    let (a, b) = (square(k, 0.0, 0.0), square(k, 20.0, 5.0));
    let ea = edge_where(k, &a, |p| (p[0] - 10.0).abs() < 1e-9);
    let eb = edge_where(k, &b, |p| (p[0] - 20.0).abs() < 1e-9);
    let s = k.bridge_surface((&a, ea), (&b, eb), false, 1.0).unwrap();
    let low = edge_where(k, &s, |p| (p[0] - 10.0).abs() < 1e-6 && p[2].abs() < 1e-6);
    (s, low)
}

/// The extension's points (those past the low edge) and the angle where it meets the sheet.
fn past_low_edge(k: &Occt, grown: &Shape) -> (Vec<[f64; 3]>, f64) {
    assert!(k.is_valid(grown) && k.is_sheet(grown));
    assert_eq!(k.face_count(grown), 2, "a face of its own beside the sheet's");
    let t = k.tessellate(grown, 0.0005).unwrap();
    let join = edge_where(k, grown, |p| (p[0] - 10.0).abs() < 1e-6 && p[2].abs() < 1e-6);
    let angle = k.edge_angles(grown)[join as usize];
    (t.positions.into_iter().filter(|p| p[0] < 10.0 - 1e-6).collect(), angle)
}

#[test]
fn soft_leaves_tangent_with_its_curvature_fading_out() {
    let k = Occt;
    let (s, low) = bridge(&k);
    let (pts, angle) = past_low_edge(&k, &k.extend_sheet(&s, low, 3.0, SheetExtension::Soft).unwrap());
    assert!(angle >= 0.0 && angle < 0.01, "tangent where it leaves: {angle}°");
    let lo = pts.iter().map(|p| p[0]).fold(f64::MAX, f64::min);
    assert!((lo - 7.0).abs() < 0.05, "3 mm on: x down to {lo}");
    // The bridge curves up from the edge by about 1 mm in 3; carrying that bend on undiminished
    // would rise the same, and Soft's fading bend about two thirds of it.
    let soft = pts.iter().map(|p| p[2]).fold(0.0, f64::max);
    let t = k.tessellate(&s, 0.0005).unwrap();
    let inside = t.positions.iter().filter(|p| p[0] < 13.0).map(|p| p[2]).fold(0.0, f64::max);
    assert!(soft > 0.5 * inside && soft < 0.85 * inside, "soft rises {soft}, the bridge {inside}");
}

#[test]
fn reflective_turns_the_sheet_through_its_edge() {
    let k = Occt;
    let (s, low) = bridge(&k);
    let (pts, angle) = past_low_edge(&k, &k.extend_sheet(&s, low, 3.0, SheetExtension::Reflective).unwrap());
    assert!(angle >= 0.0 && angle < 0.01, "tangent where it leaves: {angle}°");
    // The bridge rises inside the edge, so its reflection falls outside it, as deep as the bridge
    // rises over the same run inside it; 3 mm along the curving sheet is a little under 3 in x.
    let fall = pts.iter().map(|p| p[2]).fold(0.0, f64::min);
    let lo = pts.iter().map(|p| p[0]).fold(f64::MAX, f64::min);
    assert!(lo > 7.0 && lo < 7.3, "3 mm along the sheet: x down to {lo}");
    let t = k.tessellate(&s, 0.0005).unwrap();
    let inside = t.positions.iter().filter(|p| p[0] < 20.0 - lo + 1e-6).map(|p| p[2]).fold(0.0, f64::max);
    assert!(fall < -0.01 && (fall + inside).abs() < 0.01, "falls {fall}, the bridge rises {inside}");
    let err = k.extend_sheet(&s, low, 50.0, SheetExtension::Reflective).err().expect("refused").to_string();
    assert!(err.contains("extend less"), "{err}");
}

#[test]
fn trimmed_edges_solids_and_no_distance_are_refused() {
    let k = Occt;
    let ring = Path::Circle { center: DVec3::ZERO, normal: DVec3::Z, radius: 5.0 };
    let disc = k.patch(&[ring], &[]).unwrap();
    let err = k.extend_sheet(&disc, 0, 2.0, SheetExtension::Linear).err().expect("refused").to_string();
    assert!(err.contains("trimmed"), "{err}");
    let block = k.box_from_corners(DVec3::ZERO, DVec3::splat(10.0));
    let err = k.extend_sheet(&block, 0, 2.0, SheetExtension::Linear).err().expect("refused").to_string();
    assert!(err.contains("solid"), "{err}");
    let a = square(&k, 0.0, 0.0);
    assert!(k.extend_sheet(&a, 0, 0.0, SheetExtension::Linear).is_err());
    assert!(k.extend_sheet(&a, 99, 1.0, SheetExtension::Linear).is_err());
}

#[test]
fn the_document_extends_the_sheet_in_its_body_in_one_undo_step() {
    use w3d_kernel::document::{Curve, CurveShape, Document};
    let mut doc = Document::new(Occt);
    let rect = Curve { origin: [0.0, 0.0, 0.0], x: [1.0, 0.0, 0.0], normal: [0.0, 0.0, 1.0], shape: CurveShape::Polyline { points: vec![[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]], closed: true } };
    let id = doc.commit_curves(vec![rect]).unwrap()[0];
    let sheet = doc.commit_patch(&[id], &[]).unwrap();
    doc.clear_history();
    let e = edge_where(&doc.kernel, doc.get(sheet).unwrap(), |p| (p[1] - 10.0).abs() < 1e-9);
    assert_eq!(doc.commit_extend_sheet(sheet, e, 4.0, SheetExtension::Linear, None, false).unwrap(), sheet);
    let t = doc.kernel.tessellate(doc.get(sheet).unwrap(), 0.001).unwrap();
    assert!((area(&t) - 140.0).abs() < 1e-6, "area {}", area(&t));
    assert!(doc.undo());
    let t = doc.kernel.tessellate(doc.get(sheet).unwrap(), 0.001).unwrap();
    assert!((area(&t) - 100.0).abs() < 1e-6);
}

#[test]
fn limit_carries_the_sheet_on_until_it_meets_the_body() {
    use w3d_kernel::solids::{primitive, Primitive};
    let k = Occt;
    let a = square(&k, 0.0, 0.0);
    let e = edge_where(&k, &a, |p| (p[0] - 10.0).abs() < 1e-9);
    // A wall standing square across the sheet's path at x = 20: the sheet reaches it and stops.
    let wall = k.box_from_corners(DVec3::new(20.0, -5.0, -5.0), DVec3::new(30.0, 15.0, 5.0));
    let s = k.extend_sheet_to(&a, e, &wall, SheetExtension::Linear, false).unwrap();
    assert!(k.is_valid(&s) && k.is_sheet(&s));
    let t = k.tessellate(&s, 0.001).unwrap();
    assert!((area(&t) - 200.0).abs() < 1e-6, "area {}", area(&t));
    // A round post lying across the path (axis along y at x = 30, radius 8): the sheet stops at its
    // near side, x = 22, and nothing of it carries on inside or beyond.
    let post = primitive(&k, &Primitive::Cylinder { frame: Frame::new(DVec3::new(30.0, -5.0, 0.0), DVec3::X, DVec3::Y), radius: 8.0, height: 20.0 }).unwrap();
    let t = k.tessellate(&k.extend_sheet_to(&a, e, &post, SheetExtension::Linear, false).unwrap(), 0.001).unwrap();
    let (lo, hi) = range(&t, 0);
    assert!(lo.abs() < 1e-9 && (hi - 22.0).abs() < 1e-6, "x {lo}..{hi}");
    assert!((area(&t) - 220.0).abs() < 1e-6, "area {}", area(&t));
    // Natural and Soft reach it too; Reflective cannot, and a body off to the side is never met.
    for shape in [SheetExtension::Natural, SheetExtension::Soft] {
        let s = k.extend_sheet_to(&a, e, &wall, shape, false).unwrap_or_else(|e| panic!("{shape:?}: {e}"));
        assert!(k.is_valid(&s), "{shape:?}");
        assert!((range(&k.tessellate(&s, 0.001).unwrap(), 0).1 - 20.0).abs() < 1e-6, "{shape:?}");
    }
    let err = k.extend_sheet_to(&a, e, &wall, SheetExtension::Reflective, false).err().expect("refused").to_string();
    assert!(err.contains("reflective"), "{err}");
    let above = k.box_from_corners(DVec3::new(20.0, -5.0, 10.0), DVec3::new(30.0, 15.0, 20.0));
    let err = k.extend_sheet_to(&a, e, &above, SheetExtension::Linear, false).err().expect("refused").to_string();
    assert!(err.contains("never meets"), "{err}");
}

#[test]
fn outside_carries_the_sheet_on_through_the_body() {
    use w3d_kernel::solids::{primitive, Primitive};
    let k = Occt;
    let a = square(&k, 0.0, 0.0);
    let e = edge_where(&k, &a, |p| (p[0] - 10.0).abs() < 1e-9);
    // The round post across the path (x 22..38 at the sheet): Outside goes on to its far side.
    let post = primitive(&k, &Primitive::Cylinder { frame: Frame::new(DVec3::new(30.0, -5.0, 0.0), DVec3::X, DVec3::Y), radius: 8.0, height: 20.0 }).unwrap();
    let s = k.extend_sheet_to(&a, e, &post, SheetExtension::Linear, true).unwrap();
    assert!(k.is_valid(&s));
    let t = k.tessellate(&s, 0.001).unwrap();
    let (lo, hi) = range(&t, 0);
    assert!(lo.abs() < 1e-9 && (hi - 38.0).abs() < 1e-6, "x {lo}..{hi}");
    assert!((area(&t) - 380.0).abs() < 1e-6, "area {}", area(&t));
}

#[test]
fn a_sheet_already_crossing_the_body_keeps_all_of_itself() {
    let k = Occt;
    let a = square(&k, 0.0, 0.0);
    let e = edge_where(&k, &a, |p| (p[0] - 10.0).abs() < 1e-9);
    // A block over x 5..15: the edge is inside it. Minimal stops where the extension comes out
    // (x = 15) and keeps the sheet's own part outside the block (x 0..5) too.
    let block = k.box_from_corners(DVec3::new(5.0, -5.0, -5.0), DVec3::new(15.0, 15.0, 5.0));
    let t = k.tessellate(&k.extend_sheet_to(&a, e, &block, SheetExtension::Linear, false).unwrap(), 0.001).unwrap();
    let (lo, hi) = range(&t, 0);
    assert!(lo.abs() < 1e-9 && (hi - 15.0).abs() < 1e-6, "x {lo}..{hi}");
    assert!((area(&t) - 150.0).abs() < 1e-6, "area {}", area(&t));
}
