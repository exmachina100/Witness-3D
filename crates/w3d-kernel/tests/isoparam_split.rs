//! Isoparam: a face split by edges along u or v, optionally with its control surface split too.
#![cfg(feature = "occt")]

use glam::DVec3;
use w3d_kernel::document::Document;
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

/// The face whose facets all pass `pick`.
fn face_where(doc: &Document<Occt>, s: &<Occt as Kernel>::Solid, pick: impl Fn(DVec3) -> bool) -> u32 {
    let t = doc.kernel.tessellate(s, 0.01).unwrap();
    let n = t.face_ids.iter().copied().max().unwrap() + 1;
    (0..n).find(|&f| t.indices.chunks(3).zip(&t.face_ids).filter(|(_, &id)| id == f)
        .all(|(c, _)| c.iter().all(|&i| pick(DVec3::from_array(t.positions[i as usize]))))).unwrap()
}

fn faces(doc: &Document<Occt>, s: &<Occt as Kernel>::Solid) -> u32 {
    doc.kernel.tessellate(s, 0.01).unwrap().face_ids.iter().copied().max().unwrap() + 1
}

#[test]
fn a_box_top_splits_in_two_three_and_four() {
    let mut doc = Document::new(Occt);
    let b = doc.add(doc.kernel.box_from_corners(DVec3::ZERO, DVec3::splat(10.0)));
    let top = face_where(&doc, doc.get(b).unwrap(), |p| (p.z - 10.0).abs() < 1e-6);
    let one = doc.preview_isoparam_split(b, top, true, DVec3::new(5.0, 3.0, 10.0), &[], false).unwrap();
    assert_eq!(faces(&doc, &one.solid), 7);
    let three = doc.preview_isoparam_split(b, top, false, DVec3::ZERO, &[0.25, 0.5, 0.75], false).unwrap();
    assert_eq!(faces(&doc, &three.solid), 9);
    let v = doc.kernel.tessellate(&three.solid, 0.01).unwrap().volume();
    assert!((v - 1000.0).abs() < 1e-6, "{v}");
    assert!(doc.preview_isoparam_split(b, top, true, DVec3::ZERO, &[1.0], false).is_err());
    doc.commit_isoparam_split(b, top, true, DVec3::new(5.0, 3.0, 10.0), &[], false).unwrap();
    assert_eq!(faces(&doc, doc.get(b).unwrap()), 7);
}

#[test]
fn subdivide_gives_each_piece_its_own_control_points() {
    let mut doc = Document::new(Occt);
    let b = doc.add(doc.kernel.box_from_corners(DVec3::ZERO, DVec3::splat(10.0)));
    let top = face_where(&doc, doc.get(b).unwrap(), |p| (p.z - 10.0).abs() < 1e-6);
    let t = doc.preview_isoparam_split(b, top, true, DVec3::ZERO, &[0.3], true).unwrap();
    assert_eq!(faces(&doc, &t.solid), 7);
    let v = doc.kernel.tessellate(&t.solid, 0.01).unwrap().volume();
    assert!((v - 1000.0).abs() < 1e-6, "{v}");
    // The two top pieces: their control nets lie within the halves and meet along the cut.
    let poles = doc.kernel.face_poles(&t.solid);
    let tops: Vec<_> = poles.iter().filter(|net| !net.is_empty() && net.iter().flatten().all(|p| (p.z - 10.0).abs() < 1e-9)).collect();
    assert_eq!(tops.len(), 2, "{poles:?}");
    let spans: Vec<(f64, f64, f64, f64)> = tops.iter().map(|net| {
        let pts: Vec<_> = net.iter().flatten().collect();
        let f = |g: fn(&DVec3) -> f64| (pts.iter().map(|p| g(p)).fold(f64::MAX, f64::min), pts.iter().map(|p| g(p)).fold(f64::MIN, f64::max));
        let (x0, x1) = f(|p| p.x);
        let (y0, y1) = f(|p| p.y);
        (x0, x1, y0, y1)
    }).collect();
    // One coordinate runs 0..10 on both; the other is split at 3 (the cut sits 0.3 across).
    let cut = |a: (f64, f64), b: (f64, f64)| {
        let (lo, hi) = if a.0 < b.0 { (a, b) } else { (b, a) };
        (lo.0.abs() < 1e-9 && (lo.1 - hi.0).abs() < 1e-9 && (hi.1 - 10.0).abs() < 1e-9).then_some(lo.1)
    };
    let at = cut((spans[0].0, spans[0].1), (spans[1].0, spans[1].1)).or(cut((spans[0].2, spans[0].3), (spans[1].2, spans[1].3)));
    assert!(at.is_some_and(|c| (c - 3.0).abs() < 1e-6 || (c - 7.0).abs() < 1e-6), "{spans:?}");
}

#[test]
fn a_round_face_subdivides_round_its_axis() {
    let mut doc = Document::new(Occt);
    let block = doc.kernel.box_from_corners(DVec3::ZERO, DVec3::splat(10.0));
    // Round a vertical edge so there's a cylindrical face to cut.
    let t = doc.kernel.tessellate(&block, 0.01).unwrap();
    let edge = t.edges.iter().position(|e| e.iter().all(|p| p[0].abs() < 1e-9 && p[1].abs() < 1e-9)).unwrap() as u32;
    let round = doc.kernel.blend(&block, &[edge], 3.0, Blend::Fillet, 0.0, &[]).unwrap().solid;
    let b = doc.add(round);
    let n = faces(&doc, doc.get(b).unwrap());
    let s = doc.get(b).unwrap();
    let face = face_where(&doc, s, |p| p.x < 3.0 + 1e-6 && p.y < 3.0 + 1e-6 && (p.x - 3.0).hypot(p.y - 3.0) > 2.9);
    for u in [true, false] {
        let t = doc.preview_isoparam_split(b, face, u, DVec3::ZERO, &[0.5], true).unwrap();
        assert_eq!(faces(&doc, &t.solid), n + 1);
        let v0 = doc.kernel.tessellate(doc.get(b).unwrap(), 0.01).unwrap().volume();
        let v1 = doc.kernel.tessellate(&t.solid, 0.01).unwrap().volume();
        assert!((v0 - v1).abs() < 0.05, "{v0} {v1}");
    }
}
