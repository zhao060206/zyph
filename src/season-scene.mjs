export function seasonBudget(kind, width) {
  const mobile = width < 760;
  return {
    count: kind === 'summer' ? mobile ? 12 : 18 : kind === 'winter' ? mobile ? 30 : 54 : mobile ? 24 : 42,
    pileLimit: mobile ? 48 : 96,
    minSize: kind === 'summer' ? 2 : kind === 'winter' ? mobile ? 10 : 12 : kind === 'autumn' ? mobile ? 24 : 30 : mobile ? 20 : 26,
    maxSize: kind === 'summer' ? 5 : kind === 'winter' ? mobile ? 22 : 28 : kind === 'autumn' ? mobile ? 46 : 58 : mobile ? 38 : 48,
  };
}

export function createSeasonScene(kind, width, height, random = Math.random) {
  const budget = seasonBudget(kind, width);
  const scene = { kind, width, height, random, budget, particles: [], deposits: [] };
  for (let index = 0; index < budget.count; index++) {
    const crystal = kind === 'winter' && index % 5 === 0;
    const size = (budget.minSize + random() * (budget.maxSize - budget.minSize)) * (crystal ? 1.65 : 1);
    scene.particles.push({ x: random() * width, y: index < 2 ? height - size * 1.3 : random() * height,
      size, phase: random() * Math.PI * 2, spin: random() * 2 - 1, sprite: crystal ? 3 + Math.floor(index / 5) % 2 : index % 3,
      speed: kind === 'summer' ? 9 + random() * 12 : kind === 'winter' ? 28 + random() * 32 : 38 + random() * 36,
      alpha: .7 + random() * .25 });
  }
  return scene;
}

export function depositOpacity(deposit) {
  const progress = Math.max(0, Math.min(1, (deposit.age - deposit.hold) / deposit.fade));
  return deposit.alpha * (1 - progress * progress * (3 - 2 * progress));
}

export function particlePose(particle, time) {
  return { rotation: particle.phase + Math.sin(time * .65 + particle.phase) * .7 + time * particle.spin * .13,
    flatten: .4 + Math.abs(Math.sin(time * .9 + particle.phase)) * .6 };
}

export function depositPose(deposit) {
  const settle = Math.min(1, deposit.age / .85);
  const eased = settle * settle * (3 - 2 * settle);
  return { rotation: deposit.rotation + deposit.restTurn * eased,
    flatten: deposit.flatten + (.48 - deposit.flatten) * eased };
}

export function stepSeasonScene(scene, delta, time, quality = 1, edgeOnly = false) {
  const pileLimit = Math.floor(scene.budget.pileLimit * quality);
  for (let index = scene.deposits.length - 1; index >= 0; index--) {
    const deposit = scene.deposits[index];
    deposit.age += delta;
    if (deposit.age >= deposit.hold + deposit.fade) scene.deposits.splice(index, 1);
  }
  if (scene.deposits.length > pileLimit) scene.deposits.splice(0, scene.deposits.length - pileLimit);
  const count = Math.floor(scene.particles.length * quality);
  for (let index = 0; index < count; index++) {
    const particle = scene.particles[index];
    particle.y += particle.speed * delta;
    particle.x += (Math.sin(time * .65 + particle.phase) * 17 + (scene.kind === 'autumn' ? 8 : 3)) * delta;
    if (particle.x < -particle.size) particle.x = scene.width + particle.size;
    if (particle.x > scene.width + particle.size) particle.x = -particle.size;
    // Only particles close enough to touch the highest possible pile need collision work.
    if (particle.y < scene.height - 32 - particle.size * .2) continue;
    const x = Math.max(particle.size * .25, Math.min(scene.width - particle.size * .25, particle.x));
    let neighbours = 0;
    for (const item of scene.deposits) {
      if (Math.abs(item.x * scene.width - x) < particle.size * .65 && depositOpacity(item) > .1 && ++neighbours === 9) break;
    }
    const floor = 6 + particle.size * .2 + Math.min(26, neighbours * 3);
    if (particle.y >= scene.height - floor) {
      if (scene.kind !== 'summer') {
        if (scene.deposits.length === pileLimit) scene.deposits.shift();
        scene.deposits.push({ x: x / scene.width, floor,
          size: particle.size, sprite: particle.sprite, rotation: particlePose(particle, time).rotation, flatten: particlePose(particle, time).flatten, restTurn: (scene.random() - .5) * .35,
          alpha: particle.alpha, age: 0, hold: 6 + scene.random() * 4, fade: 18 + scene.random() * 10 });
      }
      particle.y = -particle.size;
      const edge = Math.min(72, scene.width * .12);
      particle.x = edgeOnly ? scene.random() < .5 ? scene.random() * edge : scene.width - scene.random() * edge : scene.random() * scene.width;
    }
  }
}

export function resizeSeasonScene(scene, width, height) {
  const replacement = createSeasonScene(scene.kind, width, height, scene.random);
  scene.particles.forEach((particle, index) => {
    if (!replacement.particles[index]) return;
    replacement.particles[index].x = particle.x / scene.width * width;
    replacement.particles[index].y = particle.y / scene.height * height;
  });
  replacement.deposits = scene.deposits.slice(-replacement.budget.pileLimit);
  return replacement;
}
