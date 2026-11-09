//! Mesh normals for the Blender bridge: the true surface normal at each point, out of the body,
//! also on reversed faces (a hole's wall) and on moved bodies.

#![cfg(feature = "occt")]

use glam::DVec3;
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

fn check(t: &Tessellation, out: impl Fn(DVec3) -> Option<DVec3>) {
    assert_eq!(t.normals.len(), t.positions.len());
    for (p, n) in t.positions.iter().zip(&t.normals) {
        let (p, n) = (DVec3::from(*p), DVec3::from(*n));
        assert!((n.length() - 1.0).abs() < 1e-6, "not unit at {p}");
        if let Some(want) = out(p) {
            assert!(n.dot(want) > 0.999, "normal {n} at {p}, wanted {want}");
        }
    }
}

#[test]
fn sphere_normals_point_out_radially() {
    let k = Occt;
    let s = k.sphere(DVec3::new(1.0, 2.0, 3.0), 5.0).unwrap();
    check(&k.tessellate(&s, 0.01).unwrap(), |p| Some((p - DVec3::new(1.0, 2.0, 3.0)).normalize()));
}

#[test]
fn a_hole_wall_faces_its_axis() {
    let k = Occt;
    let block = k.box_from_corners(DVec3::new(-10.0, 0.0, -10.0), DVec3::new(10.0, 5.0, 10.0));
    let rod = k.sphere(DVec3::new(0.0, 2.5, 0.0), 2.0).unwrap();
    let cut = k.boolean(&block, &rod, BooleanOp::Difference).unwrap().solid;
    // Points on the spherical cavity: the normal points toward its centre (out of the material).
    check(&k.tessellate(&cut, 0.01).unwrap(), |p| {
        let d = p - DVec3::new(0.0, 2.5, 0.0);
        ((d.length() - 2.0).abs() < 1e-3).then(|| -d.normalize())
    });
}

#[test]
fn moved_body_keeps_true_normals() {
    let k = Occt;
    let s = k.sphere(DVec3::ZERO, 4.0).unwrap();
    let m = Motion { offset: DVec3::new(10.0, 0.0, 0.0), pivot: DVec3::ZERO, axis: DVec3::Y, angle: 1.0, scale: 1.0 };
    let moved = k.transform(&s, &m);
    let t = k.tessellate(&moved, 0.01).unwrap();
    let c = t.positions.iter().map(|p| DVec3::from(*p)).sum::<DVec3>() / t.positions.len() as f64;
    // Every normal points away from the sphere's centre, wherever the move took it.
    for (p, n) in t.positions.iter().zip(&t.normals) {
        assert!(DVec3::from(*n).dot((DVec3::from(*p) - c).normalize()) > 0.99);
    }
}

#[test]
fn rounds_are_level_where_they_meet_the_top() {
    let k = Occt;
    let b = k.box_from_corners(DVec3::ZERO, DVec3::new(80.0, 30.0, 50.0));
    let n = k.tessellate(&b, 0.01).unwrap().edges.len() as u32;
    let r = k.blend(&b, &(0..n).collect::<Vec<_>>(), 4.0, Blend::Fillet, 0.0, &[]).unwrap().solid;
    for tol in [0.01, 0.05, 0.1, 0.5] {
    let t = k.tessellate(&r, tol).unwrap();
    // Where the rounds meet the top (the corner blends' poles too) they are level with it.
    let worst = t.positions.iter().zip(&t.normals).filter(|(p, _)| (p[1] - 30.0).abs() < 1e-7).map(|(_, n)| n[1]).fold(1.0, f64::min);
    assert!(worst > 0.99999, "{worst} at {tol}");
    }
}
