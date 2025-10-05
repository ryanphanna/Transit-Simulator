(function (g) {
  const TS = g.TS = g.TS || {};
  const { GRID } = TS;
  const { mulberry32 } = TS;
  TS.generateLandUse = function (seed) {
    const rngPop = mulberry32(seed * 101), rngJobs = mulberry32(seed * 701);
    const pop = Array.from({ length: GRID }, () => Array(GRID).fill(0));
    const jobs = Array.from({ length: GRID }, () => Array(GRID).fill(0));
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
      const a = rngPop(), b = rngPop();
      const cx = (x - GRID / 2) / (GRID / 2), cy = (y - GRID / 2) / (GRID / 2);
      const centerBias = Math.exp(-(cx * cx + cy * cy) * 1.2);
      pop[y][x] = Math.floor(Math.min(3.2, (a * 0.6 + b * 0.4) * 0.5 + 0.5 * centerBias) * 3.2);
      const aj = rngJobs(), bj = rngJobs();
      const ringBias = Math.exp(-Math.pow(((cx * cx + cy * cy) - 0.25), 2) * 2);
      jobs[y][x] = Math.floor(Math.min(3.2, (aj * 0.5 + bj * 0.5) * 0.5 + 0.5 * ringBias) * 3.2);
    }
    return { pop, jobs };
  };
})(window);
