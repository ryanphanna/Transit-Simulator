(function (g) {
  const TS = g.TS = g.TS || {};
  const {
    VEHICLE_CAPACITY, VEHICLE_SPEED_BASE, TURNAROUND_MIN,
    BASE_DEMAND_PER_CELL_PER_HOUR, JOB_ATTRACTION_PER_CELL,
    WALK_DECAY, FARE_REF, FARE_ELASTICITY, WAIT_TIME_SENSITIVITY,
    SUBSIDY_PER_BOARDING, RESIDUAL_GAP_SHARE, START_POP
  } = TS;
  const { polylineLengthKm } = TS;

  TS.cycleTimeHours = function (stops, effSpeed) {
    const km = polylineLengthKm(stops);
    const run = km / Math.max(5, effSpeed);
    return Math.max(0.05, run * 2 + TURNAROUND_MIN / 60);
  };
  TS.roundTripMinutes = function (stops, effSpeed = VEHICLE_SPEED_BASE) {
    if (!stops || stops.length < 2) return 0;
    return TS.cycleTimeHours(stops, effSpeed) * 60;
  };
  TS.actualVehPerHour = function (target, fleetCap) {
    return Math.min(target, Math.floor(fleetCap));
  };
  TS.capacityPerHour = function (veh) { return veh * VEHICLE_CAPACITY; };
  TS.avgWaitMin = function (veh) { return veh > 0 ? (60 / veh) / 2 : Infinity; };

  TS.spacingEfficiency = function (stops, targetSpacing = 3) {
    if (stops.length < 2) return 0.6;
    let sum = 0, n = 0; for (let i = 1; i < stops.length; i++) {
      sum += Math.abs(stops[i - 1].x - stops[i].x) + Math.abs(stops[i - 1].y - stops[i].y); n++;
    }
    const avg = sum / n; const ratio = Math.min(avg, targetSpacing) / Math.max(avg, targetSpacing);
    return 0.6 + 0.4 * ratio;
  };

  TS.demandPerHour = function ({ stops, land, population, poiMap }) {
    if (stops.length === 0) return 0;
    const dist = new Map(); const R = 3;
    for (const s of stops) {
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const nx = s.x + dx, ny = s.y + dy;
        if (nx < 0 || ny < 0 || nx >= land.pop[0].length || ny >= land.pop.length) continue;
        const d = Math.abs(dx) + Math.abs(dy); if (d > R) continue;
        const k = `${nx},${ny}`; dist.set(k, Math.min(d, dist.get(k) ?? d));
      }
    }
    let popSum = 0, jobsSum = 0, poiBoost = 0;
    dist.forEach((d, k) => {
      const [x, y] = k.split(',').map(Number);
      const w = Math.exp(-WALK_DECAY * d);
      popSum += land.pop[y][x] * w;
      jobsSum += land.jobs[y][x] * w;
      const poi = poiMap.get(k); if (poi) poiBoost += poi === 'airport' ? 2 * w : w;
    });

    const popScale = population / START_POP;
    const jobsEff = (jobsSum * JOB_ATTRACTION_PER_CELL) + (poiBoost * 5);
    const spacing = TS.spacingEfficiency(stops);
    return (popSum * BASE_DEMAND_PER_CELL_PER_HOUR) * Math.pow(jobsEff, 0.5) * spacing * popScale;
  };

  TS.estimateRouteDemand = function ({ stops, land, population, poiMap, fare, targetVPH, serviceHours }) {
    if (!stops || stops.length < 2) return { perHour: 0, perDay: 0, resWeight: 0, destWeight: 0 };

    const R = TS.COVERAGE_RADIUS;
    const covered = new Map();
    for (const s of stops) {
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const nx = s.x + dx, ny = s.y + dy;
          if (ny < 0 || nx < 0 || ny >= land.pop.length || nx >= land.pop[0].length) continue;
          const d = Math.abs(dx) + Math.abs(dy); if (d > R) continue;
          const w = Math.exp(-TS.WALK_DECAY * d);
          const key = `${nx},${ny}`;
          covered.set(key, Math.max(covered.get(key) || 0, w));
        }
      }
    }

    let res = 0, dest = 0;
    covered.forEach((w, key) => {
      const [x, y] = key.split(',').map(Number);
      const pop = land.pop[y][x];
      const jobs = land.jobs[y][x];
      const poi = poiMap.get(key);
      const poiBoost = poi ? (TS.POI_TYPES.find(p => p.key === poi)?.jobsBoost || 0) : 0;
      res += pop * w;
      dest += (jobs * TS.JOB_ATTRACTION_PER_CELL + poiBoost * 5) * w;
    });

    const odPotential = Math.min(res, dest);
    const spacingEff = TS.spacingEfficiency(stops, TS.TARGET_STOP_SPACING_CELLS);
    let perHour = odPotential * TS.BASE_DEMAND_PER_CELL_PER_HOUR * spacingEff;
    const avgWait = TS.avgWaitMin(Math.max(1, targetVPH));
    perHour *= TS.priceFactor(fare) * TS.waitFactor(avgWait);
    const capPH = targetVPH * TS.VEHICLE_CAPACITY;
    perHour = Math.min(perHour, capPH);
    perHour *= (population / TS.START_POP);
    const roundTripMinutes = TS.roundTripMinutes(stops, VEHICLE_SPEED_BASE);
    const lengthFactor = Math.max(0.5, Math.min(1, 1 - 0.02 * Math.max(0, (roundTripMinutes - 20))));
    perHour *= lengthFactor;
    const perDay = perHour * Math.max(0, serviceHours);
    const totalWeight = res + dest;
    const destShare = totalWeight > 0 ? dest / totalWeight : 0;
    const destHeavy = destShare >= 0.75 && dest > 0 && res < dest * 0.33;
    return { perHour, perDay, resWeight: res, destWeight: dest, destHeavy };
  };

  TS.priceFactor = function (fare) { return Math.pow(Math.max(0.5, Math.min(5, fare)) / FARE_REF, FARE_ELASTICITY); };
  TS.waitFactor = function (avgWait) { return Math.exp(-WAIT_TIME_SENSITIVITY * (isFinite(avgWait) ? avgWait : 60)); };
  TS.effSpeedFromLoad = function (load) { return VEHICLE_SPEED_BASE * (1 - 0.25 * Math.max(0, load - 0.8)); };

  TS.financesMinute = function ({ withinService, servedPerHour, fare,
    actualVehPerHour, wageRate, overheadPerVehHour, speedKmH, costPerKm,
    hourlyMaint, staffingPerMinute }) {
    const revenuePerMinute = withinService ? (servedPerHour * fare) / 60 : 0;
    const opCostPerHour = (withinService ? (actualVehPerHour * (wageRate + overheadPerVehHour) + actualVehPerHour * (speedKmH * costPerKm)) : 0) + hourlyMaint;
    const opCostPerMinute = opCostPerHour / 60 + staffingPerMinute;
    const subsidyBoardingPerMinute = withinService ? (servedPerHour * SUBSIDY_PER_BOARDING) / 60 : 0;
    const gapPerMinute = Math.max(0, opCostPerMinute - revenuePerMinute - subsidyBoardingPerMinute);
    const subsidyResidualPerMinute = gapPerMinute * RESIDUAL_GAP_SHARE;
    return revenuePerMinute - opCostPerMinute + subsidyBoardingPerMinute + subsidyResidualPerMinute;
  };
})(window);
