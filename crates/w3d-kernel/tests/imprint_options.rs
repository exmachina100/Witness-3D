//! Imprint Curve Body's options: Normal or Vector, Bidirectional, Hide Occlusion and Completion.
#![cfg(feature = "occt")]

use glam::DVec3;
use w3d_kernel::document::{Document, Projection, Tools};
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

/// A block x −40..40, y 0..30, z −25..25, and a line drawn at height `y` from (x0, z) to (x1, z),
/// its plane facing +y.
fn setup(y: f64, x0: f64, x1: f64, z: f64) -> (Document<Occt>, document::BodyId, CurveId) {
    let mut doc = Document::new(Occt);
    let block = doc.add(doc.kernel.box_from_corners(DVec3::new(-40.0, 0.0, -25.0), DVec3::new(40.0, 30.0, 25.0)));
    doc.clear_history();
    // Plane coordinates: x along x, the second along normal × x = −z.
    let line = doc.commit_curves(vec![Curve { origin: [0.0, y, 0.0], x: [1.0, 0.0, 0.0], normal: [0.0, 1.0, 0.0], shape: CurveShape::Polyline { points: vec![[x0, -z], [x1, -z]], closed: false } }]).unwrap()[0];
    (doc, block, line)
}

fn faces(doc: &Document<Occt>, b: document::BodyId) -> usize { doc.kernel.face_count(doc.get(b).unwrap()) }

#[test]
fn normal_goes_forwards_only_unless_bidirectional() {
    // Drawn above the block facing up, along z through x = 10: forwards misses the block.
    let (mut doc, block, _) = setup(40.0, 0.0, 0.0, 0.0);
    let across = doc.commit_curves(vec![Curve { origin: [0.0, 40.0, 0.0], x: [1.0, 0.0, 0.0], normal: [0.0, 1.0, 0.0], shape: CurveShape::Polyline { points: vec![[10.0, -100.0], [10.0, 100.0]], closed: false } }]).unwrap()[0];
    assert!(doc.preview_imprint_with(block, &[], &[across], &Tools::default(), Some(&Projection::default())).is_err());
    let both = Projection { both: true, ..Projection::default() };
    doc.commit_imprint_with(block, &[], &[across], &Tools::default(), false, Some(&both)).unwrap();
    assert_eq!(faces(&doc, block), 10, "top, bottom, front and back split");
}

#[test]
fn vector_with_hide_occlusion_imprints_only_what_is_seen() {
    let (mut doc, block, _) = setup(40.0, 0.0, 0.0, 0.0);
    let across = doc.commit_curves(vec![Curve { origin: [0.0, 40.0, 0.0], x: [1.0, 0.0, 0.0], normal: [0.0, 1.0, 0.0], shape: CurveShape::Polyline { points: vec![[10.0, -100.0], [10.0, 100.0]], closed: false } }]).unwrap()[0];
    let down = Projection { dir: Some([0.0, -1.0, 0.0]), both: true, hide: false, complete: false };
    let all = doc.preview_imprint_with(block, &[], &[across], &Tools::default(), Some(&down)).unwrap();
    assert_eq!(doc.kernel.face_count(&all.solid), 10, "seen or not, every face crossed");
    let seen = Projection { hide: true, ..down };
    doc.commit_imprint_with(block, &[], &[across], &Tools::default(), false, Some(&seen)).unwrap();
    assert_eq!(faces(&doc, block), 7, "only the top is split");
}

#[test]
fn completion_edge_carries_short_curves_on_across_the_face() {
    // A short line in the middle of the top, x −10..10 at z = 0.
    let (mut doc, block, line) = setup(40.0, -10.0, 10.0, 0.0);
    let down = Projection { dir: Some([0.0, -1.0, 0.0]), both: true, hide: true, complete: false };
    let edges = |doc: &Document<Occt>| doc.kernel.edge_count(doc.get(block).unwrap());
    let before = edges(&doc);
    let none = doc.preview_imprint_with(block, &[], &[line], &Tools::default(), Some(&down)).unwrap();
    assert_eq!(doc.kernel.face_count(&none.solid), 6, "None leaves the edge inside the face");
    assert!(doc.kernel.edge_count(&none.solid) > before);
    let edge = Projection { complete: true, ..down };
    doc.commit_imprint_with(block, &[], &[line], &Tools::default(), false, Some(&edge)).unwrap();
    assert_eq!(faces(&doc, block), 7, "Edge carries it on until the top is split in two");
}

#[test]
fn hide_occlusion_leaves_flat_faces_seen_edge_on() {
    // Drawn on the top itself: carried on, it runs past the top's edges and down the sides, which
    // looking straight down are seen edge-on and so stay whole.
    let (mut doc, block, line) = setup(30.0, -10.0, 10.0, 0.0);
    let down = Projection { dir: Some([0.0, -1.0, 0.0]), both: true, hide: true, complete: true };
    doc.commit_imprint_with(block, &[], &[line], &Tools::default(), false, Some(&down)).unwrap();
    assert_eq!(faces(&doc, block), 7);
}
