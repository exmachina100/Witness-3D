//! Join and Unjoin (Plasticity's, for sheets and bodies): sheets sewn where their open edges meet
//! (within the 0.01 mm gap bar), a closed result made solid; bodies taken apart into faces or into
//! their separate pieces. Units are mm.

#![cfg(feature = "occt")]

use glam::DVec3;
use opencascade::primitives::{Compound, Shape};
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

/// A flat four-sided sheet through the corners `c`.
fn quad(k: &Occt, c: [DVec3; 4]) -> Shape {
    k.patch(&[Path::Polyline { points: c.to_vec(), closed: true }], &[]).unwrap()
}

/// The six sides of the cube 0..10 as separate sheets, the last lifted `gap` off the rest.
fn cube_sides(k: &Occt, gap: f64) -> Vec<Shape> {
    let p = |x: f64, y: f64, z: f64| DVec3::new(x, y, z) * 10.0;
    let top = DVec3::new(0.0, 0.0, gap);
    vec![
        quad(k, [p(0., 0., 0.), p(1., 0., 0.), p(1., 1., 0.), p(0., 1., 0.)]),
        quad(k, [p(0., 0., 0.), p(1., 0., 0.), p(1., 0., 1.), p(0., 0., 1.)]),
        quad(k, [p(1., 0., 0.), p(1., 1., 0.), p(1., 1., 1.), p(1., 0., 1.)]),
        quad(k, [p(1., 1., 0.), p(0., 1., 0.), p(0., 1., 1.), p(1., 1., 1.)]),
        quad(k, [p(0., 1., 0.), p(0., 0., 0.), p(0., 0., 1.), p(0., 1., 1.)]),
        quad(k, [p(0., 0., 1.) + top, p(1., 0., 1.) + top, p(1., 1., 1.) + top, p(0., 1., 1.) + top]),
    ]
}

fn area(t: &Tessellation) -> f64 {
    t.indices.chunks_exact(3).map(|i| {
        let [a, b, c] = [0, 1, 2].map(|k| DVec3::from(t.positions[i[k] as usize]));
        (b - a).cross(c - a).length() / 2.0
    }).sum()
}

#[test]
fn six_sides_join_into_a_solid_cube() {
    let k = Occt;
    let sides = cube_sides(&k, 0.0);
    let refs: Vec<&Shape> = sides.iter().collect();
    let cube = k.join_sheets(&refs).unwrap();
    assert!(k.is_valid(&cube) && !k.is_sheet(&cube), "a closed shell becomes a solid");
    assert_eq!(k.face_count(&cube), 6);
    assert_eq!(k.edge_count(&cube), 12, "every edge shared");
    let v = k.tessellate(&cube, 0.001).unwrap().volume();
    assert!((v - 1000.0).abs() < 1e-6, "volume {v}");
}

#[test]
fn sides_within_the_gap_bar_join_and_wider_gaps_are_refused() {
    let k = Occt;
    let near = cube_sides(&k, 0.005);
    let refs: Vec<&Shape> = near.iter().collect();
    assert!(!k.is_sheet(&k.join_sheets(&refs).unwrap()), "a 0.005 mm gap closes");
    let far = cube_sides(&k, 0.05);
    let refs: Vec<&Shape> = far.iter().collect();
    let err = k.join_sheets(&refs).err().expect("refused").to_string();
    assert!(err.contains("edge to edge"), "{err}");
}

#[test]
fn open_sheets_join_into_one_sheet() {
    let k = Occt;
    let p = |x: f64, y: f64| DVec3::new(x, y, 0.0);
    let a = quad(&k, [p(0., 0.), p(10., 0.), p(10., 10.), p(0., 10.)]);
    let b = quad(&k, [p(10., 0.), p(20., 0.), p(20., 10.), p(10., 10.)]);
    let s = k.join_sheets(&[&a, &b]).unwrap();
    assert!(k.is_sheet(&s) && k.is_valid(&s));
    assert_eq!(k.face_count(&s), 2);
    assert_eq!(k.edge_count(&s), 7, "the middle edge is shared");
    assert!((area(&k.tessellate(&s, 0.001).unwrap()) - 200.0).abs() < 1e-6);
    let block = k.box_from_corners(DVec3::ZERO, DVec3::splat(5.0));
    assert!(k.join_sheets(&[&a, &block]).err().unwrap().to_string().contains("Boolean"));
    assert!(k.join_sheets(&[&a]).is_err());
}

#[test]
fn unjoin_takes_a_body_apart_into_faces_or_pieces() {
    let k = Occt;
    let block = k.box_from_corners(DVec3::ZERO, DVec3::splat(10.0));
    let faces = k.unjoin(&block, true).unwrap();
    assert_eq!(faces.len(), 6);
    for f in &faces {
        assert!(k.is_sheet(f));
        assert!((area(&k.tessellate(f, 0.001).unwrap()) - 100.0).abs() < 1e-6);
    }
    // Rejoined, they make the block again.
    let refs: Vec<&Shape> = faces.iter().collect();
    assert!((k.tessellate(&k.join_sheets(&refs).unwrap(), 0.001).unwrap().volume() - 1000.0).abs() < 1e-6);
    // A block is one piece; two blocks in one body come apart.
    assert!(k.unjoin(&block, false).is_err());
    let other = k.box_from_corners(DVec3::splat(20.0), DVec3::splat(25.0));
    let both = Shape::from(Compound::from_shapes([&block, &other]));
    let pieces = k.unjoin(&both, false).unwrap();
    assert_eq!(pieces.len(), 2);
    let mut vols: Vec<f64> = pieces.iter().map(|p| k.tessellate(p, 0.001).unwrap().volume()).collect();
    vols.sort_by(f64::total_cmp);
    assert!((vols[0] - 125.0).abs() < 1e-6 && (vols[1] - 1000.0).abs() < 1e-6, "{vols:?}");
}

#[test]
fn the_document_joins_and_unjoins_in_one_undo_step_each() {
    use w3d_kernel::document::Document;
    let mut doc = Document::new(Occt);
    let block = doc.add(doc.kernel.box_from_corners(DVec3::ZERO, DVec3::splat(10.0)));
    doc.clear_history();
    let ids = doc.commit_unjoin(block, true).unwrap();
    assert_eq!(ids.len(), 6);
    assert_eq!(ids[0], block, "the body keeps the first face");
    assert_eq!(doc.ids().len(), 6);
    let joined = doc.commit_join_sheets(&ids).unwrap();
    assert_eq!(joined, block);
    assert_eq!(doc.ids(), vec![block]);
    assert!(!doc.kernel.is_sheet(doc.get(block).unwrap()));
    assert!(doc.undo());
    assert_eq!(doc.ids().len(), 6);
    assert!(doc.undo());
    assert_eq!(doc.ids(), vec![block]);
}
