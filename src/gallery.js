import { TONES, resolveTone, toneGroups } from './tones.mjs';
import { SEASONS } from './seasons.js';

export function createArchive({ $, Store, YEARS, totalPhotos, esc, pURL, pView, featuredPhoto, Motion, openGroup, openProof, closeGroup, openAdmin }) {
  return {
    openDays: new Set(),
    toneIndex: {},
    seasonCovers: {},
    mode: 'archive',
    selectedTone: 'all',
    limit: 24,
    init() {
      const filter = $('#yearFilter');
      const selected = filter.value;
      filter.innerHTML = '<option value="">全部年份</option>' + YEARS().map(y => `<option value="${y}">${y} 年</option>`).join('');
      if (YEARS().includes(selected)) filter.value = selected;
      const count = totalPhotos();
      $('#barStat').textContent = `${count} 张照片 / ${Store.groups.length} 组故事`;
      $('#heroCounts').innerHTML = `<span><strong>${count}</strong>照片</span><span><strong>${Store.groups.length}</strong>组故事</span><span><strong>${YEARS().length}</strong>年时光</span>`;
      $('#archiveSource').hidden = Store.remote;
      $('#archiveSource').textContent = Store.remote ? '' : '演示作品 · 云端暂时不可用';
      this.slides = [...Store.groups].sort((a, b) => b.d.localeCompare(a.d)).filter(g => g.gs.length);
      const feature = $('#heroFeature');
      feature.disabled = !this.slides.length;
      $('#heroExplore').disabled = !this.slides.length;
      if (this.slides.length) this.paintHero(0);
      $('#heroPrev').hidden = $('#heroNext').hidden = this.slides.length < 2;
      const validDays = new Set(Store.groups.filter(g => g.gs.length).map(g => g.d));
      for (const day of [...this.openDays]) {
        if (!validDays.has(day)) this.openDays.delete(day);
      }
      this.render();
      if (this.bound) this.seasonHero();
      if (this.bound) return;
      this.bound = true;
      fetch('/assets/tone-index.json').then(response => {
        if (!response.ok) throw new Error('色调索引暂时不可用');
        return response.json();
      }).then(data => {
        if (data.version !== 1 || !data.photos || typeof data.photos !== 'object') throw new Error('色调索引格式无效');
        this.toneIndex = data.photos;
        this.seasonCovers = data.covers || {};
        if (this.mode === 'tone') this.render();
        if (!this.heroManual) this.seasonHero();
      }).catch(() => { if (this.mode === 'tone') this.render(); });
      document.addEventListener('season:change', () => this.seasonHero());
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
      feature.addEventListener('click', () => openGroup(feature.dataset.day));
      $('#heroExplore').addEventListener('click', () => feature.click());
      $('#heroPrev').addEventListener('click', () => { this.heroManual = true; this.paintHero((this.heroIndex - 1 + this.slides.length) % this.slides.length); });
      $('#heroNext').addEventListener('click', () => { this.heroManual = true; this.paintHero((this.heroIndex + 1) % this.slides.length); });
      $('#expandAll').addEventListener('click', () => {
        Store.groups.forEach(g => { if (g.gs.length) this.openDays.add(g.d); });
        this.render();
      });
      $('#collapseAll').addEventListener('click', () => {
        this.openDays.clear();
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
    seasonHero() {
      const season = document.documentElement.dataset.season;
      const config = SEASONS[season];
      if (!config || !this.slides.length) return;
      const curated = this.seasonCovers[season];
      let chosen = null, albumIndex = -1;
      if (curated) albumIndex = this.slides.findIndex(group => { chosen = group.gs.find(photo => photo.k === curated); return !!chosen; });
      if (albumIndex < 0) {
        albumIndex = this.slides.findIndex(group => {
          chosen = group.gs.find(photo => config.groups.includes(resolveTone(photo, this.toneIndex)?.group));
          return !!chosen;
        });
      }
      this.heroManual = false;
      if (albumIndex >= 0) this.paintHero(albumIndex, chosen);
    },
    paintHero(index, chosenPhoto) {
      this.heroIndex = index;
      const group = this.slides[index];
      const photo = chosenPhoto || (index === 0 ? group.gs.find(p => p.k === featuredPhoto) || group.gs[0] : group.gs[0]);
      const feature = $('#heroFeature'), img = $('#heroImage');
      feature.dataset.day = group.d;
      feature.dataset.photo = photo.k || photo.u;
      feature.dataset.shared = String(photo === group.gs[0]);
      feature.setAttribute('aria-label', '查看 ' + group.title);
      $('#heroTitle').textContent = group.title;
      $('#heroDate').textContent = group.d.replace(/-/g, ' / ');
      $('#heroLoc').textContent = group.loc;
      $('#heroSlideIndex').textContent = `${String(index + 1).padStart(2, '0')} / ${String(this.slides.length).padStart(2, '0')}`;
      const generation = this.heroGeneration = (this.heroGeneration || 0) + 1;
      let triedSmall = false;
      img.alt = photo.t || group.title;
      img.onload = () => {
        if (this.heroGeneration !== generation) return;
        img.hidden = false; feature.classList.remove('image-error');
        Motion.enterImage(img);
      };
      img.onerror = () => {
        if (this.heroGeneration !== generation) return;
        const small = pURL(photo, 480);
        if (!triedSmall && small !== img.getAttribute('src')) { triedSmall = true; img.src = small; return; }
        feature.classList.add('image-error');
      };
      img.hidden = false;
      img.src = navigator.connection && navigator.connection.saveData ? pURL(photo, 480) : pView(photo);
    },
    sheetHTML(g, eager = false) {
      return `<div class="album-inline"><div class="contact-sheet">${g.gs.map((p, j) => `<button class="proof" type="button" data-day="${g.d}" data-proof-idx="${j}" aria-label="查看 ${esc(p.t)}"><img src="${esc(pURL(p, 300))}" alt="${esc(p.t)}" loading="${eager && j < 16 ? 'eager' : 'lazy'}" decoding="async" width="300" height="300"><span class="pf-num">${String(j + 1).padStart(2, '0')}</span></button>`).join('')}</div></div>`;
    },
    syncToolbar(groups = Store.groups) {
      const withPhotos = groups.filter(g => g.gs.length);
      const openCount = withPhotos.filter(g => this.openDays.has(g.d)).length;
      const allOpen = withPhotos.length > 0 && openCount === withPhotos.length;
      const noneOpen = openCount === 0;
      $('#expandAll').setAttribute('aria-pressed', String(allOpen));
      $('#collapseAll').setAttribute('aria-pressed', String(noneOpen));
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
          if (label) label.textContent = isOpen ? '收起印样' : '展开印样';
        }
        const existing = card.querySelector('.album-inline');
        if (isOpen && !existing) card.insertAdjacentHTML('beforeend', this.sheetHTML(g, true));
        else if (!isOpen && existing) existing.remove();
      }
      this.syncToolbar(this.currentGroups || Store.groups);
    },
    renderTones(groups, query) {
      const photos = groups.flatMap(group => group.gs.map((photo, index) => ({ group, photo, index, tone: resolveTone(photo, this.toneIndex) })))
        .filter(item => !query || `${item.photo.t} ${item.photo.d || ''} ${item.group.title} ${item.group.loc} ${item.group.d}`.toLowerCase().includes(query));
      const counts = {};
      photos.forEach(item => { for (const group of toneGroups(item.tone)) counts[group] = (counts[group] || 0) + 1; });
      const filters = [{ id: 'all', label: '全部', color: 'transparent' }, ...TONES, ...(counts.pending ? [{ id: 'pending', label: '待归类', color: '#b6b1a9' }] : [])];
      if (!filters.some(filter => filter.id === this.selectedTone)) this.selectedTone = 'all';
      $('#toneFilters').innerHTML = filters.map(filter => `<button type="button" class="tone-filter" data-tone="${filter.id}" title="${filter.label}" aria-pressed="${this.selectedTone === filter.id}"${filter.id !== 'all' && !counts[filter.id] ? ' disabled' : ''}><i style="--swatch:${filter.color}" aria-hidden="true"></i><span class="tone-filter-label${filter.id === 'all' ? '' : ' sr-only'}">${filter.label}</span><small>${filter.id === 'all' ? photos.length : counts[filter.id] || 0}</small></button>`).join('');
      const matching = photos.filter(item => this.selectedTone === 'all' || toneGroups(item.tone).includes(this.selectedTone));
      const selectedLabel = filters.find(filter => filter.id === this.selectedTone).label;
      $('#resultCount').textContent = `${this.selectedTone === 'all' ? '' : selectedLabel + ' · '}${matching.length} 张作品`;
      $('#toneMore').hidden = matching.length <= this.limit;
      $('#toneMore').textContent = `更多 · ${Math.max(0, matching.length - this.limit)}`;
      $('#years').innerHTML = matching.length ? matching.slice(0, this.limit).map(item => `
        <article class="tone-card" data-reveal>
          <button class="tone-photo proof" type="button" data-day="${item.group.d}" data-proof-idx="${item.index}" aria-label="查看 ${esc(item.photo.t)}"><img src="${esc(pURL(item.photo, 480))}" alt="${esc(item.photo.t)}" loading="lazy" decoding="async" width="480" height="360"></button>
          <div class="tone-caption"><h3>${esc(item.photo.t)}</h3><span class="tone-palette" aria-label="作品代表色">${(item.tone?.palette || []).map(color => `<i style="--swatch:${color}" aria-hidden="true"></i>`).join('')}</span></div>
          <button class="tone-source" type="button" data-day="${item.group.d}" aria-label="返回相册 ${esc(item.group.title)}"><span>${esc(item.group.d)} · ${esc(item.group.loc)}</span><span aria-hidden="true">↗</span></button>
        </article>`).join('') : '<p class="empty">这个色系暂时没有匹配的作品。</p>';
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
      $('#resultCount').textContent = `${groups.length} 组 · ${groups.reduce((sum, g) => sum + g.gs.length, 0)} 张作品`;
      this.syncToolbar(groups);
      $('#years').innerHTML = groups.length ? groups.map((g, i) => {
        const isOpen = g.gs.length > 0 && this.openDays.has(g.d);
        const coverURL = g.gs.length ? i === 0 && innerWidth >= 1060 && g.gs[0].tn?.v ? pView(g.gs[0]) : pURL(g.gs[0], 480) : '';
        return `
        <article class="album-card${isOpen ? ' is-sheet-open' : ''}" data-reveal>
          <button class="album-cover${g.gs.length ? '' : ' album-cover-empty'}" type="button" data-day="${g.d}" aria-label="查看 ${esc(g.title)}">
            ${g.gs.length ? `<img src="${esc(coverURL)}" alt="${esc(g.gs[0].t)}" loading="lazy" decoding="async" width="480" height="360">` : `<span class="album-empty"><span class="album-empty-ring" aria-hidden="true"></span><strong>${esc(g.title)}</strong><small>时光留白</small></span>`}
            <span class="album-index">${String(i + 1).padStart(2, '0')}</span>
            <span class="album-frame-tag">${g.gs.length ? `${g.gs.length} 张` : '留白'}</span>
          </button>
          <div class="album-meta"><time datetime="${g.d}">${g.d.replace(/-/g, '.')}</time><span class="album-loc-meta">${esc(g.loc && g.loc !== '—' ? g.loc : `${g.gs.length} 张作品`)}</span></div>
          <div class="album-title-row">
            <h3><button class="album-title" type="button" data-day="${g.d}"><span>${esc(g.title)}</span><span class="album-open-icon" aria-hidden="true">↗</span></button></h3>
            ${g.gs.length ? `<button class="album-sheet-btn${isOpen ? ' is-open' : ''}" type="button" data-toggle-sheet="${g.d}" aria-expanded="${isOpen}" aria-label="${isOpen ? '收起' : '展开'} ${esc(g.title)} 印样"><span>${isOpen ? '收起印样' : '展开印样'}</span></button>` : ''}
          </div>
          ${isOpen ? this.sheetHTML(g) : ''}
        </article>`;
      }).join('') : '<p class="empty">没有找到匹配的作品，试试其他标题、地点或年份。</p>';
      Motion.observe($('#years'));
    },
  };
}
