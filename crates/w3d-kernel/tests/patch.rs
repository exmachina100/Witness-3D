//! Patch (Plasticity's Patch, and the fill its Xnurbs tool makes): a sheet filling a closed loop
//! of curves and body edges. Measured against the kernel-strategy bar: the sheet meets its
//! boundary to well under 0.01 mm, and a tangent edge leaves the body's face smoothly. Units are mm.

#![cfg(feature = "occt")]

use glam::DVec3;
use opencascade::primitives::Shape;
use w3d_kernel::occt::Occt;
use w3d_kernel::solids::primitive;
use w3d_kernel::*;

fn line(a: DVec3, b: DVec3) -> Path { Path::Polyline { points: vec![a, b], closed: false } }

fn area(t: &Tessellation) -> f64 {
    t.indices.chunks_exact(3).map(|i| {
        let [a, b, c] = [0, 1, 2].map(|k| DVec3::from(t.positions[i[k] as usize]));
        (b - a).cross(c - a).length() / 2.0
    }).sum()
}

/// How far `p` lies from the segment `a`–`b`.
fn along(a: DVec3, b: DVec3, p: DVec3) -> f64 {
    let t = ((p - a).dot(b - a) / (b - a).length_squared()).clamp(0.0, 1.0);
    (a + (b - a) * t).distance(p)
}

/// The four sides of a square of side 10 whose corners rise to `lift`, alternately up and down.
fn saddle(lift: f64) -> Vec<Path> {
    let c = [DVec3::new(0.0, 0.0, lift), DVec3::new(10.0, 0.0, -lift), DVec3::new(10.0, 10.0, lift), DVec3::new(0.0, 10.0, -lift)];
    (0..4).map(|i| line(c[i], c[(i + 1) % 4])).collect()
}

/// The edges of `s` whose polylines lie at height `z` (within 1e-6).
fn edges_at(k: &Occt, s: &Shape, z: f64) -> Vec<u32> {
    let t = k.tessellate(s, 0.01).unwrap();
    t.edges.iter().enumerate().filter(|(_, e)| e.iter().all(|p| (p[2] - z).abs() < 1e-6)).map(|(i, _)| i as u32).collect()
}

#[test]
fn a_flat_loop_is_filled_with_its_plane() {
    let k = Occt;
    let sheet = k.patch(&saddle(0.0), &[]).unwrap();
    assert_eq!(k.face_count(&sheet), 1);
    let t = k.tessellate(&sheet, 0.001).unwrap();
    assert!((area(&t) - 100.0).abs() < 1e-6, "area {}", area(&t));
    assert!(t.face_planes[0].is_some(), "the patch is flat");
    assert!(t.positions.iter().all(|p| p[2].abs() < 1e-9));

    // One closed curve is a loop too.
    let ring = Path::Circle { center: DVec3::ZERO, normal: DVec3::Z, radius: 5.0 };
    let disc = k.tessellate(&k.patch(&[ring], &[]).unwrap(), 0.0001).unwrap();
    assert!((area(&disc) - std::f64::consts::PI * 25.0).abs() < 0.01, "area {}", area(&disc));
}

#[test]
fn a_twisted_loop_is_filled_with_a_smooth_sheet_through_it() {
    let k = Occt;
    let sheet = k.patch(&saddle(2.0), &[]).unwrap();
    assert!(k.is_valid(&sheet));
    let t = k.tessellate(&sheet, 0.001).unwrap();
    assert!(t.face_planes[0].is_none(), "not flat");
    // A saddle: the middle sits level between the corners, and nothing bulges past them.
    for p in &t.positions {
        assert!(p[2].abs() < 2.0 + 1e-3, "{p:?} bulges past the corners");
        assert!(p[0] > -1e-3 && p[0] < 10.0 + 1e-3 && p[1] > -1e-3 && p[1] < 10.0 + 1e-3);
    }
    let middle = t.positions.iter().min_by(|a, b| {
        let d = |p: &[f64; 3]| (p[0] - 5.0).hypot(p[1] - 5.0);
        d(a).total_cmp(&d(b))
    }).unwrap();
    assert!(middle[2].abs() < 0.05, "the middle is at {}", middle[2]);
    // Its boundary is the loop: every sampled point of the sides lies on a sheet edge.
    let sides: Vec<DVec3> = saddle(2.0).iter().flat_map(|p| k.sample(p, 20).unwrap()).collect();
    for s in sides {
        let gap = t.edges.iter().flat_map(|e| e.windows(2)).map(|w| along(DVec3::from(w[0]), DVec3::from(w[1]), s)).fold(f64::INFINITY, f64::min);
        assert!(gap < 0.01, "the sheet's edge misses the loop by {gap}");
    }
}

#[test]
fn edges_of_a_body_close_a_hole_flat_or_tangent() {
    let k = Occt;
    // A can of radius 5, 5 high, its wall leaning in by 30 degrees: the top rim is one circle.
    let frame = Frame::new(DVec3::ZERO, DVec3::X, DVec3::Z);
    let ring = Profile::Circle { center: (0.0, 0.0), radius: 5.0 };
    let lean = 30f64.to_radians();
    let can = k.extrude(&ring, &frame, &Extent { distance: 5.0, back: 0.0, angle: lean, thickness: 0.0 }).unwrap();
    let rim = edges_at(&k, &can, 5.0);
    assert_eq!(rim.len(), 1);
    let r = 5.0 - 5.0 * lean.tan();

    let flat = k.patch(&[], &[(&can, vec![(rim[0], false)])]).unwrap();
    let t = k.tessellate(&flat, 0.0001).unwrap();
    assert!(t.positions.iter().all(|p| (p[2] - 5.0).abs() < 1e-9), "a lid in the top's plane");
    assert!((area(&t) - std::f64::consts::PI * r * r).abs() < 0.01);

    // Tangent to the wall, the lid carries on its lean and rounds over: a dome.
    let dome = k.patch(&[], &[(&can, vec![(rim[0], true)])]).unwrap();
    assert!(k.is_valid(&dome));
    let t = k.tessellate(&dome, 0.0005).unwrap();
    let top = t.positions.iter().map(|p| p[2]).fold(f64::MIN, f64::max);
    assert!(top > 5.5, "the dome rises to {top}");
    for p in &t.positions { assert!(p[0].hypot(p[1]) < r + 1e-3, "{p:?} outside the rim") }
    // Just inside the rim it rises at the wall's slope: tan(60°) up per unit in.
    let near: Vec<&[f64; 3]> = t.positions.iter().filter(|p| (r - p[0].hypot(p[1]) - 0.1).abs() < 0.05).collect();
    assert!(!near.is_empty());
    for p in near {
        let slope = (p[2] - 5.0) / (r - p[0].hypot(p[1]));
        assert!((slope - 60f64.to_radians().tan()).abs() < 0.35, "slope {slope} near the rim");
    }

    // A wall standing square to the rim is too steep for a plate: refused with the reason.
    let upright = primitive(&k, &Primitive::Cylinder { frame, radius: 5.0, height: 10.0 }).unwrap();
    let rim = edges_at(&k, &upright, 10.0);
    let err = k.patch(&[], &[(&upright, vec![(rim[0], true)])]).err().expect("refused").to_string();
    assert!(err.contains("off tangent"), "{err}");
}

#[test]
fn curves_and_edges_mix_in_one_loop() {
    let k = Occt;
    // A block's top front edge (y = 0, z = 10) closed by three drawn lines rising in front of it.
    let block = k.box_from_corners(DVec3::ZERO, DVec3::new(10.0, 10.0, 10.0));
    let t = k.tessellate(&block, 0.01).unwrap();
    let front = t.edges.iter().position(|e| e.iter().all(|p| p[1].abs() < 1e-9 && (p[2] - 10.0).abs() < 1e-9)).unwrap() as u32;
    let a = DVec3::new(0.0, 0.0, 10.0);
    let b = DVec3::new(10.0, 0.0, 10.0);
    let curves = [line(b, DVec3::new(10.0, -5.0, 15.0)), line(DVec3::new(10.0, -5.0, 15.0), DVec3::new(0.0, -5.0, 15.0)), line(DVec3::new(0.0, -5.0, 15.0), a)];
    let sheet = k.patch(&curves, &[(&block, vec![(front, false)])]).unwrap();
    let t = k.tessellate(&sheet, 0.001).unwrap();
    assert!((area(&t) - 10.0 * 50f64.sqrt()).abs() < 1e-6, "a flat ramp, area {}", area(&t));
}

#[test]
fn an_open_loop_is_refused() {
    let k = Occt;
    let mut sides = saddle(0.0);
    sides.pop();
    let err = k.patch(&sides, &[]).err().expect("refused").to_string();
    assert!(err.contains("open") || err.contains("one loop"), "{err}");
    assert!(k.patch(&[], &[]).is_err());
}

#[test]
fn the_document_keeps_a_patch_as_a_sheet_body_in_one_undo_step() {
    use w3d_kernel::document::{Curve, CurveShape, Document};
    let mut doc = Document::new(Occt);
    let ring = Curve { origin: [0.0, 0.0, 0.0], x: [1.0, 0.0, 0.0], normal: [0.0, 0.0, 1.0], shape: CurveShape::Circle { center: [0.0, 0.0], radius: 3.0 } };
    let id = doc.commit_curves(vec![ring]).unwrap()[0];
    doc.clear_history();
    let sheet = doc.commit_patch(&[id], &[]).unwrap();
    assert_eq!(doc.curve_ids(), vec![id], "the loop stays");
    let t = doc.kernel.tessellate(doc.get(sheet).unwrap(), 0.0001).unwrap();
    assert!((area(&t) - std::f64::consts::PI * 9.0).abs() < 0.01);
    assert!(doc.undo());
    assert!(doc.get(sheet).is_none());
}

#[test]
fn find_boundary_edges_lists_a_sheets_open_sides_and_none_on_a_solid() {
    let k = Occt;
    let sheet = k.patch(&saddle(0.0), &[]).unwrap();
    let mut open = k.boundary_edges(&sheet);
    open.sort();
    assert_eq!(open, (0..k.edge_count(&sheet) as u32).collect::<Vec<_>>(), "every side of one face is open");
    assert_eq!(open.len(), 4);
    // A disc's rim is one edge, and a closed solid has none.
    let ring = Path::Circle { center: DVec3::ZERO, normal: DVec3::Z, radius: 5.0 };
    assert_eq!(k.boundary_edges(&k.patch(&[ring], &[]).unwrap()).len(), 1);
    assert!(k.boundary_edges(&k.box_from_corners(DVec3::ZERO, DVec3::splat(10.0))).is_empty());
    let cyl = primitive(&k, &w3d_kernel::solids::Primitive::Cylinder { frame: Frame::new(DVec3::ZERO, DVec3::X, DVec3::Z), radius: 3.0, height: 5.0 }).unwrap();
    assert!(k.boundary_edges(&cyl).is_empty(), "a cylinder's seam is not open");
}
