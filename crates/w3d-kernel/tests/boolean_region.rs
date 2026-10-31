//! Boolean Region: solids for the parts of space the bodies close off.
#![cfg(feature = "occt")]

use glam::DVec3;
use w3d_kernel::document::Document;
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

fn volumes(doc: &Document<Occt>, solids: &[<Occt as Kernel>::Solid]) -> Vec<f64> {
    solids.iter().map(|s| (doc.kernel.tessellate(s, 0.01).unwrap().volume() * 1000.0).round() / 1000.0).collect()
}

#[test]
fn two_overlapping_blocks_make_three_regions() {
    let mut doc = Document::new(Occt);
    let a = doc.add(doc.kernel.box_from_corners(DVec3::ZERO, DVec3::splat(10.0)));
    let b = doc.add(doc.kernel.box_from_corners(DVec3::splat(5.0), DVec3::splat(15.0)));
    let r = doc.preview_boolean_region(a, &[b]).unwrap();
    assert_eq!(volumes(&doc, &r), vec![875.0, 875.0, 125.0]);
    let made = doc.commit_boolean_region(a, &[b], false).unwrap();
    assert_eq!(made.len(), 2);
    assert!(doc.get(b).is_none());
    doc.undo();
    assert!(doc.get(b).is_some());
}

#[test]
fn a_sheet_across_a_block_splits_it() {
    let mut doc = Document::new(Occt);
    let a = doc.add(doc.kernel.box_from_corners(DVec3::ZERO, DVec3::splat(10.0)));
    let s = doc.add(doc.kernel.plane_sheet(DVec3::new(5.0, 5.0, 3.0), DVec3::Z, 20.0).unwrap());
    let r = doc.preview_boolean_region(a, &[s]).unwrap();
    assert_eq!(volumes(&doc, &r), vec![700.0, 300.0]);
}

#[test]
fn an_open_sheet_alone_closes_nothing() {
    let mut doc = Document::new(Occt);
    let s = doc.add(doc.kernel.plane_sheet(DVec3::ZERO, DVec3::Z, 5.0).unwrap());
    assert!(doc.preview_boolean_region(s, &[]).is_err());
}
