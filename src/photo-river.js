export function riverEntries(groups) {
  const albums = [...groups].sort((left, right) => right.d.localeCompare(left.d));
  const entries = [], seen = new Set();
  const length = Math.max(0, ...albums.map(album => album.gs.length));
  for (let index = 0; index < length; index++) for (const album of albums) {
    const photo = album.gs[index];
    if (!photo?.tn?.s || seen.has(photo.k || photo.u)) continue;
    seen.add(photo.k || photo.u);
    entries.push({ key: photo.k || photo.u, day: album.d, index, title: photo.t || album.title, photo });
  }
  return entries;
}

export function riverBudget(width, limited = false) {
  const columns = width < 360 ? 2 : width < 1000 ? 3 : 4;
  return { columns, slots: limited ? 3 : 5 };
}

export function createPhotoRiver({ host, Motion, url, openPhoto, storageGet, storageSet, getRatio, onRatio }) {
  const root = document.documentElement, hero = host.closest('.exhibition-hero');
  const toggle = document.getElementById('riverMotion');
  const ratios = [.80, 1.32, .88, 1.28, .94, 1.18];
  let entries = [], columns = [], active = new Set(), cursor = 0, generation = 0;
  let frame = 0, painted = 0, paintTick = -1, inView = true, pendingLayout = false, pendingRescale = false;
  let hasStarted = false, resumeRamp = false;
  let keyboardNavigation = false;
  let layoutKey = '';
  let enabled = storageGet('pt_river_motion', 'on') !== 'off';

  function limited() {
    return matchMedia('(prefers-reduced-motion:reduce)').matches ||
      navigator.deviceMemory && navigator.deviceMemory < 4 || navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4 || navigator.connection?.saveData;
  }
  function next() {
    for (let attempt = 0; attempt < entries.length; attempt++) {
      const entry = entries[cursor++ % entries.length];
      if (!active.has(entry.key)) return entry;
    }
    return null;
  }
  function clampRatio(nat) {
    return Math.max(.72, Math.min(1.50, nat));
  }
  function assign(slot, entry) {
    if (slot.entry) active.delete(slot.entry.key);
    slot.entry = entry; active.add(entry.key);
    const src = url(entry.photo, 480);
    const token = ++slot.token;
    slot.button.dataset.day = entry.day; slot.button.dataset.photoIndex = String(entry.index);
    slot.button.dataset.key = entry.key;
    slot.button.setAttribute('aria-label', '查看 ' + entry.title);
    slot.button.classList.remove('image-error');
    slot.image.alt = entry.title;
    if (slot.caption) slot.caption.textContent = `${entry.day.slice(0, 7).replace('-', '.')} · ${entry.title}`;
    const known = getRatio ? getRatio(entry.photo, src) : 0;
    slot.ratio = known > 0 ? clampRatio(known) : ratios[generation++ % ratios.length];
    slot.height = slot.width / slot.ratio;
    slot.button.style.height = slot.height.toFixed(1) + 'px';
    if (slot.image.getAttribute('src') !== src) {
      slot.button.classList.remove('is-loaded');
      slot.image.src = src;
    }
    const markLoaded = () => {
      if (slot.token !== token || !slot.image.naturalWidth || !slot.image.naturalHeight) return;
      onRatio?.(entry.photo, src, slot.image.naturalWidth / slot.image.naturalHeight);
      slot.button.classList.add('is-loaded');
    };
    if (slot.image.complete && slot.image.naturalWidth) {
      markLoaded();
    } else {
      slot.image.addEventListener('load', () => {
        if (slot.token !== token) return;
        if (typeof slot.image.decode === 'function') slot.image.decode().then(markLoaded, markLoaded);
        else markLoaded();
      }, { once: true });
    }
  }
  function layout() {
    const focusedKey = document.activeElement?.closest('.river-tile')?.dataset.key;
    const budget = riverBudget(innerWidth, limited());
    layoutKey = `${budget.columns}:${budget.slots}`;
    const count = Math.min(budget.columns, entries.length);
    host.replaceChildren(); columns = []; active.clear(); cursor = 0; generation = 0;
    hasStarted = false; resumeRamp = false;
    host.style.setProperty('--river-columns', String(Math.max(1, count)));
    if (!count) { host.dataset.empty = 'true'; sync(); return; }
    host.dataset.empty = 'false';
    const gap = innerWidth < 900 ? 10 : 16;
    const columnWidth = (host.clientWidth - gap * (count - 1)) / count;
    const maximum = Math.min(entries.length, count * budget.slots);
    for (let columnIndex = 0; columnIndex < count; columnIndex++) {
      const element = document.createElement('div'); element.className = 'river-column';
      const column = { element, slots: [], offset: columnIndex === 0 ? 12 : -columnWidth * (columnIndex % 2 ? .68 : .24), speed: (innerWidth < 760 ? 23 : 34) + columnIndex * 3, gap, hovering: false, focused: false, paused: false, rampPending: false, rampStart: 0 };
      element.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') column.hovering = true; });
      element.addEventListener('pointerleave', () => { column.hovering = false; });
      host.appendChild(element); columns.push(column);
      for (let row = columnIndex; row < maximum; row += count) {
        const entry = next();
        const button = document.createElement('button'); button.type = 'button'; button.className = 'river-tile';
        const image = document.createElement('img'); image.decoding = 'async'; image.width = 480; image.height = 480;
        image.addEventListener('error', () => button.classList.add('image-error'));
        const caption = document.createElement('span'); caption.className = 'river-tile-caption'; caption.setAttribute('aria-hidden', 'true');
        button.append(image, caption); element.appendChild(button);
        const slot = { button, image, caption, width: columnWidth, height: 0, ratio: 1, entry: null, token: 0 };
        assign(slot, entry); column.slots.push(slot);
      }
      element.style.transform = `translate3d(0,${column.offset.toFixed(2)}px,0)`;
    }
    if (focusedKey) {
      let target = host.querySelector(`[data-key="${CSS.escape(focusedKey)}"]`);
      if (!target) {
        const entry = entries.find(item => item.key === focusedKey);
        if (entry && columns[0]?.slots[0]) { assign(columns[0].slots[0], entry); columns[0].offset = 0; target = columns[0].slots[0].button; }
      }
      target?.focus({ preventScroll: true });
    }
    for (const column of columns) column.focused = keyboardNavigation && column.element.contains(document.activeElement);
    sync();
  }
  function rescale() {
    if (!columns.length) return;
    const gap = innerWidth < 900 ? 10 : 16;
    const count = columns.length;
    const columnWidth = (host.clientWidth - gap * (count - 1)) / count;
    if (!(columnWidth > 0)) return;
    const baseSpeed = innerWidth < 760 ? 23 : 34;
    columns.forEach((column, columnIndex) => {
      column.gap = gap;
      column.speed = baseSpeed + columnIndex * 3;
      for (const slot of column.slots) {
        slot.width = columnWidth;
        slot.height = columnWidth / slot.ratio;
        slot.button.style.height = slot.height.toFixed(1) + 'px';
      }
    });
    sync();
  }
  function running() {
    return enabled && Motion.tier === 'full' && inView && !document.hidden && !document.getElementById('archive').hidden &&
      root.dataset.dialogOpen !== 'true' && entries.length > active.size;
  }
  function sync() {
    if (!running()) {
      if (hasStarted) resumeRamp = true;
      if (frame) cancelAnimationFrame(frame);
      frame = painted = 0;
      paintTick = -1;
      host.dataset.running = 'false';
    } else if (!frame) {
      if (resumeRamp) {
        for (const column of columns) column.rampPending = true;
        resumeRamp = false;
      }
      host.dataset.running = 'true'; frame = requestAnimationFrame(draw);
    }
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.disabled = Motion.tier !== 'full' || entries.length <= active.size;
    toggle.title = enabled ? '暂停照片流' : '播放照片流';
    toggle.innerHTML = enabled ? '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>' : '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
  }
  function draw(time) {
    frame = 0;
    if (!running()) { sync(); return; }
    // Stable 60Hz time slots avoid the old 30fps judder without painting at 144/240Hz.
    const tick = Math.floor(time * 60 / 1000 + .001);
    if (tick === paintTick) { frame = requestAnimationFrame(draw); return; }
    paintTick = tick;
    hasStarted = true;
    const delta = Math.min((time - (painted || time)) / 1000, .08);
    painted = time;
    for (const column of columns) {
      if (column.hovering || column.focused) {
        column.paused = true;
        column.rampStart = 0;
        continue;
      }
      if (column.paused || column.rampPending) {
        column.paused = false;
        column.rampPending = false;
        column.rampStart = time;
      }
      let factor = 1;
      if (column.rampStart) {
        const progress = (time - column.rampStart) / 240;
        if (progress >= 1) column.rampStart = 0;
        else factor = progress * (2 - progress);
      }
      column.offset -= column.speed * factor * delta;
      const first = column.slots[0];
      if (first && column.offset + first.height + column.gap <= 0) {
        const entry = next();
        if (entry) {
          column.offset += first.height + column.gap;
          column.slots.shift(); assign(first, entry); column.slots.push(first);
          column.element.appendChild(first.button);
        } else column.offset = -column.element.scrollHeight * .15;
      }
      column.element.style.transform = `translate3d(0,${column.offset.toFixed(2)}px,0)`;
    }
    frame = requestAnimationFrame(draw);
  }
  host.addEventListener('click', event => {
    const tile = event.target.closest('.river-tile');
    if (!tile) return;
    tile.focus({ preventScroll: true }); openPhoto(tile.dataset.day, Number(tile.dataset.photoIndex));
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    keyboardNavigation = true;
    for (const column of columns) column.focused = column.element.contains(document.activeElement);
  });
  document.addEventListener('pointerdown', () => {
    keyboardNavigation = false;
    for (const column of columns) column.focused = false;
  }, { passive: true });
  host.addEventListener('focusin', event => {
    for (const column of columns) column.focused = keyboardNavigation && column.element.contains(event.target);
  });
  host.addEventListener('focusout', event => {
    for (const column of columns) column.focused = keyboardNavigation && column.element.contains(event.relatedTarget);
  });
  toggle.addEventListener('click', () => { enabled = !enabled; storageSet('pt_river_motion', enabled ? 'on' : 'off'); sync(); });
  function refreshLayout() {
    const budget = riverBudget(innerWidth, limited());
    const nextKey = `${budget.columns}:${budget.slots}`;
    if (layoutKey === nextKey && columns.length) {
      if (root.dataset.dialogOpen === 'true') pendingRescale = true;
      else rescale();
      return;
    }
    if (root.dataset.dialogOpen === 'true') pendingLayout = true;
    else layout();
  }
  document.addEventListener('motion:change', refreshLayout);
  document.addEventListener('visibilitychange', sync);
  new MutationObserver(() => {
    if (root.dataset.dialogOpen === 'true') for (const column of columns) column.hovering = false;
    if (root.dataset.dialogOpen !== 'true' && pendingLayout) { pendingLayout = pendingRescale = false; layout(); }
    else if (root.dataset.dialogOpen !== 'true' && pendingRescale) { pendingRescale = false; rescale(); }
    else sync();
  }).observe(root, { attributes: true, attributeFilter: ['data-dialog-open'] });
  new MutationObserver(sync).observe(document.getElementById('archive'), { attributes: true, attributeFilter: ['hidden'] });
  if ('IntersectionObserver' in window) new IntersectionObserver(records => { inView = records[0].isIntersecting; sync(); }, { threshold: 0 }).observe(hero);
  window.addEventListener('resize', refreshLayout, { passive: true });
  document.getElementById('heroExplore').addEventListener('click', () => document.getElementById('gallery').scrollIntoView({ behavior: Motion.tier === 'full' ? 'smooth' : 'auto' }));
  return {
    update(groups) {
      const incoming = riverEntries(groups);
      const signature = incoming.map(entry => [entry.key,entry.title,entry.photo.tn.s,entry.day,entry.index].join('~')).join('|');
      if (signature === entries.map(entry => [entry.key,entry.title,entry.photo.tn.s,entry.day,entry.index].join('~')).join('|') && columns.length) return;
      entries = incoming; layout();
    },
  };
}
