//! Where a plane crosses faces: Cut Curve cuts curves with faces by these.
#![cfg(feature = "occt")]

use glam::DVec3;
use w3d_kernel::document::Document;
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

#[test]
fn a_plane_crosses_the_chosen_faces_only() {
    let mut doc = Document::new(Occt);
    let block = doc.add(doc.kernel.box_from_corners(DVec3::new(-40.0, 0.0, -25.0), DVec3::new(40.0, 30.0, 25.0)));
    let (o, n) = (DVec3::new(0.0, 15.0, 0.0), DVec3::Y);
    // All round the sides: one closed loop in the plane y = 15.
    let all = doc.preview_section(block, &[], o, n).unwrap();
    assert_eq!(all.len(), 1);
    // Each face: the right side (x = 40) gives one line at x = 40, 50 long; the top gives none.
    let mut lines = 0;
    let mut misses = 0;
    for f in 0..6 {
        let out = doc.preview_section(block, &[f], o, n).unwrap();
        if out.is_empty() { misses += 1; continue; }
        assert_eq!(out.len(), 1);
        lines += 1;
    }
    assert_eq!((lines, misses), (4, 2), "the four sides cross it; the top and bottom don't");
}
