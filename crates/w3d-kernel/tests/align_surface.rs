//! Align Surface's view of an edge (Kernel::edge_faces): the faces along it, their control surfaces
//! and their frames at given points, in the flat layout web/src/alignSurface.js reads (its tests
//! cover the alignment itself). Units are mm.

#![cfg(feature = "occt")]

use glam::DVec3;
use w3d_kernel::occt::Occt;
use w3d_kernel::*;

#[test]
fn a_box_edge_has_two_flat_faces_with_frames() {
    let k = Occt;
    let b = k.box_from_corners(DVec3::ZERO, DVec3::new(20.0, 10.0, 5.0));
    let t = k.tessellate(&b, 0.01).unwrap();
    // The edge along x at y = 0, z = 5.
    let edge = t.edges.iter().position(|e| e.iter().all(|p| p[1].abs() < 1e-9 && (p[2] - 5.0).abs() < 1e-9)).unwrap() as u32;
    let pts = [DVec3::new(3.0, 0.0, 5.0), DVec3::new(17.0, 0.0, 5.0)];
    let raw = k.edge_faces(&b, edge, &pts).unwrap();
    assert_eq!(raw[0], 2.0, "two faces meet at a box edge");
    let mut i = 1;
    for _ in 0..2 {
        i += 4; // face number, middle
        assert_eq!(raw[i], 1.0, "a flat face has control points");
        let (nu, nv, nku, nkv) = (raw[i + 3] as usize, raw[i + 4] as usize, raw[i + 5] as usize, raw[i + 6] as usize);
        assert_eq!((raw[i + 1], raw[i + 2]), (1.0, 1.0), "degree 1 each way");
        assert_eq!((nku, nkv), (nu + 2, nv + 2));
        i += 7 + nku + nkv + 1 + nu * nv * 3;
        for p in pts {
            let at = DVec3::new(raw[i], raw[i + 1], raw[i + 2]);
            assert!(at.distance(p) < 1e-9, "the point lies on the face: {at}");
            let (su, sv) = (DVec3::new(raw[i + 3], raw[i + 4], raw[i + 5]), DVec3::new(raw[i + 6], raw[i + 7], raw[i + 8]));
            assert!(su.cross(sv).length() > 1e-9);
            assert!(raw[i + 9..i + 18].iter().all(|v| v.abs() < 1e-9), "flat faces don't bend");
            assert!(raw[i + 18].abs() == 1.0);
            i += 19;
        }
    }
    assert_eq!(i, raw.len());
}
