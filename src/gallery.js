import { TONES, resolveTone, toneGroups } from './tones.mjs';
import { createPhotoRiver } from './photo-river.js';

export function createArchive({ $, Store, YEARS, totalPhotos, esc, pURL, pView, Motion, storageGet, storageSet, openGroup, openProof, closeGroup, openAdmin }) {
  const ratioCache = new Map();
  function applyNaturalAspect(container, selector, minRatio, maxRatio) {
    container.querySelectorAll(selector).forEach(box => {
      const img = box.querySelector('img');
      if (!img) return;
      const key = img.getAttribute('src') || '';
      if (ratioCache.has(key)) {
        const cached = Math.max(minRatio, Math.min(maxRatio, ratioCache.get(key)));
        box.style.aspectRatio = cached.toFixed(3);
        return;
      }
      const syncRatio = () => {
        if (!img.naturalWidth || !img.naturalHeight) return;
        const nat = img.naturalWidth / img.naturalHeight;
        if (key) ratioCache.set(key, nat);
        const ratio = Math.max(minRatio, Math.min(maxRatio, nat));
        box.style.aspectRatio = ratio.toFixed(3);
      };
      if (img.complete && img.naturalWidth) syncRatio();
      else img.addEventListener('load', syncRatio, { once: true });
    });
  }

  function cadenceClass(index, total) {
    if (index === 0) return 'is-lead';
    const remaining = total - 1;
    if (remaining % 2 === 1 && index === total - 1) return 'is-lead';
    const pair = Math.floor((index - 1) / 2);
    const pos = (index - 1) % 2;
    if (pair % 3 === 0) return pos === 0 ? 'is-wide' : 'is-side';
    if (pair % 3 === 1) return 'is-half';
    return pos === 0 ? 'is-side' : 'is-wide';
  }

  return {
    openDays: new Set(),
    toneIndex: {},
    mode: 'archive',
    selectedTone: 'all',
    limit: 24,
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
      if (!this.river) this.river = createPhotoRiver({ host: $('#photoRiver'), Motion, url: pURL, openPhoto: openProof, storageGet, storageSet });
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
      $('#toneMore').addEventListener('click', () => {
        const firstNew = this.limit;
        this.limit += 24; this.render(false);
        $('#years').querySelectorAll('.tone-photo')[firstNew]?.focus({ preventScroll: true });
      });
      let searchTimer;
      $('#archiveSearch').addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => this.render(), 120);
      });
      filter.addEventListener('change', () => this.render());
      $('#years').addEventListener('click', event => {
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
        if (anyOpen) withPhotos.forEach(g => this.openDays.delete(g.d));
        else withPhotos.forEach(g => this.openDays.add(g.d));
        this.render();
      });
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
      return `<div class="album-inline"><div class="contact-sheet">${g.gs.map((p, j) => `<button class="proof" type="button" data-day="${g.d}" data-proof-idx="${j}" aria-label="查看 ${esc(p.t)}"><img src="${esc(pURL(p, 300))}" alt="${esc(p.t)}" loading="${eager && j < 16 ? 'eager' : 'lazy'}" decoding="async" width="300" height="300"></button>`).join('')}</div></div>`;
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
    toggleSheet(day, card) {
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
      this.syncToolbar(this.currentGroups || Store.groups);
    },
    renderTones(groups, query) {
      $('#blankChronicle').hidden = true;
      $('#years').hidden = false;
      const photos = groups.flatMap(group => group.gs.map((photo, index) => ({ group, photo, index, tone: resolveTone(photo, this.toneIndex) })))
        .filter(item => !query || `${item.photo.t} ${item.photo.d || ''} ${item.group.title} ${item.group.loc} ${item.group.d}`.toLowerCase().includes(query));
      const counts = {};
      photos.forEach(item => { for (const group of toneGroups(item.tone)) counts[group] = (counts[group] || 0) + 1; });
      const filters = [{ id: 'all', label: '全部', color: 'transparent' }, ...TONES, ...(counts.pending ? [{ id: 'pending', label: '待归类', color: '#b6b1a9' }] : [])];
      if (!filters.some(filter => filter.id === this.selectedTone)) this.selectedTone = 'all';
      $('#toneFilters').innerHTML = filters.map(filter => `<button type="button" class="tone-filter" data-tone="${filter.id}" title="${filter.label}" aria-pressed="${this.selectedTone === filter.id}"${filter.id !== 'all' && !counts[filter.id] ? ' disabled' : ''}><i style="--swatch:${filter.color}" aria-hidden="true"></i><span class="tone-filter-label">${filter.label}</span><small>${filter.id === 'all' ? photos.length : counts[filter.id] || 0}</small></button>`).join('');
      const matching = photos.filter(item => this.selectedTone === 'all' || toneGroups(item.tone).includes(this.selectedTone));
      const selectedLabel = filters.find(filter => filter.id === this.selectedTone).label;
      $('#resultCount').textContent = `${this.selectedTone === 'all' ? '' : selectedLabel + ' · '}${matching.length} 张作品`;
      $('#toneMore').hidden = matching.length <= this.limit;
      $('#toneMore').textContent = `更多 · ${Math.max(0, matching.length - this.limit)}`;
      $('#years').innerHTML = matching.length ? matching.slice(0, this.limit).map(item => `
        <article class="tone-card" data-reveal>
          <button class="tone-photo proof" type="button" data-day="${item.group.d}" data-proof-idx="${item.index}" aria-label="查看 ${esc(item.photo.t)}"><img src="${esc(pURL(item.photo, 480))}" alt="${esc(item.photo.t)}" loading="eager" decoding="async" width="480" height="360"></button>
          <div class="tone-caption"><h3>${esc(item.photo.t)}</h3><span class="tone-palette" aria-label="作品代表色">${(item.tone?.palette || []).map(color => `<i style="--swatch:${color}" aria-hidden="true"></i>`).join('')}</span></div>
          <button class="tone-source" type="button" data-day="${item.group.d}" aria-label="返回相册 ${esc(item.group.title)}"><span>${esc(item.group.d)} · ${esc(item.group.loc)}</span><span aria-hidden="true">↗</span></button>
        </article>`).join('') : '<p class="empty">这个色系暂时没有匹配的作品。</p>';
      applyNaturalAspect($('#years'), '.tone-photo.proof', .72, 1.6);
      Motion.observe($('#years'));
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
      if (toneMode) { this.renderTones(groups, query); return; }
      this.currentGroups = groups;
      const photoGroups = groups.filter(g => g.gs.length > 0);
      const blankGroups = groups.filter(g => !g.gs.length);
      $('#resultCount').textContent = `${groups.length} 组 · ${groups.reduce((sum, g) => sum + g.gs.length, 0)} 张作品`;
      this.syncToolbar(groups);
      if (photoGroups.length) {
        $('#years').hidden = false;
        $('#years').innerHTML = photoGroups.map((g, i) => {
          const isOpen = this.openDays.has(g.d);
          const role = cadenceClass(i, photoGroups.length);
          const coverURL = role === 'is-lead' && innerWidth >= 900 && g.gs[0].tn?.v ? pView(g.gs[0]) : pURL(g.gs[0], 480);
          const locText = g.loc && g.loc !== '—' ? esc(g.loc) : '';
          return `
        <article class="album-card ${role}${isOpen ? ' is-sheet-open' : ''}" data-reveal>
          <button class="album-cover" type="button" data-day="${g.d}" aria-label="查看 ${esc(g.title)}">
            <img src="${esc(coverURL)}" alt="${esc(g.gs[0].t)}" loading="${i < 2 ? 'eager' : 'lazy'}" decoding="async" width="480" height="360">
          </button>
          <div class="album-lead-body">
            <div class="album-title-row">
              <h3><button class="album-title" type="button" data-day="${g.d}"><span>${esc(g.title)}</span><span class="album-open-icon" aria-hidden="true">↗</span></button></h3>
              <button class="album-sheet-btn${isOpen ? ' is-open' : ''}" type="button" data-toggle-sheet="${g.d}" aria-expanded="${isOpen}" aria-label="${isOpen ? '收起' : '展开'} ${esc(g.title)} 印样"><span>${isOpen ? '收起印样' : '印样'}</span></button>
            </div>
            <div class="album-meta"><time datetime="${g.d}">${g.d.replace(/-/g, '.')}</time>${locText ? `<span class="album-meta-sep" aria-hidden="true">·</span><span class="album-loc-meta">${locText}</span>` : ''}<span class="album-meta-sep" aria-hidden="true">·</span><span>${g.gs.length} 张</span></div>
          </div>
          ${isOpen ? this.sheetHTML(g) : ''}
        </article>`;
        }).join('');
        applyNaturalAspect($('#years'), '.album-card.is-lead .album-cover', 1.0, 1.68);
        applyNaturalAspect($('#years'), '.album-card:not(.is-lead) .album-cover', .8, 1.65);
      } else if (blankGroups.length) {
        $('#years').innerHTML = '';
        $('#years').hidden = true;
      } else {
        $('#years').hidden = false;
        $('#years').innerHTML = '<p class="empty">没有找到匹配的作品，试试其他标题、地点或年份。</p>';
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
