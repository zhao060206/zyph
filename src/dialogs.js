export function setupDialogs(closeHandlers) {
  const openers = new Map();
  let top = null;
  const isOpen = element => !element.hidden && (element.id !== 'lightbox' || element.classList.contains('open'));
  const roots = Object.keys(closeHandlers).map(id => document.getElementById(id)).filter(Boolean);
  const focusables = root => [...root.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')]
    .filter(el => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length);
  function sync() {
    top = roots.filter(isOpen).sort((a, b) => Number(getComputedStyle(a).zIndex) - Number(getComputedStyle(b).zIndex)).pop() || null;
    for (const root of [document.querySelector('.topbar'), document.getElementById('archive'), document.getElementById('groupPage')]) {
      if (root && 'inert' in root) root.inert = !!top;
    }
    for (const root of roots) {
      if (isOpen(root) && !openers.has(root)) openers.set(root, document.activeElement);
      else if (!isOpen(root) && openers.has(root)) {
        const opener = openers.get(root); openers.delete(root);
        if (opener && opener.isConnected && opener.getClientRects().length) opener.focus({ preventScroll: true });
      }
    }
    document.body.style.overflow = top ? 'hidden' : '';
    if (top && !top.contains(document.activeElement)) {
      const first = focusables(top)[0];
      if (first) first.focus({ preventScroll: true });
    }
  }
  const observer = new MutationObserver(sync);
  for (const root of roots) observer.observe(root, { attributes: true, attributeFilter: ['hidden', 'class'] });
  document.addEventListener('keydown', event => {
    if (!top) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation(); closeHandlers[top.id](); sync();
    } else if (event.key === 'Tab') {
      const items = focusables(top);
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !top.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !top.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    }
  }, true);
  sync();
  return {
    sync,
    register(root, close) {
      closeHandlers[root.id] = close;
      roots.push(root);
      observer.observe(root, { attributes: true, attributeFilter: ['hidden', 'class'] });
      sync();
    },
    unregister(root) {
      root.hidden = true;
      sync();
      const index = roots.indexOf(root);
      if (index >= 0) roots.splice(index, 1);
      delete closeHandlers[root.id];
      observer.disconnect();
      for (const element of roots) observer.observe(element, { attributes: true, attributeFilter: ['hidden', 'class'] });
    },
  };
}
