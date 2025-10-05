(function (g) {
  const TS = g.TS = g.TS || {};
  const {
    GRID, CELL_SIZE: INITIAL_CELL_SIZE,
    START_POP, POP_GROWTH_PER_YEAR, MODE_SHARE_TARGET, MODE_SHARE_STREAK_DAYS,
    DEFAULT_SERVICE_START_HOUR, DEFAULT_SERVICE_END_HOUR,
    STARTING_CASH, STOP_CAPEX, DRIVER_WAGE_PER_HOUR, OVERHEAD_PER_VEH_HOUR,
    VEHICLE_CAPACITY, VEHICLE_SPEED_BASE,
    INITIAL_FLEET, DEPOT_BASE_CAPACITY, DEPOT_EXPANSION_STEP, DEPOT_EXPANSION_COST,
    BASE_MAINT_PER_BUS_YEAR, SHIFT_HOURS, OVERTIME_MULT,
    FUELS, SIM_MINUTES_PER_TICK, TICK_MS,
    SUBSIDY_PER_BOARDING, RESIDUAL_GAP_SHARE
  } = TS;

  const { clamp, polylineLengthKm } = TS;
  const { generateLandUse } = TS;
  const { generatePOIs, poiIcon, poiJobsBoost, pickPOIType } = TS;
  const {
    spacingEfficiency, avgWaitMin, priceFactor, waitFactor,
    effSpeedFromLoad, roundTripMinutes, estimateRouteDemand, financesMinute,
    cycleTimeHours, capacityPerHour, demandPerHour,
    routeScoreAndGrade, allocateFleet, driverHoursAvailable, maxDepotThroughput
  } = TS;
  const { useBanners, InfoTip, NumberStepper, MapToast } = TS;

  const { useEffect, useMemo, useState, useRef, useCallback } = React;

  const ROUTE_COLORS = (TS.ROUTE_COLORS && TS.ROUTE_COLORS.length)
    ? TS.ROUTE_COLORS
    : ['#ef4444','#3b82f6','#10b981','#f97316','#8b5cf6','#06b6d4','#e11d48','#0ea5e9','#22c55e','#f59e0b'];
  const DEFAULT_TARGET_VPH = 6;
  const TILE_BASE_COLORS = ['#f5fbff', '#e3f7f3', '#d0efe8', '#c1e4dd'];
  const TILE_DENSITY_TINT = '#3aaea1';
  const JOB_OUTLINE_COLOR = 'rgba(255, 196, 120, 0.45)';
  const IDLE_OUTLINE_COLOR = 'rgba(30, 64, 86, 0.08)';

  const mixHexColor = (hexA, hexB, t) => {
    const blend = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
    const clamp = (v) => Math.min(255, Math.max(0, v));
    const parse = (hex) => [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16)
    ];
    const [r1, g1, b1] = parse(hexA);
    const [r2, g2, b2] = parse(hexB);
    const mix = (a, b) => clamp(Math.round(a + (b - a) * blend));
    return `#${[mix(r1, r2), mix(g1, g2), mix(b1, b2)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  };

  const createDensityGrid = () => Array.from({ length: GRID }, () => Array(GRID).fill(0));

  function App(){
    TS.routeSeq = TS.routeSeq || 1;
    const initialRouteId = `r${TS.routeSeq}`;

    // World
    const [seed,setSeed]=useState(42);
    const [population,setPopulation]=useState(START_POP);
    const land=useMemo(()=> generateLandUse(seed),[seed]);
    const [poiMap,setPoiMap]=useState(()=> generatePOIs(seed, START_POP));
    useEffect(()=> setPoiMap(generatePOIs(seed, population)), [seed, population]);
    const [densityLevels, setDensityLevels] = useState(() => createDensityGrid());

    const [routes,setRoutes]=useState(()=>[
      { id: initialRouteId, name: `Route ${TS.routeSeq}`, stops: [], color: ROUTE_COLORS[0], targetVPH: DEFAULT_TARGET_VPH }
    ]);
    const [activeRouteId,setActiveRouteId]=useState(initialRouteId);

    const [globalFare,setGlobalFare]=useState(2.0);

    // Route & time
    const [running,setRunning]=useState(false);
    const [autoStarted,setAutoStarted]=useState(false);
    const defaultStartMinutes = DEFAULT_SERVICE_START_HOUR * 60;
    const [dayMinutes,setDayMinutes]=useState(defaultStartMinutes);
    const [totalMinutes,setTotalMinutes]=useState(0);
    const [serviceStartHour,setServiceStartHour]=useState(DEFAULT_SERVICE_START_HOUR);
    const [serviceEndHour,setServiceEndHour]=useState(DEFAULT_SERVICE_END_HOUR);
    const [speed,setSpeed]=useState(1);
    const [busAnim, setBusAnim] = useState({ loopDistance: 0 });

    // Ops
    const [fleet,setFleet]=useState(INITIAL_FLEET);
    const [avgBusAge,setAvgBusAge]=useState(3);
    const [depotCap,setDepotCap]=useState(DEPOT_BASE_CAPACITY);
    const [fuel,setFuel]=useState('Diesel');
    const [drivers,setDrivers]=useState(20);
    const [dayVehHours,setDayVehHours]=useState(0);
    const [autoSkipIdle,setAutoSkipIdle]=useState(false);

    const [cellSize,setCellSize]=useState(INITIAL_CELL_SIZE);
    const [visualPadding,setVisualPadding]=useState(0);
    const canvasSize = cellSize * GRID;
    const displaySize = canvasSize + visualPadding * 2 * cellSize;
    const mapOffset = visualPadding * cellSize;
    const paddedGrid = GRID + visualPadding * 2;
    const mapContainerRef = useRef(null);
    const [settingsOpen,setSettingsOpen]=useState(false);
    const recomputeCellSize = useCallback(() => {
      const node = mapContainerRef.current;
      if (!node) return;
      const { clientWidth, clientHeight } = node;
      if (!clientWidth || !clientHeight) return;
      const desired = Math.min(clientWidth, clientHeight);
      const next = clamp(Math.floor(desired / GRID), 14, 64);
      const nextCanvas = next * GRID;
      const extraHeight = Math.max(0, clientHeight - nextCanvas);
      const paddingCells = Math.max(0, Math.min(2, Math.floor(extraHeight / (2 * next))));
      setVisualPadding(prev => (prev === paddingCells ? prev : paddingCells));
      setCellSize(prev => (prev === next ? prev : next));
    }, []);

    useEffect(() => {
      const node = mapContainerRef.current;
      if (!node) return;
      if (typeof ResizeObserver === 'function') {
        const observer = new ResizeObserver(() => {
          recomputeCellSize();
        });
        observer.observe(node);
        recomputeCellSize();
        return () => observer.disconnect();
      }
      recomputeCellSize();
      const handle = () => recomputeCellSize();
      window.addEventListener('resize', handle);
      return () => window.removeEventListener('resize', handle);
    }, [recomputeCellSize]);

    useEffect(() => {
      TS.CELL_SIZE = cellSize;
      TS.CANVAS_SIZE = cellSize * GRID;
    }, [cellSize]);

    useEffect(() => {
      if(!running) return;
      const interval = setInterval(() => {
        const activeStops = stopsRef.current || [];
        if(activeStops.length < 2){
          setBusAnim(prev => (prev.loopDistance === 0 ? prev : { loopDistance: 0 }));
          return;
        }
        const totalSegments = Math.max(1, activeStops.length - 1);
        const loopLength = totalSegments * 2;
        const delta = 0.12 * Math.max(0.55, speed / 4);
        setBusAnim(prev => {
          const current = prev?.loopDistance || 0;
          const next = loopLength > 0 ? (current + delta) % loopLength : 0;
          return { loopDistance: next };
        });
      }, 120);
      return () => clearInterval(interval);
    }, [running, speed]);

    // Finance / outputs
    const [cash,setCash]=useState(STARTING_CASH);
    const [ridershipHour,setRidershipHour]=useState(0);
    const [modeShare,setModeShare]=useState(0);
    const [streakDays,setStreakDays]=useState(0);
    const [graduated,setGraduated]=useState(false);
    const [loadFactor,setLoadFactor]=useState(0);
    const [effSpeed,setEffSpeed]=useState(VEHICLE_SPEED_BASE);
    const [lastDayFinance,setLastDayFinance]=useState({ income:0, costs:0, net:0 });

    const banners = useBanners();
    const financeAccumulatorRef = useRef({ income:0, costs:0 });
    const destHeavyShownRef = useRef(false);
    const lastPoiSpawnDayRef = useRef(0);
    const densityDayRef = useRef(1);
    const ridershipMilestoneRef = useRef(0);

    const activeRoute = useMemo(() => routes.find(r => r.id === activeRouteId) || routes[0], [routes, activeRouteId]);
    const stops = activeRoute ? activeRoute.stops : [];
    const stopsRef = useRef(stops);
    useEffect(() => { stopsRef.current = stops; }, [stops]);
    useEffect(() => { setBusAnim({ loopDistance: 0 }); }, [activeRouteId, stops.length]);

    const updateActiveRoute = useCallback((mutator) => {
      setRoutes(prev => prev.map(route => {
        if(route.id !== activeRouteId) return route;
        const next = mutator(route) || route;
        return next;
      }));
    }, [activeRouteId]);

    // Service window
    const withinService = dayMinutes >= (serviceStartHour*60) && dayMinutes < (serviceEndHour*60);
    const serviceHoursToday = Math.max(0, serviceEndHour - serviceStartHour);

    const routeOperational = useMemo(() => {
      return routes.map((route, index) => {
        const routeStops = route.stops || [];
        const hasService = routeStops.length >= 2;
        const targetVPH = hasService ? (route.targetVPH ?? DEFAULT_TARGET_VPH) : 0;
        const cycleH = hasService ? cycleTimeHours(routeStops, effSpeed) : 0;
        const cycleForAlloc = cycleH > 0 ? cycleH : 1;
        const baseDemand = hasService ? demandPerHour({ stops: routeStops, land, population, poiMap, poiJobsBoost }) : 0;
        const color = route.color || ROUTE_COLORS[index % ROUTE_COLORS.length];
        return {
          id: route.id,
          name: route.name,
          stops: routeStops,
          targetVPH,
          cycleH,
          cycleForAlloc,
          baseDemand,
          color
        };
      });
    }, [routes, effSpeed, land, population, poiMap, poiJobsBoost, ROUTE_COLORS]);

    const cycleTimesHrs = useMemo(() => routeOperational.map(info => info.cycleForAlloc), [routeOperational]);

    const driverHoursAvail = useMemo(() => driverHoursAvailable(drivers, TS.SHIFT_HOURS), [drivers]);

    const depotThroughput = useMemo(() => {
      const valid = routeOperational.filter(info => info.cycleH > 0).map(info => info.cycleH);
      const avg = valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 1;
      return maxDepotThroughput(depotCap, avg);
    }, [routeOperational, depotCap]);

    const allocationResult = useMemo(() => allocateFleet({
      routes: routeOperational.map(info => ({ targetVPH: info.targetVPH })),
      cycleTimesHrs,
      fleetOwned: fleet,
      driverHoursAvail,
      depotThroughput,
      speedKmh: effSpeed
    }), [routeOperational, cycleTimesHrs, fleet, driverHoursAvail, depotThroughput, effSpeed]);

    const busesAssigned = allocationResult?.busesAssigned || [];
    const allocationDeficit = allocationResult?.deficit || 0;

    const enrichedRoutes = useMemo(() => {
      const priceMult = priceFactor(globalFare);
      return routeOperational.map((info, idx) => {
        const assigned = busesAssigned[idx] || 0;
        const actualVPH = info.cycleH > 0 ? assigned / info.cycleH : 0;
        const avgWaitRoute = avgWaitMin(actualVPH);
        const demandPerHourAdj = info.baseDemand * priceMult * waitFactor(avgWaitRoute);
        const capacityPerHourVal = capacityPerHour(actualVPH);
        const servedPerHour = Math.min(demandPerHourAdj, capacityPerHourVal);
        const servedPerDay = servedPerHour * serviceHoursToday;
        return {
          ...info,
          busesAssigned: assigned,
          actualVPH,
          avgWait: avgWaitRoute,
          demandPH: demandPerHourAdj,
          capacityPH: capacityPerHourVal,
          servedPH: servedPerHour,
          servedPerDay,
          throttled: actualVPH + 1e-6 < info.targetVPH
        };
      });
    }, [routeOperational, busesAssigned, globalFare, serviceHoursToday]);

    const networkStats = useMemo(() => {
      let totalActual = 0;
      let totalCapacity = 0;
      let totalDemand = 0;
      let totalServed = 0;
      let totalBuses = 0;
      let totalTarget = 0;
      let totalServedPerDay = 0;
      enrichedRoutes.forEach(info => {
        totalActual += info.actualVPH || 0;
        totalCapacity += info.capacityPH || 0;
        totalDemand += info.demandPH || 0;
        totalServed += info.servedPH || 0;
        totalBuses += info.busesAssigned || 0;
        totalTarget += info.targetVPH || 0;
        totalServedPerDay += info.servedPerDay || 0;
      });
      return {
        totalActual,
        totalCapacity,
        totalDemand,
        totalServed,
        totalBuses,
        totalTarget,
        totalServedPerDay,
        spare: Math.max(0, fleet - totalBuses)
      };
    }, [enrichedRoutes, fleet]);

    const networkActualVPH = networkStats.totalActual;
    const networkCapacityPH = networkStats.totalCapacity;
    const networkDemandPH = networkStats.totalDemand;
    const networkServedPH = networkStats.totalServed;
    const networkTargetVPH = networkStats.totalTarget;
    const vehiclesInUse = networkStats.totalBuses;
    const spareBuses = networkStats.spare;
    const networkEstimatedRidersPerDay = Math.round(networkStats.totalServedPerDay);
    const activeRouteInfo = enrichedRoutes.find(info => info.id === activeRouteId) || null;

    const routeEstimateMap = useMemo(()=>{
      const map = new Map();
      routes.forEach(route => {
        if(!route){
          return;
        }
        if(route.stops.length < 2){
          map.set(route.id, null);
          return;
        }
        const targetVPH = route.targetVPH ?? DEFAULT_TARGET_VPH;
        map.set(route.id, estimateRouteDemand({
          stops: route.stops,
          land,
          population,
          poiMap,
          fare: globalFare,
          targetVPH,
          serviceHours: serviceHoursToday
        }));
      });
      return map;
    }, [routes, land, population, poiMap, serviceHoursToday, globalFare]);
    const routeDemandEstimate = activeRoute ? (routeEstimateMap.get(activeRoute.id) || null) : null;

    const polylineFor = useCallback((points) => {
      if(!points || points.length < 2) return '';
      const offset = mapOffset;
      return points.map(p => `${p.x*cellSize + offset + cellSize/2},${p.y*cellSize + offset + cellSize/2}`).join(' ');
    }, [cellSize, mapOffset]);

    const routeSummaries = useMemo(() => {
      const stopSets = routes.map(route => new Set(route.stops.map(p => `${p.x},${p.y}`)));
      return routes.map((route, index) => {
        const enriched = enrichedRoutes[index];
        const estimate = routeEstimateMap.get(route.id) || null;
        const color = enriched?.color || route.color || ROUTE_COLORS[index % ROUTE_COLORS.length];
        let connectivity = 0;
        if(route.stops.length >= 2){
          for(let j=0; j<routes.length; j++){
            const other = routes[j];
            if(!other || other.id === route.id || other.stops.length < 2) continue;
            const otherStops = stopSets[j];
            if(!otherStops || otherStops.size === 0) continue;
            let overlap = 0;
            for(const stop of route.stops){
              if(otherStops.has(`${stop.x},${stop.y}`)) overlap++;
            }
            const normalized = overlap / Math.max(1, route.stops.length - 1);
            if(normalized > connectivity) connectivity = normalized;
          }
        }
        const gradeInfo = (estimate && route.stops.length >= 2)
          ? routeScoreAndGrade({
              resWeight: estimate.resWeight,
              destWeight: estimate.destWeight,
              poiTypes: estimate.poiTypesCovered,
              connectivity,
              roundTripMinutes: estimate.roundTripMinutes,
              lengthFactor: estimate.lengthFactor
            })
          : null;
        return {
          id: route.id,
          name: route.name,
          color,
          stops: route.stops,
          estimate,
          ridersPerDay: route.stops.length >= 2 ? Math.round(enriched?.servedPerDay ?? 0) : null,
          grade: route.stops.length >= 2 ? (gradeInfo?.grade ?? null) : null,
          score: gradeInfo?.score ?? null,
          connectivity,
          poiTypes: estimate?.poiTypesCovered || [],
          polyline: polylineFor(route.stops),
          targetVPH: enriched?.targetVPH || 0,
          actualVPH: enriched?.actualVPH || 0,
          servedPerHour: enriched?.servedPH || 0,
          capacityPerHour: enriched?.capacityPH || 0,
          throttled: enriched?.throttled || false,
          busesAssigned: enriched?.busesAssigned || 0
        };
      });
    }, [routes, enrichedRoutes, routeEstimateMap, polylineFor, routeScoreAndGrade, ROUTE_COLORS]);

    const activeRouteSummary = useMemo(() => routeSummaries.find(r => r.id === activeRouteId) || null, [routeSummaries, activeRouteId]);
    const gradeOrder = ['F','D','C','B','A'];
    const networkGrade = useMemo(() => {
      const values = routeSummaries
        .map(summary => summary.grade)
        .filter(Boolean)
        .map(letter => gradeOrder.indexOf(letter))
        .filter(index => index >= 0);
      if(!values.length) return null;
      const sorted = [...values].sort((a,b) => a-b);
      const median = sorted[Math.floor(sorted.length / 2)];
      return gradeOrder[median] || null;
    }, [routeSummaries]);

    useEffect(() => {
      const estimate = activeRoute ? routeEstimateMap.get(activeRoute.id) : null;
      const heavy = !!estimate?.destHeavy;
      if(heavy && !destHeavyShownRef.current){
        banners.show({ target:'map', type:'warn', text:'Lots of destinations here — weave in some homes to keep riders happy.'});
      }
      destHeavyShownRef.current = heavy;
    }, [activeRoute, routeEstimateMap, banners]);

    const throttledToastRef = useRef(false);
    useEffect(() => {
      const anyThrottled = routeSummaries.some(summary => summary.throttled && summary.targetVPH > 0);
      if(anyThrottled && !throttledToastRef.current){
        banners.show({ target:'map', type:'info', text:'Fleet is catching its breath — add buses or drivers to boost frequency.'});
      }
      throttledToastRef.current = anyThrottled;
    }, [routeSummaries, banners]);

    useEffect(() => {
      const day = dayNumber;
      if(day <= 1) return;
      if(routes.every(route => route.stops.length < 2)) return;
      const daysSince = day - lastPoiSpawnDayRef.current;
      if(daysSince < 7) return;
      const spawnChance = Math.min(0.03, daysSince * 0.005);
      if(Math.random() >= spawnChance) return;
      let added = false;
      setPoiMap(prev => {
        const coverageRadius = TS.COVERAGE_RADIUS || 3;
        const coverage = new Map();
        routes.forEach(route => {
          route.stops.forEach(stop => {
            for(let dy = -coverageRadius; dy <= coverageRadius; dy++){
              for(let dx = -coverageRadius; dx <= coverageRadius; dx++){
                const nx = stop.x + dx;
                const ny = stop.y + dy;
                if(nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
                const dist = Math.abs(dx) + Math.abs(dy);
                if(dist > coverageRadius) continue;
                const weight = Math.exp(-0.45 * dist);
                const key = `${nx},${ny}`;
                if(weight > (coverage.get(key) || 0)){
                  coverage.set(key, weight);
                }
              }
            }
          });
        });
        if(!coverage.size) return prev;
        const candidates = [];
        coverage.forEach((coverageWeight, key) => {
          if(prev.has(key)) return;
          const [sx, sy] = key.split(',');
          const x = Number(sx);
          const y = Number(sy);
          const jobs = land.jobs?.[y]?.[x] ?? 0;
          const popVal = land.pop?.[y]?.[x] ?? 0;
          const neighborKeys = [
            `${x-1},${y}`,`${x+1},${y}`,`${x},${y-1}`,`${x},${y+1}`
          ];
          const nearbyPoi = neighborKeys.reduce((acc, k) => acc + (prev.has(k) ? 1 : 0), 0);
          const weight = coverageWeight * (jobs * 1.6 + popVal * 0.6 + 1) + nearbyPoi * 0.5;
          if(weight > 0) candidates.push({ key, weight, x, y });
        });
        if(!candidates.length) return prev;
        const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
        let roll = Math.random() * totalWeight;
        let chosen = candidates[0];
        for(const candidate of candidates){
          roll -= candidate.weight;
          if(roll <= 0){
            chosen = candidate;
            break;
          }
        }
        const next = new Map(prev);
        next.set(chosen.key, pickPOIType(population));
        added = true;
        return next;
      });
      if(added){
        lastPoiSpawnDayRef.current = day;
      }
    }, [dayNumber, routes, land, population, pickPOIType]);

    useEffect(() => {
      const currentDay = Math.floor(totalMinutes / 1440) + 1;
      if(currentDay === densityDayRef.current) return;
      densityDayRef.current = currentDay;
      setDensityLevels(prev => {
        const faded = prev.map(row => row.map(value => Math.max(0, value * 0.94)));
        const next = faded.map(row => [...row]);
        const growthRoutes = enrichedRoutes.filter(info => (info.servedPerDay || 0) >= 600);
        if(!growthRoutes.length) return next;
        const coverageRadius = (TS.COVERAGE_RADIUS || 3) + 1;
        growthRoutes.forEach(info => {
          const served = info.servedPerDay || 0;
          const intensityBase = Math.min(1.15, served / 8000);
          info.stops.forEach(stop => {
            for(let dy = -coverageRadius; dy <= coverageRadius; dy++){
              for(let dx = -coverageRadius; dx <= coverageRadius; dx++){
                const nx = stop.x + dx;
                const ny = stop.y + dy;
                if(nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
                const dist = Math.abs(dx) + Math.abs(dy);
                if(dist > coverageRadius) continue;
                const weight = Math.exp(-0.6 * dist);
                const growth = intensityBase * weight * 0.22;
                next[ny][nx] = Math.min(1, next[ny][nx] + growth);
              }
            }
          });
        });
        return next;
      });
    }, [totalMinutes, enrichedRoutes]);

    // Build actions
    function handleCellClick(event,x,y){
      if(!activeRoute) return;
      if(running){ banners.show({ target:'map', type:'info', text:'Pause the sim to place stops — the city will wait for you!'}); return; }
      if(event.shiftKey){
        updateActiveRoute(route => {
          if(!route.stops.some(p => p.x === x && p.y === y)) return route;
          return { ...route, stops: route.stops.filter(p => !(p.x === x && p.y === y)) };
        });
        return;
      }
      let addedPoint = null;
      updateActiveRoute(route => {
        const prevStops = route.stops;
        if(prevStops.some(p => p.x === x && p.y === y)) return route;
        let nextX = x;
        let nextY = y;
        if(prevStops.length){
          const last = prevStops[prevStops.length - 1];
          const dx = nextX - last.x;
          const dy = nextY - last.y;
          if(dx !== 0 && dy !== 0){
            if(Math.abs(dx) >= Math.abs(dy)){
              nextY = last.y;
            } else {
              nextX = last.x;
            }
          }
        }
        if(prevStops.some(p => p.x === nextX && p.y === nextY)) return route;
        addedPoint = { x: nextX, y: nextY };
        return { ...route, stops: [...prevStops, addedPoint] };
      });
      if(addedPoint){
        setCash(c=> c-STOP_CAPEX);
      }
    }
    function buyBuses(n){
      const unit=FUELS[fuel].busCost; const disc=n>=10?0.10:n>=5?0.05:0; const total=Math.round(unit*n*(1-disc));
      if(running || cash<total) return; setCash(c=>c-total); setFleet(f=>f+n); setAvgBusAge(a=> (a*fleet)/(fleet+n));
    }
    function expandDepot(){ if(running || cash<DEPOT_EXPANSION_COST) return; setCash(c=>c-DEPOT_EXPANSION_COST); setDepotCap(c=>c+DEPOT_EXPANSION_STEP); }
    function hireDrivers(n){ if(running) return; setDrivers(d=> Math.max(0,d+n)); }
    function handleAddRoute(){
      const nextId = `r${++TS.routeSeq}`;
      setRoutes(prev => {
        const color = ROUTE_COLORS[prev.length % ROUTE_COLORS.length];
        return [...prev, { id: nextId, name: `Route ${TS.routeSeq}`, stops: [], color, targetVPH: DEFAULT_TARGET_VPH }];
      });
      setActiveRouteId(nextId);
      setRunning(false);
      setAutoStarted(false);
      destHeavyShownRef.current = false;
    }

    const handleRouteTargetChange = useCallback((next) => {
      const sanitized = Math.max(0, Math.round(next));
      updateActiveRoute(route => ({ ...route, targetVPH: sanitized }));
    }, [updateActiveRoute]);

    // Auto-start when a route exists (≥3 stops)
    useEffect(()=>{
      if(!autoStarted && !running && stops.length>=3){
        setAutoStarted(true);
        setRunning(true);
        banners.show({ target:'map', type:'success', text:'🚌 Service rolling — riders are hopping aboard.'});
      }
    }, [stops.length, autoStarted, running]);

    const handleDayRollover = useCallback((servedPerHourSnapshot, nextTotalMinutes) => {
      const dailyRiders = servedPerHourSnapshot * serviceHoursToday;
      const ms = population>0 ? (dailyRiders/population)*100 : 0;
      setModeShare(ms);
      const meets = ms >= MODE_SHARE_TARGET;
      setStreakDays(prev => {
        const next = meets ? prev + 1 : 0;
        if(meets && next >= MODE_SHARE_STREAK_DAYS && !graduated){
          setGraduated(true);
          banners.show({ type:'celebrate', text:`🎓 You graduated Tutorial City — the neighbors are cheering!`});
        }
        return next;
      });
      const years = Math.floor(nextTotalMinutes/525600);
      setPopulation(START_POP + years*POP_GROWTH_PER_YEAR);
    }, [serviceHoursToday, population, graduated, banners]);

    // Tick
    useEffect(()=>{
      if(!running) return;
      const id=setInterval(()=>{
        let localDayMinutes = dayMinutes;
        let localTotalMinutes = totalMinutes;
        let localDayVehHours = dayVehHours;
        let localCash = cash;
        let localEffSpeed = effSpeed;
        let localRidership = ridershipHour;
        let localLoad = loadFactor;
        let finance = financeAccumulatorRef.current;

        for(let step=0; step<speed; step++){
          const serviceStartMin = serviceStartHour * 60;
          const serviceEndMin = serviceEndHour * 60;
          const currentWithinService = localDayMinutes >= serviceStartMin && localDayMinutes < serviceEndMin;
          let minutesAdvance = SIM_MINUTES_PER_TICK;
          if(autoSkipIdle && !currentWithinService){
            if(serviceStartMin !== serviceEndMin){
              if(localDayMinutes < serviceStartMin){
                minutesAdvance = serviceStartMin - localDayMinutes;
              } else {
                minutesAdvance = (1440 - localDayMinutes) + serviceStartMin;
              }
            }
          }

          const servedPH = currentWithinService ? networkServedPH : 0;
          const load = networkCapacityPH>0 ? servedPH/networkCapacityPH : 0;
          const nextSpeed = effSpeedFromLoad(load);

          const driversDailyCap = drivers * SHIFT_HOURS;
          const addVehHours = currentWithinService ? (networkActualVPH / 60) * minutesAdvance : 0;
          const newDayVehHrs = localDayVehHours + addVehHours;
          const overtime = newDayVehHrs > driversDailyCap;
          const wage = DRIVER_WAGE_PER_HOUR * (overtime? OVERTIME_MULT:1);
          const costPerKm = FUELS[fuel].costPerKm * (avgBusAge<=5?1:(1+0.05*(avgBusAge-5)));
          const hourlyMaint = (fleet * (BASE_MAINT_PER_BUS_YEAR * (avgBusAge<=5?1:(1+0.05*(avgBusAge-5))))) / (365*24);

          const delta = financesMinute({
            withinService: currentWithinService, servedPerHour: servedPH, fare: globalFare,
            actualVehPerHour: networkActualVPH, wageRate: wage, overheadPerVehHour: OVERHEAD_PER_VEH_HOUR,
            speedKmH: nextSpeed, costPerKm, hourlyMaint, staffingPerMinute: 0
          });

          const revenuePerMinute = currentWithinService ? (servedPH * globalFare) / 60 : 0;
          const opCostPerHour = (currentWithinService ? (networkActualVPH * (wage + OVERHEAD_PER_VEH_HOUR) + networkActualVPH * (nextSpeed * costPerKm)) : 0) + hourlyMaint;
          const opCostPerMinute = opCostPerHour / 60;
          const subsidyBoardingPerMinute = currentWithinService ? (servedPH * SUBSIDY_PER_BOARDING) / 60 : 0;
          const gapPerMinute = Math.max(0, opCostPerMinute - revenuePerMinute - subsidyBoardingPerMinute);
          const subsidyResidualPerMinute = gapPerMinute * RESIDUAL_GAP_SHARE;
          const incomePerMinute = revenuePerMinute + subsidyBoardingPerMinute + subsidyResidualPerMinute;
          const costsPerMinute = opCostPerMinute;

          finance.income += incomePerMinute * minutesAdvance;
          finance.costs += costsPerMinute * minutesAdvance;

          localCash += delta * minutesAdvance;
          localRidership = currentWithinService ? servedPH : 0;
          localLoad = load;
          localEffSpeed = nextSpeed;

          const nm = localDayMinutes + minutesAdvance;
          const tm = localTotalMinutes + minutesAdvance;
          const rollover = nm >= 1440;
          const nextDayMinutes = rollover ? (nm % 1440) : nm;
          localDayMinutes = nextDayMinutes;
          localTotalMinutes = tm;
          localDayVehHours = rollover ? addVehHours : newDayVehHrs;

          if(rollover){
            const net = finance.income - finance.costs;
            setLastDayFinance({ income: finance.income, costs: finance.costs, net });
            financeAccumulatorRef.current = { income:0, costs:0 };
            finance = financeAccumulatorRef.current;
            handleDayRollover(networkServedPH, tm);
          }
        }

        setCash(localCash);
        setRidershipHour(localRidership);
        setLoadFactor(localLoad);
        setEffSpeed(localEffSpeed);
        setDayMinutes(localDayMinutes);
        setTotalMinutes(localTotalMinutes);
        setDayVehHours(localDayVehHours);
      }, TICK_MS);
      return ()=> clearInterval(id);
    }, [running, speed, autoSkipIdle, globalFare, networkServedPH, networkCapacityPH, networkActualVPH, fuel, avgBusAge, drivers, dayVehHours, dayMinutes, totalMinutes, serviceStartHour, serviceEndHour, handleDayRollover, fleet, cash, ridershipHour, loadFactor, effSpeed]);

    // Milestones / advisories
    const lastMilestoneRef = useRef(0);
    useEffect(()=>{ [1,2,3,5].forEach(m=>{ if(modeShare>=m && lastMilestoneRef.current<m){ lastMilestoneRef.current=m; banners.show({ type:m===5?'celebrate':'success', text:`Transit share just reached ${m}% — great work keeping the city moving!`} ); } }); }, [modeShare]);
    useEffect(()=>{ if(cash < 250000) banners.show({ type:'warn', text:'Friendly nudge: cash reserves are getting thin.'}); }, [cash]);
    useEffect(()=>{ if(loadFactor>0.9) banners.show({ type:'info', text:'Buses are cozy-full — consider adding a bit more service.'}); }, [loadFactor]);
    useEffect(() => {
      const thresholds = [1000, 5000, 10000, 20000];
      const riders = Number.isFinite(networkEstimatedRidersPerDay) ? networkEstimatedRidersPerDay : 0;
      thresholds.forEach((threshold) => {
        if(riders >= threshold && ridershipMilestoneRef.current < threshold){
          ridershipMilestoneRef.current = threshold;
          if(threshold >= 10000){
            banners.show({ type:'celebrate', text:`🌆 Citizens are loving your service! ${threshold.toLocaleString()} riders hop on each day.`});
          } else if(threshold >= 5000){
            banners.show({ type:'success', text:`🌟 Ridership is soaring past ${threshold.toLocaleString()} riders/day.`});
          } else {
            banners.show({ type:'success', text:`🎉 Nice route! You now serve ${threshold.toLocaleString()} riders each day.`});
          }
        }
      });
    }, [networkEstimatedRidersPerDay, banners]);

    // UI helpers
    const fmtMoney = v => v.toLocaleString(undefined,{style:'currency',currency:'USD', maximumFractionDigits:0});
    const dayNumber = Math.floor(totalMinutes / 1440) + 1;
    const hours = Math.floor(dayMinutes/60).toString().padStart(2,'0');
    const minutes = (dayMinutes%60).toString().padStart(2,'0');
    const serviceLabel = withinService ? 'In service' : 'Outside service';
    const canJumpToServiceStart = serviceHoursToday > 0;
    const fareLabel = `$${globalFare.toFixed(2)}`;
    const networkRidersPerDay = networkEstimatedRidersPerDay;
    const activeRouteDailyRiders = activeRouteSummary ? (activeRouteSummary.ridersPerDay ?? null) : null;
    const activeRoundTripMinutes = activeRouteInfo ? Math.round((activeRouteInfo.cycleH || 0) * 60) : 0;
    const dailyIncome = lastDayFinance.income;
    const dailyCosts = lastDayFinance.costs;
    const dailyNet = lastDayFinance.net;
    const dailyNetClass = dailyNet >= 0 ? 'text-emerald-600' : 'text-rose-600';
    const speedOptions = [1,4,10];
    const speedLabels = { 1: '1×', 4: '4×', 10: '10×' };
    const activeActualVPH = activeRouteInfo ? activeRouteInfo.actualVPH : 0;
    const activeTargetVPH = activeRouteInfo ? activeRouteInfo.targetVPH : (activeRoute?.targetVPH ?? DEFAULT_TARGET_VPH);
    const activeThrottled = !!activeRouteSummary?.throttled;
    const driversHours = drivers * SHIFT_HOURS;
    const depotThroughputRounded = Math.floor(depotThroughput);
    const busPosition = useMemo(() => {
      if(!stops || stops.length < 2) return null;
      const totalSegments = stops.length - 1;
      const loopLength = totalSegments * 2;
      if(loopLength <= 0) return null;
      const raw = busAnim?.loopDistance ?? 0;
      const normalized = ((raw % loopLength) + loopLength) % loopLength;
      let forwardDistance = normalized;
      let direction = 1;
      if(forwardDistance > totalSegments){
        direction = -1;
        forwardDistance = loopLength - forwardDistance;
      }
      const segmentIndex = Math.min(totalSegments - 1, Math.floor(forwardDistance));
      const startPoint = stops[segmentIndex];
      const endPoint = stops[segmentIndex + 1];
      if(!startPoint || !endPoint) return null;
      const segmentFraction = forwardDistance - segmentIndex;
      const progress = direction === 1 ? segmentFraction : 1 - segmentFraction;
      const x = (startPoint.x + (endPoint.x - startPoint.x) * progress) * cellSize + mapOffset + cellSize/2;
      const y = (startPoint.y + (endPoint.y - startPoint.y) * progress) * cellSize + mapOffset + cellSize/2;
      const angle = Math.atan2(endPoint.y - startPoint.y, endPoint.x - startPoint.x);
      return { x, y, angle };
    }, [busAnim, stops, cellSize, mapOffset]);
    const busVisible = running && stops.length >= 2;
    const busUsageSlots = useMemo(() => {
      const total = 10;
      const ratio = fleet > 0 ? vehiclesInUse / fleet : 0;
      const filled = Math.round(Math.min(total, Math.max(0, ratio * total)));
      return Array.from({ length: total }, (_, idx) => idx < filled);
    }, [vehiclesInUse, fleet]);

    const handleToggleRunning = () => {
      if(!running){
        setAutoStarted(true);
      }
      setRunning(r=>!r);
    };

    const resetGame = (nextSeed) => {
      setRunning(false);
      setAutoStarted(false);
      TS.routeSeq = 1;
      const baseRouteId = `r${TS.routeSeq}`;
      const baseRoute = { id: baseRouteId, name: `Route ${TS.routeSeq}`, stops: [], color: ROUTE_COLORS[0], targetVPH: DEFAULT_TARGET_VPH };
      setRoutes([baseRoute]);
      setActiveRouteId(baseRouteId);
      destHeavyShownRef.current = false;
      setGlobalFare(2.0);
      setCash(STARTING_CASH);
      setFleet(INITIAL_FLEET);
      setDepotCap(DEPOT_BASE_CAPACITY);
      setAvgBusAge(3);
      setDrivers(20);
      setDayMinutes(defaultStartMinutes);
      setTotalMinutes(0);
      setDayVehHours(0);
      setEffSpeed(VEHICLE_SPEED_BASE);
      setAutoSkipIdle(false);
      setSpeed(1);
      setBusAnim({ loopDistance: 0 });
      setPopulation(START_POP);
      setModeShare(0);
      setStreakDays(0);
      setGraduated(false);
      setServiceStartHour(DEFAULT_SERVICE_START_HOUR);
      setServiceEndHour(DEFAULT_SERVICE_END_HOUR);
      financeAccumulatorRef.current = { income:0, costs:0 };
      setLastDayFinance({ income:0, costs:0, net:0 });
      setDensityLevels(createDensityGrid());
      const updatedSeed = typeof nextSeed === 'number' ? nextSeed : seed;
      setPoiMap(generatePOIs(updatedSeed, START_POP));
      if(typeof nextSeed === 'number'){
        setSeed(updatedSeed);
      }
      lastPoiSpawnDayRef.current = 0;
      densityDayRef.current = 1;
      ridershipMilestoneRef.current = 0;
    };

    const handleJumpToService = () => {
      if(serviceHoursToday <= 0) return;
      const startMin = serviceStartHour * 60;
      setDayMinutes(dm => {
        if(dm < startMin){
          const advance = startMin - dm;
          setTotalMinutes(tm => tm + advance);
          return startMin;
        }
        const advance = (1440 - dm) + startMin;
        setTotalMinutes(tm => {
          const nextTotal = tm + advance;
          const finance = financeAccumulatorRef.current;
          const net = finance.income - finance.costs;
          setLastDayFinance({ income: finance.income, costs: finance.costs, net });
          financeAccumulatorRef.current = { income:0, costs:0 };
          handleDayRollover(0, nextTotal);
          return nextTotal;
        });
        setDayVehHours(0);
        return startMin;
      });
    };

    const prevServiceRef = useRef(withinService);
    useEffect(()=>{
      if(withinService && prevServiceRef.current === false){
        banners.show({ target:'map', type:'info', text:'Service window open — neighbors are lining up for a cozy ride.'});
      }
      prevServiceRef.current = withinService;
    }, [withinService, banners]);


  // Render
  return (
    <React.Fragment>
      <div className="relative min-h-screen w-full bg-gradient-to-b from-sky-50 via-emerald-50/40 to-white text-slate-900">
          {banners.hudView}
          <header className="sticky top-0 z-40 border-b border-emerald-100/60 bg-white/80 backdrop-blur">
            <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between gap-4 px-6 py-3">
              <div className="flex flex-wrap items-center gap-3 text-sm text-slate-700">
                <span className="text-sm font-semibold text-slate-900">
                  Day {dayNumber} · {hours}:{minutes} — {serviceLabel}
                </span>
                <button
                  onClick={handleToggleRunning}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${running ? 'border-amber-400 bg-amber-100 text-amber-700' : 'border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-600'}`}
                >
                  {running ? '⏸ Pause' : '▶ Play'}
                </button>
                <div className="flex items-center gap-1">
                  {speedOptions.map(opt => (
                    <button
                      key={opt}
                      onClick={()=> setSpeed(opt)}
                      className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${speed===opt ? 'border-emerald-300 bg-emerald-100 text-emerald-700' : 'border-emerald-100/70 bg-white/80 text-slate-700 hover:bg-emerald-50/40'}`}
                    >
                      {speedLabels[opt]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
                <button
                  onClick={handleJumpToService}
                  disabled={!canJumpToServiceStart}
                  title={canJumpToServiceStart ? 'Jump to service start' : 'Service hours disabled'}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${canJumpToServiceStart ? 'border-emerald-100/70 bg-white/80 text-slate-700 hover:bg-emerald-50/40' : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'}`}
                >
                  ⏭ Start
                </button>
                <button
                  onClick={()=> setSettingsOpen(true)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-emerald-50/40"
                >
                  ⚙ Settings
                </button>
                <button
                  onClick={()=> resetGame()}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-emerald-50/40"
                >
                  Reset
                </button>
                <button
                  onClick={()=> resetGame(seed + 1)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-emerald-50/40"
                >
                  New Map
                </button>
                <span className="ml-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Fare {fareLabel}</span>
              </div>
            </div>
          </header>

          <main className="mx-auto max-w-screen-2xl px-6 py-6">
            <div className="flex flex-col items-center text-center">
              <h1 className="text-2xl font-semibold tracking-tight text-emerald-800">Transit Simulator</h1>
              <p className="text-sm text-slate-600">Tutorial City · Population {population.toLocaleString()} · Goal: {MODE_SHARE_TARGET}% for {MODE_SHARE_STREAK_DAYS} days</p>
              <p className="mt-1 text-sm text-slate-700">
                Network grade: <span className="font-semibold text-emerald-700">{networkGrade ?? '—'}</span> · Citizens appreciate every comfy ride.
              </p>
            </div>

            <div className="grid h-[calc(100vh-8rem)] grid-cols-1 items-start gap-4 pt-6 pb-10 sm:px-2 lg:grid-cols-[320px_minmax(0,1fr)_340px]">
              <aside className="order-2 flex h-full flex-col gap-4 overflow-y-auto rounded-2xl border border-emerald-100/60 bg-white/85 p-4 shadow-sm lg:order-1">
                <div>
                  <div className="text-xs uppercase text-slate-500">Cash</div>
                  <div className={`text-3xl font-semibold ${cash<0?'text-rose-600':'text-emerald-600'}`}>{fmtMoney(cash)}</div>
                </div>
                <div className="space-y-3 text-xs text-slate-600">
                  <div className="rounded-xl border border-emerald-100/70 bg-emerald-50/60 p-3">
                    <div className="text-sm font-semibold text-slate-900">Operations</div>
                    <div className="mt-2 space-y-1">
                      <div className="flex items-center justify-between"><span>Fleet owned</span><span className="font-semibold text-slate-900">{fleet}</span></div>
                      <div>
                        <div className="flex items-center justify-between"><span>Fleet in motion</span><span className="font-semibold text-slate-900">{vehiclesInUse}</span></div>
                        <div className="mt-1 flex items-center gap-0.5" aria-hidden>
                          {busUsageSlots.map((filled, idx) => (
                            <span key={idx} className={`text-[13px] leading-none ${filled ? 'text-emerald-600' : 'text-emerald-200/80'}`}>
                              🚌
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center justify-between"><span>Spare buses</span><span className="font-semibold text-slate-900">{spareBuses}</span></div>
                      <div className="flex items-center justify-between"><span>Depot capacity</span><span className="font-semibold text-slate-900">{depotCap}</span></div>
                      <div className="flex items-center justify-between"><span>Drivers</span><span className="font-semibold text-slate-900">{drivers} ({driversHours} drv-hrs)</span></div>
                    </div>
                    <div className="mt-2 text-xs text-slate-500">Service {serviceStartHour}:00–{serviceEndHour}:00 ({serviceHoursToday} hrs)</div>
                  </div>
                  <div className="rounded-xl border border-emerald-100/70 bg-emerald-50/60 p-3">
                    <div className="text-sm font-semibold text-slate-900">Performance</div>
                    <div className="mt-2 space-y-1">
                      <div className="flex items-center justify-between"><span>Mode share</span><span className="font-semibold text-slate-900">{modeShare.toFixed(1)}%</span></div>
                      <div className="flex items-center justify-between"><span>Average speed</span><span className="font-semibold text-slate-900">{effSpeed.toFixed(1)} km/h</span></div>
                      <div className="flex items-center justify-between"><span className="flex items-center gap-1">Actual veh/hr<InfoTip text="After capacity limits (fleet, drivers, depot)." /></span><span className="font-semibold text-slate-900">{networkActualVPH.toFixed(1)}</span></div>
                      <div className="flex items-center justify-between"><span>Capacity / hr</span><span className="font-semibold text-slate-900">{Math.round(networkCapacityPH).toLocaleString()}</span></div>
                      <div className="flex items-center justify-between"><span>Riders / hr</span><span className="font-semibold text-slate-900">{Math.round(networkServedPH).toLocaleString()}</span></div>
                      <div className="flex items-center justify-between"><span>Load factor</span><span className="font-semibold text-slate-900">{(loadFactor*100).toFixed(0)}%</span></div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-emerald-100/70 bg-emerald-50/60 p-3">
                    <div className="flex items-center justify-between"><span>Network target veh/hr</span><span className="font-semibold text-slate-900">{networkTargetVPH.toFixed(1)}</span></div>
                    <div className="mt-1 flex items-center justify-between"><span>Network actual veh/hr</span><span className="font-semibold text-slate-900">{networkActualVPH.toFixed(1)}</span></div>
                    <div className="mt-2 flex items-center justify-between"><span>Active round trip</span><span className="font-semibold text-slate-900">{activeRoundTripMinutes ? `${activeRoundTripMinutes} min` : '—'}</span></div>
                  </div>
                  <div className="rounded-xl border border-emerald-100/70 bg-emerald-50/60 p-3">
                    <div className="flex items-center justify-between"><span>Estimated riders/day</span><span className="font-semibold text-slate-900">{Number.isFinite(networkRidersPerDay) ? Math.round(networkRidersPerDay).toLocaleString() : '—'}</span></div>
                    <div className="mt-2 flex flex-col gap-1">
                      <span className="font-medium text-slate-600">Daily money:</span>
                      <span>{fmtMoney(dailyIncome)} – {fmtMoney(dailyCosts)} = <span className={dailyNetClass}>{fmtMoney(dailyNet)}</span></span>
                    </div>
                    <div className="mt-3">
                      <div className="flex justify-between text-xs"><span>Transit mode share</span><span>{modeShare.toFixed(2)}% / {MODE_SHARE_TARGET}%</span></div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-emerald-100/70">
                        <div className="h-full bg-emerald-400" style={{ width: `${Math.min(100, (modeShare/MODE_SHARE_TARGET)*100)}%` }} />
                      </div>
                    </div>
                  </div>
                </div>
              </aside>
              <section className="order-1 flex h-full min-h-[420px] flex-col rounded-2xl border border-emerald-100/60 bg-white/85 p-4 shadow-sm lg:order-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <span className="inline-flex h-3 w-3 rounded-full" style={{ backgroundColor: activeRouteSummary?.color || '#0ea5e9' }} />
                    <span>{activeRoute?.name || 'Route'}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-600">
                    <span>{activeRouteDailyRiders !== null ? `${Math.round(activeRouteDailyRiders).toLocaleString()} riders/day` : 'Add stops to peek at riders'}</span>
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100/80 text-[11px] font-bold text-emerald-700">{activeRouteSummary?.grade ?? '–'}</span>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
                  <span className={`font-semibold ${activeThrottled ? 'text-amber-600' : 'text-slate-700'}`}>
                    {activeActualVPH.toFixed(1)} / <span className={activeThrottled ? 'text-slate-400' : 'text-slate-500'}>{activeTargetVPH.toFixed(1)}</span> veh/hr
                  </span>
                  <span>Round trip {activeRoundTripMinutes ? `${activeRoundTripMinutes} min` : '—'}</span>
                </div>
                <div className="mt-3 flex-1">
                  <div ref={mapContainerRef} className="relative flex h-full w-full overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-50/70 via-sky-50 to-white">
                    <MapToast toasts={banners.mapQueue} onDismiss={banners.dismiss} />
                    <div className="grid h-full w-full place-items-center">
                      <div className="relative" style={{ width: displaySize, height: displaySize }}>
                        <div className="absolute inset-0">
                          {Array.from({ length: paddedGrid }).map((_, y) => (
                            <div key={y} className="flex">
                              {Array.from({ length: paddedGrid }).map((__, x) => {
                                const gridX = x - visualPadding;
                                const gridY = y - visualPadding;
                                const isRealCell = gridX >= 0 && gridX < GRID && gridY >= 0 && gridY < GRID;
                                const key = `${gridX},${gridY}`;
                                const popVal = isRealCell ? land.pop[gridY][gridX] : 0;
                                const jobsVal = isRealCell ? land.jobs[gridY][gridX] : 0;
                                const poi = isRealCell ? poiMap.get(key) : null;
                                const densityLevel = isRealCell ? (densityLevels[gridY]?.[gridX] ?? 0) : 0;
                                const baseIdx = Math.min(TILE_BASE_COLORS.length - 1, Math.max(0, popVal));
                                const baseColor = TILE_BASE_COLORS[baseIdx] || TILE_BASE_COLORS[0];
                                const tinted = isRealCell ? mixHexColor(baseColor, TILE_DENSITY_TINT, densityLevel * 0.8) : '#f6faf9';
                                const bg = isRealCell ? tinted : '#f6faf9';
                                const outline = isRealCell
                                  ? (jobsVal>0 ? `1px solid ${JOB_OUTLINE_COLOR}` : `1px solid ${IDLE_OUTLINE_COLOR}`)
                                  : '1px solid rgba(148,163,184,0.25)';
                                const glow = densityLevel > 0.05 ? `inset 0 0 0 1.5px rgba(58,174,161,${Math.min(0.35, densityLevel)})` : 'none';
                                const sparkleOpacity = densityLevel > 0.25 ? Math.min(0.45, densityLevel) : 0;
                                return (
                                  <div
                                    key={`${x}-${y}`}
                                    onClick={isRealCell ? (e)=> handleCellClick(e, gridX, gridY) : undefined}
                                    style={{ width: cellSize, height: cellSize, backgroundColor:bg, outline, boxShadow: glow, cursor: isRealCell ? 'crosshair' : 'default', position:'relative', overflow:'hidden', borderRadius:4 }}
                                  >
                                    {sparkleOpacity>0 && (
                                      <div className="tile-sparkle pointer-events-none absolute inset-1 rounded-md bg-emerald-200/40" style={{ opacity: sparkleOpacity }} />
                                    )}
                                    {poi && <div style={{position:'absolute', inset:'0', display:'grid', placeItems:'center', fontSize:'12px'}}>{poiIcon(poi)}</div>}
                                  </div>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                        <svg
                          className="absolute inset-0 h-full w-full"
                          width={displaySize}
                          height={displaySize}
                          viewBox={`0 0 ${displaySize} ${displaySize}`}
                          preserveAspectRatio="none"
                          style={{ pointerEvents:'none' }}
                        >
                          {routeSummaries.map(summary => (
                            summary.polyline && (
                              <polyline
                                key={summary.id}
                                points={summary.polyline}
                                fill="none"
                                stroke={summary.color}
                                strokeWidth={summary.id === activeRouteId ? 4 : 2}
                                strokeLinejoin="round"
                                strokeLinecap="round"
                                strokeOpacity={summary.id === activeRouteId ? 1 : 0.45}
                              />
                            )
                          ))}
                        </svg>
                        {busVisible && busPosition && (
                          <div
                            className="pointer-events-none absolute z-30"
                            style={{ left: busPosition.x, top: busPosition.y, transform: `translate(-50%, -50%) rotate(${busPosition.angle}rad)` }}
                          >
                            <span className="bus-emoji inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/85 text-lg shadow-lg ring-1 ring-emerald-200/80">
                              🚌
                            </span>
                          </div>
                        )}
                        {routeSummaries.map(summary => (
                          summary.stops.map((point, idx) => (
                            <div
                              key={`${summary.id}-${idx}`}
                              className="absolute -translate-x-1/2 -translate-y-1/2"
                              style={{ left: point.x * cellSize + mapOffset + cellSize/2, top: point.y * cellSize + mapOffset + cellSize/2 }}
                            >
                              <div
                                className={`rounded-full border-2 ${summary.id === activeRouteId ? 'h-3.5 w-3.5' : 'h-2.5 w-2.5 opacity-80'}`}
                                style={{ borderColor: summary.color, backgroundColor: summary.id === activeRouteId ? summary.color : '#fff' }}
                              />
                            </div>
                          ))
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <p className="mt-2 text-center text-xs text-slate-500">Click to add stops · Shift removes · Pause to tweak at your own pace</p>
              </section>
              <aside className="order-3 flex h-full flex-col gap-4 overflow-y-auto rounded-2xl border border-emerald-100/60 bg-white/85 p-4 shadow-sm lg:order-3">
                <div>
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium text-slate-900">Routes</div>
                    <button onClick={handleAddRoute} className="rounded-lg border border-emerald-200 bg-white/80 px-2 py-1 text-xs font-medium hover:bg-emerald-50/40">New Route</button>
                  </div>
                  <div className="mt-3 space-y-2">
                    {routeSummaries.map(summary => {
                      const isActive = summary.id === activeRouteId;
                      const throttled = summary.throttled;
                      return (
                        <button
                          key={summary.id}
                          onClick={()=> { destHeavyShownRef.current = false; setActiveRouteId(summary.id); }}
                          className={`w-full rounded-xl border px-3 py-2 text-left text-sm ${isActive ? 'border-emerald-300 bg-emerald-100 text-emerald-900' : 'border-emerald-100/60 bg-white/80 text-slate-700 hover:bg-emerald-50/40'}`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="flex items-center gap-2">
                              <span className="inline-flex h-2.5 w-2.5 rounded-full" style={{ backgroundColor: summary.color }} />
                              <span className="font-medium">{summary.name}</span>
                            </span>
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100/80 text-[11px] font-bold text-emerald-700">{summary.grade ?? '–'}</span>
                          </div>
                          <div className="mt-1 flex items-center justify-between text-xs text-slate-600">
                            <span>{summary.ridersPerDay !== null ? `${summary.ridersPerDay.toLocaleString()} riders/day` : 'No service yet'}</span>
                            <span className={`font-semibold ${throttled ? 'text-amber-600' : 'text-slate-700'}`}>
                              {summary.actualVPH.toFixed(1)} / <span className={throttled ? 'text-slate-400' : 'text-slate-500'}>{summary.targetVPH.toFixed(1)}</span> veh/hr
                            </span>
                          </div>
                        </button>
                      );
                    })}
                    {!routeSummaries.length && (
                      <div className="rounded-xl border border-dashed border-emerald-200 bg-white/80 px-3 py-4 text-center text-xs text-slate-500">Create a route to begin service.</div>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-emerald-100/60 bg-white/80 p-4 text-xs text-slate-700 shadow-sm">
                  <div className="text-sm font-medium text-slate-900">Selected Route</div>
                  <div className="mt-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <span>Actual / Target</span>
                      <span className={`font-semibold ${activeThrottled ? 'text-amber-600' : 'text-slate-900'}`}>
                        {activeActualVPH.toFixed(1)} / <span className={activeThrottled ? 'text-slate-400' : 'text-slate-500'}>{activeTargetVPH.toFixed(1)}</span> veh/hr
                      </span>
                    </div>
                    <div>
                      <div className="text-sm font-medium text-slate-900">Target Frequency</div>
                      <div className="mt-2">
                        <NumberStepper
                          value={activeRoute?.targetVPH ?? DEFAULT_TARGET_VPH}
                          min={0}
                          max={24}
                          step={1}
                          onChange={handleRouteTargetChange}
                          format={(v)=> `${Math.round(v)} veh/hr`}
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Estimated riders/day</span>
                      <span className="font-semibold text-slate-900">{activeRouteDailyRiders !== null ? Math.round(activeRouteDailyRiders).toLocaleString() : '—'}</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-emerald-100/60 bg-white/80 p-4 text-xs text-slate-700 shadow-sm">
                  <div className="text-sm font-medium text-slate-900">Fare & Policy</div>
                  <div className="mt-3">
                    <NumberStepper
                      value={globalFare}
                      min={1.5}
                      max={3.0}
                      step={0.05}
                      onChange={setGlobalFare}
                      format={(v)=> `$${Number(v).toFixed(2)}`}
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-emerald-100/60 bg-white/80 p-4 text-xs text-slate-700 shadow-sm">
                  <div className="text-sm font-medium text-slate-900">Service Hours</div>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <label>Start: <input type="number" min="0" max="23" value={serviceStartHour} onChange={e=> setServiceStartHour(clamp(parseInt(e.target.value)||0,0,23))} className="ml-1 w-16 rounded border border-emerald-200 px-1" />:00</label>
                    <label>End: <input type="number" min="1" max="24" value={serviceEndHour} onChange={e=> setServiceEndHour(clamp(parseInt(e.target.value)||0,1,24))} className="ml-1 w-16 rounded border border-emerald-200 px-1" />:00</label>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">Current span: {Math.max(0, serviceEndHour - serviceStartHour)} hours/day</div>
                </div>

                <div className="rounded-2xl border border-emerald-100/60 bg-white/80 p-4 text-xs text-slate-700 shadow-sm">
                  <div className="mb-2 text-sm font-medium text-slate-900">Fleet & Depot</div>
                  <div className="space-y-1 text-sm text-slate-700">
                    <div>Buses owned: <span className="font-semibold text-slate-900">{fleet}</span></div>
                    <div>Fleet in motion: <span className="font-semibold text-slate-900">{vehiclesInUse}</span> / {fleet} buses (Spare {spareBuses})</div>
                    <div>Depot capacity: <span className="font-semibold text-slate-900">{depotCap}</span></div>
                    <div>Max throughput: <span className="font-semibold text-slate-900">{depotThroughputRounded}</span> veh/hr</div>
                  </div>
                  {allocationDeficit > 0 && (
                    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
                      Short of {allocationDeficit} buses to hit all target frequencies.
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button onClick={()=> buyBuses(1)} className="rounded-lg border border-emerald-200 bg-white/80 px-2 py-1 text-xs hover:bg-emerald-50/40">Buy 1 ({FUELS[fuel].busCost.toLocaleString()})</button>
                    <button onClick={()=> buyBuses(5)} className="rounded-lg border border-emerald-200 bg-white/80 px-2 py-1 text-xs hover:bg-emerald-50/40">Buy 5 (−5%)</button>
                    <button onClick={()=> buyBuses(10)} className="rounded-lg border border-emerald-200 bg-white/80 px-2 py-1 text-xs hover:bg-emerald-50/40">Buy 10 (−10%)</button>
                    <button onClick={expandDepot} className="rounded-lg border border-emerald-200 bg-white/80 px-2 py-1 text-xs hover:bg-emerald-50/40">Expand Depot +{DEPOT_EXPANSION_STEP} ({DEPOT_EXPANSION_COST.toLocaleString()})</button>
                  </div>
                </div>

                <div className="rounded-2xl border border-emerald-100/60 bg-white/80 p-4 text-xs text-slate-700 shadow-sm">
                  <div className="mb-2 text-sm font-medium text-slate-900">Fuel & Drivers</div>
                  <div className="flex flex-wrap gap-2">
                    {Object.keys(FUELS).map(k=>(
                      <button key={k} onClick={()=> setFuel(k)} className={`rounded-lg border px-2 py-1 text-xs ${fuel===k?'border-emerald-300 bg-emerald-100':'border-emerald-200 bg-white/80 hover:bg-emerald-50/40'}`}>{k}</button>
                    ))}
                  </div>
                  <div className="mt-2 text-sm">$ / km: <span className="font-semibold text-slate-900">{FUELS[fuel].costPerKm.toFixed(2)}</span></div>
                  <div className="mt-1 text-sm">
                    Drivers: <span className="font-semibold text-slate-900">{drivers}</span>
                    <button onClick={()=> hireDrivers(+10)} className="ml-2 rounded border border-emerald-200 bg-white/80 px-2 py-0.5 text-xs hover:bg-emerald-50/40">+10</button>
                    <button onClick={()=> hireDrivers(-10)} className="ml-1 rounded border border-emerald-200 bg-white/80 px-2 py-0.5 text-xs hover:bg-emerald-50/40">−10</button>
                  </div>
                </div>
              </aside>
            </div>
          </main>

          {settingsOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
            <div className="w-full max-w-sm rounded-2xl border border-emerald-100/60 bg-white/85 p-6 shadow-xl">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">Settings</h2>
                <button onClick={()=> setSettingsOpen(false)} className="rounded-md border border-emerald-100/60 bg-white/80 px-2 py-1 text-sm text-slate-600 hover:bg-emerald-50/40">✕</button>
              </div>
              <div className="mt-4 space-y-5 text-sm text-slate-700">
                <label className="flex items-center justify-between gap-3">
                  <span className="font-medium text-slate-800">Auto-skip idle minutes</span>
                  <input type="checkbox" checked={autoSkipIdle} onChange={e=> setAutoSkipIdle(e.target.checked)} className="h-4 w-4 rounded border border-emerald-200" />
                </label>
              </div>

              <div className="mt-6 flex justify-end">
                <button onClick={()=> setSettingsOpen(false)} className="rounded-lg border border-emerald-200 bg-white/80 px-3 py-1.5 text-sm font-medium hover:bg-emerald-50/40">Close</button>
              </div>
            </div>
          </div>
        )}
        </div>
    </React.Fragment>
  );
  }
  TS.App = App;

  ReactDOM.createRoot(document.getElementById('root')).render(<App />);
})(window);
