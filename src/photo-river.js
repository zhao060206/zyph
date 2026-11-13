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

export function createPhotoRiver({ host, Motion, url, openPhoto, storageGet, storageSet }) {
  const root = document.documentElement, hero = host.closest('.exhibition-hero');
  const toggle = document.getElementById('riverMotion');
  const ratios = [.76, 1.22, .92, 1.42, .86, 1.08];
  let entries = [], columns = [], active = new Set(), cursor = 0, generation = 0;
  let frame = 0, painted = 0, paintTick = -1, inView = true, pendingLayout = false;
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
  function assign(slot, entry) {
    if (slot.entry) active.delete(slot.entry.key);
    slot.entry = entry; active.add(entry.key);
    slot.button.dataset.day = entry.day; slot.button.dataset.photoIndex = String(entry.index);
    slot.button.dataset.key = entry.key;
    slot.button.setAttribute('aria-label', '查看 ' + entry.title);
    slot.button.classList.remove('image-error');
    slot.image.alt = entry.title;
    slot.image.src = url(entry.photo, 480);
    slot.height = slot.width / ratios[generation++ % ratios.length];
    slot.button.style.height = slot.height.toFixed(1) + 'px';
  }
  function layout() {
    const focusedKey = document.activeElement?.closest('.river-tile')?.dataset.key;
    const budget = riverBudget(innerWidth, limited());
    layoutKey = `${innerWidth}:${budget.columns}:${budget.slots}`;
    const count = Math.min(budget.columns, entries.length);
    host.replaceChildren(); columns = []; active.clear(); cursor = 0; generation = 0;
    host.style.setProperty('--river-columns', String(Math.max(1, count)));
    if (!count) { host.dataset.empty = 'true'; sync(); return; }
    host.dataset.empty = 'false';
    const gap = innerWidth < 900 ? 10 : 16;
    const columnWidth = (host.clientWidth - gap * (count - 1)) / count;
    const maximum = Math.min(entries.length, count * budget.slots);
    for (let columnIndex = 0; columnIndex < count; columnIndex++) {
      const element = document.createElement('div'); element.className = 'river-column';
      const column = { element, slots: [], offset: columnIndex === 0 ? 12 : -columnWidth * (columnIndex % 2 ? .68 : .24), speed: (innerWidth < 760 ? 23 : 34) + columnIndex * 3, gap, hovering: false, focused: false };
      element.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') column.hovering = true; });
      element.addEventListener('pointerleave', () => { column.hovering = false; });
      host.appendChild(element); columns.push(column);
      for (let row = columnIndex; row < maximum; row += count) {
        const entry = next();
        const button = document.createElement('button'); button.type = 'button'; button.className = 'river-tile';
        const image = document.createElement('img'); image.decoding = 'async'; image.width = 480; image.height = 480;
        image.addEventListener('error', () => button.classList.add('image-error'));
        button.appendChild(image); element.appendChild(button);
        const slot = { button, image, width: columnWidth, height: 0, entry: null };
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
  function running() {
    return enabled && Motion.tier === 'full' && inView && !document.hidden && !document.getElementById('archive').hidden &&
      root.dataset.dialogOpen !== 'true' && entries.length > active.size;
  }
  function sync() {
    if (!running()) {
      if (frame) cancelAnimationFrame(frame);
      frame = painted = 0;
      paintTick = -1;
      host.dataset.running = 'false';
    } else if (!frame) {
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
    const delta = Math.min((time - (painted || time)) / 1000, .08);
    painted = time;
    for (const column of columns) {
      if (column.hovering || column.focused) continue;
      column.offset -= column.speed * delta;
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
    if (layoutKey === `${innerWidth}:${budget.columns}:${budget.slots}`) { sync(); return; }
    if (root.dataset.dialogOpen === 'true') pendingLayout = true;
    else layout();
  }
  document.addEventListener('motion:change', refreshLayout);
  document.addEventListener('visibilitychange', sync);
  new MutationObserver(() => {
    if (root.dataset.dialogOpen === 'true') for (const column of columns) column.hovering = false;
    if (root.dataset.dialogOpen !== 'true' && pendingLayout) { pendingLayout = false; layout(); }
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
      document.getElementById('heroCounts').textContent = `${entries.length} 张作品，照片流可暂停，点击照片查看`;
    },
  };
}
