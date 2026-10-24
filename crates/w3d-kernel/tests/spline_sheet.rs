//! Constrained Surface's sheet (Kernel::spline_sheet): a B-spline surface given as numbers, the
//! layout web/src/constrainedSurface.js writes (its tests cover the fit). Units are mm.

#![cfg(feature = "occt")]

use w3d_kernel::occt::Occt;
use w3d_kernel::*;

/// A bicubic single-span surface over 0..20 × 0..10 at x/z, bulged up by `h` in the middle poles.
fn data(h: f64) -> Vec<f64> {
    let mut d = vec![3.0, 3.0, 4.0, 4.0, 8.0, 8.0];
    d.extend([0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0]);
    d.extend([0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0]);
    for i in 0..4 {
        for j in 0..4 {
            let inner = (1..3).contains(&i) && (1..3).contains(&j);
            d.extend([i as f64 * 20.0 / 3.0, if inner { h } else { 0.0 }, j as f64 * 10.0 / 3.0]);
        }
    }
    d
}

#[test]
fn numbers_make_one_sheet_over_their_poles() {
    let k = Occt;
    let s = k.spline_sheet(&data(3.0)).unwrap();
    assert!(k.is_sheet(&s));
    assert_eq!(k.face_count(&s), 1);
    let t = k.tessellate(&s, 0.01).unwrap();
    let top = t.positions.iter().map(|p| p[1]).fold(f64::MIN, f64::max);
    // The inner poles weigh (3/8 + 3/8)² at the centre of a bicubic patch.
    assert!((top - 3.0 * 0.5625).abs() < 0.02, "top {top}");
}

#[test]
fn numbers_that_do_not_add_up_are_refused() {
    let k = Occt;
    let mut d = data(1.0);
    d.pop();
    assert!(k.spline_sheet(&d).is_err());
    assert!(k.spline_sheet(&[3.0, 3.0]).is_err());
}
