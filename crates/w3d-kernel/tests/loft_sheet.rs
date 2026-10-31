//! Loft of curves (Plasticity's Loft with curves selected): a sheet through the curves in order,
//! and Loop, which carries the sheet on from the last curve back to the first. Units are mm.

#![cfg(feature = "occt")]

use glam::DVec3;
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

fn line(a: DVec3, b: DVec3) -> Path { Path::Polyline { points: vec![a, b], closed: false } }

fn area(t: &Tessellation) -> f64 {
    t.indices.chunks_exact(3).map(|i| {
        let [a, b, c] = [0, 1, 2].map(|k| DVec3::from(t.positions[i[k] as usize]));
        (b - a).cross(c - a).length() / 2.0
    }).sum()
}

#[test]
fn two_lines_make_a_flat_sheet() {
    let k = Occt;
    let s = k.loft_sheet(&[line(DVec3::ZERO, DVec3::X * 10.0), line(DVec3::Y * 5.0, DVec3::new(10.0, 5.0, 0.0))], false).unwrap();
    assert!(k.is_sheet(&s));
    assert!((area(&k.tessellate(&s, 0.01).unwrap()) - 50.0).abs() < 1e-6);
    assert_eq!(k.boundary_edges(&s).len(), 4);
}

#[test]
fn two_circles_make_an_open_tube() {
    let k = Occt;
    let c = |z: f64| Path::Circle { center: DVec3::new(0.0, 0.0, z), normal: DVec3::Z, radius: 5.0 };
    let s = k.loft_sheet(&[c(0.0), c(20.0)], false).unwrap();
    assert!(k.is_sheet(&s));
    let a = area(&k.tessellate(&s, 0.001).unwrap());
    assert!((a - 2.0 * std::f64::consts::PI * 5.0 * 20.0).abs() < 0.5, "area {a}");
}

#[test]
fn a_loop_closes_back_on_the_first_curve() {
    let k = Occt;
    let at = |y: f64, z: f64| line(DVec3::new(0.0, y, z), DVec3::new(10.0, y, z));
    let curves = [at(0.0, 0.0), at(10.0, 0.0), at(5.0, 8.0)];
    let open = k.loft_sheet(&curves, false).unwrap();
    let looped = k.loft_sheet(&curves, true).unwrap();
    assert!(k.is_sheet(&looped));
    // The open sheet has its two side lines free as well as its ends; the loop only its ends.
    assert!(k.boundary_edges(&looped).len() < k.boundary_edges(&open).len());
    let ends = |s: &<Occt as Kernel>::Solid| k.tessellate(s, 0.01).unwrap().positions.iter().all(|p| p[0] > -1e-6 && p[0] < 10.0 + 1e-6);
    assert!(ends(&looped));
    assert!(k.loft_sheet(&curves[..2], true).is_err());
}
