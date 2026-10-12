//! Join Curves (Plasticity's J): curves that meet end to end become one curve. Plasticity hands the
//! selected curves to its kernel's contour builder, which orders them, turns pieces round as needed
//! and returns one contour per connected run (nkallen/plasticity
//! `src/commands/curve/JoinCurvesFactory.ts`); a closed contour then bounds a region.

use crate::document::{Curve, CurveShape};
use crate::KernelError;

/// How close two ends must be to count as meeting, in millimetres.
pub const MEET: f64 = 1e-4;

type P = [f64; 2];

fn near(a: P, b: P) -> bool { (a[0] - b[0]).hypot(a[1] - b[1]) <= MEET }

/// The two ends of an open piece.
pub(crate) fn ends(piece: &CurveShape) -> Option<(P, P)> {
    match piece {
        CurveShape::Polyline { points, closed: false } | CurveShape::Spline { points, closed: false } => Some((*points.first()?, *points.last()?)),
        CurveShape::Arc { start, end, .. } => Some((*start, *end)),
        _ => None,
    }
}

/// Whether contour pieces close into a loop.
pub(crate) fn loops(pieces: &[CurveShape]) -> bool {
    match (pieces.first().and_then(ends), pieces.last().and_then(ends)) {
        (Some((a, _)), Some((_, b))) => near(a, b) && !(pieces.len() == 1 && matches!(pieces[0], CurveShape::Arc { .. })),
        _ => false,
    }
}

fn map(piece: &CurveShape, f: impl Fn(P) -> P) -> CurveShape {
    match piece {
        CurveShape::Polyline { points, closed } => CurveShape::Polyline { points: points.iter().map(|p| f(*p)).collect(), closed: *closed },
        CurveShape::Spline { points, closed } => CurveShape::Spline { points: points.iter().map(|p| f(*p)).collect(), closed: *closed },
        CurveShape::Arc { start, mid, end } => CurveShape::Arc { start: f(*start), mid: f(*mid), end: f(*end) },
        other => other.clone(),
    }
}

fn reversed(piece: &CurveShape) -> CurveShape {
    match piece {
        CurveShape::Polyline { points, closed } => CurveShape::Polyline { points: points.iter().rev().copied().collect(), closed: *closed },
        CurveShape::Spline { points, closed } => CurveShape::Spline { points: points.iter().rev().copied().collect(), closed: *closed },
        CurveShape::Arc { start, mid, end } => CurveShape::Arc { start: *end, mid: *mid, end: *start },
        other => other.clone(),
    }
}

/// The piece with its first or last point moved exactly onto `to`.
fn snapped(piece: &CurveShape, first: bool, to: P) -> CurveShape {
    let mut p = piece.clone();
    match &mut p {
        CurveShape::Polyline { points, .. } | CurveShape::Spline { points, .. } => {
            let i = if first { 0 } else { points.len() - 1 };
            points[i] = to;
        }
        CurveShape::Arc { start, end, .. } => *(if first { start } else { end }) = to,
        _ => {}
    }
    p
}

/// The selected curves joined: one curve per run of pieces that meet end to end, in the plane of
/// the first. Runs made only of lines become one line (closed when it loops); others a contour.
pub fn join(curves: &[Curve]) -> Result<Vec<Curve>, KernelError> {
    if curves.len() < 2 { return Err(KernelError::Invalid("select two curves or more to join")) }
    let frame = curves[0].frame();
    let mut pieces = Vec::new();
    for c in curves {
        let f = c.frame();
        if f.normal.cross(frame.normal).length() > 1e-6 || (f.origin - frame.origin).dot(frame.normal).abs() > MEET {
            return Err(KernelError::Invalid("only curves in one plane can be joined"));
        }
        let to_first = |p: P| { let d = f.point((p[0], p[1])) - frame.origin; [d.dot(frame.x), d.dot(frame.y())] };
        let own = match &c.shape { CurveShape::Contour { pieces } => pieces.clone(), s => vec![s.clone()] };
        for p in own {
            if ends(&p).is_none() { return Err(KernelError::Invalid("only curves with two ends can be joined")) }
            pieces.push(map(&p, to_first));
        }
    }

    let mut used = vec![false; pieces.len()];
    let mut out = Vec::new();
    for seed in 0..pieces.len() {
        if used[seed] { continue }
        used[seed] = true;
        let mut run = std::collections::VecDeque::from([pieces[seed].clone()]);
        loop {
            let (head, tail) = (ends(&run[0]).unwrap().0, ends(&run[run.len() - 1]).unwrap().1);
            if run.len() > 1 && near(head, tail) { break }
            let next = (0..pieces.len()).filter(|&i| !used[i]).find_map(|i| {
                let (a, b) = ends(&pieces[i]).unwrap();
                if near(a, tail) { Some((i, snapped(&pieces[i], true, tail), false)) }
                else if near(b, tail) { Some((i, snapped(&reversed(&pieces[i]), true, tail), false)) }
                else if near(b, head) { Some((i, snapped(&pieces[i], false, head), true)) }
                else if near(a, head) { Some((i, snapped(&reversed(&pieces[i]), false, head), true)) }
                else { None }
            });
            let Some((i, piece, front)) = next else { break };
            used[i] = true;
            if front { run.push_front(piece) } else { run.push_back(piece) }
        }
        let mut run: Vec<CurveShape> = run.into();
        let closed = run.len() > 1 && near(ends(&run[0]).unwrap().0, ends(&run[run.len() - 1]).unwrap().1);
        if closed {
            let head = ends(&run[0]).unwrap().0;
            let last = run.len() - 1;
            run[last] = snapped(&run[last], false, head);
        }
        let shape = if run.iter().all(|p| matches!(p, CurveShape::Polyline { .. })) {
            let mut points: Vec<P> = Vec::new();
            for p in &run {
                let CurveShape::Polyline { points: q, .. } = p else { unreachable!() };
                for &pt in q { if points.last().map_or(true, |&l| !near(l, pt)) { points.push(pt) } }
            }
            if closed && points.len() > 1 && near(points[0], points[points.len() - 1]) { points.pop(); }
            CurveShape::Polyline { points, closed }
        } else if run.len() == 1 {
            run.pop().unwrap()
        } else {
            CurveShape::Contour { pieces: run }
        };
        out.push(Curve { origin: frame.origin.to_array(), x: frame.x.to_array(), normal: frame.normal.to_array(), shape });
    }
    Ok(out)
}

