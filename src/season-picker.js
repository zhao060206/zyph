const CHOICES = ['auto', 'spring', 'summer', 'autumn', 'winter'];
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

const OPTION_META = [
  { value: 'auto', ariaLabel: '季节主题：自动跟随季节' },
  { value: 'spring', ariaLabel: '季节主题：春' },
  { value: 'summer', ariaLabel: '季节主题：夏' },
  { value: 'autumn', ariaLabel: '季节主题：秋' },
  { value: 'winter', ariaLabel: '季节主题：冬' },
];

const SEASON_LABELS = {
  spring: '春',
  summer: '夏',
  autumn: '秋',
  winter: '冬',
};

const SEASON_GLYPHS = {
  // Five-petal cherry blossom with delicate tip clefts and fine stamens.
  spring:
    '<path class="sg-main" d="M10.6,9.58 C8.41,6.46 8.79,3.17 10.3,2.35 L12,4 L13.7,2.35 C15.21,3.17 15.59,6.46 13.4,9.58 M13.87,9.92 C16.15,6.87 19.41,6.21 20.65,7.4 L19.61,9.53 L21.7,10.64 C21.39,12.33 18.38,13.71 14.74,12.58 M14.56,13.14 C18.16,14.37 19.79,17.26 19.05,18.81 L16.7,18.47 L16.3,20.81 C14.59,21.04 12.35,18.59 12.29,14.78 M11.71,14.78 C11.65,18.59 9.41,21.04 7.7,20.81 L7.3,18.47 L4.95,18.81 C4.21,17.26 5.84,14.37 9.44,13.14 M9.26,12.58 C5.62,13.71 2.61,12.33 2.3,10.64 L4.39,9.53 L3.35,7.4 C4.59,6.21 7.85,6.87 10.13,9.92" fill="var(--season-glyph-accent,currentColor)" fill-opacity="0.1" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path class="sg-fine" d="M12,10.1L12,7.5 M13.81,11.41L16.28,10.61 M13.12,13.54L14.65,15.64 M10.88,13.54L9.35,15.64 M10.19,11.41L7.72,10.61" fill="none" stroke="currentColor" stroke-linecap="round" opacity="0.72"/>' +
    '<circle cx="12" cy="12" r="1.55" fill="var(--season-glyph-accent,currentColor)"/>',

  // Radiant solar disk with core and 12 fine alternating rays (distinct from #seasonEffects' hollow 8-ray sparkle).
  summer:
    '<circle class="sg-main" cx="12" cy="12" r="4.6" fill="var(--season-glyph-accent,currentColor)" fill-opacity="0.16" stroke="currentColor"/>' +
    '<circle cx="12" cy="12" r="1.85" fill="var(--season-glyph-accent,currentColor)"/>' +
    '<path class="sg-fine" d="M12,4.8L12,1.6 M15.6,5.76L16.55,4.12 M18.24,8.4L21.01,6.8 M19.2,12L21.1,12 M18.24,15.6L21.01,17.2 M15.6,18.24L16.55,19.88 M12,19.2L12,22.4 M8.4,18.24L7.45,19.88 M5.76,15.6L2.99,17.2 M4.8,12L2.9,12 M5.76,8.4L2.99,6.8 M8.4,5.76L7.45,4.12" fill="none" stroke="currentColor" stroke-linecap="round"/>',

  // Five-lobed maple leaf silhouette with palmate venation and stem.
  autumn:
    '<path class="sg-main" d="M12,2.3 L13.7,5.7 L15.3,4.9 L14.6,8.7 L17.9,6.6 L17.6,8.4 L21.4,9.9 L18.5,11.8 L19.1,13 L15.5,13.1 L18.4,15.6 L15.9,16.5 L15.6,17.7 L12,16.6 L8.4,17.7 L8.1,16.5 L5.6,15.6 L8.5,13.1 L4.9,13 L5.5,11.8 L2.6,9.9 L6.4,8.4 L6.1,6.6 L9.4,8.7 L8.7,4.9 L10.3,5.7 Z" fill="var(--season-glyph-accent,currentColor)" fill-opacity="0.13" stroke="currentColor" stroke-linejoin="round"/>' +
    '<path class="sg-main" d="M12,16.6 V21.6" fill="none" stroke="currentColor" stroke-linecap="round"/>' +
    '<path class="sg-fine" d="M12,16.6 V5.6 M12,14.1 L5.4,10.2 M12,14.1 L18.6,10.2 M12,15.6 L7.2,15.4 M12,15.6 L16.8,15.4" fill="none" stroke="currentColor" stroke-linecap="round" opacity="0.78"/>',

  // Symmetrical six-armed hexagonal ice crystal with sharp outer chevrons.
  winter:
    '<path class="sg-fine" d="M12,8.8L14.77,10.4L14.77,13.6L12,15.2L9.23,13.6L9.23,10.4Z" fill="var(--season-glyph-accent,currentColor)" fill-opacity="0.16" stroke="currentColor" stroke-linejoin="miter"/>' +
    '<path class="sg-fine" d="M12,12L12,8.8 M12,12L14.77,10.4 M12,12L14.77,13.6 M12,12L12,15.2 M12,12L9.23,13.6 M12,12L9.23,10.4" fill="none" stroke="currentColor" opacity="0.5"/>' +
    '<path class="sg-main" d="M12,8.8L12,1.8 M9.95,3.97L12,5.4L14.05,3.97 M14.77,10.4L20.83,6.9 M17.94,6.21L17.72,8.7L19.99,9.76 M14.77,13.6L20.83,17.1 M19.99,14.24L17.72,15.3L17.94,17.79 M12,15.2L12,22.2 M14.05,20.03L12,18.6L9.95,20.03 M9.23,13.6L3.17,17.1 M6.06,17.79L6.28,15.3L4.01,14.24 M9.23,10.4L3.17,6.9 M4.01,9.76L6.28,8.7L6.06,6.21" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="miter"/>',
};

const AUTO_MENU_GLYPH =
  '<path class="sg-main" d="M20.16,8.7 A8.8 8.8 0 1 1 15.3,3.84" fill="none" stroke="currentColor" stroke-linecap="round"/>' +
  '<circle cx="18.22" cy="5.78" r="1.4" fill="var(--season-glyph-accent,var(--season-ink))"/>' +
  '<path class="sg-fine" d="M12,5.6V7.3 M18.4,12H16.7 M12,18.4V16.7 M5.6,12H7.3" fill="none" stroke="currentColor" stroke-linecap="round" opacity="0.62"/>' +
  '<circle cx="12" cy="12" r="2.6" fill="var(--season-glyph-accent,var(--season-ink))"/>';

function seasonForMonth(month) {
  return month >= 2 && month <= 4 ? 'spring' : month >= 5 && month <= 7 ? 'summer' : month >= 8 && month <= 10 ? 'autumn' : 'winter';
}

function buildOptionSvg(value) {
  const inner = value === 'auto' ? AUTO_MENU_GLYPH : SEASON_GLYPHS[value];
  return `<svg class="season-glyph" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">${inner}</svg>`;
}

function buildTriggerSvg(choice, season) {
  const glyph = SEASON_GLYPHS[season] || SEASON_GLYPHS.spring;
  if (choice === 'auto') {
    return (
      '<svg class="season-glyph is-auto" viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">' +
      '<path d="M21.41,7.81 A10.3 10.3 0 1 1 15.86,2.45" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" opacity="0.72"/>' +
      '<circle cx="19.15" cy="4.59" r="1.3" fill="var(--season-ink)"/>' +
      `<g class="season-inner-glyph" transform="translate(12 12) scale(0.58) translate(-12 -12)">${glyph}</g>` +
      '</svg>'
    );
  }
  return `<svg class="season-glyph" viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">${glyph}</svg>`;
}

/**
 * Enhances `.season-picker` with a pure-SVG icon trigger (`#seasonTrigger`) and
 * capsule popover (`#seasonMenu`), synchronizing bidirectionally with the hidden
 * native `#seasonSelect` so existing `seasons.js` and Playwright tests remain intact.
 */
export function initSeasonPicker() {
  const picker = document.querySelector('.season-picker');
  const select = document.getElementById('seasonSelect');
  if (!picker || !select) return null;

  const root = document.documentElement;
  let trigger = document.getElementById('seasonTrigger');
  if (!trigger) {
    trigger = document.createElement('button');
    trigger.id = 'seasonTrigger';
    trigger.className = 'season-trigger';
    trigger.type = 'button';
    picker.appendChild(trigger);
  }
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', 'seasonMenu');
  trigger.removeAttribute('title');
  trigger.innerHTML =
    '<span class="season-trigger-glyph" aria-hidden="true"></span>' +
    '<svg class="season-trigger-caret" viewBox="0 0 8 8" width="7" height="7" aria-hidden="true">' +
    '<path d="M1.5 2.75L4 5.25L6.5 2.75" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';

  const triggerGlyph = trigger.querySelector('.season-trigger-glyph');

  let menu = document.getElementById('seasonMenu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'seasonMenu';
    menu.className = 'season-menu';
    menu.hidden = true;
    picker.appendChild(menu);
  }
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', '季节主题选择');
  menu.innerHTML = '';

  const optionButtons = OPTION_META.map(({ value, ariaLabel }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'season-option';
    button.setAttribute('role', 'menuitemradio');
    button.setAttribute('aria-label', ariaLabel);
    button.setAttribute('aria-checked', 'false');
    button.dataset.seasonOption = value;
    button.tabIndex = -1;
    button.innerHTML = buildOptionSvg(value);
    menu.appendChild(button);
    return button;
  });

  let isOpen = false;
  let renderedKey = '';

  function resolveState(event) {
    const choice = CHOICES.includes(select.value) ? select.value : 'auto';
    const fromEvent = event && event.detail && event.detail.season;
    const rawSeason = SEASONS.includes(fromEvent) ? fromEvent : root.dataset.season;
    const season = choice === 'auto'
      ? (SEASONS.includes(rawSeason) ? rawSeason : seasonForMonth(new Date().getMonth()))
      : choice;
    return { choice, season };
  }

  function sync(event) {
    const { choice, season } = resolveState(event);
    const key = `${choice}:${season}`;
    if (key === renderedKey) return;
    renderedKey = key;

    picker.dataset.choice = choice;
    picker.dataset.season = season;
    trigger.dataset.choice = choice;
    trigger.dataset.season = season;
    menu.dataset.choice = choice;
    menu.dataset.season = season;

    const seasonText = SEASON_LABELS[season] || '';
    trigger.setAttribute(
      'aria-label',
      choice === 'auto' ? `季节主题：自动（${seasonText}）` : `季节主题：${seasonText}`
    );
    triggerGlyph.innerHTML = buildTriggerSvg(choice, season);

    optionButtons.forEach(button => {
      const active = button.dataset.seasonOption === choice;
      button.setAttribute('aria-checked', String(active));
      button.tabIndex = active ? 0 : -1;
    });
  }

  function clampMenuToViewport() {
    menu.style.marginLeft = '';
    const rect = menu.getBoundingClientRect();
    const pad = 12;
    let delta = 0;
    if (rect.right > innerWidth - pad) delta = innerWidth - pad - rect.right;
    else if (rect.left + delta < pad) delta = pad - rect.left;
    if (Math.abs(delta) > 0.5) menu.style.marginLeft = `${Math.round(delta)}px`;
  }

  function open({ focus = false, focusIndex } = {}) {
    if (isOpen) return;
    isOpen = true;
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    clampMenuToViewport();

    if (focus) {
      const activeIndex = optionButtons.findIndex(btn => btn.getAttribute('aria-checked') === 'true');
      const targetIndex = typeof focusIndex === 'number'
        ? Math.max(0, Math.min(optionButtons.length - 1, focusIndex))
        : (activeIndex >= 0 ? activeIndex : 0);
      optionButtons[targetIndex].focus({ preventScroll: true });
    }
  }

  function close({ returnFocus = false } = {}) {
    if (!isOpen) return;
    isOpen = false;
    menu.hidden = true;
    menu.style.marginLeft = '';
    trigger.setAttribute('aria-expanded', 'false');
    if (returnFocus && trigger.isConnected) {
      trigger.focus({ preventScroll: true });
    }
  }

  function choose(value, { returnFocus = false } = {}) {
    if (!CHOICES.includes(value)) return;
    const focusInsideMenu = menu.contains(document.activeElement);
    if (select.value !== value) {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      sync();
    }
    close({ returnFocus: returnFocus || focusInsideMenu });
  }

  function focusOptionByDelta(currentButton, delta) {
    const index = optionButtons.indexOf(currentButton);
    const start = index >= 0 ? index : 0;
    const nextIndex = (start + delta + optionButtons.length) % optionButtons.length;
    optionButtons.forEach((btn, idx) => { btn.tabIndex = idx === nextIndex ? 0 : -1; });
    optionButtons[nextIndex].focus({ preventScroll: true });
  }

  trigger.addEventListener('click', event => {
    if (isOpen) close();
    else open({ focus: event.detail === 0 });
  });

  trigger.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!isOpen) open({ focus: true });
      else {
        const active = optionButtons.find(btn => btn.getAttribute('aria-checked') === 'true') || optionButtons[0];
        active.focus({ preventScroll: true });
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) open({ focus: true, focusIndex: optionButtons.length - 1 });
      else optionButtons[optionButtons.length - 1].focus({ preventScroll: true });
    } else if (isOpen && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      event.preventDefault();
      const active = optionButtons.find(btn => btn.getAttribute('aria-checked') === 'true') || optionButtons[0];
      focusOptionByDelta(active, event.key === 'ArrowRight' ? 1 : -1);
    }
  });

  menu.addEventListener('click', event => {
    const button = event.target.closest('.season-option');
    if (!button) return;
    choose(button.dataset.seasonOption, { returnFocus: event.detail === 0 });
  });

  menu.addEventListener('keydown', event => {
    const current = document.activeElement && document.activeElement.closest('.season-option');
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      focusOptionByDelta(current || optionButtons[0], 1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusOptionByDelta(current || optionButtons[0], -1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      optionButtons.forEach((btn, idx) => { btn.tabIndex = idx === 0 ? 0 : -1; });
      optionButtons[0].focus({ preventScroll: true });
    } else if (event.key === 'End') {
      event.preventDefault();
      const last = optionButtons.length - 1;
      optionButtons.forEach((btn, idx) => { btn.tabIndex = idx === last ? 0 : -1; });
      optionButtons[last].focus({ preventScroll: true });
    }
  });

  document.addEventListener('pointerdown', event => {
    if (isOpen && !picker.contains(event.target)) close();
  });

  document.addEventListener('click', event => {
    if (isOpen && !picker.contains(event.target)) close();
  });

  document.addEventListener('focusin', event => {
    if (isOpen && !picker.contains(event.target)) close();
  });

  document.addEventListener('keydown', event => {
    if (!isOpen || event.key !== 'Escape') return;
    if (root.dataset.dialogOpen === 'true') return;
    event.preventDefault();
    event.stopPropagation();
    close({ returnFocus: true });
  });

  window.addEventListener('resize', () => {
    if (isOpen) clampMenuToViewport();
  }, { passive: true });

  new MutationObserver(() => {
    if (isOpen && root.dataset.dialogOpen === 'true') close();
  }).observe(root, { attributes: true, attributeFilter: ['data-dialog-open'] });

  select.addEventListener('change', sync);
  document.addEventListener('season:change', sync);

  sync();

  return { sync, open, close };
}
