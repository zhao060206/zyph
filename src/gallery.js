import { TONES, resolveTone, toneGroups } from './tones.mjs';
import { createPhotoRiver } from './photo-river.js';

const RATIO_STORAGE_KEY = 'pt_ratio_cache_v1';

export function createArchive({ $, Store, YEARS, totalPhotos, esc, pURL, pView, Motion, storageGet, storageSet, ratioCache: sharedRatioCache, onRatio, openGroup, openProof, closeGroup, openAdmin }) {
  const ratioCache = sharedRatioCache instanceof Map ? sharedRatioCache : new Map();
  let ratioDirty = false;
  let ratioTimer = 0;
  let repartitionTimer = 0;

  try {
    const saved = JSON.parse(sessionStorage.getItem(RATIO_STORAGE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      for (const [k, v] of Object.entries(saved)) {
        if (typeof v === 'number' && v > .2 && v < 5 && !ratioCache.has(k)) ratioCache.set(k, v);
      }
    }
  } catch {}

  function flushRatios() {
    ratioTimer = 0;
    if (!ratioDirty) return;
    ratioDirty = false;
    try {
      const entries = [...ratioCache.entries()].slice(-180);
      sessionStorage.setItem(RATIO_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch {}
  }

  function photoKey(photo, src = '') {
    return (photo && (photo.k || photo.u)) || src || '';
  }

  function getRatio(photo, src = '') {
    const id = photo?.k || photo?.u;
    if (id && ratioCache.has(id)) return ratioCache.get(id);
    if (src && ratioCache.has(src)) return ratioCache.get(src);
    const fixed = Number(photo?.r) || (photo?.w && photo?.h ? photo.w / photo.h : 0);
    return fixed > .2 && fixed < 5 ? fixed : 0;
  }

  function setRatio(photo, src, nat) {
    if (!(nat > .2 && nat < 5)) return;
    const id = photo?.k || photo?.u;
    if (id) ratioCache.set(id, nat);
    if (src) ratioCache.set(src, nat);
    onRatio?.(photo, src, nat);
    ratioDirty = true;
    if (!ratioTimer) ratioTimer = setTimeout(flushRatios, 400);
  }

  function clampRatio(nat, minRatio, maxRatio) {
    return Math.max(minRatio, Math.min(maxRatio, nat));
  }

  function applyNaturalAspect(container, selector, minRatio, maxRatio, onResolved) {
    container.querySelectorAll(selector).forEach(box => {
      box.dataset.aspectBound = 'true';
      const img = box.querySelector('img');
      if (!img) return;
      const key = img.getAttribute('src') || '';
      const photoId = box.dataset.ratioKey || '';
      const cached = (photoId && ratioCache.get(photoId)) || ratioCache.get(key) || 0;
      if (cached > 0) {
        box.style.aspectRatio = clampRatio(cached, minRatio, maxRatio).toFixed(3);
        onResolved?.(box, cached);
        return;
      }
      const syncRatio = () => {
        if (!img.naturalWidth || !img.naturalHeight) return;
        const nat = img.naturalWidth / img.naturalHeight;
        setRatio(photoId ? { k: photoId } : null, key, nat);
        box.style.aspectRatio = clampRatio(nat, minRatio, maxRatio).toFixed(3);
        onResolved?.(box, nat);
      };
      if (img.complete && img.naturalWidth) syncRatio();
      else img.addEventListener('load', syncRatio, { once: true });
    });
  }

  function estRatio(g) {
    const first = g?.gs?.[0];
    if (!first) return 1.333;
    const nat = getRatio(first, pURL(first, 480));
    return nat ? clampRatio(nat, .66, 1.68) : 1.333;
  }

  function summarizeOptics(g) {
    const photos = Array.isArray(g?.gs) ? g.gs : [];
    const focals = [];
    const gears = new Map();
    for (const p of photos) {
      const raw = String(p?.exif || g?.exif || '');
      if (!raw) continue;
      const lines = raw.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').split('\n').map(s => s.trim()).filter(Boolean);
      if (lines.length > 1) {
        const gear = lines[0].split('·')[0].trim();
        if (gear) gears.set(gear, (gears.get(gear) || 0) + 1);
      }
      const paramText = (lines.length > 1 ? lines.slice(1) : lines).join(' ');
      const matches = paramText.match(/\b(\d{1,3}(?:\.\d+)?)mm\b/gi);
      if (matches) {
        for (const m of matches) {
          const n = parseFloat(m);
          if (n >= 8 && n <= 1200) focals.push(n);
        }
      }
    }
    const parts = [`${photos.length} FRAMES`];
    if (focals.length) {
      const min = Math.round(Math.min(...focals));
      const max = Math.round(Math.max(...focals));
      parts.push(min === max ? `${min}MM` : `${min}–${max}MM`);
    }
    let topGear = '';
    let maxCount = 0;
    for (const [gear, count] of gears) {
      if (count > maxCount) { topGear = gear; maxCount = count; }
    }
    if (topGear) parts.push(topGear);
    return parts.join(' · ');
  }

  function partitionRows(photoGroups) {
    const rows = [];
    if (!photoGroups.length) return rows;
    rows.push({ type: 'lead', group: photoGroups[0], index: 0 });
    let i = 1;
    while (i < photoGroups.length) {
      const remaining = photoGroups.length - i;
      if (remaining === 1) {
        rows.push({ type: 'lead', group: photoGroups[i], index: i });
        break;
      }
      const r0 = estRatio(photoGroups[i]);
      const r1 = estRatio(photoGroups[i + 1]);
      const sum2 = r0 + r1;
      if (remaining >= 3) {
        const r2 = estRatio(photoGroups[i + 2]);
        if (sum2 < 2.35 && sum2 + r2 <= 3.85) {
          rows.push({
            type: 'pair',
            items: [
              { group: photoGroups[i], index: i },
              { group: photoGroups[i + 1], index: i + 1 },
              { group: photoGroups[i + 2], index: i + 2 },
            ],
          });
          i += 3;
          continue;
        }
      }
      rows.push({
        type: 'pair',
        items: [
          { group: photoGroups[i], index: i },
          { group: photoGroups[i + 1], index: i + 1 },
        ],
      });
      i += 2;
    }
    return rows;
  }

  return {
    openDays: new Set(),
    toneIndex: {},
    mode: 'archive',
    selectedTone: 'all',
    limit: 24,
    _toneState: null,
    _lastAppendedTonePhoto: null,
    getPhotoRatio: getRatio,
    init() {
      const filter = $('#yearFilter');
      const selected = filter.value;
      filter.innerHTML = '<option value="">全部年份</option>' + YEARS().map(y => `<option value="${y}">${y} 年</option>`).join('');
      if (YEARS().includes(selected)) filter.value = selected;
      const count = totalPhotos();
      const years = YEARS();
      const span = years.length > 1 ? `${years[years.length - 1]}–${years[0]}` : years[0] || '';
      $('#barStat').textContent = `${count} 张照片 / ${Store.groups.length} 组故事`;
      const heroIndex = $('#heroIndex');
      if (heroIndex) heroIndex.textContent = count ? `${span ? span + ' · ' : ''}${count}` : '';
      $('#heroCounts').innerHTML = `<span><strong>${count}</strong>照片</span><span><strong>${Store.groups.length}</strong>组故事</span><span><strong>${years.length}</strong>年时光</span>`;
      $('#archiveSource').hidden = Store.remote;
      $('#archiveSource').textContent = Store.remote ? '' : '演示作品 · 云端暂时不可用';
      if (!this.river) this.river = createPhotoRiver({ host: $('#photoRiver'), Motion, url: pURL, openPhoto: openProof, storageGet, storageSet, getRatio, onRatio: setRatio });
      this.river.update(Store.groups);
      const validDays = new Set(Store.groups.filter(g => g.gs.length).map(g => g.d));
      for (const day of [...this.openDays]) {
        if (!validDays.has(day)) this.openDays.delete(day);
      }
      this.render();
      if (this.bound) return;
      this.bound = true;
      fetch('/assets/tone-index.json').then(response => {
        if (!response.ok) throw new Error('色调索引暂时不可用');
        return response.json();
      }).then(data => {
        if (data.version !== 1 || !data.photos || typeof data.photos !== 'object') throw new Error('色调索引格式无效');
        this.toneIndex = data.photos;
        if (this.mode === 'tone') this.render();
      }).catch(() => { if (this.mode === 'tone') this.render(); });
      $('#galleryMode').addEventListener('click', event => {
        const button = event.target.closest('[data-gallery-mode]');
        if (!button || this.mode === button.dataset.galleryMode) return;
        this.mode = button.dataset.galleryMode;
        this.render();
      });
      $('#toneFilters').addEventListener('click', event => {
        const button = event.target.closest('[data-tone]');
        if (!button) return;
        this.selectedTone = button.dataset.tone;
        this.render();
        $('#toneFilters').querySelector(`[data-tone="${this.selectedTone}"]`).focus({ preventScroll: true });
      });
      $('#toneFilters').addEventListener('scroll', () => this.syncToneFiltersScroll(), { passive: true });
      $('#toneMore').addEventListener('click', () => {
        this.limit += 24;
        this.render(false);
        this._lastAppendedTonePhoto?.focus({ preventScroll: true });
      });
      let searchTimer;
      $('#archiveSearch').addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => this.render(), 120);
      });
      filter.addEventListener('change', () => this.render());
      $('#years').addEventListener('click', event => {
        const resetBtn = event.target.closest('.reset-filters-btn');
        if (resetBtn) {
          $('#archiveSearch').value = '';
          $('#yearFilter').value = '';
          this.selectedTone = 'all';
          this.render(true);
          $('#archiveSearch').focus({ preventScroll: true });
          return;
        }
        const sheetBtn = event.target.closest('[data-toggle-sheet]');
        if (sheetBtn) {
          this.toggleSheet(sheetBtn.dataset.toggleSheet, sheetBtn.closest('.album-card'));
          return;
        }
        const proof = event.target.closest('.proof[data-proof-idx]');
        if (proof && openProof) {
          proof.focus({ preventScroll: true });
          openProof(proof.dataset.day, Number(proof.dataset.proofIdx));
          return;
        }
        const target = event.target.closest('[data-day]');
        if (target) { target.focus({ preventScroll: true }); openGroup(target.dataset.day); }
      });
      $('#blankList').addEventListener('click', event => {
        const target = event.target.closest('[data-day]');
        if (target) { target.focus({ preventScroll: true }); openGroup(target.dataset.day); }
      });
      $('#toggleAllSheets').addEventListener('click', () => {
        const withPhotos = (this.currentGroups || Store.groups).filter(g => g.gs.length);
        const anyOpen = withPhotos.some(g => this.openDays.has(g.d));
        const nextOpen = !anyOpen;
        $('#years').querySelectorAll('.album-card').forEach(card => {
          const day = card.querySelector('[data-toggle-sheet]')?.dataset.toggleSheet;
          if (!day) return;
          if (this.openDays.has(day) !== nextOpen) this.toggleSheet(day, card, true);
        });
        withPhotos.forEach(g => { if (nextOpen) this.openDays.add(g.d); else this.openDays.delete(g.d); });
        this.syncToolbar(this.currentGroups || Store.groups);
      });
      let resizeTimer;
      window.addEventListener('resize', () => {
        if (this.mode !== 'tone') return;
        this.syncToneFiltersScroll();
        if (!this._toneState) return;
        const colCount = innerWidth >= 900 ? 3 : 2;
        if (colCount === this._toneState.colCount) return;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          if (this.mode === 'tone') this.render(false);
        }, 80);
      }, { passive: true });
      let taps = 0, timer;
      $('#brandHome').addEventListener('click', () => {
        clearTimeout(timer); taps++;
        timer = setTimeout(() => { taps = 0; }, 800);
        if (taps >= 5) { taps = 0; openAdmin(); return; }
        closeGroup(); window.scrollTo(0, 0);
      });
      for (const [id, hash] of [['navGallery', '#gallery'], ['navActivities', '#activities']]) {
        $(id.startsWith('#') ? id : '#' + id).addEventListener('click', () => {
          closeGroup();
          requestAnimationFrame(() => $(hash).scrollIntoView());
        });
      }
    },
    sheetHTML(g, eager = false) {
      const visible = g.gs.slice(0, 12);
      const more = g.gs.length > 12 ? `<button class="proof-more" type="button" data-day="${g.d}">查看全部 ${g.gs.length} 张 →</button>` : '';
      return `<div class="album-inline"><div class="contact-sheet">${visible.map((p, j) => `<button class="proof" type="button" data-day="${g.d}" data-proof-idx="${j}" aria-label="查看 ${esc(p.t)}"><img src="${esc(pURL(p, 300))}" alt="${esc(p.t)}" loading="${eager && j < 12 ? 'eager' : 'lazy'}" decoding="async" width="300" height="300"></button>`).join('')}${more}</div></div>`;
    },
    syncToneFiltersScroll() {
      const el = $('#toneFilters');
      if (!el || el.hidden) return;
      el.classList.toggle('is-scroll-end', el.scrollWidth <= el.clientWidth + 2 || el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
    },
    syncToolbar(groups = Store.groups) {
      const withPhotos = groups.filter(g => g.gs.length);
      const openCount = withPhotos.filter(g => this.openDays.has(g.d)).length;
      const toggleBtn = $('#toggleAllSheets');
      if (toggleBtn) {
        toggleBtn.hidden = withPhotos.length === 0;
        toggleBtn.setAttribute('aria-pressed', String(openCount > 0));
        toggleBtn.textContent = openCount > 0 ? '收起全部印样' : '展开全部印样';
      }
    },
    toggleSheet(day, card, skipSync = false) {
      const g = Store.groups.find(item => item.d === day);
      if (!g || !g.gs.length) return;
      const isOpen = !this.openDays.has(day);
      if (isOpen) this.openDays.add(day);
      else this.openDays.delete(day);
      if (card) {
        card.classList.toggle('is-sheet-open', isOpen);
        const btn = card.querySelector('[data-toggle-sheet]');
        if (btn) {
          btn.classList.toggle('is-open', isOpen);
          btn.setAttribute('aria-expanded', String(isOpen));
          btn.setAttribute('aria-label', `${isOpen ? '收起' : '展开'} ${g.title} 印样`);
          const label = btn.querySelector('span');
          if (label) label.textContent = isOpen ? '收起印样' : '印样';
        }
        const existing = card.querySelector('.album-inline');
        if (isOpen && !existing) card.insertAdjacentHTML('beforeend', this.sheetHTML(g, true));
        else if (!isOpen && existing) existing.remove();
      }
      if (!skipSync) this.syncToolbar(this.currentGroups || Store.groups);
    },
    cardHTML(g, { isLead = false, indexLabel = '', eager = false, skipReveal = false, narrowCol = false, initialRatio = 0, portraitLead = false } = {}) {
      const isOpen = this.openDays.has(g.d);
      const coverURL = isLead && innerWidth >= 900 && g.gs[0].tn?.v ? pView(g.gs[0]) : pURL(g.gs[0], 480);
      const ratioKey = photoKey(g.gs[0], coverURL);
      const locText = g.loc && g.loc !== '—' ? esc(g.loc) : '';
      const excerpt = isLead && g.c ? esc(g.c.replace(/\s+/g, ' ').trim()) : '';
      const aspectStyle = initialRatio > 0 ? ` style="aspect-ratio:${initialRatio.toFixed(3)}"` : '';
      const revealAttr = isLead || skipReveal ? '' : ' data-reveal';
      const leadPreview = isLead && !excerpt && g.gs.length >= 3
        ? `<div class="album-lead-preview">
            <div class="album-lead-subgrid">${g.gs.slice(1, 5).map((p, k) => `<button class="album-subplate proof" type="button" data-day="${g.d}" data-proof-idx="${k + 1}" aria-label="查看 ${esc(p.t)}"><img src="${esc(pURL(p, 300))}" alt="${esc(p.t)}" loading="${eager ? 'eager' : 'lazy'}" decoding="async" width="300" height="225"><span class="album-subplate-num" aria-hidden="true">${String(k + 2).padStart(2, '0')}</span></button>`).join('')}</div>
            <div class="album-lead-optics">${esc(summarizeOptics(g))}</div>
          </div>`
        : '';
      return `
        <article class="album-card${isLead ? ' is-lead' : ''}${portraitLead ? ' is-portrait-lead' : ''}${narrowCol ? ' is-narrow-col' : ''}${isOpen ? ' is-sheet-open' : ''}"${revealAttr}>
          <button class="album-cover" type="button" data-day="${g.d}" data-ratio-key="${esc(ratioKey)}" aria-label="查看 ${esc(g.title)}"${aspectStyle}>
            <img src="${esc(coverURL)}" alt="${esc(g.gs[0].t)}" loading="${eager ? 'eager' : 'lazy'}" decoding="async" width="480" height="360">
          </button>
          <div class="album-lead-body">
            ${isLead && indexLabel ? `<div class="album-index-row"><span class="album-index">${indexLabel}</span></div>` : ''}
            ${leadPreview}
            <div class="album-title-row">
              <h3><button class="album-title" type="button" data-day="${g.d}"><span>${esc(g.title)}</span><span class="album-open-icon" aria-hidden="true">↗</span></button></h3>
              <button class="album-sheet-btn${isOpen ? ' is-open' : ''}" type="button" data-toggle-sheet="${g.d}" aria-expanded="${isOpen}" aria-label="${isOpen ? '收起' : '展开'} ${esc(g.title)} 印样"><span>${isOpen ? '收起印样' : '印样'}</span></button>
            </div>
            <div class="album-meta"><time class="meta-num" datetime="${g.d}">${g.d.replace(/-/g, '.')}</time>${locText ? `<span class="album-meta-sep" aria-hidden="true">·</span><span class="album-loc-meta">${locText}</span>` : ''}<span class="album-meta-sep" aria-hidden="true">·</span><span>${g.gs.length} 张</span></div>
            ${excerpt ? `<p class="album-excerpt">${excerpt}</p>` : ''}
          </div>
          ${isOpen ? this.sheetHTML(g) : ''}
        </article>`;
    },
    renderTones(groups, query, reset = true) {
      $('#blankChronicle').hidden = true;
      $('#years').hidden = false;
      const photos = groups.flatMap(group => group.gs.map((photo, index) => ({ group, photo, index, tone: resolveTone(photo, this.toneIndex) })))
        .filter(item => !query || `${item.photo.t} ${item.photo.d || ''} ${item.group.title} ${item.group.loc} ${item.group.d}`.toLowerCase().includes(query));
      const counts = {};
      photos.forEach(item => { for (const group of toneGroups(item.tone)) counts[group] = (counts[group] || 0) + 1; });
      const filters = [{ id: 'all', label: '全部', color: 'transparent' }, ...TONES, ...(counts.pending ? [{ id: 'pending', label: '待归类', color: '#b6b1a9' }] : [])];
      if (!filters.some(filter => filter.id === this.selectedTone)) this.selectedTone = 'all';
      $('#toneFilters').innerHTML = filters.map(filter => `<button type="button" class="tone-filter" data-tone="${filter.id}" title="${filter.label}" aria-pressed="${this.selectedTone === filter.id}"${filter.id !== 'all' && !counts[filter.id] ? ' disabled' : ''}><i style="--swatch:${filter.color}" aria-hidden="true"></i><span class="tone-filter-label">${filter.label}</span><small>${filter.id === 'all' ? photos.length : counts[filter.id] || 0}</small></button>`).join('');
      this.syncToneFiltersScroll();
      const matching = photos.filter(item => this.selectedTone === 'all' || toneGroups(item.tone).includes(this.selectedTone));
      const selectedLabel = filters.find(filter => filter.id === this.selectedTone).label;
      $('#resultCount').textContent = `${this.selectedTone === 'all' ? '' : selectedLabel + ' · '}${matching.length} 张作品`;
      $('#toneMore').hidden = matching.length <= this.limit;
      $('#toneMore').textContent = `更多 · ${Math.max(0, matching.length - this.limit)}`;
      this._lastAppendedTonePhoto = null;
      const container = $('#years');
      if (!matching.length) {
        this._toneState = null;
        const canReset = Boolean(query || $('#yearFilter').value || this.selectedTone !== 'all');
        container.innerHTML = `<div class="empty"><p>这个色系暂时没有匹配的作品。</p>${canReset ? '<button type="button" class="reset-filters-btn">清除全部筛选</button>' : ''}</div>`;
        return;
      }
      const colCount = innerWidth >= 900 ? 3 : 2;
      const existingCols = container.querySelectorAll('.tone-col');
      const canAppend = !reset && this._toneState && this._toneState.colCount === colCount &&
        existingCols.length === colCount && this._toneState.rendered <= matching.length;
      if (!canAppend) {
        this._toneState = { colCount, rendered: 0, heights: new Array(colCount).fill(0) };
        container.innerHTML = new Array(colCount).fill('<div class="tone-col"></div>').join('');
      }
      const cols = [...container.querySelectorAll('.tone-col')];
      const start = this._toneState.rendered;
      const end = Math.min(matching.length, this.limit);
      const cardMarkup = (item, globalIdx) => {
        const src = pURL(item.photo, 480);
        const ratioKey = photoKey(item.photo, src);
        const palette = (item.tone?.palette || []).slice(0, 3);
        const revealAttr = globalIdx < 6 ? '' : ' data-reveal';
        return `
        <article class="tone-card"${revealAttr}>
          <button class="tone-photo proof" type="button" data-day="${item.group.d}" data-proof-idx="${item.index}" data-ratio-key="${esc(ratioKey)}" aria-label="查看 ${esc(item.photo.t)}"><img src="${esc(src)}" alt="${esc(item.photo.t)}" loading="${globalIdx < 12 ? 'eager' : 'lazy'}" decoding="async" width="480" height="360"></button>
          <div class="tone-caption"><h3>${esc(item.photo.t)}</h3><span class="tone-palette" aria-label="作品代表色">${palette.map(color => `<i style="--swatch:${color}" aria-hidden="true"></i>`).join('')}</span></div>
          <button class="tone-source" type="button" data-day="${item.group.d}" aria-label="返回相册 ${esc(item.group.title)}"><span>${esc(item.group.d)} · ${esc(item.group.loc)}</span><span aria-hidden="true">↗</span></button>
        </article>`;
      };
      for (let idx = start; idx < end; idx++) {
        const item = matching[idx];
        let targetCol = 0;
        if (idx > 0) {
          for (let c = 1; c < cols.length; c++) {
            if (this._toneState.heights[c] < this._toneState.heights[targetCol]) targetCol = c;
          }
        }
        cols[targetCol].insertAdjacentHTML('beforeend', cardMarkup(item, idx));
        if (!this._lastAppendedTonePhoto) {
          this._lastAppendedTonePhoto = cols[targetCol].lastElementChild?.querySelector('.tone-photo') || null;
        }
        const nat = getRatio(item.photo, pURL(item.photo, 480));
        const r = nat ? clampRatio(nat, .72, 1.6) : 1.15;
        this._toneState.heights[targetCol] += 1 / r + .32;
      }
      this._toneState.rendered = end;
      applyNaturalAspect(container, '.tone-photo.proof:not([data-aspect-bound])', .72, 1.6);
      Motion.observe(container);
    },
    render(reset = true) {
      if (reset) this.limit = 24;
      const toneMode = this.mode === 'tone';
      $('#years').classList.toggle('tone-grid', toneMode);
      $('#toneFilters').hidden = !toneMode;
      $('#toneMore').hidden = true;
      $('.archive-tools').hidden = toneMode;
      $('#galleryMode').querySelectorAll('[data-gallery-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.galleryMode === this.mode)));
      $('#galleryMode').dataset.mode = this.mode;
      const query = $('#archiveSearch').value.trim().toLowerCase();
      const year = $('#yearFilter').value;
      const groups = Store.groups.filter(g => (!year || g.d.startsWith(year)) &&
        (toneMode || !query || `${g.title} ${g.loc} ${g.d} ${g.c || ''}`.toLowerCase().includes(query)))
        .sort((a, b) => b.d.localeCompare(a.d));
      if (toneMode) { this.renderTones(groups, query, reset); return; }
      this._toneState = null;
      this.currentGroups = groups;
      const photoGroups = groups.filter(g => g.gs.length > 0);
      const blankGroups = groups.filter(g => !g.gs.length);
      $('#resultCount').textContent = `${groups.length} 组 · ${groups.reduce((sum, g) => sum + g.gs.length, 0)} 张作品`;
      this.syncToolbar(groups);
      if (photoGroups.length) {
        $('#years').hidden = false;
        clearTimeout(repartitionTimer);
        const rows = partitionRows(photoGroups);
        this._rowSignature = rows.map(row => row.type === 'lead' ? `L:${row.group.d}` : `P:${row.items.map(it => it.group.d).join(',')}`).join('|');
        $('#years').innerHTML = rows.map(row => {
          if (row.type === 'lead') {
            const g = row.group;
            const coverURL = innerWidth >= 900 && g.gs[0].tn?.v ? pView(g.gs[0]) : pURL(g.gs[0], 480);
            const nat = getRatio(g.gs[0], coverURL);
            const initialRatio = nat ? clampRatio(nat, .66, 1.68) : 0;
            const indexLabel = `INDEX ${String(row.index + 1).padStart(2, '0')}`;
            return `<div class="album-row is-lead-row">${this.cardHTML(g, {
              isLead: true, indexLabel, eager: row.index < 2, initialRatio, portraitLead: nat > 0 && nat < 1.0,
            })}</div>`;
          }
          const itemRatios = row.items.map(it => {
            const nat = getRatio(it.group.gs[0], pURL(it.group.gs[0], 480));
            return { nat, r: clampRatio(nat || 1.333, .66, 1.68) };
          });
          const sum = itemRatios.reduce((acc, cur) => acc + cur.r, 0);
          const colsTemplate = itemRatios.map(cur => `minmax(0, ${cur.r.toFixed(3)}fr)`).join(' ');
          return `<div class="album-row is-pair-row${row.items.length === 3 ? ' is-triplet-row' : ''}" style="--row-cols:${colsTemplate}">${row.items.map((it, idx) => this.cardHTML(it.group, {
            eager: it.index < 9,
            skipReveal: it.index < 3,
            narrowCol: itemRatios[idx].r / sum < .36 || row.items.length === 3,
            initialRatio: itemRatios[idx].nat ? itemRatios[idx].r : 0,
          })).join('')}</div>`;
        }).join('');
        $('#years').querySelectorAll('.album-row.is-lead-row').forEach(row => {
          const card = row.querySelector('.album-card');
          applyNaturalAspect(row, '.album-cover', .66, 1.68, (_box, nat) => {
            if (card) card.classList.toggle('is-portrait-lead', nat < 1.0);
          });
        });
        $('#years').querySelectorAll('.album-row.is-pair-row').forEach(row => {
          const cards = [...row.querySelectorAll('.album-card')];
          if (cards.length < 2) return;
          const ratios = cards.map(card => {
            const cov = card.querySelector('.album-cover');
            const src = cov?.querySelector('img')?.getAttribute('src') || '';
            return getRatio(cov?.dataset.ratioKey ? { k: cov.dataset.ratioKey } : null, src);
          });
          const updateRow = () => {
            const before = row.getBoundingClientRect();
            const h0 = before.height;
            const rList = ratios.map(nat => clampRatio(nat || 1.333, .66, 1.68));
            const sum = rList.reduce((acc, r) => acc + r, 0);
            row.style.setProperty('--row-cols', rList.map(r => `minmax(0, ${r.toFixed(3)}fr)`).join(' '));
            cards.forEach((card, idx) => card.classList.toggle('is-narrow-col', rList[idx] / sum < .36 || cards.length === 3));
            const h1 = row.getBoundingClientRect().height;
            if (before.bottom < 0 && window.scrollY > 0 && Math.abs(h1 - h0) > 1) window.scrollBy(0, h1 - h0);
          };
          cards.forEach((card, slotIdx) => {
            const hadInitial = ratios[slotIdx] > 0;
            applyNaturalAspect(card, '.album-cover', .66, 1.68, (_box, nat) => {
              ratios[slotIdx] = nat;
              if (!hadInitial) {
                updateRow();
                if (nat < .95 && this.mode === 'archive') {
                  clearTimeout(repartitionTimer);
                  repartitionTimer = setTimeout(() => {
                    if (this.mode !== 'archive') return;
                    const curGroups = (this.currentGroups || []).filter(g => g.gs.length > 0);
                    const nextRows = partitionRows(curGroups);
                    const nextSig = nextRows.map(r => r.type === 'lead' ? `L:${r.group.d}` : `P:${r.items.map(it => it.group.d).join(',')}`).join('|');
                    if (nextSig !== this._rowSignature) {
                      const prevY = window.scrollY;
                      this.render(false);
                      if (prevY > 0) window.scrollTo(0, prevY);
                    }
                  }, 60);
                }
              }
            });
          });
        });
      } else if (blankGroups.length) {
        $('#years').innerHTML = '';
        $('#years').hidden = true;
      } else {
        $('#years').hidden = false;
        const canReset = Boolean(query || year);
        $('#years').innerHTML = `<div class="empty"><p>没有找到匹配的作品，试试其他标题、地点或年份。</p>${canReset ? '<button type="button" class="reset-filters-btn">清除全部筛选</button>' : ''}</div>`;
      }
      const chronicle = $('#blankChronicle');
      const blankList = $('#blankList');
      chronicle.hidden = !blankGroups.length;
      blankList.innerHTML = blankGroups.map(g => `
        <button type="button" class="blank-entry" data-day="${g.d}" aria-label="查看 ${esc(g.title)}">
          <time class="blank-date" datetime="${g.d}">${g.d.replace(/-/g, '.')}</time>
          <span class="blank-title">${esc(g.title)}</span>
          <span class="blank-loc">${esc(g.loc && g.loc !== '—' ? g.loc : '时光留白')} <span aria-hidden="true">↗</span></span>
        </button>`).join('');
      Motion.observe($('#years'));
    },
  };
}
