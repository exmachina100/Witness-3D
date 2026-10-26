//! Patch › Method: a target sheet trimmed to a base sheet's hole, or to where the base sheet ends.
#![cfg(feature = "occt")]

use glam::DVec3;
use w3d_kernel::document::Document;
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

fn area(doc: &Document<Occt>, s: &<Occt as Kernel>::Solid) -> f64 {
    let t = doc.kernel.tessellate(s, 0.01).unwrap();
    t.indices.chunks(3).map(|c| {
        let [a, b, d] = [0, 1, 2].map(|k| DVec3::from_array(t.positions[c[k] as usize]));
        (b - a).cross(d - a).length() / 2.0
    }).sum()
}

/// The base's edges whose middles pass `pick`.
fn edges_where(doc: &Document<Occt>, s: &<Occt as Kernel>::Solid, pick: impl Fn(DVec3) -> bool) -> Vec<u32> {
    let t = doc.kernel.tessellate(s, 0.01).unwrap();
    t.edges.iter().enumerate().filter(|(_, e)| !e.is_empty() && pick((DVec3::from_array(e[0]) + DVec3::from_array(e[e.len() - 1])) / 2.0)).map(|(i, _)| i as u32).collect()
}

#[test]
fn a_sheet_over_a_hole_is_trimmed_to_it() {
    let mut doc = Document::new(Occt);
    let plate = doc.kernel.plane_sheet(DVec3::ZERO, DVec3::Z, 10.0).unwrap();
    let cut = doc.kernel.box_from_corners(DVec3::new(-3.0, -3.0, -1.0), DVec3::new(3.0, 3.0, 1.0));
    let holed = doc.kernel.boolean(&plate, &cut, BooleanOp::Difference).unwrap().solid;
    let hole = edges_where(&doc, &holed, |p| p.x.abs().max(p.y.abs()) < 3.5);
    assert_eq!(hole.len(), 4);
    let base = doc.add(holed);
    let target = doc.add(doc.kernel.plane_sheet(DVec3::new(0.0, 0.0, 1.0), DVec3::Z, 10.0).unwrap());
    let edges: Vec<_> = hole.iter().map(|&e| (base, e, 0)).collect();
    let id = doc.commit_patch_trim(target, &edges, true).unwrap();
    assert_eq!(id, target);
    let a = area(&doc, doc.get(target).unwrap());
    assert!((a - 36.0).abs() < 1e-3, "{a}");
}

#[test]
fn a_sheet_past_the_end_of_another_is_trimmed_where_it_ends() {
    let mut doc = Document::new(Occt);
    let plate = doc.kernel.plane_sheet(DVec3::ZERO, DVec3::Z, 10.0).unwrap();
    let cut = doc.kernel.box_from_corners(DVec3::new(0.0, -11.0, -1.0), DVec3::new(11.0, 11.0, 1.0));
    let half = doc.kernel.boolean(&plate, &cut, BooleanOp::Difference).unwrap().solid;
    let end = edges_where(&doc, &half, |p| p.x.abs() < 1e-6);
    assert_eq!(end.len(), 1);
    let base = doc.add(half);
    let target = doc.add(doc.kernel.plane_sheet(DVec3::new(0.0, 0.0, 1.0), DVec3::Z, 10.0).unwrap());
    let s = doc.preview_patch_trim(target, &[(base, end[0], 0)], false).unwrap();
    let a = area(&doc, &s);
    assert!((a - 200.0).abs() < 1e-3, "{a}");
    // Trim to hole on a run that does not close round anything over the target refuses.
    assert!(doc.preview_patch_trim(base, &[(base, end[0], 0)], true).is_err());
}
