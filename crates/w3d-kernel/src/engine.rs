//! The model on its own thread, for a UI that must never wait on geometry it no longer needs.
//!
//! OpenCascade shapes can't cross threads, so the [`Document`] lives on one worker and callers send
//! it closures. Previews follow Plasticity's rule (src/command/GeometryFactory.ts:239-291): when
//! several are queued, only the newest runs and the rest return `None` at once. Every other call
//! runs in order, so a commit always sees the previews and undos sent before it.

use std::sync::mpsc::{self, Receiver, Sender};
use std::thread::{self, JoinHandle};

use crate::document::Document;
use crate::Kernel;

type Job<K> = Box<dyn FnOnce(&mut Document<K>, bool) + Send>;

struct Queued<K: Kernel> {
    preview: bool,
    job: Job<K>,
}

pub struct Engine<K: Kernel + 'static> {
    tx: Option<Sender<Queued<K>>>,
    worker: Option<JoinHandle<()>>,
}

impl<K: Kernel + 'static> Engine<K> {
    /// `kernel` is built on the worker, since a kernel's shapes stay on the thread that made them.
    pub fn new(kernel: impl FnOnce() -> K + Send + 'static) -> Self {
        let (tx, rx) = mpsc::channel::<Queued<K>>();
        let worker = thread::spawn(move || run(Document::new(kernel()), rx));
        Engine { tx: Some(tx), worker: Some(worker) }
    }

    /// Run `f` on the model and wait for its answer.
    pub fn call<R: Send + 'static>(&self, f: impl FnOnce(&mut Document<K>) -> R + Send + 'static) -> R {
        self.send(false, f).expect("calls are never skipped")
    }

    /// Run a preview, or return `None` without running it if a newer preview was queued meanwhile.
    pub fn preview<R: Send + 'static>(&self, f: impl FnOnce(&mut Document<K>) -> R + Send + 'static) -> Option<R> {
        self.send(true, f)
    }

    fn send<R: Send + 'static>(&self, preview: bool, f: impl FnOnce(&mut Document<K>) -> R + Send + 'static) -> Option<R> {
        let (reply, answer) = mpsc::sync_channel(1);
        let job: Job<K> = Box::new(move |doc, skip| { let _ = reply.send((!skip).then(|| f(doc))); });
        self.tx.as_ref().unwrap().send(Queued { preview, job }).expect("engine thread stopped");
        answer.recv().expect("engine thread panicked")
    }
}

fn run<K: Kernel>(mut doc: Document<K>, rx: Receiver<Queued<K>>) {
    let mut queue = std::collections::VecDeque::new();
    while let Ok(first) = rx.recv() {
        queue.push_back(first);
        queue.extend(rx.try_iter());
        while let Some(q) = queue.pop_front() {
            // A preview is stale if another preview is waiting right behind it.
            let stale = q.preview && queue.front().is_some_and(|next| next.preview);
            (q.job)(&mut doc, stale);
            queue.extend(rx.try_iter());
        }
    }
}

impl<K: Kernel + 'static> Drop for Engine<K> {
    fn drop(&mut self) {
        drop(self.tx.take());
        if let Some(w) = self.worker.take() { let _ = w.join(); }
    }
}
