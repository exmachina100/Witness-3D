//! The preview worker needs no kernel, so this runs in every build.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use w3d_kernel::preview::Previewer;

#[test]
fn previews_skip_stale_drags() {
    let done = Arc::new(Mutex::new(Vec::new()));
    let d = done.clone();
    let mut previewer = Previewer::new(move |seq, distance: f64| {
        std::thread::sleep(Duration::from_millis(30)); // a slow boolean
        d.lock().unwrap().push((seq, distance));
    });
    for i in 1..=20 { previewer.request(i as f64 / 10.0); std::thread::sleep(Duration::from_millis(2)) }
    previewer.close();
    let done = done.lock().unwrap();
    assert!(done.len() < 20, "intermediate drags were dropped, computed {}", done.len());
    assert_eq!(done.last().unwrap().1, 2.0, "the last drag is always computed");
}
