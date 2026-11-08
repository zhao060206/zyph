export function createArchive({ $, Store, YEARS, totalPhotos, esc, pURL, pView, featuredPhoto, Motion, openGroup, openProof, closeGroup, openAdmin }) {
  return {
    openDays: new Set(),
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
      if (this.bound) return;
      this.bound = true;
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
          openProof(proof.dataset.day, Number(proof.dataset.proofIdx));
          return;
        }
        const target = event.target.closest('[data-day]');
        if (target) openGroup(target.dataset.day);
      });
      feature.addEventListener('click', () => openGroup(feature.dataset.day));
      $('#heroExplore').addEventListener('click', () => feature.click());
      $('#heroPrev').addEventListener('click', () => this.paintHero((this.heroIndex - 1 + this.slides.length) % this.slides.length));
      $('#heroNext').addEventListener('click', () => this.paintHero((this.heroIndex + 1) % this.slides.length));
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
    paintHero(index) {
      this.heroIndex = index;
      const group = this.slides[index];
      const photo = index === 0 ? group.gs.find(p => p.k === featuredPhoto) || group.gs[0] : group.gs[0];
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
    render() {
      const query = $('#archiveSearch').value.trim().toLowerCase();
      const year = $('#yearFilter').value;
      const groups = Store.groups.filter(g => (!year || g.d.startsWith(year)) &&
        (!query || `${g.title} ${g.loc} ${g.d} ${g.c || ''}`.toLowerCase().includes(query)))
        .sort((a, b) => b.d.localeCompare(a.d));
      this.currentGroups = groups;
      $('#resultCount').textContent = `${groups.length} 组 · ${groups.reduce((sum, g) => sum + g.gs.length, 0)} 张作品`;
      this.syncToolbar(groups);
      $('#years').innerHTML = groups.length ? groups.map((g, i) => {
        const isOpen = g.gs.length > 0 && this.openDays.has(g.d);
        return `
        <article class="album-card${isOpen ? ' is-sheet-open' : ''}" data-reveal>
          <button class="album-cover${g.gs.length ? '' : ' album-cover-empty'}" type="button" data-day="${g.d}" aria-label="查看 ${esc(g.title)}">
            ${g.gs.length ? `<img src="${esc(pURL(g.gs[0], 480))}" alt="${esc(g.gs[0].t)}" loading="lazy" decoding="async" width="480" height="360">` : `<span class="album-empty"><span class="album-empty-ring" aria-hidden="true"></span><strong>${esc(g.title)}</strong><small>时光留白</small></span>`}
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
