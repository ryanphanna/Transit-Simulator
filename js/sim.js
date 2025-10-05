(function (g) {
  const TS = g.TS = g.TS || {};
  const {
    VEHICLE_CAPACITY, VEHICLE_SPEED_BASE, TURNAROUND_MIN,
    BASE_DEMAND_PER_CELL_PER_HOUR, JOB_ATTRACTION_PER_CELL,
    WALK_DECAY, FARE_REF, FARE_ELASTICITY, WAIT_TIME_SENSITIVITY,
    SUBSIDY_PER_BOARDING, RESIDUAL_GAP_SHARE, START_POP
  } = TS;
  const { polylineLengthKm } = TS;

  const LENGTH_FACTOR_THRESHOLD_MIN = 20;
  const LENGTH_FACTOR_DECAY_PER_MIN = 0.02;
  const LENGTH_FACTOR_MIN = 0.5;

  TS.cycleTimeHours = function (stops, effSpeed) {
    const km = polylineLengthKm(stops);
    const run = km / Math.max(5, effSpeed);
    return Math.max(0.05, run * 2 + TURNAROUND_MIN / 60);
  };
  TS.roundTripMinutes = function (stops, effSpeed = VEHICLE_SPEED_BASE) {
    if (!stops || stops.length < 2) return 0;
    return TS.cycleTimeHours(stops, effSpeed) * 60;
  };
  TS.lengthFactorFromRoundTrip = function (roundTripMinutes) {
    const extraMinutes = Math.max(0, roundTripMinutes - LENGTH_FACTOR_THRESHOLD_MIN);
    const factor = 1 - LENGTH_FACTOR_DECAY_PER_MIN * extraMinutes;
    return Math.max(LENGTH_FACTOR_MIN, Math.min(1, factor));
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

  TS.catchmentWeights = function ({ stops, land, poiMap, poiJobsBoost }) {
    if (!stops || stops.length === 0) {
      return { res: 0, dest: 0 };
    }

    const boostFor = poiJobsBoost || (key => TS.POI_TYPES.find(p => p.key === key)?.jobsBoost || 0);
    const poiLookup = poiMap || new Map();
    const weights = new Map();
    const R = TS.COVERAGE_RADIUS;
    for (const stop of stops) {
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const nx = stop.x + dx;
          const ny = stop.y + dy;
          if (nx < 0 || ny < 0 || ny >= land.pop.length || nx >= land.pop[0].length) continue;
          const d = Math.abs(dx) + Math.abs(dy);
          if (d > R) continue;
          const w = Math.exp(-WALK_DECAY * d);
          const key = `${nx},${ny}`;
          if (w > (weights.get(key) || 0)) {
            weights.set(key, w);
          }
        }
      }
    }

    let res = 0;
    let dest = 0;
    weights.forEach((w, key) => {
      const [x, y] = key.split(',').map(Number);
      const pop = land.pop[y][x];
      const jobs = land.jobs[y][x];
      const poi = poiLookup.get(key);
      const boost = poi ? boostFor(poi) : 0;
      res += pop * w;
      dest += (jobs * JOB_ATTRACTION_PER_CELL + boost * 5) * w;
    });

    return { res, dest };
  };

  TS.demandPerHour = function ({ stops, land, population, poiMap, poiJobsBoost }) {
    if (stops.length === 0) return 0;

    const { res, dest } = TS.catchmentWeights({ stops, land, poiMap, poiJobsBoost });
    const odPotential = Math.min(res, dest);
    const popScale = population / START_POP;
    const spacing = TS.spacingEfficiency(stops);

    let perHour = odPotential * BASE_DEMAND_PER_CELL_PER_HOUR * spacing * popScale;
    const roundTripMinutes = TS.roundTripMinutes(stops, VEHICLE_SPEED_BASE);
    perHour *= TS.lengthFactorFromRoundTrip(roundTripMinutes);
    return perHour;
  };

  TS.estimateRouteDemand = function ({ stops, land, population, poiMap, fare, targetVPH, serviceHours }) {
    if (!stops || stops.length < 2) return { perHour: 0, perDay: 0, resWeight: 0, destWeight: 0 };

    const { res, dest } = TS.catchmentWeights({ stops, land, poiMap });
    const odPotential = Math.min(res, dest);
    const spacingEff = TS.spacingEfficiency(stops, TS.TARGET_STOP_SPACING_CELLS);
    let perHour = odPotential * TS.BASE_DEMAND_PER_CELL_PER_HOUR * spacingEff;
    const avgWait = TS.avgWaitMin(Math.max(1, targetVPH));
    perHour *= TS.priceFactor(fare) * TS.waitFactor(avgWait);
    const capPH = targetVPH * TS.VEHICLE_CAPACITY;
    perHour = Math.min(perHour, capPH);
    perHour *= (population / TS.START_POP);
    const roundTripMinutes = TS.roundTripMinutes(stops, VEHICLE_SPEED_BASE);
    perHour *= TS.lengthFactorFromRoundTrip(roundTripMinutes);
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
