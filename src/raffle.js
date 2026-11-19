import { bindTear, finishTear } from './foil-tear.js';

const tiers = {
  white: ['J', '♧', '白卡', '奶蛙小卡片（虚拟）'],
  silver: ['Q', '♤', '银卡', '随机照片冰箱贴'],
  gold: ['K', '♡', '金卡', '奈雪杨枝甘露套餐'],
  prism: ['A', '♢', '炫彩卡', '星巴克大杯太妃拿铁'],
};

const names = { welcome: '见面包', photo: '看图包', social: '互动包' };
const hints = { welcome: '填完 QQ 就能直接拆', photo: '随便点开一张照片看一眼', social: '给喜欢的照片点个赞或留句话' };
const shortHints = { welcome: '填 QQ 马上拆', photo: '点开任意照片', social: '点赞或留句话' };
const life = { published: '进行中', paused: '已暂停', ended: '已结束' };
const seenKey = 'pt_frog_invite_v3';
const joinedKey = 'pt_frog_joined_v2';

const getMotionTier = () => document.documentElement.dataset.motion || 'lite';
const prefersReduced = () => getMotionTier() === 'none' || matchMedia('(prefers-reduced-motion: reduce)').matches;
const art = card => {
  const v = (card.number - 1) % (card.tier === 'white' ? 4 : card.tier === 'silver' ? 2 : 1);
  return `/assets/frog/${card.tier}${v ? '-' + v : ''}.webp`;
};
const btn = (op, text, cls = 'frog-btn') => `<button type="button" class="${cls}" data-frog="${op}">${text}</button>`;

const pouch = () =>
  '<div class="foil-pouch" aria-hidden="true">' +
  '<i class="foil-bottom"></i>' +
  '<i class="foil-top"></i>' +
  '<span class="foil-surface-sheen"></span>' +
  '</div>';

const tearPouch = () =>
  '<div class="foil-pouch foil-interactive" aria-hidden="true">' +
  '<span class="foil-aura"></span>' +
  '<i class="foil-mouth"></i>' +
  '<i class="foil-bottom"></i>' +
  '<span class="foil-intact"><i class="foil-top"></i></span>' +
  '<span class="foil-flap"><i class="foil-top"></i></span>' +
  '<span class="foil-guide"><i></i></span>' +
  '<span class="foil-surface-sheen"></span>' +
  '<i class="foil-tip"></i>' +
  '</div>';

const face = card => {
  const [rank, suit, name] = tiers[card.tier];
  const cornerText = `${rank}<i>${suit}</i>`;
  return (
    `<span class="frog-card-frame" aria-hidden="true"></span>` +
    `<span class="frog-corner" aria-hidden="true">${cornerText}</span>` +
    `<span class="frog-art-window"><img width="512" height="512" src="${art(card)}" alt="${name}奶蛙" draggable="false"></span>` +
    `<span class="frog-legend"><strong>${name}</strong><small>#${String(card.number).padStart(3, '0')}</small></span>` +
    `<span class="frog-corner is-bottom" aria-hidden="true">${cornerText}</span>` +
    `<span class="frog-card-glare" aria-hidden="true"></span>` +
    `<span class="frog-card-sheen" aria-hidden="true"></span>`
  );
};

const cardLabel = pack => `${names[pack.slot]} · ${tiers[pack.card.tier][2]} #${pack.card.number}`;

/** 从 DOM 计算矩阵中解析实时缩放与平面旋转角，兼容 2D/3D 变换矩阵确保连点无缝衔接。 */
function sampleTransform(el) {
  const rect = el.getBoundingClientRect();
  const matrixStr = getComputedStyle(el).transform;
  let angle = 0;
  let scale = 1;
  if (matrixStr && matrixStr !== 'none') {
    if (typeof DOMMatrix === 'function') {
      try {
        const m = new DOMMatrix(matrixStr);
        angle = Math.atan2(m.b, m.a) * (180 / Math.PI);
        scale = Math.hypot(m.a, m.b) || 1;
      } catch {}
    } else {
      const match = /matrix\(([^)]+)\)/.exec(matrixStr);
      if (match) {
        const [a, b] = match[1].split(',').map(Number);
        if (Number.isFinite(a) && Number.isFinite(b)) {
          angle = Math.atan2(b, a) * (180 / Math.PI);
          scale = Math.hypot(a, b) || 1;
        }
      }
    }
  }
  return {
    cx: rect.left + rect.width / 2,
    cy: rect.top + rect.height / 2,
    angle,
    scale,
  };
}

// 部分移动端浏览器在横向轻拖后会抑制紧接而来的合成 click，保留触摸点按兜底。
function bindDeckTap(stage) {
  let tap = null;
  stage.addEventListener('touchstart', e => {
    const button = e.target.closest('button[data-frog^="switch:"]');
    const point = e.touches[0];
    tap = button && e.touches.length === 1 ? { button, x: point.clientX, y: point.clientY, id: point.identifier } : null;
  }, { passive: true });
  const drifted = p => !p || p.identifier !== tap.id || Math.hypot(p.clientX - tap.x, p.clientY - tap.y) > 10;
  stage.addEventListener('touchmove', e => { if (tap && drifted(e.touches[0])) tap = null; }, { passive: true });
  stage.addEventListener('touchcancel', () => { tap = null; }, { passive: true });
  stage.addEventListener('touchend', e => {
    const button = tap && !drifted(e.changedTouches[0]) && tap.button;
    tap = null;
    if (button && e.cancelable) { e.preventDefault(); button.click(); }
  }, { passive: false });
}

export function createRaffleUI({ $, call, auth }) {
  const modal = $('#frogModal'), body = $('#frogBody'), message = $('#frogMessage');
  const preloaded = new Set();
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  let data = null, version = 0, busy = false, active = false, visiting = Promise.resolve(), toastTimer, announced = false;
  let deckState = null;

  try { active = localStorage.getItem(joinedKey) === '1'; } catch {}
  const flag = () => { announced = true; try { sessionStorage.setItem(seenKey, '1'); } catch {} };

  function preloadOwned(packs) {
    for (const pack of packs || []) {
      if (!pack.card) continue;
      const src = art(pack.card);
      if (preloaded.has(src)) continue;
      preloaded.add(src);
      const img = new Image();
      img.decoding = 'async';
      img.src = src;
    }
  }

  function clearDeckState() {
    if (!deckState) return;
    for (const anim of deckState.anims) {
      try { anim.cancel(); } catch {}
    }
    deckState.anims = [];
    deckState.cleanup?.();
    deckState = null;
  }

  function toast(text) {
    const node = $('#frogToast');
    node.textContent = text;
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      node.hidden = true;
      node.textContent = '';
    }, 2400);
  }

  function remember(next) {
    data = next;
    active = next.joined && next.status === 'published';
    const ret = $('#frogReturn');
    ret.hidden = !next.joined;
    const unopened = next.status === 'published' ? next.packs.filter(v => v.earned && !v.card).length : 0;
    if (unopened > 0) ret.dataset.unopened = String(unopened);
    else delete ret.dataset.unopened;
    try { localStorage.setItem(joinedKey, active ? '1' : '0'); } catch {}
    preloadOwned(next.packs);
  }

  function close() {
    version++;
    clearDeckState();
    modal.hidden = true;
    body.replaceChildren();
    message.textContent = '';
  }

  /** 我的奖品袋：展示奶蛙同伴与 3 包领取/开启进度。 */
  function wall() {
    clearDeckState();
    const slots = data.packs;
    const next = slots.find(v => v.earned && !v.card);
    const unopenedCount = slots.filter(v => v.earned && !v.card).length;
    const openedCount = slots.filter(v => v.card).length;

    const meter = slots.map(v =>
      `<i class="frog-meter-step ${v.card ? 'is-opened' : v.earned ? 'is-ready' : 'is-locked'}" title="${names[v.slot]}"></i>`
    ).join('');

    const rows = slots.map((v, i) => {
      const stateClass = v.card ? 'is-opened' : v.earned ? 'is-ready' : 'is-locked';
      const click = v.card ? `show:${v.slot}` : v.earned && data.status === 'published' ? `open:${v.slot}` : 'browse';
      const leadBadge = v.card
        ? `<span class="frog-slot-badge ${v.card.tier}">${tiers[v.card.tier][0]}${tiers[v.card.tier][1]}</span>`
        : `<small class="frog-slot-num">0${i + 1}</small>`;
      const subText = v.card
        ? `#${String(v.card.number).padStart(3, '0')} · ${tiers[v.card.tier][2]}`
        : hints[v.slot];
      const tag = v.card
        ? `<i class="frog-slot-tag">看这张 ↗</i>`
        : v.earned
          ? `<i class="frog-slot-tag is-ready">去拆包 ↗</i>`
          : `<i class="frog-slot-tag">去解锁</i>`;
      return (
        `<button type="button" class="frog-slot ${stateClass}" data-frog="${click}" ${!v.earned && data.status !== 'published' ? 'disabled' : ''}>` +
        `${leadBadge}` +
        `<span class="frog-slot-main"><b>${names[v.slot]}</b><em>${subText}</em></span>` +
        `${tag}` +
        `</button>`
      );
    }).join('');

    const subtitle = data.status !== 'published'
      ? `${life[data.status]} · 共拆过 ${openedCount} / 3 包`
      : unopenedCount > 0
        ? `还有 ${unopenedCount} 包没拆，点一下就能拆开`
        : openedCount === 3
          ? '3 包都拆完啦，点下面卡片就能再看看'
          : '去逛逛照片或给喜欢的那张留句话，还能再拿新包';

    const cta = next && data.status === 'published'
      ? btn('open:' + next.slot, '去拆' + names[next.slot] + ' ↗', 'frog-btn frog-btn-primary')
      : data.status === 'published' && slots.some(v => !v.earned)
        ? btn('browse', '去逛照片领新包 ↗', 'frog-btn frog-btn-primary')
        : '';

    return (
      `<div class="frog-layout">` +
      `<div class="foil-display is-wall">` +
      `<span class="foil-display-glow" aria-hidden="true"></span>` +
      `<figure class="frog-mascot is-wall"><img src="/assets/frog/silver-1.webp" alt="举着胶片开心大笑的奶蛙" width="220" height="220" draggable="false"></figure>` +
      `${pouch()}` +
      `<span class="foil-edition-tag" aria-hidden="true">已拆 ${openedCount} / 3 包</span>` +
      `</div>` +
      `<div class="frog-copy">` +
      `<div class="frog-eyebrow-row"><small class="frog-eyebrow">领包进度</small><div class="frog-meter" aria-hidden="true">${meter}</div></div>` +
      `<h3>我的奖品袋</h3>` +
      `<p>${subtitle}</p>` +
      `<div class="frog-slots">${rows}</div>` +
      `${cta}` +
      `</div></div>`
    );
  }

  /** 渲染进站惊喜抽奖欢迎页；已参与访客直接进入奖品袋。 */
  function render() {
    clearDeckState();
    message.textContent = data.status === 'published' && data.remaining === 0 ? '前 40 包实物大奖已经抽完啦，现在拆包还能领虚拟奶蛙小卡片～' : '';
    if (data.joined) {
      body.innerHTML = wall();
      return;
    }
    if (data.status !== 'published') {
      body.innerHTML = `<div class="frog-copy"><h3>${life[data.status]}</h3><p>惊喜抽奖这会儿还没开或者已经收摊啦</p></div>`;
      return;
    }

    const stockPill = data.remaining > 0 ? `奖池还剩 ${data.remaining} 包` : '实物奖抽完啦 · 可领虚拟奶蛙卡';
    const stepsHtml = ['welcome', 'photo', 'social'].map((slot, idx) =>
      `<li><span>0${idx + 1}</span><b>${names[slot]}</b><em>${shortHints[slot]}</em></li>`
    ).join('');

    body.innerHTML = (
      `<div class="frog-layout">` +
      `<div class="foil-display is-welcome">` +
      `<span class="foil-display-glow" aria-hidden="true"></span>` +
      `<span class="frog-hero-ribbon">免费领 3 包</span>` +
      `<figure class="frog-mascot"><img src="/assets/frog/white-2.webp" alt="比耶打招呼的奶蛙" width="220" height="220" draggable="false"></figure>` +
      `${pouch()}` +
      `</div>` +
      `<div class="frog-copy">` +
      `<div class="frog-eyebrow-row"><small class="frog-eyebrow">每人限领 3 包</small><span class="frog-stock-pill is-hot">${stockPill}</span></div>` +
      `<h3>惊喜抽奖<span>填个 QQ 马上抽一包</span></h3>` +
      `<div class="frog-prize-strip" aria-label="本期奖品一览">` +
      `<span class="frog-prize-pill prism"><i>A♢</i> 星巴克大杯太妃拿铁</span>` +
      `<span class="frog-prize-pill gold"><i>K♡</i> 奈雪杨枝甘露</span>` +
      `<span class="frog-prize-pill silver"><i>Q♤</i> 照片冰箱贴</span>` +
      `<span class="frog-prize-pill white"><i>J♧</i> 奶蛙小卡片（虚拟）</span>` +
      `</div>` +
      `<ul class="frog-steps">${stepsHtml}</ul>` +
      `<form id="frogForm"><label class="sr-only" for="frogQQ">参与 QQ</label>` +
      `<input id="frogQQ" inputmode="numeric" autocomplete="off" pattern="[1-9][0-9]{4,11}" maxlength="12" placeholder="输入你的 QQ 号" required>` +
      `<button class="frog-btn frog-btn-primary">马上领第一包 ↗</button></form>` +
      `<details class="frog-rules"><summary>活动说明</summary>` +
      `<p>前 40 包里放了 1 杯星巴克大杯太妃拿铁、2 套奈雪杨枝甘露、5 个随机照片冰箱贴和 32 张虚拟奶蛙小卡片，抽完后还能继续拆虚拟奶蛙卡留个纪念。每个 QQ 最多拆 3 包，QQ 只用来防重和中奖联系。</p>` +
      `</details>` +
      `</div></div>`
    );
  }

  /** 构建卡槽 DOM（支持 1 张展示与 2/3 张折叠牌扇布局）。 */
  function buildDeckNodes(pack, owned, count, index) {
    const card = pack.card;
    const prev = owned[(index - 1 + count) % count];
    const next = owned[(index + 1) % count];
    const side = (entry, dirSide) =>
      `<button type="button" class="foil-sibling ${dirSide}" data-slot="${entry.slot}" data-frog="switch:${entry.slot}" aria-label="查看${cardLabel(entry)}"><span class="frog-card ${entry.card.tier}">${face(entry.card)}</span></button>`;
    if (count === 1) {
      return `<article class="frog-card ${card.tier}" data-slot="${pack.slot}" aria-label="${cardLabel(pack)}">${face(card)}</article>`;
    }
    return (
      `${count > 2 ? side(prev, 'left') : ''}` +
      `${side(next, 'right')}` +
      `<button type="button" class="frog-card ${card.tier}" data-slot="${pack.slot}" data-frog="switch:${next.slot}" aria-label="${cardLabel(pack)}，下一张">${face(card)}</button>`
    );
  }

  /** 更新右侧卡牌说明区、导航按钮与序号圆点。 */
  function syncDeckCaption(captionEl, pack, index, owned) {
    const count = owned.length;
    const prev = owned[(index - 1 + count) % count];
    const next = owned[(index + 1) % count];
    const card = pack.card;
    const [, , tierName, prizeName] = tiers[card.tier];

    const eyebrow = captionEl.querySelector('.frog-eyebrow-row');
    if (eyebrow) {
      eyebrow.innerHTML =
        `<small class="frog-eyebrow">${names[pack.slot]}</small>` +
        `<span class="frog-tier-badge ${card.tier}">#${String(card.number).padStart(3, '0')} · ${tierName}</span>`;
    }
    const h3 = captionEl.querySelector('h3');
    if (h3) h3.textContent = prizeName;

    const desc = captionEl.querySelector('.frog-caption-desc');
    if (desc) desc.textContent = card.tier === 'white' ? '虚拟电子卡（无实物），抽到一只可可爱爱的奶蛙留作纪念～' : '中奖啦！我会通过你留的 QQ 联系你兑奖';

    const navEl = captionEl.querySelector('.frog-deck-nav');
    if (navEl && count > 1) {
      const prevBtn = navEl.querySelector('[data-prev]');
      const nextBtn = navEl.querySelector('[data-next]');
      const counter = navEl.querySelector('span');
      if (prevBtn) prevBtn.dataset.frog = `switch:${prev.slot}`;
      if (nextBtn) nextBtn.dataset.frog = `switch:${next.slot}`;
      if (counter) counter.textContent = `${index + 1} / ${count}`;
    }
    const dots = captionEl.querySelector('.frog-deck-dots');
    if (dots && count > 1) {
      dots.innerHTML = owned.map((entry, idx) =>
        `<button type="button" class="frog-deck-dot ${idx === index ? 'is-active' : ''}" data-frog="switch:${entry.slot}" aria-label="切换到第 ${idx + 1} 张卡"></button>`
      ).join('');
    }
  }

  /** 为展台绑定主卡 3D 指针倾角（桌面满血动效）与横向拖拽切牌手势。 */
  function attachStageInteractions(stage) {
    const cleanups = [];
    const motionFull = () => getMotionTier() === 'full' && !prefersReduced();

    // 桌面精细指针 3D 全息微倾与反光跟随
    if (finePointer.matches) {
      let rafTilt = 0, lastEvt = null;
      const onMove = e => {
        if (!motionFull() || !deckState || e.pointerType === 'touch' || deckState.dragging) return;
        const front = stage.querySelector(':scope > .frog-card');
        if (!front || !front.contains(e.target)) {
          resetTilt();
          return;
        }
        lastEvt = { x: e.clientX, y: e.clientY };
        if (rafTilt) return;
        rafTilt = requestAnimationFrame(() => {
          rafTilt = 0;
          const cardEl = stage.querySelector(':scope > .frog-card');
          if (!cardEl || !lastEvt) return;
          const r = cardEl.getBoundingClientRect();
          if (!r.width || !r.height) return;
          const nx = Math.max(-0.5, Math.min(0.5, (lastEvt.x - r.left) / r.width - 0.5));
          const ny = Math.max(-0.5, Math.min(0.5, (lastEvt.y - r.top) / r.height - 0.5));
          cardEl.style.setProperty('--rx', (-ny * 13).toFixed(2) + 'deg');
          cardEl.style.setProperty('--ry', (nx * 16).toFixed(2) + 'deg');
          cardEl.style.setProperty('--gx', (50 + nx * 70).toFixed(1) + '%');
          cardEl.style.setProperty('--gy', (50 + ny * 70).toFixed(1) + '%');
          cardEl.style.setProperty('--glare-op', '1');
        });
      };
      const resetTilt = () => {
        if (rafTilt) { cancelAnimationFrame(rafTilt); rafTilt = 0; }
        const cardEl = stage.querySelector(':scope > .frog-card');
        if (!cardEl) return;
        cardEl.style.removeProperty('--rx');
        cardEl.style.removeProperty('--ry');
        cardEl.style.removeProperty('--gx');
        cardEl.style.removeProperty('--gy');
        cardEl.style.removeProperty('--glare-op');
      };
      stage.addEventListener('pointermove', onMove, { passive: true });
      stage.addEventListener('pointerleave', resetTilt, { passive: true });
      cleanups.push(() => {
        if (rafTilt) cancelAnimationFrame(rafTilt);
        stage.removeEventListener('pointermove', onMove);
        stage.removeEventListener('pointerleave', resetTilt);
      });
    }

    // 主卡手势横向滑牌（小幅点击仍交由普通 click 顺切下一张）
    let drag = null, suppressClick = false;
    const onDown = e => {
      if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const front = stage.querySelector(':scope > button.frog-card');
      if (!front || !front.contains(e.target) || e.target.closest('.foil-sibling')) return;
      const owned = data.packs.filter(p => p.card);
      if (owned.length < 2) return;
      drag = {
        front,
        id: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        swiping: false,
        dx: 0,
        samples: [{ x: e.clientX, t: performance.now() }],
      };
    };
    const onDragMove = e => {
      if (!drag || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!drag.swiping) {
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.15) {
          drag.swiping = true;
          if (deckState) deckState.dragging = true;
          for (const anim of deckState?.anims || []) anim.cancel();
          drag.front.classList.add('is-swiping');
          try { drag.front.setPointerCapture(e.pointerId); } catch {}
        } else if (Math.abs(dy) > 18 && Math.abs(dy) > Math.abs(dx) * 1.4) {
          drag = null;
          return;
        } else {
          return;
        }
      }
      drag.dx = dx;
      drag.samples.push({ x: e.clientX, t: performance.now() });
      if (drag.samples.length > 4) drag.samples.shift();

      const tx = dx * 0.82;
      const ty = Math.min(4, Math.abs(dx) * 0.03);
      const rot = Math.max(-10, Math.min(10, dx * 0.055));
      drag.front.style.transform = `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0) rotate(${rot.toFixed(2)}deg)`;
    };
    const onDragEnd = e => {
      if (!drag || drag.id !== e.pointerId) return;
      const { front, swiping, dx, samples } = drag;
      drag = null;
      if (deckState) deckState.dragging = false;
      if (!swiping) return;

      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 60);

      let vx = 0;
      if (samples.length >= 2) {
        const dt = samples[samples.length - 1].t - samples[0].t;
        if (dt > 0) vx = (samples[samples.length - 1].x - samples[0].x) / dt;
      }

      const owned = data.packs.filter(p => p.card);
      const curIdx = owned.findIndex(p => p.slot === deckState?.slot);
      if (curIdx >= 0 && owned.length > 1 && (Math.abs(dx) >= 48 || (Math.abs(dx) >= 24 && Math.abs(vx) > 0.45))) {
        const dir = dx < 0 ? 1 : -1;
        const target = owned[(curIdx + dir + owned.length) % owned.length];
        switchDeck(target.slot, dir, '');
        return;
      }

      const currentTransform = front.style.transform;
      front.classList.remove('is-swiping');
      front.style.transform = '';
      if (!prefersReduced() && front.animate && currentTransform) {
        front.animate([{ transform: currentTransform }, { transform: 'none' }], {
          duration: 240,
          easing: 'cubic-bezier(.22, 1, .36, 1)',
        });
      }
    };
    const onClickCapture = e => {
      if (suppressClick && e.target.closest('.frog-theater > button.frog-card')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        suppressClick = false;
      }
    };

    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onDragMove);
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) stage.addEventListener(t, onDragEnd);
    stage.addEventListener('click', onClickCapture, true);
    cleanups.push(() => {
      stage.removeEventListener('pointerdown', onDown);
      stage.removeEventListener('pointermove', onDragMove);
      for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) stage.removeEventListener(t, onDragEnd);
      stage.removeEventListener('click', onClickCapture, true);
    });

    return () => cleanups.forEach(fn => fn());
  }

  /** 原地 3D 弧线切牌（FLIP 几何对齐）：无缝平滑交换主卡与侧翼位置，不重建整个弹窗。 */
  function switchDeck(targetSlot, explicitDir = 0, focusSelector = '') {
    const stage = body.querySelector('.frog-theater');
    const caption = body.querySelector('.frog-caption');
    const owned = data.packs.filter(p => p.card);
    const count = owned.length;
    if (!stage || !caption || count < 2) { screen(targetSlot, null, focusSelector); return; }

    const pack = owned.find(p => p.slot === targetSlot);
    if (!pack || deckState?.slot === targetSlot) return;

    const oldIdx = owned.findIndex(p => p.slot === deckState?.slot);
    const newIdx = owned.indexOf(pack);
    let dir = explicitDir;
    if (!dir && oldIdx >= 0) {
      dir = (newIdx - oldIdx + count) % count === count - 1 ? -1 : 1;
    }
    if (!dir) dir = 1;

    // 1. FLIP First：在取消正在执行的切牌动画前采样每张可见卡的当前实际视觉坐标与角度
    const stageRect = stage.getBoundingClientRect();
    const stageCx = stageRect.left + stageRect.width / 2;
    const stageCy = stageRect.top + stageRect.height / 2;

    const beforeBySlot = new Map();
    const frontBefore = stage.querySelector(':scope > .frog-card');
    const baseW = frontBefore ? frontBefore.getBoundingClientRect().width : stageRect.width * 0.6;

    stage.querySelectorAll(':scope > .frog-card, :scope > .foil-sibling').forEach(el => {
      const slotKey = el.dataset.slot;
      if (!slotKey) return;
      const sample = sampleTransform(el);
      beforeBySlot.set(slotKey, {
        ...sample,
        isFront: !el.classList.contains('foil-sibling'),
        wasSide: el.classList.contains('left') ? -1 : el.classList.contains('right') ? 1 : 0,
      });
    });

    // 2. 终止上一轮尚未结束的补间，清理一次性开包残留节点
    for (const anim of deckState?.anims || []) {
      try { anim.cancel(); } catch {}
    }
    if (deckState) deckState.anims = [];
    stage.classList.remove('foil-reveal');
    stage.querySelectorAll('.foil-shell, .foil-flecks').forEach(n => n.remove());

    // 3. FLIP Last：同步原地更新卡面与说明区（确保 DOM 断言与焦点即刻准确）
    const prevPack = owned[(newIdx - 1 + count) % count];
    const nextPack = owned[(newIdx + 1) % count];
    stage.dataset.tier = pack.card.tier;

    const updateCardEl = (el, targetPack, isFront, targetNext) => {
      el.dataset.slot = targetPack.slot;
      el.classList.remove('is-swiping', 'is-card-settled');
      el.style.transform = '';
      el.style.removeProperty('--rx');
      el.style.removeProperty('--ry');
      el.style.removeProperty('--glare-op');
      if (isFront) {
        el.className = `frog-card ${targetPack.card.tier}`;
        el.dataset.frog = `switch:${targetNext.slot}`;
        el.setAttribute('aria-label', `${cardLabel(targetPack)}，下一张`);
        el.innerHTML = face(targetPack.card);
      } else {
        el.dataset.frog = `switch:${targetPack.slot}`;
        el.setAttribute('aria-label', `查看${cardLabel(targetPack)}`);
        const inner = el.querySelector('.frog-card');
        if (inner) {
          inner.className = `frog-card ${targetPack.card.tier}`;
          inner.innerHTML = face(targetPack.card);
        }
      }
    };

    const frontEl = stage.querySelector(':scope > button.frog-card');
    const rightEl = stage.querySelector(':scope > .foil-sibling.right');
    const leftEl = stage.querySelector(':scope > .foil-sibling.left');
    if (!frontEl || !rightEl || (count > 2 && !leftEl)) {
      screen(targetSlot, null, focusSelector);
      return;
    }

    if (leftEl && count > 2) updateCardEl(leftEl, prevPack, false);
    updateCardEl(rightEl, nextPack, false);
    updateCardEl(frontEl, pack, true, nextPack);

    syncDeckCaption(caption, pack, newIdx, owned);
    deckState.slot = targetSlot;

    const focusEl = body.querySelector(focusSelector || '.frog-theater > button.frog-card');
    focusEl?.focus({ preventScroll: true });

    // 4. FLIP Invert + Play：在统一舞台中心坐标系下播放丝滑同步弧线过渡
    if (prefersReduced() || !frontEl.animate || !baseW) return;

    const tier = getMotionTier();
    const duration = tier === 'full' ? 380 : 230;
    const easing = 'cubic-bezier(.22, 1, .36, 1)';
    const endFrontW = frontEl.getBoundingClientRect().width || baseW;

    const anims = [];
    const animateSlot = (el, slotKey, role) => {
      const targetAngle = role === 'left' ? -12 : role === 'right' ? 12 : 0;
      const targetScale = role === 'front' ? 1 : 0.79;
      const targetShift = role === 'left' ? -0.41 * endFrontW : role === 'right' ? 0.41 * endFrontW : 0;
      const endTf = `translate3d(${targetShift.toFixed(2)}px, 0px, 0) rotate(${targetAngle}deg) scale(${targetScale})`;

      const prev = beforeBySlot.get(slotKey);
      if (!prev) {
        const anim = el.animate([
          { opacity: 0, transform: `translate3d(${(dir * 0.45 * endFrontW).toFixed(1)}px, 0px, 0) rotate(${dir * 12}deg) scale(0.75)` },
          { opacity: role === 'front' ? 1 : 0.92, transform: endTf },
        ], { duration, easing });
        anims.push(anim);
        return;
      }

      const startDx = prev.cx - stageCx;
      const startDy = role === 'front' ? 0 : prev.cy - stageCy;
      const startScale = prev.scale;
      const startAngle = prev.angle;
      const startTf = `translate3d(${startDx.toFixed(2)}px, ${startDy.toFixed(2)}px, 0) rotate(${startAngle.toFixed(2)}deg) scale(${startScale.toFixed(4)})`;

      // 当 3 张卡里非主卡从左翼经背面绕行至右翼（或反之），让其稳妥贴着牌底浅弧绕背换位
      const wrappingAround = role !== 'front' && prev.wasSide !== 0 && ((role === 'left' && prev.wasSide === 1) || (role === 'right' && prev.wasSide === -1));
      if (wrappingAround) {
        const midTf = `translate3d(0px, 6px, 0) rotate(0deg) scale(0.68)`;
        const anim = el.animate([
          { transform: startTf, opacity: 0.92, offset: 0 },
          { transform: midTf, opacity: 0.42, offset: 0.5 },
          { transform: endTf, opacity: 0.92, offset: 1 },
        ], { duration, easing });
        anims.push(anim);
        return;
      }

      const anim = el.animate([
        { transform: startTf, opacity: prev.isFront ? 1 : 0.92 },
        { transform: endTf, opacity: role === 'front' ? 1 : 0.92 },
      ], { duration, easing });
      anims.push(anim);
    };

    animateSlot(frontEl, pack.slot, 'front');
    animateSlot(rightEl, nextPack.slot, 'right');
    if (leftEl && count > 2) animateSlot(leftEl, prevPack.slot, 'left');

    // 右侧标题与描述流畅微幅滑入
    const captionCopy = caption.querySelector('.frog-caption-body');
    if (captionCopy?.animate) {
      anims.push(captionCopy.animate([
        { opacity: 0.42, transform: `translateX(${(dir * 10).toFixed(0)}px)` },
        { opacity: 1, transform: 'none' },
      ], { duration: tier === 'full' ? 250 : 170, easing }));
    }

    if (tier === 'full') {
      const shimmer = () => frontEl.classList.add('is-card-settled');
      anims[0]?.finished?.then(shimmer, () => {});
    }

    deckState.anims = anims;
    for (const anim of anims) {
      anim.finished?.finally(() => {
        if (!deckState) return;
        deckState.anims = deckState.anims.filter(a => a !== anim);
      });
    }
  }

  /** 渲染拆包页（未拆）或卡牌展示展台（已拆）。 */
  function screen(slot, torn = null, focusSelector = '') {
    clearDeckState();
    const pack = data.packs.find(p => p.slot === slot);
    if (!pack?.earned) return;

    const card = pack.card;
    const opened = !!torn;
    const owned = data.packs.filter(p => p.card);
    const count = owned.length;
    const index = owned.indexOf(pack);
    const prev = owned[(index - 1 + count) % count];
    const next = owned[(index + 1) % count];
    message.textContent = '';

    let deck = `<button type="button" class="frog-tear" data-frog="tear:${slot}" aria-label="撕开${names[slot]}">${tearPouch()}</button>`;
    let nav = '';
    let dots = '';

    if (card) {
      deck = buildDeckNodes(pack, owned, count, index);
      if (count > 1) {
        nav = `<div class="frog-deck-nav"><button type="button" data-prev data-frog="switch:${prev.slot}" aria-label="上一张卡">‹</button><span>${index + 1} / ${count}</span><button type="button" data-next data-frog="switch:${next.slot}" aria-label="下一张卡">›</button></div>`;
        dots = `<div class="frog-deck-dots" aria-hidden="true">${owned.map((entry, idx) =>
          `<button type="button" class="frog-deck-dot ${idx === index ? 'is-active' : ''}" data-frog="switch:${entry.slot}" aria-label="切换到第 ${idx + 1} 张卡"></button>`
        ).join('')}</div>`;
      }
    }

    const tierAttr = card ? `data-tier="${card.tier}"` : '';
    const eyebrowHtml = card
      ? `<small class="frog-eyebrow">${names[slot]}</small><span class="frog-tier-badge ${card.tier}">#${String(card.number).padStart(3, '0')} · ${tiers[card.tier][2]}</span>`
      : `<small class="frog-eyebrow">${names[slot]}</small>`;

    body.innerHTML = (
      `<div class="frog-opening" data-mode="${card ? 'deck' : 'tear'}">` +
      `<div class="frog-theater ${opened ? 'foil-reveal' : ''}" ${tierAttr}>${deck}</div>` +
      `<div class="frog-caption">` +
      `<div class="frog-caption-body">` +
      `<div class="frog-eyebrow-row">${eyebrowHtml}</div>` +
      `<h3>${card ? tiers[card.tier][3] : '撕开看看抽中了啥'}</h3>` +
      `<p class="frog-caption-desc">${card ? (card.tier === 'white' ? '虚拟电子卡（无实物），抽到一只可可爱爱的奶蛙留作纪念～' : '中奖啦！我会通过你留的 QQ 联系你兑奖') : '横着滑开顶上的撕口，或者直接点一下拆包'}</p>` +
      `</div>` +
      `${nav}${dots}` +
      `${btn('wall', card ? '回到我的奖品袋' : '返回', 'frog-link')}` +
      `</div></div>`
    );

    if (card) {
      const stage = body.querySelector('.frog-theater');
      if (count > 1) bindDeckTap(stage);
      const cleanup = attachStageInteractions(stage);
      deckState = { slot, anims: [], cleanup, dragging: false };

      if (torn) {
        const shell = document.createElement('div');
        shell.className = 'foil-shell';
        shell.dataset.tier = card.tier;
        shell.setAttribute('aria-hidden', 'true');
        shell.append(torn);
        stage.append(shell);
      }

      if (opened && getMotionTier() === 'full' && !prefersReduced()) {
        const sparks = document.createElement('span');
        sparks.className = 'foil-flecks';
        sparks.dataset.tier = card.tier;
        sparks.setAttribute('aria-hidden', 'true');
        const totalFlecks = 18;
        for (let i = 0; i < totalFlecks; i++) {
          const fleck = document.createElement('i');
          const angle = -Math.PI * 0.92 + (i / (totalFlecks - 1)) * Math.PI * 0.84 + ((i % 3) - 1) * 0.14;
          const dist = 56 + ((i * 29) % 86);
          const dx = Math.round(Math.cos(angle) * dist);
          const dy = Math.round(Math.sin(angle) * dist * 0.82 - 14);
          fleck.style.setProperty('--dx', `${dx}px`);
          fleck.style.setProperty('--dy', `${dy}px`);
          fleck.style.setProperty('--spin', `${(i % 2 ? 1 : -1) * (90 + i * 37)}deg`);
          fleck.style.setProperty('--delay', `${(i % 5) * 28}ms`);
          fleck.style.setProperty('--scale', `${(0.75 + (i % 4) * 0.22).toFixed(2)}`);
          sparks.append(fleck);
        }
        stage.append(sparks);
      }
    }

    body.querySelector(focusSelector || (!card ? '.frog-tear' : count > 1 ? '.frog-theater > button.frog-card' : '.frog-link'))?.focus({ preventScroll: true });
  }

  async function refresh() {
    const id = ++version;
    message.textContent = '正在打开奖品袋…';
    try {
      await visiting;
      const next = await call('');
      if (id !== version) return;
      remember(next);
      render();
    } catch (e) {
      if (id === version) {
        message.textContent = e.message;
        body.innerHTML = btn('reload', '重新加载');
      }
    }
  }

  function open() {
    flag();
    modal.hidden = false;
    body.replaceChildren();
    refresh();
  }

  async function draw(button, fromDrag) {
    if (busy || modal.hidden) return;
    const id = version;
    const slot = button.dataset.frog.split(':')[1];
    const torn = button.querySelector('.foil-pouch');
    busy = true;
    button.dataset.opening = '1';
    torn?.classList.add('is-developing');
    body.querySelector('.frog-link').disabled = true;
    message.textContent = '拆包中…';
    try {
      const [next] = await Promise.all([call('/draw', { slot }), finishTear(button, fromDrag)]);
      if (id !== version) return;
      remember(next);
      screen(slot, torn);
    } catch (e) {
      if (id === version) {
        message.textContent = e.message;
        body.innerHTML = btn('reload', '回到我的奖品袋');
      }
    } finally {
      busy = false;
    }
  }

  async function announce() {
    // 禁用存储导致无法持久化“已读告示”标记时，不自动弹窗打断画廊浏览，访客仍可从活动入口手动打开。
    try { if (sessionStorage.getItem(seenKey)) return; } catch { return; }
    if (location.hash || document.hidden) return;
    const id = version;
    try {
      const next = await call('');
      if (
        id !== version || announced || next.status !== 'published' || document.hidden || location.hash ||
        document.querySelector('[aria-modal="true"]:not([hidden]):not(#lightbox)') ||
        document.documentElement.dataset.dialogOpen === 'true'
      ) return;
      remember(next);
      flag();
      modal.hidden = false;
      render();
    } catch { /* 活动状态未拉取成功时静默降级，不阻断相册主体浏览。 */ }
  }

  async function admin(op = 'list', number) {
    const box = $('#frogAdminBody'), note = $('#frogAdminMessage');
    note.textContent = '正在读取中奖名单…';
    try {
      const res = await call('/admin', { ...auth(), action: op, number });
      note.textContent = '';
      box.innerHTML = `<p>${life[res.status]} · 已拆 ${res.rows.length} 包 · 奖池还剩 ${res.remaining} 包</p>${res.status === 'published' ? btn('pause', '暂停') : res.status === 'paused' ? btn('publish', '重新发布') : ''}${res.status !== 'ended' ? btn('ask-end', '结束并留档') : ''}<ol class="frog-records">${res.rows.map(r => `<li>#${r.number} · ${tiers[r.tier][2]} · QQ ${r.qq} ${r.tier === 'white' ? '' : r.claimed ? '已兑付' : btn('claim:' + r.number, '标记已兑付')}</li>`).join('')}</ol>`;
    } catch (e) {
      box.replaceChildren();
      note.textContent = e.message;
    }
  }

  function credit(slot, action, payload) {
    if (!active || data?.packs.find(v => v.slot === slot)?.earned) return;
    visiting = visiting.then(async () => {
      if (!active || data?.packs.find(v => v.slot === slot)?.earned) return;
      const next = await call(action, payload);
      remember(next);
      if (next.packs.find(v => v.slot === slot)?.earned) toast(`叮！多拿到一包「${names[slot]}」，点右下角去拆吧`);
    }).catch(() => { toast('刚刚那包没领到，刷新或点开我的抽奖试试'); });
  }

  return {
    close,
    photo(key) { credit('photo', '/photo', { key }); },
    social() { credit('social', '', undefined); },
    init() {
      const notice = document.createElement('div');
      notice.id = 'frogToast';
      notice.setAttribute('role', 'status');
      notice.hidden = true;
      document.body.append(notice);

      $('#frogReturn').hidden = !active;
      $('#frogOpen').onclick = $('#frogReturn').onclick = open;
      $('#frogClose').onclick = close;

      modal.addEventListener('click', e => {
        if (e.target === modal) return close();
        const el = e.target.closest('[data-frog]');
        if (!el) return;
        const [op, slot] = el.dataset.frog.split(':');
        if (op === 'wall') render();
        if (op === 'reload') refresh();
        if (op === 'open' || op === 'show') screen(slot);
        if (op === 'switch') {
          const focusSel = el.hasAttribute('data-prev') ? '[data-prev]' : el.hasAttribute('data-next') ? '[data-next]' : '';
          const explicitDir = el.classList.contains('left') || el.hasAttribute('data-prev')
            ? -1
            : el.classList.contains('right') || el.hasAttribute('data-next') || el.classList.contains('frog-card')
              ? 1
              : 0;
          switchDeck(slot, explicitDir, focusSel);
        }
        if (op === 'browse') {
          close();
          if (!$('#groupPage').hidden) $('#gpBack').click();
          else $('#galleryTitle').scrollIntoView({ block: 'start' });
        }
      });

      modal.addEventListener('keydown', e => {
        if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
        const arrow = body.querySelector(e.key === 'ArrowLeft' ? '[data-prev]' : '[data-next]');
        if (arrow) {
          e.preventDefault();
          arrow.click();
        }
      });

      body.addEventListener('submit', async e => {
        e.preventDefault();
        const id = version, form = e.target;
        form.querySelector('button').disabled = true;
        try {
          const next = await call('/join', { qq: $('#frogQQ').value.trim() });
          remember(next);
          if (id === version) {
            render();
            screen('welcome');
          }
        } catch (err) {
          if (id === version) {
            message.textContent = err.message;
            form.querySelector('button').disabled = false;
          }
        }
      });

      bindTear(body, draw);

      $('#frogAdminRefresh').onclick = () => admin();
      document.querySelector('[data-tab="raffle"]').onclick = () => admin();
      $('#frogAdminBody').onclick = e => {
        const el = e.target.closest('[data-frog]');
        if (!el) return;
        const [op, num] = el.dataset.frog.split(':');
        if (op === 'ask-end') {
          el.outerHTML = btn('end', '确认永久结束') + btn('list', '取消');
          return;
        }
        el.disabled = true;
        admin(op, num ? Number(num) : undefined);
      };

      announce();
    },
  };
}
