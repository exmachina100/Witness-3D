/**
 * Accessible, non-destructive modal foundation for Witness 3D.
 *
 * Content can be a DOM Node or a trusted application-owned string. Prefer
 * DOM nodes for user-derived values so they are never parsed as HTML.
 * Tool integration must supply its own preview/commit/rollback callbacks.
 */
export class Modal {
  constructor(title, content, actions = [
    { label: 'OK', id: 'ok', primary: true },
    { label: 'Cancel', id: 'cancel' },
  ], options = {}) {
    this.title = title;
    this.content = content;
    this.actions = actions;
    this.onAction = options.onAction ?? (() => {});
    this.onCancel = options.onCancel ?? (() => {});
    this.closeOnBackdrop = options.closeOnBackdrop ?? true;
    this.root = null;
    this.dialog = null;
    this.previousFocus = null;
    this._onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.cancel();
        return;
      }
      if (event.key === 'Tab') this._trapFocus(event);
      if (event.key === 'Enter' && event.target?.tagName !== 'TEXTAREA' &&
          !event.isComposing && !event.target?.closest?.('[data-modal-enter-ignore]')) {
        // Native buttons trigger their own clicks; avoid double commits.
        if (event.target?.tagName === 'BUTTON') return;
        const primary = this.actions.find(a => a.primary && !a.disabled);
        if (primary) {
          event.preventDefault();
          event.stopPropagation();
          this.trigger(primary);
        }
      }
    };
  }

  static focusable = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  _trapFocus(event) {
    const items = Array.from(this.dialog.querySelectorAll(Modal.focusable))
      .filter(el => !el.hidden && el.getAttribute('aria-hidden') !== 'true');
    if (!items.length) { event.preventDefault(); this.dialog.focus(); return; }
    const first = items[0], last = items[items.length - 1];
    const active = this.dialog.ownerDocument.activeElement;
    if (event.shiftKey && (active === first || !this.dialog.contains(active))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (active === last || !this.dialog.contains(active))) {
      event.preventDefault(); first.focus();
    }
  }

  open(parent = document.body) {
    if (this.root) return this;
    const doc = parent.ownerDocument ?? document;
    this.previousFocus = doc.activeElement;
    const root = doc.createElement('div');
    root.className = 'w3d-modal-overlay';
    root.style.cssText = 'position:fixed;inset:0;z-index:10000;display:grid;place-items:center;background:rgba(0,0,0,.52);';
    const dialog = doc.createElement('section');
    dialog.className = 'w3d-modal-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('tabindex', '-1');
    dialog.style.cssText = 'width:min(440px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;padding:20px;background:#24262b;color:#f5f6f8;border:1px solid #565b65;border-radius:12px;box-shadow:0 18px 60px #0009;font:13px system-ui,sans-serif;';
    const header = doc.createElement('header');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;';
    const heading = doc.createElement('h2');
    heading.textContent = this.title;
    heading.style.cssText = 'font-size:15px;font-weight:650;margin:0;';
    const headingId = 'w3d-modal-title-' + (++Modal.sequence);
    heading.id = headingId;
    dialog.setAttribute('aria-labelledby', headingId);
    const close = doc.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Cancel and close dialog');
    close.style.cssText = 'border:0;background:transparent;color:inherit;font-size:22px;cursor:pointer;';
    close.addEventListener('click', () => this.cancel());
    header.append(heading, close);
    const body = doc.createElement('div');
    body.className = 'w3d-modal-content';
    if (typeof this.content === 'string') body.textContent = this.content;
    else if (this.content) body.append(this.content);
    const footer = doc.createElement('footer');
    footer.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:20px;';
    for (const action of this.actions) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.textContent = action.label;
      button.disabled = !!action.disabled;
      button.dataset.action = action.id ?? action.label.toLowerCase();
      button.style.cssText = 'padding:8px 14px;border-radius:6px;border:1px solid #737985;background:' +
        (action.primary ? '#e1c357;color:#171717;' : '#34373d;color:#fff;') + 'cursor:pointer;';
      button.addEventListener('click', () => this.trigger(action));
      footer.append(button);
    }
    dialog.append(header, body, footer);
    root.append(dialog);
    root.addEventListener('mousedown', event => {
      if (event.target === root && this.closeOnBackdrop) this.cancel();
    });
    this.root = root;
    this.dialog = dialog;
    parent.append(root);
    doc.addEventListener('keydown', this._onKeyDown, true);
    (dialog.querySelector('[data-action]') ?? close).focus();
    return this;
  }

  trigger(action) {
    if (!this.root || action.disabled) return;
    if (action.id === 'cancel' || action.label.toLowerCase() === 'cancel') {
      this.cancel();
      return;
    }
    const result = this.onAction(action.id ?? action.label.toLowerCase(), action);
    // Asynchronous commits keep their dialog open until the caller resolves.
    if (result && typeof result.then === 'function') {
      result.then(value => { if (value !== false && action.close !== false) this.close(); })
        .catch(error => { this.dialog?.dispatchEvent(new CustomEvent('modal-error', { detail: error })); });
    } else if (result !== false && action.close !== false) this.close();
  }

  cancel() {
    if (!this.root) return;
    this.onCancel();
    this.close();
  }

  close() {
    if (!this.root) return;
    this.root.ownerDocument.removeEventListener('keydown', this._onKeyDown, true);
    this.root.remove();
    this.root = null;
    this.dialog = null;
    if (this.previousFocus?.isConnected) this.previousFocus.focus();
    this.previousFocus = null;
  }
}
Modal.sequence = 0;
