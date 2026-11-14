const CACHE_KEY = 'pt_motion_grade_v1';
const CACHE_AGE = 5 * 60 * 1000;

export function createMotionController() {
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const pointer = matchMedia('(hover:hover) and (pointer:fine)');
  let tier = 'lite', started = false, testing = false;
  let navigation = null, navigationId = 0;
  const presences = new Map();
  const ease = 'cubic-bezier(.22,1,.36,1)';
  let revealObserver = null, heroObserver = null, taskObserver = null;
  let raf = 0, previousFrame = 0, slowFrames = 0, sampledFrames = 0, monitorUntil = 0;
  let heroVisible = true, heroHeight = 0;
  const revealTargets = new Set();

  function restriction() {
    if (reduced.matches) return ['none', 'reduced-motion'];
    const connection = navigator.connection;
    if (connection && (connection.saveData || /^(slow-2g|2g)$/.test(connection.effectiveType))) return ['lite', 'data-saver'];
    if ((navigator.deviceMemory && navigator.deviceMemory < 4) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4)) return ['lite', 'device-budget'];
    return null;
  }
  function cache(value) {
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ tier: value, timestamp: Date.now() })); } catch (error) { /* Memory-only grading remains usable. */ }
  }
  function observe(container = document) {
    if (tier !== 'full' || !('IntersectionObserver' in window)) return;
    if (!revealObserver) revealObserver = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        entry.target.classList.add('is-revealed');
        revealTargets.delete(entry.target);
        revealObserver.unobserve(entry.target);
      }
    }, { threshold: .06, rootMargin: '0px 0px 40px' });
    for (const element of revealTargets) if (!element.isConnected) { revealObserver.unobserve(element); revealTargets.delete(element); }
    container.querySelectorAll('[data-reveal]').forEach((element, index) => {
      if (element.classList.contains('is-revealed') || revealTargets.has(element)) return;
      element.style.setProperty('--reveal-delay', `${Math.min(index % 3, 2) * 60}ms`);
      element.classList.add('motion-pending'); revealObserver.observe(element); revealTargets.add(element);
    });
  }
  function resetHeroPresence() {
    const hero = document.querySelector('.exhibition-hero');
    if (!hero) return;
    hero.classList.remove('is-hero-receded');
    hero.style.removeProperty('--hero-img-opacity');
  }
  function setTier(value, reason, save = true) {
    tier = value; root.dataset.motion = value; root.dataset.motionReason = reason;
    document.dispatchEvent(new CustomEvent('motion:change', { detail: { tier: value } }));
    if (save) cache(value);
    if (value === 'full') observe();
    else {
      navigation?.skipTransition();
      for (const [element, state] of presences) {
        presences.delete(element);
        state.animation.cancel();
        state.done?.();
      }
      if (raf) cancelAnimationFrame(raf); raf = 0;
      previousFrame = sampledFrames = slowFrames = monitorUntil = 0;
      if (revealObserver) revealObserver.disconnect(); revealObserver = null;
      revealTargets.clear();
      if (taskObserver) taskObserver.disconnect(); taskObserver = null;
      resetHeroPresence();
    }
  }
  const limits = restriction();
  if (limits) setTier(...limits, false);
  else {
    let saved;
    try { saved = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null'); } catch (error) { /* Probe when a cached grade is unavailable. */ }
    if (saved && ['full', 'lite'].includes(saved.tier) && Date.now() - saved.timestamp < CACHE_AGE) setTier(saved.tier, 'recent-grade', false);
    else setTier('lite', 'sampling-pending', false);
  }

  function watchLongTasks() {
    if (tier !== 'full' || taskObserver || !window.PerformanceObserver || !PerformanceObserver.supportedEntryTypes || !PerformanceObserver.supportedEntryTypes.includes('longtask')) return;
    let pressure = [];
    taskObserver = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) if (entry.duration >= 120) pressure.push(entry.startTime);
      pressure = pressure.filter(time => performance.now() - time < 4000);
      if (pressure.length >= 3) setTier('lite', 'runtime-pressure');
    });
    taskObserver.observe({ entryTypes: ['longtask'] });
  }
  function probe() {
    if (testing || document.hidden) return;
    const limit = restriction();
    if (limit) { setTier(...limit); return; }
    testing = true;
    const intervals = [];
    let last = null;
    const sample = time => {
      if (document.hidden) { testing = false; return; }
      if (last !== null) intervals.push(time - last);
      last = time;
      if (intervals.length < 30) { requestAnimationFrame(sample); return; }
      const sorted = [...intervals].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const missed = intervals.filter(interval => interval > 32).length / intervals.length;
      const currentLimit = restriction();
      if (currentLimit) setTier(...currentLimit);
      else setTier(median <= 21 && missed < .12 ? 'full' : 'lite', 'frame-sample');
      testing = false; watchLongTasks();
    };
    requestAnimationFrame(sample);
  }

  function renderFrame(time) {
    raf = 0;
    const header = document.querySelector('.topbar');
    if (header) header.classList.toggle('is-scrolled', window.scrollY >= Math.max(80, heroHeight - header.offsetHeight));
    if (tier !== 'full' || !heroVisible || document.hidden || document.getElementById('archive').hidden) { previousFrame = 0; return; }
    // Sample consecutive frames during interaction, never the gaps between input events.
    const interval = time - previousFrame;
    if (previousFrame) {
      sampledFrames++; if (interval > 28) slowFrames++;
      if (sampledFrames >= 18) {
        if (slowFrames / sampledFrames > .3) { setTier('lite', 'interaction-frame-pressure'); return; }
        sampledFrames = 0; slowFrames = 0;
      }
    }
    previousFrame = time;
    if (time < monitorUntil) raf = requestAnimationFrame(renderFrame);
    else previousFrame = 0;
  }
  function scheduleFrame(interacting = false) {
    if (interacting && tier === 'full') monitorUntil = performance.now() + 180;
    if (!raf) raf = requestAnimationFrame(renderFrame);
  }

  function presence(element, closing = false, done) {
    const prior = presences.get(element);
    if (closing && prior?.closing) return;
    const opacity = prior ? getComputedStyle(element).opacity : null;
    if (prior) {
      presences.delete(element);
      prior.animation.cancel();
    }
    if (tier !== 'full' || reduced.matches || !element.animate) { done?.(); return; }
    const animation = element.animate([
      { opacity: opacity ?? (closing ? 1 : 0) }, { opacity: closing ? 0 : 1 },
    ], { duration: closing ? 200 : 260, easing: ease, fill: 'both' });
    if (!animation.finished) { animation.cancel(); done?.(); return; }
    const state = { animation, closing, done };
    presences.set(element, state);
    const finish = () => {
      if (presences.get(element) !== state) return;
      presences.delete(element);
      done?.();
      animation.cancel();
    };
    animation.finished.then(finish, finish);
  }

  return {
    observe,
    get tier() { return tier; },
    downgrade(reason = 'season-pressure') { setTier('lite', reason); },
    present(element) { navigation?.skipTransition(); presence(element); },
    dismiss(element, done) { presence(element, true, done); },
    transition(update, { back = false } = {}) {
      const id = ++navigationId;
      navigation?.skipTransition(); navigation = null;
      if (tier !== 'full' || reduced.matches) { update(); delete root.dataset.navigation; return; }
      root.dataset.navigation = back ? 'back' : 'forward';
      const cleanup = () => { if (id === navigationId) { navigation = null; delete root.dataset.navigation; } };
      if (!document.startViewTransition) {
        update();
        const page = document.querySelector('#groupPage:not([hidden]),#archive:not([hidden])');
        if (!page?.animate) { cleanup(); return; }
        const animation = page.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: ease });
        // The same cancellation path handles fallback animation and native snapshots.
        navigation = { skipTransition: () => animation.cancel() };
        animation.finished.then(cleanup, cleanup);
        return;
      }
      const transition = document.startViewTransition(() => { if (id === navigationId) update(); });
      navigation = transition;
      transition.ready.catch(() => {}); // Skipping an interrupted snapshot rejects ready by design.
      transition.updateCallbackDone.catch(error => console.error('Page navigation failed', error));
      transition.finished.then(cleanup, cleanup);
    },
    start() {
      if (started) return; started = true;
      const hero = document.querySelector('.exhibition-hero');
      heroHeight = hero ? hero.offsetHeight : 0;
      if (hero && 'IntersectionObserver' in window) {
        heroObserver = new IntersectionObserver(entries => {
          const entry = entries[0];
          heroVisible = entry.isIntersecting;
          hero.classList.toggle('motion-in-view', heroVisible && !document.hidden);
          if (tier === 'full') {
            const ratio = entry.isIntersecting ? entry.intersectionRatio : 0;
            const receded = !entry.isIntersecting || ratio < .45;
            const imgOpacity = Math.max(.28, Math.min(1, .28 + .72 * Math.min(1, ratio / .55)));
            hero.classList.toggle('is-hero-receded', receded);
            hero.style.setProperty('--hero-img-opacity', imgOpacity.toFixed(2));
          } else {
            resetHeroPresence();
          }
          scheduleFrame();
        }, { threshold: [0, .15, .3, .45, .6, .75, .9, 1] });
        heroObserver.observe(hero);
      }
      window.addEventListener('scroll', () => scheduleFrame(true), { passive: true });
      window.addEventListener('resize', () => { heroHeight = hero ? hero.offsetHeight : 0; scheduleFrame(); }, { passive: true });
      if (hero) {
        hero.addEventListener('pointermove', event => {
          if (tier !== 'full' || !pointer.matches || event.pointerType === 'touch') return;
          scheduleFrame(true);
        }, { passive: true });
      }
      const preferenceChanged = () => {
        const limit = restriction();
        if (limit) setTier(...limit);
        else probe();
      };
      if (reduced.addEventListener) reduced.addEventListener('change', preferenceChanged);
      else reduced.addListener(preferenceChanged);
      if (navigator.connection && navigator.connection.addEventListener) navigator.connection.addEventListener('change', preferenceChanged);
      document.addEventListener('visibilitychange', () => {
        if (hero) hero.classList.toggle('motion-in-view', heroVisible && !document.hidden);
        if (document.hidden) {
          if (raf) cancelAnimationFrame(raf); raf = 0;
          previousFrame = 0; monitorUntil = 0;
        }
        else if (!document.hidden && root.dataset.motionReason === 'sampling-pending') probe();
      });
      if (!limits && root.dataset.motionReason !== 'recent-grade') {
        if (window.requestIdleCallback) requestIdleCallback(probe, { timeout: 1500 });
        else setTimeout(probe, 300);
      } else watchLongTasks();
      scheduleFrame();
    },
  };
}
