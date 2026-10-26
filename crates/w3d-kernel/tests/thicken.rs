//! Thicken (Plasticity's Thicken): a sheet made solid, front along its normals and back behind
//! them, with walls along its open edges. Units are mm.

#![cfg(feature = "occt")]

use glam::DVec3;
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

fn line(a: DVec3, b: DVec3) -> Path { Path::Polyline { points: vec![a, b], closed: false } }

/// The four sides of a square of side 10 whose corners rise to `lift`, alternately up and down.
fn saddle(lift: f64) -> Vec<Path> {
    let c = [DVec3::new(0.0, 0.0, lift), DVec3::new(10.0, 0.0, -lift), DVec3::new(10.0, 10.0, lift), DVec3::new(0.0, 10.0, -lift)];
    (0..4).map(|i| line(c[i], c[(i + 1) % 4])).collect()
}

fn z_range(t: &Tessellation) -> (f64, f64) {
    t.positions.iter().fold((f64::MAX, f64::MIN), |(lo, hi), p| (lo.min(p[2]), hi.max(p[2])))
}

fn area(t: &Tessellation) -> f64 {
    t.indices.chunks_exact(3).map(|i| {
        let [a, b, c] = [0, 1, 2].map(|k| DVec3::from(t.positions[i[k] as usize]));
        (b - a).cross(c - a).length() / 2.0
    }).sum()
}

#[test]
fn a_flat_sheet_becomes_a_slab_front_and_back() {
    let k = Occt;
    let sheet = k.patch(&saddle(0.0), &[]).unwrap();
    let slab = k.thicken(&sheet, 2.0, 0.0).unwrap();
    assert!(k.is_valid(&slab) && !k.is_sheet(&slab));
    assert_eq!(k.face_count(&slab), 6);
    let t = k.tessellate(&slab, 0.001).unwrap();
    assert!((t.volume() - 200.0).abs() < 1e-6, "volume {}", t.volume());
    // Front goes one way along the normal; the sheet stays one face of the slab.
    let (lo, hi) = z_range(&t);
    assert!((lo.abs() < 1e-9 && (hi - 2.0).abs() < 1e-9) || ((lo + 2.0).abs() < 1e-9 && hi.abs() < 1e-9), "{lo}..{hi}");
    let up = hi > 1.0;

    // Front 2 and back 1: 3 thick, straddling the sheet the same way round.
    let both = k.tessellate(&k.thicken(&sheet, 2.0, 1.0).unwrap(), 0.001).unwrap();
    assert!((both.volume() - 300.0).abs() < 1e-6, "volume {}", both.volume());
    let (lo, hi) = z_range(&both);
    let want = if up { (-1.0, 2.0) } else { (-2.0, 1.0) };
    assert!((lo - want.0).abs() < 1e-9 && (hi - want.1).abs() < 1e-9, "{lo}..{hi}");
    // Back alone grows the other way.
    let (lo, hi) = z_range(&k.tessellate(&k.thicken(&sheet, 0.0, 2.0).unwrap(), 0.001).unwrap());
    assert_eq!(hi > 1.0, !up, "{lo}..{hi}");
}

#[test]
fn a_disc_becomes_a_puck() {
    let k = Occt;
    let ring = Path::Circle { center: DVec3::ZERO, normal: DVec3::Z, radius: 5.0 };
    let disc = k.patch(&[ring], &[]).unwrap();
    let puck = k.thicken(&disc, 1.5, 0.5).unwrap();
    assert!(k.is_valid(&puck));
    assert_eq!(k.face_count(&puck), 3);
    let v = k.tessellate(&puck, 0.0001).unwrap().volume();
    let exact = std::f64::consts::PI * 25.0 * 2.0;
    assert!((v - exact).abs() / exact < 1e-3, "volume {v} vs {exact}");
}

#[test]
fn a_curved_sheet_thickens_evenly() {
    let k = Occt;
    let sheet = k.patch(&saddle(2.0), &[]).unwrap();
    let a = area(&k.tessellate(&sheet, 0.0005).unwrap());
    let solid = k.thicken(&sheet, 0.5, 0.0).unwrap();
    assert!(k.is_valid(&solid));
    assert_eq!(k.face_count(&solid), 6);
    // A gently curved sheet: the volume is its area times the thickness, near enough.
    let v = k.tessellate(&solid, 0.0005).unwrap().volume();
    assert!((v - a * 0.5).abs() / (a * 0.5) < 0.01, "volume {v} vs {}", a * 0.5);
}

#[test]
fn solids_and_no_thickness_are_refused() {
    let k = Occt;
    let block = k.box_from_corners(DVec3::ZERO, DVec3::splat(10.0));
    let err = k.thicken(&block, 1.0, 0.0).err().expect("refused").to_string();
    assert!(err.contains("already solid"), "{err}");
    let sheet = k.patch(&saddle(0.0), &[]).unwrap();
    assert!(k.thicken(&sheet, 0.0, 0.0).is_err());
    assert!(k.thicken(&sheet, -1.0, 0.0).is_err());
    assert!(k.thicken(&sheet, f64::NAN, 0.0).is_err());
}

#[test]
fn the_document_turns_the_sheet_body_solid_in_one_undo_step() {
    use w3d_kernel::document::{Curve, CurveShape, Document};
    let mut doc = Document::new(Occt);
    let ring = Curve { origin: [0.0, 0.0, 0.0], x: [1.0, 0.0, 0.0], normal: [0.0, 0.0, 1.0], shape: CurveShape::Circle { center: [0.0, 0.0], radius: 3.0 } };
    let id = doc.commit_curves(vec![ring]).unwrap()[0];
    let sheet = doc.commit_patch(&[id], &[], 0.0).unwrap();
    doc.clear_history();
    assert_eq!(doc.commit_thicken(sheet, 2.0, 0.0).unwrap(), sheet, "the body keeps its id");
    let body = doc.get(sheet).unwrap();
    assert!(!doc.kernel.is_sheet(body));
    let v = doc.kernel.tessellate(body, 0.0001).unwrap().volume();
    assert!((v - std::f64::consts::PI * 18.0).abs() < 0.05, "volume {v}");
    assert!(doc.undo());
    assert!(doc.kernel.is_sheet(doc.get(sheet).unwrap()));
}
