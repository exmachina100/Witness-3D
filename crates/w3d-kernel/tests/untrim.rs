//! Untrim (Plasticity's Untrim): a sheet of the whole surface under a face, with the face's edges
//! imprinted on it when Keep edges is on. Units are mm.

#![cfg(feature = "occt")]

use std::f64::consts::PI;

use glam::DVec3;
use opencascade::primitives::Shape;
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

fn area(k: &Occt, s: &Shape) -> f64 {
    let t = k.tessellate(s, 0.001).unwrap();
    t.indices.chunks_exact(3).map(|i| {
        let [a, b, c] = [i[0], i[1], i[2]].map(|i| DVec3::from_array(t.positions[i as usize]));
        (b - a).cross(c - a).length() / 2.0
    }).sum()
}

/// A 100 mm block with a ball of radius 20 sunk into the middle of its top: the top face has a
/// round hole and the dimple is part of a sphere.
fn dimpled(k: &Occt) -> Shape {
    let b = k.box_from_corners(DVec3::ZERO, DVec3::new(100.0, 100.0, 50.0));
    let ball = k.sphere(DVec3::new(50.0, 50.0, 50.0), 20.0).unwrap();
    k.boolean(&b, &ball, BooleanOp::Difference).unwrap().solid
}

fn top(k: &Occt, s: &Shape) -> u32 {
    let t = k.tessellate(s, 0.01).unwrap();
    t.face_planes.iter().position(|p| p.as_ref().is_some_and(|p| (p.origin.z - 50.0).abs() < 1e-9 && p.normal.z > 0.99)).unwrap() as u32
}

fn dimple(k: &Occt, s: &Shape) -> u32 {
    let t = k.tessellate(s, 0.01).unwrap();
    // The only face that is not flat.
    t.face_planes.iter().position(|p| p.is_none()).unwrap() as u32
}

#[test]
fn a_flat_face_loses_its_hole() {
    let k = Occt;
    let s = dimpled(&k);
    let f = top(&k, &s);
    let before = area(&k, &s);
    let sheet = k.untrim_face(&s, f, false).unwrap();
    assert!(k.is_valid(&sheet) && k.is_sheet(&sheet));
    assert_eq!(k.face_count(&sheet), 1);
    assert!((area(&k, &sheet) - 10_000.0).abs() < 1e-6, "area {}", area(&k, &sheet));
    // The body is left as it was.
    assert!((area(&k, &s) - before).abs() < 1e-9);
}

#[test]
fn keep_edges_imprints_the_hole() {
    let k = Occt;
    let s = dimpled(&k);
    let sheet = k.untrim_face(&s, top(&k, &s), true).unwrap();
    assert!(k.is_valid(&sheet));
    assert_eq!(k.face_count(&sheet), 2, "the hole's disc and the rest");
    assert!((area(&k, &sheet) - 10_000.0).abs() < 0.5, "area {}", area(&k, &sheet));
}

#[test]
fn a_dimple_becomes_the_whole_ball() {
    let k = Occt;
    let s = dimpled(&k);
    let f = dimple(&k, &s);
    let sheet = k.untrim_face(&s, f, false).unwrap();
    assert!(k.is_valid(&sheet));
    let whole = 4.0 * PI * 400.0;
    assert!((area(&k, &sheet) - whole).abs() / whole < 0.005, "area {} against {whole}", area(&k, &sheet));
    let kept = k.untrim_face(&s, f, true).unwrap();
    assert!(k.is_valid(&kept));
    assert_eq!(k.face_count(&kept), 2, "the dimple and the rest of the ball");
    assert!((area(&k, &kept) - whole).abs() / whole < 0.005, "area {}", area(&k, &kept));
}

#[test]
fn a_missing_face_is_refused() {
    let k = Occt;
    let s = dimpled(&k);
    assert!(k.untrim_face(&s, 99, false).is_err());
}
