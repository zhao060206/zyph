const grip = event => event.target.closest('.frog-tear');
const tearStates = new WeakMap();
const SPARK_MARKS = [0.18, 0.36, 0.54, 0.72, 0.9];

const isReducedMotion = () =>
  document.documentElement.dataset.motion === 'none' ||
  matchMedia('(prefers-reduced-motion: reduce)').matches;

const isFullMotion = () =>
  document.documentElement.dataset.motion === 'full' &&
  !matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 同步更新卡包撕拉进度、水平/垂直张力偏移与表面反光 CSS 变量。 */
function applyVisual(pouch, progress, pullX = 0, pullY = 0) {
  const clamped = Math.max(0, Math.min(1, progress));
  pouch.style.setProperty('--tear', clamped.toFixed(3));
  pouch.style.setProperty('--pull-x', pullX.toFixed(3));
  pouch.style.setProperty('--pull-y', pullY.toFixed(3));
  pouch.style.setProperty('--sheen', (0.18 + clamped * 0.72 + pullX * 0.1).toFixed(3));
}

function getState(button) {
  let state = tearStates.get(button);
  if (!state) {
    state = { raf: 0, progress: 0, dir: 1, pullX: 0, pullY: 0, sparkStep: -1 };
    tearStates.set(button, state);
  }
  return state;
}

function stopAnimation(state) {
  if (state.raf) {
    cancelAnimationFrame(state.raf);
    state.raf = 0;
  }
}

/** 沿当前撕口坐标生成微型一次性箔屑闪光粒子。 */
function emitSpark(pouch, progress, dir) {
  if (!isFullMotion() || document.hidden) return;
  const active = pouch.querySelectorAll('.foil-spark');
  if (active.length >= 6) active[0].remove();

  const spark = document.createElement('i');
  spark.className = 'foil-spark';
  spark.setAttribute('aria-hidden', 'true');
  const seamX = dir < 0 ? 100 - progress * 100 : progress * 100;
  const sx = ((Math.random() - 0.5) * 18 + dir * 10).toFixed(1) + 'px';
  const sy = (-10 - Math.random() * 18).toFixed(1) + 'px';
  const sr = Math.round((Math.random() - 0.5) * 200) + 'deg';
  spark.style.left = `clamp(4%, ${seamX.toFixed(1)}%, 96%)`;
  spark.style.setProperty('--sx', sx);
  spark.style.setProperty('--sy', sy);
  spark.style.setProperty('--sr', sr);
  pouch.append(spark);

  const cleanup = () => spark.remove();
  spark.addEventListener('animationend', cleanup, { once: true });
  setTimeout(cleanup, 460);
}

/** 二阶欠阻尼弹簧物理回弹：松手未达撕开阈值时将封口与卡包姿态丝滑弹回。 */
function springBack(button, pouch, state) {
  stopAnimation(state);
  if (isReducedMotion() || document.hidden || state.progress <= 0.002) {
    state.progress = state.pullX = state.pullY = 0;
    state.sparkStep = -1;
    pouch.classList.remove('is-tearing', 'is-snapping', 'pull-left');
    applyVisual(pouch, 0, 0, 0);
    return;
  }

  pouch.classList.remove('is-tearing');
  pouch.classList.add('is-snapping');
  let x = state.progress, vx = 0;
  let px = state.pullX, vpx = 0;
  let py = state.pullY, vpy = 0;
  let last = performance.now();
  const stiffness = 380, damping = 26;

  const step = now => {
    if (!button.isConnected || button.dataset.opening || document.hidden) {
      state.raf = 0;
      pouch.classList.remove('is-snapping');
      return;
    }
    const dt = Math.min(0.032, Math.max(0.004, (now - last) / 1000));
    last = now;

    const ax = -stiffness * x - damping * vx;
    vx += ax * dt;
    x = Math.max(0, x + vx * dt);
    if (x === 0 && vx < 0) vx = 0;

    const apx = -stiffness * px - damping * vpx;
    vpx += apx * dt;
    px += vpx * dt;

    const apy = -stiffness * py - damping * vpy;
    vpy += apy * dt;
    py += vpy * dt;

    state.progress = x;
    state.pullX = px;
    state.pullY = py;
    applyVisual(pouch, x, px, py);

    const settled = x < 0.003 && Math.abs(vx) < 0.02 && Math.abs(px) < 0.005 && Math.abs(py) < 0.005;
    if (settled) {
      state.raf = 0;
      state.progress = state.pullX = state.pullY = 0;
      state.sparkStep = -1;
      pouch.classList.remove('is-snapping', 'pull-left');
      applyVisual(pouch, 0, 0, 0);
      return;
    }
    state.raf = requestAnimationFrame(step);
  };
  state.raf = requestAnimationFrame(step);
}

/** 绑定卡包横向撕拉手势、速度惯性判别、弹簧回弹与无障碍点击/键盘触发。 */
export function bindTear(root, commit) {
  let pull = null, skipClick = null;

  root.addEventListener('pointerdown', event => {
    const button = grip(event);
    if (!button || button.dataset.opening || !event.isPrimary || event.button !== 0) return;
    const pouch = button.querySelector('.foil-pouch');
    if (!pouch) return;
    const state = getState(button);
    stopAnimation(state);
    pouch.classList.remove('is-snapping');
    pouch.classList.add('is-tearing');
    state.sparkStep = -1;
    skipClick = null;

    const rect = button.getBoundingClientRect();
    pull = {
      button,
      pouch,
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      span: Math.max(1, rect.width * 0.62),
      progress: 0,
      pullX: 0,
      pullY: 0,
      dir: 1,
      moved: false,
      samples: [{ x: event.clientX, t: performance.now() }],
    };
    button.setPointerCapture(event.pointerId);
  });

  const update = event => {
    const dx = event.clientX - pull.x;
    const dy = event.clientY - pull.y;
    const now = performance.now();
    if (Math.abs(dx) > 5 || Math.abs(dy) > 8) pull.moved = true;

    pull.samples.push({ x: event.clientX, t: now });
    if (pull.samples.length > 4) pull.samples.shift();

    pull.progress = Math.min(1, Math.abs(dx) / pull.span);
    pull.dir = dx < 0 ? -1 : 1;
    pull.pullX = Math.tanh(dx / (pull.span * 0.92));
    pull.pullY = Math.tanh(dy / 96);

    pull.pouch.classList.toggle('pull-left', dx < 0);
    applyVisual(pull.pouch, pull.progress, pull.pullX, pull.pullY);

    const state = getState(pull.button);
    state.progress = pull.progress;
    state.dir = pull.dir;
    state.pullX = pull.pullX;
    state.pullY = pull.pullY;

    const markIndex = SPARK_MARKS.findIndex((m, idx) => idx > state.sparkStep && pull.progress >= m);
    if (markIndex !== -1) {
      state.sparkStep = markIndex;
      if (isFullMotion() && navigator.vibrate) try { navigator.vibrate(5); } catch {}
      emitSpark(pull.pouch, pull.progress, pull.dir);
    }
  };

  root.addEventListener('pointermove', event => {
    if (pull?.id === event.pointerId) update(event);
  });

  function release(event) {
    if (pull?.id !== event.pointerId) return;
    const up = event.type === 'pointerup';
    if (up) update(event);
    const { button, pouch, progress, moved, samples, dir, pullX, pullY } = pull;
    pull = null;
    if (moved || !up) skipClick = button;

    let vx = 0, elapsed = 0;
    if (samples.length >= 2) {
      const first = samples[0], last = samples[samples.length - 1];
      elapsed = last.t - first.t;
      if (elapsed > 0) vx = (last.x - first.x) / elapsed;
    }

    const state = getState(button);
    state.progress = progress;
    state.dir = dir;
    state.pullX = pullX;
    state.pullY = pullY;

    const shouldCommit = up && (
      progress >= 0.74 ||
      (progress >= 0.58 && samples.length >= 4 && elapsed >= 45 && elapsed <= 260 && Math.abs(vx) > 1.2)
    );

    if (shouldCommit) {
      pouch.classList.remove('is-tearing', 'is-snapping');
      commit(button, true);
    } else {
      springBack(button, pouch, state);
    }
  }

  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    root.addEventListener(type, release);
  }

  root.addEventListener('click', event => {
    const button = grip(event);
    if (!button) return;
    if (event.detail !== 0 && skipClick === button) {
      skipClick = null;
      return;
    }
    commit(button, false);
  });
}

/** 完成拆袋终段：手势顺势拉断续撕，或点击/键盘触发三段式拟真撕包节奏。 */
export function finishTear(button, fromDrag) {
  const pouch = button.querySelector('.foil-pouch');
  if (!pouch) return Promise.resolve();
  const state = getState(button);
  stopAnimation(state);
  pouch.classList.remove('is-snapping');
  pouch.classList.add('is-tearing');

  const tier = document.documentElement.dataset.motion;
  if (isReducedMotion() || document.hidden) {
    applyVisual(pouch, 1, (state.dir || 1) * 0.45, -0.2);
    pouch.classList.remove('is-tearing');
    return Promise.resolve();
  }

  if (fromDrag) {
    const startP = state.progress;
    const dir = state.dir || (pouch.classList.contains('pull-left') ? -1 : 1);
    const startX = state.pullX, startY = state.pullY;
    pouch.classList.toggle('pull-left', dir < 0);
    if (startP >= 0.985) {
      applyVisual(pouch, 1, dir * 0.65, startY * 0.5);
      pouch.classList.remove('is-tearing');
      return Promise.resolve();
    }
    const duration = Math.round((1 - startP) * 280 + 70);
    const start = performance.now();
    return new Promise(resolve => {
      const frame = now => {
        if (!button.isConnected || document.hidden) {
          applyVisual(pouch, 1, dir * 0.65, 0);
          pouch.classList.remove('is-tearing');
          resolve();
          return;
        }
        const u = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - u, 3);
        const p = startP + (1 - startP) * eased;
        applyVisual(pouch, p, startX + (dir * 0.72 - startX) * eased, startY * (1 - eased * 0.6));
        if (u < 1) {
          state.raf = requestAnimationFrame(frame);
        } else {
          state.raf = 0;
          state.progress = 1;
          pouch.classList.remove('is-tearing');
          resolve();
        }
      };
      state.raf = requestAnimationFrame(frame);
    });
  }

  // 单击/键盘触发的三段式拟真节奏：起手撕开口 -> 中段畅快拉通 -> 末端利落拉断
  const duration = tier === 'full' ? 460 : 220;
  const start = performance.now();
  let autoStep = -1;
  pouch.classList.remove('pull-left');

  return new Promise(resolve => {
    const frame = now => {
      if (!button.isConnected || document.hidden) {
        applyVisual(pouch, 1, 0.6, -0.15);
        pouch.classList.remove('is-tearing');
        resolve();
        return;
      }
      const u = Math.min(1, (now - start) / duration);
      let p;
      if (u < 0.22) {
        const local = u / 0.22;
        p = 0.14 * (local * local * (3 - 2 * local));
      } else if (u < 0.86) {
        const local = (u - 0.22) / 0.64;
        p = 0.14 + 0.81 * (1 - Math.pow(1 - local, 2.1));
      } else {
        const local = (u - 0.86) / 0.14;
        p = 0.95 + 0.05 * (1 - Math.pow(1 - local, 2));
      }
      const tiltX = Math.sin(u * Math.PI) * 0.72;
      const tiltY = -Math.sin(u * Math.PI) * 0.22;
      applyVisual(pouch, p, tiltX, tiltY);

      if (tier === 'full') {
        const stepMarks = [0.24, 0.54, 0.84];
        const nextMark = stepMarks.findIndex((m, idx) => idx > autoStep && p >= m);
        if (nextMark !== -1) {
          autoStep = nextMark;
          emitSpark(pouch, p, 1);
        }
      }

      if (u < 1) {
        state.raf = requestAnimationFrame(frame);
      } else {
        state.raf = 0;
        state.progress = 1;
        state.dir = 1;
        pouch.classList.remove('is-tearing');
        resolve();
      }
    };
    state.raf = requestAnimationFrame(frame);
  });
}
