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
    let s = k.extend_sheet(&a, e, 5.0).unwrap();
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
    let grown = k.extend_sheet(&s, low, 3.0).unwrap();
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
    let t = k.tessellate(&k.extend_sheet(&s, side, 2.0).unwrap(), 0.0005).unwrap();
    let (lo, hi) = range(&t, 1);
    assert!((lo + 2.0).abs() < 0.01 && (hi - 10.0).abs() < 1e-6, "y {lo}..{hi}");
    let (zlo, zhi) = range(&t, 2);
    assert!(zlo > -1e-6 && zhi < 5.0 + 1e-6, "z {zlo}..{zhi}: widening sideways keeps the profile");
}

#[test]
fn trimmed_edges_solids_and_no_distance_are_refused() {
    let k = Occt;
    let ring = Path::Circle { center: DVec3::ZERO, normal: DVec3::Z, radius: 5.0 };
    let disc = k.patch(&[ring], &[]).unwrap();
    let err = k.extend_sheet(&disc, 0, 2.0).err().expect("refused").to_string();
    assert!(err.contains("trimmed"), "{err}");
    let block = k.box_from_corners(DVec3::ZERO, DVec3::splat(10.0));
    let err = k.extend_sheet(&block, 0, 2.0).err().expect("refused").to_string();
    assert!(err.contains("solid"), "{err}");
    let a = square(&k, 0.0, 0.0);
    assert!(k.extend_sheet(&a, 0, 0.0).is_err());
    assert!(k.extend_sheet(&a, 99, 1.0).is_err());
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
    assert_eq!(doc.commit_extend_sheet(sheet, e, 4.0).unwrap(), sheet);
    let t = doc.kernel.tessellate(doc.get(sheet).unwrap(), 0.001).unwrap();
    assert!((area(&t) - 140.0).abs() < 1e-6, "area {}", area(&t));
    assert!(doc.undo());
    let t = doc.kernel.tessellate(doc.get(sheet).unwrap(), 0.001).unwrap();
    assert!((area(&t) - 100.0).abs() < 1e-6);
}
