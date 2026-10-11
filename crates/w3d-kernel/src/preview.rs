//! Live previews that never fall behind the cursor.
//!
//! Plasticity's GeometryFactory (src/command/GeometryFactory.ts:239-291) lets one update run at a
//! time and collapses every request made meanwhile into a single `hasNext` flag, so only the latest
//! parameters get computed. Here the same rule runs on a background thread: `request` replaces any
//! waiting parameters, the worker always takes the newest, and stale results are never delivered.

use std::sync::{Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};

struct Slot<P> {
    next: Option<(u64, P)>,
    closed: bool,
}

pub struct Previewer<P: Send + 'static> {
    shared: Arc<(Mutex<Slot<P>>, Condvar)>,
    seq: u64,
    worker: Option<JoinHandle<()>>,
}

impl<P: Send + 'static> Previewer<P> {
    /// `compute` runs on the worker for each parameter set it picks up, with that request's number.
    pub fn new(mut compute: impl FnMut(u64, P) + Send + 'static) -> Self {
        let shared = Arc::new((Mutex::new(Slot { next: None, closed: false }), Condvar::new()));
        let s = shared.clone();
        let worker = thread::spawn(move || loop {
            let (lock, cv) = &*s;
            let mut slot = lock.lock().unwrap();
            while slot.next.is_none() && !slot.closed {
                slot = cv.wait(slot).unwrap();
            }
            let Some((seq, params)) = slot.next.take() else { return };
            drop(slot);
            compute(seq, params);
        });
        Previewer { shared, seq: 0, worker: Some(worker) }
    }

    /// Ask for a preview. Any request still waiting is dropped in favour of this one.
    pub fn request(&mut self, params: P) -> u64 {
        self.seq += 1;
        let (lock, cv) = &*self.shared;
        lock.lock().unwrap().next = Some((self.seq, params));
        cv.notify_one();
        self.seq
    }

    /// Finish the last computation and stop the worker.
    pub fn close(mut self) {
        self.shutdown();
    }

    fn shutdown(&mut self) {
        let (lock, cv) = &*self.shared;
        lock.lock().unwrap().closed = true;
        cv.notify_one();
        if let Some(w) = self.worker.take() { w.join().unwrap() }
    }
}

impl<P: Send + 'static> Drop for Previewer<P> {
    fn drop(&mut self) { self.shutdown() }
}
