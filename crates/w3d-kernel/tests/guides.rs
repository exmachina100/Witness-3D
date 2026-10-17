//! Loft and Sweep guides and Sweep alignment (Plasticity's Loft "Select guides", Sweep "Guide
//! method" and "Alignment"). Units are mm.

#![cfg(feature = "occt")]

use std::f64::consts::FRAC_1_SQRT_2;

use glam::DVec3;
use w3d_kernel::extrude::Operation;
use w3d_kernel::form::{self, Alignment, FormKind, FormParams, GuideMethod};
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

fn line(a: DVec3, b: DVec3) -> Path { Path::Polyline { points: vec![a, b], closed: false } }
fn ground(z: f64) -> Frame { Frame::new(DVec3::new(0.0, 0.0, z), DVec3::X, DVec3::Z) }
/// A square from (0, 0) to (s, s) on its frame.
fn square(s: f64) -> Profile { Profile::Polygon(vec![(0.0, 0.0), (s, 0.0), (s, s), (0.0, s)]) }
fn volume(k: &Occt, s: &<Occt as Kernel>::Solid) -> f64 { k.tessellate(s, 0.001).unwrap().volume() }
/// The least and greatest of each coordinate over the tessellation.
fn bounds(k: &Occt, s: &<Occt as Kernel>::Solid) -> (DVec3, DVec3) {
    let t = k.tessellate(s, 0.001).unwrap();
    t.positions.iter().map(|p| DVec3::from_array(*p)).fold((DVec3::splat(f64::MAX), DVec3::splat(f64::MIN)), |(lo, hi), p| (lo.min(p), hi.max(p)))
}
/// The farthest any of `points` lies from the surface (its fine tessellation).
fn farthest(k: &Occt, s: &<Occt as Kernel>::Solid, points: &[DVec3]) -> f64 {
    let t = k.tessellate(s, 0.0005).unwrap();
    let tri: Vec<[DVec3; 3]> = t.indices.chunks_exact(3).map(|c| [c[0], c[1], c[2]].map(|i| DVec3::from_array(t.positions[i as usize]))).collect();
    points.iter().map(|&p| tri.iter().map(|&[a, b, c]| {
        // Point to triangle: the plane if the foot is inside, else the nearest side.
        let n = (b - a).cross(c - a).normalize();
        let foot = p - n * (p - a).dot(n);
        let inside = [(a, b), (b, c), (c, a)].iter().all(|&(u, v)| (v - u).cross(foot - u).dot(n) >= -1e-12);
        if inside { return (p - foot).length() }
        [(a, b), (b, c), (c, a)].iter().map(|&(u, v)| {
            let t = ((p - u).dot(v - u) / (v - u).length_squared()).clamp(0.0, 1.0);
            (p - (u + (v - u) * t)).length()
        }).fold(f64::MAX, f64::min)
    }).fold(f64::MAX, f64::min)).fold(0.0, f64::max)
}
/// Points along the circular arc from `a` through `m` to `b`.
fn arc_points(a: DVec3, m: DVec3, b: DVec3) -> Vec<DVec3> {
    // The circumcentre of the three points.
    let (u, v) = (m - a, b - a);
    let w = u.cross(v);
    let c = a + (v * u.length_squared() - u * v.length_squared()).cross(w) / (2.0 * w.length_squared());
    let (x, n) = ((a - c).normalize(), w.normalize());
    let y = n.cross(x);
    let angle = |p: DVec3| { let d = p - c; let t = d.dot(y).atan2(d.dot(x)); if t < 0.0 { t + std::f64::consts::TAU } else { t } };
    let (r, end) = ((a - c).length(), angle(b));
    (0..=40).map(|i| { let t = end * i as f64 / 40.0; c + (x * t.cos() + y * t.sin()) * r }).collect()
}

fn loft(guides: Vec<Path>) -> Result<<Occt as Kernel>::Solid, KernelError> {
    form::tool(&Occt, &FormParams {
        profile: square(10.0),
        frame: ground(0.0),
        kind: FormKind::Loft { more: vec![(square(10.0), ground(20.0))], guides },
        operation: Operation::NewBody,
    })
}
fn sweep(profile: Profile, frame: Frame, path: Path, guide: Option<Path>, method: GuideMethod, align: Alignment) -> Result<<Occt as Kernel>::Solid, KernelError> {
    form::tool(&Occt, &FormParams { profile, frame, kind: FormKind::Sweep { path, twist: 0.0, scale: 1.0, guide, method, align }, operation: Operation::NewBody })
}

#[test]
fn a_loft_along_a_straight_guide_is_the_plain_loft() {
    let k = Occt;
    let s = loft(vec![line(DVec3::ZERO, DVec3::new(0.0, 0.0, 20.0))]).unwrap();
    assert!(k.is_valid(&s));
    let v = volume(&k, &s);
    assert!((v - 2000.0).abs() < 0.5, "volume {v}");
}

#[test]
fn a_loft_bends_out_to_its_guide() {
    let k = Occt;
    // An arc from the corner at the bottom out to x = -5 and back to the corner at the top.
    let arc = Path::Arc { start: DVec3::ZERO, mid: DVec3::new(-5.0, 0.0, 10.0), end: DVec3::new(0.0, 0.0, 20.0) };
    let s = loft(vec![arc]).unwrap();
    assert!(k.is_valid(&s));
    let (lo, hi) = bounds(&k, &s);
    assert!((lo.x + 5.0).abs() < 0.01, "reaches the guide: min x {}", lo.x);
    assert!((hi.z - 20.0).abs() < 0.01 && lo.z.abs() < 0.01, "ends on the profiles: z {}..{}", lo.z, hi.z);
    let off = farthest(&k, &s, &arc_points(DVec3::ZERO, DVec3::new(-5.0, 0.0, 10.0), DVec3::new(0.0, 0.0, 20.0)));
    assert!(off < 0.01, "the guide lies on the loft within {off} mm");
}

#[test]
fn a_second_guide_stretches_the_loft() {
    let k = Occt;
    let a = line(DVec3::ZERO, DVec3::new(0.0, 0.0, 20.0));
    // The far corner bows out to x = 15.
    let b = Path::Arc { start: DVec3::new(10.0, 10.0, 0.0), mid: DVec3::new(15.0, 10.0, 10.0), end: DVec3::new(10.0, 10.0, 20.0) };
    let s = loft(vec![a, b]).unwrap();
    assert!(k.is_valid(&s));
    let (lo, hi) = bounds(&k, &s);
    assert!((hi.x - 15.0).abs() < 0.05, "follows the second guide: max x {}", hi.x);
    assert!(lo.x.abs() < 0.01, "keeps to the first: min x {}", lo.x);
    assert!(volume(&k, &s) > 2000.0 + 1.0);
}

#[test]
fn guides_that_miss_the_profiles_are_refused() {
    let off = line(DVec3::new(-3.0, 0.0, 0.0), DVec3::new(-3.0, 0.0, 20.0));
    let e = loft(vec![off]).err().unwrap().to_string();
    assert!(e.contains("touch"), "{e}");
    let three = vec![line(DVec3::ZERO, DVec3::new(0.0, 0.0, 20.0)); 3];
    assert!(loft(three).err().unwrap().to_string().contains("two guides"));
}

/// A 10 × 10 square centred on the Z axis, swept up 20 with its corner (5, 5) led along `guide`.
fn guided(method: GuideMethod) -> <Occt as Kernel>::Solid {
    let profile = Profile::Polygon(vec![(-5.0, -5.0), (5.0, -5.0), (5.0, 5.0), (-5.0, 5.0)]);
    let guide = line(DVec3::new(5.0, 5.0, 0.0), DVec3::new(10.0, 10.0, 20.0));
    sweep(profile, ground(0.0), line(DVec3::ZERO, DVec3::new(0.0, 0.0, 20.0)), Some(guide), method, Alignment::Normal).unwrap()
}

#[test]
fn point_keeps_the_section_on_the_guide_and_chord_does_not_scale() {
    let k = Occt;
    // Point: the corner runs out along the guide, so the section doubles: a frustum.
    let grown = guided(GuideMethod::Point);
    assert!(k.is_valid(&grown));
    let v = volume(&k, &grown);
    let frustum = 20.0 / 3.0 * (100.0 + 400.0 + 200.0);
    assert!((v - frustum).abs() / frustum < 1e-3, "point volume {v} vs {frustum}");
    let (_, hi) = bounds(&k, &grown);
    assert!((hi.x - 10.0).abs() < 0.01, "max x {}", hi.x);
    let rail: Vec<DVec3> = (0..=40).map(|i| DVec3::new(5.0, 5.0, 0.0).lerp(DVec3::new(10.0, 10.0, 20.0), i as f64 / 40.0)).collect();
    let off = farthest(&k, &grown, &rail);
    assert!(off < 0.01, "the guide lies on the sweep within {off} mm");
    // Chord: the guide keeps to one side, so the section neither turns nor grows.
    let kept = guided(GuideMethod::Chord);
    let v = volume(&k, &kept);
    assert!((v - 2000.0).abs() < 0.5, "chord volume {v}");
}

#[test]
fn parallel_keeps_the_section_at_its_drawn_angle() {
    let k = Occt;
    // A 2 × 2 square on the ground, swept a quarter turn from the origin up to (10, 0, 10).
    let c = FRAC_1_SQRT_2;
    // Centre (10, 0, 0): leaving the origin straight up, arriving at (10, 0, 10) along +X.
    let arc = Path::Arc { start: DVec3::ZERO, mid: DVec3::new(10.0 - 10.0 * c, 0.0, 10.0 * c), end: DVec3::new(10.0, 0.0, 10.0) };
    let profile = Profile::Polygon(vec![(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)]);
    let turned = sweep(profile.clone(), ground(0.0), arc.clone(), None, GuideMethod::Point, Alignment::Normal).unwrap();
    let (_, hi) = bounds(&k, &turned);
    assert!((hi.z - 11.0).abs() < 0.05, "normal ends standing up: max z {}", hi.z);
    let flat = sweep(profile, ground(0.0), arc, None, GuideMethod::Point, Alignment::Parallel).unwrap();
    assert!(k.is_valid(&flat));
    let (_, hi) = bounds(&k, &flat);
    assert!((hi.z - 10.0).abs() < 0.01, "parallel ends lying flat: max z {}", hi.z);
}

#[test]
fn guides_and_parallel_refuse_twist() {
    let r = form::tool(&Occt, &FormParams {
        profile: square(2.0),
        frame: ground(0.0),
        kind: FormKind::Sweep { path: line(DVec3::ZERO, DVec3::new(0.0, 0.0, 5.0)), twist: 1.0, scale: 1.0, guide: None, method: GuideMethod::Point, align: Alignment::Parallel },
        operation: Operation::NewBody,
    });
    assert!(r.err().unwrap().to_string().contains("twist"));
}

#[test]
fn the_document_takes_guides_by_curve() {
    use w3d_kernel::document::{Curve, CurveShape, Document, FormRequest};
    let mut doc = Document::new(Occt);
    // Two 10 × 10 squares, on the ground and 20 up, and a guide up their (0, 0) corners that
    // bows out to x = -5; the square drawn on a plane square to Y, so its plane y runs along -Z.
    let at = |z: f64| Curve { origin: [0.0, z, 0.0], x: [1.0, 0.0, 0.0], normal: [0.0, 1.0, 0.0], shape: CurveShape::Polyline { points: vec![[0.0, 0.0], [10.0, 0.0], [10.0, -10.0], [0.0, -10.0]], closed: true } };
    let guide = Curve { origin: [0.0, 0.0, 0.0], x: [1.0, 0.0, 0.0], normal: [0.0, 0.0, 1.0], shape: CurveShape::Arc { start: [0.0, 0.0], mid: [-5.0, 10.0], end: [0.0, 20.0] } };
    let ids = doc.commit_curves(vec![at(0.0), at(20.0), guide]).unwrap();
    let p = doc.form_params(&ids[..2], FormRequest::LoftGuided { guides: vec![ids[2]] }, Operation::NewBody).unwrap();
    let body = doc.commit_form(None, &p).unwrap();
    let (lo, _) = bounds(&doc.kernel, doc.get(body).unwrap());
    assert!((lo.x + 5.0).abs() < 0.01, "min x {}", lo.x);
    assert!(doc.form_params(&ids[..2], FormRequest::LoftGuided { guides: vec![ids[0]] }, Operation::NewBody).is_err());
    // The same guide as a sweep's, along a straight path up the squares' far corner.
    let path = Curve { origin: [0.0, 0.0, 0.0], x: [1.0, 0.0, 0.0], normal: [0.0, 0.0, 1.0], shape: CurveShape::Polyline { points: vec![[10.0, 0.0], [10.0, 20.0]], closed: false } };
    let path = doc.commit_curves(vec![path]).unwrap()[0];
    let p = doc.form_params(&ids[..1], FormRequest::SweepGuided { path, guide: Some(ids[2]), method: GuideMethod::Chord, align: Alignment::Normal }, Operation::NewBody).unwrap();
    assert!(doc.preview_form(None, &p).is_ok());
}
