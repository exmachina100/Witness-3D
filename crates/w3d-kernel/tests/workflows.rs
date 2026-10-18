//! The three test workflows of the roadmap, run through the Document as the app runs them: a
//! product enclosure, a wing-mirror housing and a grab handle. Every step must succeed and leave a
//! valid solid; a step that cannot work must fail with a reason and leave the document as it was;
//! and each finished model must save and reopen unchanged. Units are mm; the model is Y-up.
//!
//! Run with `-- --nocapture` to print each step with its volume and face count.

#![cfg(feature = "occt")]

use std::f64::consts::PI;

use glam::DVec3;
use opencascade::primitives::Shape;
use w3d_kernel::document::{BodyId, Curve, CurveShape, Document, FormRequest};
use w3d_kernel::occt::Occt;
use w3d_kernel::solids::Primitive;
use w3d_kernel::*;

fn close(a: f64, b: f64, eps: f64) { assert!((a - b).abs() < eps, "{a} != {b} (±{eps})") }

fn volume(k: &Occt, s: &Shape) -> f64 { k.tessellate(s, 0.005).unwrap().volume() }

/// One step's outcome, checked and printed: the body is valid and has the expected volume.
fn step(doc: &Document<Occt>, name: &str, id: BodyId) -> f64 {
    let s = doc.get(id).unwrap();
    assert!(doc.kernel.is_valid(s), "{name}: the solid is not valid");
    let v = volume(&doc.kernel, s);
    println!("  {name:<44} {v:>12.3} mm³  {:>3} faces", doc.kernel.face_count(s));
    v
}

/// A step that must fail: it says why and the document does not change.
fn refused<T>(doc: &Document<Occt>, name: &str, id: BodyId, r: Result<T, KernelError>) {
    let before = doc.revision();
    let v = volume(&doc.kernel, doc.get(id).unwrap());
    match r {
        Ok(_) => panic!("{name}: expected a refusal"),
        Err(e) => {
            let reason = e.to_string();
            assert!(!reason.is_empty(), "{name}: no reason given");
            println!("  {name:<44} refused: {reason}");
        }
    }
    assert_eq!(doc.revision(), before, "{name}: the document changed");
    close(volume(&doc.kernel, doc.get(id).unwrap()), v, 1e-9);
}

fn edges_where(k: &Occt, s: &Shape, keep: impl Fn(DVec3) -> bool) -> Vec<u32> {
    let t = k.tessellate(s, 0.01).unwrap();
    t.edges.iter().enumerate()
        .filter(|(_, pts)| pts.iter().all(|p| keep(DVec3::from_array(*p))))
        .map(|(i, _)| i as u32)
        .collect()
}

fn faces_facing(k: &Occt, s: &Shape, point: DVec3, normal: DVec3) -> Vec<u32> {
    let t = k.tessellate(s, 0.01).unwrap();
    t.face_planes.iter().enumerate()
        .filter(|(_, p)| p.as_ref().is_some_and(|p| p.normal.dot(normal) > 1.0 - 1e-9 && (p.origin - point).dot(normal).abs() < 1e-6))
        .map(|(i, _)| i as u32)
        .collect()
}

/// The quality bar's G1 check: every join is either tangent (faces within 0.5° of each other all
/// along it) or a deliberate crease (more than 5°), never a near miss in between, and at least
/// `smooth` joins are tangent. Returns the worst tangent join in degrees.
fn g1(doc: &Document<Occt>, name: &str, id: BodyId, smooth: usize) -> f64 {
    let angles = doc.kernel.edge_angles(doc.get(id).unwrap());
    let near: Vec<f64> = angles.iter().copied().filter(|&a| a > 0.5 && a < 5.0).collect();
    assert!(near.is_empty(), "{name}: joins that are almost but not quite tangent: {near:?}");
    let tangent: Vec<f64> = angles.iter().copied().filter(|&a| (0.0..=0.5).contains(&a)).collect();
    let worst = tangent.iter().copied().fold(0.0, f64::max);
    println!("  {:<44} {} tangent joins, worst {worst:.4}°", format!("G1 after {name}"), tangent.len());
    assert!(tangent.len() >= smooth, "{name}: {} tangent joins, expected at least {smooth}", tangent.len());
    worst
}

fn fillet(edges: Vec<u32>, size: f64) -> BlendParams {
    assert!(!edges.is_empty(), "no edges to round");
    BlendParams { edges, size, kind: Blend::Fillet, angle: w3d_kernel::blend::EQUAL, variable: vec![] }
}

/// Save to a scratch file and reopen: the same bodies with the same volumes and faces.
fn saves_and_reopens(doc: &Document<Occt>, name: &str) {
    let dir = std::env::temp_dir().join(format!("w3d-workflow-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join(format!("{name}.w3d"));
    file::save(doc, &path).unwrap();
    let mut back = Document::new(Occt);
    file::open(&mut back, &path).unwrap();
    assert_eq!(back.ids(), doc.ids());
    for id in doc.ids() {
        let (a, b) = (doc.get(id).unwrap(), back.get(id).unwrap());
        let v = volume(&doc.kernel, a);
        close(v, volume(&back.kernel, b), 1e-6 * v);
        assert_eq!(doc.kernel.face_count(a), back.kernel.face_count(b));
    }
    println!("  {:<44} {} bodies saved and reopened unchanged", "save and reopen", doc.ids().len());
    std::fs::remove_dir_all(dir).unwrap();
}

fn y_cylinder(at: DVec3, down: bool, radius: f64, height: f64) -> Primitive {
    let normal = if down { DVec3::NEG_Y } else { DVec3::Y };
    Primitive::Cylinder { frame: Frame::new(at, DVec3::X, normal), radius, height }
}

/// An 80 × 30 × 50 enclosure: corners and top rounded, shelled open at the bottom, a cable port
/// through the front, four screw bosses under the lid, each drilled for a screw.
#[test]
fn enclosure() {
    println!("ENCLOSURE");
    let mut doc = Document::new(Occt);
    let a = doc.add(doc.kernel.box_from_corners(DVec3::new(-40.0, 0.0, -25.0), DVec3::new(40.0, 30.0, 25.0)));
    close(step(&doc, "box 80 × 30 × 50", a), 120_000.0, 1.0);

    // The vertical edges: one x and one z all along.
    let t = doc.kernel.tessellate(doc.get(a).unwrap(), 0.01).unwrap();
    let corners: Vec<u32> = t.edges.iter().enumerate()
        .filter(|(_, pts)| pts.iter().all(|p| (p[0] - pts[0][0]).abs() < 1e-6 && (p[2] - pts[0][2]).abs() < 1e-6))
        .map(|(i, _)| i as u32).collect();
    assert_eq!(corners.len(), 4);
    doc.commit_blend(a, &fillet(corners, 8.0)).unwrap();
    close(step(&doc, "fillet the 4 corners r8", a), 120_000.0 - 4.0 * (64.0 - PI * 16.0) * 30.0, 3.0);
    g1(&doc, "corners r8", a, 8);

    let top = edges_where(&doc.kernel, doc.get(a).unwrap(), |p| (p.y - 30.0).abs() < 1e-6);
    assert_eq!(top.len(), 8, "four sides and four corner arcs round the top");
    refused(&doc, "fillet the top r40 (taller than the box)", a, doc.preview_blend(a, &fillet(top.clone(), 40.0)));
    doc.commit_blend(a, &fillet(top, 3.0)).unwrap();
    let rounded = step(&doc, "fillet the top r3", a);
    g1(&doc, "top r3", a, 32);
    assert!(rounded < 120_000.0 - 4.0 * (64.0 - PI * 16.0) * 30.0);

    let bottom = faces_facing(&doc.kernel, doc.get(a).unwrap(), DVec3::ZERO, DVec3::NEG_Y);
    assert_eq!(bottom.len(), 1);
    doc.commit_shell(a, &bottom, 2.0).unwrap();
    let shelled = step(&doc, "shell 2 mm, open at the bottom", a);
    assert!(shelled > 0.08 * rounded && shelled < 0.2 * rounded, "a 2 mm wall is a thin fraction of the solid");

    // A cable port: a 4 mm radius hole through the front wall at mid height.
    let port = Primitive::Cylinder { frame: Frame::new(DVec3::new(0.0, 15.0, 30.0), DVec3::X, DVec3::NEG_Z), radius: 4.0, height: 10.0 };
    doc.commit_primitive(&port, Some(a), Operation::Difference).unwrap();
    let ported = step(&doc, "cable port r4 through the front", a);
    close(ported, shelled - PI * 16.0 * 2.0, 1.0);

    // Four bosses hanging from the lid's underside (y = 28) down to y = 4, then drilled.
    let spots = [(-30.0, -15.0), (30.0, -15.0), (-30.0, 15.0), (30.0, 15.0)];
    for (x, z) in spots { doc.commit_primitive(&y_cylinder(DVec3::new(x, 28.0, z), true, 3.5, 24.0), Some(a), Operation::Union).unwrap(); }
    let bossed = step(&doc, "4 screw bosses r3.5 under the lid", a);
    close(bossed, ported + 4.0 * PI * 3.5 * 3.5 * 24.0, 5.0);
    for (x, z) in spots { doc.commit_primitive(&y_cylinder(DVec3::new(x, 0.0, z), false, 1.25, 20.0), Some(a), Operation::Difference).unwrap(); }
    let drilled = step(&doc, "drill each boss r1.25, 16 mm deep", a);
    close(drilled, bossed - 4.0 * PI * 1.25 * 1.25 * 16.0, 1.0);

    g1(&doc, "the whole enclosure", a, 64);
    saves_and_reopens(&doc, "enclosure");
    // The twelve steps undo back to the box.
    for _ in 0..12 { assert!(doc.undo()) }
    close(volume(&doc.kernel, doc.get(a).unwrap()), 120_000.0, 1.0);
}

fn oval(z: f64, w: f64, h: f64) -> Curve {
    // A closed smooth curve through eight points round a w × h oval, on the plane z = const.
    let points = (0..8).map(|i| { let t = i as f64 * PI / 4.0; [w / 2.0 * t.cos(), h / 2.0 * t.sin()] }).collect();
    Curve { origin: [0.0, 10.0, z], x: [1.0, 0.0, 0.0], normal: [0.0, 0.0, 1.0], shape: CurveShape::Spline { points, closed: true } }
}

/// A wing-mirror housing: three oval sections lofted out from the door, shelled open at the door
/// side, the rim rounded, and mirrored across the car's centre for the other side.
#[test]
fn mirror_housing() {
    println!("MIRROR HOUSING");
    let mut doc = Document::new(Occt);
    let sections = doc.commit_curves(vec![oval(0.0, 60.0, 30.0), oval(40.0, 90.0, 50.0), oval(70.0, 70.0, 40.0)]).unwrap();
    let p = doc.form_params(&sections, FormRequest::Loft, Operation::NewBody).unwrap();
    let a = doc.commit_form(None, &p).unwrap();
    let lofted = step(&doc, "loft 3 oval sections", a);
    // Between the smallest and largest oval sections times the length.
    assert!(lofted > PI * 30.0 * 15.0 * 70.0 && lofted < PI * 45.0 * 25.0 * 70.0, "{lofted}");

    let door = faces_facing(&doc.kernel, doc.get(a).unwrap(), DVec3::new(0.0, 10.0, 0.0), DVec3::NEG_Z);
    assert_eq!(door.len(), 1, "the door end is one flat face");
    refused(&doc, "shell 40 mm (thicker than the housing)", a, doc.preview_shell(a, &door, 40.0));
    doc.commit_shell(a, &door, 2.5).unwrap();
    let shelled = step(&doc, "shell 2.5 mm, open at the door", a);
    assert!(shelled < 0.3 * lofted);

    // Round the outside edge where the cap meets the sides: the only edge at z = 70, as the inner
    // wall stops 2.5 mm short of the cap.
    let cap = edges_where(&doc.kernel, doc.get(a).unwrap(), |p| (p.z - 70.0).abs() < 1e-6);
    assert!(!cap.is_empty(), "the cap's outer edge");
    doc.commit_blend(a, &fillet(cap, 1.5)).unwrap();
    let rounded = step(&doc, "fillet the cap edge r1.5", a);
    g1(&doc, "cap r1.5", a, 2);
    assert!(rounded < shelled);

    let pair = doc.commit_mirror(&[a], DVec3::new(-200.0, 0.0, 0.0), DVec3::X, false).unwrap();
    assert_eq!(pair.len(), 1);
    close(step(&doc, "mirror across the car's centre", pair[0]), rounded, 1e-6 * rounded);
    let box_of = |id| doc.kernel.tessellate(doc.get(id).unwrap(), 0.01).unwrap().positions.iter().map(|p| p[0] as f64).fold(f64::MIN, f64::max);
    assert!(box_of(pair[0]) < -350.0, "the copy sits on the far side");

    saves_and_reopens(&doc, "mirror-housing");
}

/// A grab handle: a 6 mm round bar swept along an arch, joined to a base plate, and rounded where
/// it meets the plate.
#[test]
fn handle() {
    println!("HANDLE");
    let mut doc = Document::new(Occt);
    let plate = doc.add(doc.kernel.box_from_corners(DVec3::new(-15.0, -8.0, -15.0), DVec3::new(95.0, 0.0, 15.0)));
    close(step(&doc, "base plate 110 × 8 × 30", plate), 26_400.0, 1.0);

    // The arch: through (0, -6), (40, 25) and (80, -6) in the XY plane, so both feet end inside
    // the plate; its centre is (40, c) with 40² + (c + 6)² = (25 − c)².
    let c = -(1600.0 + 36.0 - 625.0) / 62.0;
    let r = (40.0f64 * 40.0 + (c + 6.0) * (c + 6.0)).sqrt();
    let start_dir = DVec3::new(-(c + 6.0), 40.0, 0.0).normalize();
    let arch = Curve { origin: [0.0; 3], x: [1.0, 0.0, 0.0], normal: [0.0, 0.0, 1.0], shape: CurveShape::Arc { start: [0.0, -6.0], mid: [40.0, 25.0], end: [80.0, -6.0] } };
    let bar = Curve { origin: [0.0, -6.0, 0.0], x: [0.0, 0.0, 1.0], normal: start_dir.to_array(), shape: CurveShape::Circle { center: [0.0, 0.0], radius: 6.0 } };
    let ids = doc.commit_curves(vec![bar, arch]).unwrap();
    let p = doc.form_params(&ids[..1], FormRequest::Sweep { path: ids[1], twist: 0.0, scale: 1.0 }, Operation::NewBody).unwrap();
    let h = doc.commit_form(None, &p).unwrap();
    let sweep_angle = 2.0 * (40.0f64).atan2(-(c + 6.0));
    let swept = step(&doc, "sweep r6 bar along the arch", h);
    close(swept, PI * 36.0 * r * sweep_angle, 0.005 * swept);

    doc.commit_boolean(plate, &[h], BooleanOp::Union, false).unwrap();
    let joined = step(&doc, "join the handle to the plate", plate);
    assert_eq!(doc.ids(), vec![plate], "the handle is consumed by the join");
    assert!(joined > 26_400.0 + 0.8 * swept && joined < 26_400.0 + swept, "the bar's ends sink into the plate");

    // The seams where the bar meets the plate's top, at either foot of the arch.
    let foot = |p: DVec3| p.y.abs() < 1e-6 && ((p - DVec3::ZERO).length() < 12.0 || (p - DVec3::new(80.0, 0.0, 0.0)).length() < 12.0);
    let seams = edges_where(&doc.kernel, doc.get(plate).unwrap(), foot);
    assert!(!seams.is_empty(), "the bar meets the plate");
    refused(&doc, "fillet the seams r30", plate, doc.preview_blend(plate, &fillet(seams.clone(), 30.0)));
    doc.commit_blend(plate, &fillet(seams, 2.0)).unwrap();
    let rounded = step(&doc, "fillet the seams r2", plate);
    g1(&doc, "seams r2", plate, 4);
    assert!(rounded > joined, "a fillet in a concave corner adds material");

    // Rounded outer edges of the plate.
    let rim = edges_where(&doc.kernel, doc.get(plate).unwrap(), |p| (p.y.abs() < 1e-6) && (p.x.max(-p.x - 0.0) >= 95.0 - 1e-6 || p.x <= -15.0 + 1e-6 || p.z.abs() >= 15.0 - 1e-6));
    assert_eq!(rim.len(), 4);
    doc.commit_blend(plate, &fillet(rim, 2.0)).unwrap();
    step(&doc, "fillet the plate's top rim r2", plate);
    g1(&doc, "rim r2", plate, 12);

    saves_and_reopens(&doc, "handle");
}
