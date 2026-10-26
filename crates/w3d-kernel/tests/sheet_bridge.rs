//! Bridge Surface between two crossing sheets: Width, G2 or Chamfer, Trim walls and Sense.
#![cfg(feature = "occt")]

use glam::DVec3;
use w3d_kernel::document::Document;
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

fn crossing() -> (Document<Occt>, document::BodyId, document::BodyId) {
    let mut doc = Document::new(Occt);
    let a = doc.add(doc.kernel.plane_sheet(DVec3::ZERO, DVec3::Z, 10.0).unwrap());
    let b = doc.add(doc.kernel.plane_sheet(DVec3::new(3.0, 0.0, 0.0), DVec3::X, 10.0).unwrap());
    (doc, a, b)
}

#[test]
fn trimmed_both_ways_the_sheets_and_the_bridge_become_one() {
    for chamfer in [false, true] {
        let (mut doc, a, b) = crossing();
        let id = doc.commit_sheet_bridge(a, b, 2.0, chamfer, [false, false], 0).unwrap();
        assert_eq!(id, a);
        assert!(doc.get(b).is_none(), "the second sheet is part of the first now");
        assert_eq!(doc.kernel.face_count(doc.get(a).unwrap()), 3);
    }
}

#[test]
fn trim_short_long_and_none() {
    // Kept pieces: 11 × 20 of the first sheet (the larger side, less the bridge), 8 × 20 of the second.
    let (doc, a, b) = crossing();
    let (out, shown) = doc.preview_sheet_bridge(a, b, 2.0, false, [false, false], 1).unwrap();
    assert_eq!(shown, 1, "the second sheet's wall is the shorter");
    assert_eq!(doc.kernel.face_count(out[1].as_ref().unwrap()), 2);
    assert_eq!(doc.kernel.face_count(out[0].as_ref().unwrap()), 1, "the first sheet stays whole");
    let (_, shown) = doc.preview_sheet_bridge(a, b, 2.0, false, [false, false], 2).unwrap();
    assert_eq!(shown, 0);
    let (out, shown) = doc.preview_sheet_bridge(a, b, 2.0, false, [false, false], 3).unwrap();
    assert_eq!(shown, 2);
    assert_eq!(doc.kernel.face_count(out[2].as_ref().unwrap()), 1);
}

#[test]
fn sense_flips_the_side_and_sheets_apart_are_refused() {
    let (doc, a, b) = crossing();
    // The other side of the first sheet: the small piece, 7 long less the bridge.
    let (out, _) = doc.preview_sheet_bridge(a, b, 2.0, false, [true, false], 0).unwrap();
    assert_eq!(doc.kernel.face_count(out[0].as_ref().unwrap()), 3);
    let mut doc = Document::new(Occt);
    let a = doc.add(doc.kernel.plane_sheet(DVec3::ZERO, DVec3::Z, 10.0).unwrap());
    let b = doc.add(doc.kernel.plane_sheet(DVec3::new(30.0, 0.0, 0.0), DVec3::X, 10.0).unwrap());
    assert!(doc.preview_sheet_bridge(a, b, 2.0, false, [false, false], 0).is_err());
}
