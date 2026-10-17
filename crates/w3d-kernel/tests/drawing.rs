//! SVG and DXF export (Plasticity's): the hidden-line drawing of bodies seen from a view. Units are mm.

#![cfg(feature = "occt")]

use glam::DVec3;
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

fn length(l: &DrawnLine) -> f64 {
    l.points.windows(2).map(|w| ((w[1][0] - w[0][0]).powi(2) + (w[1][1] - w[0][1]).powi(2)).sqrt()).sum()
}

fn total(lines: &[DrawnLine], hidden: bool) -> f64 {
    lines.iter().filter(|l| l.hidden == hidden).map(length).sum()
}

#[test]
fn a_box_from_above_draws_its_rectangle() {
    let k = Occt;
    let b = k.box_from_corners(DVec3::ZERO, DVec3::new(10.0, 20.0, 30.0));
    let lines = k.hidden_lines(&[&b], DVec3::ZERO, DVec3::Z, DVec3::X, 0.01).unwrap();
    let v = total(&lines, false);
    assert!((v - 60.0).abs() < 1e-6, "visible length {v}");
    for p in lines.iter().flat_map(|l| &l.points) {
        assert!(p[0] > -1e-6 && p[0] < 10.0 + 1e-6 && p[1] > -1e-6 && p[1] < 20.0 + 1e-6, "{p:?} is off the box");
    }
}

#[test]
fn a_cube_seen_corner_on_hides_the_three_far_edges() {
    let k = Occt;
    let b = k.box_from_corners(DVec3::ZERO, DVec3::splat(10.0));
    let toward = DVec3::ONE.normalize();
    let x = DVec3::new(1.0, -1.0, 0.0).normalize();
    let lines = k.hidden_lines(&[&b], DVec3::ZERO, toward, x, 0.01).unwrap();
    // Every edge is seen at the same slant: 10 mm along an axis shows as 10·√(2/3).
    let edge = 10.0 * (2.0f64 / 3.0).sqrt();
    let (v, h) = (total(&lines, false), total(&lines, true));
    assert!((v - 9.0 * edge).abs() < 1e-6, "visible {v} vs {}", 9.0 * edge);
    assert!((h - 3.0 * edge).abs() < 1e-6, "hidden {h} vs {}", 3.0 * edge);
}

#[test]
fn a_cylinder_from_the_side_draws_its_silhouettes_and_hides_the_back_of_its_rims() {
    let k = Occt;
    let cyl = solids::primitive(&k, &Primitive::Cylinder { frame: Frame::new(DVec3::ZERO, DVec3::X, DVec3::Z), radius: 5.0, height: 20.0 }).unwrap();
    let lines = k.hidden_lines(&[&cyl], DVec3::ZERO, -DVec3::Y, DVec3::X, 0.001).unwrap();
    let silhouettes = lines.iter().filter(|l| !l.hidden && l.points.iter().all(|p| (p[0] - l.points[0][0]).abs() < 1e-6 && (p[0].abs() - 5.0).abs() < 1e-6)).count();
    assert_eq!(silhouettes, 2, "a silhouette down each side");
    // Two silhouettes of 20 and the front of both rims (each a 10 mm line seen edge-on).
    let v = total(&lines, false);
    assert!((v - 60.0).abs() < 0.01, "visible {v}");
    assert!((total(&lines, true) - 20.0).abs() < 0.01, "the back of each rim is hidden");
}

#[test]
fn two_bodies_hide_each_other_and_a_bad_tolerance_is_refused() {
    let k = Occt;
    let back = k.box_from_corners(DVec3::ZERO, DVec3::splat(10.0));
    let front = k.box_from_corners(DVec3::new(2.0, 2.0, 20.0), DVec3::new(8.0, 8.0, 25.0));
    let alone = total(&k.hidden_lines(&[&back], DVec3::ZERO, DVec3::Z, DVec3::X, 0.01).unwrap(), true);
    let both = k.hidden_lines(&[&back, &front], DVec3::ZERO, DVec3::Z, DVec3::X, 0.01).unwrap();
    // The small box sits over the big one's top: the big one stays fully visible around it.
    assert!((total(&both, false) - 40.0 - 24.0).abs() < 1e-6, "visible {}", total(&both, false));
    assert!(total(&both, true) >= alone);
    assert!(k.hidden_lines(&[&back], DVec3::ZERO, DVec3::Z, DVec3::X, 0.0).is_err());
}
