(function (g) {
  const TS = g.TS = g.TS || {};
  const { GRID, AIRPORT_POP_THRESHOLD, POI_TYPES } = TS;
  const { clamp, mulberry32 } = TS;
  const POI_WEIGHTS = {
    retail: 55,
    school: 20,
    tourism: 25,
    healthcare: 30,
    zoo: 15,
  };
  const iconFor = key => POI_TYPES.find(p => p.key === key)?.icon || '';
  const boostFor = key => POI_TYPES.find(p => p.key === key)?.jobsBoost || 0;
  const availableTypes = (population) => POI_TYPES.filter(p => p.key !== 'airport' && (!p.minPopulation || population >= p.minPopulation));
  const pickType = (population, randomFn) => {
    const rand = typeof randomFn === 'function' ? randomFn : Math.random;
    const available = availableTypes(population);
    if (!available.length) return 'retail';
    const totalWeight = available.reduce((sum, type) => sum + (POI_WEIGHTS[type.key] || 1), 0);
    let roll = rand() * totalWeight;
    for (const type of available) {
      roll -= (POI_WEIGHTS[type.key] || 1);
      if (roll <= 0) return type.key;
    }
    return available[available.length - 1].key;
  };
  TS.poiIcon = function (key) { return iconFor(key); };
  TS.poiJobsBoost = function (key) { return boostFor(key); };
  TS.pickPOIType = function (population, randomFn) { return pickType(population, randomFn); };
  TS.generatePOIs = function (seed, population) {
    const rng = mulberry32(seed * 999);
    const count = Math.round(GRID * GRID * 0.055);
    const poiMap = new Map();
    const downtown = { x: Math.floor(GRID / 2), y: Math.floor(GRID / 2) };
    const sat1 = { x: Math.floor(GRID * 0.25), y: Math.floor(GRID * 0.3) };
    const sat2 = { x: Math.floor(GRID * 0.75), y: Math.floor(GRID * 0.7) };

    function placeNear(center, share) {
      const n = Math.round(count * share);
      for (let i = 0; i < n; i++) {
        const dx = Math.round((rng() - 0.5) * 6), dy = Math.round((rng() - 0.5) * 6);
        const x = clamp(center.x + dx, 0, GRID - 1), y = clamp(center.y + dy, 0, GRID - 1);
        const key = `${x},${y}`;
        if (!poiMap.has(key)) poiMap.set(key, pickType(population, rng));
      }
    }
    function placeRandom(share) {
      const n = Math.round(count * share);
      for (let i = 0; i < n; i++) {
        const x = Math.floor(rng() * GRID), y = Math.floor(rng() * GRID);
        const key = `${x},${y}`;
        if (!poiMap.has(key)) poiMap.set(key, pickType(population, rng));
      }
    }

    placeNear(downtown, 0.55);
    placeNear(sat1, 0.15);
    placeNear(sat2, 0.1);
    placeRandom(0.2);
    if (population >= AIRPORT_POP_THRESHOLD) {
      const edge = rng() < 0.5 ? { x: GRID - 2, y: Math.floor(GRID * 0.2) } : { x: 1, y: Math.floor(GRID * 0.8) };
      poiMap.set(`${edge.x},${edge.y}`, 'airport');
    }
    return poiMap;
  };
})(window);
