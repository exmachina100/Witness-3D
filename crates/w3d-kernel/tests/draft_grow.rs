//! Draft Face's Grow (manual, solid/draft-face), for an inner face drafted out past the body's
//! outer wall: Moving extends the outer wall, Fixed stops the face at the wall, None lets it carry
//! on by itself. The step: a 13 × 20 × 10 block with its far 3 mm cut down to 5 mm, so the riser at
//! x = 10 faces the outer wall at x = 13. Drafted 45° about its foot it leans out to x = 15 at the
//! top, 2 mm past the wall.

#![cfg(feature = "occt")]

use glam::DVec3;
use w3d_kernel::document::{BodyId, Document};
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

fn volume(k: &Occt, s: &<Occt as Kernel>::Solid) -> f64 { k.tessellate(s, 0.001).unwrap().volume() }

fn step(doc: &mut Document<Occt>) -> (BodyId, u32) {
    let k = &doc.kernel;
    let block = k.box_from_corners(DVec3::ZERO, DVec3::new(13.0, 20.0, 10.0));
    let cut = k.box_from_corners(DVec3::new(10.0, -1.0, 5.0), DVec3::new(14.0, 21.0, 11.0));
    let s = k.boolean(&block, &cut, BooleanOp::Difference).unwrap().solid;
    let riser = k.tessellate(&s, 0.1).unwrap().face_planes.iter().position(|p| p.map_or(false, |p| p.normal.x > 0.999 && (p.origin.x - 10.0).abs() < 1e-9)).unwrap() as u32;
    (doc.add(s), riser)
}

#[test]
fn grow_says_what_the_outer_wall_does_when_a_draft_reaches_it() {
    let mut doc = Document::new(Occt);
    let (b, riser) = step(&mut doc);
    let foot = DVec3::new(10.0, 0.0, 5.0);
    // The sign that leans the riser's top out over the lower step (adding material).
    let base = volume(&doc.kernel, doc.get(b).unwrap());
    let angle = [0.25 * std::f64::consts::PI, -0.25 * std::f64::consts::PI].into_iter()
        .find(|&a| doc.preview_draft(b, &[riser], DVec3::Z, foot, a, Grow::None).map_or(false, |t| volume(&doc.kernel, &t.solid) > base))
        .expect("one way adds material");
    let vol = |g| volume(&doc.kernel, &doc.preview_draft(b, &[riser], DVec3::Z, foot, angle, g).unwrap().solid);
    assert!((base - 2300.0).abs() < 1e-6, "{base}");
    // None: the whole 5 × 5 wedge, overhanging the wall.
    assert!((vol(Grow::None) - 2550.0).abs() < 1e-3, "none {}", vol(Grow::None));
    // Fixed: the wedge cut off at the wall's plane, less the 2 × 2 corner beyond it.
    assert!((vol(Grow::Fixed) - 2510.0).abs() < 1e-3, "fixed {}", vol(Grow::Fixed));
    // Moving: the whole wedge, and the wall pushed out 2 mm under it.
    assert!((vol(Grow::Moving) - 2750.0).abs() < 1e-3, "moving {}", vol(Grow::Moving));
}
