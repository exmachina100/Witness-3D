//! The engine's scheduling, with a stand-in kernel so it runs in every build.

use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use glam::DVec3;
use w3d_kernel::engine::Engine;
use w3d_kernel::*;

struct NoKernel;
impl Kernel for NoKernel {
    type Solid = ();
    fn box_from_corners(&self, _: DVec3, _: DVec3) {}
    fn extrude(&self, _: &Profile, _: &Frame, _: f64) -> Result<(), KernelError> { Ok(()) }
    fn boolean(&self, _: &(), _: &(), _: BooleanOp) -> Result<(), KernelError> { Ok(()) }
    fn solid_count(&self, _: &()) -> usize { 1 }
    fn face_count(&self, _: &()) -> usize { 6 }
    fn edge_count(&self, _: &()) -> usize { 12 }
    fn blend(&self, _: &(), _: &[u32], _: f64, _: Blend) -> Result<(), KernelError> { Ok(()) }
    fn is_valid(&self, _: &()) -> bool { true }
    fn tessellate(&self, _: &(), _: f64) -> Result<Tessellation, KernelError> { Ok(Tessellation::default()) }
    fn write_step(&self, _: &(), _: &std::path::Path) -> Result<(), KernelError> { Ok(()) }
    fn read_step(&self, _: &std::path::Path) -> Result<(), KernelError> { Ok(()) }
    fn native_format(&self) -> &'static str { "none" }
    fn to_native(&self, _: &()) -> Result<String, KernelError> { Ok("()".into()) }
    fn from_native(&self, _: &str) -> Result<(), KernelError> { Ok(()) }
}

#[test]
fn queued_previews_collapse_to_the_newest() {
    let engine = Arc::new(Engine::new(|| NoKernel));
    let ran = Arc::new(Mutex::new(Vec::new()));

    // Keep the engine busy while five drags arrive.
    let busy = { let e = engine.clone(); thread::spawn(move || e.call(|_| thread::sleep(Duration::from_millis(100)))) };
    thread::sleep(Duration::from_millis(20));
    let drags: Vec<_> = (1..=5).map(|i| {
        let (e, r) = (engine.clone(), ran.clone());
        let h = thread::spawn(move || e.preview(move |_| r.lock().unwrap().push(i)));
        thread::sleep(Duration::from_millis(10));
        h
    }).collect();
    busy.join().unwrap();
    let answers: Vec<_> = drags.into_iter().map(|h| h.join().unwrap()).collect();

    assert_eq!(*ran.lock().unwrap(), vec![5], "only the last drag was computed");
    assert_eq!(answers.iter().filter(|a| a.is_some()).count(), 1);
}

#[test]
fn calls_run_in_order_and_see_the_document() {
    let engine = Engine::new(|| NoKernel);
    let id = engine.call(|doc| doc.add(()));
    assert_eq!(engine.call(|doc| doc.ids()), vec![id]);
    assert!(engine.call(|doc| doc.undo()));
    assert!(engine.call(|doc| doc.ids().is_empty()));
    assert_eq!(engine.preview(|doc| doc.ids().len()), Some(0), "a lone preview runs");
}

#[test]
fn native_files_keep_ids_and_refuse_what_they_cannot_read() {
    use w3d_kernel::document::Document;
    let mut doc = Document::new(NoKernel);
    doc.add(());
    let b = doc.add(());
    doc.remove(1);
    let text = file::write(&doc).unwrap();

    let mut other = Document::new(NoKernel);
    file::read(&mut other, &text).unwrap();
    assert_eq!(other.ids(), vec![b]);
    assert!(!other.undo(), "history restarts at the opened state");
    assert_eq!(other.add(()), b + 1, "ids continue after the saved ones");

    let newer = text.replace("\"version\":1", "\"version\":2");
    assert!(file::read(&mut other, &newer).unwrap_err().to_string().contains("newer"));
    let other_kernel = text.replace("\"encoding\":\"none\"", "\"encoding\":\"occt-brep\"");
    assert!(file::read(&mut other, &other_kernel).is_err());
    assert!(file::read(&mut other, "{}").is_err());
}

#[test]
fn blend_checks_its_inputs_before_the_kernel() {
    let k = NoKernel;
    let p = |edges: Vec<u32>, size| BlendParams { edges, size, kind: Blend::Fillet };
    assert!(blend(&k, &(), &p(vec![0, 1], 2.0)).is_ok());
    assert!(matches!(blend(&k, &(), &p(vec![], 2.0)), Err(KernelError::Invalid(_))));
    assert!(matches!(blend(&k, &(), &p(vec![0], 0.0)), Err(KernelError::Invalid(_))));
    assert!(matches!(blend(&k, &(), &p(vec![0], f64::NAN)), Err(KernelError::Invalid(_))));
    assert!(matches!(blend(&k, &(), &p(vec![12], 1.0)), Err(KernelError::Invalid(_))));
}
