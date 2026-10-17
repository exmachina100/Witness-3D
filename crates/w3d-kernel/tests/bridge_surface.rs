//! Bridge Surface (Plasticity's): a sheet from one edge to another, leaving each tangent to its
//! face. Measured against the kernel-strategy bar: the bridge meets both edges to well under
//! 0.01 mm and leaves each face within 0.5 degrees. Units are mm.

#![cfg(feature = "occt")]

use glam::DVec3;
use opencascade::primitives::Shape;
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

fn square(k: &Occt, x0: f64, z: f64) -> Shape {
    let c = [DVec3::new(x0, 0.0, z), DVec3::new(x0 + 10.0, 0.0, z), DVec3::new(x0 + 10.0, 10.0, z), DVec3::new(x0, 10.0, z)];
    k.patch(&[Path::Polyline { points: c.to_vec(), closed: true }], &[]).unwrap()
}

/// The edge of `s` whose polyline lies on x = `x`.
fn edge_at_x(k: &Occt, s: &Shape, x: f64) -> u32 {
    let t = k.tessellate(s, 0.01).unwrap();
    t.edges.iter().position(|e| e.iter().all(|p| (p[0] - x).abs() < 1e-9)).unwrap() as u32
}

fn area(t: &Tessellation) -> f64 {
    t.indices.chunks_exact(3).map(|i| {
        let [a, b, c] = [0, 1, 2].map(|k| DVec3::from(t.positions[i[k] as usize]));
        (b - a).cross(c - a).length() / 2.0
    }).sum()
}

#[test]
fn level_sheets_bridge_flat() {
    let k = Occt;
    let (a, b) = (square(&k, 0.0, 0.0), square(&k, 20.0, 0.0));
    let s = k.bridge_surface((&a, edge_at_x(&k, &a, 10.0)), (&b, edge_at_x(&k, &b, 20.0)), false, 1.0).unwrap();
    let t = k.tessellate(&s, 0.001).unwrap();
    for p in &t.positions {
        assert!(p[2].abs() < 1e-6, "{p:?} off the plane");
        assert!(p[0] > 10.0 - 1e-4 && p[0] < 20.0 + 1e-4);
    }
    assert!((area(&t) - 100.0).abs() < 1e-3, "area {}", area(&t));
}

#[test]
fn a_step_bridges_with_an_s_leaving_each_sheet_level() {
    let k = Occt;
    let (a, b) = (square(&k, 0.0, 0.0), square(&k, 20.0, 5.0));
    let s = k.bridge_surface((&a, edge_at_x(&k, &a, 10.0)), (&b, edge_at_x(&k, &b, 20.0)), false, 1.0).unwrap();
    assert!(k.is_valid(&s));
    let t = k.tessellate(&s, 0.0005).unwrap();
    // It meets both edges: its own edges include lines at x = 10, z = 0 and x = 20, z = 5.
    let meets = |x: f64, z: f64| t.edges.iter().any(|e| e.iter().all(|p| (p[0] - x).abs() < 0.01 && (p[2] - z).abs() < 0.01));
    assert!(meets(10.0, 0.0) && meets(20.0, 5.0));
    // Level where it leaves each sheet: the slope just off each edge is near zero (G1).
    for p in &t.positions {
        if p[0] > 10.0 && p[0] < 10.3 { assert!(p[2] / (p[0] - 10.0).max(1e-9) < (0.5f64.to_radians()).tan() + 0.06, "{p:?} rises too fast off A") }
        if p[0] < 20.0 && p[0] > 19.7 { assert!((5.0 - p[2]) / (20.0 - p[0]).max(1e-9) < (0.5f64.to_radians()).tan() + 0.06, "{p:?} too steep into B") }
        assert!(p[2] > -1e-6 && p[2] < 5.0 + 1e-6, "{p:?} overshoots");
    }
    // More tension carries each side further before it turns: steeper in the middle.
    let mid = |s: &Shape| {
        let t = k.tessellate(s, 0.0005).unwrap();
        let near: Vec<&[f64; 3]> = t.positions.iter().filter(|p| (p[0] - 15.0).abs() < 0.3).collect();
        let (lo, hi) = near.iter().fold((f64::MAX, f64::MIN), |(lo, hi), p| (lo.min(p[2]), hi.max(p[2])));
        (hi - lo, near.len())
    };
    let taut = k.bridge_surface((&a, edge_at_x(&k, &a, 10.0)), (&b, edge_at_x(&k, &b, 20.0)), false, 2.0).unwrap();
    let ((soft, n1), (steep, n2)) = (mid(&s), mid(&taut));
    assert!(n1 > 0 && n2 > 0);
    assert!(steep > soft, "tension 2 rises {steep} over the middle, tension 1 {soft}");
}

#[test]
fn edges_pair_end_to_end_without_a_twist() {
    let k = Occt;
    // B's edge at x = 20 runs the other way round its square from A's at x = 10: no twist anyway.
    let a = square(&k, 0.0, 0.0);
    let c = [DVec3::new(20.0, 10.0, 0.0), DVec3::new(30.0, 10.0, 0.0), DVec3::new(30.0, 0.0, 0.0), DVec3::new(20.0, 0.0, 0.0)];
    let b = k.patch(&[Path::Polyline { points: c.to_vec(), closed: true }], &[]).unwrap();
    let s = k.bridge_surface((&a, edge_at_x(&k, &a, 10.0)), (&b, edge_at_x(&k, &b, 20.0)), false, 1.0).unwrap();
    let t = k.tessellate(&s, 0.001).unwrap();
    assert!((area(&t) - 100.0).abs() < 1e-3, "twisted: area {}", area(&t));
}

#[test]
fn two_rims_bridge_round_with_a_closed_sheet() {
    let k = Occt;
    let disc = |z: f64| k.patch(&[Path::Circle { center: DVec3::new(0.0, 0.0, z), normal: DVec3::Z, radius: 5.0 }], &[]).unwrap();
    let (a, b) = (disc(0.0), disc(10.0));
    let s = k.bridge_surface((&a, 0), (&b, 0), false, 1.0).unwrap();
    assert!(k.is_valid(&s));
    let t = k.tessellate(&s, 0.001).unwrap();
    // Leaving each disc outwards, the hoop bulges past the rims, the same all round.
    let waist: Vec<f64> = t.positions.iter().filter(|p| (p[2] - 5.0).abs() < 0.2).map(|p| p[0].hypot(p[1])).collect();
    assert!(!waist.is_empty());
    let (lo, hi) = waist.iter().fold((f64::MAX, f64::MIN), |(lo, hi), r| (lo.min(*r), hi.max(*r)));
    assert!(lo > 5.5, "the middle is at radius {lo}");
    assert!(hi - lo < 0.05, "uneven round: {lo}..{hi}");
    // Its rims are the discs' rims, within the bar.
    for e in &t.edges {
        for p in e {
            if p[2].abs() < 1e-6 || (p[2] - 10.0).abs() < 1e-6 {
                assert!((p[0].hypot(p[1]) - 5.0).abs() < 0.01, "{p:?} off the rim");
            }
        }
    }
}

#[test]
fn loose_or_mismatched_edges_are_refused() {
    let k = Occt;
    let a = square(&k, 0.0, 0.0);
    assert!(k.bridge_surface((&a, 0), (&a, 0), true, 1.0).is_err());
    let ring = k.patch(&[Path::Circle { center: DVec3::new(20.0, 0.0, 0.0), normal: DVec3::Z, radius: 3.0 }], &[]).unwrap();
    let err = k.bridge_surface((&a, 0), (&ring, 0), false, 1.0).err().expect("refused").to_string();
    assert!(err.contains("open edges or two closed"), "{err}");
}

#[test]
fn the_document_keeps_a_bridge_as_a_sheet_body_in_one_undo_step() {
    use w3d_kernel::document::Document;
    let mut doc = Document::new(Occt);
    let a = doc.add(square(&doc.kernel, 0.0, 0.0));
    let b = doc.add(square(&doc.kernel, 20.0, 0.0));
    doc.clear_history();
    let (ea, eb) = (edge_at_x(&doc.kernel, doc.get(a).unwrap(), 10.0), edge_at_x(&doc.kernel, doc.get(b).unwrap(), 20.0));
    let id = doc.commit_bridge_surface((a, ea), (b, eb), 1.0).unwrap();
    assert!(doc.kernel.is_sheet(doc.get(id).unwrap()));
    assert!(doc.undo());
    assert!(doc.get(id).is_none());
    assert!(doc.preview_bridge_surface((a, ea), (a, ea), 1.0).is_err());
}
